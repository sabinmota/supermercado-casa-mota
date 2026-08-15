"""
═══════════════════════════════════════════════════════════════════════════════
 RESPALDO Y EXPORTACIÓN — Supermercado Casa Mota
═══════════════════════════════════════════════════════════════════════════════

 Este módulo agrega tres herramientas al Sync Panel, SIN tocar nada de lo que
 ya funcionaba en servidor_local.py:

   1) RESPALDO .BAK      → copia completa de dbSIC (tablas, vistas,
                            procedimientos, índices, permisos). Es la ÚNICA
                            que permite RESTAURAR el programa viejo si un
                            ataque borra la PC.

   2) RESPALDO DE DATOS  → un CSV por cada tabla. NO restaura el programa,
                            pero se puede leer con Excel y no necesita
                            permisos especiales de SQL Server. Es el plan B
                            si el usuario APIS no tiene permiso de BACKUP.

   3) EXPORTAR PARA IA   → costos y precios en CSV + JSON + Markdown, para
                            que la app de escritorio de ChatGPT los lea y
                            responda "¿cuál es el costo del aceite de soya
                            Crisol de 64oz?".

 ─────────────────────────────────────────────────────────────────────────────
 🔴 DOS ADVERTENCIAS QUE IMPORTAN MÁS QUE EL CÓDIGO
 ─────────────────────────────────────────────────────────────────────────────

 A) `BACKUP DATABASE` es una orden que ejecuta SQL SERVER, no Python. El
    archivo .bak se escribe en el disco DEL SERVIDOR SQL. Si SQL Server está
    en otra PC, el .bak NO aparece en la carpeta local por arte de magia:
    hay que copiarlo. Por eso este módulo maneja DOS carpetas separadas
    (`backup_carpeta_servidor` y `backup_carpeta_local`) e intenta la copia
    solo si la ruta del servidor es alcanzable desde esta PC.

 B) Un respaldo guardado en la MISMA PC no protege de un ransomware, porque
    el ataque cifra también esa carpeta. Hay que copiar los archivos a un
    disco externo o a la nube. Este módulo deja los archivos listos y con
    fecha en el nombre precisamente para que esa copia sea fácil.

 ─────────────────────────────────────────────────────────────────────────────
 NOTA SOBRE LA COLUMNA DE COSTO
 ─────────────────────────────────────────────────────────────────────────────
 Ninguna consulta del sync original leía un costo (solo PrecioP y
 ExistGlobal). Como no se puede adivinar cómo se llama esa columna en dbSIC,
 aquí hay dos cosas:
   · /api/respaldo/columnas → lista las columnas reales de la base
   · _detectar_costo()      → intenta adivinarla automáticamente
 Si adivina mal, se escribe el nombre correcto en el panel y se guarda en
 sync_config.json bajo la clave `export_costo_col`.
═══════════════════════════════════════════════════════════════════════════════
"""

import csv
import json
import os
import re
import shutil
import socket
import threading
import unicodedata
from datetime import datetime

import pyodbc
from flask import Blueprint, jsonify, request, send_file

bp_respaldo = Blueprint('respaldo', __name__)

# ── Inyección de dependencias desde servidor_local.py ──────────────────────
# Se hace así (y no con un import directo) para evitar un import circular:
# servidor_local importa este módulo, así que este módulo NO puede importar
# servidor_local.
_log_fn      = None   # función _log(msg, level)
_load_cfg_fn = None   # función _load_config()


def init_respaldo(log_fn, load_cfg_fn):
    """Llamado una vez desde servidor_local.py al arrancar."""
    global _log_fn, _load_cfg_fn
    _log_fn      = log_fn
    _load_cfg_fn = load_cfg_fn


def _log(msg, level='INFO'):
    if _log_fn:
        _log_fn(msg, level)
    else:
        print(f'[{level}] {msg}')


def _cfg():
    return _load_cfg_fn() if _load_cfg_fn else {}


# ── Estado del proceso en curso ────────────────────────────────────────────
_estado = {
    'corriendo': False,
    'tarea':     '',      # 'bak' | 'datos' | 'export'
    'paso':      '',
    'ok':        None,
    'archivos':  [],
    'error':     '',
}
_estado_lock = threading.Lock()


def _set_estado(**kw):
    with _estado_lock:
        _estado.update(kw)


# ══════════════════════════════════════════════════════════════════════════════
#  RUTAS DE CARPETAS
# ══════════════════════════════════════════════════════════════════════════════

CARPETA_LOCAL_DEF    = r'C:\RespaldoCasaMota'
CARPETA_SERVIDOR_DEF = r'C:\RespaldoCasaMota'


def _carpeta_local(cfg=None):
    cfg = cfg if cfg is not None else _cfg()
    ruta = (cfg.get('backup_carpeta_local') or CARPETA_LOCAL_DEF).strip()
    return ruta or CARPETA_LOCAL_DEF


def _carpeta_servidor(cfg=None):
    cfg = cfg if cfg is not None else _cfg()
    ruta = (cfg.get('backup_carpeta_servidor') or '').strip()
    # Si no se especificó, se asume la misma que la local (caso servidor en
    # esta misma PC, que es lo más común en estos programas de punto de venta)
    return ruta or _carpeta_local(cfg)


def _asegurar_carpeta(ruta):
    """Crea la carpeta si no existe. Devuelve (ok, mensaje)."""
    try:
        os.makedirs(ruta, exist_ok=True)
        return True, ''
    except Exception as e:
        return False, f'No se pudo crear la carpeta «{ruta}»: {e}'


def _servidor_es_local(cfg):
    """
    ¿SQL Server corre en esta misma PC? Determina si el .bak que escribe
    SQL Server va a estar accesible desde aquí.
    """
    srv = (cfg.get('server') or '').strip().lower()
    # Quitar instancia nombrada y puerto: 'MIPC\SQLEXPRESS,1433' → 'mipc'
    base = re.split(r'[\\,]', srv)[0].strip()
    locales = {'', 'localhost', '127.0.0.1', '(local)', '.', '::1'}
    if base in locales:
        return True
    try:
        if base == socket.gethostname().lower():
            return True
    except Exception:
        pass
    return False


# ══════════════════════════════════════════════════════════════════════════════
#  CONEXIÓN A SQL SERVER
# ══════════════════════════════════════════════════════════════════════════════

# El driver 18 es el que ya usaba servidor_local.py. Si no está instalado se
# intenta el 17, que es el que menciona INSTRUCCIONES.md. Así funciona en las
# dos situaciones en vez de fallar con "Data source name not found".
DRIVERS = ['ODBC Driver 18 for SQL Server',
           'ODBC Driver 17 for SQL Server',
           'SQL Server Native Client 11.0',
           'SQL Server']


def _drivers_disponibles():
    try:
        return [d for d in pyodbc.drivers()]
    except Exception:
        return []


def _conectar(cfg, autocommit=False, timeout=15):
    """
    Abre conexión a SQL Server probando los drivers en orden.

    🔴 autocommit=True es OBLIGATORIO para BACKUP DATABASE: SQL Server no
    permite ejecutar un backup dentro de una transacción explícita, y pyodbc
    abre transacción implícita por defecto.
    """
    if not cfg.get('server') or not cfg.get('database'):
        raise RuntimeError('Falta configurar el servidor y la base de datos.')

    instalados = _drivers_disponibles()
    orden = [d for d in DRIVERS if d in instalados] or [DRIVERS[0]]
    ultimo_error = None

    for drv in orden:
        conn_str = (
            f"DRIVER={{{drv}}};"
            f"SERVER={cfg['server']},{cfg.get('port', 1433)};"
            f"DATABASE={cfg['database']};"
            f"UID={cfg.get('user', '')};"
            f"PWD={cfg.get('password', '')};"
            f"TrustServerCertificate=yes;"
            f"Encrypt=no;"
            f"Connect Timeout={timeout};"
        )
        try:
            return pyodbc.connect(conn_str, autocommit=autocommit, timeout=timeout)
        except pyodbc.Error as e:
            ultimo_error = e
            continue

    raise RuntimeError(f'No se pudo conectar a SQL Server: {str(ultimo_error)[:200]}')


def _partir_tabla(nombre):
    """'dbo.vInvArticulos' → ('dbo', 'vInvArticulos')"""
    limpio = (nombre or '').replace('[', '').replace(']', '').strip()
    if '.' in limpio:
        esquema, tabla = limpio.split('.', 1)
        return esquema.strip(), tabla.strip()
    return 'dbo', limpio


def _columnas_de(conn, nombre_tabla):
    """Lee las columnas reales desde INFORMATION_SCHEMA."""
    esquema, tabla = _partir_tabla(nombre_tabla)
    cur = conn.cursor()
    cur.execute("""
        SELECT COLUMN_NAME, DATA_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION
    """, esquema, tabla)
    return [{'nombre': r[0], 'tipo': r[1]} for r in cur.fetchall()]


# Candidatas en orden de probabilidad. Los sistemas dominicanos de punto de
# venta suelen usar «Costo», «CostoP» o «UltimoCosto».
_CANDIDATAS_COSTO = [
    'costo', 'costop', 'costou', 'costounitario', 'costopromedio',
    'ultimocosto', 'costoultimo', 'costofinal', 'costoactual',
    'preciocosto', 'precioc', 'costocompra', 'costoneto', 'cost',
]


def _detectar_costo(columnas):
    """
    Intenta identificar la columna de costo. Devuelve (nombre, motivo).
    Nunca inventa: si no encuentra nada, devuelve (None, ...).
    """
    mapa = {c['nombre'].lower(): c['nombre'] for c in columnas}
    for cand in _CANDIDATAS_COSTO:
        if cand in mapa:
            return mapa[cand], 'coincidencia exacta'
    # Segunda pasada: cualquier columna numérica que contenga "costo"/"cost"
    for c in columnas:
        low = c['nombre'].lower()
        if ('costo' in low or low.startswith('cost')) and \
           c['tipo'].lower() in ('money', 'decimal', 'numeric', 'float', 'real',
                                 'smallmoney', 'int', 'bigint'):
            return c['nombre'], 'contiene «costo» y es numérica'
    return None, 'no se encontró ninguna columna de costo'


def _elegir(columnas, *candidatas):
    """Devuelve el nombre real de la primera candidata que exista."""
    mapa = {c['nombre'].lower(): c['nombre'] for c in columnas}
    for cand in candidatas:
        if cand.lower() in mapa:
            return mapa[cand.lower()]
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  RUTA — Ver columnas reales (para encontrar la columna de costo)
# ══════════════════════════════════════════════════════════════════════════════

@bp_respaldo.route('/api/respaldo/columnas', methods=['POST'])
def ver_columnas():
    """
    Lista las columnas reales de las tablas de inventario y sugiere cuál es
    la de costo. Esto existe porque el nombre de esa columna NO se puede
    adivinar desde el código actual: ninguna consulta la leía.
    """
    cfg   = _cfg()
    datos = request.get_json(silent=True) or {}
    tablas = datos.get('tablas') or ['dbo.vInvArticulos', 'dbo.TinvArticulos']

    try:
        conn = _conectar(cfg)
    except Exception as e:
        return jsonify({'ok': False, 'msg': f'❌ {e}'})

    resultado = []
    try:
        for t in tablas:
            cols = _columnas_de(conn, t)
            if not cols:
                resultado.append({'tabla': t, 'existe': False, 'columnas': []})
                continue
            costo, motivo = _detectar_costo(cols)
            resultado.append({
                'tabla':          t,
                'existe':         True,
                'total':          len(cols),
                'columnas':       cols,
                'costo_sugerido': costo,
                'costo_motivo':   motivo,
            })
    finally:
        conn.close()

    encontrada = next((r.get('costo_sugerido') for r in resultado
                       if r.get('costo_sugerido')), None)
    return jsonify({
        'ok':              True,
        'tablas':          resultado,
        'costo_sugerido':  encontrada,
        'drivers':         _drivers_disponibles(),
        'msg': (f'✅ Columna de costo detectada: {encontrada}' if encontrada
                else '⚠️ No se detectó columna de costo. Revisa la lista y '
                     'escribe el nombre a mano.'),
    })


# ══════════════════════════════════════════════════════════════════════════════
#  TAREA 1 — RESPALDO .BAK (el único que restaura el programa)
# ══════════════════════════════════════════════════════════════════════════════

def _tarea_bak():
    cfg = _cfg()
    archivos = []
    try:
        _set_estado(corriendo=True, tarea='bak', ok=None, error='',
                    archivos=[], paso='Conectando a SQL Server…')

        base   = cfg.get('database', 'dbSIC')
        sello  = datetime.now().strftime('%Y-%m-%d_%H%M')
        nombre = f'{base}_{sello}.bak'

        car_srv = _carpeta_servidor(cfg)
        car_loc = _carpeta_local(cfg)
        es_local = _servidor_es_local(cfg)

        ok, msg = _asegurar_carpeta(car_loc)
        if not ok:
            raise RuntimeError(msg)

        if es_local:
            ok, msg = _asegurar_carpeta(car_srv)
            if not ok:
                raise RuntimeError(msg)
            _log('🖥️ SQL Server corre en esta misma PC: el .bak se escribirá '
                 'directamente en tu carpeta.', 'INFO')
        else:
            _log(f'⚠️ SQL Server está en otra máquina ({cfg.get("server")}). '
                 f'El .bak se escribirá en «{car_srv}» DE ESA MÁQUINA, no aquí. '
                 f'Se intentará copiarlo después.', 'WARN')

        ruta_srv = os.path.join(car_srv, nombre)

        # 🔴 autocommit=True: BACKUP no puede correr dentro de transacción.
        conn = _conectar(cfg, autocommit=True, timeout=30)
        cur  = conn.cursor()

        _set_estado(paso='Ejecutando BACKUP DATABASE… (puede tardar varios minutos)')
        _log(f'💾 Iniciando respaldo completo de [{base}] → {ruta_srv}', 'INFO')

        base_esc = base.replace(']', ']]')
        ruta_esc = ruta_srv.replace("'", "''")

        # COMPRESSION no existe en SQL Server Express. Se intenta con
        # compresión y, si el motor la rechaza, se repite sin ella.
        sql_con = (
            f"BACKUP DATABASE [{base_esc}] TO DISK = N'{ruta_esc}' "
            f"WITH INIT, CHECKSUM, COMPRESSION, "
            f"NAME = N'Casa Mota respaldo {sello}'"
        )
        sql_sin = (
            f"BACKUP DATABASE [{base_esc}] TO DISK = N'{ruta_esc}' "
            f"WITH INIT, CHECKSUM, "
            f"NAME = N'Casa Mota respaldo {sello}'"
        )

        try:
            cur.execute(sql_con)
            while cur.nextset():
                pass
            _log('✅ BACKUP completado (con compresión).', 'SUCCESS')
        except pyodbc.Error as e:
            texto = str(e)
            if 'COMPRESSION' in texto.upper() or 'compres' in texto.lower():
                _log('ℹ️ Esta edición de SQL Server no soporta compresión. '
                     'Repitiendo sin comprimir…', 'WARN')
                cur.execute(sql_sin)
                while cur.nextset():
                    pass
                _log('✅ BACKUP completado (sin compresión).', 'SUCCESS')
            else:
                raise

        # Verificación: comprueba que el .bak es legible y no está corrupto.
        # Un respaldo sin verificar es una promesa, no un respaldo.
        _set_estado(paso='Verificando integridad del respaldo…')
        try:
            cur.execute(f"RESTORE VERIFYONLY FROM DISK = N'{ruta_esc}' WITH CHECKSUM")
            while cur.nextset():
                pass
            _log('🔎 Verificación OK: el respaldo es restaurable.', 'SUCCESS')
        except pyodbc.Error as e:
            _log(f'⚠️ El respaldo se creó pero la verificación falló: '
                 f'{str(e)[:200]}', 'WARN')

        conn.close()

        # ── Copiar a la carpeta local si el .bak es alcanzable desde aquí ──
        _set_estado(paso='Copiando a tu carpeta local…')
        ruta_final = ruta_srv
        if os.path.exists(ruta_srv):
            tam = os.path.getsize(ruta_srv)
            destino = os.path.join(car_loc, nombre)
            if os.path.abspath(ruta_srv) != os.path.abspath(destino):
                shutil.copy2(ruta_srv, destino)
                _log(f'📁 Copiado a {destino}', 'SUCCESS')
                ruta_final = destino
            archivos.append({'nombre': nombre, 'ruta': ruta_final, 'bytes': tam})
            _log(f'📦 Tamaño: {tam / 1048576:.1f} MB', 'INFO')
        else:
            _log(f'⚠️ El archivo se creó en el servidor pero esta PC no puede '
                 f'ver «{ruta_srv}». Cópialo manualmente desde esa máquina, o '
                 f'usa una ruta compartida de red en «Carpeta del servidor».',
                 'WARN')
            archivos.append({'nombre': nombre, 'ruta': ruta_srv, 'bytes': 0})

        _limpiar_antiguos(car_loc, int(cfg.get('backup_retencion', 7) or 7))

        _log('🔒 RECUERDA: copia este archivo a un disco externo o a la nube. '
             'Un respaldo en la misma PC no sobrevive a un ransomware.', 'WARN')
        _set_estado(corriendo=False, ok=True, paso='Listo', archivos=archivos)

    except Exception as e:
        detalle = str(e)[:400]
        ayuda = ''
        low = detalle.lower()
        if 'permission' in low or 'denied' in low or 'backup database permission' in low:
            ayuda = (' → El usuario de SQL no tiene permiso de respaldo. '
                     'Pídele al administrador: ALTER SERVER ROLE '
                     '[dbcreator] o EXEC sp_addrolemember '
                     "'db_backupoperator', 'APIS'. Mientras tanto usa "
                     '«Respaldo de datos (CSV)», que no requiere permisos.')
        elif 'operating system error 5' in low or 'access is denied' in low:
            ayuda = (' → SQL Server no puede escribir en esa carpeta. La '
                     'carpeta debe darle permiso a la cuenta del servicio '
                     'SQL Server, no a tu usuario de Windows.')
        elif 'operating system error 3' in low:
            ayuda = ' → Esa carpeta no existe en la máquina del servidor SQL.'
        _log(f'❌ Error en el respaldo: {detalle}{ayuda}', 'ERROR')
        _set_estado(corriendo=False, ok=False, error=detalle + ayuda, paso='Error')


def _limpiar_antiguos(carpeta, conservar):
    """Borra los .bak más viejos y deja solo los N más recientes."""
    try:
        if conservar <= 0:
            return
        baks = [os.path.join(carpeta, f) for f in os.listdir(carpeta)
                if f.lower().endswith('.bak')]
        baks.sort(key=os.path.getmtime, reverse=True)
        for viejo in baks[conservar:]:
            os.remove(viejo)
            _log(f'🧹 Respaldo antiguo eliminado: {os.path.basename(viejo)}', 'INFO')
    except Exception as e:
        _log(f'⚠️ No se pudieron limpiar respaldos antiguos: {e}', 'WARN')


@bp_respaldo.route('/api/respaldo/bak', methods=['POST'])
def respaldo_bak():
    if _estado['corriendo']:
        return jsonify({'ok': False, 'msg': '⚠️ Ya hay un respaldo en curso.'})
    threading.Thread(target=_tarea_bak, daemon=True).start()
    return jsonify({'ok': True, 'msg': 'Respaldo iniciado. Mira el log.'})


# ══════════════════════════════════════════════════════════════════════════════
#  TAREA 2 — RESPALDO DE DATOS EN CSV (plan B, sin permisos especiales)
# ══════════════════════════════════════════════════════════════════════════════

def _tarea_datos():
    cfg = _cfg()
    archivos = []
    try:
        _set_estado(corriendo=True, tarea='datos', ok=None, error='',
                    archivos=[], paso='Conectando…')

        sello   = datetime.now().strftime('%Y-%m-%d_%H%M')
        destino = os.path.join(_carpeta_local(cfg), f'datos_{sello}')
        ok, msg = _asegurar_carpeta(destino)
        if not ok:
            raise RuntimeError(msg)

        conn = _conectar(cfg, timeout=30)
        cur  = conn.cursor()
        cur.execute("""
            SELECT TABLE_SCHEMA, TABLE_NAME
              FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_TYPE = 'BASE TABLE'
             ORDER BY TABLE_SCHEMA, TABLE_NAME
        """)
        tablas = [(r[0], r[1]) for r in cur.fetchall()]
        _log(f'📋 {len(tablas)} tablas encontradas. Exportando a CSV…', 'INFO')

        total_filas = 0
        fallidas    = []
        for i, (esq, tab) in enumerate(tablas, 1):
            _set_estado(paso=f'Tabla {i}/{len(tablas)}: {esq}.{tab}')
            try:
                c2 = conn.cursor()
                c2.execute(f'SELECT * FROM [{esq}].[{tab}]')
                cabeceras = [d[0] for d in c2.description]
                ruta = os.path.join(destino, f'{esq}.{tab}.csv')
                n = 0
                with open(ruta, 'w', newline='', encoding='utf-8-sig') as f:
                    w = csv.writer(f)
                    w.writerow(cabeceras)
                    while True:
                        lote = c2.fetchmany(2000)
                        if not lote:
                            break
                        for fila in lote:
                            w.writerow(['' if v is None else v for v in fila])
                            n += 1
                total_filas += n
                archivos.append({'nombre': f'{esq}.{tab}.csv',
                                 'ruta': ruta, 'bytes': os.path.getsize(ruta)})
            except Exception as e:
                fallidas.append(f'{esq}.{tab}')
                _log(f'⚠️ No se pudo exportar {esq}.{tab}: {str(e)[:120]}', 'WARN')

        conn.close()

        # Ficha explicativa, para que dentro de un año se sepa qué es esto
        ficha = os.path.join(destino, 'LEEME.txt')
        with open(ficha, 'w', encoding='utf-8') as f:
            f.write(
                'RESPALDO DE DATOS — Supermercado Casa Mota\n'
                f'Generado: {datetime.now().strftime("%Y-%m-%d %H:%M")}\n'
                f'Base de datos: {cfg.get("database", "dbSIC")}\n'
                f'Servidor: {cfg.get("server", "")}\n'
                f'Tablas exportadas: {len(archivos)}\n'
                f'Filas totales: {total_filas}\n\n'
                'QUE ES ESTO:\n'
                '  Un CSV por cada tabla, con TODOS los datos.\n\n'
                'QUE NO ES:\n'
                '  NO restaura el programa viejo. Aqui estan las cifras, no\n'
                '  la estructura interna, ni las vistas, ni los procedimientos,\n'
                '  ni los permisos. Para restaurar el programa se necesita el\n'
                '  archivo .bak.\n\n'
                'GUARDA ESTA CARPETA FUERA DE ESTA PC (disco externo o nube).\n'
            )
        archivos.append({'nombre': 'LEEME.txt', 'ruta': ficha,
                         'bytes': os.path.getsize(ficha)})

        _log(f'✅ Respaldo de datos listo: {len(archivos) - 1} tablas, '
             f'{total_filas:,} filas → {destino}', 'SUCCESS')
        if fallidas:
            _log(f'⚠️ {len(fallidas)} tablas no se pudieron leer: '
                 f'{", ".join(fallidas[:8])}', 'WARN')
        _log('ℹ️ Esto NO restaura el programa. Para eso necesitas el .bak.', 'WARN')
        _set_estado(corriendo=False, ok=True, paso='Listo', archivos=archivos)

    except Exception as e:
        _log(f'❌ Error en el respaldo de datos: {str(e)[:300]}', 'ERROR')
        _set_estado(corriendo=False, ok=False, error=str(e)[:300], paso='Error')


@bp_respaldo.route('/api/respaldo/datos', methods=['POST'])
def respaldo_datos():
    if _estado['corriendo']:
        return jsonify({'ok': False, 'msg': '⚠️ Ya hay un proceso en curso.'})
    threading.Thread(target=_tarea_datos, daemon=True).start()
    return jsonify({'ok': True, 'msg': 'Respaldo de datos iniciado.'})


# ══════════════════════════════════════════════════════════════════════════════
#  TAREA 3 — EXPORTAR COSTOS Y PRECIOS PARA LA APP DE CHATGPT
# ══════════════════════════════════════════════════════════════════════════════

def _normalizar(texto):
    """
    'Aceite de Soya Crisol 64Oz.' → 'aceite de soya crisol 64oz'
    Sirve para que la búsqueda del plugin encuentre el producto aunque se
    escriba sin acentos, en minúsculas o con puntuación distinta.
    """
    if not texto:
        return ''
    t = unicodedata.normalize('NFKD', str(texto))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r'[^a-z0-9]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def _num(v):
    try:
        if v is None:
            return 0.0
        return round(float(v), 2)
    except Exception:
        return 0.0


def _tarea_export(opciones):
    cfg = _cfg()
    archivos = []
    try:
        _set_estado(corriendo=True, tarea='export', ok=None, error='',
                    archivos=[], paso='Conectando…')

        tabla     = opciones.get('tabla') or cfg.get('export_tabla') or 'dbo.TinvArticulos'
        col_costo = (opciones.get('costo') or cfg.get('export_costo_col') or '').strip()

        conn = _conectar(cfg, timeout=30)
        cols = _columnas_de(conn, tabla)
        if not cols:
            raise RuntimeError(f'La tabla «{tabla}» no existe o no es accesible. '
                               f'Usa «Ver columnas» para revisar los nombres.')

        # Resolver los nombres reales de cada columna que nos interesa.
        c_id     = _elegir(cols, 'ArticuloID', 'Id', 'IdArticulo', 'Codigo')
        c_nombre = _elegir(cols, 'Nombre', 'Descripcion', 'DescripcionArticulo')
        c_codigo = _elegir(cols, 'NoReferencia', 'Referencia', 'CodigoBarra',
                           'CodigoBarras', 'Barcode')
        c_precio = _elegir(cols, 'PrecioP', 'Precio', 'PrecioVenta', 'Precio1')
        c_stock  = _elegir(cols, 'ExistGlobal', 'Existencia', 'Stock', 'Exist')
        c_unidad = _elegir(cols, 'Unidad', 'UnidadMedida', 'Um')
        c_depto  = _elegir(cols, 'Departamento', 'Categoria', 'Grupo', 'Familia')

        if not col_costo:
            col_costo, motivo = _detectar_costo(cols)
            if col_costo:
                _log(f'🔍 Columna de costo detectada automáticamente: '
                     f'«{col_costo}» ({motivo}).', 'INFO')
            else:
                _log('⚠️ No se encontró columna de costo en esta tabla. El '
                     'export saldrá con costo en 0. Usa «Ver columnas» para '
                     'localizarla y escríbela a mano.', 'WARN')
        else:
            # Validar contra las columnas reales: evita inyección SQL y typos
            real = _elegir(cols, col_costo)
            if not real:
                raise RuntimeError(f'La columna de costo «{col_costo}» no existe '
                                   f'en {tabla}. Usa «Ver columnas».')
            col_costo = real

        if not c_nombre:
            raise RuntimeError(f'No se encontró columna de nombre en {tabla}.')

        # SELECT armado solo con nombres verificados contra INFORMATION_SCHEMA
        seleccion = []
        def add(alias, columna):
            seleccion.append(f'[{columna}] AS [{alias}]' if columna
                             else f'NULL AS [{alias}]')
        add('id', c_id)
        add('nombre', c_nombre)
        add('codigo', c_codigo)
        add('costo', col_costo)
        add('precio', c_precio)
        add('existencia', c_stock)
        add('unidad', c_unidad)
        add('departamento', c_depto)

        esq, tab = _partir_tabla(tabla)
        _set_estado(paso='Leyendo productos…')
        cur = conn.cursor()
        cur.execute(f"SELECT {', '.join(seleccion)} FROM [{esq}].[{tab}] "
                    f"ORDER BY [{c_nombre}]")

        productos = []
        for r in cur.fetchall():
            nombre = (str(r.nombre).strip() if r.nombre else '')
            if not nombre:
                continue
            costo  = _num(r.costo)
            precio = _num(r.precio)
            margen = round((precio - costo) / precio * 100, 1) if precio else 0.0
            productos.append({
                'id':           str(r.id).strip() if r.id is not None else '',
                'codigo':       str(r.codigo).strip() if r.codigo else '',
                'nombre':       nombre,
                'busqueda':     _normalizar(nombre),
                'costo':        costo,
                'precio':       precio,
                'ganancia':     round(precio - costo, 2),
                'margen_pct':   margen,
                'existencia':   _num(r.existencia),
                'unidad':       str(r.unidad).strip() if r.unidad else '',
                'departamento': str(r.departamento).strip() if r.departamento else '',
            })
        conn.close()

        if not productos:
            raise RuntimeError('La consulta no devolvió productos.')

        carpeta = os.path.join(_carpeta_local(cfg), 'para-chatgpt')
        ok, msg = _asegurar_carpeta(carpeta)
        if not ok:
            raise RuntimeError(msg)

        sello_txt = datetime.now().strftime('%Y-%m-%d %H:%M')
        _set_estado(paso='Escribiendo archivos…')

        # ── 1) CSV — el formato que ChatGPT lee mejor para buscar cifras ──
        ruta_csv = os.path.join(carpeta, 'costos-y-precios.csv')
        campos = ['codigo', 'nombre', 'costo', 'precio', 'ganancia',
                  'margen_pct', 'existencia', 'unidad', 'departamento', 'id']
        with open(ruta_csv, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=campos, extrasaction='ignore')
            w.writeheader()
            for p in productos:
                w.writerow(p)
        archivos.append({'nombre': 'costos-y-precios.csv', 'ruta': ruta_csv,
                         'bytes': os.path.getsize(ruta_csv)})

        # ── 2) JSON — para el plugin que van a construir los agentes de IA ──
        ruta_json = os.path.join(carpeta, 'costos-y-precios.json')
        paquete = {
            'negocio':        'Supermercado Casa Mota',
            'generado':       sello_txt,
            'base_datos':     cfg.get('database', 'dbSIC'),
            'tabla_origen':   tabla,
            'columna_costo':  col_costo or '(no encontrada)',
            'moneda':         'DOP',
            'total':          len(productos),
            'campos': {
                'codigo':       'Código de barras o referencia interna',
                'nombre':       'Nombre del producto tal como está en el sistema',
                'busqueda':     'Nombre normalizado (minúsculas, sin acentos) para buscar',
                'costo':        'Costo de compra por unidad, en pesos dominicanos',
                'precio':       'Precio de venta al público, en pesos dominicanos',
                'ganancia':     'precio menos costo',
                'margen_pct':   'Porcentaje de ganancia sobre el precio de venta',
                'existencia':   'Unidades en inventario',
                'unidad':       'Unidad de medida',
                'departamento': 'Categoría o departamento',
            },
            'como_buscar':
                'Normaliza la pregunta del usuario igual que el campo '
                '"busqueda" (minúsculas, sin acentos, sin puntuación) y busca '
                'que todas las palabras aparezcan en ese campo. Ejemplo: '
                '"costo del aceite de soya Crisol de 64oz" → palabras '
                '["aceite","soya","crisol","64oz"].',
            'productos':      productos,
        }
        with open(ruta_json, 'w', encoding='utf-8') as f:
            json.dump(paquete, f, ensure_ascii=False, indent=1)
        archivos.append({'nombre': 'costos-y-precios.json', 'ruta': ruta_json,
                         'bytes': os.path.getsize(ruta_json)})

        # ── 3) Markdown por partes — para arrastrar al chat de escritorio ──
        # Se parte en trozos porque un archivo con miles de filas puede
        # exceder lo que la app lee de una sola vez.
        por_parte = int(opciones.get('por_parte') or 1200)
        partes = [productos[i:i + por_parte]
                  for i in range(0, len(productos), por_parte)]
        for n, parte in enumerate(partes, 1):
            nom = (f'catalogo-parte-{n:02d}-de-{len(partes):02d}.md'
                   if len(partes) > 1 else 'catalogo.md')
            ruta_md = os.path.join(carpeta, nom)
            with open(ruta_md, 'w', encoding='utf-8') as f:
                f.write(f'# Costos y precios — Supermercado Casa Mota\n\n')
                f.write(f'Actualizado: {sello_txt}  \n')
                f.write(f'Moneda: pesos dominicanos (RD$)  \n')
                f.write(f'Parte {n} de {len(partes)} — {len(parte)} productos '
                        f'de {len(productos)}\n\n')
                f.write('| Código | Producto | Costo | Precio | Ganancia | '
                        'Margen | Existencia |\n')
                f.write('|---|---|---:|---:|---:|---:|---:|\n')
                for p in parte:
                    nom_seguro = p['nombre'].replace('|', '/')
                    f.write(f"| {p['codigo']} | {nom_seguro} | "
                            f"{p['costo']:.2f} | {p['precio']:.2f} | "
                            f"{p['ganancia']:.2f} | {p['margen_pct']:.1f}% | "
                            f"{p['existencia']:.0f} |\n")
            archivos.append({'nombre': nom, 'ruta': ruta_md,
                             'bytes': os.path.getsize(ruta_md)})

        # ── 4) Instrucciones para pegar en ChatGPT ──
        ruta_ins = os.path.join(carpeta, 'INSTRUCCIONES-PARA-CHATGPT.txt')
        with open(ruta_ins, 'w', encoding='utf-8') as f:
            f.write(
                'COMO USAR ESTOS ARCHIVOS EN LA APP DE ESCRITORIO DE CHATGPT\n'
                '===========================================================\n\n'
                f'Actualizado: {sello_txt}\n'
                f'Productos: {len(productos)}\n'
                f'Columna de costo usada: {col_costo or "NINGUNA - costos en 0"}\n\n'
                'FORMA RAPIDA (sin plugin):\n'
                '  1. Abre ChatGPT de escritorio.\n'
                '  2. Adjunta el archivo costos-y-precios.csv\n'
                '  3. Pregunta, por ejemplo:\n'
                '     "Dame el costo del aceite de soya Crisol de 64oz"\n'
                '     "Cuales 20 productos tienen el margen mas bajo"\n'
                '     "Que productos vendo por debajo del costo"\n\n'
                'SI EL ARCHIVO ES MUY GRANDE:\n'
                '  Adjunta los archivos catalogo-parte-XX.md por separado.\n\n'
                'PARA EL PLUGIN QUE VAN A CONSTRUIR LOS AGENTES DE IA:\n'
                '  Usen costos-y-precios.json. Trae el campo "busqueda" ya\n'
                '  normalizado (minusculas, sin acentos) y una llave\n'
                '  "como_buscar" que explica el algoritmo de coincidencia.\n\n'
                'IMPORTANTE:\n'
                '  Estos archivos son una FOTO del momento indicado arriba.\n'
                '  Si cambian precios o costos, vuelve a exportar.\n'
                '  Contienen tus costos reales: no los subas a ningun sitio\n'
                '  publico ni a GitHub.\n'
            )
        archivos.append({'nombre': 'INSTRUCCIONES-PARA-CHATGPT.txt',
                         'ruta': ruta_ins, 'bytes': os.path.getsize(ruta_ins)})

        con_costo = sum(1 for p in productos if p['costo'] > 0)
        _log(f'✅ Export para ChatGPT listo: {len(productos):,} productos → '
             f'{carpeta}', 'SUCCESS')
        _log(f'📊 {con_costo:,} productos con costo mayor que 0 '
             f'({len(productos) - con_costo:,} sin costo registrado).', 'INFO')
        if col_costo:
            _log(f'💵 Columna de costo usada: {col_costo}', 'INFO')
        _log('🔒 Este archivo tiene tus costos reales. No lo subas a GitHub.', 'WARN')
        _set_estado(corriendo=False, ok=True, paso='Listo', archivos=archivos)

    except Exception as e:
        _log(f'❌ Error exportando: {str(e)[:300]}', 'ERROR')
        _set_estado(corriendo=False, ok=False, error=str(e)[:300], paso='Error')


@bp_respaldo.route('/api/respaldo/exportar', methods=['POST'])
def respaldo_exportar():
    if _estado['corriendo']:
        return jsonify({'ok': False, 'msg': '⚠️ Ya hay un proceso en curso.'})
    opciones = request.get_json(silent=True) or {}
    threading.Thread(target=_tarea_export, args=(opciones,), daemon=True).start()
    return jsonify({'ok': True, 'msg': 'Exportación iniciada.'})


# ══════════════════════════════════════════════════════════════════════════════
#  RUTAS — Estado, listado y descarga
# ══════════════════════════════════════════════════════════════════════════════

@bp_respaldo.route('/api/respaldo/estado', methods=['GET'])
def respaldo_estado():
    with _estado_lock:
        return jsonify(dict(_estado))


@bp_respaldo.route('/api/respaldo/archivos', methods=['GET'])
def respaldo_archivos():
    """Lista lo que hay en la carpeta local de respaldos."""
    cfg     = _cfg()
    carpeta = _carpeta_local(cfg)
    salida  = []
    if os.path.isdir(carpeta):
        for raiz, _dirs, ficheros in os.walk(carpeta):
            for fi in ficheros:
                completo = os.path.join(raiz, fi)
                try:
                    st = os.stat(completo)
                except OSError:
                    continue
                salida.append({
                    'nombre':   os.path.relpath(completo, carpeta).replace('\\', '/'),
                    'bytes':    st.st_size,
                    'fecha':    datetime.fromtimestamp(st.st_mtime)
                                        .strftime('%Y-%m-%d %H:%M'),
                    'orden':    st.st_mtime,
                })
        salida.sort(key=lambda x: x['orden'], reverse=True)
    return jsonify({
        'ok':               True,
        'carpeta':          carpeta,
        'carpeta_servidor': _carpeta_servidor(cfg),
        'servidor_local':   _servidor_es_local(cfg),
        'archivos':         salida[:200],
        'total':            len(salida),
    })


@bp_respaldo.route('/api/respaldo/descargar', methods=['GET'])
def respaldo_descargar():
    """
    Descarga un archivo de la carpeta de respaldos desde el navegador.
    Se valida que la ruta resuelta quede DENTRO de la carpeta, para que un
    nombre como '../../Windows/algo' no pueda salir de ahí.
    """
    nombre  = request.args.get('nombre', '')
    carpeta = os.path.abspath(_carpeta_local())
    destino = os.path.abspath(os.path.join(carpeta, nombre))
    if not destino.startswith(carpeta + os.sep) or not os.path.isfile(destino):
        return jsonify({'ok': False, 'msg': '❌ Archivo no válido.'}), 400
    return send_file(destino, as_attachment=True,
                     download_name=os.path.basename(destino))
