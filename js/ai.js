/**
 * SUPERMERCADO CASA MOTA — AI.JS  v2
 *
 * 🔴 BUILD 414 · CORRECCIÓN DE UNA CABECERA QUE MENTÍA.
 * Aquí ponía «Integración dual: Groq + Gemini como respaldo. Failover
 * automático». NO ES CIERTO NI LO ERA: `_getGeminiKey()` devuelve cadena
 * vacía, así que Gemini está desactivado y NO HAY RESPALDO DE NINGÚN TIPO.
 * Si Groq falla, la IA no responde. Se deja dicho porque un comentario falso
 * hace perder horas buscando un failover que no existe.
 *
 * Proveedor real y único: Groq. El modelo se elige en js/ia-modelos.js.
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────

const GROQ_API_URL    = 'https://api.groq.com/openai/v1/chat/completions';

/* 🔴 BUILD 415 · `GROQ_KEY_BACKUP` ELIMINADA.
 *
 * Era una constante para escribir una clave «de respaldo» dentro del código.
 * Aquí estaba vacía, pero en `backup/v20.0/ai.js` línea 11 había una clave
 * REAL Y ACTIVA, publicada en GitHub y en el sitio en vivo. Cualquiera que
 * leyera el fichero podía gastar la cuenta. La clave ya fue revocada.
 *
 * No se deja la constante «por si acaso»: mientras exista, el patrón invita a
 * volver a escribir un secreto en un fichero que se publica. Un secreto no se
 * guarda NUNCA en el código del navegador — va en una variable de entorno del
 * servidor (Cloudflare → GROQ_API_KEY, que usa functions/api/chat.js) o en la
 * base de datos detrás de una función con comprobación de sesión. */

/* BUILD 414 · El nombre del modelo YA NO SE ESCRIBE AQUÍ.
 * Toda la IA murió a la vez porque el nombre estaba repetido a mano en 5
 * ficheros y los modelos que usaba no están disponibles en esta cuenta de
 * Groq. Ahora vive solo en js/ia-modelos.js, que prueba varios en orden y se
 * salta el que la cuenta rechace. (Nota: NO fue una retirada de Groq, como se
 * escribió al principio aquí; era la lista «Allowed Models» de la cuenta.) */

// System prompt compartido para ambos modelos
const AI_SYSTEM_PROMPT = `Eres el asistente de IA del Supermercado Casa Mota en República Dominicana.
Respondes siempre en español dominicano, de forma clara y profesional.
Cuando generes descripciones de productos, escribe EXACTAMENTE 1 sola oración. Máximo 25 palabras. Sin punto aparte. Sin segunda oración. Sin saltos de línea.
Ejemplo correcto: "Las Galletas Sandwich de Fresa Dino son delicadas galletas con relleno de fresa dulce, ideales para un aperitivo saludable y delicioso."
Ejemplo INCORRECTO (demasiado largo, dos oraciones): "...ideales para un refrigerio rápido. Son perfectas para merendar..."`;

// ─── GETTERS DE KEYS ─────────────────────────────────────────────────────────

/* 🔴 BUILD 415 · La clave ya NO se guarda en `localStorage`.
 *
 * ANTES: `localStorage.getItem('groq_api_key')`. Eso dejaba el secreto escrito
 * en el disco del navegador de forma permanente, legible con una sola línea en
 * la consola del inspector. AHORA vive solo en esta variable de memoria: al
 * recargar la página desaparece y hay que volver a pedirla a la base, que
 * comprueba la sesión antes de darla.
 *
 * ¿Por qué DOS funciones y no una `async`?
 * `_getGroqKey()` se usa en 10 sitios, varios de ellos sincrónicos (pintar un
 * badge «● Configurado», decidir si se habilita un botón). Convertirla en
 * `async` los rompería todos en silencio: devolverían una Promesa, que en un
 * `if` SIEMPRE es verdadera, y los badges dirían «configurado» aunque no lo
 * estuviera. Así que:
 *   · `_getGroqKey()`    — sincrónica, mira la memoria. Para la UI.
 *   · `_ensureGroqKey()` — asíncrona, la pide a la base si falta. Antes de
 *                          cualquier llamada real a la IA. */
let _groqKeyMemoria = null;

function _getGroqKey()   { return _groqKeyMemoria || ''; }
function _getGeminiKey() { return ''; } // Gemini desactivado

/** Obtiene la clave pidiéndola a la base si no está en memoria.
 *  Requiere sesión de personal activa (la comprueba la base, no el navegador). */
async function _ensureGroqKey() {
  if (_groqKeyMemoria) return _groqKeyMemoria;
  try {
    if (typeof DB === 'undefined' || !DB.getAiKey) return '';
    const key = await DB.getAiKey();
    if (key && key.startsWith('gsk_')) {
      _groqKeyMemoria = key;
      return key;
    }
  } catch (e) {
    console.warn('[AI] No se pudo obtener la clave de IA:', e.message);
  }
  return '';
}

/* Borra cualquier copia que builds anteriores hubieran dejado en el disco. */
(function _aiLimpiarClaveGuardada() {
  try {
    if (localStorage.getItem('groq_api_key')) {
      localStorage.removeItem('groq_api_key');
      console.log('[Seguridad] Copia local de la clave de IA eliminada (ai).');
    }
  } catch (e) { /* modo privado: nada que limpiar */ }
})();

// ─── INDICADOR DE PROVEEDOR ACTIVO ───────────────────────────────────────────

/** Muestra en la UI qué modelo respondió */
function _setAiProvider(provider) {
  const el = document.getElementById('aiProviderBadge');
  if (!el) return;
  if (provider === 'groq') {
    // BUILD 414 · Decía «LLaMA 3.1», modelo retirado por Groq. Se muestra el
    // que de verdad se está usando en vez de un nombre fijo desactualizado.
    const m = (typeof iaModeloTexto === 'function') ? iaModeloTexto() : 'Groq';
    el.innerHTML = `<i class="fas fa-bolt" style="color:#f59e0b"></i> Groq (${m})`;
    el.style.color = '#d97706';
  } else if (provider === 'gemini') {
    el.innerHTML = '<i class="fas fa-gem" style="color:#4285f4"></i> Gemini 1.5 Flash';
    el.style.color = '#4285f4';
  } else {
    el.innerHTML = '';
  }
}

// ─── LLAMADA A GROQ ───────────────────────────────────────────────────────────

async function _groqRequest(prompt, maxTokens = 300) {
  // BUILD 415 · `_ensureGroqKey` (no `_getGroqKey`): esta es una llamada REAL a
  // la IA, así que si la clave no está en memoria hay que pedirla a la base.
  const key = await _ensureGroqKey();
  if (!key) throw new Error('NO_KEY_GROQ');

  // BUILD 414 · `iaLlamarGroq` recorre la lista de modelos hasta dar con uno
  // vivo y recuerda cuál fue. Si el modelo está retirado lo salta; si el fallo
  // es otro (clave inválida, límite de uso) lo propaga sin reintentar.
  const { datos } = await iaLlamarGroq(
    GROQ_API_URL,
    {
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user',   content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    },
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }
  );

  return datos.choices?.[0]?.message?.content || '';
}

// ─── LLAMADA A GEMINI ─────────────────────────────────────────────────────────

async function _geminiRequest(prompt) {
  const key = _getGeminiKey();
  if (!key) throw new Error('NO_KEY_GEMINI');

  const url = `${GEMINI_API_URL}?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: AI_SYSTEM_PROMPT + '\n\n' + prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300
      }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini Error ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── LLAMADA INTELIGENTE CON FAILOVER ────────────────────────────────────────

/**
 * Intenta Groq primero; si falla, cambia a Gemini automáticamente.
 * @param {string} prompt
 * @param {number} maxTokens
 * @returns {{ text: string, provider: 'groq'|'gemini' }}
 */
async function _aiRequest(prompt, maxTokens = 300) {
  /* Se guarda el motivo real del fallo para no taparlo con un genérico «no se
   * pudo conectar», que manda a revisar la clave cuando el problema puede ser
   * que el modelo no esté autorizado en la organización. */
  let _ultimoErrorGroq = '';
  // 1️⃣ Intentar Groq — BUILD 415: se pide a la base si no está en memoria.
  const groqKey = await _ensureGroqKey();
  if (groqKey) {
    try {
      const text = await _groqRequest(prompt, maxTokens);
      if (text) {
        _setAiProvider('groq');
        return { text, provider: 'groq' };
      }
    } catch (e) {
      /* BUILD 414 · Antes decía «cambiando a Gemini…». Era falso: Gemini está
       * desactivado, no hay a dónde cambiar y la línea de abajo lanza el
       * error. Ese mensaje mandaba a buscar un respaldo que no existe. */
      console.warn('[AI] Groq falló y NO hay proveedor de respaldo:', e.message);
      _ultimoErrorGroq = e.message || '';
    }
  }

  /* 🔴 BUILD 414 · El mensaje sin error era «No se pudo conectar con Groq.
   * Verifica la clave» — y MANDABA A MIRAR DONDE NO ERA. Si se llega aquí sin
   * `_ultimoErrorGroq`, no hubo ninguna excepción: Groq respondió 200 OK pero
   * con el texto vacío. La clave está perfecta. Decir «verifica la clave» hizo
   * perder tiempo revisando permisos que ya estaban bien. */
  throw new Error(
    _ultimoErrorGroq
      ? `La IA no respondió: ${_ultimoErrorGroq}`
      : 'La IA respondió sin texto (se quedó sin espacio para razonar). '
        + 'Vuelve a intentarlo; si sigue igual, pulsa «Probar conexión» en '
        + 'Configuración → IA. NO es la clave.'
  );
}

// ─── GUARDAR / CARGAR KEYS ───────────────────────────────────────────────────

async function saveGroqKey() {
  const input = document.getElementById('settingGroqKey');
  if (!input) return;
  const key = input.value.trim();
  if (!key || key.includes('•')) { showAdminToast('⚠️ Ingresa la API key completa', 'warn'); return; }

  /* 🔴 BUILD 415 · Antes esto escribía la clave en `localStorage` y NO la
   * guardaba en la base, con este razonamiento en el comentario: «la tabla
   * settings la lee cualquier cliente, así que guardarla equivaldría a
   * publicarla». El razonamiento era CORRECTO; la conclusión, incompleta:
   * la clave ya estaba en `settings` de antes, y además el disco del
   * navegador tampoco es un sitio seguro para un secreto.
   *
   * Ahora la tabla `settings` YA NO la lee cualquiera (la columna
   * `groqApiKey` está cerrada a `anon`), así que sí se puede guardar en la
   * base — a través de una función que comprueba la sesión de personal. */
  try {
    await DB.saveAiKey(key);
    _groqKeyMemoria = key;             // memoria, no disco
    input.value = key.substring(0, 8) + '••••••••••••••••••••••••';
    _updateAiStatusBadges();
    showAdminToast('✅ Clave guardada de forma segura en la base de datos', 'success');
  } catch (e) {
    showAdminToast('❌ No se pudo guardar: ' + e.message, 'error');
  }
}

function saveGeminiKey() {
  const input = document.getElementById('settingGeminiKey');
  if (!input) return;
  const key = input.value.trim();
  if (!key || key.includes('•')) { showAdminToast('⚠️ Ingresa la API key completa', 'warn'); return; }
  localStorage.setItem('gemini_api_key', key);
  input.value = key.substring(0, 8) + '••••••••••••••••••••••••';
  showAdminToast('✅ API key de Gemini guardada', 'success');
}

/* BUILD 415 · Ahora es `async`: al cargar la página la memoria está vacía, así
 * que hay que preguntar a la base si existe una clave guardada. Antes bastaba
 * con mirar `localStorage`, que es justo lo que se ha eliminado.
 *
 * Se muestran solo los 8 primeros caracteres, nunca la clave entera: sirve
 * para reconocer «es la que creía» sin volver a exponerla en pantalla. */
async function loadGroqKeyDisplay() {
  const input = document.getElementById('settingGroqKey');
  if (!input) return;
  const key = await _ensureGroqKey();
  if (key) input.value = key.substring(0, 8) + '••••••••••••••••••••••••';
}

function loadGeminiKeyDisplay() {
  const input = document.getElementById('settingGeminiKey');
  if (!input) return;
  const key = _getGeminiKey();
  if (key) input.value = key.substring(0, 8) + '••••••••••••••••••••••••';
}

/* BUILD 415 · `async` y con `await`: si no se espera a que la clave llegue de
 * la base, `_updateAiStatusBadges()` se ejecutaría con la memoria todavía
 * vacía y el sello diría «○ Sin configurar» teniendo la clave guardada. */
async function loadAiKeysDisplay() {
  await loadGroqKeyDisplay();
  loadGeminiKeyDisplay();
  _updateAiStatusBadges();
}

/** Actualiza los badges de estado en la tarjeta de settings */
function _updateAiStatusBadges() {
  const groqBadge   = document.getElementById('groqStatusBadge');
  const geminiBadge = document.getElementById('geminiStatusBadge');
  if (groqBadge)   groqBadge.innerHTML   = _getGroqKey()   ? '<span style="color:#059669">● Configurado</span>' : '<span style="color:#9ca3af">○ Sin configurar</span>';
  if (geminiBadge) geminiBadge.innerHTML = _getGeminiKey() ? '<span style="color:#4285f4">● Configurado</span>' : '<span style="color:#9ca3af">○ Sin configurar</span>';
}

// ─── PROBAR CONEXIÓN ─────────────────────────────────────────────────────────

async function testAiConnection() {
  const btn = document.getElementById('btnTestAi');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Probando…'; }

  try {
    const { text, provider } = await _aiRequest('Di exactamente: "Conexión exitosa"', 20);
    showAdminToast(`✅ ${provider === 'groq' ? 'Groq' : 'Gemini'} conectado — ${text.trim()}`, 'success');
    _updateAiStatusBadges();
  } catch (e) {
    showAdminToast('❌ ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plug"></i> Probar conexión'; }
  }
}

// ─── GENERADOR DE DESCRIPCIÓN DE PRODUCTO ────────────────────────────────────

async function aiGenerateDescription() {
  const hasKey = await _ensureGroqKey() || _getGeminiKey();
  if (!hasKey) {
    showAdminToast('⚠️ Configura al menos una API key en Configuración → IA', 'warn');
    showSection('settings', document.querySelector('[data-section="settings"]'));
    return;
  }

  const name     = (document.getElementById('pName')?.value     || '').trim();
  const category = (document.getElementById('pCategory')?.value || '').trim();
  const price    = (document.getElementById('pPrice')?.value    || '').trim();
  const unit     = (document.getElementById('pUnit')?.value     || '').trim();

  if (!name) {
    showAdminToast('⚠️ Escribe el nombre del producto primero', 'warn');
    document.getElementById('pName')?.focus();
    return;
  }

  const btn      = document.getElementById('btnAiDesc');
  const textarea = document.getElementById('pDescription');
  if (btn)      { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando…'; }
  if (textarea) { textarea.style.borderColor = '#a78bfa'; }

  try {
    const catLabel = category ? `, categoría: ${category}` : '';
    const unitLabel = unit ? `, presentación: ${unit}` : '';

    const prompt = `Producto: ${name}${catLabel}${unitLabel}.
Escribe EXACTAMENTE 1 sola oración sobre este producto de supermercado. MÁXIMO 20 palabras. Una oración. Sin punto aparte. Sin segunda oración. Sin saltos de línea.
Ejemplo correcto: "Las Galletas Sandwich de Fresa Dino son delicadas galletas con relleno de fresa dulce, ideales para un aperitivo saludable y delicioso."
Tono amigable, español dominicano. Sin precio, sin comillas al inicio/final, sin asteriscos.`;

    const { text, provider } = await _aiRequest(prompt, 60);

    if (textarea && text) {
      textarea.value = text.trim();
      textarea.style.borderColor = '#1a7c3e';
      setTimeout(() => { if (textarea) textarea.style.borderColor = ''; }, 2500);
      const label = provider === 'groq' ? 'Groq ⚡' : 'Gemini 💎';
      showAdminToast(`✨ Descripción generada con ${label}`, 'success');
    }
  } catch (e) {
    showAdminToast('❌ ' + e.message, 'error');
    if (textarea) textarea.style.borderColor = '';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generar con IA'; }
  }
}

// ─── SUGERENCIA DE CATEGORÍA (DESACTIVADA) ─────────────────────────────────
// La auto-sugerencia de categoría por IA fue desactivada por decisión del usuario.
// La categoría debe seleccionarse manualmente — la IA no debe interferir con este campo.

async function aiSuggestCategory() {
  // DESACTIVADA — no auto-cambiar pCategory
  return;

  /* CÓDIGO ORIGINAL DESACTIVADO:
  const name = (document.getElementById('pName')?.value        || '').trim();
  const desc = (document.getElementById('pDescription')?.value || '').trim();
  const unit = (document.getElementById('pUnit')?.value        || '').trim();

  if (name.length < 3) return;

  const categorySelect = document.getElementById('pCategory');
  if (!categorySelect) return;

  const options = Array.from(categorySelect.options).map(o => o.value).filter(v => v);
  if (!options.length) return;

  try {
    const descPart = desc ? `\nDescripción: "${desc.substring(0, 120)}"` : '';
    const unitPart = unit ? `\nPresentación: ${unit}` : '';

    const prompt = `Eres un experto en clasificación de productos de supermercado dominicano.
Dado este producto:
Nombre: "${name}"${unitPart}${descPart}

¿A cuál de estas categorías pertenece?
${options.join(', ')}

Responde SOLO con el nombre exacto de la categoría de la lista, sin explicación ni puntuación.`;

    const { text } = await _aiRequest(prompt, 20);
    const clean = text.trim().toLowerCase();
    const match = options.find(o => o.toLowerCase() === clean || clean.includes(o.toLowerCase()) || o.toLowerCase().includes(clean));
    if (match && categorySelect.value !== match) {
      categorySelect.value = match;
      showAdminToast(`🤖 Categoría sugerida: ${match}`, 'info');
    }
  } catch (_) {
    // Falla silenciosa
  }
  END CÓDIGO ORIGINAL DESACTIVADO */
}

// ─── AUTO-SUGERENCIA CON DEBOUNCE (DESACTIVADA) ─────────────────────────────
// Triggers desactivados — la IA ya NO cambia pCategory automáticamente.

let _aiCatTimeout = null;

/** Disparado al escribir en el nombre del producto — SIN auto-categoría */
function onProductNameInput() {
  // Auto-sugerencia de categoría DESACTIVADA por decisión del usuario.
  // clearTimeout(_aiCatTimeout);
  // _aiCatTimeout = setTimeout(() => {
  //   if (_getGroqKey() || _getGeminiKey()) aiSuggestCategory();
  // }, 1500);
}

/** Disparado al terminar de escribir la descripción — SIN auto-categoría */
let _aiCatDescTimeout = null;
function onProductDescInput() {
  // Auto-sugerencia de categoría DESACTIVADA por decisión del usuario.
  // clearTimeout(_aiCatDescTimeout);
  // _aiCatDescTimeout = setTimeout(() => {
  //   const name = (document.getElementById('pName')?.value || '').trim();
  //   if (name.length >= 3 && (_getGroqKey() || _getGeminiKey())) aiSuggestCategory();
  // }, 2000);
}

/* 535 · «Describir todos con IA» (generación masiva de descripciones) BORRADO
 * por decisión del dueño: botón, ventana de progreso y todas sus funciones
 * (aiBulkDescribe, aiBulkCancel, _bulkGenerateOne, _bulkSetProgress,
 * _bulkStyleBtn, _bulkClose, _bulkAiRequest, la versión antigua por lotes y
 * _sleep). La descripción de UN producto con IA, en su ficha, sigue igual. */

// ─── BING IMAGE CREATOR — ABRE CON PROMPT AUTOMÁTICO ────────────────────────

/**
 * Construye el prompt e-commerce con los datos del producto
 * y abre Bing Image Creator en una nueva pestaña con el prompt listo.
 */
async function openBingImageCreator() {
  const name = (document.getElementById('pName')?.value        || '').trim();
  const desc = (document.getElementById('pDescription')?.value || '').trim();
  const unit = (document.getElementById('pUnit')?.value        || '').trim();
  const cat  = (document.getElementById('pCategory')?.value    || '').trim();

  if (!name) {
    showAdminToast('⚠️ Escribe el nombre del producto primero', 'warn');
    document.getElementById('pName')?.focus();
    return;
  }

  const btn     = document.getElementById('btnBingImage');
  const statusEl = document.getElementById('imgUploadStatus');

  // Prompt fijo exacto — el mismo que funciona en Bing Image Creator
  const prompt = `Based on this product photo I took, generate a clean 800x800px square product image. Keep all original text, logo, colors and brand elements exactly as they are. Use white background (or the brand's original background color if distinctive). Remove any real-world background, table, hands or shadows. Style: official brand marketing photo, suitable for an e-commerce supermarket website.`;

  // 1. Copiar prompt al portapapeles
  try {
    await navigator.clipboard.writeText(prompt);
  } catch (_) {
    // Fallback para navegadores que bloqueen clipboard
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // 2. Abrir Bing Image Creator
  window.open('https://www.bing.com/images/create', '_blank', 'noopener,noreferrer');

  // Animación del botón
  if (btn) {
    btn.innerHTML = '<i class="fas fa-check"></i> ¡Prompt copiado! Bing abierto';
    btn.style.background = 'linear-gradient(135deg,#e8f5e9,#c8e6c9)';
    btn.style.borderColor = '#2e7d32';
    btn.style.color = '#1b5e20';
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generar imagen con Bing IA <img src="https://www.bing.com/favicon.ico" style="width:16px;height:16px;border-radius:3px" onerror="this.style.display=\'none\'" />';
      btn.style.background = 'linear-gradient(135deg,#e8f4fd,#cce4f7)';
      btn.style.borderColor = '#0078d4';
      btn.style.color = '#005a9e';
    }, 3000);
  }

  if (statusEl) {
    statusEl.innerHTML = '✅ <strong>Prompt copiado</strong> — Pégalo en Bing con <kbd style="background:#f0f0f0;padding:1px 5px;border-radius:4px;border:1px solid #ccc">Ctrl+V</kbd> y presiona <strong>Crear</strong>';
    statusEl.style.color = '#0078d4';
  }
}



// ─── GENERADOR DE IMAGEN CON GEMINI (respaldo) ───────────────────────────────

/**
 * PASO 1 → Groq construye un prompt detallado del producto en inglés
 * PASO 2 → Gemini imagen genera la foto limpia de e-commerce
 * PASO 3 → Si falla, Imagen 3.0 de Google como segundo intento
 */
async function aiGenerateProductImage() {
  const geminiKey = _getGeminiKey();
  const groqKey   = _getGroqKey();

  if (!geminiKey && !groqKey) {
    showAdminToast('⚠️ Configura al menos una API key en Configuración → IA', 'warn');
    return;
  }

  const name = (document.getElementById('pName')?.value        || '').trim();
  const desc = (document.getElementById('pDescription')?.value || '').trim();
  const unit = (document.getElementById('pUnit')?.value        || '').trim();
  const cat  = (document.getElementById('pCategory')?.value    || '').trim();

  if (!name) {
    showAdminToast('⚠️ Escribe el nombre del producto primero', 'warn');
    document.getElementById('pName')?.focus();
    return;
  }

  // ── UI: estado cargando ──────────────────────────────────────────────────
  const btn         = document.getElementById('btnAiImage');
  const statusEl    = document.getElementById('imgUploadStatus');
  const zone        = document.getElementById('imgUploadZone');
  const imgPreview  = document.getElementById('imgPreview');
  const placeholder = document.getElementById('imgUploadPlaceholder');
  const pImageInput = document.getElementById('pImage');

  function _setStatus(html, color) {
    if (statusEl) { statusEl.innerHTML = html; statusEl.style.color = color; }
  }
  function _setBtnLoading(msg) {
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`; }
  }
  function _setBtnReady() {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generar imagen con IA';
      btn.style.borderColor = '#a78bfa';
      btn.style.background  = 'linear-gradient(135deg,#f5f3ff,#ede9fe)';
    }
  }
  function _applyImage(dataUrl) {
    if (pImageInput) pImageInput.value = dataUrl;
    if (imgPreview) {
      imgPreview.src = dataUrl;
      imgPreview.style.display = 'block';
      imgPreview.onload = () => {
        if (placeholder) placeholder.style.display = 'none';
        if (zone) {
          zone.style.borderColor = '#1a7c3e';
          zone.style.background  = '#f0fdf4';
          setTimeout(() => { zone.style.borderColor = ''; zone.style.background = ''; }, 2500);
        }
      };
    }
  }

  _setBtnLoading('Paso 1/2 · Preparando descripción del producto…');
  _setStatus('<i class="fas fa-spinner fa-spin" style="color:#7c3aed"></i> Analizando el producto…', '#7c3aed');

  try {
    // ── PASO 1: Groq genera un prompt detallado en inglés para la generación ─
    const unitLabel = unit ? `, size/presentation: ${unit}` : '';
    const descLabel = desc ? `, description: ${desc}`       : '';
    const catLabel  = cat  ? `, category: ${cat}`           : '';

    let imagePrompt = '';
    try {
      const { text } = await _aiRequest(
        `You are an expert e-commerce product photographer.
Write a detailed image generation prompt in English for this supermarket product:
- Name: ${name}${unitLabel}${catLabel}${descLabel}

The prompt must describe:
1. The exact product packaging (colors, label design, logo, text on package)
2. Quantity/presentation visible on the package
3. Photography style: clean white background, studio lighting, no shadows

Format: One detailed paragraph in English starting with "Professional e-commerce product photo of..."
Keep all brand elements accurate. NEVER mention price.`, 120
      );
      imagePrompt = text.trim();
    } catch (_) {
      // Si Groq falla, construir prompt básico
      imagePrompt = `Professional e-commerce product photo of "${name}"${unitLabel}. Clean white background, studio lighting, centered composition, no shadows, official supermarket marketing style.`;
    }

    // Asegurar que el prompt de e-commerce siempre incluya las instrucciones clave
    imagePrompt += ` Pure white background. Remove any real-world background, table, hands or shadows. Style: official brand marketing photo suitable for an e-commerce supermarket website. 800x800px square format.`;

    // ── PASO 2: Gemini imagen genera la foto ────────────────────────────────
    _setBtnLoading('Paso 2/2 · Generando imagen con IA…');
    _setStatus('<i class="fas fa-spinner fa-spin" style="color:#7c3aed"></i> Generando imagen del producto…', '#7c3aed');

    const base64Img = await _geminiGenerateImage(imagePrompt, geminiKey);

    if (!base64Img) throw new Error('Gemini no devolvió imagen');

    const dataUrl = `data:image/png;base64,${base64Img}`;
    _applyImage(dataUrl);
    _setStatus('✅ Imagen generada con IA · Gemini — puedes guardar el producto', '#059669');
    showAdminToast('🖼️ Imagen generada con Gemini IA', 'success');

  } catch (e) {
    console.warn('[AI Image] Error principal:', e.message);

    // ── PASO 3: Fallback con Imagen 3.0 de Google ───────────────────────────
    _setBtnLoading('Reintentando con modelo alternativo…');
    _setStatus('<i class="fas fa-spinner fa-spin" style="color:#f59e0b"></i> Reintentando…', '#d97706');

    try {
      const fallbackImg = await _imagen3Generate(name, unit, desc, cat, geminiKey);
      if (!fallbackImg) throw new Error('Sin resultado');

      const dataUrl = `data:image/png;base64,${fallbackImg}`;
      _applyImage(dataUrl);
      _setStatus('✅ Imagen generada con Imagen 3.0 — puedes guardar el producto', '#059669');
      showAdminToast('🖼️ Imagen generada con Imagen 3.0', 'success');

    } catch (e2) {
      console.error('[AI Image] Todos los intentos fallaron:', e2.message);
      _setStatus('❌ No se pudo generar la imagen automáticamente. Sube una imagen manualmente.', '#dc2626');
      showAdminToast('❌ Error al generar imagen: ' + (e2.message || e.message), 'error');
    }
  } finally {
    _setBtnReady();
  }
}

// ── Gemini imagen: intenta varios modelos disponibles ───────────────────────
async function _geminiGenerateImage(prompt, key) {
  if (!key) throw new Error('No Gemini key');

  // Lista de modelos en orden de preferencia (los más modernos primero)
  const MODELS = [
    'gemini-2.0-flash-preview-image-generation',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash'
  ];

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
          })
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`[AI Image] Modelo ${model} falló:`, err?.error?.message);
        continue; // probar siguiente modelo
      }

      const data  = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) return part.inlineData.data; // base64 ✅
      }
      // Si llegamos aquí el modelo respondió pero sin imagen
      console.warn(`[AI Image] Modelo ${model} no devolvió imagen inline`);
    } catch (err) {
      console.warn(`[AI Image] Excepción con modelo ${model}:`, err.message);
    }
  }
  return null; // todos fallaron → irá al fallback Imagen 3
}

// ── Fallback: Imagen 3 (imagen-3.0-generate-001) ────────────────────────────
async function _imagen3Generate(name, unit, desc, cat, key) {
  if (!key) throw new Error('No Gemini key');

  const unitLabel = unit ? ` ${unit}` : '';
  const catLabel  = cat  ? `, ${cat}` : '';
  const prompt    = `Professional e-commerce product photo of ${name}${unitLabel}${catLabel}. Pure white background, studio lighting, centered, no shadows, official supermarket marketing style, 800x800px square format.`;

  // Modelos de Imagen disponibles en v1beta
  const IMAGEN_MODELS = [
    'imagen-3.0-generate-001',
    'imagegeneration@006'
  ];

  for (const model of IMAGEN_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances:  [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: '1:1', outputMimeType: 'image/png' }
          })
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`[AI Image Fallback] Modelo ${model} falló:`, err?.error?.message);
        continue;
      }

      const data = await res.json();
      const b64  = data?.predictions?.[0]?.bytesBase64Encoded;
      if (b64) return b64;

    } catch (err) {
      console.warn(`[AI Image Fallback] Excepción con ${model}:`, err.message);
    }
  }

  throw new Error('Todos los modelos de imagen fallaron. Verifica que tu API key de Gemini tenga acceso a Imagen.');
}
