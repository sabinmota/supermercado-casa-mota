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
    'tarea':     '',      # 'bak' | 'datos' | 'export' | 'actualizar'
    'paso':      '',
    'ok':        None,
    'archivos':  [],
    'error':     '',
    'cambios':   None,    # resumen de la última actualización del listado
    'cancelar':  False,   # lo pone a True /api/respaldo/cancelar
}
_estado_lock = threading.Lock()


def _set_estado(**kw):
    with _estado_lock:
        _estado.update(kw)


def _cancelado():
    """
    True si el usuario pidió abortar la tarea en curso.

    Hace falta porque «Respaldo de datos en CSV» recorre las MIL VEINTE tablas
    de dbSIC una por una. Sin este freno, quien lo pulsa por error tiene que
    esperar a que termine o matar el proceso a mano.
    """
    with _estado_lock:
        return bool(_estado.get('cancelar'))


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


# Candidatas en ORDEN DE PRIORIDAD. El orden importa: si la tabla tiene varias
# columnas de costo, gana la primera de esta lista.
#
# 🔴 «costoultimo» va PRIMERO porque es el nombre real confirmado en dbSIC de
# Casa Mota (columna `CostoUltimo`). Antes la lista empezaba por 'costo', así
# que si la tabla tuviera además una columna `Costo` genérica, esa habría
# ganado y el export habría mostrado una cifra distinta a la que el usuario
# quiere ver, sin avisar de nada.
_CANDIDATAS_COSTO = [
    'costoultimo', 'ultimocosto',
    'costo', 'costop', 'costou', 'costounitario', 'costopromedio',
    'costofinal', 'costoactual',
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
                    archivos=[], paso='Conectando a SQL Server…',
                    cancelar=False)

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

    finally:
        # 🔴 Red de seguridad. Sin este finally, si el hilo muere por algo que
        # no es Exception (BaseException, KeyboardInterrupt, un fallo dentro de
        # _set_estado…), «corriendo» se queda en True PARA SIEMPRE y el panel
        # rechaza todos los botones con «Ya hay un proceso en curso», sin forma
        # de recuperarse salvo reiniciando el servidor. Pasó de verdad.
        if _estado.get('corriendo'):
            _set_estado(corriendo=False, paso='Interrumpido')
            _log('⚠️ La tarea terminó de forma inesperada. Estado liberado.',
                 'WARN')


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
                    archivos=[], paso='Conectando…', cancelar=False)

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
            if _cancelado():
                _log(f'🛑 Cancelado por el usuario en la tabla {i} de '
                     f'{len(tablas)}. Los CSV ya escritos se quedan en '
                     f'{destino} — puedes borrar esa carpeta sin problema.',
                     'WARN')
                break
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

    finally:
        if _estado.get('corriendo'):
            _set_estado(corriendo=False, paso='Interrumpido')
            _log('⚠️ El respaldo de datos terminó de forma inesperada. Estado '
                 'liberado.', 'WARN')


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


# ══════════════════════════════════════════════════════════════════════════════
#  FILTRO DE BASURA — artículos sin descripción real o sin costo real
# ══════════════════════════════════════════════════════════════════════════════
#
# En dbSIC hay filas que no son productos vendibles: renglones de prueba,
# artículos dados de baja a los que solo les quedó un punto en el nombre, y
# artículos cuyo costo nunca se cargó (queda en 0 o en 1).
#
# 🔴 Por qué «costo <= 1» y no «costo <= 0»: el usuario lo pidió así porque en
# su base el 1 se usa como valor de relleno cuando no se conoce el costo. Ojo:
# esto TAMBIÉN descarta cualquier producto que de verdad cueste 1 peso o menos.
# Si algún día vende algo a ese costo real, hay que subir el criterio.
COSTO_MINIMO = 1.0

# Exige DOS LETRAS SEGUIDAS en alguna parte del nombre.
#
# 🔴 Antes esto contaba letras sueltas en cualquier posición, y eso NO era lo
# mismo que hace el PATINDEX de las consultas SQL de sync_precios.py y
# servidor_local.py, que exige dos letras consecutivas. Un nombre como
# «..A.B..» pasaba en Python y se descartaba en SQL: el listado de ChatGPT y
# la web habrían quedado con catálogos distintos sin que nada avisara.
# Ahora las dos implementaciones aplican exactamente el mismo criterio.
_DOS_LETRAS = re.compile(r'[^\W\d_]{2}', re.UNICODE)


def _nombre_valido(nombre):
    """
    True si el nombre parece una descripción de producto de verdad.

    Criterio: debe contener al menos DOS LETRAS SEGUIDAS.

    Descarta:
      - vacío o solo espacios
      - solo puntuación:  '.'  '..'  '.....'  ','  '---------'  '***'  '. ,'
      - solo números:  '123'   (un código suelto no es una descripción)
      - una sola letra:  'X'   ·  letras sueltas entre signos:  '..A.B..'

    Acepta 'Pan', 'Té', 'Maní Piñón', 'A-1 Salsa', 'Aceite de Soya 64oz'.
    """
    if not nombre:
        return False
    t = str(nombre).strip()
    if not t:
        return False
    return bool(_DOS_LETRAS.search(t))


def _costo_valido(costo):
    """
    True si el costo es utilizable. Descarta None, 0, negativos y todo lo que
    sea menor o igual a COSTO_MINIMO (1.0), que en esta base significa
    «costo no cargado».
    """
    try:
        return float(costo) > COSTO_MINIMO
    except (TypeError, ValueError):
        return False


def _descartar(nombre, costo, exigir_costo=True):
    """
    Devuelve el motivo del descarte, o None si la fila se queda.

    `exigir_costo=False` se usa cuando la consulta no trae columna de costo
    (el sync del panel lee una vista que no la tiene): en ese caso solo se
    puede filtrar por nombre, y hay que decirlo en el log en vez de fingir
    que se filtró por costo.
    """
    if not _nombre_valido(nombre):
        return 'sin descripción'
    if exigir_costo and not _costo_valido(costo):
        return 'costo <= 1'
    return None


def _leer_catalogo(cfg, opciones):
    """
    Lee costos y precios desde SQL Server y devuelve (productos, tabla, col_costo).

    Esta función es la ÚNICA que lee el catálogo. Tanto la exportación completa
    como el botón «Actualizar listado» la usan, para que sea imposible que las
    dos den resultados distintos: si un día se cambia el criterio, cambia para
    las dos a la vez.
    """
    # 🔴 FUENTE ÚNICA — dbo.vInvArticulos, la MISMA que usa el sync.
    #
    # Antes esto apuntaba por defecto a 'dbo.TinvArticulos' (la tabla cruda),
    # mientras que el sync de precios de la web lee 'dbo.vInvArticulos' (la
    # vista). Las dos tienen una columna llamada «PrecioP», pero NO valen lo
    # mismo: el usuario comprobó que los precios del listado no coincidían con
    # los del admin, y al revisar las cifras del CSV, 20 de 20 productos daban
    # un precio de mostrador redondo al multiplicarlos por 1.18 — es decir, la
    # tabla guarda el precio SIN ITBIS y la vista lo devuelve YA CON ITBIS.
    #
    # Resultado del fallo: ChatGPT respondía precios ~15% por debajo del real.
    # Leer de la vista, igual que el sync, es lo que garantiza que el listado y
    # la web digan exactamente lo mismo.
    tabla = (opciones.get('tabla') or cfg.get('export_tabla')
             or 'dbo.vInvArticulos')
    col_costo = (opciones.get('costo') or cfg.get('export_costo_col') or '').strip()

    conn = _conectar(cfg, timeout=30)
    try:
        cols = _columnas_de(conn, tabla)
        if not cols:
            raise RuntimeError(f'La tabla «{tabla}» no existe o no es accesible. '
                               f'Usa «Ver columnas» para revisar los nombres.')

        c_id     = _elegir(cols, 'ArticuloID', 'Id', 'IdArticulo', 'Codigo')
        c_nombre = _elegir(cols, 'Nombre', 'Descripcion', 'DescripcionArticulo')
        # 🔴 «NoReferencia» y nada más — copiado de la fuente, no adivinado.
        #
        # Verificado en sync_precios.py:
        #   · cabecera línea 8:  «Matching: TinvArticulos.NoReferencia ↔ products.barcode»
        #   · consulta línea 146: LTRIM(RTRIM(NoReferencia)) AS NoReferencia
        #   · create_producto línea 227: 'barcode': sql_row['NoReferencia']
        #
        # Aquí había la misma cadena de reserva que rompió el precio:
        # NoReferencia → Referencia → CodigoBarra → CodigoBarras → Barcode. Si
        # la vista no tuviera NoReferencia, el listado se habría ido callado a
        # otra columna y habría publicado códigos que NO son los que la web usa
        # para identificar el producto. Se exige la columna real o se falla.
        c_codigo = _elegir(cols, 'NoReferencia')
        if not c_codigo:
            raise RuntimeError(
                f'La tabla «{tabla}» no tiene la columna «NoReferencia», que es '
                f'la que el sync usa como código de barras (NoReferencia ↔ '
                f'products.barcode). No se genera el listado: un código '
                f'distinto al de la web sería inútil para buscar productos.')
        # 🔴 «PrecioP» a secas y nada más.
        #
        # Antes había una cadena de reserva: PrecioP → Precio → PrecioVenta →
        # Precio1. Eso parece prudente, pero es justo lo que rompe la
        # coherencia: el sync de la web lee SIEMPRE «PrecioP» y solo esa. Si en
        # la vista no existiera, el listado se habría ido callado a «Precio» o
        # a «Precio1» y habría publicado otra tarifa distinta a la de la web,
        # sin un solo aviso. Mejor fallar con un error claro que mentir.
        c_precio = _elegir(cols, 'PrecioP')
        if not c_precio:
            raise RuntimeError(
                f'La tabla «{tabla}» no tiene la columna «PrecioP», que es la '
                f'que usa el sync de la web para fijar los precios. No se '
                f'genera el listado: preferimos avisar antes que publicar '
                f'precios que no coincidan con el admin. Usa «Ver columnas» '
                f'para revisar de dónde estás leyendo.')
        c_stock  = _elegir(cols, 'ExistGlobal', 'Existencia', 'Stock', 'Exist')
        c_unidad = _elegir(cols, 'Unidad', 'UnidadMedida', 'Um')
        c_depto  = _elegir(cols, 'Departamento', 'Categoria', 'Grupo', 'Familia')

        # El nombre que pidió el usuario se guarda aparte ANTES de tocar nada,
        # porque más abajo hace falta para buscarlo en la tabla de costo.
        costo_pedido = col_costo

        if not col_costo:
            col_costo, motivo = _detectar_costo(cols)
            if col_costo:
                _log(f'🔍 Columna de costo detectada automáticamente: '
                     f'«{col_costo}» ({motivo}).', 'INFO')
        else:
            # Validar contra las columnas reales: evita inyección SQL y typos.
            #
            # 🔴 SI NO EXISTE, HAY QUE VACIARLO. Aquí estuvo el bug que rompió
            # el listado por completo: dejaba «col_costo» con el nombre que no
            # existe («CostoPromedio»), así que el bloque del JOIN de abajo
            # —que solo entra cuando col_costo está vacío— NUNCA se ejecutaba,
            # y el SELECT acababa pidiendo v.[CostoPromedio] a la vista.
            # Resultado: «Invalid column name 'CostoPromedio'» y CERO listado.
            # Es peor que el fallo que venía a arreglar: antes salía el costo
            # en 0, ahora no salía nada.
            col_costo = _elegir(cols, col_costo) or ''

        # ══════════════════════════════════════════════════════════════════════
        #  🔴 EL COSTO VIVE EN OTRO SITIO QUE EL PRECIO
        # ══════════════════════════════════════════════════════════════════════
        #
        # Comprobado en la base real del usuario (log del 2026-08-18 19:39):
        # «La columna de costo CostoPromedio no existe en dbo.vInvArticulos y no
        # se encontró NINGUNA alternativa» → 13,594 productos con costo 0.00.
        #
        # O sea: la VISTA dbo.vInvArticulos NO expone ninguna columna de costo.
        # Ni CostoUltimo ni CostoPromedio ni nada. Pero el precio CON ITBIS solo
        # está en la vista, y el costo solo está en la TABLA dbo.TinvArticulos.
        #
        # Escoger una sola fuente es imposible sin perder algo:
        #   · solo la vista → precio bien, costo en 0        (fallo actual)
        #   · solo la tabla → costo bien, precio 15% bajo    (fallo anterior)
        #
        # Por eso se leen LAS DOS y se unen por ArticuloID, que es la clave que
        # el propio sync usa para identificar artículos (sync_precios.py lo
        # selecciona y ordena por él). Cada dato sale de donde es correcto:
        #   · precio, nombre, código, existencia → vista  (con ITBIS)
        #   · costo                              → tabla  (el real de compra)
        #
        # Se usa LEFT JOIN a propósito: si un artículo estuviera en la vista y
        # no en la tabla, se queda en el listado con costo 0 en vez de
        # desaparecer. Antes desaparecer sería peor: sería esconderle al usuario
        # un producto que sí vende.
        tabla_costo = ''
        if not col_costo:
            TABLA_COSTO_DEF = 'dbo.TinvArticulos'
            cols_t = _columnas_de(conn, TABLA_COSTO_DEF)
            if cols_t:
                cand, motivo = _detectar_costo(cols_t)
                # Si la config pedía un nombre concreto, se respeta si existe
                # ahí. Así «CostoUltimo» manda sobre la autodetección.
                pedida = costo_pedido
                real_t = _elegir(cols_t, pedida) if pedida else None
                elegida = real_t or cand
                # La clave del JOIN tiene que existir en LAS DOS fuentes. Si la
                # tabla de costo no tiene el mismo ArticuloID, no se une: un
                # JOIN por otra cosa emparejaría filas equivocadas sin avisar.
                if elegida and c_id and not _elegir(cols_t, c_id):
                    _log(f'🔴 {TABLA_COSTO_DEF} no tiene la columna «{c_id}», '
                         f'que es la clave para unirla con la vista. No se trae '
                         f'el costo: emparejar por otro campo daría costos de '
                         f'productos equivocados.', 'ERROR')
                    elegida = None
                if elegida:
                    col_costo   = elegida
                    tabla_costo = TABLA_COSTO_DEF
                    if real_t:
                        _log(f'💰 El costo NO está en la vista «{tabla}». Se lee '
                             f'de [{TABLA_COSTO_DEF}].[{elegida}] uniendo por '
                             f'ArticuloID. El precio sigue saliendo de la vista '
                             f'(con ITBIS): cada dato de donde es correcto.',
                             'INFO')
                    else:
                        _log(f'💰 El costo NO está en la vista «{tabla}» ni con '
                             f'el nombre configurado. Se lee de '
                             f'[{TABLA_COSTO_DEF}].[{elegida}] ({motivo}), '
                             f'uniendo por ArticuloID. Revisa en «Ver columnas» '
                             f'que sea la que quieres.', 'WARN')

                    # ── 🔴 AVISO DE COLUMNA DE COSTO AMBIGUA ──
                    #
                    # dbSIC guarda VARIOS costos por artículo y NO valen lo
                    # mismo. Caso real medido por el usuario en «AGUA SABOR
                    # NARANJA COOL HEAVEN 500ml»: el programa muestra
                    # «Ultimo costo: 17.81» y el listado traía 16.72, porque
                    # la configuración guardada apuntaba a CostoPromedio (el
                    # promedio ponderado de las compras) en vez de CostoUltimo
                    # (lo que se pagó la última vez). Las dos columnas existen y
                    # las dos son «el costo»: nada en el SQL puede distinguir
                    # cuál quiere el usuario, así que se le dice cuál se usó y
                    # cuál es la otra, en vez de dejarlo adivinando por qué las
                    # cifras no cuadran con la pantalla del programa.
                    otras = [c['nombre'] for c in cols_t
                             if c['nombre'].lower() in _CANDIDATAS_COSTO
                             and c['nombre'].lower() != elegida.lower()]
                    if otras:
                        _log(f'⚠️ Esa tabla tiene MÁS de una columna de costo: '
                             f'se está usando «{elegida}» y también existe '
                             f'{", ".join(chr(171) + o + chr(187) for o in otras)}. '
                             f'Si el costo del listado no coincide con el que '
                             f'ves en el programa, es por esto: en dbSIC '
                             f'«Ultimo costo» = CostoUltimo y el promedio '
                             f'ponderado de las compras = CostoPromedio. '
                             f'Cámbialo en el campo «Columna de costo» del '
                             f'panel y vuelve a generar el listado.', 'WARN')

        if not col_costo:
            _log(f'🔴 No se encontró ninguna columna de costo, ni en «{tabla}» '
                 f'ni en dbo.TinvArticulos. El listado sale con costo en 0 y '
                 f'SIN filtro de costo (solo se descartan los nombres sin '
                 f'letras). Usa «Ver columnas» y escribe el nombre a mano.',
                 'ERROR')

        # El JOIN necesita ArticuloID en las DOS fuentes. Sin él no hay forma
        # fiable de emparejar filas, así que se avisa y se renuncia al costo en
        # vez de emparejar por nombre, que daría cruces equivocados en silencio.
        if tabla_costo and not c_id:
            _log(f'🔴 «{tabla}» no expone ArticuloID, así que no se puede unir '
                 f'con {tabla_costo} para traer el costo. Listado con costo 0.',
                 'ERROR')
            col_costo, tabla_costo = '', ''

        if not c_nombre:
            raise RuntimeError(f'No se encontró columna de nombre en {tabla}.')

        # SELECT armado solo con nombres verificados contra INFORMATION_SCHEMA.
        # Se cualifica cada columna con el alias de su fuente (v = vista/tabla
        # principal, c = tabla de costo) porque con el JOIN puede haber nombres
        # repetidos en las dos y SQL Server respondería «Ambiguous column name».
        seleccion = []
        def add(alias, columna, fuente='v'):
            seleccion.append(f'{fuente}.[{columna}] AS [{alias}]' if columna
                             else f'NULL AS [{alias}]')
        add('id', c_id)
        add('nombre', c_nombre)
        add('codigo', c_codigo)
        add('costo', col_costo, 'c' if tabla_costo else 'v')
        add('precio', c_precio)
        add('existencia', c_stock)
        add('unidad', c_unidad)
        add('departamento', c_depto)

        # ── 🔴 RED DE SEGURIDAD ANTES DE MANDAR EL SELECT ──
        #
        # Existe porque el bug que rompió el listado fue exactamente esto: una
        # columna que no existía se colaba en el SELECT y SQL Server contestaba
        # «Invalid column name», tirando la tarea entera. Un error de una línea
        # dejó al usuario sin listado, cuando el peor caso aceptable era un
        # costo en 0.
        #
        # Aquí se comprueba cada columna contra las columnas REALES de su propia
        # fuente. Si alguna falla, se anula solo ESE campo y se sigue: perder
        # una columna es molesto, perder el listado completo es inaceptable.
        cols_costo = _columnas_de(conn, tabla_costo) if tabla_costo else []
        for alias, nombre_col, fuente in (
                ('id', c_id, 'v'), ('nombre', c_nombre, 'v'),
                ('codigo', c_codigo, 'v'), ('precio', c_precio, 'v'),
                ('existencia', c_stock, 'v'), ('unidad', c_unidad, 'v'),
                ('departamento', c_depto, 'v'),
                ('costo', col_costo, 'c' if tabla_costo else 'v')):
            if not nombre_col:
                continue
            disponibles = cols_costo if fuente == 'c' else cols
            if not _elegir(disponibles, nombre_col):
                origen = tabla_costo if fuente == 'c' else tabla
                _log(f'🔴 La columna «{nombre_col}» ({alias}) no existe en '
                     f'«{origen}». Se omite ese dato en vez de tumbar el '
                     f'listado completo.', 'ERROR')
                if alias == 'costo':
                    col_costo, tabla_costo = '', ''
                    seleccion[3] = 'NULL AS [costo]'
                else:
                    raise RuntimeError(
                        f'La columna «{nombre_col}» ({alias}) no existe en '
                        f'«{origen}». Usa «Ver columnas» para revisarlo.')

        esq, tab = _partir_tabla(tabla)
        desde = f'[{esq}].[{tab}] AS v'
        if tabla_costo:
            esq_c, tab_c = _partir_tabla(tabla_costo)
            # LEFT JOIN: ningún artículo de la vista se pierde por no estar en
            # la tabla de costo. ISNULL se aplica luego en Python con _num().
            desde += (f' LEFT JOIN [{esq_c}].[{tab_c}] AS c '
                      f'ON c.[{c_id}] = v.[{c_id}]')

        cur = conn.cursor()
        cur.execute(f"SELECT {', '.join(seleccion)} FROM {desde} "
                    f"ORDER BY v.[{c_nombre}]")

        productos = []
        omitidos  = {'sin descripción': 0, 'costo <= 1': 0}
        ejemplos  = []
        codigo_de_id = 0     # cuántas filas tuvieron que caer en ArticuloID
        for r in cur.fetchall():
            nombre = (str(r.nombre).strip() if r.nombre else '')
            costo  = _num(r.costo)

            # Filtro de basura. Si no hay columna de costo no se puede exigir
            # el costo, así que solo se valida el nombre.
            motivo = _descartar(nombre, costo, exigir_costo=bool(col_costo))
            if motivo:
                omitidos[motivo] = omitidos.get(motivo, 0) + 1
                if len(ejemplos) < 5:
                    ejemplos.append(f'{nombre or "(vacío)"} → {motivo}')
                continue

            precio = _num(r.precio)
            margen = round((precio - costo) / precio * 100, 1) if precio else 0.0

            # ── 🔴 EL CÓDIGO SALE SIEMPRE ──
            #
            # El usuario lo pidió explícitamente: «que el código salga sí o sí,
            # no importa si es compatible con los estándares de código de barras
            # o no». Muchos artículos de peso, empaque o servicio (BANDEJA DOBLE
            # TRANSPARENTE PEQUEÑA, por ejemplo) tienen NoReferencia vacío.
            #
            # El respaldo es ArticuloID, y no es una elección al azar: en dbSIC
            # el «Artículo ID» ES el código del artículo. Comprobado en la ficha
            # del programa que envió el usuario, donde «Artículo ID» y
            # «Referencia» muestran el MISMO valor: 7461063097148.
            #
            # ⚠️ Diferencia importante con la cadena de reserva que rompió el
            # precio: allí el fallback publicaba OTRA TARIFA fingiendo ser la
            # buena, en silencio. Aquí no se finge nada — se cuenta cuántas
            # filas usaron el respaldo y se avisa en el log, porque un código
            # sacado de ArticuloID puede NO ser el barcode que usa la web.
            cod = str(r.codigo).strip() if r.codigo else ''
            if not cod:
                cod = str(r.id).strip() if r.id is not None else ''
                if cod:
                    codigo_de_id += 1

            productos.append({
                'id':           str(r.id).strip() if r.id is not None else '',
                'codigo':       cod,
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
    finally:
        conn.close()

    total_omitidos = sum(omitidos.values())
    if total_omitidos:
        _log(f'🧹 Omitidos {total_omitidos:,} artículos: '
             f'{omitidos.get("sin descripción", 0):,} sin descripción, '
             f'{omitidos.get("costo <= 1", 0):,} con costo menor o igual a 1.',
             'INFO')
        for e in ejemplos:
            _log(f'   · {e}', 'INFO')
    if not col_costo:
        _log('⚠️ Sin columna de costo no se puede filtrar por costo; solo se '
             'omitieron los artículos sin descripción.', 'WARN')

    if not productos:
        raise RuntimeError(
            'Después de filtrar no quedó ningún producto. Revisa que la '
            'columna de costo sea la correcta: si apuntas a una columna que '
            'está en 0 para todo el catálogo, el filtro «costo <= 1» descarta '
            'absolutamente todo.')

    _log(f'📊 Precio leído de [{tabla}].[{c_precio}] — la MISMA fuente que usa '
         f'el sync de la web, así que el listado y el admin deben coincidir.',
         'INFO')
    _log(f'🏷️ Código de barras leído de [{c_codigo}] '
         f'(NoReferencia ↔ products.barcode).', 'INFO')

    # Cuántos productos usaron ArticuloID como código, y cuántos siguen sin
    # ninguno. NO se descarta a nadie: el sync sí los excluye de la web, pero
    # aquí el objetivo es consultar costos y precios, y esconder un producto que
    # el usuario sí vende sería peor que mostrarlo sin código.
    if codigo_de_id:
        _log(f'🏷️ {codigo_de_id:,} productos no tenían NoReferencia: se usó su '
             f'ArticuloID como código, tal como se pidió (que el código salga '
             f'siempre). Aviso honesto: esos códigos son el ID interno del '
             f'artículo, así que pueden NO ser el código de barras que la web '
             f'usa para buscar. Los otros sí lo son.', 'WARN')

    sin_codigo = sum(1 for p in productos if not p['codigo'])
    if sin_codigo:
        _log(f'ℹ️ {sin_codigo:,} productos no tienen ni NoReferencia ni '
             f'ArticuloID: salen con la columna Código vacía. No se descartan.',
             'INFO')
    else:
        _log('✅ Todos los productos del listado llevan código.', 'INFO')
    _avisar_si_precio_sospechoso(productos, tabla)

    return productos, tabla, col_costo


# ══════════════════════════════════════════════════════════════════════════════
#  DETECTOR DE PRECIO SIN ITBIS
# ══════════════════════════════════════════════════════════════════════════════
#
# Este chequeo nace de un fallo real: el listado se estaba generando desde
# dbo.TinvArticulos mientras el sync leía dbo.vInvArticulos. Las dos tienen
# «PrecioP», pero la tabla lo guarda SIN ITBIS y la vista lo devuelve con el
# impuesto ya aplicado, así que ChatGPT respondía precios ~15% por debajo.
#
# El síntoma es reconocible: si los precios son «raros» (16.95, 67.80, 254.24)
# pero al multiplicarlos por 1.18 salen cifras de mostrador redondas (20, 80,
# 300), lo que se está leyendo es el precio base sin impuesto.
ITBIS = 1.18


def _es_redondo(n):
    """Múltiplo de 5, que es como se fijan los precios de mostrador."""
    return abs(n - round(n)) < 0.02 and round(n) % 5 == 0


def _avisar_si_precio_sospechoso(productos, tabla):
    """
    Avisa en el log si los precios parecen estar SIN ITBIS.

    No corrige nada por su cuenta: aplicar un 18% a ciegas sería peor que el
    fallo original. Solo avisa, y dice exactamente qué revisar.
    """
    muestra = [p['precio'] for p in productos[:400] if p['precio'] > 0]
    if len(muestra) < 20:
        return

    candidatos = [v for v in muestra if not _es_redondo(v)]
    if len(candidatos) < 10:
        return

    cuadran = sum(1 for v in candidatos if _es_redondo(v * ITBIS))
    pct = cuadran * 100 // len(candidatos)

    if pct >= 70:
        _log(f'🔴 ATENCIÓN: {pct}% de los precios de «{tabla}» dan una cifra '
             f'redonda al multiplicarlos por {ITBIS} ({cuadran} de '
             f'{len(candidatos)} revisados). Eso indica que esta fuente guarda '
             f'el precio SIN ITBIS, y el listado NO va a coincidir con el '
             f'admin. Lee de dbo.vInvArticulos, que es la que usa el sync.',
             'ERROR')
    else:
        _log(f'✅ Los precios no parecen estar sin ITBIS (solo {pct}% de '
             f'coincidencias sospechosas).', 'INFO')


def _clave(p):
    """
    Identidad estable de un producto entre una actualización y la siguiente.

    Se prefiere el ArticuloID porque el código de barras puede cambiar o venir
    repetido (en Supabase ya hay barcodes duplicados, como el 705329002420).
    Si no hay id, se cae al código y, en último caso, al nombre normalizado.
    """
    return (p.get('id') or '').strip() \
        or (p.get('codigo') or '').strip() \
        or p.get('busqueda', '')


def _comparar(previos, actuales):
    """
    Compara dos listados y devuelve qué cambió.

    Esto es lo que convierte el botón en algo útil: no basta con reescribir el
    archivo, hay que poder ver si a un producto le subió el costo.
    """
    antes = {_clave(p): p for p in previos}
    ahora = {_clave(p): p for p in actuales}

    cambios = {'nuevos': [], 'costo': [], 'precio': [], 'eliminados': []}

    for k, p in ahora.items():
        viejo = antes.get(k)
        if viejo is None:
            cambios['nuevos'].append(p)
            continue
        if _num(viejo.get('costo')) != _num(p.get('costo')):
            cambios['costo'].append({
                'nombre': p['nombre'], 'codigo': p.get('codigo', ''),
                'antes':  _num(viejo.get('costo')), 'ahora': _num(p.get('costo')),
            })
        if _num(viejo.get('precio')) != _num(p.get('precio')):
            cambios['precio'].append({
                'nombre': p['nombre'], 'codigo': p.get('codigo', ''),
                'antes':  _num(viejo.get('precio')), 'ahora': _num(p.get('precio')),
            })

    for k, p in antes.items():
        if k not in ahora:
            cambios['eliminados'].append(p)

    return cambios


# ── Qué columnas lleva el CSV ──────────────────────────────────────────────
#
# El usuario pidió el código de barras a la IZQUIERDA de la descripción, así
# que el modo simple pasa de 3 a 4 columnas:
#
#     Codigo | Descripcion | Costo | Precio
#
# El código es `NoReferencia`, el MISMO campo que el sync mapea a
# products.barcode, para que se pueda buscar un producto en el listado con el
# código que aparece en la web y en el admin.
#
# Se mantienen los dos modos porque no son para lo mismo:
#   · simple   → lo que el usuario lee. 4 columnas, nada de ruido.
#   · completo → lo que necesita el plugin (existencia, margen, ArticuloID…).
#
# El JSON SIEMPRE lleva todos los campos: es el que van a consumir los agentes
# de IA, y recortarlo ahí solo les quitaría información sin ganar nada, porque
# ese archivo no lo lee una persona.
_CAMPOS_SIMPLE   = ['codigo', 'nombre', 'costo', 'precio']
_CAMPOS_COMPLETO = ['codigo', 'nombre', 'costo', 'precio', 'ganancia',
                    'margen_pct', 'existencia', 'unidad', 'departamento', 'id']

_TITULOS_CSV = {
    'nombre':       'Descripcion',
    'costo':        'Costo',
    'precio':       'Precio',
    'codigo':       'Codigo',
    'ganancia':     'Ganancia',
    'margen_pct':   'Margen %',
    'existencia':   'Existencia',
    'unidad':       'Unidad',
    'departamento': 'Departamento',
    'id':           'ArticuloID',
}


def _modo_csv(cfg, opciones=None):
    """Devuelve 'simple' o 'completo'. Por defecto simple, que es lo pedido."""
    valor = (opciones or {}).get('formato') or cfg.get('export_formato') or 'simple'
    return 'completo' if str(valor).lower().startswith('comp') else 'simple'


def _escribir_csv(ruta, productos, modo):
    """
    Escribe el CSV de costos y precios.

    Una sola función para el export y para la actualización: si fueran dos,
    un día darían archivos con columnas distintas y no se sabría cuál creer.

    Se usa utf-8-sig (BOM) para que Excel en Windows muestre bien los acentos;
    sin el BOM, "Maní" aparece como "ManÃ­".

    🔴 El código de barras se escribe con un tabulador delante. Suena raro,
    pero es necesario: un EAN de 13 dígitos como 7503002936740 lo interpreta
    Excel como número y lo convierte a «7.503E+12», destruyendo el código a la
    vista. Con el tabulador delante lo trata como texto y lo muestra completo.
    El tabulador no molesta a ChatGPT ni al plugin (se limpia con un strip),
    mientras que un código convertido a notación científica sería inservible.
    """
    campos = _CAMPOS_SIMPLE if modo == 'simple' else _CAMPOS_COMPLETO
    with open(ruta, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow([_TITULOS_CSV.get(c, c) for c in campos])
        for p in productos:
            fila = []
            for c in campos:
                v = p.get(c, '')
                if c == 'codigo' and v:
                    v = '\t' + str(v)     # fuerza texto en Excel
                fila.append(v)
            w.writerow(fila)
    return len(campos)


def _escribir_md(ruta, parte, n, total_partes, total_prod, sello, modo):
    """
    Escribe una parte del catálogo en Markdown.

    En modo simple salen Código, Descripción, Costo y Precio. El código va a la
    izquierda, como pidió el usuario, y es `NoReferencia` — el mismo campo que
    el sync usa como barcode en la web.
    """
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write('# Costos y precios — Supermercado Casa Mota\n\n')
        f.write(f'Actualizado: {sello}  \n')
        f.write('Moneda: pesos dominicanos (RD$)  \n')
        f.write('El «Código» es el código de barras del producto '
                '(mismo que en la web y el admin)  \n')
        f.write(f'Parte {n} de {total_partes} — {len(parte)} productos '
                f'de {total_prod}\n\n')

        if modo == 'simple':
            f.write('| Código | Descripción | Costo | Precio |\n')
            f.write('|---|---|---:|---:|\n')
            for p in parte:
                seguro = p['nombre'].replace('|', '/')
                f.write(f"| {p['codigo']} | {seguro} | "
                        f"{p['costo']:.2f} | {p['precio']:.2f} |\n")
        else:
            f.write('| Código | Producto | Costo | Precio | Ganancia | '
                    'Margen | Existencia |\n')
            f.write('|---|---|---:|---:|---:|---:|---:|\n')
            for p in parte:
                seguro = p['nombre'].replace('|', '/')
                f.write(f"| {p['codigo']} | {seguro} | "
                        f"{p['costo']:.2f} | {p['precio']:.2f} | "
                        f"{p['ganancia']:.2f} | {p['margen_pct']:.1f}% | "
                        f"{p['existencia']:.0f} |\n")


def _leer_json_previo(ruta):
    """Lee el listado anterior. Si no existe o está dañado, devuelve []."""
    if not os.path.isfile(ruta):
        return []
    try:
        with open(ruta, 'r', encoding='utf-8') as f:
            datos = json.load(f)
        return datos.get('productos', []) if isinstance(datos, dict) else []
    except Exception as e:
        _log(f'⚠️ No se pudo leer el listado anterior ({e}). Se tratará como '
             f'la primera vez.', 'WARN')
        return []


def _tarea_export(opciones):
    cfg = _cfg()
    archivos = []
    try:
        _set_estado(corriendo=True, tarea='export', ok=None, error='',
                    archivos=[], paso='Conectando…', cancelar=False)

        _set_estado(paso='Leyendo productos…')
        productos, tabla, col_costo = _leer_catalogo(cfg, opciones)

        carpeta = os.path.join(_carpeta_local(cfg), 'para-chatgpt')
        ok, msg = _asegurar_carpeta(carpeta)
        if not ok:
            raise RuntimeError(msg)

        sello_txt = datetime.now().strftime('%Y-%m-%d %H:%M')
        _set_estado(paso='Escribiendo archivos…')

        # ── 1) CSV — el formato que ChatGPT lee mejor para buscar cifras ──
        modo     = _modo_csv(cfg, opciones)
        ruta_csv = os.path.join(carpeta, 'costos-y-precios.csv')
        n_cols   = _escribir_csv(ruta_csv, productos, modo)
        _log(f'📄 CSV en modo «{modo}»: {n_cols} columnas '
             f'({"Descripción, Costo, Precio" if modo == "simple" else "todas"}).',
             'INFO')
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
                'codigo':       'Código de barras del producto (columna '
                                'NoReferencia de SQL Server, el mismo valor '
                                'que products.barcode en la web)',
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
            _escribir_md(ruta_md, parte, n, len(partes), len(productos),
                         sello_txt, modo)
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
                '     "Que productos vendo por debajo del costo"\n'
                '     "Que producto tiene el codigo 7503002936740"\n\n'
                'SOBRE LA COLUMNA CODIGO:\n'
                '  Es el codigo de barras (NoReferencia en SQL Server, el\n'
                '  mismo que barcode en la web). Va con un tabulador delante\n'
                '  para que Excel no lo convierta en 7.503E+12.\n\n'
                'SI EL ARCHIVO ES MUY GRANDE:\n'
                '  Adjunta los archivos catalogo-parte-XX.md por separado.\n\n'
                'PARA EL PLUGIN QUE VAN A CONSTRUIR LOS AGENTES DE IA:\n'
                '  Usen costos-y-precios.json. Trae el campo "busqueda" ya\n'
                '  normalizado (minusculas, sin acentos) y una llave\n'
                '  "como_buscar" que explica el algoritmo de coincidencia.\n\n'
                'MANTENERLO AL DIA:\n'
                '  NO hace falta volver a exportar todo. Usa el boton\n'
                '  "Actualizar listado de precios y costos" del panel: reescribe\n'
                '  estos MISMOS archivos, en esta MISMA carpeta, y ademas te\n'
                '  dice que costos y precios cambiaron desde la ultima vez.\n'
                '  Las rutas nunca cambian, asi que el plugin puede apuntar\n'
                '  siempre al mismo sitio.\n\n'
                'IMPORTANTE:\n'
                '  Estos archivos son una FOTO del momento indicado arriba.\n'
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

    finally:
        if _estado.get('corriendo'):
            _set_estado(corriendo=False, paso='Interrumpido')
            _log('⚠️ La exportación terminó de forma inesperada. Estado '
                 'liberado.', 'WARN')


@bp_respaldo.route('/api/respaldo/exportar', methods=['POST'])
def respaldo_exportar():
    if _estado['corriendo']:
        return jsonify({'ok': False, 'msg': '⚠️ Ya hay un proceso en curso.'})
    opciones = request.get_json(silent=True) or {}
    threading.Thread(target=_tarea_export, args=(opciones,), daemon=True).start()
    return jsonify({'ok': True, 'msg': 'Exportación iniciada.'})


# ══════════════════════════════════════════════════════════════════════════════
#  TAREA 4 — ACTUALIZAR EL LISTADO (sin volver a generarlo todo)
# ══════════════════════════════════════════════════════════════════════════════
#
#  Diferencia con «Exportar»:
#
#    Exportar  → crea la carpeta y TODOS los formatos (CSV, JSON, Markdown
#                partido, instrucciones). Se hace UNA VEZ.
#
#    Actualizar → vuelve a leer SQL Server y reescribe los MISMOS archivos en
#                 la MISMA ruta, sin renombrar nada. Además compara con el
#                 listado anterior y dice qué costos y precios cambiaron.
#
#  Que la ruta no cambie es lo importante para el plugin: puede apuntar
#  siempre a costos-y-precios.json y encontrarlo al día.
# ══════════════════════════════════════════════════════════════════════════════

def _tarea_actualizar(opciones=None):
    cfg = _cfg()
    opciones = opciones or {}
    try:
        _set_estado(corriendo=True, tarea='actualizar', ok=None, error='',
                    archivos=[], paso='Conectando…', cambios=None,
                    cancelar=False)

        carpeta   = os.path.join(_carpeta_local(cfg), 'para-chatgpt')
        ruta_json = os.path.join(carpeta, 'costos-y-precios.json')
        ruta_csv  = os.path.join(carpeta, 'costos-y-precios.csv')

        if not os.path.isfile(ruta_json):
            raise RuntimeError(
                'Todavía no existe el listado. Pulsa primero «Exportar costos '
                'y precios para ChatGPT» para crearlo, y a partir de ahí usa '
                'este botón para mantenerlo al día.')

        # 1) Lo que había
        previos = _leer_json_previo(ruta_json)

        # 2) Lo que hay ahora — misma función que usa el export, así que es
        #    imposible que los dos caminos den resultados distintos.
        _set_estado(paso='Leyendo precios y costos actuales…')
        productos, tabla, col_costo = _leer_catalogo(cfg, opciones)

        # 3) Qué cambió
        _set_estado(paso='Comparando con el listado anterior…')
        cambios = _comparar(previos, productos)
        n_costo = len(cambios['costo'])
        n_prec  = len(cambios['precio'])
        n_nuev  = len(cambios['nuevos'])
        n_elim  = len(cambios['eliminados'])
        total_c = n_costo + n_prec + n_nuev + n_elim

        sello_txt = datetime.now().strftime('%Y-%m-%d %H:%M')

        # 4) Reescribir SIEMPRE, incluso sin cambios: así la fecha del archivo
        #    refleja cuándo se comprobó de verdad, y no queda la duda de si el
        #    listado está viejo o solo es que nada cambió.
        _set_estado(paso='Reescribiendo el listado…')

        modo = _modo_csv(cfg, opciones)
        _escribir_csv(ruta_csv, productos, modo)

        # Se conserva la metadata del archivo anterior (campos, como_buscar…)
        # y solo se refrescan los datos: si el export original documentaba algo
        # para el plugin, actualizar no debe borrárselo.
        paquete = {}
        try:
            with open(ruta_json, 'r', encoding='utf-8') as f:
                anterior = json.load(f)
            if isinstance(anterior, dict):
                paquete = {k: v for k, v in anterior.items() if k != 'productos'}
        except Exception:
            paquete = {}

        paquete.update({
            'negocio':       paquete.get('negocio', 'Supermercado Casa Mota'),
            'generado':      sello_txt,
            'base_datos':    cfg.get('database', 'dbSIC'),
            'tabla_origen':  tabla,
            'columna_costo': col_costo or '(no encontrada)',
            'moneda':        paquete.get('moneda', 'DOP'),
            'total':         len(productos),
            'ultima_actualizacion': {
                'fecha':            sello_txt,
                'cambios_de_costo':  n_costo,
                'cambios_de_precio': n_prec,
                'productos_nuevos':  n_nuev,
                'productos_quitados': n_elim,
            },
            'productos':     productos,
        })
        with open(ruta_json, 'w', encoding='utf-8') as f:
            json.dump(paquete, f, ensure_ascii=False, indent=1)

        # 5) Rehacer también el Markdown, para que no quede desfasado respecto
        #    al CSV y al JSON. Si no, ChatGPT leería cifras viejas del .md.
        por_parte = 1200
        for viejo in os.listdir(carpeta):
            if viejo.startswith('catalogo') and viejo.endswith('.md'):
                try:
                    os.remove(os.path.join(carpeta, viejo))
                except OSError:
                    pass
        partes = [productos[i:i + por_parte]
                  for i in range(0, len(productos), por_parte)]
        for n, parte in enumerate(partes, 1):
            nom = (f'catalogo-parte-{n:02d}-de-{len(partes):02d}.md'
                   if len(partes) > 1 else 'catalogo.md')
            _escribir_md(os.path.join(carpeta, nom), parte, n, len(partes),
                         len(productos), sello_txt, modo)

        # 6) Historial: un CSV que se va acumulando con cada cambio detectado.
        #    Sirve para responder "¿desde cuándo me subió este costo?", que es
        #    una pregunta que el listado plano no puede contestar.
        if total_c:
            ruta_hist = os.path.join(carpeta, 'historial-de-cambios.csv')
            nuevo = not os.path.isfile(ruta_hist)
            with open(ruta_hist, 'a', newline='', encoding='utf-8-sig') as f:
                w = csv.writer(f)
                if nuevo:
                    w.writerow(['fecha', 'tipo', 'codigo', 'producto',
                                'antes', 'ahora', 'diferencia'])
                for c in cambios['costo']:
                    w.writerow([sello_txt, 'costo', c['codigo'], c['nombre'],
                                c['antes'], c['ahora'],
                                round(c['ahora'] - c['antes'], 2)])
                for c in cambios['precio']:
                    w.writerow([sello_txt, 'precio', c['codigo'], c['nombre'],
                                c['antes'], c['ahora'],
                                round(c['ahora'] - c['antes'], 2)])
                for p in cambios['nuevos']:
                    w.writerow([sello_txt, 'nuevo', p.get('codigo', ''),
                                p['nombre'], '', p['costo'], ''])
                for p in cambios['eliminados']:
                    w.writerow([sello_txt, 'eliminado', p.get('codigo', ''),
                                p['nombre'], p.get('costo', ''), '', ''])

        # ── Resumen en el log ──
        if total_c == 0:
            _log(f'✅ Listado revisado: {len(productos):,} productos, '
                 f'sin ningún cambio desde la última vez.', 'SUCCESS')
        else:
            _log(f'✅ Listado actualizado: {len(productos):,} productos · '
                 f'{n_costo} costos, {n_prec} precios, {n_nuev} nuevos, '
                 f'{n_elim} quitados.', 'SUCCESS')
            for c in cambios['costo'][:15]:
                flecha = '↑' if c['ahora'] > c['antes'] else '↓'
                _log(f"   💵 {flecha} {c['nombre']}: costo "
                     f"{c['antes']:.2f} → {c['ahora']:.2f}", 'INFO')
            if n_costo > 15:
                _log(f'   …y {n_costo - 15} cambios de costo más '
                     f'(ver historial-de-cambios.csv).', 'INFO')
            for c in cambios['precio'][:10]:
                flecha = '↑' if c['ahora'] > c['antes'] else '↓'
                _log(f"   🏷️ {flecha} {c['nombre']}: precio "
                     f"{c['antes']:.2f} → {c['ahora']:.2f}", 'INFO')
            if n_prec > 10:
                _log(f'   …y {n_prec - 10} cambios de precio más '
                     f'(ver historial-de-cambios.csv).', 'INFO')

        _log('📂 Se reescribieron los mismos archivos, en la misma carpeta. '
             'No hay que descargar nada.', 'INFO')

        archivos = []
        for fi in sorted(os.listdir(carpeta)):
            completo = os.path.join(carpeta, fi)
            if os.path.isfile(completo):
                archivos.append({'nombre': fi, 'ruta': completo,
                                 'bytes': os.path.getsize(completo)})

        _set_estado(corriendo=False, ok=True, paso='Listo', archivos=archivos,
                    cambios={
                        'total':      total_c,
                        'costo':      n_costo,
                        'precio':     n_prec,
                        'nuevos':     n_nuev,
                        'eliminados': n_elim,
                        'detalle_costo':  cambios['costo'][:40],
                        'detalle_precio': cambios['precio'][:40],
                    })

    except Exception as e:
        _log(f'❌ Error actualizando el listado: {str(e)[:300]}', 'ERROR')
        _set_estado(corriendo=False, ok=False, error=str(e)[:300], paso='Error')

    finally:
        if _estado.get('corriendo'):
            _set_estado(corriendo=False, paso='Interrumpido')
            _log('⚠️ La actualización terminó de forma inesperada. Estado '
                 'liberado.', 'WARN')


@bp_respaldo.route('/api/respaldo/cancelar', methods=['POST'])
def respaldo_cancelar():
    """
    Pide a la tarea en curso que se detenga en el siguiente punto seguro.

    Solo «Respaldo de datos en CSV» puede abortar a mitad, porque recorre 1,020
    tablas y revisa la bandera entre una y otra. El .bak NO se puede cortar:
    lo ejecuta SQL Server, no este proceso.
    """
    if not _estado.get('corriendo'):
        return jsonify({'ok': False, 'msg': 'No hay ninguna tarea corriendo.'})
    _set_estado(cancelar=True)
    tarea = _estado.get('tarea', '')
    if tarea == 'bak':
        msg = ('El .bak lo ejecuta SQL Server y no se puede cortar desde '
               'aquí. Espera a que termine.')
    else:
        msg = 'Cancelando… se detendrá en unos segundos.'
    _log(f'🛑 Cancelación solicitada ({tarea or "sin tarea"}).', 'WARN')
    return jsonify({'ok': True, 'msg': msg})


@bp_respaldo.route('/api/respaldo/desbloquear', methods=['POST'])
def respaldo_desbloquear():
    """
    Libera el estado a mano cuando el panel se queda diciendo «Ya hay un
    proceso en curso» y no hay ninguno.

    Existe porque pasó de verdad: un .bak que falló dejó «corriendo» en True y
    todos los botones quedaron bloqueados hasta reiniciar el servidor. Ahora
    los `finally` de cada tarea deberían evitarlo, pero este botón es la
    salida de emergencia si vuelve a ocurrir.
    """
    antes = _estado.get('corriendo')
    _set_estado(corriendo=False, tarea='', paso='', ok=None, error='')
    _log('🔓 Estado del módulo de respaldo liberado a mano.'
         if antes else 'ℹ️ No había ningún proceso bloqueado.', 'WARN')
    return jsonify({'ok': True, 'estaba_bloqueado': bool(antes),
                    'msg': ('Desbloqueado. Ya puedes usar los botones.'
                            if antes else 'No había nada bloqueado.')})


@bp_respaldo.route('/api/respaldo/actualizar', methods=['POST'])
def respaldo_actualizar():
    if _estado['corriendo']:
        return jsonify({'ok': False, 'msg': '⚠️ Ya hay un proceso en curso.'})
    opciones = request.get_json(silent=True) or {}
    threading.Thread(target=_tarea_actualizar, args=(opciones,),
                     daemon=True).start()
    return jsonify({'ok': True, 'msg': 'Actualizando listado…'})


@bp_respaldo.route('/api/respaldo/listado', methods=['GET'])
def respaldo_listado():
    """
    Dice si el listado ya existe y de cuándo es. El panel lo usa para mostrar
    la fecha y para saber si habilitar el botón de actualizar.
    """
    carpeta   = os.path.join(_carpeta_local(), 'para-chatgpt')
    ruta_json = os.path.join(carpeta, 'costos-y-precios.json')
    if not os.path.isfile(ruta_json):
        return jsonify({'ok': True, 'existe': False, 'carpeta': carpeta})
    try:
        with open(ruta_json, 'r', encoding='utf-8') as f:
            d = json.load(f)
        return jsonify({
            'ok':       True,
            'existe':   True,
            'carpeta':  carpeta,
            'generado': d.get('generado', ''),
            'total':    d.get('total', 0),
            'columna_costo': d.get('columna_costo', ''),
            'ultima_actualizacion': d.get('ultima_actualizacion'),
        })
    except Exception as e:
        return jsonify({'ok': False, 'existe': True, 'msg': str(e)[:150]})


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
