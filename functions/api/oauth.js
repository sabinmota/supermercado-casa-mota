/**
 * SUPERMERCADO CASA MOTA — VERIFICACIÓN DE ACCESO CON GOOGLE
 * ----------------------------------------------------------
 * Ruta pública: POST /api/oauth
 *
 * 🔴 EL AGUJERO QUE ESTO CIERRA
 * ─────────────────────────────
 * Hasta el build 420, `login-cliente.html` hacía esto (línea 1045):
 *
 *     // Decodificar el JWT payload (sin verificar firma — solo para extraer
 *     // campos). La verificación real la haría el servidor
 *
 * Ese servidor no existía. El navegador partía el token de Google por los
 * puntos, leía el correo del trozo del medio y `createClientFromOAuth` se lo
 * creía. El trozo del medio de un JWT es Base64, NO está cifrado: cualquiera
 * lo escribe a mano.
 *
 * Traducido: cualquier persona podía abrir la consola del navegador, fabricar
 * un token con el correo de OTRO cliente y entrar como él. Sin contraseña.
 *
 * Y era el caso MAYORITARIO: de los 9 clientes de la tienda, 6 entran con
 * Google. Para esos 6 el correo ERA la credencial, y un correo de Gmail no es
 * un secreto.
 *
 * La firma (el tercer trozo del JWT) es lo único que prueba que el token lo
 * emitió Google de verdad. Verificarla exige la clave pública de Google, y eso
 * solo se puede hacer donde el visitante no manda: aquí.
 *
 * 🔴 POR QUÉ EL VALE SE EMITE AQUÍ Y NO EN EL NAVEGADOR
 * ─────────────────────────────────────────────────────
 * `cliente_abrir_sesion_oauth` está REVOCADA a `anon` a propósito
 * (seguridad/47-vale-cliente.sql) y concedida solo a `service_role`. Si el
 * navegador pudiera llamarla, volveríamos al punto de partida: pediría un vale
 * para el correo que quisiera. Esta función la llama con la llave de servicio,
 * que vive en las variables de entorno de Cloudflare y NUNCA se envía al
 * navegador.
 *
 * CONFIGURACIÓN REQUERIDA (una sola vez, en el panel de Cloudflare):
 *   Pages → supermercado-casa-mota → Settings → Environment variables
 *     SUPABASE_URL           https://XXXX.supabase.co
 *     SUPABASE_SERVICE_KEY   eyJ...  (la llave `service_role`, marcar Encrypt)
 *     GOOGLE_CLIENT_ID       747300144353-...apps.googleusercontent.com
 *   Aplicar a: Production. Después: Deployments → Retry deployment.
 *
 * 🔴 NO escribas la llave de servicio en este archivo: acabaría en GitHub, que
 * es público, y la `service_role` puede leer y escribir TODA la base sin
 * restricción. Es mucho más grave que la `anon`.
 */

/* Claves públicas de Google. Se piden a Google y se guardan en memoria un rato
 * para no consultar en cada acceso. Google las rota, así que no se pueden
 * escribir a mano en el código. */
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CACHE_MS = 60 * 60 * 1000;   // 1 hora
let _certsCache = null;
let _certsAt    = 0;

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status:  estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Base64URL → Uint8Array */
function b64urlABytes(txt) {
  const b64 = txt.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64URL → objeto JSON */
function b64urlAJson(txt) {
  return JSON.parse(new TextDecoder().decode(b64urlABytes(txt)));
}

async function traerCertsGoogle() {
  const ahora = Date.now();
  if (_certsCache && (ahora - _certsAt) < CACHE_MS) return _certsCache;

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error('No se pudieron obtener las claves de Google');
  const datos = await res.json();
  _certsCache = datos.keys || [];
  _certsAt    = ahora;
  return _certsCache;
}

/**
 * Verifica de verdad el token de Google: firma, emisor, destinatario y
 * caducidad. Devuelve el contenido solo si TODO cuadra.
 *
 * 🔴 Las cuatro comprobaciones son necesarias y ninguna sustituye a otra:
 *  · firma        → que lo emitió Google y no un visitante
 *  · `aud`        → que fue emitido PARA esta tienda y no para otra web
 *                   (sin esto, un token válido de cualquier otro sitio que use
 *                   Google entraría aquí)
 *  · `iss`        → que el emisor es accounts.google.com
 *  · `exp`        → que no es un token viejo reutilizado
 */
async function verificarTokenGoogle(idToken, clientId) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new Error('TOKEN_MAL_FORMADO');

  const cabecera = b64urlAJson(partes[0]);
  const cuerpo   = b64urlAJson(partes[1]);

  if (cabecera.alg !== 'RS256') throw new Error('ALGORITMO_NO_ADMITIDO');

  const certs = await traerCertsGoogle();
  const jwk   = certs.find(k => k.kid === cabecera.kid);
  if (!jwk) throw new Error('CLAVE_DESCONOCIDA');

  const clave = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.n ? 'RSA' : jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const firmado = new TextEncoder().encode(partes[0] + '.' + partes[1]);
  const firma   = b64urlABytes(partes[2]);
  const valida  = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', clave, firma, firmado
  );
  if (!valida) throw new Error('FIRMA_INVALIDA');

  const emisoresOk = ['accounts.google.com', 'https://accounts.google.com'];
  if (!emisoresOk.includes(cuerpo.iss)) throw new Error('EMISOR_INVALIDO');

  if (clientId && cuerpo.aud !== clientId) throw new Error('DESTINATARIO_INVALIDO');

  const ahora = Math.floor(Date.now() / 1000);
  if (!cuerpo.exp || cuerpo.exp < ahora - 60) throw new Error('TOKEN_CADUCADO');

  /* Google marca si el correo está confirmado. Un correo sin confirmar no
   * identifica a nadie: no se acepta. */
  if (cuerpo.email_verified === false) throw new Error('CORREO_SIN_CONFIRMAR');
  if (!cuerpo.email) throw new Error('SIN_CORREO');

  return cuerpo;
}

/** GET /api/oauth — comprobación de salud, sin exponer ninguna clave. */
export function onRequestGet(context) {
  const env = context.env || {};
  return json({
    ok: true,
    servicio: 'vale-cliente-casamota',
    configurado: {
      supabase_url:     Boolean(env.SUPABASE_URL),
      service_key:      Boolean(env.SUPABASE_SERVICE_KEY),
      google_client_id: Boolean(env.GOOGLE_CLIENT_ID),
    },
  });
}

/** POST /api/oauth — verifica el token y devuelve la sesión CON vale. */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'El servidor no está configurado todavía. Avisa al supermercado.' }, 500);
  }

  // Mismo origen: descarta llamadas desde otras webs.
  const origin = request.headers.get('Origin');
  if (origin) {
    const permitido = new URL(request.url).origin;
    if (origin !== permitido) return json({ error: 'Origen no permitido' }, 403);
  }

  const texto = await request.text();
  if (texto.length > 8000) return json({ error: 'Petición demasiado grande' }, 413);

  let body;
  try { body = JSON.parse(texto); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  if (!body.credential) return json({ error: 'Falta el token de Google' }, 400);

  let perfil;
  try {
    perfil = await verificarTokenGoogle(body.credential, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    /* El motivo se registra en Cloudflare pero NO se devuelve al navegador:
     * a quien intenta suplantar a alguien no se le explica qué le falló. */
    console.warn('[oauth] token rechazado:', e && e.message);
    return json({ error: 'No pudimos verificar tu cuenta de Google. Intenta de nuevo.' }, 401);
  }

  const url = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/cliente_abrir_sesion_oauth';
  let res, filas;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({
        p_email:  perfil.email,
        p_nombre: perfil.name || '',
        p_avatar: perfil.picture || '',
      }),
    });
    const cuerpo = await res.text();
    if (!res.ok) {
      console.error('[oauth] la base rechazó la sesión:', res.status, cuerpo);
      if (cuerpo.includes('CUENTA_DESACTIVADA')) {
        return json({ error: 'Tu cuenta está desactivada. Contacta al supermercado.' }, 403);
      }
      return json({ error: 'No se pudo abrir tu sesión. Intenta de nuevo.' }, 502);
    }
    filas = JSON.parse(cuerpo);
  } catch (e) {
    console.error('[oauth] fallo al hablar con la base:', e && e.message);
    return json({ error: 'No se pudo conectar. Revisa tu conexión.' }, 502);
  }

  const fila = Array.isArray(filas) ? filas[0] : filas;
  if (!fila || !fila.vale) {
    return json({ error: 'No se pudo abrir tu sesión.' }, 502);
  }

  return json({
    ok: true,
    cliente: {
      id:           fila.id,
      email:        fila.email,
      name:         fila.name,
      phone:        fila.phone   || '',
      address:      fila.address || '',
      city:         fila.city    || '',
      authProvider: 'google',
      avatar:       perfil.picture || '',
    },
    vale:   fila.vale,
    creado: Boolean(fila.creado),
  });
}
