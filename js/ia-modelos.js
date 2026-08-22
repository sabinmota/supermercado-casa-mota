/**
 * SUPERMERCADO CASA MOTA — IA-MODELOS.JS
 * ═════════════════════════════════════════════════════════════════════════════
 * ÚNICO SITIO DONDE SE DECIDE QUÉ MODELO DE IA SE USA.
 *
 * POR QUÉ EXISTE ESTE FICHERO (BUILD 414)
 * ───────────────────────────────────────
 * ⚠️ LO QUE SIGUE ERA MI PRIMERA EXPLICACIÓN Y ESTABA MAL. Se conserva para que
 * se entienda de dónde salió el error; la versión correcta está más abajo, en
 * «CORRECCIÓN DE UN DIAGNÓSTICO EQUIVOCADO».
 *
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
 * 🔴🔴 CORRECCIÓN DE UN DIAGNÓSTICO EQUIVOCADO (mismo build, segunda vuelta)
 * ═════════════════════════════════════════════════════════════════════════════
 * La primera versión de este fichero afirmaba que Groq había RETIRADO los
 * modelos. ERA FALSO. El error que llegó después lo dejó claro:
 *
 *   403 — The model `llama-3.3-70b-versatile` is BLOCKED AT THE ORGANIZATION
 *   LEVEL. Please have the org admin enable this model in the org settings.
 *
 * Los modelos estaban vivos todo el tiempo. Quien los rechazaba era la lista
 * «Allowed Models» de la propia cuenta. El error original decía «does not
 * exist OR YOU DO NOT HAVE ACCESS TO IT» y se leyó solo la primera mitad.
 *
 * 🔴 Y de ahí sale la trampa que rompió el arreglo anterior:
 * `groq/compound` NO ES UN MODELO, es un sistema agéntico que POR DENTRO
 * llama a `llama-3.3-70b-versatile`. Autorizar solo los dos «compound» y
 * bloquear el resto es contradictorio: compound se choca contra el bloqueo de
 * su propio motor interno y devuelve 403. Por eso al arreglarlo seguía roto.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 TERCERA CORRECCIÓN: LOS MODELOS «LLAMA» NO SE PUEDEN AUTORIZAR
 * ═════════════════════════════════════════════════════════════════════════════
 * Recomendé activar `llama-3.1-8b-instant`, `llama-3.3-70b-versatile` y
 * `meta-llama/llama-4-scout-...`. ERA UN CONSEJO IMPOSIBLE DE SEGUIR: la
 * pantalla «Base Models» de esta cuenta NO LOS OFRECE. La lista completa,
 * leída de la captura del dueño el 2026-08-22, es exactamente esta:
 *
 *   canopylabs/orpheus-arabic-saudi        → voz (TTS), no sirve para texto
 *   canopylabs/orpheus-v1-english          → voz (TTS)
 *   groq/compound                          → agéntico
 *   groq/compound-mini                     → agéntico
 *   meta-llama/llama-prompt-guard-2-22m    → clasificador de seguridad
 *   meta-llama/llama-prompt-guard-2-86m    → clasificador de seguridad
 *   openai/gpt-oss-120b                    → ✅ CHAT
 *   openai/gpt-oss-20b                     → ✅ CHAT
 *   openai/gpt-oss-safeguard-20b           → clasificador de seguridad
 *   qwen/qwen3.6-27b                       → ✅ CHAT
 *   whisper-large-v3                       → transcribe audio
 *   whisper-large-v3-turbo                 → transcribe audio
 *
 * De los doce, SOLO TRES sirven para conversar: los dos `gpt-oss` y `qwen`.
 * Los `prompt-guard` y `safeguard` solo dicen si un texto es peligroso; los
 * `orpheus` y `whisper` son de audio. Ponerlos aquí daría error siempre.
 *
 * 🔴 Y `groq/compound` NO VA A FUNCIONAR NUNCA en esta cuenta: por dentro
 * llama a `llama-3.3-70b-versatile`, que ni siquiera aparece en la lista, así
 * que no hay forma de desbloquearlo. Por eso da 403. Se deja el último, como
 * último recurso, pero no se cuenta con él.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ✅ LO QUE HAY QUE HACER EN GROQ (esto NO se arregla con código)
 * ═════════════════════════════════════════════════════════════════════════════
 * console.groq.com → Settings → Limits → Allowed Models → MARCAR LA CASILLA de:
 *
 *     openai/gpt-oss-20b     (el principal: rápido y suficiente)
 *     openai/gpt-oss-120b    (respaldo, más capaz y más lento)
 *
 * En la captura TODAS las casillas salían VACÍAS. Mientras no se marque
 * ninguna, cualquier modelo dará 403 y la IA seguirá muerta.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 CUARTO HALLAZGO: HAY DOS NIVELES DE PERMISOS, NO UNO
 * ═════════════════════════════════════════════════════════════════════════════
 * La captura de «Project Limits: Default Project» (2026-08-22) destapó algo
 * que no sabía: Groq autoriza modelos en DOS SITIOS distintos, y el permiso
 * efectivo es la INTERSECCIÓN de ambos.
 *
 *   ORGANIZATION → Limits → Allowed Models   (manda; es el techo)
 *   PROJECT      → Limits → Allowed Models   (solo puede restringir dentro)
 *
 * Estado leído en la captura del proyecto «Default Project»:
 *
 *   openai/gpt-oss-20b    ✅ verde   → autorizado en LOS DOS niveles → FUNCIONA
 *   openai/gpt-oss-120b   ⚠️ naranja → «(conflicts with org permissions)»:
 *                                      permitido en el proyecto pero NO en la
 *                                      organización → dará 403
 *   qwen/qwen3.6-27b      ⛔ NO APARECE en la lista del proyecto → dará 403
 *   groq/compound         ⛔ NO APARECE
 *   groq/compound-mini    ⛔ NO APARECE
 *
 * Aviso literal de Groq en esa pantalla:
 *   «This project has conflicting model permissions with the organization
 *   settings. To fix this, you need to either allow these models at the
 *   organization level or clear the model permissions at the project level.»
 *
 * ✅ LO BUENO: `openai/gpt-oss-20b` es el PRIMERO de la lista y está verde en
 * los dos niveles, así que la IA debe funcionar tal cual está.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ✅ ESTADO REAL TRAS ARREGLAR EL NIVEL DE ORGANIZACIÓN (captura 2026-08-22)
 * ═════════════════════════════════════════════════════════════════════════════
 * El dueño marcó los tres en ORGANIZATION → Limits → Allowed Models:
 *
 *   ✅ openai/gpt-oss-120b
 *   ✅ openai/gpt-oss-20b
 *   ✅ qwen/qwen3.6-27b
 *
 * 🔴 PERO EL PERMISO EFECTIVO ES LA INTERSECCIÓN DE LOS DOS NIVELES, y la
 * lista del PROYECTO solo contenía `gpt-oss-120b` y `gpt-oss-20b`. Resultado:
 *
 *   openai/gpt-oss-20b   ✅ ORG + ✅ PROJECT → FUNCIONA
 *   openai/gpt-oss-120b  ✅ ORG + ✅ PROJECT → FUNCIONA (el «conflicts with
 *                        org permissions» de antes queda resuelto: el conflicto
 *                        era que el proyecto lo permitía y la org no)
 *   qwen/qwen3.6-27b     ✅ ORG + ⛔ ausente del PROJECT → SIGUE BLOQUEADO
 *   groq/compound(-mini) ⛔ sin marcar en ORG → bloqueados (da igual: su motor
 *                        interno tampoco está autorizado)
 *
 * Es decir: hay 2 modelos usables → ~2.000 peticiones/día, no 3.000. Para el
 * tercero hay que pulsar «Clear» en PROJECT → Limits (así el proyecto hereda
 * la organización) o añadir qwen también allí.
 *
 * 🔴 Los puestos 4 y 5 (los «compound») se DEJAN en la lista aunque se sepa
 * que están bloqueados: solo se intentan si fallan los tres de arriba, y ese
 * día quizá los permisos hayan cambiado. Borrarlos obligaría a publicar un
 * build nuevo para recuperarlos; dejarlos cuesta dos peticiones fallidas en el
 * peor caso.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ✅ CIFRAS DE «CURRENT LIMITS» DEL NIVEL ORGANIZACIÓN — CONTRASTADAS
 * ═════════════════════════════════════════════════════════════════════════════
 * La tabla de la organización coincide EXACTAMENTE con la que ya estaba
 * apuntada abajo (30/min · 1K/día · 8K tok/min · 200K tok/día para los tres de
 * chat; 250/día y 70K tok/min para los «compound»). No hay que corregir nada.
 *
 * 💡 Y aparece de dónde salió el «14.400 req/día» que el panel anunciaba como
 * si fuera el límite del chat: son los `meta-llama/llama-prompt-guard-2-*`,
 * que tienen 14.4K/día. Son CLASIFICADORES DE SEGURIDAD, no sirven para
 * conversar. Se estaba enseñando el límite de un modelo que la app no usa.
 *
 * 💡 En esa tabla también sale `allam-2-7b` con 7K peticiones/día — siete veces
 * más que los `gpt-oss`. NO SE USA, y conviene saber por qué: está afinado para
 * árabe, así que para descripciones en español daría peor resultado; además no
 * está marcado en Allowed Models. Se anota por si algún día hace falta volumen.
 */

/* ─── MODELOS DE TEXTO, POR ORDEN DE PREFERENCIA ─────────────────────────────
 * Solo modelos que EXISTEN en esta cuenta y saben conversar.
 *
 * ✅ LÍMITES VERIFICADOS en «Current Limits» de la cuenta real (2026-08-22):
 *
 *   MODELO                 req/min  req/día  tok/min   tok/día
 *   openai/gpt-oss-20b       30      1.000    8.000    200.000
 *   openai/gpt-oss-120b      30      1.000    8.000    200.000
 *   qwen/qwen3.6-27b         30      1.000    8.000    200.000
 *   groq/compound            30        250   70.000    sin tope
 *   groq/compound-mini       30        250   70.000    sin tope
 *
 * 💡 Los tres primeros SUMARÍAN ~3.000 peticiones al día, porque el límite es
 * por modelo y no de la cuenta: al agotarse uno, el sistema salta al
 * siguiente. Sería de sobra para los ~1.900 productos del catálogo.
 *
 * 🔴 HOY SE CUMPLE A MEDIAS: ver «ESTADO REAL» arriba. Están autorizados en los
 * dos niveles `gpt-oss-20b` y `gpt-oss-120b` → ~2.000 peticiones al día, no
 * 3.000. `qwen` falta en la lista del PROYECTO. Con 2.000 al día el catálogo
 * de ~1.900 productos entra en UNA jornada (y si no, el proceso no repite los
 * ya descritos: continúa donde se quedó).
 *
 * 🔴 PERO OJO CON EL CHAT DE MAYA: el cuello de botella NO son las peticiones
 * sino los 8.000 TOKENS POR MINUTO. Maya manda en cada mensaje un contexto
 * grande (catálogo, pedidos, estadísticas). Si ese contexto pasa de ~8.000
 * tokens (unos 30.000 caracteres), Groq responderá 429 SIEMPRE, aunque no se
 * haya gastado ni una petición del día. Los «compound» tienen 70.000 tok/min,
 * casi nueve veces más, pero no sirven en esta cuenta porque su motor interno
 * está bloqueado. Si Maya empieza a dar 429 con el catálogo lleno, la solución
 * es RECORTAR EL CONTEXTO (menos productos por mensaje), no cambiar de modelo.
 */
const IA_MODELOS_TEXTO = [
  'openai/gpt-oss-20b',   // principal: rápido, de sobra para Maya y descripciones
  'openai/gpt-oss-120b',  // respaldo: más capaz, más lento (otras 1.000/día)
  'qwen/qwen3.6-27b',     // segundo respaldo (otras 1.000/día)
  'groq/compound-mini',   // último recurso (su motor interno está bloqueado)
  'groq/compound',
];

/* ─── MODELOS CON VISIÓN (leer fotos) ────────────────────────────────────────
 * 🔴 AVISO HONESTO: EN ESTA CUENTA NO HAY NINGÚN MODELO DE VISIÓN. Los doce
 * disponibles son de texto, de audio o clasificadores. `meta-llama/llama-4-
 * scout`, que era el que leía las fotos, no figura y no se puede autorizar.
 * Se dejan estos por si Groq amplía la lista, pero lo más probable es que
 * fallen con 403.
 *
 * EL ESCÁNER NO SE ROMPE POR ESTO: la IA es el paso 4 de 4 (index.html ~1585)
 * y los tres anteriores —BarcodeDetector nativo, Quagga2 y ZXing— leen las
 * barras de verdad y validan el dígito de control, cosa que la IA nunca hizo;
 * podía inventarse el número, y por eso está la última. Se pierde algo de
 * tolerancia con fotos malas; no se pierde el escáner.
 */
const IA_MODELOS_VISION = [
  'groq/compound',
];

// Dónde se recuerda el modelo que sí funcionó, para no reintentar los muertos.
const _IA_LS_TEXTO  = 'ia_modelo_texto';
const _IA_LS_VISION = 'ia_modelo_vision';

/* ─── MODELOS CON LA CUOTA DEL DÍA YA GASTADA ────────────────────────────────
 * 🔴 POR QUÉ HACE FALTA ESTO (fallo mío detectado al contrastar las cifras
 * con el código, no al leerlas):
 *
 * Escribí que tener dos modelos autorizados da «~2.000 peticiones al día,
 * porque al agotar uno se salta al siguiente». EL CÓDIGO NO HACÍA ESO. Solo se
 * pasaba al siguiente modelo cuando el fallo era de permisos (400/403/404); un
 * 429 de cuota diaria detenía el proceso y las otras 1.000 peticiones del
 * segundo modelo se quedaban SIN USAR. La suma que prometí era falsa.
 *
 * Ahora, al gastarse la cuota de un modelo, se apunta aquí CON LA FECHA y se
 * deja de ofrecer hasta mañana. La fecha importa: sin ella, el modelo quedaría
 * descartado para siempre y al día siguiente —con la cuota ya renovada— se
 * estaría usando el respaldo lento sin motivo.
 */
const _IA_LS_AGOTADOS = 'ia_agotados_hoy';

function _iaHoy() { return new Date().toISOString().slice(0, 10); }

/** Modelos cuya cuota diaria se gastó HOY (lista vacía si cambió el día). */
function iaAgotadosHoy() {
  try {
    const raw = localStorage.getItem(_IA_LS_AGOTADOS);
    if (!raw) return [];
    const d = JSON.parse(raw);
    if (!d || d.fecha !== _iaHoy()) return [];   // otro día: cuota renovada
    return Array.isArray(d.modelos) ? d.modelos : [];
  } catch (e) { return []; }
}

/** Apunta que este modelo agotó su cuota de hoy. */
function iaAgotadoHoy(modelo) {
  if (!modelo) return;
  const ya = iaAgotadosHoy();
  if (ya.includes(modelo)) return;
  try {
    localStorage.setItem(_IA_LS_AGOTADOS,
      JSON.stringify({ fecha: _iaHoy(), modelos: ya.concat([modelo]) }));
    // Si era el «modelo que funcionó», dejar de empezar por él.
    if (localStorage.getItem(_IA_LS_TEXTO)  === modelo) localStorage.removeItem(_IA_LS_TEXTO);
    if (localStorage.getItem(_IA_LS_VISION) === modelo) localStorage.removeItem(_IA_LS_VISION);
  } catch (e) {}
}

/** Devuelve la lista a probar, empezando por el que funcionó la última vez. */
function _iaOrden(lista, clave) {
  const agotados = iaAgotadosHoy();
  /* Los agotados van al final, NO se eliminan: si todos lo están, es mejor
   * intentarlo y que Groq conteste 429 (con su mensaje real) que devolver una
   * lista vacía y provocar un error confuso de «no hay modelos». */
  let base = lista.filter(m => !agotados.includes(m));
  const alFinal = lista.filter(m => agotados.includes(m));

  let recordado = null;
  try { recordado = localStorage.getItem(clave); } catch (e) {}
  if (recordado && base.includes(recordado)) {
    base = [recordado, ...base.filter(m => m !== recordado)];
  }
  return [...base, ...alFinal];
}

function iaModeloTexto()  { return _iaOrden(IA_MODELOS_TEXTO,  _IA_LS_TEXTO)[0]; }
function iaModeloVision() { return _iaOrden(IA_MODELOS_VISION, _IA_LS_VISION)[0]; }

/* ─── 🔴 EL FALLO DE «RESPONDIÓ PERO SIN TEXTO» ──────────────────────────────
 * Síntoma real del dueño (captura 2026-08-22): «Probar conexión» decía
 * «⚠️ Groq respondió pero sin texto. Modelo: openai/gpt-oss-20b» y, al pedir
 * una descripción, «No se pudo conectar con Groq».
 *
 * Parecían dos problemas distintos. ERAN EL MISMO, y ninguno es de conexión:
 * un 200 OK con `content` VACÍO. La clave y los permisos estaban BIEN.
 *
 * LA CAUSA: los `openai/gpt-oss-*` son modelos de RAZONAMIENTO. Antes de
 * escribir la respuesta gastan tokens «pensando» en un canal aparte
 * (`reasoning`), y ese gasto SALE DEL MISMO `max_tokens`. Si el presupuesto se
 * agota durante el razonamiento, Groq devuelve 200 con:
 *
 *     finish_reason: "length"   ·   message.content: ""
 *
 * O sea: respuesta correcta, texto vacío. Con `max_tokens: 5` (la prueba de
 * conexión) es GARANTIZADO. Con 60 (las descripciones) pasa casi siempre.
 *
 * Los `llama-3.x` de antes NO razonaban, así que 5 tokens bastaban para un
 * «OK». Al cambiar de familia de modelos, ese presupuesto dejó de servir.
 *
 * ARREGLO: un mínimo por debajo del cual no se pide nada a un modelo que
 * razona. No es un capricho: es la diferencia entre recibir texto y recibir
 * vacío. El coste es irrelevante — solo se pagan los tokens realmente usados,
 * y subir el TECHO no obliga a gastarlo.
 */
const IA_MIN_TOKENS_RAZONA = 512;

/** ¿Este modelo gasta tokens razonando antes de contestar? */
function iaModeloRazona(modelo) {
  return /gpt-oss|qwen3|^groq\/compound/.test(String(modelo || ''));
}

/**
 * Corrige `max_tokens` para que el modelo tenga sitio para razonar Y responder.
 * Devuelve el valor original si el modelo no razona o si ya es suficiente.
 */
function iaTokensSeguros(modelo, maxTokens) {
  const n = Number(maxTokens) || 0;
  if (!iaModeloRazona(modelo)) return n || undefined;
  return Math.max(n, IA_MIN_TOKENS_RAZONA);
}

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
      || t.includes('decommission')
      /* 🔴 ESTE ERA EL FALLO que dejó la IA rota tras el primer arreglo.
       * Groq responde «is blocked at the organization level» con un 403 y
       * NINGUNA de las frases de arriba. Al no reconocerlo, el código daba el
       * error por definitivo y NUNCA probaba el siguiente modelo de la lista:
       * justo lo contrario de para lo que existe este fichero. */
      || t.includes('blocked at the organization')
      || t.includes('organization level')
      || t.includes('org admin')
      || t.includes('model_blocked')
      /* Nivel PROYECTO: Groq habla de «conflicting model permissions» cuando
       * el proyecto permite un modelo que la organización no. En la consola
       * web se ve como «(conflicts with org permissions)». NO ESTÁ VERIFICADO
       * que la API devuelva esa palabra —solo se ha visto en la interfaz—,
       * pero reconocerla no cuesta nada: solo entra aquí con 400/403/404, y
       * el único efecto es pasar al siguiente modelo en vez de rendirse.
       * Ignorarla sería repetir exactamente el fallo de «blocked at the
       * organization level». */
      || t.includes('conflict');
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
    /* 🔴 Se corrige `max_tokens` AQUÍ, en el único punto por el que pasan todas
     * las llamadas, y no en cada sitio que llama: así ninguna se queda sin el
     * arreglo. El presupuesto depende del modelo elegido, y el modelo se decide
     * en este bucle, por lo que dentro es el único lugar donde puede hacerse. */
    const cuerpo = { ...body, model: modelo };
    if (cuerpo.max_tokens !== undefined) {
      cuerpo.max_tokens = iaTokensSeguros(modelo, cuerpo.max_tokens);
    }

    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(cuerpo),
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
      let datos = {};
      try { datos = JSON.parse(texto); } catch (e) {}

      /* 🔴 UN 200 OK NO SIGNIFICA QUE HAYA TEXTO. Si el modelo agotó el
       * presupuesto razonando, `content` viene VACÍO y `finish_reason` es
       * "length". Antes esto se devolvía como éxito y el usuario veía
       * «respondió pero sin texto» o un «no se pudo conectar» engañoso.
       *
       * Ahora se detecta y se reintenta UNA VEZ con el doble de presupuesto
       * (el aviso dice qué pasó, para no volver a diagnosticar a ciegas). */
      const _cont  = datos?.choices?.[0]?.message?.content;
      const _fin   = datos?.choices?.[0]?.finish_reason;
      const _vacio = !String(_cont || '').trim();

      if (_vacio && _fin === 'length' && !cfg._yaAmplie && cuerpo.max_tokens) {
        console.warn(`[IA] «${modelo}» se quedó sin tokens razonando (finish_reason=length, texto vacío). Reintentando con ${cuerpo.max_tokens * 2}.`);
        return iaLlamarGroq(
          url,
          { ...body, max_tokens: cuerpo.max_tokens * 2 },
          headers,
          { ...cfg, _yaAmplie: true }
        );
      }

      // Solo se recuerda como "bueno" el modelo que DEVOLVIÓ TEXTO. Recordar
      // uno que contesta vacío haría que se intentara primero siempre.
      if (!_vacio) _iaRecordar(vision ? _IA_LS_VISION : _IA_LS_TEXTO, modelo);
      return { datos, modelo };
    }

    if (_iaModeloMuerto(res.status, texto)) {
      // El motivo casi siempre es que está bloqueado en «Allowed Models»,
      // no que Groq lo haya retirado. Decirlo bien ahorra buscar donde no es.
      console.warn(`[IA] «${modelo}» rechazado por Groq (${res.status}) — normalmente está bloqueado en Allowed Models. Probando el siguiente…`);
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

  /* El mensaje dice QUÉ HACER, no solo que algo falló. El motivo casi siempre
   * es el mismo: la lista «Allowed Models» de la cuenta bloquea el modelo. */
  /* El mensaje dice QUÉ HACER, no solo que algo falló, y nombra un modelo que
   * SÍ existe en esta cuenta (recomendar uno inexistente ya hizo perder un
   * viaje entero a la pantalla de Groq). */
  /* 🔴 Y se avisa de los DOS niveles: mandar al dueño solo a los permisos del
   * proyecto ya le hizo perder un viaje, porque la organización manda. */
  throw new Error(
    ultimoError +
    ' Ningún modelo está autorizado en su cuenta de Groq. Groq pide permiso en ' +
    'DOS sitios y hay que mirar los dos: (1) ORGANIZATION → Limits → Allowed ' +
    'Models y (2) PROJECT → Limits. Marque «openai/gpt-oss-20b» en el nivel de ' +
    'ORGANIZACIÓN, o pulse «Clear» en los permisos del proyecto para que herede ' +
    'los de la organización.'
  );
}
