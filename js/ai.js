/**
 * SUPERMERCADO CASA MOTA — AI.JS  v2
 * Integración dual: Groq (LLaMA 3.1) como principal + Google Gemini como respaldo
 * Failover automático: si Groq falla → Gemini entra de inmediato
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────

const GROQ_API_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL      = 'llama-3.1-8b-instant';
const GROQ_KEY_BACKUP = '';

// System prompt compartido para ambos modelos
const AI_SYSTEM_PROMPT = `Eres el asistente de IA del Supermercado Casa Mota en República Dominicana.
Respondes siempre en español dominicano, de forma clara y profesional.
Cuando generes descripciones de productos, escribe EXACTAMENTE 1 sola oración. Máximo 25 palabras. Sin punto aparte. Sin segunda oración. Sin saltos de línea.
Ejemplo correcto: "Las Galletas Sandwich de Fresa Dino son delicadas galletas con relleno de fresa dulce, ideales para un aperitivo saludable y delicioso."
Ejemplo INCORRECTO (demasiado largo, dos oraciones): "...ideales para un refrigerio rápido. Son perfectas para merendar..."`;

// ─── GETTERS DE KEYS ─────────────────────────────────────────────────────────

function _getGroqKey()   { return localStorage.getItem('groq_api_key') || GROQ_KEY_BACKUP; }
function _getGeminiKey() { return ''; } // Gemini desactivado

// ─── INDICADOR DE PROVEEDOR ACTIVO ───────────────────────────────────────────

/** Muestra en la UI qué modelo respondió */
function _setAiProvider(provider) {
  const el = document.getElementById('aiProviderBadge');
  if (!el) return;
  if (provider === 'groq') {
    el.innerHTML = '<i class="fas fa-bolt" style="color:#f59e0b"></i> Groq (LLaMA 3.1)';
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
  const key = _getGroqKey();
  if (!key) throw new Error('NO_KEY_GROQ');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user',   content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq Error ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
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
  // 1️⃣ Intentar Groq
  const groqKey = _getGroqKey();
  if (groqKey) {
    try {
      const text = await _groqRequest(prompt, maxTokens);
      if (text) {
        _setAiProvider('groq');
        return { text, provider: 'groq' };
      }
    } catch (e) {
      console.warn('[AI] Groq falló, cambiando a Gemini…', e.message);
      // Si Groq falla con rate limit, esperar un poco antes del failover
      if (e.message && e.message.includes('429')) await new Promise(r => setTimeout(r, 2000));
    }
  }

  throw new Error('No se pudo conectar con Groq. Verifica la clave en Configuración → IA.');
}

// ─── GUARDAR / CARGAR KEYS ───────────────────────────────────────────────────

async function saveGroqKey() {
  const input = document.getElementById('settingGroqKey');
  if (!input) return;
  const key = input.value.trim();
  if (!key || key.includes('•')) { showAdminToast('⚠️ Ingresa la API key completa', 'warn'); return; }

  // 1) Guardar en localStorage (para este dispositivo)
  localStorage.setItem('groq_api_key', key);
  input.value = key.substring(0, 8) + '••••••••••••••••••••••••';

  // 2) Guardar en la base de datos (disponible para TODOS los dispositivos)
  try {
    // Buscar si ya existe un registro de settings
    const res = await fetch('tables/settings?limit=1');
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      // Actualizar registro existente
      await fetch(`tables/settings/${data.data[0].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groqApiKey: key })
      });
    } else {
      // Crear nuevo registro
      await fetch('tables/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groqApiKey: key })
      });
    }
    showAdminToast('✅ API key de Groq guardada en todos los dispositivos', 'success');
  } catch(e) {
    showAdminToast('✅ API key guardada localmente (sin sincronizar)', 'success');
    console.warn('[saveGroqKey]', e.message);
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

function loadGroqKeyDisplay() {
  const input = document.getElementById('settingGroqKey');
  if (!input) return;
  const key = _getGroqKey();
  if (key) input.value = key.substring(0, 8) + '••••••••••••••••••••••••';
}

function loadGeminiKeyDisplay() {
  const input = document.getElementById('settingGeminiKey');
  if (!input) return;
  const key = _getGeminiKey();
  if (key) input.value = key.substring(0, 8) + '••••••••••••••••••••••••';
}

function loadAiKeysDisplay() {
  loadGroqKeyDisplay();
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
  const hasKey = _getGroqKey() || _getGeminiKey();
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

// ─── GENERACIÓN MASIVA DE DESCRIPCIONES ──────────────────────────────────────

let _bulkCancelled = false;
let _bulkAbortCtrl  = null;   // AbortController activo para cancelar fetch inmediatamente

// Modelo rápido para bulk
const GROQ_BULK_MODEL = 'llama-3.1-8b-instant';
// Pausa entre cada producto (ms) — respeta rate limit de Groq (~30 req/min)
const BULK_DELAY_MS   = 2200;

/** Actualiza barra de progreso y log */
function _bulkSetProgress(current, total, logLine, status) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar  = document.getElementById('bulkDescBar');
  const ctr  = document.getElementById('bulkDescCounter');
  const stat = document.getElementById('bulkDescStatus');
  const log  = document.getElementById('bulkDescLog');
  if (bar)  bar.style.width  = pct + '%';
  if (ctr)  ctr.textContent  = `${current} / ${total} productos`;
  if (stat) stat.textContent = status;
  if (log && logLine) {
    const d = document.createElement('div');
    d.textContent = logLine;
    d.style.cssText = 'padding:2px 0;border-bottom:1px solid #ede9fe';
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
}

function _bulkStyleBtn(el, state) {
  if (!el) return;
  const BASE = 'border-radius:10px;padding:10px 32px;font-size:.95rem;cursor:pointer;font-weight:700;min-width:150px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:2px solid;transition:all .2s;letter-spacing:.01em';
  const THEMES = {
    cancel:            { bg:'#fff1f2', border:'#fca5a5', color:'#b91c1c', cursor:'pointer',     icon:'fa-stop-circle',       label:'Cancelar proceso', disabled: false },
    cancelling:        { bg:'#f3f4f6', border:'#d1d5db', color:'#6b7280', cursor:'not-allowed', icon:'fa-spinner fa-spin',   label:'Cancelando…',      disabled: true  },
    'close-ok':        { bg:'#ecfdf5', border:'#6ee7b7', color:'#047857', cursor:'pointer',     icon:'fa-check-circle',      label:'¡Listo! Cerrar',   disabled: false },
    'close-cancelled': { bg:'#fffbeb', border:'#fcd34d', color:'#92400e', cursor:'pointer',     icon:'fa-times-circle',      label:'Cerrar',           disabled: false },
    'close-error':     { bg:'#fff1f2', border:'#fca5a5', color:'#b91c1c', cursor:'pointer',     icon:'fa-exclamation-circle',label:'Cerrar',           disabled: false },
  };
  const t = THEMES[state] || THEMES.cancel;
  el.disabled  = t.disabled;
  el.innerHTML = `<i class="fas ${t.icon}"></i> ${t.label}`;
  el.style.cssText = `${BASE};background:${t.bg};border-color:${t.border};color:${t.color};cursor:${t.cursor}${t.disabled ? ';opacity:.7' : ''}`;
}

function aiBulkCancel() {
  _bulkCancelled = true;
  if (_bulkAbortCtrl) { _bulkAbortCtrl.abort(); _bulkAbortCtrl = null; }
  const b = document.getElementById('btnBulkCancel');
  _bulkStyleBtn(b, 'cancelling');
}

function _bulkClose() {
  const o = document.getElementById('bulkDescOverlay');
  if (o) o.style.display = 'none';
  const b = document.getElementById('btnBulkDesc');
  if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Describir todos con IA'; }
}

/**
 * Genera descripción de UN solo producto con Groq.
 * Prompt simple, sin JSON, sin lotes — máxima tasa de éxito.
 */
async function _bulkGenerateOne(product) {
  _bulkAbortCtrl = new AbortController();
  const signal   = _bulkAbortCtrl.signal;
  const key      = _getGroqKey();

  if (!key) throw new Error('NO_KEY_GROQ');

  const catLabel  = product.category ? ` (${product.category})` : '';
  const unitLabel = product.unit     ? `, presentación: ${product.unit}` : '';
  const prompt    = `Escribe 1 sola oración de descripción para el producto de supermercado: "${product.name}"${catLabel}${unitLabel}. Máximo 25 palabras. Sin comillas, sin precio, sin punto aparte. Español dominicano, tono amigable.`;

  const res = await fetch(GROQ_API_URL, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body   : JSON.stringify({
      model      : GROQ_BULK_MODEL,
      messages   : [{ role: 'user', content: prompt }],
      max_tokens : 60,
      temperature: 0.7
    }),
    signal
  });

  if (res.status === 429) {
    // Rate limit — esperar 8 segundos y reintentar una vez
    await _sleep(8000);
    if (_bulkCancelled) throw new Error('AbortError');
    return _bulkGenerateOne(product);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  _bulkAbortCtrl = null;
  return text;
}

/**
 * Proceso principal: genera descripciones UNO POR UNO.
 * Sin JSON, sin lotes → tasa de éxito ~99%.
 * Pausa de 2.2s entre cada producto → respeta rate limit de Groq.
 */
async function aiBulkDescribe() {
  if (!_getGroqKey()) {
    showAdminToast('⚠️ Configura la API key de Groq en Configuración → IA', 'warn');
    return;
  }

  _bulkCancelled = false;
  _bulkAbortCtrl  = null;
  const overlay   = document.getElementById('bulkDescOverlay');
  const logEl     = document.getElementById('bulkDescLog');
  const cancelBtn = document.getElementById('btnBulkCancel');
  const mainBtn   = document.getElementById('btnBulkDesc');

  if (overlay)   overlay.style.display = 'flex';
  if (logEl)     logEl.innerHTML = '';
  if (mainBtn) { mainBtn.disabled = true; mainBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando…'; }
  if (cancelBtn) { _bulkStyleBtn(cancelBtn, 'cancel'); cancelBtn.onclick = aiBulkCancel; }

  try {
    // ── 1. Cargar TODOS los productos ──────────────────────────────────────────
    _bulkSetProgress(0, 0, null, 'Cargando productos…');
    let all = [], page = 1;
    while (true) {
      _bulkSetProgress(0, 0, `📦 Cargando página ${page}…`, 'Cargando productos…');
      const resp = await fetch(`tables/products?limit=500&page=${page}`);
      if (!resp.ok) throw new Error(`Error al cargar productos (HTTP ${resp.status})`);
      const json  = await resp.json();
      const chunk = (json.data || []).filter(p => !p.deleted);
      all = all.concat(chunk);
      if (chunk.length < 500) break;
      page++;
    }

    // Procesar TODOS (reescribe también los que ya tienen descripción)
    const todo = all;

    if (todo.length === 0) {
      _bulkSetProgress(0, 0, null, '⚠️ No hay productos en la base de datos');
      if (cancelBtn) { _bulkStyleBtn(cancelBtn, 'close-ok'); cancelBtn.onclick = () => _bulkClose(); }
      return;
    }

    const minEst = Math.ceil(todo.length * BULK_DELAY_MS / 60000);
    _bulkSetProgress(0, todo.length, `📋 Reescribiendo descripciones de ${all.length} productos`,
      `Procesando uno por uno — aprox. ${minEst} min`);
    await _sleep(600);

    let done = 0, errors = 0;

    // ── 2. Procesar UNO POR UNO ───────────────────────────────────────────────
    for (let i = 0; i < todo.length; i++) {
      if (_bulkCancelled) {
        _bulkSetProgress(done, todo.length, null, `⛔ Cancelado — ${done} generadas`);
        break;
      }

      const p = todo[i];

      try {
        const desc = await _bulkGenerateOne(p);

        if (desc && desc.length > 5) {
          await _apiPatch('products', p.id, { description: desc });
          done++;
          _bulkSetProgress(done, todo.length,
            `✅ ${p.name}`,
            `${done} / ${todo.length} guardados`);
        } else {
          errors++;
          _bulkSetProgress(done, todo.length, `⚠️ ${p.name} (respuesta vacía)`, null);
        }
      } catch (e) {
        if (e.name === 'AbortError' || _bulkCancelled) {
          _bulkCancelled = true;
          _bulkSetProgress(done, todo.length, null, `⛔ Cancelado — ${done} generadas`);
          break;
        }
        errors++;
        _bulkSetProgress(done, todo.length, `❌ ${p.name} — ${e.message}`, null);
      }

      // Pausa entre productos para no saturar el rate limit
      if (!_bulkCancelled && i < todo.length - 1) {
        await _sleep(BULK_DELAY_MS);
      }
    }

    // ── 3. Resultado final ────────────────────────────────────────────────────
    const bar = document.getElementById('bulkDescBar');
    const msg = _bulkCancelled
      ? `⛔ Cancelado. ${done} generadas, ${errors} con error.`
      : `🎉 ¡Listo! ${done} descripciones generadas${errors > 0 ? `, ${errors} con error` : ''}.`;

    _bulkSetProgress(done, todo.length, null, msg);
    if (bar) bar.style.background = _bulkCancelled ? '#f59e0b' : '#059669';

    if (cancelBtn) {
      _bulkStyleBtn(cancelBtn, _bulkCancelled ? 'close-cancelled' : 'close-ok');
      cancelBtn.onclick = () => {
        _bulkClose();
        if (typeof renderProductsTable === 'function') renderProductsTable();
      };
    }

    if (!_bulkCancelled) {
      showAdminToast(`✨ ${done} descripciones generadas con IA`, 'success');
      setTimeout(() => {
        _bulkClose();
        if (typeof renderProductsTable === 'function') renderProductsTable();
      }, 4000);
    }

  } catch (e) {
    console.error('[BulkDescribe] Error:', e);
    _bulkSetProgress(0, 0, `❌ Error: ${e.message}`, '❌ Proceso detenido por error');
    const bar = document.getElementById('bulkDescBar');
    if (bar) bar.style.background = '#ef4444';
    const cb = document.getElementById('btnBulkCancel');
    if (cb) { _bulkStyleBtn(cb, 'close-error'); cb.onclick = () => _bulkClose(); }
    showAdminToast('❌ ' + e.message, 'error');
  }
}

/** Pausa */
function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Actualiza barra de progreso y log */
function _bulkSetProgress(current, total, logLine, status) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar  = document.getElementById('bulkDescBar');
  const ctr  = document.getElementById('bulkDescCounter');
  const stat = document.getElementById('bulkDescStatus');
  const log  = document.getElementById('bulkDescLog');
  if (bar)  bar.style.width  = pct + '%';
  if (ctr)  ctr.textContent  = `${current} / ${total} productos`;
  if (stat) stat.textContent = status;
  if (log && logLine) {
    const d = document.createElement('div');
    d.textContent = logLine;
    d.style.cssText = 'padding:2px 0;border-bottom:1px solid #ede9fe';
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
}

/**
 * Aplica estilos visuales al btn de cancelar/cerrar según el estado.
 * states: 'cancel' | 'cancelling' | 'close-ok' | 'close-cancelled' | 'close-error'
 */
function _bulkStyleBtn(el, state) {
  if (!el) return;
  const BASE = 'border-radius:10px;padding:10px 32px;font-size:.95rem;cursor:pointer;font-weight:700;min-width:150px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:2px solid;transition:all .2s;letter-spacing:.01em';
  const THEMES = {
    // Botón Cancelar activo — rojo claro
    cancel:           { bg:'#fff1f2', border:'#fca5a5', color:'#b91c1c', cursor:'pointer',        icon:'fa-stop-circle',   label:'Cancelar proceso',    disabled: false },
    // Estado transitorio “Cancelando…” — naranja/gris
    cancelling:       { bg:'#f3f4f6', border:'#d1d5db', color:'#6b7280', cursor:'not-allowed',    icon:'fa-spinner fa-spin',label:'Cancelando…',        disabled: true  },
    // Éxito — verde
    'close-ok':       { bg:'#ecfdf5', border:'#6ee7b7', color:'#047857', cursor:'pointer',        icon:'fa-check-circle',  label:'¡Listo! Cerrar',      disabled: false },
    // Cancelado — amarillo/ambar
    'close-cancelled':{ bg:'#fffbeb', border:'#fcd34d', color:'#92400e', cursor:'pointer',        icon:'fa-times-circle',  label:'Cerrar',              disabled: false },
    // Error — rojo
    'close-error':    { bg:'#fff1f2', border:'#fca5a5', color:'#b91c1c', cursor:'pointer',        icon:'fa-exclamation-circle',label:'Cerrar',           disabled: false },
  };
  const t = THEMES[state] || THEMES.cancel;
  el.disabled  = t.disabled;
  el.innerHTML = `<i class="fas ${t.icon}"></i> ${t.label}`;
  el.style.cssText = `${BASE};background:${t.bg};border-color:${t.border};color:${t.color};cursor:${t.cursor}${t.disabled ? ';opacity:.7' : ''}`;
}

function aiBulkCancel() {
  _bulkCancelled = true;
  // Abortar inmediatamente cualquier fetch en curso
  if (_bulkAbortCtrl) { _bulkAbortCtrl.abort(); _bulkAbortCtrl = null; }
  const b = document.getElementById('btnBulkCancel');
  _bulkStyleBtn(b, 'cancelling');
}

function _bulkClose() {
  const o = document.getElementById('bulkDescOverlay');
  if (o) o.style.display = 'none';
  const b = document.getElementById('btnBulkDesc');
  if (b) { b.disabled = false; b.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Describir todos con IA'; }
}

/**
 * Hace la llamada IA con el modelo rápido (8b) para el bulk.
 * Fallback al sistema normal si falla.
 */
async function _bulkAiRequest(prompt) {
  // Crear un nuevo AbortController para esta petición
  _bulkAbortCtrl = new AbortController();
  const signal  = _bulkAbortCtrl.signal;

  const key = _getGroqKey();
  if (key) {
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: GROQ_BULK_MODEL,
          messages: [
            { role: 'system', content: 'Eres experto en marketing de supermercado dominicano. REGLA ESTRICTA: escribe EXACTAMENTE 1 sola oración por producto, máximo 25 palabras, sin punto aparte, sin segunda oración, sin saltos de línea. Ejemplo: "Las Galletas Sandwich de Fresa Dino son delicadas galletas con relleno de fresa dulce, ideales para un aperitivo saludable y delicioso." Tono amigable, español dominicano. Nunca mencionas precios.' },
            { role: 'user',   content: prompt }
          ],
          max_tokens: 80,
          temperature: 0.7
        }),
        signal
      });
      if (res.ok) {
        const d = await res.json();
        const t = d.choices?.[0]?.message?.content || '';
        if (t) { _bulkAbortCtrl = null; return t; }
      }
    } catch (e) {
      // Si fue un abort manual, relanzar para que el caller lo detecte
      if (e.name === 'AbortError') throw e;
      /* failover a otro modelo */
    }
  }
  const { text } = await _aiRequest(prompt, 700);
  _bulkAbortCtrl = null;
  return text;
}

// (función aiBulkDescribe definida más arriba — versión uno-por-uno)

async function _aiBulkDescribe_UNUSED_LEGACY() {
  // FUNCIÓN ANTIGUA CON LOTES — NO USAR
  if (!_getGroqKey() && !_getGeminiKey()) {
    return;
  }

  _bulkCancelled = false;
  _bulkAbortCtrl  = null;
  const overlay   = document.getElementById('bulkDescOverlay');
  const logEl     = document.getElementById('bulkDescLog');
  const cancelBtn = document.getElementById('btnBulkCancel');
  const mainBtn   = document.getElementById('btnBulkDesc');

  if (overlay)   overlay.style.display = 'flex';
  if (logEl)     logEl.innerHTML = '';
  if (mainBtn) {
    mainBtn.disabled = true;
    mainBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando…';
  }
  if (cancelBtn) {
    _bulkStyleBtn(cancelBtn, 'cancel');
    cancelBtn.onclick = aiBulkCancel;
  }

  try {
    // 1. Cargar TODOS los productos con paginación (por si hay más de 500)
    _bulkSetProgress(0, 0, null, 'Cargando productos…');
    let all = [];
    let page = 1;
    while (true) {
      _bulkSetProgress(0, 0, `📦 Cargando página ${page}…`, 'Cargando productos…');
      const resp = await fetch(`tables/products?limit=500&page=${page}`);
      if (!resp.ok) throw new Error(`Error al cargar productos (HTTP ${resp.status})`);
      const json = await resp.json();
      const chunk = (json.data || []).filter(p => !p.deleted);
      all = all.concat(chunk);
      _bulkSetProgress(0, 0, `✅ ${all.length} productos cargados`, 'Cargando productos…');
      if (chunk.length < 500) break;
      page++;
    }

    if (all.length === 0) {
      _bulkClose();
      showAdminToast('⚠️ No se encontraron productos', 'warn');
      return;
    }

    const todo = all; // siempre reescribir todos

    _bulkSetProgress(0, todo.length, null,
      `${todo.length} productos pendientes — lotes de ${BULK_BATCH_SIZE} — aprox. ${Math.ceil(todo.length / BULK_BATCH_SIZE * (BULK_DELAY_MS + 2000) / 60000)} min`);
    await _sleep(500);

    let done = 0, errors = 0;

    // 2. Procesar en lotes
    for (let i = 0; i < todo.length; i += BULK_BATCH_SIZE) {
      if (_bulkCancelled) {
        _bulkSetProgress(done, todo.length, null, `⛔ Cancelado — ${done} generadas`);
        break;
      }

      const batch = todo.slice(i, i + BULK_BATCH_SIZE);

      // Prompt de lote: un solo request para N productos → respuesta JSON
      const lista = batch.map((p, idx) =>
        `${idx + 1}. "${p.name}"${p.category ? ` [${p.category}]` : ''}${p.unit ? ` (${p.unit})` : ''}`
      ).join('\n');

      const prompt =
        `Genera descripciones para ${batch.length} productos de supermercado dominicano.\n` +
        `Cada descripción: EXACTAMENTE 2 oraciones cortas. MÁXIMO 45 palabras por descripción.\n` +
        `- Oración 1: qué es el producto y su beneficio principal.\n` +
        `- Oración 2: usos o razón para comprarlo.\n` +
        `Español dominicano, amigable. Sin precio, sin comillas externas, sin asteriscos.\n` +
        `Responde SOLO con JSON válido:\n` +
        `{"1":"desc 1","2":"desc 2",...}\n\nProductos:\n${lista}`;

      let results = {};
      try {
        const raw   = await _bulkAiRequest(prompt);
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) results = JSON.parse(match[0]);
      } catch (e) {
        // Si fue cancelación manual, salir del lote sin fallback
        if (e.name === 'AbortError' || _bulkCancelled) {
          _bulkSetProgress(done, todo.length, null, `⛔ Cancelado — ${done} generadas`);
          break;
        }
        // Si el lote falla por otro motivo, procesar uno a uno como respaldo
        for (let j = 0; j < batch.length; j++) {
          if (_bulkCancelled) break;
          try {
            const p  = batch[j];
            const fp = `Escribe una descripción para el producto "${p.name}"${p.category ? ` (${p.category})` : ''} en 2 oraciones fluidas (40-60 palabras total). Primera oración: qué es y su beneficio principal. Segunda: usos concretos o razón de compra. Español dominicano, tono amigable. Sin precio, sin comillas, sin asteriscos.`;
            const { text } = await _aiRequest(fp, 180);
            if (text) results[String(j + 1)] = text.trim();
          } catch (_) {}
        }
      }

      // Guardar cada resultado del lote — verificar cancelación en cada ítem
      for (let j = 0; j < batch.length; j++) {
        if (_bulkCancelled) break;   // ← salida inmediata al guardar
        const p    = batch[j];
        const desc = (results[String(j + 1)] || '').trim();
        if (desc) {
          try {
            await _apiPatch('products', p.id, { description: desc });
            done++;
            _bulkSetProgress(done, todo.length, `✅ ${p.name}`, `Lote ${Math.ceil((i + BULK_BATCH_SIZE) / BULK_BATCH_SIZE)} — ${done}/${todo.length} guardados`);
          } catch (_) {
            errors++;
            _bulkSetProgress(done, todo.length, `❌ ${p.name} (error al guardar)`, null);
          }
        } else {
          errors++;
          _bulkSetProgress(done, todo.length, `⚠️ ${p.name} (sin descripción)`, null);
        }
      }

      // Pausa entre lotes
      if (!_bulkCancelled && i + BULK_BATCH_SIZE < todo.length) {
        await _sleep(BULK_DELAY_MS);
      }
    }

    // 3. Resultado final
    const bar = document.getElementById('bulkDescBar');
    const msg = _bulkCancelled
      ? `⛔ Cancelado. ${done} generadas, ${errors} sin resultado.`
      : `🎉 ¡Listo! ${done} descripciones generadas${errors > 0 ? `, ${errors} sin resultado` : ''}.`;

    _bulkSetProgress(done, todo.length, null, msg);
    if (bar) bar.style.background = _bulkCancelled ? '#f59e0b' : '#059669';

    // Botón Cerrar con estilo según resultado
    if (cancelBtn) {
      _bulkStyleBtn(cancelBtn, _bulkCancelled ? 'close-cancelled' : 'close-ok');
      cancelBtn.onclick = () => {
        _bulkClose();
        if (typeof renderProductsTable === 'function') renderProductsTable();
      };
    }

    if (!_bulkCancelled) {
      showAdminToast(`✨ ${done} descripciones generadas con IA`, 'success');
      // Cerrar automáticamente después de 3 segundos y recargar tabla
      setTimeout(() => {
        _bulkClose();
        if (typeof renderProductsTable === 'function') renderProductsTable();
      }, 3000);
    }

  } catch (e) {
    console.error('[BulkDescribe] Error:', e);
    // Mostrar error en el overlay en vez de cerrarlo abruptamente
    _bulkSetProgress(0, 0, `❌ Error: ${e.message}`, '❌ Proceso detenido por error');
    const bar = document.getElementById('bulkDescBar');
    if (bar) bar.style.background = '#ef4444';
    const cancelBtn2 = document.getElementById('btnBulkCancel');
    if (cancelBtn2) {
      _bulkStyleBtn(cancelBtn2, 'close-error');
      cancelBtn2.onclick = () => _bulkClose();
    }
    showAdminToast('❌ ' + e.message, 'error');
  }
}

/** Pausa entre lotes */
function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
