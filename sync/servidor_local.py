"""
╔══════════════════════════════════════════════════════════════════════════════╗
║       SERVIDOR LOCAL — Sync SQL Server → Supabase                          ║
║       Supermercado Casa Mota                                                ║
║                                                                              ║
║  Ejecuta: python servidor_local.py                                          ║
║  Luego abre: http://localhost:5000  en tu navegador                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pyodbc
import requests as req
import json
import os
import logging
import re
import threading
import time

# Costo mínimo para que un artículo se sincronice. Los que tienen 1 o menos se
# consideran «costo no cargado» y quedan fuera. Debe coincidir con
# COSTO_MINIMO de respaldo.py y sync_precios.py.
COSTO_MINIMO_SYNC = 1.0
from datetime import datetime

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    _HAS_SCHEDULER = True
except ImportError:
    _HAS_SCHEDULER = False

app = Flask(__name__, static_folder='.')
CORS(app)

# ── Módulo de respaldo y exportación ──────────────────────────────────────
# Vive en respaldo.py para no engordar este archivo. Se registra abajo, tras
# definir _log y _load_config, porque ese módulo los necesita inyectados
# (importarlos al revés provocaría un import circular).
from respaldo import bp_respaldo, init_respaldo

# ── Archivo de configuración (guardado en disco) ───────────────────────────
CONFIG_FILE = 'sync_config.json'

# ── Supabase (fijo — ya configurado) ──────────────────────────────────────
SB_URL = "https://lpnkdlfejsesxozowlda.supabase.co/rest/v1"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo"
SB_HEADERS = {
    'Content-Type':  'application/json',
    'apikey':        SB_KEY,
    'Authorization': f'Bearer {SB_KEY}',
    'Prefer':        'return=representation',
}

# Headers para operaciones de escritura — requieren x-admin-key para pasar RLS
SB_WRITE_HEADERS = {
    **SB_HEADERS,
    'x-admin-key': 'CM-Admin-X9k3mP19zJ',
}

# ── Log en memoria (para streaming al frontend) ────────────────────────────
_log_lines    = []
_sync_running = False
_cancel_flag  = False   # ← señal de cancelación para el thread de sync

# ── Scheduler de auto-sync ───────────────────────────────────────────────
_scheduler         = None
_schedule_active   = False
_schedule_interval = 0    # segundos
_schedule_next_run = None # datetime

def _log(msg, level='INFO'):
    """Agrega línea al log en memoria y al archivo."""
    ts   = datetime.now().strftime('%H:%M:%S')
    line = {'ts': ts, 'level': level, 'msg': msg}
    _log_lines.append(line)
    # Mantener solo las últimas 500 líneas en memoria
    if len(_log_lines) > 500:
        _log_lines.pop(0)
    # También escribir en archivo
    with open('sync_precios.log', 'a', encoding='utf-8') as f:
        f.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {level:<8}  {msg}\n")


# ══════════════════════════════════════════════════════════════════════════════
#  RUTAS — Archivos estáticos
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    return send_from_directory('.', 'sync_panel.html')


# ══════════════════════════════════════════════════════════════════════════════
#  RUTAS — Config
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/config', methods=['GET'])
def get_config():
    """Devuelve la configuración guardada (sin mostrar la contraseña completa)."""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        # Ocultar contraseña en la respuesta
        safe = {**cfg, 'password': '••••••••' if cfg.get('password') else ''}
        return jsonify({'ok': True, 'config': safe})
    return jsonify({'ok': True, 'config': {}})


@app.route('/api/config', methods=['POST'])
def save_config():
    """Guarda la configuración en disco."""
    data = request.get_json()
    # Si la contraseña viene como '••••••••' (no editada), conservar la anterior
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            prev = json.load(f)
        if data.get('password', '').startswith('•'):
            data['password'] = prev.get('password', '')
        # Fusionar en vez de reemplazar: el panel de SQL Server y el panel de
        # respaldo guardan claves distintas en este mismo archivo, y antes el
        # segundo en guardar borraba los ajustes del primero.
        data = {**prev, **data}
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'ok': True, 'msg': 'Configuración guardada ✅'})


def _load_config():
    """Carga config desde disco."""
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


# ── Activar el módulo de respaldo/exportación ─────────────────────────────
init_respaldo(_log, _load_config)
app.register_blueprint(bp_respaldo)


# ══════════════════════════════════════════════════════════════════════════════
#  RUTAS — Tests de conexión
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/test/sqlserver', methods=['POST'])
def test_sqlserver():
    """Prueba la conexión a SQL Server."""
    data = request.get_json()
    server   = data.get('server',   '').strip()
    port     = data.get('port',     1433)
    database = data.get('database', '').strip()
    user     = data.get('user',     '').strip()
    password = data.get('password', '').strip()

    if not all([server, database, user, password]):
        return jsonify({'ok': False, 'msg': '❌ Completa todos los campos antes de probar.'})

    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server},{port};"
        f"DATABASE={database};"
        f"UID={user};"
        f"PWD={password};"
        f"TrustServerCertificate=yes;"
        f"Encrypt=no;"
        f"Connect Timeout=10;"
    )
    try:
        conn   = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM dbo.vInvArticulos")
        total  = cursor.fetchone()[0]
        conn.close()
        return jsonify({
            'ok':  True,
            'msg': f'✅ Conexión exitosa — {total:,} artículos encontrados en vInvArticulos'
        })
    except pyodbc.Error as e:
        msg = str(e).split('\n')[0][:200]
        return jsonify({'ok': False, 'msg': f'❌ Error SQL Server: {msg}'})
    except Exception as e:
        return jsonify({'ok': False, 'msg': f'❌ Error inesperado: {str(e)[:200]}'})


@app.route('/api/test/supabase', methods=['GET'])
def test_supabase():
    """Prueba la conexión a Supabase."""
    try:
        res = req.get(
            f"{SB_URL}/products?select=id&limit=1",
            headers = SB_HEADERS,
            timeout = 10,
        )
        if res.ok:
            return jsonify({'ok': True,  'msg': '✅ Conexión a Supabase exitosa'})
        else:
            return jsonify({'ok': False, 'msg': f'❌ Supabase respondió {res.status_code}'})
    except Exception as e:
        return jsonify({'ok': False, 'msg': f'❌ Error conectando a Supabase: {str(e)[:150]}'})


# ══════════════════════════════════════════════════════════════════════════════
#  RUTAS — Log
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/log', methods=['GET'])
def get_log():
    """Devuelve las últimas N líneas del log en memoria."""
    since = int(request.args.get('since', 0))
    return jsonify({
        'lines':   _log_lines[since:],
        'total':   len(_log_lines),
        'running': _sync_running,
    })


@app.route('/api/log/clear', methods=['POST'])
def clear_log():
    """Limpia el log en memoria."""
    global _log_lines
    _log_lines = []
    return jsonify({'ok': True})


# ══════════════════════════════════════════════════════════════════════════════
#  LÓGICA DE SINCRONIZACIÓN
# ══════════════════════════════════════════════════════════════════════════════

def _leer_sql(cfg):
    """Lee productos de SQL Server."""
    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={cfg['server']},{cfg.get('port', 1433)};"
        f"DATABASE={cfg['database']};"
        f"UID={cfg['user']};"
        f"PWD={cfg['password']};"
        f"TrustServerCertificate=yes;"
        f"Encrypt=no;"
        f"Connect Timeout=15;"
    )
    conn   = pyodbc.connect(conn_str)
    cursor = conn.cursor()

    # ¿Existe la columna de costo en ESTA vista? Se comprueba antes de pedirla:
    # vInvArticulos es una vista y no tiene por qué exponer las mismas columnas
    # que la tabla TinvArticulos. Pedir a ciegas una columna inexistente
    # rompería el sync completo con «Invalid column name».
    col_costo = (cfg.get('export_costo_col') or 'CostoPromedio').strip()
    if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', col_costo):
        col_costo = 'CostoPromedio'          # evita inyección por config
    cursor.execute("""
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'vInvArticulos'
          AND COLUMN_NAME = ?
    """, col_costo)
    hay_costo = (cursor.fetchone()[0] or 0) > 0

    if hay_costo:
        sel_costo   = f"ISNULL([{col_costo}], 0) AS Costo"
        filtro_cost = f"AND ISNULL([{col_costo}], 0) > {COSTO_MINIMO_SYNC}"
    else:
        sel_costo   = "CAST(NULL AS decimal(18,2)) AS Costo"
        filtro_cost = ""
        _log(f'⚠️ La vista dbo.vInvArticulos no tiene la columna «{col_costo}». '
             f'Se sincroniza filtrando solo por descripción, sin filtro de '
             f'costo.', 'WARN')

    # PATINDEX exige DOS letras seguidas: descarta '.', '..', ',', '---' y
    # '123', pero deja pasar 'Pan', 'Té' y 'A-1 Salsa'.
    cursor.execute(f"""
        SELECT
            ArticuloID,
            LTRIM(RTRIM(Nombre))       AS Nombre,
            LTRIM(RTRIM(NoReferencia)) AS NoReferencia,
            ISNULL(PrecioP,    0)      AS PrecioP,
            ISNULL(ExistGlobal,0)      AS ExistGlobal,
            {sel_costo}
        FROM dbo.vInvArticulos
        WHERE NoReferencia IS NOT NULL
          AND LTRIM(RTRIM(NoReferencia)) <> ''
          AND Nombre IS NOT NULL
          AND PATINDEX('%[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]%',
                       LTRIM(RTRIM(Nombre))) > 0
          {filtro_cost}
        ORDER BY NoReferencia
    """)
    rows = cursor.fetchall()
    cols = [c[0] for c in cursor.description]
    conn.close()
    _log(f'📦 Leídos {len(rows):,} artículos de SQL Server '
         f'(omitidos: sin descripción'
         + (f', costo <= {COSTO_MINIMO_SYNC:g}' if hay_costo else '') + ').',
         'INFO')
    return [dict(zip(cols, r)) for r in rows]


def _leer_supabase():
    """Descarga products de Supabase → dict barcode→{id,price,stock,name}."""
    sb_map  = {}
    page    = 0
    psize   = 1000
    while True:
        res = req.get(
            f"{SB_URL}/products",
            headers = {**SB_HEADERS, 'Range': f'{page*psize}-{page*psize+psize-1}'},
            params  = {'select': 'id,barcode,price,stock,name', 'deleted': 'is.false'},
            timeout = 20,
        )
        if res.status_code == 416: break
        if not res.ok:
            raise RuntimeError(f"Supabase GET error {res.status_code}: {res.text[:150]}")
        batch = res.json()
        if not isinstance(batch, list) or not batch: break
        for p in batch:
            bc = (p.get('barcode') or '').strip()
            if bc:
                sb_map[bc] = p
        if len(batch) < psize: break
        page += 1
    return sb_map


def _run_sync(campos, solo_existentes):
    """Corre la sincronización en un thread separado."""
    global _sync_running, _cancel_flag
    _sync_running = True
    _cancel_flag  = False
    inicio = datetime.now()

    try:
        _log('═' * 55)
        _log(f'🚀 Iniciando sincronización — {inicio.strftime("%Y-%m-%d %H:%M:%S")}')
        _log(f'   Campos a sincronizar: {", ".join(campos)}')
        _log('═' * 55)

        cfg = _load_config()
        if not cfg:
            _log('❌ No hay configuración guardada. Guarda los datos primero.', 'ERROR')
            return

        # ── Leer SQL Server ──────────────────────────────────────────────────
        _log('🔌 Conectando a SQL Server…')
        try:
            sql_prods = _leer_sql(cfg)
        except Exception as e:
            _log(f'❌ Error SQL Server: {str(e)[:200]}', 'ERROR')
            return
        _log(f'📦 Productos leídos de SQL Server: {len(sql_prods):,}')

        # ── Verificar cancelación antes de leer Supabase ─────────────────────
        if _cancel_flag:
            _log('⛔ Cancelado antes de conectar a Supabase.', 'WARN')
            return

        # ── Leer Supabase ────────────────────────────────────────────────────
        _log('☁️  Leyendo productos de Supabase…')
        try:
            sb_map = _leer_supabase()
        except Exception as e:
            _log(f'❌ Error Supabase: {str(e)[:200]}', 'ERROR')
            return
        _log(f'🗄️  Productos en Supabase (con barcode): {len(sb_map):,}')
        _log('─' * 55)

        # ── Comparar y actualizar ────────────────────────────────────────────
        actualizados   = 0
        sin_cambios    = 0
        no_encontrados = 0
        errores        = 0
        total          = len(sql_prods)

        for i, prod in enumerate(sql_prods):

            # ── Chequear cancelación cada 50 productos ───────────────────────
            if _cancel_flag:
                duracion = (datetime.now() - inicio).total_seconds()
                _log('─' * 55, 'WARN')
                _log(f'⛔ Sincronización CANCELADA por el usuario en producto {i:,}/{total:,}', 'WARN')
                _log(f'   ✏️  Actualizados hasta ahora: {actualizados:,}', 'WARN')
                _log(f'   ✅ Sin cambios hasta ahora  : {sin_cambios:,}', 'WARN')
                _log(f'   ⏱️  Tiempo transcurrido      : {duracion:.1f}s', 'WARN')
                _log('─' * 55, 'WARN')
                return

            barcode = prod['NoReferencia']
            sb_prod = sb_map.get(barcode)

            if sb_prod is None:
                no_encontrados += 1
                continue

            payload = {}

            if 'price' in campos:
                nuevo = round(float(prod['PrecioP']), 2)
                if round(float(sb_prod.get('price') or 0), 2) != nuevo:
                    payload['price'] = nuevo

            if 'stock' in campos:
                nuevo = int(prod['ExistGlobal'])
                if int(sb_prod.get('stock') or 0) != nuevo:
                    payload['stock'] = nuevo

            if 'name' in campos:
                nuevo = prod['Nombre'].strip()
                if (sb_prod.get('name') or '').strip() != nuevo:
                    payload['name'] = nuevo

            if not payload:
                sin_cambios += 1
                continue

            try:
                res = req.patch(
                    f"{SB_URL}/products?id=eq.{sb_prod['id']}",
                    headers = SB_WRITE_HEADERS,
                    data    = json.dumps(payload),
                    timeout = 15,
                )
                if not res.ok:
                    raise RuntimeError(f"{res.status_code}: {res.text[:100]}")
                actualizados += 1
                cambios = ', '.join(f'{k}={v}' for k, v in payload.items())
                art_id = prod.get('ArticuloID', '?')
                _log(f'  ✏️  [{art_id}]  {prod["Nombre"][:35]:<37}  {cambios}')
            except Exception as e:
                errores += 1
                _log(f'  ⚠️  Error en {barcode}: {str(e)[:100]}', 'WARN')

        # ── Resumen ──────────────────────────────────────────────────────────
        duracion = (datetime.now() - inicio).total_seconds()
        _log('═' * 55)
        _log('📊 RESUMEN FINAL')
        _log(f'   ✏️  Actualizados   : {actualizados:,}')
        _log(f'   ✅ Sin cambios     : {sin_cambios:,}')
        _log(f'   🔍 No encontrados  : {no_encontrados:,}  (barcode no existe en Supabase)')
        _log(f'   ❌ Errores         : {errores:,}')
        _log(f'   ⏱️  Duración        : {duracion:.1f} segundos')
        _log('═' * 55)

        if errores == 0:
            _log('🎉 Sincronización completada sin errores', 'SUCCESS')
        else:
            _log(f'⚠️  Completada con {errores} error(es)', 'WARN')

    except Exception as e:
        _log(f'💥 Error crítico: {str(e)[:300]}', 'ERROR')
    finally:
        _sync_running = False
        _cancel_flag  = False


@app.route('/api/sync/start', methods=['POST'])
def start_sync():
    """Inicia la sincronización en background."""
    global _sync_running
    if _sync_running:
        return jsonify({'ok': False, 'msg': '⚠️ Ya hay una sincronización en curso.'})

    data   = request.get_json() or {}
    campos = data.get('campos', ['price', 'stock', 'name'])
    solo   = data.get('solo_existentes', True)

    t = threading.Thread(target=_run_sync, args=(campos, solo), daemon=True)
    t.start()
    return jsonify({'ok': True, 'msg': 'Sincronización iniciada ✅'})


@app.route('/api/sync/status', methods=['GET'])
def sync_status():
    nxt = _schedule_next_run.strftime('%H:%M:%S') if _schedule_next_run else None
    return jsonify({
        'running':          _sync_running,
        'schedule_active':  _schedule_active,
        'schedule_interval': _schedule_interval,
        'next_run':         nxt,
    })


@app.route('/api/sync/cancel', methods=['POST'])
def cancel_sync():
    """Señala al thread de sync que debe detenerse en la próxima iteración."""
    global _cancel_flag
    if not _sync_running:
        return jsonify({'ok': False, 'msg': 'No hay ninguna sincronización en curso.'})
    _cancel_flag = True
    _log('⛔ Señal de cancelación recibida — deteniendo en próxima iteración…', 'WARN')
    return jsonify({'ok': True, 'msg': 'Señal de cancelación enviada al proceso de sync.'})


# ── Auto-sync programado (APScheduler) ───────────────────────────────────────
def _auto_sync_job():
    """Función que ejecuta el scheduler automático."""
    global _schedule_next_run
    if _sync_running:
        _log('⏰ Auto-sync omitido — ya hay una sincronización en curso.', 'WARN')
    else:
        cfg = _load_config()
        campos = []
        if cfg.get('autosync_price', True):  campos.append('price')
        if cfg.get('autosync_stock', False): campos.append('stock')
        if not campos: campos = ['price']
        _log(f'⏰ Auto-sync automático iniciado por scheduler (cada {_schedule_interval//60} min)', 'INFO')
        t = threading.Thread(target=_run_sync, args=(campos, True), daemon=True)
        t.start()
    # Actualizar próxima ejecución
    if _scheduler:
        job = _scheduler.get_job('auto_sync')
        if job and job.next_run_time:
            _schedule_next_run = job.next_run_time.replace(tzinfo=None)


@app.route('/api/sync/schedule', methods=['POST'])
def set_schedule():
    """Activa o desactiva el scheduler de auto-sync."""
    global _scheduler, _schedule_active, _schedule_interval, _schedule_next_run

    if not _HAS_SCHEDULER:
        return jsonify({
            'ok':  False,
            'msg': '⚠️ APScheduler no está instalado. Ejecuta: pip install apscheduler'
        })

    data     = request.get_json() or {}
    enabled  = data.get('enabled', False)
    interval = int(data.get('interval_seconds', 1800))  # default 30 min

    # Guardar preferencia en config
    cfg = _load_config()
    cfg['autosync_enabled']  = enabled
    cfg['autosync_interval'] = interval
    cfg['autosync_price']    = data.get('sync_price', True)
    cfg['autosync_stock']    = data.get('sync_stock', False)
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    # Parar scheduler anterior si existe
    if _scheduler and _scheduler.running:
        try: _scheduler.remove_job('auto_sync')
        except: pass

    if not enabled:
        _schedule_active   = False
        _schedule_interval = 0
        _schedule_next_run = None
        _log('⏹️ Auto-sync programado desactivado.', 'INFO')
        return jsonify({'ok': True, 'msg': 'Auto-sync desactivado.'})

    # Crear o reutilizar scheduler
    if _scheduler is None or not _scheduler.running:
        _scheduler = BackgroundScheduler()
        _scheduler.start()

    _scheduler.add_job(
        _auto_sync_job,
        trigger   = 'interval',
        seconds   = interval,
        id        = 'auto_sync',
        replace_existing = True,
    )

    _schedule_active   = True
    _schedule_interval = interval
    _schedule_next_run = None
    # Primera ejecución inmediata aparte
    job = _scheduler.get_job('auto_sync')
    if job and job.next_run_time:
        _schedule_next_run = job.next_run_time.replace(tzinfo=None)

    mins = interval // 60 if interval >= 60 else interval
    unit = 'minutos' if interval >= 60 else 'segundos'
    _log(f'⏰ Auto-sync programado activado: cada {mins} {unit}.', 'SUCCESS')
    return jsonify({'ok': True, 'msg': f'Auto-sync activado cada {mins} {unit}.'})


# ══════════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print()
    print('╔══════════════════════════════════════════════╗')
    print('║   🛒  Sync Panel — Supermercado Casa Mota    ║')
    print('╠══════════════════════════════════════════════╣')
    print('║                                              ║')
    print('║   Abre tu navegador en:                     ║')
    print('║   👉  http://localhost:5000                  ║')
    print('║                                              ║')
    print('║   Presiona Ctrl+C para detener              ║')
    print('╚══════════════════════════════════════════════╝')
    print()
    app.run(host='127.0.0.1', port=5000, debug=False)
