"""
╔══════════════════════════════════════════════════════════════════════════════╗
║          SYNC SQL SERVER → SUPABASE — Supermercado Casa Mota               ║
║                                                                              ║
║  Lee precios/nombres/stock de dbSIC.dbo.TinvArticulos                      ║
║  y actualiza la tabla products en Supabase via REST API (PATCH).            ║
║                                                                              ║
║  Matching: TinvArticulos.NoReferencia  ↔  products.barcode                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

INSTALACIÓN (una sola vez):
    pip install pyodbc requests

CONFIGURACIÓN:
    Rellena la sección "── CONFIGURACIÓN ──" con tus datos reales.
    NUNCA compartas este archivo con tus credenciales rellenas.

EJECUCIÓN MANUAL:
    python sync_precios.py

EJECUCIÓN AUTOMÁTICA (Windows Task Scheduler):
    Ver instrucciones en INSTRUCCIONES.md
"""

import pyodbc
import requests
import json
import sys
import logging
from datetime import datetime

# ── LOGGING ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level    = logging.INFO,
    format   = '%(asctime)s  %(levelname)-8s  %(message)s',
    datefmt  = '%Y-%m-%d %H:%M:%S',
    handlers = [
        logging.FileHandler('sync_precios.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
#  ── CONFIGURACIÓN  ── rellena estos valores con tus datos reales ────────────
# ══════════════════════════════════════════════════════════════════════════════

SQL_SERVER   = "TU_IP_PUBLICA"          # ej: 190.123.45.67  ó  mipc.dyndns.org
SQL_PORT     = 1433                      # puerto SQL Server (default 1433)
SQL_DATABASE = "dbSIC"
SQL_USER     = "APIS"
SQL_PASSWORD = "TU_CLAVE_AQUI"          # ← solo tú lo ves, nunca lo compartas

# Supabase — estos datos son públicos (ya están en api.js)
SB_URL = "https://lpnkdlfejsesxozowlda.supabase.co/rest/v1"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo"

# ── Opciones de sincronización ────────────────────────────────────────────────
SOLO_ACTUALIZAR_EXISTENTES = True   # True  → solo actualiza productos que ya existen en Supabase
                                     # False → también crea productos nuevos (usar con cuidado)

CAMPOS_A_SINCRONIZAR = ['price', 'stock', 'name']   # qué campos se actualizan
                                                      # opciones: 'price', 'stock', 'name'

# ══════════════════════════════════════════════════════════════════════════════

SB_HEADERS = {
    'Content-Type':  'application/json',
    'apikey':        SB_KEY,
    'Authorization': f'Bearer {SB_KEY}',
    'Prefer':        'return=representation',
}


def conectar_sqlserver():
    """Abre conexión a SQL Server con pyodbc."""
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={SQL_SERVER},{SQL_PORT};"
        f"DATABASE={SQL_DATABASE};"
        f"UID={SQL_USER};"
        f"PWD={SQL_PASSWORD};"
        f"TrustServerCertificate=yes;"
        f"Connect Timeout=15;"
    )
    try:
        conn = pyodbc.connect(conn_str)
        log.info("✅ Conectado a SQL Server (%s/%s)", SQL_SERVER, SQL_DATABASE)
        return conn
    except pyodbc.Error as e:
        log.error("❌ No se pudo conectar a SQL Server: %s", e)
        raise


COSTO_MINIMO   = 1.0
COLUMNA_COSTO  = 'CostoPromedio'


def _existe_columna(conn, tabla, columna):
    """
    Comprueba en INFORMATION_SCHEMA si la columna existe.

    Hace falta porque este script traía una consulta fija que NO pedía el
    costo. Si le añadimos la columna a ciegas y el nombre no coincide, SQL
    Server responde «Invalid column name» y el sync entero deja de correr,
    dejando los precios de la web congelados sin que nadie se entere.
    """
    esq, tab = (tabla.split('.', 1) if '.' in tabla else ('dbo', tabla))
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    """, esq.strip('[]'), tab.strip('[]'), columna)
    return (cur.fetchone()[0] or 0) > 0


def leer_productos_sql(conn):
    """
    Lee ArticuloID, Nombre, NoReferencia, PrecioP, ExistGlobal
    de dbo.TinvArticulos.

    Filtra fuera lo que no es un producto vendible:
      · NoReferencia nulo o vacío
      · Nombre vacío, o que solo tiene puntos, comas u otros signos
      · Costo menor o igual a 1  (solo si la columna de costo existe)

    El filtro de nombre se hace en SQL con PATINDEX: exige al menos DOS letras
    seguidas, así que '.', '..', ',', '---' y '123' quedan descartados, pero
    'Pan', 'Té' o 'A-1 Salsa' pasan.
    """
    hay_costo = _existe_columna(conn, 'dbo.TinvArticulos', COLUMNA_COSTO)
    if hay_costo:
        col_costo   = f"ISNULL([{COLUMNA_COSTO}], 0) AS Costo"
        filtro_cost = f"AND ISNULL([{COLUMNA_COSTO}], 0) > {COSTO_MINIMO}"
    else:
        col_costo   = "CAST(NULL AS decimal(18,2)) AS Costo"
        filtro_cost = ""
        log.warning("⚠️ La columna «%s» no existe en dbo.TinvArticulos. "
                    "No se puede filtrar por costo; solo se omitirán los "
                    "artículos sin descripción.", COLUMNA_COSTO)

    query = f"""
        SELECT
            ArticuloID,
            LTRIM(RTRIM(Nombre))       AS Nombre,
            LTRIM(RTRIM(NoReferencia)) AS NoReferencia,
            ISNULL(PrecioP,    0)      AS PrecioP,
            ISNULL(ExistGlobal,0)      AS ExistGlobal,
            {col_costo}
        FROM dbo.TinvArticulos
        WHERE NoReferencia IS NOT NULL
          AND LTRIM(RTRIM(NoReferencia)) <> ''
          AND Nombre IS NOT NULL
          AND PATINDEX('%[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]%',
                       LTRIM(RTRIM(Nombre))) > 0
          {filtro_cost}
        ORDER BY ArticuloID
    """
    cursor = conn.cursor()
    cursor.execute(query)
    rows = cursor.fetchall()
    cols = [c[0] for c in cursor.description]
    productos = [dict(zip(cols, row)) for row in rows]
    log.info("📦 Productos leídos de SQL Server: %d (filtrados: sin "
             "descripción%s)", len(productos),
             f", costo <= {COSTO_MINIMO:g}" if hay_costo else "")
    return productos


def leer_productos_supabase():
    """
    Descarga todos los productos de Supabase (solo id, barcode, price, stock, name).
    Devuelve un dict  barcode → {id, price, stock, name}  para lookup O(1).
    """
    fields   = 'id,barcode,price,stock,name'
    sb_map   = {}
    page     = 0
    page_size = 1000

    while True:
        res = requests.get(
            f"{SB_URL}/products",
            headers = {**SB_HEADERS, 'Range': f'{page * page_size}-{page * page_size + page_size - 1}'},
            params  = {'select': fields, 'order': 'created_at.asc', 'deleted': 'is.false'},
            timeout = 20,
        )
        if res.status_code == 416:   # sin más registros
            break
        if not res.ok:
            log.error("❌ Error leyendo Supabase: %s %s", res.status_code, res.text[:200])
            raise RuntimeError(f"Supabase GET error {res.status_code}")

        batch = res.json()
        if not isinstance(batch, list) or len(batch) == 0:
            break

        for p in batch:
            bc = (p.get('barcode') or '').strip()
            if bc:
                sb_map[bc] = p

        if len(batch) < page_size:
            break
        page += 1

    log.info("🗄️  Productos en Supabase: %d (con barcode)", len(sb_map))
    return sb_map


def patch_producto(sb_id, payload):
    """Envía PATCH a Supabase para actualizar solo los campos indicados."""
    res = requests.patch(
        f"{SB_URL}/products?id=eq.{sb_id}",
        headers = SB_HEADERS,
        data    = json.dumps(payload),
        timeout = 15,
    )
    if not res.ok:
        raise RuntimeError(f"PATCH error {res.status_code}: {res.text[:200]}")
    return res


def create_producto(sql_row):
    """Crea un producto nuevo en Supabase basado en la fila de SQL Server."""
    payload = {
        'name':          sql_row['Nombre'],
        'barcode':       sql_row['NoReferencia'],
        'price':         float(sql_row['PrecioP']),
        'originalPrice': float(sql_row['PrecioP']),
        'stock':         int(sql_row['ExistGlobal']),
        'unit':          'unidad',
        'deleted':       False,
    }
    res = requests.post(
        f"{SB_URL}/products",
        headers = SB_HEADERS,
        data    = json.dumps(payload),
        timeout = 15,
    )
    if not res.ok:
        raise RuntimeError(f"POST error {res.status_code}: {res.text[:200]}")
    return res


def sincronizar():
    """Función principal de sincronización."""
    inicio = datetime.now()
    log.info("═" * 60)
    log.info("🚀 Iniciando sincronización — %s", inicio.strftime('%Y-%m-%d %H:%M:%S'))
    log.info("═" * 60)

    # ── 1. Leer fuentes ───────────────────────────────────────────────────────
    conn         = conectar_sqlserver()
    sql_productos = leer_productos_sql(conn)
    conn.close()

    sb_map = leer_productos_supabase()

    # ── 2. Comparar y actualizar ──────────────────────────────────────────────
    actualizados  = 0
    sin_cambios   = 0
    no_encontrados = 0
    creados       = 0
    errores       = 0

    for prod in sql_productos:
        barcode   = prod['NoReferencia']
        sb_prod   = sb_map.get(barcode)

        if sb_prod is None:
            # Producto de SQL Server no existe en Supabase
            if SOLO_ACTUALIZAR_EXISTENTES:
                no_encontrados += 1
                continue
            else:
                # Crear producto nuevo
                try:
                    create_producto(prod)
                    creados += 1
                    log.info("  ➕ Creado:     %-40s  barcode=%s", prod['Nombre'][:40], barcode)
                except Exception as e:
                    errores += 1
                    log.warning("  ⚠️  Error creando %s: %s", barcode, e)
                continue

        # ── Construir payload solo con campos que cambiaron ───────────────────
        payload = {}

        if 'price' in CAMPOS_A_SINCRONIZAR:
            nuevo_precio = round(float(prod['PrecioP']), 2)
            if round(float(sb_prod.get('price') or 0), 2) != nuevo_precio:
                payload['price'] = nuevo_precio

        if 'stock' in CAMPOS_A_SINCRONIZAR:
            nuevo_stock = int(prod['ExistGlobal'])
            if int(sb_prod.get('stock') or 0) != nuevo_stock:
                payload['stock'] = nuevo_stock

        if 'name' in CAMPOS_A_SINCRONIZAR:
            nuevo_nombre = prod['Nombre'].strip()
            if (sb_prod.get('name') or '').strip() != nuevo_nombre:
                payload['name'] = nuevo_nombre

        if not payload:
            sin_cambios += 1
            continue

        # ── Enviar PATCH ──────────────────────────────────────────────────────
        try:
            patch_producto(sb_prod['id'], payload)
            actualizados += 1
            cambios_str = ', '.join(f"{k}={v}" for k, v in payload.items())
            log.info("  ✏️  Actualizado: %-40s  %s", prod['Nombre'][:40], cambios_str)
        except Exception as e:
            errores += 1
            log.warning("  ⚠️  Error en %s (%s): %s", barcode, prod['Nombre'][:30], e)

    # ── 3. Resumen ────────────────────────────────────────────────────────────
    duracion = (datetime.now() - inicio).total_seconds()
    log.info("═" * 60)
    log.info("📊 RESUMEN")
    log.info("   ✏️  Actualizados  : %d", actualizados)
    log.info("   ✅ Sin cambios    : %d", sin_cambios)
    log.info("   ➕ Creados        : %d", creados)
    log.info("   🔍 No encontrados : %d  (están en SQL Server pero no en Supabase)", no_encontrados)
    log.info("   ❌ Errores        : %d", errores)
    log.info("   ⏱️  Duración       : %.1f segundos", duracion)
    log.info("═" * 60)

    return {
        'actualizados': actualizados,
        'sin_cambios':  sin_cambios,
        'creados':      creados,
        'no_encontrados': no_encontrados,
        'errores':      errores,
    }


if __name__ == '__main__':
    try:
        resultado = sincronizar()
        # Salir con código de error si hubo fallos
        sys.exit(1 if resultado['errores'] > 0 else 0)
    except Exception as e:
        log.critical("💥 Error crítico: %s", e)
        sys.exit(2)
