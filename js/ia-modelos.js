/**
 * SUPERMERCADO CASA MOTA — IA-MODELOS.JS
 * ═════════════════════════════════════════════════════════════════════════════
 * ÚNICO SITIO DONDE SE DECIDE QUÉ MODELO DE IA SE USA.
 *
 * POR QUÉ EXISTE ESTE FICHERO (BUILD 414)
 * ───────────────────────────────────────
 * Groq retiró `llama-3.1-8b-instant` y `llama-3.3-70b-versatile` sin avisar, y
 * toda la IA del proyecto murió de golpe con este error:
 *
 *   404 — The model `llama-3.1-8b-instant` does not exist or you do not have
 *   access to it
 *
 * No fue un problema de saldo: Groq es gratis y la clave estaba bien. El fallo
 * se multiplicó porque el nombre del modelo estaba ESCRITO A MANO EN 5 SITIOS
 * distintos (ai.js ×2, chat.js, admin.html, index.html) más la lista blanca del
 * proxy. Cambiar uno y olvidar otro deja la mitad de la IA rota en silencio.
 *
 * Ahora el nombre vive AQUÍ y en ningún otro lugar.
 *
 * 🔴 NO ES UN NOMBRE FIJO, ES UNA LISTA ORDENADA. Si el primero contesta «no
 * existe» (404), se prueba el siguiente y se recuerda el que funcionó. Así, la
 * próxima vez que Groq jubile un modelo, la IA se recupera sola en vez de
 * quedarse muerta hasta que alguien lo note. Un solo nombre fijo es justo lo
 * que nos trajo hasta aquí.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 LÍMITE DELIBERADO DE LA CUENTA — LEER ANTES DE AÑADIR MODELOS
 * ═════════════════════════════════════════════════════════════════════════════
 * En Groq → Organization Limits → «Allowed Models», el dueño autorizó
 * EXCLUSIVAMENTE estos dos:
 *
 *     groq/compound        groq/compound-mini
 *
 * Cualquier otro modelo (openai/gpt-oss-*, qwen/*, allam-*…) aparece en
 * /v1/models pero la organización lo RECHAZA. Añadirlo aquí no da más
 * respaldo: da un error distinto y más confuso. Si en el futuro se quieren
 * más, primero hay que autorizarlos en esa pantalla de Groq y DESPUÉS
 * añadirlos a estas listas. En ese orden.
 *
 * Lista comprobada en la cuenta real el 2026-08-21 con
 * GET https://api.groq.com/openai/v1/models + la pantalla Organization Limits.
 * No adivinada.
 *
 * ⚠️ CUOTA MUY DISTINTA A LA DE ANTES:
 *     groq/compound       → 30 req/min · 250 req/DÍA · 70K tokens/min
 *     groq/compound-mini  → 30 req/min · 250 req/DÍA · 70K tokens/min
 * El modelo anterior daba 14.400 peticiones al día. Ahora son 250. Es de sobra
 * para el chat de Maya y para describir productos sueltos, pero NO alcanza
 * para generar descripciones masivas del catálogo entero de una sentada
 * (ver el aviso en aiBulkDescribe).
 */

/* ─── MODELOS DE TEXTO, POR ORDEN DE PREFERENCIA ─────────────────────────────
 * · groq/compound-mini → el más rápido de los dos; suficiente para el chat de
 *   Maya y para una descripción de producto de 25 palabras.
 * · groq/compound      → más capaz, algo más lento; respaldo si el mini falla.
 */
const IA_MODELOS_TEXTO = [
  'groq/compound-mini',
  'groq/compound',
];

/* ─── MODELOS CON VISIÓN (leer fotos) ────────────────────────────────────────
 * 🔴 AVISO HONESTO, SIN ADORNOS:
 * `meta-llama/llama-4-scout-17b-16e-instruct`, que usaba el escáner de códigos
 * de barras, YA NO EXISTE en la cuenta y NO está entre los dos autorizados.
 *
 * `groq/compound` es un sistema agéntico que PUEDE derivar a un modelo con
 * visión, pero NO ESTÁ COMPROBADO con una foto real desde aquí. Puede que
 * funcione y puede que no.
 *
 * Lo importante: si falla, EL ESCÁNER NO SE ROMPE. La IA era el paso 4 de 4
 * (index.html ~1585) y los tres anteriores —BarcodeDetector nativo, Quagga2 y
 * ZXing— leen las barras de verdad y validan el dígito de control, cosa que la
 * IA no hacía; de hecho podía alucinar el número, y por eso se la relegó al
 * final. Sin visión el escáner es algo menos tolerante con fotos malas; no
 * deja de funcionar.
 */
const IA_MODELOS_VISION = [
  'groq/compound',
];

// Dónde se recuerda el modelo que sí funcionó, para no reintentar los muertos.
const _IA_LS_TEXTO  = 'ia_modelo_texto';
const _IA_LS_VISION = 'ia_modelo_vision';

/** Devuelve la lista a probar, empezando por el que funcionó la última vez. */
function _iaOrden(lista, clave) {
  let recordado = null;
  try { recordado = localStorage.getItem(clave); } catch (e) {}
  if (recordado && lista.includes(recordado)) {
    return [recordado, ...lista.filter(m => m !== recordado)];
  }
  return [...lista];
}

function iaModeloTexto()  { return _iaOrden(IA_MODELOS_TEXTO,  _IA_LS_TEXTO)[0]; }
function iaModeloVision() { return _iaOrden(IA_MODELOS_VISION, _IA_LS_VISION)[0]; }

/* Lista completa en orden de intento. La necesita js/chat.js, que NO puede
 * pasar por `iaLlamarGroq` porque su petición va primero al proxy /api/chat
 * (con timeout y caída a Groq directo) y esa lógica no cabe aquí sin
 * duplicarla. Se le da la lista y él hace su propio bucle. */
function iaListaTexto()  { return _iaOrden(IA_MODELOS_TEXTO,  _IA_LS_TEXTO); }
function iaListaVision() { return _iaOrden(IA_MODELOS_VISION, _IA_LS_VISION); }

function _iaRecordar(clave, modelo) {
  try { localStorage.setItem(clave, modelo); } catch (e) {}
}

/** Apunta el modelo que sí respondió, para empezar por él la próxima vez. */
function iaRecordarTexto(modelo)  { _iaRecordar(_IA_LS_TEXTO,  modelo); }
function iaRecordarVision(modelo) { _iaRecordar(_IA_LS_VISION, modelo); }

/**
 * ¿El fallo se arregla probando OTRO modelo?
 *
 * Se distingue del resto a propósito. Un modelo retirado o no autorizado se
 * resuelve pasando al siguiente; en cambio un 401 (clave mala) o un 429
 * (demasiadas peticiones) NO — reintentar solo gastaría cuota y tardaría más
 * en mostrar el error verdadero.
 *
 * Se cubren los dos casos porque desde fuera son indistinguibles: Groq usa el
 * mismo texto «does not exist or you do not have access to it» tanto para un
 * modelo jubilado como para uno que la organización no ha autorizado.
 */
function _iaModeloMuerto(status, texto) {
  if (status !== 404 && status !== 400 && status !== 403) return false;
  const t = String(texto || '').toLowerCase();
  return t.includes('does not exist')
      || t.includes('model_not_found')
      || t.includes('do not have access')
      || t.includes('not allowed')
      || t.includes('not permitted')
      || t.includes('decommission');
}

/** Igual que `_iaModeloMuerto`, con nombre público para usarlo desde chat.js. */
function iaModeloMuerto(status, texto) { return _iaModeloMuerto(status, texto); }

/**
 * Llama a Groq probando los modelos en orden hasta que uno responda.
 *
 * @param {string}      url        endpoint (Groq directo o el proxy /api/chat).
 * @param {object}      body       cuerpo de la petición SIN el campo `model`.
 * @param {object}      headers    cabeceras completas (con Authorization si toca).
 * @param {object}      [opts]
 * @param {boolean}     [opts.vision] usar la lista de modelos con visión.
 * @param {AbortSignal} [opts.signal] permite CANCELAR — lo usa la generación
 *                      masiva de descripciones, que tiene botón de cancelar.
 * @param {function}    [opts.onEstado] se llama con (status, texto) cuando el
 *                      fallo NO es de modelo; si devuelve algo distinto de
 *                      undefined, ese valor se propaga. Lo usa el bulk para
 *                      tratar su propio 429 esperando y reintentando.
 * @returns {Promise<{datos:object, modelo:string}>}
 * @throws  {Error} si fallan todos, con el mensaje real del último intento.
 */
async function iaLlamarGroq(url, body, headers, opts = {}) {
  // Compatibilidad: si alguien pasa `true` como 4º argumento, es `vision`.
  const cfg    = (typeof opts === 'boolean') ? { vision: opts } : (opts || {});
  const vision = !!cfg.vision;

  const lista = vision
    ? _iaOrden(IA_MODELOS_VISION, _IA_LS_VISION)
    : _iaOrden(IA_MODELOS_TEXTO,  _IA_LS_TEXTO);

  let ultimoError = 'No hay ningún modelo de IA disponible.';

  for (const modelo of lista) {
    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ ...body, model: modelo }),
        ...(cfg.signal ? { signal: cfg.signal } : {}),
      });
    } catch (e) {
      // Una cancelación deliberada tiene que llegar intacta a quien la pidió:
      // si se convirtiera en «no hay conexión», el botón de cancelar sería
      // indistinguible de un fallo real de red.
      if (e && e.name === 'AbortError') throw e;
      throw new Error('No hay conexión con el servicio de IA.');
    }

    const texto = await res.text();

    if (res.ok) {
      _iaRecordar(vision ? _IA_LS_VISION : _IA_LS_TEXTO, modelo);
      let datos = {};
      try { datos = JSON.parse(texto); } catch (e) {}
      return { datos, modelo };
    }

    if (_iaModeloMuerto(res.status, texto)) {
      console.warn(`[IA] «${modelo}» no está disponible (retirado o no autorizado). Probando el siguiente…`);
      ultimoError = `El modelo «${modelo}» no está disponible.`;
      continue;
    }

    // Cualquier otro error (401, 429, 500…) NO se arregla cambiando de modelo.
    if (typeof cfg.onEstado === 'function') {
      const tratado = cfg.onEstado(res.status, texto);
      if (tratado !== undefined) return tratado;
    }
    let msg = `Error ${res.status}`;
    try { msg = JSON.parse(texto)?.error?.message || msg; } catch (e) {}
    throw new Error(msg);
  }

  throw new Error(
    ultimoError +
    ' Comprueba en Groq → Organization Limits → Allowed Models que ' +
    'groq/compound y groq/compound-mini sigan autorizados.'
  );
}
