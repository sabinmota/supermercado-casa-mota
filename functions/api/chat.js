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

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

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

  // 4) Reenviar a Groq con la clave del servidor
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
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return json({ error: 'No se pudo contactar con el servicio de IA' }, 502);
  }
}
