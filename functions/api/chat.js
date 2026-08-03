/**
 * SUPERMERCADO CASA MOTA — PROXY DE IA (Cloudflare Pages Function)
 * ---------------------------------------------------------------
 * Ruta pública: POST /api/chat
 *
 * Reenvía la petición del chat a Groq añadiendo la API key EN EL SERVIDOR.
 * La clave nunca viaja al navegador del cliente.
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
 * LIMITACIÓN DE USO (rate-limiting) — añadido en el build 371:
 *   El proxy protegía la clave, pero no la cuota: cualquiera con la URL podía
 *   quemar los créditos de Groq a base de POSTs. Ahora hay tres topes:
 *     · por IP y minuto        (RL.MAX_POR_IP)
 *     · por IP y minuto, visión (RL.MAX_VISION_POR_IP — el escáner es caro)
 *     · global por minuto      (RL.MAX_GLOBAL — cortafuegos de cuota)
 *   Se responde 429 con cabecera Retry-After.
 *
 *   ⚠️ HONESTIDAD TÉCNICA: el contador vive en la memoria del isolate de
 *   Cloudflare. Los isolates se reciclan y hay varios por región, así que
 *   esto frena ráfagas y bots simples, pero NO es un límite duro global.
 *   Para una garantía real añade en el panel de Cloudflare:
 *     Security → WAF → Rate limiting rules → (la cuota gratuita incluye 1)
 *     Expresión:  (http.request.uri.path eq "/api/chat")
 *     Límite:     20 peticiones / 1 minuto por IP → Block 10 minutos
 *   Esa regla se aplica en el borde, antes de ejecutar este código.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Modelos permitidos — evita que un tercero use tu cuota con modelos caros
const MODELOS_PERMITIDOS = new Set([
  'llama-3.1-8b-instant',                      // chat Maya
  'llama-3.3-70b-versatile',                   // reserva
  'meta-llama/llama-4-scout-17b-16e-instruct', // visión: escáner de códigos
]);

// El escáner envía fotos en base64, por eso el límite es amplio.
// El chat de texto ronda los 10-20 KB.
const MAX_BODY_BYTES  = 6 * 1024 * 1024; // 6 MB
const MAX_TOKENS_TOPE = 400;             // techo de respuesta, por coste

const json = (obj, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });

/* ════════════════════════════════════════════════════════════════════════════
   RATE-LIMITING (ventana deslizante en memoria del isolate)
   ════════════════════════════════════════════════════════════════════════════ */

const RL = {
  VENTANA_MS:        60_000,  // tamaño de la ventana: 1 minuto
  MAX_POR_IP:        15,      // peticiones de chat por IP y minuto
  MAX_VISION_POR_IP: 5,       // peticiones de visión (escáner) por IP y minuto
  MAX_GLOBAL:        150,     // techo total del sitio por minuto
  BLOQUEO_MS:        5 * 60_000, // penalización si se insiste tras el corte
  ABUSOS_PARA_BLOQUEO: 5,     // nº de rechazos seguidos que activan el bloqueo
  MAX_CUBOS:         1000,    // tope de IPs vigiladas antes de podar
};

/** ip -> { chat: number[], vision: number[], abusos: number, bloqueadoHasta: number } */
const _cubos = new Map();
let _global = { inicio: 0, hits: 0 };

/** Elimina cubos inactivos para que el Map no crezca sin control. */
function _podar(ahora) {
  if (_cubos.size < RL.MAX_CUBOS) return;
  const limite = ahora - RL.VENTANA_MS;
  for (const [ip, c] of _cubos) {
    const ultimoChat   = c.chat.length   ? c.chat[c.chat.length - 1]     : 0;
    const ultimaVision = c.vision.length ? c.vision[c.vision.length - 1] : 0;
    if (Math.max(ultimoChat, ultimaVision) < limite && c.bloqueadoHasta < ahora) {
      _cubos.delete(ip);
    }
  }
}

/** Quita de un array las marcas de tiempo fuera de la ventana. */
function _vigentes(marcas, ahora) {
  const limite = ahora - RL.VENTANA_MS;
  while (marcas.length && marcas[0] < limite) marcas.shift();
  return marcas;
}

/**
 * Decide si la petición pasa.
 * @returns {{ok: true, restantes: number} | {ok: false, motivo: string, esperar: number}}
 */
function comprobarLimite(ip, esVision, ahora = Date.now()) {
  // ── Techo global: protege la cuota aunque el ataque venga de muchas IPs ──
  if (ahora - _global.inicio > RL.VENTANA_MS) _global = { inicio: ahora, hits: 0 };
  if (_global.hits >= RL.MAX_GLOBAL) {
    return {
      ok: false,
      motivo: 'global',
      esperar: Math.max(1, Math.ceil((_global.inicio + RL.VENTANA_MS - ahora) / 1000)),
    };
  }

  _podar(ahora);

  let cubo = _cubos.get(ip);
  if (!cubo) {
    cubo = { chat: [], vision: [], abusos: 0, bloqueadoHasta: 0 };
    _cubos.set(ip, cubo);
  }

  // ── ¿IP penalizada por insistir? ──
  if (cubo.bloqueadoHasta > ahora) {
    return {
      ok: false,
      motivo: 'bloqueo',
      esperar: Math.ceil((cubo.bloqueadoHasta - ahora) / 1000),
    };
  }

  const marcas = esVision ? _vigentes(cubo.vision, ahora) : _vigentes(cubo.chat, ahora);
  const tope   = esVision ? RL.MAX_VISION_POR_IP : RL.MAX_POR_IP;

  if (marcas.length >= tope) {
    cubo.abusos += 1;
    if (cubo.abusos >= RL.ABUSOS_PARA_BLOQUEO) {
      cubo.bloqueadoHasta = ahora + RL.BLOQUEO_MS;
      cubo.abusos = 0;
    }
    return {
      ok: false,
      motivo: esVision ? 'vision' : 'chat',
      esperar: Math.max(1, Math.ceil((marcas[0] + RL.VENTANA_MS - ahora) / 1000)),
    };
  }

  marcas.push(ahora);
  cubo.abusos = 0;
  _global.hits += 1;
  return { ok: true, restantes: tope - marcas.length };
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
 * Sirve para verificar el despliegue SIN exponer la clave.
 * Devuelve solo si está configurada o no.
 */
export function onRequestGet(context) {
  return json({
    ok: true,
    servicio: 'proxy-ia-casamota',
    configurado: Boolean(context.env && context.env.GROQ_API_KEY),
  });
}

/** POST /api/chat — reenvío real a Groq */
export async function onRequestPost(context) {
  const { request, env } = context;

  // 1) ¿Está configurada la clave en Cloudflare?
  if (!env || !env.GROQ_API_KEY) {
    return json(
      { error: 'GROQ_API_KEY no configurada en las variables de entorno' },
      500
    );
  }

  // 2) Mismo origen — descarta llamadas desde otras webs
  const origin = request.headers.get('Origin');
  if (origin) {
    const permitido = new URL(request.url).origin;
    if (origin !== permitido) {
      return json({ error: 'Origen no permitido' }, 403);
    }
  }

  // 3) Leer y validar el cuerpo
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

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'Faltan los mensajes' }, 400);
  }
  if (!MODELOS_PERMITIDOS.has(body.model)) {
    return json({ error: `Modelo no permitido: ${body.model}` }, 400);
  }

  // Techo de tokens (el cliente puede pedir menos, nunca más)
  body.max_tokens = Math.min(Number(body.max_tokens) || 200, MAX_TOKENS_TOPE);

  // 4) Límite de uso — protege la CUOTA, no solo la clave
  const esVision = body.model === 'meta-llama/llama-4-scout-17b-16e-instruct';
  const veredicto = comprobarLimite(ipDe(request), esVision);
  if (!veredicto.ok) {
    const mensajes = {
      global:  'El asistente está recibiendo demasiadas consultas ahora mismo. Prueba en un minuto.',
      bloqueo: 'Has superado el límite de consultas varias veces. Espera unos minutos.',
      vision:  'Demasiadas fotos seguidas al escáner. Espera un momento antes de la siguiente.',
      chat:    'Vas muy rápido 😊 Espera unos segundos antes de la siguiente pregunta.',
    };
    return json(
      {
        error:   mensajes[veredicto.motivo] || 'Demasiadas peticiones',
        codigo:  'rate_limited',
        motivo:  veredicto.motivo,
        esperar: veredicto.esperar,
      },
      429,
      { 'Retry-After': String(veredicto.esperar) }
    );
  }

  // 5) Reenviar a Groq con la clave del servidor
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
        'X-RateLimit-Remaining': String(veredicto.restantes),
      },
    });
  } catch (e) {
    return json({ error: 'No se pudo contactar con el servicio de IA' }, 502);
  }
}
