/**
 * SUPERMERCADO CASA MOTA — DIRECCIONES CON GOOGLE MAPS (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * Ruta: POST /api/direccion · 561 · SOLO Super Admin y Administrador
 *
 * Contabilidad → Proveedores → «Dirección»: mientras se escribe, el panel
 * (js/conta.js) pide aquí sugerencias de Google Maps (solo República
 * Dominicana). Al elegir una, se piden los datos del lugar y el panel rellena
 * Dirección, Sector, Ciudad, Provincia y Código postal.
 *
 *   { accion: 'buscar',  texto, sesion } → { ok, sugerencias: [{ id, principal, secundario }] }
 *   { accion: 'detalle', id,    sesion } → { ok, lugar: { direccion, sector, ciudad, provincia, codigo_postal, completa } }
 *
 * 🔴 LA CLAVE DE GOOGLE NUNCA VA EN EL REPOSITORIO NI EN EL CHAT: se guarda en
 *    Cloudflare Pages → Settings → Variables and Secrets como GOOGLE_MAPS_KEY
 *    (tipo Secret). Sin ella, el panel sigue funcionando y la dirección se
 *    escribe a mano como antes.
 *
 * API: Places API (New) de Google — places:autocomplete + Place Details con
 * máscara mínima (addressComponents, formattedAddress). Se usa el mismo
 * «sessionToken» en la búsqueda y en el detalle: así Google cobra la sesión
 * como una sola consulta.
 *
 * QUIÉN PUEDE USARLO: la misma regla que el lector de facturas (factura-ia.js):
 * `conta_avisos(vale)` en la base (seguridad/111) exige vale vivo + empleado
 * activo + rol superadmin/admin. El vale bueno se recuerda 5 min en esta copia
 * del servidor para no preguntar a la base en cada letra.
 */

const PLACES = 'https://places.googleapis.com/v1';

/* Supabase: la MISMA dirección y clave pública que js/api.js y factura-ia.js. */
const SB_URL  = 'https://lpnkdlfejsesxozowlda.supabase.co/rest/v1';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo';

const VALE_MIN_LARGO  = 32;
const VALE_TIMEOUT_MS = 6_000;
const VALE_BUENO_MS   = 5 * 60_000;
const GOOGLE_TIMEOUT_MS = 8_000;
const MAX_BODY = 2_000;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

/* ── ¿Super Admin / Administrador con sesión viva? (seguridad/111) ─────────── */
const _valesBuenos = new Map();   // vale → caduca (ms)

async function comprobarPermiso(vale, ahora = Date.now()) {
  const hasta = _valesBuenos.get(vale);
  if (hasta && hasta > ahora) return { ok: true };
  let res;
  try {
    res = await fetch(`${SB_URL}/rpc/conta_avisos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
      body: JSON.stringify({ p_vale: vale }),
      signal: AbortSignal.timeout(VALE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 503, error: 'No se pudo comprobar tu sesión ahora mismo.' };
  }
  if (res.ok) {
    if (_valesBuenos.size > 500) _valesBuenos.clear();
    _valesBuenos.set(vale, ahora + VALE_BUENO_MS);
    return { ok: true };
  }
  const t = await res.text().catch(() => '');
  if (t.includes('SIN_PERMISO_CONTABILIDAD')) return { ok: false, status: 403, error: 'Solo para Super Admin y Administrador.' };
  if (t.includes('SESION_') || t.includes('CUENTA_DESACTIVADA')) return { ok: false, status: 401, error: 'Tu sesión del panel caducó. Vuelve a entrar.' };
  return { ok: false, status: 503, error: 'No se pudo comprobar tu sesión ahora mismo.' };
}

/* ── Tope de uso (memoria de esta copia): frena insistencias, no es seguridad ─ */
const TOPE = { VENTANA_MS: 60_000, POR_IP: 90 };
const _ips = new Map();
function topeIp(ip, ahora = Date.now()) {
  if (_ips.size > 1000) _ips.clear();
  const marcas = (_ips.get(ip) || []).filter(t => t > ahora - TOPE.VENTANA_MS);
  if (marcas.length >= TOPE.POR_IP) { _ips.set(ip, marcas); return true; }
  marcas.push(ahora);
  _ips.set(ip, marcas);
  return false;
}

/* ── Google ───────────────────────────────────────────────────────────────── */
async function google(env, url, opciones) {
  let res;
  try {
    res = await fetch(url, { ...opciones, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch {
    return { ok: false, status: 502, error: 'Google Maps no respondió. Escribe la dirección a mano.' };
  }
  if (res.ok) return { ok: true, datos: await res.json().catch(() => ({})) };
  const t = await res.text().catch(() => '');
  let msg = '';
  try { msg = (JSON.parse(t).error || {}).message || ''; } catch { msg = t.slice(0, 200); }
  if (res.status === 429) return { ok: false, status: 429, error: 'Google Maps está ocupado. Prueba en unos segundos.' };
  if (res.status === 400 && /api key/i.test(msg)) return { ok: false, status: 503, error: 'La clave GOOGLE_MAPS_KEY no es válida.' };
  if (res.status === 403) {
    return { ok: false, status: 503,
      error: 'Google rechazó la clave: activa «Places API (New)» en Google Cloud y revisa que la clave lo permita.' };
  }
  return { ok: false, status: 502, error: `Google Maps respondió con un error (${res.status}).` };
}

const texto = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

async function buscar(env, entrada, sesion) {
  const r = await google(env, `${PLACES}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY },
    body: JSON.stringify({
      input: entrada,
      includedRegionCodes: ['do'],
      regionCode: 'do',
      languageCode: 'es',
      sessionToken: sesion,
    }),
  });
  if (!r.ok) return r;
  const sugerencias = (Array.isArray(r.datos.suggestions) ? r.datos.suggestions : [])
    .map(s => s && s.placePrediction)
    .filter(p => p && p.placeId)
    .slice(0, 6)
    .map(p => {
      const f = p.structuredFormat || {};
      const todo = texto(p.text && p.text.text, 200);
      return {
        id: texto(p.placeId, 300),
        principal: texto(f.mainText && f.mainText.text, 160) || todo,
        secundario: texto(f.secondaryText && f.secondaryText.text, 200),
      };
    });
  return { ok: true, cuerpo: { ok: true, sugerencias } };
}

/* De los componentes de Google a los campos del proveedor. */
function aCampos(datos) {
  const comps = Array.isArray(datos.addressComponents) ? datos.addressComponents : [];
  const de = (...tipos) => {
    for (const t of tipos) {
      const c = comps.find(x => Array.isArray(x.types) && x.types.includes(t));
      if (c && c.longText) return texto(c.longText, 120);
    }
    return '';
  };
  const completa = texto(datos.formattedAddress, 250);
  const calle = [de('route'), de('street_number')].filter(Boolean).join(' ');
  const edificio = de('premise', 'subpremise');
  let direccion = [calle, edificio].filter(Boolean).join(', ');
  if (!direccion) direccion = texto(completa.split(',')[0], 200);
  const cp = de('postal_code').replace(/\D/g, '');
  return {
    direccion: direccion.slice(0, 200),
    sector: de('sublocality_level_1', 'sublocality', 'neighborhood').slice(0, 80),
    ciudad: de('locality', 'administrative_area_level_2').slice(0, 80),
    provincia: de('administrative_area_level_1'),
    codigo_postal: /^\d{5}$/.test(cp) ? cp : '',
    completa,
  };
}

async function detalle(env, id, sesion) {
  const url = `${PLACES}/places/${encodeURIComponent(id)}?languageCode=es&regionCode=do&sessionToken=${encodeURIComponent(sesion)}`;
  const r = await google(env, url, {
    method: 'GET',
    headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': 'addressComponents,formattedAddress' },
  });
  if (!r.ok) return r;
  return { ok: true, cuerpo: { ok: true, lugar: aCampos(r.datos || {}) } };
}

/** GET /api/direccion — salud: solo dice si está configurado. */
export function onRequestGet(context) {
  const env = context.env || {};
  return json({ ok: true, servicio: 'direcciones-casamota', configurado: Boolean(env.GOOGLE_MAPS_KEY) });
}

/** POST /api/direccion */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env || !env.GOOGLE_MAPS_KEY) {
    return json({ ok: false, sinClave: true,
      error: 'Falta la clave GOOGLE_MAPS_KEY en Cloudflare: las sugerencias de Google Maps están apagadas. Escribe la dirección a mano.' }, 503);
  }

  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'Origen no permitido.' }, 403);

  const vale = (request.headers.get('X-CM-Vale') || '').trim();
  if (vale.length < VALE_MIN_LARGO) return json({ ok: false, error: 'Solo para el personal con sesión en el panel.' }, 401);

  if (topeIp(request.headers.get('CF-Connecting-IP') || 'desconocida')) {
    return json({ ok: false, error: 'Demasiadas búsquedas seguidas. Espera un momento.' }, 429, { 'Retry-After': '20' });
  }

  const crudo = await request.text();
  if (crudo.length > MAX_BODY) return json({ ok: false, error: 'Petición demasiado grande.' }, 413);
  let body;
  try { body = JSON.parse(crudo); } catch { return json({ ok: false, error: 'Petición no válida.' }, 400); }

  const sesion = typeof body.sesion === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.sesion) ? body.sesion : '';
  if (!sesion) return json({ ok: false, error: 'Falta la sesión de búsqueda.' }, 400);

  let r;
  if (body.accion === 'buscar') {
    const entrada = texto(body.texto, 200);
    if (entrada.length < 3) return json({ ok: true, sugerencias: [] });
    const permiso = await comprobarPermiso(vale);
    if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);
    r = await buscar(env, entrada, sesion);
  } else if (body.accion === 'detalle') {
    const id = typeof body.id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(body.id) ? body.id : '';
    if (!id) return json({ ok: false, error: 'Lugar no válido.' }, 400);
    const permiso = await comprobarPermiso(vale);
    if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);
    r = await detalle(env, id, sesion);
  } else {
    return json({ ok: false, error: 'Acción no válida.' }, 400);
  }
  return r.ok ? json(r.cuerpo) : json({ ok: false, error: r.error }, r.status);
}
