/**
 * SUPERMERCADO CASA MOTA — CHAT.JS
 * Asistente de compras IA para clientes (app móvil)
 * Usa Groq como servicio principal (gratuito y rápido)
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const _CHAT_GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const _CHAT_GROQ_MODEL = 'llama-3.1-8b-instant'; // Modelo ligero: 20K tokens/min vs 6K del 70b
const _CHAT_FETCH_TIMEOUT_MS = 8000; // 8 s máximo para fetches internos del chat

/** fetch con timeout automático — evita colgar el chat indefinidamente */
function _chatFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), _CHAT_FETCH_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// Cache en memoria para evitar llamadas repetidas a la DB
let _chatGroqKeyCache = null;

/**
 * Obtiene la clave Groq:
 * 1) Memoria (cache)
 * 2) localStorage
 * 3) Base de datos (tabla settings → groqApiKey)
 * NO se usa clave hardcodeada — se guarda desde Admin → Configuración → IA
 */
async function _chatGroqKey() {
  // 1) Cache en memoria (evita llamadas repetidas)
  if (_chatGroqKeyCache && _chatGroqKeyCache.startsWith('gsk_')) return _chatGroqKeyCache;

  // 2) localStorage
  const local = localStorage.getItem('groq_api_key');
  if (local && local.startsWith('gsk_')) {
    _chatGroqKeyCache = local;
    return local;
  }

  // 3) Base de datos
  try {
    const res  = await _supaFetch('settings?select=*&limit=1', {});
    const data = res;
    const key  = data[0]?.groqApiKey;
    if (key && key.startsWith('gsk_')) {
      _chatGroqKeyCache = key;
      localStorage.setItem('groq_api_key', key); // cachear para próximas veces
      return key;
    }
  } catch(e) { console.warn('[Chat] No se pudo obtener clave Groq desde DB:', e.message); }

  return null; // Sin clave disponible
}

// ── Precargar clave Groq desde DB al iniciar ─────────────────────────────────
// Cualquier dispositivo nuevo la obtiene automáticamente sin configuración manual
(async function _preloadChatGroqKey() {
  try {
    const local = localStorage.getItem('groq_api_key');
    if (local && local.startsWith('gsk_') && local.length > 20) {
      _chatGroqKeyCache = local;
      return; // Ya la tenemos
    }
    const res  = await _supaFetch('settings?select=*&limit=1', {});
    const data = res;
    const key  = data[0]?.groqApiKey;
    if (key && key.startsWith('gsk_') && key.length > 20) {
      _chatGroqKeyCache = key;
      localStorage.setItem('groq_api_key', key);
      console.log('[Chat] Clave Groq cargada desde DB ✅');
    }
  } catch(e) {
    console.warn('[Chat] Error precargando clave Groq:', e.message);
  }
})();

// ─── ESTADO ──────────────────────────────────────────────────────────────────
let _chatOpen           = false;
let _chatHistory        = [];   // [{ role, content }]
let _chatProdCache      = [];   // Productos cargados
let _chatInited         = false;
let _chatTyping         = false;
let _unreadCount        = 0;
let _pendingCartProducts = []; // Productos pendientes de confirmar para agregar al carrito
let _chatStoreInfo      = null; // Datos de contacto del supermercado

/** Carga los datos de contacto del supermercado desde settings */
async function _chatLoadStoreInfo() {
  if (_chatStoreInfo) return; // Ya cargados
  try {
    const res  = await _supaFetch('settings?select=*&limit=1', {});
    const data = res;
    const s    = data[0] || {};
    _chatStoreInfo = {
      name:     s.storeName     || 'Supermercado Casa Mota',
      address:  s.storeAddress  || 'Ave. Melchor Contín Alfau No.5, Centro, Hato Mayor del Rey',
      phone:    s.storePhone    || '',
      email:    s.storeEmail    || '',
      hoursWk:  s.hoursWeekday  || '',
      hoursSun: s.hoursSunday   || '',
      whatsapp: s.whatsapp      || s.storePhone || '',
      delivery: s.deliveryZones || 'Santo Domingo y zonas metropolitanas',
      shippingFee:    s.shippingFee     || '150',
      freeShippingMin: s.freeShippingMin || '1500',
    };
  } catch(_) {
    // Datos por defecto si falla la carga
    _chatStoreInfo = {
      name:     'Supermercado Casa Mota',
      address:  'Ave. Melchor Contín Alfau No.5, Centro, Hato Mayor del Rey',
      phone:    '',
      email:    '',
      hoursWk:  '',
      hoursSun: '',
      whatsapp: '',
      delivery: 'Santo Domingo y zonas metropolitanas',
      shippingFee: '150',
      freeShippingMin: '1500',
    };
  }
}

// ─── MODO: cliente o admin ────────────────────────────────────────────────────
const _IS_ADMIN = !!(window._CHAT_IS_ADMIN);

// ─── DETECCIÓN DE INTENCIÓN DE CARRITO ──────────────────────────────────────
// Palabras clave que indican que el cliente quiere agregar al carrito
const _CART_KEYWORDS = [
  'agrega', 'agregar', 'añade', 'añadir', 'pon', 'poner', 'quiero', 'dame',
  'necesito', 'compra', 'comprar', 'carrito', 'pedido', 'incluye', 'incluir',
  'métele', 'mete', 'agréga', 'añáde', 'lleva', 'llevar', 'trae', 'traer'
];

/**
 * Detecta si el mensaje del usuario tiene intención de agregar al carrito.
 * Retorna true si hay al menos una palabra clave de carrito.
 */
function _hasCartIntent(msg) {
  if (_IS_ADMIN) return false; // En admin no aplica
  const lower = msg.toLowerCase();
  return _CART_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Busca un producto en el caché por nombre (coincidencia parcial, sin acentos).
 * Retorna el objeto producto o null.
 */
function _findProductByName(name) {
  const normalize = s => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const needle = normalize(name);
  // Primero intenta coincidencia exacta al inicio
  let found = _chatProdCache.find(p => normalize(p.name).startsWith(needle));
  if (!found) {
    // Luego coincidencia parcial
    found = _chatProdCache.find(p => normalize(p.name).includes(needle) || needle.includes(normalize(p.name).split(' ')[0]));
  }
  return found || null;
}

/**
 * Extrae productos mencionados en el texto de respuesta de la IA.
 * Busca coincidencias con el catálogo cargado.
 */
function _extractMentionedProducts(text) {
  const found = [];
  const normalize = s => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normText = normalize(text);

  for (const p of _chatProdCache) {
    // Buscar por nombre completo o primeras 2 palabras del nombre
    const nameParts = normalize(p.name).split(' ');
    const shortName = nameParts.slice(0, 2).join(' ');
    if (normText.includes(normalize(p.name)) || (shortName.length > 4 && normText.includes(shortName))) {
      if (!found.find(f => f.id === p.id)) {
        found.push(p);
      }
    }
  }
  return found.slice(0, 6); // Máx 6 productos para no saturar la UI
}

/**
 * Agrega un producto al carrito directamente desde el caché del chat.
 * Evita depender de getLiveProducts() que puede tener datos incompletos.
 */
function _chatAddToCart(productId, productName, qty = 1) {
  // 1) Buscar el objeto producto en _chatProdCache por ID
  let prod = productId ? _chatProdCache.find(p => String(p.id) === String(productId)) : null;

  // 2) Si no lo encontramos por ID, intentar por nombre
  if (!prod && productName) {
    prod = _findProductByName(productName);
  }

  if (!prod) {
    _chatAppendMsg('bot',
      `⚠️ No encontré "${productName}" en el catálogo. Por favor búscalo en la tienda directamente.`);
    return;
  }

  // 3) Agregar directo al carrito sin pasar por getLiveProducts()
  //    Primero intentamos con la función addToCart estándar
  if (typeof addToCart === 'function') {
    // Asegurarse de que _liveProducts incluya este producto
    // para que addToCart() lo encuentre
    if (typeof _liveProducts !== 'undefined' && _liveProducts) {
      const alreadyInLive = _liveProducts.find(p => String(p.id) === String(prod.id));
      if (!alreadyInLive) {
        _liveProducts.push(prod);
      }
    }
    addToCart(prod.id, qty);
  } else if (typeof cart !== 'undefined') {
    // Fallback: manipular cart directamente
    const existing = cart.find(c => String(c.id) === String(prod.id));
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ ...prod, qty });
    }
    if (typeof saveCart === 'function') saveCart();
    if (typeof updateCartUI === 'function') updateCartUI();
    if (typeof showToast === 'function') showToast(`<i class="fas fa-check"></i> ${prod.name} agregado al carrito`, 'success');
  } else {
    _chatAppendMsg('bot',
      `⚠️ No pude agregar el producto. Por favor búscalo en la tienda directamente.`);
    return;
  }

  // Mensaje de confirmación
  _chatAppendMsg('bot',
    `✅ ¡Listo! **${prod.name}** fue agregado a tu carrito. ¿Quieres agregar algo más? 🛒`);
  const box = document.getElementById('chatMessages');
  if (box) box.scrollTop = box.scrollHeight;
}

/**
 * Renderiza botones de acción de carrito debajo de una respuesta del bot.
 * Permite selección múltiple — la lista no se cierra al seleccionar un producto.
 * products: array de { id, name, price, category }
 */
function _chatRenderCartButtons(products) {
  if (!products || products.length === 0) return;
  const box = document.getElementById('chatMessages');
  if (!box) return;

  const wrap = document.createElement('div');
  wrap.className = 'chat-cart-actions';

  // Label
  const label = document.createElement('div');
  label.className = 'chat-cart-label';
  label.innerHTML = '<i class="fas fa-cart-plus"></i> ¿Agregar al carrito? <span class="chat-cart-hint">Selecciona uno o varios</span>';
  wrap.appendChild(label);

  // Conjunto de productos seleccionados
  const selected = new Set();

  // Botón por producto
  products.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'chat-cart-btn';
    btn.dataset.pid  = p.id   || '';
    btn.dataset.name = p.name || '';
    btn.innerHTML = `<i class="fas fa-plus" id="icon-${p.id}"></i> ${p.name.substring(0, 35)}${p.name.length > 35 ? '…' : ''} <span class="chat-cart-price">RD$${p.price}</span>`;

    btn.addEventListener('click', () => {
      if (selected.has(p.id)) {
        // Deseleccionar
        selected.delete(p.id);
        btn.classList.remove('chat-cart-btn-selected');
        btn.querySelector('i').className = 'fas fa-plus';
      } else {
        // Seleccionar
        selected.add(p.id);
        btn.classList.add('chat-cart-btn-selected');
        btn.querySelector('i').className = 'fas fa-check';
      }
      // Actualizar contador en botón "Listo"
      const count = selected.size;
      doneBtn.textContent = count > 0 ? `✅ Listo (${count})` : '✅ Listo';
      doneBtn.disabled = count === 0;
    });
    wrap.appendChild(btn);
  });

  // Fila de acciones finales
  const actionsRow = document.createElement('div');
  actionsRow.className = 'chat-cart-actions-row';

  // Botón "No, gracias"
  const dismiss = document.createElement('button');
  dismiss.className = 'chat-cart-dismiss';
  dismiss.textContent = 'No, gracias';
  dismiss.addEventListener('click', () => {
    _pendingCartProducts = [];
    wrap.remove();
  });
  actionsRow.appendChild(dismiss);

  // Botón "Listo"
  const doneBtn = document.createElement('button');
  doneBtn.className = 'chat-cart-done';
  doneBtn.textContent = '✅ Listo';
  doneBtn.disabled = true;
  doneBtn.addEventListener('click', () => {
    const toAdd = products.filter(p => selected.has(p.id));
    _pendingCartProducts = [];
    wrap.remove();

    if (toAdd.length > 0) {
      toAdd.forEach(p => {
        // Asegurarse de que _liveProducts incluya este producto
        if (typeof _liveProducts !== 'undefined' && _liveProducts) {
          const alreadyInLive = _liveProducts.find(lp => String(lp.id) === String(p.id));
          if (!alreadyInLive) _liveProducts.push(p);
        }
        if (typeof addToCart === 'function') addToCart(p.id, 1);
        else if (typeof cart !== 'undefined') {
          const ex = cart.find(c => String(c.id) === String(p.id));
          if (ex) ex.qty += 1;
          else cart.push({ ...p, qty: 1 });
          if (typeof saveCart === 'function') saveCart();
          if (typeof updateCartUI === 'function') updateCartUI();
        }
      });
      _chatAppendMsg('bot', `✅ ¡Listo! Agregué al carrito: **${toAdd.map(p => p.name).join(', ')}**. ¿Necesitas algo más? 🛒`);
      const b = document.getElementById('chatMessages');
      if (b) b.scrollTop = b.scrollHeight;
    }
  });
  actionsRow.appendChild(doneBtn);

  wrap.appendChild(actionsRow);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

// Sugerencias para clientes (tienda)
const _QUICK_SUGGESTIONS_STORE = [
  '¿Qué ofertas tienen hoy?',
  'Necesito ingredientes para sancocho',
  '¿Cuánto cuesta el pollo?',
  'Arma mi lista para una barbacoa',
  '¿Tienen productos sin gluten?',
];

// Sugerencias para el equipo admin (gestión de la tienda)
const _QUICK_SUGGESTIONS_ADMIN = [
  '¿Cuáles productos tienen poco stock?',
  'Dame ideas de descripciones para frutas',
  '¿Qué categorías tienen más productos?',
  'Sugiere precios competitivos para aceites',
  '¿Cómo puedo mejorar las ventas de carnes?',
];

const _QUICK_SUGGESTIONS = _IS_ADMIN ? _QUICK_SUGGESTIONS_ADMIN : _QUICK_SUGGESTIONS_STORE;

// ─── INICIALIZACIÓN ───────────────────────────────────────────────────────────

/** Carga los productos en caché para dar contexto a la IA */
async function _chatLoadProducts() {
  if (_chatProdCache.length > 0) return; // Ya cargados
  try {
    const resp = await _supaFetch('products?select=id,name,category,price,badge,deleted&limit=500&order=name.asc', {});
    const data = resp;
    _chatProdCache = (data || [])
      .filter(p => !p.deleted && p.active !== false)
      .map(p => ({ id: p.id, name: p.name, category: p.category, price: p.price, badge: p.badge }));
  } catch (_) {
    _chatProdCache = [];
  }
}

// ─── TOGGLE CHAT ─────────────────────────────────────────────────────────────

function toggleChat() {
  _chatOpen = !_chatOpen;
  const panel = document.getElementById('chatPanel');
  // Usamos el wrapper para ocultar/mostrar FAB + badge juntos
  const wrap  = document.getElementById('chatFabWrap') || document.getElementById('chatFabBtn');
  const badge = document.getElementById('chatFabBadge');

  if (_chatOpen) {
    panel.classList.add('chat-open');
    // Ocultar el FAB completamente
    if (wrap) wrap.style.display = 'none';
    // Limpiar badge de no leídos
    _unreadCount = 0;
    if (badge) badge.style.display = 'none';
    // Init primera vez
    if (!_chatInited) {
      _chatInited = true;
      _chatRenderWelcome();
      // Pre-cargar en paralelo: productos, info de tienda y clave Groq
      // Para que el primer mensaje del usuario NO tenga que esperar ningún fetch
      Promise.all([
        _chatLoadProducts(),
        _chatLoadStoreInfo(),
        _chatGroqKey(),          // precalentar clave en cache
      ]).catch(() => {});        // ignorar errores de precarga
    }
    // Foco en input
    setTimeout(() => document.getElementById('chatMsgInput')?.focus(), 300);
  } else {
    panel.classList.remove('chat-open');
    // Mostrar el FAB de nuevo
    if (wrap) wrap.style.display = '';
  }
}

function closeChat() {
  _chatOpen = false;
  document.getElementById('chatPanel')?.classList.remove('chat-open');
  const wrap = document.getElementById('chatFabWrap') || document.getElementById('chatFabBtn');
  if (wrap) wrap.style.display = '';
}

// ─── RENDER MENSAJES ──────────────────────────────────────────────────────────

function _chatRenderWelcome() {
  const box = document.getElementById('chatMessages');
  if (!box) return;

  // Saludo según modo
  let greeting;
  if (_IS_ADMIN) {
    // Obtener nombre del administrador
    const adminName = (() => {
      try {
        const s = JSON.parse(localStorage.getItem('cm_admin_session') || localStorage.getItem('cm_user') || '{}');
        return s.name ? s.name.split(' ')[0] : '';
      } catch { return ''; }
    })();
    greeting = adminName ? `¡Hola, ${adminName}! 👋` : '¡Hola, equipo! 👋';
  } else {
    // Obtener nombre del cliente
    const clientName = (() => {
      try {
        const s = JSON.parse(localStorage.getItem('cm_client_session') || '{}');
        return s.name ? s.name.split(' ')[0] : '';
      } catch { return ''; }
    })();
    greeting = clientName ? `¡Hola, ${clientName}! 👋` : '¡Hola! 👋';
  }

  box.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-avatar">
        <img src="images/maya-avatar-v2.png" alt="Maya" style="width:100%;height:100%;object-fit:contain;border-radius:0">
      </div>
      <div class="chat-welcome-text">
        <strong>${greeting}</strong>
        ${_IS_ADMIN
          ? 'Soy <strong>Maya</strong>, tu asistente de gestión de <strong>Casa Mota</strong>. Puedo ayudarte con stock, precios, descripciones y estrategias para la tienda. 📊'
          : 'Soy el asistente virtual de <strong>Casa Mota</strong>. Puedo ayudarte a encontrar productos, precios y armar tu lista de compras. 🛒'
        }
      </div>
    </div>
    <div class="chat-suggestions" id="chatSuggestions">
      ${_QUICK_SUGGESTIONS.map(s =>
        `<button class="chat-suggestion-btn" onclick="_chatSendSuggestion('${s.replace(/'/g, "\\'")}')">${s}</button>`
      ).join('')}
    </div>`;
  box.scrollTop = box.scrollHeight;
}

function _chatAppendMsg(role, content, isTyping = false) {
  const box = document.getElementById('chatMessages');
  if (!box) return;

  // Ocultar sugerencias al primer mensaje
  const sugg = document.getElementById('chatSuggestions');
  if (sugg) sugg.style.display = 'none';

  const id    = isTyping ? 'chatTypingBubble' : '';
  const isBot = role === 'bot';
  const time  = new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });

  const bubble = document.createElement('div');
  bubble.className = `chat-row chat-row-${isBot ? 'bot' : 'user'}`;
  if (id) bubble.id = id;

  bubble.innerHTML = isBot
    ? `<div class="chat-avatar-sm"><img src="images/maya-avatar-v2.png" alt="Maya" style="width:100%;height:100%;object-fit:contain;border-radius:0"></div>
       <div class="chat-bubble-wrap">
         <div class="chat-bubble chat-bubble-bot">${
           isTyping
             ? `<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>`
             : _chatFormat(content)
         }</div>
         ${!isTyping ? `<span class="chat-time">${time}</span>` : ''}
       </div>`
    : `<div class="chat-bubble-wrap">
         <div class="chat-bubble chat-bubble-user">${_chatFormat(content)}</div>
         <span class="chat-time chat-time-user">${time}</span>
       </div>
       <div class="chat-avatar-sm chat-avatar-user"><i class="fas fa-user"></i></div>`;

  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
  return bubble;
}

/** Formatea el texto: saltos de línea, negritas, bullet points */
function _chatFormat(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/•\s?/g, '• ')
    .replace(/\n/g, '<br>');
}

// ─── ENVIAR MENSAJE ───────────────────────────────────────────────────────────

async function chatSend() {
  const input = document.getElementById('chatMsgInput');
  const msg   = input?.value?.trim();
  if (!msg || _chatTyping) return;
  input.value = '';
  input.style.height = 'auto';
  _chatSendMsg(msg);
}

function _chatSendSuggestion(text) {
  const input = document.getElementById('chatMsgInput');
  if (input) input.value = text;
  chatSend();
}

function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
}

function chatInputAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

async function _chatSendMsg(msg) {
  if (_chatTyping) return;

  // Mostrar mensaje usuario
  _chatAppendMsg('user', msg);
  _chatHistory.push({ role: 'user', content: msg });

  // Actualizar estado del botón de envío
  const sendBtn = document.getElementById('chatSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  // Esperar productos si no están listos
  await _chatLoadProducts();

  // Mostrar "escribiendo…"
  // ── Interceptar confirmación "sí" ANTES de llamar a la IA
  if (!_IS_ADMIN && _pendingCartProducts.length > 0) {
    const confirmWords = ['si', 'sí', 'yes', 'dale', 'ok', 'okay', 'claro', 'por favor', 'obvio', 'perfecto', 'adelante', 'venga', 'va', 'bueno'];
    const msgLower = msg.toLowerCase().trim();
    const isConfirm = confirmWords.some(w => msgLower === w || msgLower.startsWith(w + ' ') || msgLower.endsWith(' ' + w));

    if (isConfirm) {
      const toAdd = [..._pendingCartProducts];
      _pendingCartProducts = [];
      if (sendBtn) sendBtn.disabled = false;

      // Agregar cada producto usando el enfoque robusto (desde _chatProdCache)
      const added = [];
      toAdd.forEach(p => {
        // Asegurarse de que _liveProducts incluya este producto
        if (typeof _liveProducts !== 'undefined' && _liveProducts) {
          const alreadyInLive = _liveProducts.find(lp => String(lp.id) === String(p.id));
          if (!alreadyInLive) _liveProducts.push(p);
        }
        if (typeof addToCart === 'function') {
          addToCart(p.id, 1);
          added.push(p.name);
        } else if (typeof cart !== 'undefined') {
          const ex = cart.find(c => String(c.id) === String(p.id));
          if (ex) ex.qty += 1;
          else cart.push({ ...p, qty: 1 });
          if (typeof saveCart === 'function') saveCart();
          if (typeof updateCartUI === 'function') updateCartUI();
          added.push(p.name);
        }
      });

      if (added.length > 0) {
        _chatAppendMsg('bot', `✅ ¡Listo! Agregué al carrito: **${added.join(', ')}**. ¿Necesitas algo más? 🛒`);
      }
      return; // No llamar a la IA
    }
  }

  _chatTyping = true;
  const typingBubble = _chatAppendMsg('bot', '', true);

  try {
    const reply = await _chatCallAI(msg);

    // Reemplazar burbuja de typing con respuesta real
    if (typingBubble) {
      const time = new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
      typingBubble.innerHTML = `
        <div class="chat-avatar-sm"><img src="images/maya-avatar-v2.png" alt="Maya" style="width:100%;height:100%;object-fit:contain;border-radius:0"></div>
        <div class="chat-bubble-wrap">
          <div class="chat-bubble chat-bubble-bot">${_chatFormat(reply)}</div>
          <span class="chat-time">${time}</span>
        </div>`;
    }

    _chatHistory.push({ role: 'assistant', content: reply });

    // ── Buscar productos mencionados en la respuesta y guardarlos como pendientes
    if (!_IS_ADMIN) {
      const mentioned = _extractMentionedProducts(reply);
      if (mentioned.length > 0) {
        _pendingCartProducts = mentioned;
        setTimeout(() => _chatRenderCartButtons(mentioned), 200);
      } else {
        _pendingCartProducts = [];
      }
    }

    // Badge de no leídos si el chat está cerrado
    if (!_chatOpen) {
      _unreadCount++;
      const badge = document.getElementById('chatFabBadge');
      if (badge) { badge.textContent = _unreadCount; badge.style.display = 'flex'; }
    }
  } catch (e) {
    console.error('🔴 Chat AI error:', e.message, e);
    let errMsg;
    if (!navigator.onLine) {
      errMsg = '📵 Sin conexión a internet. Por favor verifica tu red e intenta de nuevo.';
    } else if (e.message && e.message.includes('Sin conexión')) {
      errMsg = '😕 Servicio de IA temporalmente no disponible. Por favor intenta en unos minutos.';
    } else {
      errMsg = '😕 No pude procesar tu consulta en este momento. Por favor intenta de nuevo.';
    }
    // Reemplazar burbuja de typing con mensaje de error (o agregar nuevo si ya fue removida)
    if (typingBubble && typingBubble.isConnected) {
      const bubble = typingBubble.querySelector('.chat-bubble');
      if (bubble) {
        bubble.innerHTML = _chatFormat(errMsg);
      } else {
        typingBubble.innerHTML = `
          <div class="chat-avatar-sm"><img src="images/maya-avatar-v2.png" alt="Maya" style="width:100%;height:100%;object-fit:contain;border-radius:0"></div>
          <div class="chat-bubble-wrap"><div class="chat-bubble chat-bubble-bot">${_chatFormat(errMsg)}</div></div>`;
      }
    } else {
      _chatAppendMsg('bot', errMsg);
    }
  } finally {
    _chatTyping = false;
    if (sendBtn) sendBtn.disabled = false;
    const box = document.getElementById('chatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }
}

// ─── LLAMADA A LA IA ──────────────────────────────────────────────────────────

/**
 * Filtra productos relevantes según el mensaje del usuario (máx 40).
 * Si hay keywords del mensaje, prioriza los productos cuyo nombre/categoría las incluyan.
 */
function _getRelevantProducts(userMsg) {
  const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = normalize(userMsg).split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return _chatProdCache.slice(0, 40);

  // Puntuar cada producto según relevancia
  const scored = _chatProdCache.map(p => {
    const pNorm = normalize(p.name + ' ' + (p.category || ''));
    let score = 0;
    words.forEach(w => { if (pNorm.includes(w)) score += 2; });
    return { p, score };
  });

  // Ordenar por score desc, tomar top 40
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 40).map(s => s.p);
}

async function _chatCallAI(userMsg) {
  // Contexto de productos: máx 15 más relevantes para no exceder tokens de Groq
  const relevant = _getRelevantProducts(userMsg).slice(0, 15);
  const catalog = relevant
    .map(p => `• ${p.name} RD$${p.price}${p.unit ? ' / ' + p.unit : ''}${p.badge ? ' [' + p.badge + ']' : ''}`)
    .join('\n');

  // ── Contexto del cliente logueado ─────────────────────────────────────────
  let clientContext = '';
  try {
    // currentClient es la variable global definida en app.js
    const cli = (typeof currentClient !== 'undefined') ? currentClient : null;
    if (cli) {
      // Puntos y nivel de fidelización
      const pts = cli.loyaltyPoints || 0;
      const levels = [
        { name:'Bronce', min:0    },
        { name:'Plata',  min:500  },
        { name:'Oro',    min:1500 },
        { name:'VIP',    min:3000 },
      ];
      const lvl = [...levels].reverse().find(l => pts >= l.min) || levels[0];

      // Favoritos guardados en localStorage
      let favNames = '';
      try {
        const favs = JSON.parse(localStorage.getItem('casamota_favorites') || '[]');
        if (favs.length > 0) {
          favNames = favs.slice(0, 10).map(f => f.name).join(', ');
        }
      } catch(_) {}

      clientContext = `
── CLIENTE ACTUAL ──
Nombre: ${cli.name}
Email: ${cli.email}
Teléfono: ${cli.phone || '—'}
Dirección: ${cli.address || '—'}, ${cli.city || '—'}
Pedidos realizados: ${cli.orders || 0}
Total gastado: RD$ ${(cli.spent || 0).toFixed(2)}
Puntos de fidelización: ${pts} pts (Nivel ${lvl.name})
${favNames ? 'Productos favoritos: ' + favNames : 'Sin favoritos guardados'}
──────────────────`;
    }
  } catch(_) {}

  // Historial reciente (últimos 6 mensajes, sin incluir el mensaje actual que viene por separado)
  // Nota: _chatHistory ya contiene el mensaje actual del usuario como último item
  // Por eso tomamos slice(-7, -1) para excluirlo y evitar duplicados
  const recentHistory = _chatHistory.slice(-7, -1)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

  const systemPrompt = _IS_ADMIN
    ? `Eres Maya, asistente de gestión interna del Supermercado Casa Mota. Llevas más de 70 años sirviendo a las familias dominicanas con productos frescos y calidad garantizada. Trabajas para el equipo administrativo y los ayudas con gestión de inventario, stock, precios, pedidos y estrategias comerciales.
Inventario actual (${_chatProdCache.length} productos, mostrando los más relevantes):
${catalog || 'Sin datos'}
Responde en español dominicano profesional, máx 3 oraciones. No inventes datos.`
    : `Eres Maya 🧡, la asistente virtual oficial del Supermercado Casa Mota. Fuiste creada exclusivamente para ayudar a los clientes de Casa Mota.

── QUIÉN ERES ──
Tu nombre es Maya. Eres la asistente virtual del Supermercado Casa Mota, con más de 70 años sirviendo a las familias dominicanas con productos frescos, marcas reconocidas y calidad garantizada.
Trabajas SOLO para Casa Mota. Si alguien pregunta para qué empresa trabajas, siempre respondes: "Soy Maya, la asistente virtual del Supermercado Casa Mota 🧡".
──────────────────
── INFORMACIÓN DEL SUPERMERCADO ──
Nombre: ${_chatStoreInfo?.name || 'Supermercado Casa Mota'}
Dirección: ${_chatStoreInfo?.address || 'Ave. Melchor Contín Alfau No.5, Centro, Hato Mayor del Rey, RD'}
${_chatStoreInfo?.phone    ? 'Teléfono: '        + _chatStoreInfo.phone      : ''}
${_chatStoreInfo?.email    ? 'Correo electrónico: ' + _chatStoreInfo.email   : ''}
${_chatStoreInfo?.whatsapp ? 'WhatsApp: '         + _chatStoreInfo.whatsapp  : ''}
${_chatStoreInfo?.hoursWk  ? 'Horario Lun–Sáb: '  + _chatStoreInfo.hoursWk  : ''}
${_chatStoreInfo?.hoursSun ? 'Horario Domingo: '   + _chatStoreInfo.hoursSun : ''}
Zona de entrega: ${_chatStoreInfo?.delivery || 'Hato Mayor del Rey y zonas cercanas'}
Costo de envío: RD$ ${_chatStoreInfo?.shippingFee || '150'} (¡gratis en pedidos ≥ RD$ ${_chatStoreInfo?.freeShippingMin || '1500'}!)
──────────────────
${clientContext}
── CATÁLOGO DISPONIBLE (${_chatProdCache.length} productos en total, mostrando los más relevantes) ──
${catalog || 'Cargando catálogo…'}
──────────────────
INSTRUCCIONES IMPORTANTES:
- Habla en español dominicano natural y amigable. Usa emojis con moderación.
- Si te preguntan quién eres o para quién trabajas, di siempre que eres Maya de Casa Mota.
- Si te preguntan por dirección, teléfono, correo, horario, WhatsApp o envíos, usa el bloque INFORMACIÓN DEL SUPERMERCADO.
- Si el cliente pregunta por sus pedidos, puntos, favoritos o datos personales, usa el bloque CLIENTE ACTUAL.
- Para productos: menciona nombres y precios exactos del catálogo. Si no está disponible, dilo claramente.
- NUNCA digas "no tengo acceso" o "no puedo ver esa información" cuando la información ya está en este contexto.
- No inventes precios, datos ni información que no esté en este contexto.
- Para niveles de puntos: Bronce 0–499 pts, Plata 500–1499 pts, Oro 1500–2999 pts, VIP 3000+ pts.
- Máximo 2–3 oraciones por respuesta, a menos que el cliente pida una lista o detalle.`;

  // Sanitizar historial: asegurar que no haya roles consecutivos iguales (Groq lo rechaza)
  // y que siempre alterne user/assistant
  const safeHistory = [];
  for (const m of recentHistory) {
    const last = safeHistory[safeHistory.length - 1];
    if (last && last.role === m.role) continue; // saltar duplicados consecutivos
    safeHistory.push(m);
  }
  // Asegurar que el último del historial no sea 'user' (el userMsg actual va al final)
  while (safeHistory.length > 0 && safeHistory[safeHistory.length - 1].role === 'user') {
    safeHistory.pop();
  }

  // 1️⃣ Intentar Groq primero
  const groqKey = await _chatGroqKey();
  if (groqKey) {
    try {
      const groqBody = {
        model: _CHAT_GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...safeHistory,
          { role: 'user', content: userMsg }
        ],
        max_tokens: 200,
        temperature: 0.7
      };
      const res = await _chatFetch(_CHAT_GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify(groqBody)
      });
      // Leer el body UNA SOLA VEZ (no se puede leer dos veces)
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const text = data.choices?.[0]?.message?.content;
        if (text) return text.trim();
      } else {
        console.warn('Groq error:', res.status, JSON.stringify(data));
        // Si es error de payload muy grande, reintentar con prompt reducido
        if ((res.status === 413 || res.status === 400) && data) {
          const shortPrompt = systemPrompt.split('\n').slice(0, 8).join('\n');
          const shortBody = { ...groqBody, messages: [{ role: 'system', content: shortPrompt }, { role: 'user', content: userMsg }] };
          const res2 = await _chatFetch(_CHAT_GROQ_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify(shortBody)
          });
          const d2 = await res2.json().catch(() => null);
          if (res2.ok && d2) {
            const t2 = d2.choices?.[0]?.message?.content;
            if (t2) return t2.trim();
          }
        }
      }
    } catch (e) { console.error('🔴 Groq exception:', e.message, e); }
  }

  throw new Error('Sin conexión a la IA');
}

// ─── LIMPIAR CHAT ─────────────────────────────────────────────────────────────

function chatClear() {
  _chatHistory = [];
  _chatInited  = false;
  _unreadCount = 0;
  const box = document.getElementById('chatMessages');
  if (box) box.innerHTML = '';
  _chatRenderWelcome();
}
