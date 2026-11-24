/**
 * SUPERMERCADO CASA MOTA — LECTOR DE FACTURAS CON IA (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * Ruta: POST /api/factura-ia · 553 · SOLO Super Admin y Administrador
 *
 * El panel (js/conta.js, «Recepción de mercancía») manda la FOTO de una
 * factura de proveedor; aquí se pasa a un modelo de Groq que lee imágenes y se
 * devuelven las líneas (código, descripción, cantidad, costo) para que el
 * empleado las REVISE y corrija antes de confirmar.
 *
 * 🔴 LA FOTO NO SE GUARDA EN NINGÚN SITIO (decisión del dueño): se recibe, se
 *    reenvía a Groq en la misma petición y se olvida. No se escribe en la base,
 *    ni en un almacén de archivos, ni en el registro (console) del servidor.
 *
 * CONFIGURACIÓN (la misma clave que Maya, sin variables nuevas):
 *   · GROQ_API_KEY ya está en Cloudflare (functions/api/chat.js).
 *   · 553b · La cuenta de Groq del dueño NO ofrece Llama 4 Scout (captura del
 *     20-nov: su lista de «Base Models» es orpheus ×2, llama-prompt-guard ×2,
 *     gpt-oss-120b, gpt-oss-20b, gpt-oss-safeguard-20b, qwen/qwen3.8-27b y
 *     whisper ×2). El ÚNICO candidato a leer fotos es `qwen/qwen3.8-27b`; los
 *     demás son de chat, de seguridad o de audio. Hay que MARCARLO en
 *     Allowed Models en los DOS niveles (organización Y proyecto: el permiso
 *     efectivo es la intersección, ver js/ia-modelos.js).
 *   · No se ha podido comprobar desde aquí que ese modelo acepte imágenes en
 *     Groq. Por eso se prueba una LISTA en orden: si uno está bloqueado o no
 *     admite imágenes, se pasa al siguiente, y si ninguno sirve se dice cuál
 *     falló y por qué (el empleado sigue pudiendo meter las líneas a mano).
 *   · Opcional: GROQ_VISION_MODEL pone primero otro modelo de la lista.
 *
 * QUIÉN PUEDE USARLO (antes de gastar nada en Groq):
 *   Se pregunta a la base `conta_avisos(vale)` (seguridad/111). Esa función
 *   pasa por `_conta_sesion`, que exige vale vivo + empleado activo + rol
 *   superadmin/admin (en el vale Y en `staff`). Así no hace falta otro SQL y
 *   la regla es LA MISMA que la del resto de Contabilidad.
 *     200 → adelante · SIN_PERMISO_CONTABILIDAD → 403 · SESION_* → 401 ·
 *     base caída o sin respuesta → 503 (nunca se llama a Groq sin confirmar).
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/* Supabase: la MISMA dirección y clave pública que js/api.js y chat.js. */
const SB_URL  = 'https://lpnkdlfejsesxozowlda.supabase.co/rest/v1';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo';

/* Modelos que se intentan, EN ESTE ORDEN. El primero es el único que la cuenta
 * del dueño ofrece hoy; los Llama 4 quedan detrás por si Groq los habilita. */
const MODELOS_VISION = [
  'qwen/qwen3.8-27b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
];

/* El modelo que funcionó la última vez se prueba primero (memoria de esta
 * copia del servidor, 30 min). Así no se gasta una llamada fallida cada vez. */
let _modeloBueno = { nombre: '', hasta: 0 };
const MODELO_BUENO_MS = 30 * 60_000;

function ordenModelos(env, ahora = Date.now()) {
  const lista = MODELOS_VISION.slice();
  const subir = m => { const i = lista.indexOf(m); if (i > 0) { lista.splice(i, 1); lista.unshift(m); } };
  if (MODELOS_VISION.includes(env.GROQ_VISION_MODEL)) subir(env.GROQ_VISION_MODEL);
  if (_modeloBueno.nombre && _modeloBueno.hasta > ahora) subir(_modeloBueno.nombre);
  return lista;
}

/* La foto llega ya reducida por el navegador (≈1.800 px, JPEG, < 3,8 MB en
 * base64). Groq admite como máximo 4 MB de imagen en base64. */
const MAX_BODY_BYTES  = 4_500_000;
const MAX_IMAGEN_CHARS = 4_000_000;
const MAX_LINEAS = 300;

const VALE_MIN_LARGO  = 32;
const VALE_TIMEOUT_MS = 6_000;
const GROQ_TIMEOUT_MS = 55_000;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

/* ── ¿Super Admin / Administrador con sesión viva? (seguridad/111) ─────────── */
async function comprobarPermiso(vale) {
  let res;
  try {
    res = await fetch(`${SB_URL}/rpc/conta_avisos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
      body: JSON.stringify({ p_vale: vale }),
      signal: AbortSignal.timeout(VALE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 503, error: 'No se pudo comprobar tu sesión ahora mismo. Vuelve a intentarlo.' };
  }
  if (res.ok) return { ok: true };
  const t = await res.text().catch(() => '');
  if (t.includes('SIN_PERMISO_CONTABILIDAD')) {
    return { ok: false, status: 403, error: 'Leer facturas con IA es solo para Super Admin y Administrador.' };
  }
  if (t.includes('SESION_') || t.includes('CUENTA_DESACTIVADA')) {
    return { ok: false, status: 401, error: 'Tu sesión del panel caducó. Vuelve a entrar.' };
  }
  if (res.status === 404 || t.includes('PGRST202')) {
    return { ok: false, status: 503, error: 'Falta el SQL 111 de Contabilidad en la base.' };
  }
  return { ok: false, status: 503, error: 'No se pudo comprobar tu sesión ahora mismo. Vuelve a intentarlo.' };
}

/* ── Topes de uso (memoria de esta copia del servidor) ────────────────────────
 * La protección de verdad es la sesión; esto solo frena insistencias. */
/* 559 · Una factura de varias páginas = una petición por página (+ reintentos). */
const TOPE = { VENTANA_MS: 60_000, POR_IP: 20, GLOBAL: 40 };
const _ips = new Map();
let _global = { inicio: 0, n: 0 };

function topeIp(ip, ahora = Date.now()) {
  if (_ips.size > 1000) _ips.clear();
  const marcas = (_ips.get(ip) || []).filter(t => t > ahora - TOPE.VENTANA_MS);
  if (marcas.length >= TOPE.POR_IP) {
    _ips.set(ip, marcas);
    return Math.max(1, Math.ceil((marcas[0] + TOPE.VENTANA_MS - ahora) / 1000));
  }
  marcas.push(ahora);
  _ips.set(ip, marcas);
  return 0;
}
function topeGlobal(ahora = Date.now()) {
  if (ahora - _global.inicio > TOPE.VENTANA_MS) _global = { inicio: ahora, n: 0 };
  if (_global.n >= TOPE.GLOBAL) return Math.max(1, Math.ceil((_global.inicio + TOPE.VENTANA_MS - ahora) / 1000));
  _global.n += 1;
  return 0;
}

/* ── Instrucciones para la IA ─────────────────────────────────────────────── */
const PROMPT = `Eres un asistente que transcribe facturas de proveedores de un supermercado de República Dominicana.
Mira la foto y devuelve SOLO un objeto JSON (sin texto antes ni después) con esta forma exacta:
{
  "numero": "número de la factura tal como aparece (o \\"\\" si no se ve)",
  "fecha": "fecha de emisión en formato AAAA-MM-DD (o \\"\\")",
  "ncf": "NCF o e-CF si aparece (ej. B0100000123 o E310000000123), o \\"\\"",
  "subtotal": número con el SUBTOTAL del bloque de totales (antes del ITBIS), o null,
  "descuento": número con el DESCUENTO total del bloque de totales, o null,
  "itbis": número con el ITBIS (impuesto) TOTAL cobrado en la factura, o null,
  "total": número con el TOTAL A PAGAR final de la factura (ya con ITBIS), o null,
  "lineas": [
    { "codigo": "código del artículo o de barras si aparece, o \\"\\"",
      "descripcion": "descripción del artículo tal como está escrita",
      "cantidad": número,
      "costo_unitario": número (precio por unidad),
      "importe": número (total de la línea) }
  ]
}
Reglas:
- Una entrada en "lineas" por cada fila de artículo. NO incluyas filas de subtotal, ITBIS, descuento, total, flete ni notas.
- "costo_unitario" es el precio por unidad tal como sale en la columna de precio, SIN sumarle el ITBIS de la línea.
- TOTALES: casi siempre están al pie de la última página, en un bloque con filas como SUBTOTAL, DESCUENTO, ITBIS (o "ITBIS 18%", "ITBIS 16%", "I.T.B.I.S.", "IMPUESTO", "IMP.") y TOTAL / TOTAL A PAGAR / NETO A PAGAR. Léelo con mucho cuidado, cifra por cifra.
- "itbis" es SOLO el importe del impuesto (no el subtotal ni el total). Si hay varias filas de ITBIS (varias tasas), súmalas. Si la factura dice ITBIS 0 o exento, pon 0.
- Comprueba: normalmente subtotal − descuento + itbis = total. Si no te cuadra, vuelve a leer esas cifras.
- Si esta página NO tiene el bloque de totales (es una página intermedia), pon null en subtotal, descuento, itbis y total. No uses un "subtotal de página" o "van" como total.
- Los números van sin "RD$", sin separador de miles y con punto decimal (1,250.50 → 1250.5). Si la factura usa coma decimal (1.250,50), conviértelo igual.
- Si una línea no muestra el precio por unidad pero sí el importe y la cantidad, pon "costo_unitario": null y rellena "importe".
- Si un dato no se lee con seguridad, pon null (números) o "" (textos). NO inventes datos.
- Las fechas dominicanas suelen venir como DD/MM/AAAA: conviértelas a AAAA-MM-DD.
- Mantén el orden de las líneas de la factura.`;

/* ── Limpieza de lo que devuelve la IA ────────────────────────────────────── */
function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/RD\$|\$|\s/gi, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.250,50
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                               // 12,50
  else s = s.replace(/,/g, '');                                                                // 1,250.50
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function aTexto(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}
function aFecha(v) {
  const s = aTexto(v, 20);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) {
    const d = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
    if (d) m = [null, d[3].length === 2 ? '20' + d[3] : d[3], d[2], d[1]];
  }
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCMonth() !== mo - 1) return '';
  return dt.toISOString().slice(0, 10);
}
const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;

function limpiar(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};
  const lineasIn = Array.isArray(o.lineas) ? o.lineas : (Array.isArray(o.items) ? o.items : []);
  const lineas = [];
  for (const x of lineasIn.slice(0, MAX_LINEAS)) {
    if (!x || typeof x !== 'object') continue;
    const descripcion = aTexto(x.descripcion ?? x.description, 200);
    if (!descripcion) continue;
    let cantidad = aNumero(x.cantidad ?? x.qty);
    let costo = aNumero(x.costo_unitario ?? x.precio ?? x.price);
    const imp = aNumero(x.importe ?? x.total);
    if (cantidad !== null && (cantidad <= 0 || cantidad > 999999)) cantidad = null;
    if ((costo === null || costo < 0) && imp !== null && imp >= 0 && cantidad) costo = imp / cantidad;
    if (costo !== null && (costo < 0 || costo > 99999999)) costo = null;
    lineas.push({
      codigo: aTexto(x.codigo ?? x.code, 40),
      descripcion,
      cantidad: cantidad === null ? null : r3(cantidad),
      costo_unitario: costo === null ? null : r2(costo),
    });
  }
  const monto = (v, cero) => {
    const n = aNumero(v);
    return n !== null && (cero ? n >= 0 : n > 0) && n < 1e9 ? r2(n) : null;
  };
  return {
    numero: aTexto(o.numero, 40),
    fecha: aFecha(o.fecha),
    ncf: aTexto(o.ncf, 20),
    subtotal: monto(o.subtotal, false),
    descuento: monto(o.descuento, true),
    itbis: monto(o.itbis ?? o.impuesto, true),
    total: monto(o.total, false),
    lineas,
  };
}

function sacarJson(texto) {
  /* Los modelos que «razonan» (Qwen) pueden escribir antes <think>…</think>. */
  const t = String(texto || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch { /* sigue */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* nada */ } }
  return null;
}

/* 559 · ¿Cuántos segundos pide Groq esperar? (cabecera retry-after o el texto
 * "Please try again in 1m2.5s"). Se redondea hacia arriba. */
function esperaGroq(res, msg) {
  const h = Number(res.headers.get('retry-after'));
  if (isFinite(h) && h > 0) return Math.ceil(h);
  const m = /try again in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(msg || '');
  if (m && (m[1] || m[2] || m[3])) {
    return Math.max(1, Math.ceil((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)));
  }
  return 0;
}

async function llamarGroq(env, modelo, imagen, conExtras, aviso) {
  const cuerpo = {
    model: modelo,
    temperature: 0,
    max_completion_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT + aviso },
        { type: 'image_url', image_url: { url: imagen } },
      ],
    }],
  };
  if (conExtras) {
    cuerpo.response_format = { type: 'json_object' };
    /* Qwen razona: que no devuelva el razonamiento, solo la respuesta. */
    if (/qwen/i.test(modelo)) cuerpo.reasoning_format = 'hidden';
  }
  return fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
  });
}

/** GET /api/factura-ia — salud: solo dice si está configurado. */
export function onRequestGet(context) {
  const env = context.env || {};
  return json({
    ok: true,
    servicio: 'lector-facturas-casamota',
    configurado: Boolean(env.GROQ_API_KEY),
    modelos: ordenModelos(env),
  });
}

/** POST /api/factura-ia — { imagen: "data:image/jpeg;base64,..." } */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env || !env.GROQ_API_KEY) {
    return json({ ok: false, error: 'Falta GROQ_API_KEY en Cloudflare (la misma clave de Maya).' }, 500);
  }

  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, error: 'Origen no permitido.' }, 403);
  }

  const vale = (request.headers.get('X-CM-Vale') || '').trim();
  if (vale.length < VALE_MIN_LARGO) {
    return json({ ok: false, error: 'Solo para el personal con sesión en el panel.' }, 401);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
  const esperaIp = topeIp(ip);
  if (esperaIp) {
    return json({ ok: false, error: `Demasiadas lecturas seguidas. Espera ${esperaIp} s.`, espera: esperaIp }, 429, { 'Retry-After': String(esperaIp) });
  }

  const permiso = await comprobarPermiso(vale);
  if (!permiso.ok) return json({ ok: false, error: permiso.error }, permiso.status);

  const esperaG = topeGlobal();
  if (esperaG) {
    return json({ ok: false, error: `El lector está ocupado. Prueba en ${esperaG} s.`, espera: esperaG }, 429, { 'Retry-After': String(esperaG) });
  }

  const largo = Number(request.headers.get('Content-Length') || 0);
  if (largo > MAX_BODY_BYTES) return json({ ok: false, error: 'La foto es demasiado grande.' }, 413);
  const texto = await request.text();
  if (texto.length > MAX_BODY_BYTES) return json({ ok: false, error: 'La foto es demasiado grande.' }, 413);

  let body;
  try { body = JSON.parse(texto); } catch { return json({ ok: false, error: 'Petición no válida.' }, 400); }
  const imagen = body && typeof body.imagen === 'string' ? body.imagen : '';
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imagen)) {
    return json({ ok: false, error: 'Falta la foto o no es JPG/PNG/WebP.' }, 400);
  }
  if (imagen.length > MAX_IMAGEN_CHARS) return json({ ok: false, error: 'La foto es demasiado grande.' }, 413);

  /* 559 · Factura de varias páginas: el panel manda una página por petición
   * y dice cuál es; la IA sabe así que puede no haber totales en esta. */
  const de = Number.isInteger(body.de) && body.de > 1 && body.de <= 20 ? body.de : 1;
  const pagina = Number.isInteger(body.pagina) && body.pagina >= 1 && body.pagina <= de ? body.pagina : 1;
  const aviso = de > 1
    ? `\nEsta foto es la PÁGINA ${pagina} DE ${de} de la MISMA factura.` +
      (pagina < de ? ' Probablemente no tiene el bloque de totales: si no lo ves, pon null en subtotal, descuento, itbis y total.' : ' Es la última: el bloque de totales suele estar al pie.')
    : '';

  /* Se prueba cada modelo en orden. Se pasa al siguiente SOLO si este está
   * bloqueado/no existe en la cuenta o no admite imágenes; cualquier otro
   * error (cupo, clave, foto grande) se devuelve tal cual. */
  const fallos = [];
  for (const modelo of ordenModelos(env)) {
    const r = await probarModelo(env, modelo, imagen, aviso);
    if (r.ok) {
      _modeloBueno = { nombre: modelo, hasta: Date.now() + MODELO_BUENO_MS };
      return json({ ok: true, modelo, factura: limpiar(r.crudo) });
    }
    if (!r.siguiente) {
      const extra = r.espera ? { 'Retry-After': String(r.espera) } : {};
      return json({ ok: false, error: r.error, espera: r.espera || 0, diario: !!r.diario }, r.status, extra);
    }
    if (_modeloBueno.nombre === modelo) _modeloBueno = { nombre: '', hasta: 0 };
    fallos.push(`${modelo}: ${r.motivo}`);
  }

  return json({
    ok: false,
    error: 'Ningún modelo de tu cuenta de Groq puede leer fotos ahora mismo (' + fallos.join(' · ') + '). ' +
           'Marca qwen/qwen3.8-27b en console.groq.com → Allowed Models (organización y proyecto). ' +
           'Mientras tanto puedes meter las líneas a mano.',
    fallos,
  }, 502);
}

/* Una lectura con un modelo. Devuelve
 *   { ok: true, crudo }                       → leyó la factura
 *   { ok: false, siguiente: true, motivo }    → este modelo no sirve, probar otro
 *   { ok: false, siguiente: false, status, error } → parar y avisar */
async function probarModelo(env, modelo, imagen, aviso) {
  let res;
  try {
    res = await llamarGroq(env, modelo, imagen, true, aviso);
    /* Si el modelo no acepta el modo JSON o el formato de razonamiento, se
     * repite sin esos extras (el texto se limpia igual). Solo un reintento. */
    if (res.status === 400) {
      const t = await res.clone().text().catch(() => '');
      if (/response_format|reasoning_format|json/i.test(t)) res = await llamarGroq(env, modelo, imagen, false, aviso);
    }
  } catch (e) {
    const tarde = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, siguiente: false, status: 502,
      error: tarde ? 'La IA tardó demasiado. Prueba con una foto más pequeña o más clara.' : 'No se pudo contactar con la IA.' };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = '';
    try { msg = (JSON.parse(t).error || {}).message || ''; } catch { msg = t.slice(0, 200); }
    if (res.status === 401) return { ok: false, siguiente: false, status: 502, error: 'La clave de Groq no es válida.' };
    /* 559 · 429 = límite de Groq. El de POR MINUTO se pasa solo: se devuelve
     * cuánto esperar y el panel reintenta solo con una cuenta atrás. El de
     * POR DÍA no se pasa reintentando: se dice claro. */
    if (res.status === 429) {
      if (/per day|\(TPD\)|\(RPD\)/i.test(msg)) {
        return { ok: false, siguiente: false, status: 429, diario: true,
          error: 'Se acabó el cupo de HOY de la IA en Groq (límite diario). Vuelve a intentarlo mañana o mete las líneas a mano.' };
      }
      const espera = Math.min(120, esperaGroq(res, msg) || 15);
      return { ok: false, siguiente: false, status: 429, espera,
        error: `La IA está ocupada (límite por minuto de Groq). Se puede volver a intentar en ${espera} s.` };
    }
    if (res.status === 413) return { ok: false, siguiente: false, status: 413, error: 'La foto es demasiado grande para la IA.' };
    if (res.status === 403 || res.status === 404 ||
        (/model/i.test(msg) && /(not found|does not exist|not allowed|blocked|permission|access|decommissioned)/i.test(msg))) {
      return { ok: false, siguiente: true, motivo: 'no está activado en tu cuenta' };
    }
    if (res.status === 400 && /(image|vision|multimodal|content.*(type|part)|image_url)/i.test(msg)) {
      return { ok: false, siguiente: true, motivo: 'no admite imágenes' };
    }
    return { ok: false, siguiente: false, status: 502, error: `La IA respondió con un error (${res.status})${msg ? ': ' + msg : ''}.` };
  }

  let datos;
  try { datos = await res.json(); } catch { return { ok: false, siguiente: false, status: 502, error: 'Respuesta de la IA no válida.' }; }
  const contenido = datos && datos.choices && datos.choices[0] && datos.choices[0].message
    ? datos.choices[0].message.content : '';
  const crudo = sacarJson(contenido);
  if (!crudo) {
    return { ok: false, siguiente: false, status: 502,
      error: 'La IA no devolvió las líneas en un formato legible. Prueba otra vez o con una foto más clara.' };
  }
  return { ok: true, crudo };
}

/* 553d · Aquí había `export const _pruebas`, que solo servía para las pruebas.
 * Se quita: en una Pages Function solo deben exportarse los onRequest*, y lo
 * que no se usa se borra (regla del dueño). */
