/**
 * SUPERMERCADO CASA MOTA — PROXY DE IA (Cloudflare Pages Function)
 * ---------------------------------------------------------------
 * Ruta: POST /api/chat · SOLO PARA EL PERSONAL CON SESIÓN EN EL PANEL (533)
 *
 * Reenvía la petición de Maya (el asistente del panel) a Groq añadiendo la API
 * key EN EL SERVIDOR. La clave nunca viaja al navegador.
 *
 * CONFIGURACIÓN REQUERIDA (una sola vez, en el panel de Cloudflare):
 *   Pages → supermercado-casa-mota → Settings → Environment variables
 *   Variable:  GROQ_API_KEY
 *   Valor:     gsk_...   (marcar como "Encrypt")
 *   Aplicar a: Production (y Preview si quieres probar en ramas)
 *   Después: Deployments → Retry deployment, para que tome la variable.
 *
 * NO escribas la clave en este archivo: acabaría en GitHub.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔒 533 · SOLO RESPONDE AL PERSONAL CON SESIÓN EN EL PANEL
 * ════════════════════════════════════════════════════════════════════════════
 * Antes respondía a cualquiera que conociera la dirección: con un programa se
 * podía gastar la cuota de Groq de la tienda. Los topes por minuto de abajo no
 * lo impedían (viven en la memoria de cada copia del servidor, y Cloudflare
 * ejecuta varias a la vez).
 *
 * Ahora cada petición trae el vale de sesión del panel en la cabecera
 * `X-CM-Vale` (lo pone js/chat.js) y, ANTES de llamar a Groq, se pregunta a la
 * base `admin_vale_vigente(vale)` (seguridad/106). La base responde solo
 * true/false: vale vivo de un empleado activo. Sin vale, con un vale caducado,
 * o si la base no contesta → no se llama a Groq y no se gasta nada.
 *
 * La tienda ya no usa este servicio: Maya se quitó en el build 361 y el paso
 * de IA del escáner en el 533 (en esta cuenta de Groq no hay modelos que lean
 * fotos). Por eso tampoco se admiten imágenes.
 *
 * Un vale comprobado se recuerda 60 s en esta copia del servidor, para no
 * preguntar a la base en cada mensaje. Consecuencia conocida: al cerrar sesión,
 * ese vale aún podría usarse unos segundos más aquí. No da acceso a nada más.
 * ════════════════════════════════════════════════════════════════════════════
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/* Supabase: la MISMA dirección y la MISMA clave pública que js/api.js (esa
 * clave ya se publica en la web y solo abre lo que las funciones permiten).
 * Si algún día cambia el proyecto de Supabase, hay que cambiarla en LOS DOS
 * sitios. */
const SB_URL  = 'https://lpnkdlfejsesxozowlda.supabase.co/rest/v1';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo';

/* Modelos permitidos — evita que se use la cuota con modelos caros.
 *
 * 🔴 BUILD 414 · ESTA LISTA HAY QUE MANTENERLA A MANO, EN PAREJA CON
 * js/ia-modelos.js (IA_MODELOS_TEXTO). Este fichero corre en el servidor y no
 * puede importar un script del navegador. Si se añade un modelo, hay que
 * tocar LOS DOS SITIOS o el proxy devolverá «Modelo no permitido: …».
 *
 * Que un modelo esté aquí NO significa que funcione: la última palabra la
 * tiene «Allowed Models» en console.groq.com, donde hay que MARCAR SU CASILLA. */
const MODELOS_PERMITIDOS = new Set([
  'openai/gpt-oss-20b',   // principal (Maya y descripciones)
  'openai/gpt-oss-120b',  // respaldo
  'qwen/qwen3.6-27b',     // segundo respaldo
  'groq/compound-mini',   // último recurso
  'groq/compound',
]);

/* Maya manda texto: su contexto ronda los 10-30 KB. 1 MB es un techo de
 * sobra. (Antes eran 6 MB porque el escáner mandaba fotos; ya no.) */
const MAX_BODY_BYTES = 1024 * 1024;

/* 🔴 BUILD 414 · Los `openai/gpt-oss-*` son modelos de RAZONAMIENTO: gastan
 * tokens «pensando» antes de escribir, y ese gasto sale del mismo
 * `max_tokens`. Con un techo bajo, Groq devuelve 200 OK con el texto VACÍO.
 * 1024 sigue siendo un techo real contra abusos (una respuesta de Maya son
 * ~200 tokens visibles) y solo se paga lo que de verdad se gasta. */
const MAX_TOKENS_TOPE = 1024;

const json = (obj, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });

/* ════════════════════════════════════════════════════════════════════════════
   SESIÓN DEL PANEL (seguridad/106)
   ════════════════════════════════════════════════════════════════════════════ */

const VALE_MIN_LARGO  = 32;        // los vales reales tienen 32+ caracteres
const VALE_CACHE_MS   = 60_000;    // un vale comprobado se recuerda 60 s
const VALE_TIMEOUT_MS = 5_000;     // si la base no contesta en 5 s, no se entra
const VALE_MAX_CACHE  = 500;

/** vale -> instante (ms) hasta el que se da por bueno sin volver a preguntar */
const _valesOk = new Map();

/**
 * ¿El vale es de un empleado activo con sesión viva?
 * Solo se recuerdan los SÍ. Ante cualquier duda (sin red, error, respuesta
 * rara) la respuesta es NO: nunca se llama a Groq sin confirmar la sesión.
 * @returns {Promise<{ok: true} | {ok: false, motivo: 'sesion'|'no_verificable'|'falta_sql'}>}
 */
async function comprobarVale(vale, ahora = Date.now()) {
  const hasta = _valesOk.get(vale);
  if (hasta && hasta > ahora) return { ok: true };
  if (hasta) _valesOk.delete(vale);

  let res;
  try {
    res = await fetch(`${SB_URL}/rpc/admin_vale_vigente`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:          SB_ANON,
        Authorization:   `Bearer ${SB_ANON}`,
      },
      body:   JSON.stringify({ p_vale: vale }),
      signal: AbortSignal.timeout(VALE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, motivo: 'no_verificable' };
  }

  // 404 = la función no existe todavía: falta ejecutar seguridad/106
  if (res.status === 404) return { ok: false, motivo: 'falta_sql' };
  if (!res.ok)            return { ok: false, motivo: 'no_verificable' };

  let r;
  try { r = await res.json(); } catch { return { ok: false, motivo: 'no_verificable' }; }

  if (r === true) {
    if (_valesOk.size >= VALE_MAX_CACHE) {
      for (const [v, h] of _valesOk) if (h <= ahora) _valesOk.delete(v);
      if (_valesOk.size >= VALE_MAX_CACHE) _valesOk.clear();
    }
    _valesOk.set(vale, ahora + VALE_CACHE_MS);
    return { ok: true };
  }
  return { ok: false, motivo: 'sesion' };
}

/* ════════════════════════════════════════════════════════════════════════════
   LÍMITE DE USO (ventana deslizante en memoria de esta copia del servidor)
   ════════════════════════════════════════════════════════════════════════════
   Ya no es la protección principal (lo es la sesión), pero se mantiene:
     · por IP: frena a quien insista con vales falsos (cuenta ANTES de
       preguntar a la base, así tampoco se la puede saturar);
     · global: se cuenta solo DESPUÉS de una sesión válida, para que unos
       intentos falsos no le quiten el turno al personal. */

const RL = {
  VENTANA_MS:          60_000,      // 1 minuto
  MAX_POR_IP:          15,          // peticiones por IP y minuto
  MAX_GLOBAL:          150,         // techo total por minuto (sesiones válidas)
  BLOQUEO_MS:          5 * 60_000,  // penalización si se insiste tras el corte
  ABUSOS_PARA_BLOQUEO: 5,           // rechazos seguidos que activan el bloqueo
  MAX_CUBOS:           1000,        // tope de IPs vigiladas antes de podar
};

/** ip -> { marcas: number[], abusos: number, bloqueadoHasta: number } */
const _cubos = new Map();
let _global = { inicio: 0, hits: 0 };

function _podar(ahora) {
  if (_cubos.size < RL.MAX_CUBOS) return;
  const limite = ahora - RL.VENTANA_MS;
  for (const [ip, c] of _cubos) {
    const ultima = c.marcas.length ? c.marcas[c.marcas.length - 1] : 0;
    if (ultima < limite && c.bloqueadoHasta < ahora) _cubos.delete(ip);
  }
}

/** @returns {{ok: true} | {ok: false, motivo: string, esperar: number}} */
function limitePorIp(ip, ahora = Date.now()) {
  _podar(ahora);
  let cubo = _cubos.get(ip);
  if (!cubo) {
    cubo = { marcas: [], abusos: 0, bloqueadoHasta: 0 };
    _cubos.set(ip, cubo);
  }

  if (cubo.bloqueadoHasta > ahora) {
    return { ok: false, motivo: 'bloqueo', esperar: Math.ceil((cubo.bloqueadoHasta - ahora) / 1000) };
  }

  const limite = ahora - RL.VENTANA_MS;
  while (cubo.marcas.length && cubo.marcas[0] < limite) cubo.marcas.shift();

  if (cubo.marcas.length >= RL.MAX_POR_IP) {
    cubo.abusos += 1;
    if (cubo.abusos >= RL.ABUSOS_PARA_BLOQUEO) {
      cubo.bloqueadoHasta = ahora + RL.BLOQUEO_MS;
      cubo.abusos = 0;
    }
    return {
      ok: false,
      motivo: 'chat',
      esperar: Math.max(1, Math.ceil((cubo.marcas[0] + RL.VENTANA_MS - ahora) / 1000)),
    };
  }

  cubo.marcas.push(ahora);
  cubo.abusos = 0;
  return { ok: true, restantes: RL.MAX_POR_IP - cubo.marcas.length };
}

/** @returns {{ok: true} | {ok: false, motivo: 'global', esperar: number}} */
function limiteGlobal(ahora = Date.now()) {
  if (ahora - _global.inicio > RL.VENTANA_MS) _global = { inicio: ahora, hits: 0 };
  if (_global.hits >= RL.MAX_GLOBAL) {
    return {
      ok: false,
      motivo: 'global',
      esperar: Math.max(1, Math.ceil((_global.inicio + RL.VENTANA_MS - ahora) / 1000)),
    };
  }
  _global.hits += 1;
  return { ok: true };
}

const MENSAJES_LIMITE = {
  global:  'El asistente está recibiendo demasiadas consultas ahora mismo. Prueba en un minuto.',
  bloqueo: 'Has superado el límite de consultas varias veces. Espera unos minutos.',
  chat:    'Vas muy rápido 😊 Espera unos segundos antes de la siguiente pregunta.',
};

function respuestaLimite(v) {
  return json(
    {
      error:   MENSAJES_LIMITE[v.motivo] || 'Demasiadas peticiones',
      codigo:  'rate_limited',
      motivo:  v.motivo,
      esperar: v.esperar,
    },
    429,
    { 'Retry-After': String(v.esperar) }
  );
}

/** IP del visitante. En Cloudflare siempre viene CF-Connecting-IP. */
function ipDe(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'desconocida'
  );
}

/**
 * GET /api/chat — comprobación de salud.
 * Solo dice si la clave está configurada; no la expone ni llama a Groq.
 */
export function onRequestGet(context) {
  return json({
    ok: true,
    servicio: 'proxy-ia-casamota',
    configurado: Boolean(context.env && context.env.GROQ_API_KEY),
  });
}

/** POST /api/chat — reenvío real a Groq (solo personal con sesión) */
export async function onRequestPost(context) {
  const { request, env } = context;

  // 1) ¿Está configurada la clave en Cloudflare?
  if (!env || !env.GROQ_API_KEY) {
    return json({ error: 'GROQ_API_KEY no configurada en las variables de entorno' }, 500);
  }

  // 2) Mismo origen — descarta llamadas desde otras webs
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'Origen no permitido' }, 403);
  }

  // 3) Sin vale (o con uno que no puede ser real) → fuera, sin preguntar a nadie
  const vale = (request.headers.get('X-CM-Vale') || '').trim();
  if (vale.length < VALE_MIN_LARGO) {
    return json({ error: 'Solo para el personal con sesión en el panel.', codigo: 'sesion_panel' }, 401);
  }

  // 4) Tope por IP ANTES de consultar la base (frena vales al azar)
  const porIp = limitePorIp(ipDe(request));
  if (!porIp.ok) return respuestaLimite(porIp);

  // 5) ¿Vale vivo de un empleado activo? (seguridad/106)
  const sesion = await comprobarVale(vale);
  if (!sesion.ok) {
    if (sesion.motivo === 'sesion') {
      return json({ error: 'Tu sesión del panel caducó o no es válida.', codigo: 'sesion_panel' }, 401);
    }
    return json({
      error: sesion.motivo === 'falta_sql'
        ? 'No se puede comprobar la sesión: falta ejecutar seguridad/106-vale-panel-para-ia.sql en Supabase.'
        : 'No se pudo comprobar la sesión del panel ahora mismo. Vuelve a intentarlo en un momento.',
      codigo: 'sesion_no_verificable',
    }, 503);
  }

  // 6) Tope global (solo cuentan las sesiones válidas)
  const global = limiteGlobal();
  if (!global.ok) return respuestaLimite(global);

  // 7) Leer y validar el cuerpo
  const texto = await request.text();
  if (texto.length > MAX_BODY_BYTES) {
    return json({ error: 'Petición demasiado grande' }, 413);
  }

  let body;
  try {
    body = JSON.parse(texto);
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'Faltan los mensajes' }, 400);
  }
  if (!MODELOS_PERMITIDOS.has(body.model)) {
    return json({ error: `Modelo no permitido: ${body.model}` }, 400);
  }

  /* 533 · Sin imágenes: nadie las usa ya (el escáner de la tienda dejó de
   * mandarlas) y son las peticiones más caras. Una imagen es un `content` en
   * forma de lista con un elemento `image_url` / `input_image`. */
  const llevaImagen = body.messages.some(m =>
    Array.isArray(m && m.content) &&
    m.content.some(p => p && (p.type === 'image_url' || p.type === 'input_image'))
  );
  if (llevaImagen) {
    return json({ error: 'Este servicio no admite imágenes.' }, 400);
  }

  /* Techo de tokens (se puede pedir menos, nunca más) y SUELO para los
   * modelos que razonan: con menos de 512 se quedan pensando y devuelven
   * texto vacío. */
  const razona = /gpt-oss|qwen3|^groq\/compound/.test(String(body.model || ''));
  let tokens = Math.min(Number(body.max_tokens) || 200, MAX_TOKENS_TOPE);
  if (razona) tokens = Math.max(tokens, 512);
  body.max_tokens = tokens;

  // 8) Reenviar a Groq con la clave del servidor
  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    // Devolver la respuesta tal cual: chat.js ya sabe interpretarla
    const datos = await upstream.text();
    return new Response(datos, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-RateLimit-Remaining': String(porIp.restantes),
      },
    });
  } catch {
    return json({ error: 'No se pudo contactar con el servicio de IA' }, 502);
  }
}
