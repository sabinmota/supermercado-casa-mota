/**
 * SUPERMERCADO CASA MOTA — VERIFICACIÓN DE ACCESO CON GOOGLE Y APPLE
 * -------------------------------------------------------------------
 * Ruta pública: POST /api/oauth
 *
 * Cuerpo:  { credential: "<id_token>", proveedor: "google" | "apple",
 *            nombre: "<solo Apple, primer inicio, NO verificado>" }
 *
 * 🔴 BUILD 442 · SE AÑADIÓ APPLE Y SE CORRIGIÓ UN DEFECTO QUE HABRÍA HECHO
 *    FALLAR EL LOGIN DE LA APP SIN DAR NINGUNA PISTA.
 *    Antes se comparaba el `aud` del token contra UN único Client ID. Pero el
 *    `aud` cambia según de dónde venga el token: el de la app de iOS es
 *    DISTINTO del de la web. O sea que el servidor habría rechazado los tokens
 *    de la app siendo válidos —401 siempre— y el diagnóstico habría tocado
 *    hacerlo desde el Mac, buscando en el código nativo un fallo que estaba
 *    aquí. Ahora se compara contra una LISTA por proveedor (`audsPermitidos`).
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
 * CONFIGURACIÓN REQUERIDA (en el panel de Cloudflare):
 *   Pages → supermercado-casa-mota → Settings → Environment variables
 *
 *   YA EXISTENTES (no tocar):
 *     SUPABASE_URL           https://XXXX.supabase.co
 *     SUPABASE_SERVICE_KEY   eyJ...  (la llave `service_role`, marcar Encrypt)
 *     GOOGLE_CLIENT_ID       747300144353-...apps.googleusercontent.com   ← web
 *
 *   NUEVAS DEL BUILD 442:
 *     GOOGLE_CLIENT_ID_IOS   el Client ID de tipo «iOS» de Google Cloud
 *                            ← SIN ESTO, GOOGLE NO FUNCIONA DENTRO DE LA APP
 *     APPLE_APP_ID           com.casamota.supermercado   ← Apple en el iPhone
 *     APPLE_SERVICE_ID       el Services ID              ← Apple en la web
 *                            (aún no existe; dejar sin poner hasta crearlo)
 *
 *   Aplicar a: Production. Después: Deployments → Retry deployment.
 *
 * 🔴 UNA VARIABLE QUE FALTE NO SE IGNORA: CIERRA LA PUERTA. Una lista de
 *    destinatarios vacía hace que ese proveedor rechace todo acceso, a
 *    propósito. Antes ocurría lo contrario —si faltaba la variable, la
 *    comprobación se DESACTIVABA— y eso habría dejado entrar tokens legítimos
 *    de cualquier otra web que use Google. Un fallo de configuración debe
 *    cerrar, nunca abrir.
 *    Para comprobar qué hay puesto sin exponer valores: GET /api/oauth
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

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD 442 · APPLE · claves públicas, con su propia caché
   ═══════════════════════════════════════════════════════════════════════════
   Apple publica sus claves igual que Google y también las rota, así que
   tampoco se pueden escribir a mano. Se usa una caché SEPARADA de la de
   Google: compartir una sola variable obligaría a distinguir de quién es cada
   clave al buscar por `kid`, y un `kid` de Google no sirve para un token de
   Apple ni al contrario. Dos cachés cuestan cuatro líneas y evitan un fallo
   intermitente imposible de reproducir. */
const APPLE_CERTS_URL = 'https://appleid.apple.com/auth/keys';
let _appleCache = null;
let _appleAt    = 0;

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

async function traerCertsApple() {
  const ahora = Date.now();
  if (_appleCache && (ahora - _appleAt) < CACHE_MS) return _appleCache;

  const res = await fetch(APPLE_CERTS_URL);
  if (!res.ok) throw new Error('No se pudieron obtener las claves de Apple');
  const datos = await res.json();
  _appleCache = datos.keys || [];
  _appleAt    = ahora;
  return _appleCache;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD 442 · DESTINATARIOS ACEPTADOS (`aud`) — EL DEFECTO QUE BLOQUEABA TODO
   ═══════════════════════════════════════════════════════════════════════════

   🔴 LO QUE HABÍA Y POR QUÉ HABRÍA FALLADO EN SILENCIO:

       if (clientId && cuerpo.aud !== clientId) throw new Error('DESTINATARIO_INVALIDO');

   Una sola comparación contra UN solo Client ID. Pero el `aud` de un token
   cambia según DE DÓNDE viene:

     · Google en el navegador  → Client ID de tipo «Aplicación web»
     · Google en la app iOS    → Client ID de tipo «iOS»  ← OTRO valor
     · Apple nativo (iPhone)   → el App ID: com.casamota.supermercado
     · Apple en la web         → el Services ID (aún no existe)

   O sea que, tal cual estaba, el servidor habría **rechazado los tokens de la
   app siendo perfectamente válidos**: un login que compila, se ve bien y
   devuelve 401 SIEMPRE. Y el diagnóstico habría tocado hacerlo desde el Mac,
   pagando horas, buscando en el sitio equivocado — porque el fallo no está en
   el código nativo sino aquí, en una línea del servidor.

   🔴 POR QUÉ NO SE ACEPTA CUALQUIER `aud`, QUE SERÍA LO CÓMODO:
   el `aud` es lo que prueba que el token fue emitido PARA ESTA TIENDA. Sin esa
   comprobación, un token legítimo de CUALQUIER otra web que use Google entraría
   aquí y abriría sesión con el correo de su portador. Por eso se compara contra
   una LISTA CERRADA, y una lista vacía NO se interpreta como «todo vale».

   🔴 LOS VALORES VIENEN DE VARIABLES DE ENTORNO, NO DEL CÓDIGO: así se pueden
   cambiar sin desplegar, y el repositorio (que es público) no publica la
   configuración de la cuenta.
*/
function audsPermitidos(env, proveedor) {
  const lista = [];

  if (proveedor === 'google') {
    // GOOGLE_CLIENT_ID es el que ya existía: se mantiene el nombre para no
    // romper la configuración actual de Cloudflare.
    if (env.GOOGLE_CLIENT_ID)     lista.push(env.GOOGLE_CLIENT_ID);
    if (env.GOOGLE_CLIENT_ID_IOS) lista.push(env.GOOGLE_CLIENT_ID_IOS);
  } else if (proveedor === 'apple') {
    // Apple nativo: el App ID. Apple web: el Services ID.
    if (env.APPLE_APP_ID)     lista.push(env.APPLE_APP_ID);
    if (env.APPLE_SERVICE_ID) lista.push(env.APPLE_SERVICE_ID);
  }

  // Se admiten varios separados por comas, por si algún día hacen falta más
  // (una app de personal, otra plataforma) sin tocar este fichero.
  return lista
    .join(',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
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
async function verificarTokenGoogle(idToken, audsOk) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new Error('TOKEN_MAL_FORMADO');

  const cabecera = b64urlAJson(partes[0]);
  const cuerpo   = b64urlAJson(partes[1]);

  if (cabecera.alg !== 'RS256') throw new Error('ALGORITMO_NO_ADMITIDO');

  const certs = await traerCertsGoogle();
  const jwk   = certs.find(k => k.kid === cabecera.kid);
  if (!jwk) throw new Error('CLAVE_DESCONOCIDA');

  /* 🔴 BUILD 421c · La clave se pasa TAL COMO LA MANDA GOOGLE.
   *
   * Antes yo reconstruía el objeto a mano con `kty: jwk.n ? 'RSA' : jwk.kty`,
   * que es una forma rebuscada de deducir algo que Google ya dice, y de paso
   * descartaba campos que Google incluye (`use`, `kid`). Si `importKey` no
   * traga el objeto reconstruido, lanza — y ese `throw` salía de la función
   * como un 502 con HTML de Cloudflare, sin ninguna pista.
   *
   * Copiar el JWK y sobrescribir solo lo imprescindible es menos listo y más
   * fiable: no hay que acertar qué campos hacen falta. */
  let clave;
  try {
    clave = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, alg: 'RS256', ext: true, key_ops: ['verify'] },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (e) {
    throw new Error('CLAVE_NO_IMPORTABLE: ' + ((e && e.message) || e));
  }

  const firmado = new TextEncoder().encode(partes[0] + '.' + partes[1]);
  const firma   = b64urlABytes(partes[2]);
  const valida  = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', clave, firma, firmado
  );
  if (!valida) throw new Error('FIRMA_INVALIDA');

  const emisoresOk = ['accounts.google.com', 'https://accounts.google.com'];
  if (!emisoresOk.includes(cuerpo.iss)) throw new Error('EMISOR_INVALIDO');

  /* BUILD 442 · se compara contra la LISTA de destinatarios válidos.
   *
   * 🔴 SI LA LISTA VIENE VACÍA SE RECHAZA, no se deja pasar. Antes, con
   *    `if (clientId && …)`, una variable de entorno ausente o mal escrita
   *    DESACTIVABA la comprobación entera sin avisar, y entonces el token de
   *    cualquier otra web que use Google habría entrado aquí. Un fallo de
   *    configuración debe cerrar la puerta, nunca abrirla. */
  if (!audsOk || !audsOk.length) throw new Error('SIN_DESTINATARIOS_CONFIGURADOS');
  if (!audsOk.includes(cuerpo.aud)) throw new Error('DESTINATARIO_INVALIDO');

  const ahora = Math.floor(Date.now() / 1000);
  if (!cuerpo.exp || cuerpo.exp < ahora - 60) throw new Error('TOKEN_CADUCADO');

  /* Google marca si el correo está confirmado. Un correo sin confirmar no
   * identifica a nadie: no se acepta. */
  if (cuerpo.email_verified === false) throw new Error('CORREO_SIN_CONFIRMAR');
  if (!cuerpo.email) throw new Error('SIN_CORREO');

  return cuerpo;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD 442 · VERIFICACIÓN DEL TOKEN DE APPLE
   ═══════════════════════════════════════════════════════════════════════════

   Mismas cuatro comprobaciones que Google y por los mismos motivos: firma
   (que lo emitió Apple), `iss` (que el emisor es appleid.apple.com), `aud`
   (que fue emitido para esta app y no para otra) y `exp` (que no es un token
   viejo reutilizado). Apple usa RS256 igual que Google, así que la mecánica
   criptográfica es idéntica y se reutiliza el mismo `crypto.subtle`.

   🔴 TRES DIFERENCIAS DE APPLE QUE NO SON EVIDENTES Y QUE, SI SE IGNORAN,
      PRODUCEN UN LOGIN QUE FALLA SOLO PARA ALGUNOS CLIENTES:

   1. **Apple manda el correo UNA SOLA VEZ**, en el primerísimo inicio de
      sesión de ese usuario con esta app. En los siguientes, el token puede
      llegar SIN `email`. Un cliente que ya entró una vez y borra la app
      volvería sin correo. Por eso aquí NO se exige `email` de entrada: se
      informa al llamador con `sinCorreo` y se decide arriba, donde se sabe si
      hay un cliente ya creado.

   2. **`email_verified` puede llegar como la CADENA "true"**, no como booleano.
      Apple es inconsistente en esto según el flujo. Comparar con `=== true`
      daría falso para un correo perfectamente verificado.

   3. **El nombre NO viene en el token, nunca.** Apple lo entrega aparte, solo
      en el primer inicio, y en el lado nativo. Así que el nombre llega por
      separado desde el cliente y aquí se trata como dato NO verificado: sirve
      para saludar, no para identificar. Quien identifica es `sub`/`email`.
*/
async function verificarTokenApple(idToken, audsOk) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new Error('TOKEN_MAL_FORMADO');

  const cabecera = b64urlAJson(partes[0]);
  const cuerpo   = b64urlAJson(partes[1]);

  if (cabecera.alg !== 'RS256') throw new Error('ALGORITMO_NO_ADMITIDO');

  const certs = await traerCertsApple();
  const jwk   = certs.find(k => k.kid === cabecera.kid);
  if (!jwk) throw new Error('CLAVE_DESCONOCIDA');

  let clave;
  try {
    // Se copia el JWK tal como lo manda Apple y se sobrescribe lo mínimo, por
    // la misma razón documentada en el verificador de Google (build 421c):
    // reconstruirlo a mano fue lo que produjo un 502 sin ninguna pista.
    clave = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, alg: 'RS256', ext: true, key_ops: ['verify'] },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (e) {
    throw new Error('CLAVE_NO_IMPORTABLE: ' + ((e && e.message) || e));
  }

  const firmado = new TextEncoder().encode(partes[0] + '.' + partes[1]);
  const firma   = b64urlABytes(partes[2]);
  const valida  = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', clave, firma, firmado
  );
  if (!valida) throw new Error('FIRMA_INVALIDA');

  const emisoresOk = ['https://appleid.apple.com', 'appleid.apple.com'];
  if (!emisoresOk.includes(cuerpo.iss)) throw new Error('EMISOR_INVALIDO');

  if (!audsOk || !audsOk.length) throw new Error('SIN_DESTINATARIOS_CONFIGURADOS');
  if (!audsOk.includes(cuerpo.aud)) throw new Error('DESTINATARIO_INVALIDO');

  const ahora = Math.floor(Date.now() / 1000);
  if (!cuerpo.exp || cuerpo.exp < ahora - 60) throw new Error('TOKEN_CADUCADO');

  if (!cuerpo.sub) throw new Error('SIN_IDENTIFICADOR');

  /* Diferencia 2: `email_verified` puede ser booleano o la cadena "true". */
  const verificado = cuerpo.email_verified === true ||
                     cuerpo.email_verified === 'true';
  if (cuerpo.email && !verificado) throw new Error('CORREO_SIN_CONFIRMAR');

  return cuerpo;
}

/** GET /api/oauth — comprobación de salud, sin exponer ninguna clave. */
export function onRequestGet(context) {
  const env = context.env || {};
  /* `build` permite comprobar de un vistazo si el despliegue trae ESTA versión
   * o una anterior en caché. Sin esto, una prueba puede fallar por estar
   * mirando código viejo y se pierde media hora buscando en el sitio erróneo. */
  /* BUILD 442 · se informa de CUÁNTOS destinatarios hay configurados por
   * proveedor, pero NO de sus valores. Así el dueño puede comprobar desde el
   * navegador si falta una variable de entorno —la causa más probable de un
   * 401 tras configurar el login nativo— sin exponer la configuración de la
   * cuenta a quien visite la URL.
   *
   * 🔴 Esto NO es un adorno: sin él, un `aud` mal puesto en Cloudflare se
   *    manifiesta como «no pudimos verificar tu cuenta» en el teléfono, y
   *    averiguar por qué exigiría leer los registros de Cloudflare o volver al
   *    Mac. Con esto se ve en tres segundos desde cualquier navegador. */
  const gAuds = audsPermitidos(env, 'google');
  const aAuds = audsPermitidos(env, 'apple');

  return json({
    ok: true,
    servicio: 'vale-cliente-casamota',
    /* 🔴 SUBIR ESTE NÚMERO EN CADA CAMBIO DEL FICHERO. Es la única forma de
     *    comprobar desde un navegador si el despliegue trae ESTA versión, y
     *    ya evitó un diagnóstico ciego en el build 421c. Si `GET /api/oauth`
     *    devuelve 442, el arreglo de APPLE_SIN_CORREO NO está desplegado. */
    build: '445',
    configurado: {
      supabase_url:     Boolean(env.SUPABASE_URL),
      service_key:      Boolean(env.SUPABASE_SERVICE_KEY),
      google_client_id: Boolean(env.GOOGLE_CLIENT_ID),
      google_ios:       Boolean(env.GOOGLE_CLIENT_ID_IOS),
      apple_app_id:     Boolean(env.APPLE_APP_ID),
      apple_service_id: Boolean(env.APPLE_SERVICE_ID),
    },
    destinatarios: {
      google: gAuds.length,
      apple:  aAuds.length,
    },
    /* Aviso legible: un cero aquí significa que ese proveedor RECHAZARÁ todo
     * intento de acceso, porque una lista vacía cierra la puerta a propósito. */
    avisos: [
      gAuds.length === 0 ? 'Google NO puede funcionar: falta GOOGLE_CLIENT_ID' : null,
      !env.GOOGLE_CLIENT_ID_IOS ? 'Google en la APP no funcionará: falta GOOGLE_CLIENT_ID_IOS' : null,
      aAuds.length === 0 ? 'Apple NO puede funcionar: falta APPLE_APP_ID' : null,
    ].filter(Boolean),
  });
}

/** POST /api/oauth — verifica el token y devuelve la sesión CON vale. */
/* 🔴 ENVOLTORIO QUE IMPIDE QUE UNA CAÍDA SE VUELVA UN 502 CIEGO.
 *
 * Un `throw` sin capturar dentro de una Pages Function NO produce una respuesta
 * mía: produce la página de error HTML de Cloudflare, con un 502 y sin una sola
 * pista. Eso fue exactamente lo que ocurrió en el build 421c — `<!DOCTYPE html>`
 * en la consola donde debía haber JSON.
 *
 * Este envoltorio NO es andamio de depuración y por eso se queda: garantiza que
 * pase lo que pase el navegador reciba JSON con un mensaje entendible, y que el
 * motivo real quede en el registro de Cloudflare, donde solo lo ve el dueño.
 *
 * El detalle del fallo va al registro y NO al navegador: a quien intenta entrar
 * como otra persona no se le explica qué le falló. */
export async function onRequestPost(context) {
  try {
    return await manejarPost(context);
  } catch (e) {
    console.error('[oauth] EXCEPCIÓN NO CAPTURADA:', e && e.stack);
    return json({ error: 'No se pudo verificar tu cuenta. Avisa al supermercado.' }, 500);
  }
}

async function manejarPost(context) {
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

  if (!body.credential) return json({ error: 'Falta el token' }, 400);

  /* BUILD 442 · el proveedor lo dice el cliente, pero NO se le cree sin más:
   * solo sirve para elegir QUÉ claves públicas y QUÉ emisor exigir. Si alguien
   * manda un token de Google diciendo que es de Apple, la verificación de
   * firma o de emisor lo tumba. O sea que este campo no es una credencial:
   * es un enrutador. */
  const proveedor = body.proveedor === 'apple' ? 'apple' : 'google';
  const audsOk    = audsPermitidos(env, proveedor);

  let perfil;
  try {
    perfil = proveedor === 'apple'
      ? await verificarTokenApple(body.credential, audsOk)
      : await verificarTokenGoogle(body.credential, audsOk);
  } catch (e) {
    /* El motivo se registra en Cloudflare pero NO se devuelve al navegador:
     * a quien intenta suplantar a alguien no se le explica qué le falló. */
    console.warn('[oauth] token de ' + proveedor + ' rechazado:', e && e.message);
    const nombre = proveedor === 'apple' ? 'Apple' : 'Google';
    return json({ error: 'No pudimos verificar tu cuenta de ' + nombre + '. Intenta de nuevo.' }, 401);
  }

  /* ── APPLE SIN CORREO · RESUELTO EN EL BUILD 445 ──────────────────────────
   * 🔴 Apple entrega el correo SOLO en la primera autorización de cada Apple
   *    ID. En un SEGUNDO dispositivo, o tras reinstalar, el token llega sin
   *    `email`. Hasta el build 444 esto se rechazaba con 409, porque la tienda
   *    identificaba a sus clientes ÚNICAMENTE por correo.
   *
   * 🔴 POR QUÉ HUBO QUE ARREGLARLO AHORA: un revisor de Apple prueba el botón
   *    si existe. La primera vez entra; en un segundo dispositivo con el mismo
   *    Apple ID veía un ERROR donde debía entrar. Eso no es la directriz 4.2,
   *    es «la app no funciona» → rechazo.
   *
   *    AHORA el `sub` viaja a la base, que lo guarda la primera vez y busca
   *    por él cuando no llega correo (`seguridad/55-apple-sub.sql`). El `sub`
   *    es un identificador ESTABLE emitido por Apple para esta app.
   *
   * 🔴 EL RECHAZO NO DESAPARECE, SE ESTRECHA — y esta distinción es la que
   *    evita reabrir un agujero. Sigue habiendo un caso imposible de atender:
   *    primera vez de un Apple ID en esta tienda Y sin correo (ocurre si el
   *    usuario ya había autorizado la app y revocó el permiso). Sin correo no
   *    se puede crear una ficha utilizable —el panel identifica por correo, y
   *    la recuperación de cuenta también—, y aceptar un correo vacío podría
   *    emparejar con otro registro incompleto y METER A UN CLIENTE EN LA
   *    CUENTA DE OTRO. Ese caso lo rechaza ahora la BASE con el mismo código
   *    `APPLE_SIN_CORREO`, así que el mensaje al cliente no cambia.
   *
   *    Se comprueba en `55-verificar.sql`: E5 entra sin correo con un `sub`
   *    YA CONOCIDO (debe funcionar) y C2 lo intenta con un `sub` NUEVO (debe
   *    rechazarse). Las dos filas son necesarias: sin C2, un arreglo que
   *    aceptara cualquier cosa daría verde en E5 igualmente. */
  if (!perfil.email && proveedor !== 'apple') {
    return json({ error: 'No recibimos tu correo.' }, 400);
  }
  if (!perfil.email) {
    console.warn('[oauth] Apple sin correo · se intentará por sub=' +
                 String(perfil.sub || '').slice(0, 12) + '…');
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
      /* BUILD 442 · el nombre puede venir de dos sitios y NINGUNO es de fiar
       * para identificar:
       *  · Google lo pone en el token (`name`), ya verificado por Google.
       *  · Apple NO lo pone en el token NUNCA. Lo entrega aparte y solo en el
       *    primer inicio, así que llega en `body.nombre` desde el cliente.
       * Por eso se recorta a 80 caracteres y se usa solo para saludar. Quien
       * identifica al cliente es el correo del token verificado, no esto. */
      body: JSON.stringify({
        p_email:  perfil.email || null,
        p_nombre: (perfil.name || body.nombre || '').toString().slice(0, 80).trim(),
        p_avatar: perfil.picture || '',
        /* BUILD 445 · los dos parámetros nuevos.
         *
         * `p_proveedor` corrige un defecto que NADIE HABÍA REPORTADO: la base
         * escribía `authProvider = 'google'` SIEMPRE, también entrando con
         * Apple (medido en el cuerpo de la función: el INSERT llevaba el
         * literal 'google'). El comentario de más abajo decía «ya no está
         * fijado a Google» y era falso a medias: el BUILD 442 arregló esta
         * respuesta JSON pero NO la escritura en la base. Un cliente de Apple
         * veía «google» en su perfil.
         *
         * `p_sub` es lo que permite reconocer al cliente cuando Apple no manda
         * correo. Se manda SIEMPRE que exista, también con Google: cuesta lo
         * mismo y la base decide si lo usa.
         *
         * 🔴 LOS DOS LLEVAN `DEFAULT NULL` EN LA FUNCIÓN, y eso es deliberado:
         *    la base nueva atiende también las llamadas de 3 argumentos de la
         *    versión anterior de este fichero. Así **el orden de despliegue no
         *    importa** y no hay ventana en la que el login quede roto — la
         *    ventana que en el BUILD 424 obligó a invertir el orden y que en
         *    el 426 dejó cinco diagnósticos falsos. Verificado en E7. */
        p_proveedor: proveedor,
        p_sub:       perfil.sub || null,
      }),
    });
    const cuerpo = await res.text();
    if (!res.ok) {
      console.error('[oauth] la base rechazó la sesión:', res.status, cuerpo);
      if (cuerpo.includes('CUENTA_DESACTIVADA')) {
        return json({ error: 'Tu cuenta está desactivada. Contacta al supermercado.' }, 403);
      }
      /* BUILD 445 · el rechazo por falta de correo AHORA LO LANZA LA BASE, así
       * que hay que traducirlo aquí o el cliente vería el 502 genérico «No se
       * pudo abrir tu sesión», que no le dice qué hacer.
       *
       * 🔴 ESTO ERA UN DEFECTO REAL DE ESTE MISMO BUILD, detectado al leer los
       *    llamadores en vez de dar por bueno el cambio: al mover la
       *    comprobación del correo de este fichero a la función SQL, el
       *    mensaje útil se habría perdido en silencio. El código y el número
       *    (409) son EXACTAMENTE los de antes, así que para `login-cliente.html`
       *    nada cambia. */
      if (cuerpo.includes('APPLE_SIN_CORREO')) {
        return json({
          error: 'Apple no compartió tu correo esta vez. Entra con tu correo y ' +
                 'contraseña, o usa «Continuar con Google».',
          codigo: 'APPLE_SIN_CORREO',
        }, 409);
      }
      /* Un token sin correo y sin `sub` utilizable no debe dar 502: no es un
       * fallo del servidor, es una petición que no identifica a nadie. */
      if (cuerpo.includes('SIN_IDENTIFICADOR') || cuerpo.includes('CORREO_INVALIDO')) {
        return json({ error: 'No pudimos identificar tu cuenta. Intenta de nuevo.' }, 400);
      }
      return json({ error: 'No se pudo abrir tu sesión. Intenta de nuevo.' }, 502);
    }
    try {
      filas = JSON.parse(cuerpo);
    } catch (ep) {
      // Supabase respondió 200 con algo que no es JSON. Sin este `catch` el
      // `throw` salía de la función y Cloudflare lo tapaba con su HTML.
      console.error('[oauth] respuesta no-JSON de la base:', String(cuerpo).slice(0, 400));
      return json({ error: 'Respuesta inesperada de la base.' }, 502);
    }
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
      authProvider: proveedor,          // BUILD 442 · ya no está fijado a Google
      avatar:       perfil.picture || '',
    },
    vale:   fila.vale,
    creado: Boolean(fila.creado),
  });
}
