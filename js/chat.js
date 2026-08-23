/**
 * SUPERMERCADO CASA MOTA — CHAT.JS
 * Asistente de compras IA para clientes (app móvil)
 * Usa Groq como servicio principal (gratuito y rápido)
 */

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const _CHAT_GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

// Proxy propio (Cloudflare Pages Function en functions/api/chat.js).
// La API key vive en el servidor y NUNCA se descarga al navegador.
// Si el proxy no está desplegado (404), se cae a la llamada directa siempre
// que este navegador tenga clave en localStorage (caso del admin).
const _CHAT_PROXY_URL  = '/api/chat';
const _CHAT_USE_PROXY  = true;
/* BUILD 414 · El modelo ya no se escribe aquí: `iaModeloTexto()` lo saca de
 * js/ia-modelos.js, el único sitio donde se configura. Antes estaba a mano en
 * 5 ficheros y cuando Groq retiró `llama-3.1-8b-instant` murió todo a la vez. */
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

// Se pone a true si el proxy responde 404/501 (no desplegado todavía)
let _chatProxyCaido = false;

/**
 * Envía el cuerpo al modelo, primero por el proxy y si no por Groq directo.
 * @returns {Promise<Response|null>} null si no hay ninguna vía disponible
 */
async function _chatLLMFetch(body, groqKey) {
  // 1) Proxy propio — sin cabecera Authorization: la pone el servidor
  if (_CHAT_USE_PROXY && !_chatProxyCaido) {
    try {
      const res = await _chatFetch(_CHAT_PROXY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      // 404/501 = la Function no existe en este despliegue → usar plan B
      if (res.status !== 404 && res.status !== 501) return res;
      _chatProxyCaido = true;
      console.warn('[Chat] Proxy /api/chat no disponible — llamada directa');
    } catch (e) {
      _chatProxyCaido = true;
      console.warn('[Chat] Proxy /api/chat falló:', e.message);
    }
  }

  // 2) Llamada directa — solo si este navegador tiene la clave
  if (!groqKey) return null;
  return _chatFetch(_CHAT_GROQ_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body:    JSON.stringify(body),
  });
}

/**
 * Obtiene la clave Groq para la llamada DIRECTA (plan B, cuando el proxy
 * /api/chat no está disponible).
 *
 * 🔴 BUILD 415 · ANTES: leía `settings.groqApiKey` y la GUARDABA en
 * `localStorage`. Dos problemas, no uno:
 *
 *   1. La clave quedaba escrita en el disco del navegador. Cualquiera con
 *      acceso a ese equipo la sacaba escribiendo una línea en la consola.
 *   2. `js/chat.js` se cargaba también en la tienda (hasta el build 361), así
 *      que la clave se repartía a CLIENTES, no solo al panel.
 *
 * AHORA: se pide a la base con el vale de sesión (`DB.getAiKey()`), que
 * comprueba que quien la pide es personal activo, y se queda SOLO en memoria.
 * Al recargar la página desaparece. Eso es lo correcto para un secreto.
 *
 * Nota importante: devolver `null` NO rompe el chat. El camino normal es el
 * proxy `/api/chat`, que usa la variable de entorno GROQ_API_KEY del servidor
 * y no necesita clave en el navegador (ver `_chatLLMFetch`, que se lanza con
 * `groqKey || _CHAT_USE_PROXY`).
 */
async function _chatGroqKey() {
  // 1) Cache en memoria (evita llamadas repetidas)
  if (_chatGroqKeyCache && _chatGroqKeyCache.startsWith('gsk_')) return _chatGroqKeyCache;

  /* 2) Base de datos, por RPC con el vale de sesión.
   *    Si no hay sesión de panel, `_rpcStaff` lanza «Tu sesión caducó»: eso NO
   *    es un error que haya que mostrar aquí, solo significa «este navegador
   *    no tiene derecho a la clave», y entonces se usa el proxy. */
  try {
    if (typeof DB === 'undefined' || !DB.getAiKey) return null;
    const key = await DB.getAiKey();
    if (key && key.startsWith('gsk_')) {
      _chatGroqKeyCache = key;   // solo memoria: NUNCA localStorage
      return key;
    }
  } catch (e) {
    console.warn('[Chat] Sin clave directa (se usará el proxy):', e.message);
  }

  return null; // Sin clave: el proxy se encarga
}

/* 🔴 BUILD 415 · Aquí había un `_preloadChatGroqKey()` que al arrancar la
 * página descargaba la clave y la escribía en `localStorage`. Se ha ELIMINADO:
 * era el reparto automático del secreto, y encima lo hacía antes de que nadie
 * hubiera abierto el chat.
 *
 * Ya no hace falta precargar nada: la clave se pide en el momento y solo si el
 * proxy falla. Y si alguna copia quedó guardada de antes, se borra ahora. */
(function _chatLimpiarClaveGuardada() {
  try {
    if (localStorage.getItem('groq_api_key')) {
      localStorage.removeItem('groq_api_key');
      console.log('[Seguridad] Copia local de la clave de IA eliminada (chat).');
    }
  } catch (e) { /* modo privado sin almacenamiento: nada que limpiar */ }
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

/** Carga los datos de contacto del supermercado desde settings.
 *  USA DB.getSettings() — misma fuente que app.js y admin.v33.js
 *  → siempre lee Supabase en producción, nunca datos hardcodeados de dev.
 */
async function _chatLoadStoreInfo() {
  if (_chatStoreInfo) return; // Ya cargados
  try {
    // DB.getSettings() maneja el entorno (Genspark vs Supabase) automáticamente
    const s = await DB.getSettings();
    _chatStoreInfo = {
      name:            s.storeName      || 'Supermercado Casa Mota',
      address:         s.storeAddress   || 'Ave. Melchor Contín Alfau No.5, Centro, Hato Mayor del Rey',
      phone:           s.storePhone     || '',
      email:           s.storeEmail     || '',
      hoursWk:         s.hoursWeekday   || '',
      hoursSun:        s.hoursSunday    || '',
      whatsapp:        s.storeWhatsapp  || '',   // ← campo correcto (storeWhatsapp, no whatsapp)
      delivery:        s.serviceZones   || 'Hato Mayor del Rey y zonas cercanas',
      shippingFee:     s.shippingFee    || '150',
      freeShippingMin: s.freeShippingMin || '1500',
    };
  } catch(_) {
    // Datos mínimos si falla la red — sin teléfono hardcodeado
    _chatStoreInfo = {
      name:            'Supermercado Casa Mota',
      address:         'Ave. Melchor Contín Alfau No.5, Centro, Hato Mayor del Rey',
      phone:           '',
      email:           '',
      hoursWk:         '',
      hoursSun:        '',
      whatsapp:        '',
      delivery:        'Hato Mayor del Rey y zonas cercanas',
      shippingFee:     '150',
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
  '¿Cuántos pedidos pendientes hay?',
  '¿Cuántos pedidos entregados tiene Sabin Mota?',
  '¿Quiénes son los clientes que más han comprado?',
  '¿Cuántos pedidos ha entregado cada repartidor?',
  'Dame ideas de descripciones para frutas',
];

const _QUICK_SUGGESTIONS = _IS_ADMIN ? _QUICK_SUGGESTIONS_ADMIN : _QUICK_SUGGESTIONS_STORE;

// ─── INICIALIZACIÓN ───────────────────────────────────────────────────────────

/** Umbral de "stock bajo". DEBE coincidir con js/admin.v33.js (p.stock < 20),
 *  o Maya dará cifras distintas a las de la pantalla de Inventario. */
const _STOCK_BAJO = 20;

/** Carga los productos en caché para dar contexto a la IA.
 *  Usa DBCached.getProducts() — NUNCA `tables/products`, que es la API de
 *  desarrollo de Genspark y devuelve 404 en producción (Maya se quedaba sin datos).
 *  Se reconstruye en cada llamada: DBCached sirve de memoria, así que no hay
 *  peticiones extra, y si el admin edita un producto e invalida la caché,
 *  Maya ve el dato nuevo sin recargar la página.
 */
async function _chatLoadProducts(force = false) {
  try {
    const src = (typeof DBCached !== 'undefined' && DBCached.getProducts)
      ? await DBCached.getProducts(force)
      : await DB.getProducts();
    _chatProdCache = (src || [])
      .filter(p => !p.deleted && p.active !== false)
      .map(p => ({
        id:       p.id,
        name:     p.name,
        category: p.category,
        price:    p.price,
        badge:    p.badge,
        unit:     p.unit,                 // faltaba: el catálogo lo usaba y siempre era undefined
        stock:    Number(p.stock) || 0,   // faltaba: sin esto Maya no podía hablar de inventario
      }));
  } catch (e) {
    console.warn('[Chat] No se pudieron cargar los productos:', e);
    if (!_chatProdCache.length) _chatProdCache = [];
  }
}

// ─── PEDIDOS Y CLIENTES (solo modo admin) ────────────────────────────────────

/** Estados reales de pedido. Deben coincidir con el <select> de js/admin.v33.js:2276 */
const _ESTADOS_PEDIDO = ['pendiente', 'procesando', 'enviado', 'entregado', 'cancelado'];

let _chatPedidos      = [];
let _chatClientes     = [];
let _chatRepartidores = [];

/** Carga pedidos, clientes y repartidores vía DBCached (comparte caché con el
 *  panel admin, así que si ya estaban cargados no hay ninguna petición extra). */
async function _chatLoadGestion(force = false) {
  if (!_IS_ADMIN) return;                 // la tienda nunca debe ver estos datos

  // allSettled y NO all: con Promise.all, si una sola de las tres consultas
  // falla se pierden las otras dos y Maya se queda ciega de todo a la vez.
  const [ped, cli, drv] = await Promise.allSettled([
    DBCached.getOrders(force),
    DBCached.getCustomers(force),
    DBCached.getDrivers(force),
  ]);

  const ok = (r, etiqueta) => {
    if (r.status === 'fulfilled') return r.value || [];
    console.warn(`[Chat] No se pudieron cargar ${etiqueta}:`, r.reason);
    return null;                          // null = fallo real, [] = vacío legítimo
  };

  const p = ok(ped, 'pedidos');
  const c = ok(cli, 'clientes');
  const d = ok(drv, 'repartidores');

  if (p) _chatPedidos      = p.filter(o => !o.deleted);
  if (c) _chatClientes     = c.filter(x => !x.deleted);
  if (d) _chatRepartidores = d.filter(x => !x.deleted);

  console.log(`[Chat] Contexto de gestión: ${_chatPedidos.length} pedidos · `
            + `${_chatClientes.length} clientes · ${_chatRepartidores.length} repartidores`);
}

const _norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Cuenta pedidos por estado y devuelve un objeto {pendiente:0, procesando:0, ...} */
function _contarPorEstado(pedidos) {
  const c = Object.fromEntries(_ESTADOS_PEDIDO.map(e => [e, 0]));
  let otros = 0;
  pedidos.forEach(o => {
    const st = _norm(o.status);
    if (st in c) c[st]++; else otros++;
  });
  if (otros) c.otros = otros;
  return c;
}

const _fmtEstados = c => _ESTADOS_PEDIDO
  .map(e => `${e} ${c[e] || 0}`).join(' · ') + (c.otros ? ` · otros ${c.otros}` : '');

/** Busca en el mensaje el cliente al que se refiere el admin.
 *  Exige coincidir 2+ palabras del nombre (o el nombre completo) para no confundir
 *  "Sabin Mota" con "Saury Mota", que comparten apellido. */
function _chatBuscarClientes(userMsg) {
  if (!_chatClientes.length) return [];
  const msg = _norm(userMsg);

  const scored = _chatClientes.map(c => {
    const nombre = _norm(c.name);
    if (!nombre) return { c, score: 0 };
    if (msg.includes(nombre)) return { c, score: 99 };      // nombre completo literal
    const tokens = nombre.split(/\s+/).filter(t => t.length >= 3);
    const hits = tokens.filter(t => msg.includes(t)).length;
    return { c, score: hits };
  }).filter(x => x.score >= 2);                              // 1 sola palabra = ambiguo

  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score);
  const mejor = scored[0].score;
  return scored.filter(x => x.score === mejor).slice(0, 3).map(x => x.c);
}

/** Pedidos de un cliente. Prioriza el email (identificador fiable);
 *  si el pedido no lo trae, compara por nombre normalizado. */
function _pedidosDeCliente(cli) {
  const email  = _norm(cli.email);
  const nombre = _norm(cli.name);
  return _chatPedidos.filter(o => {
    const oe = _norm(o.email);
    if (email && oe) return oe === email;
    return _norm(o.customer) === nombre;
  });
}

/** Bloque de contexto de uno o varios clientes concretos.
 *  NO incluye teléfono, dirección, cédula ni GPS: son datos personales que no
 *  necesitan salir hacia Groq para responder preguntas de gestión. */
function _chatClienteResumen(userMsg) {
  const encontrados = _chatBuscarClientes(userMsg);
  if (!encontrados.length) return '';

  return encontrados.map(cli => {
    const pedidos = _pedidosDeCliente(cli);
    const cnt     = _contarPorEstado(pedidos);
    const gastado = pedidos
      .filter(o => _norm(o.status) !== 'cancelado')
      .reduce((s, o) => s + (Number(o.total) || 0), 0);

    const ultimos = pedidos.slice(-5).reverse()
      .map(o => `  • #${o.order_number || o.id} — ${o.date || 's/f'} — ${o.status} — RD$ ${(Number(o.total) || 0).toFixed(2)}`)
      .join('\n');

    return [
      `── CLIENTE: ${cli.name} ──`,
      `Email: ${cli.email || '—'}`,
      `Pedidos encontrados: ${pedidos.length}`,
      `Desglose por estado: ${_fmtEstados(cnt)}`,
      `Total gastado (sin cancelados): RD$ ${gastado.toFixed(2)}`,
      `Puntos de fidelización: ${cli.loyaltyPoints || 0} (${cli.ranking || cli.loyaltyTier || 'bronce'})`,
      pedidos.length ? `Últimos pedidos:\n${ultimos}` : 'Sin pedidos registrados.',
      '──────────────────',
    ].join('\n');
  }).join('\n');
}

// ─── REPARTIDORES (solo modo admin) ──────────────────────────────────────────
// Los KPIs se calculan aquí con la MISMA regla que la pantalla de Repartidores
// (_mismoDriver en js/admin.v33.js:4957). Si algún día cambia allí, cambiarla
// también aquí o Maya dará cifras distintas a las de la pantalla.

/** Valor especial que guarda el modal de pedidos cuando no hubo reparto. */
const _DRIVER_RETIRO = '_retiro';

/** Estados "en curso" de un pedido: aún no se entregó ni se canceló. */
const _ESTADOS_EN_CURSO = ['pendiente', 'procesando', 'enviado'];

const _VEHICULO_LABEL = { moto: 'moto', bicicleta: 'bicicleta', carro: 'carro', a_pie: 'a pie' };
const _ESTADO_DRIVER  = { activo: 'activo', en_ruta: 'en ruta', descanso: 'en descanso', inactivo: 'inactivo' };

/** Comparación por String(): driverId es UUID en la base de datos (build 378) y
 *  d.id puede ser número o UUID. Con === estricto los contadores darían 0.
 *  BUILD 379: se excluye '_retiro', que no es un id sino la marca de "retiro en
 *  tienda". Debe coincidir con _mismoDriver de js/admin.v33.js o Maya dará
 *  cifras distintas a las de la pantalla. */
const _mismoDriverChat = (o, drvId) =>
  o.driverId != null && o.driverId !== '' && o.driverId !== _DRIVER_RETIRO
  && String(o.driverId) === String(drvId);

function _pedidosDeRepartidor(drvId) {
  return _chatPedidos.filter(o => _mismoDriverChat(o, drvId));
}

/** Busca el repartidor al que se refiere el admin.
 *  A diferencia de los clientes, aquí SÍ se acepta una sola palabra: son pocos
 *  y con nombres distintos entre sí, pero solo si esa palabra identifica a uno
 *  único (así "Reyes" funciona y un apellido compartido seguiría siendo ambiguo). */
function _chatBuscarRepartidores(userMsg) {
  if (!_chatRepartidores.length) return [];
  const msg = _norm(userMsg);

  const scored = _chatRepartidores.map(d => {
    const nombre = _norm(d.name);
    if (!nombre) return { d, score: 0 };
    if (msg.includes(nombre)) return { d, score: 99 };       // nombre completo literal
    const tokens = nombre.split(/\s+/).filter(t => t.length >= 4);
    const hits = tokens.filter(t => msg.includes(t)).length;
    return { d, score: hits };
  }).filter(x => x.score >= 1);

  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score);
  const mejor = scored[0].score;
  const empatados = scored.filter(x => x.score === mejor);
  // Una sola palabra coincidente y más de un repartidor la comparte → ambiguo
  if (mejor === 1 && empatados.length > 1) return empatados.slice(0, 3).map(x => x.d);
  return empatados.slice(0, 3).map(x => x.d);
}

/** Tabla resumen de TODOS los repartidores. Es pequeña (una línea por persona),
 *  así que se envía siempre: cubre "¿cuántos ha entregado cada uno?" sin que el
 *  admin tenga que nombrar a nadie. */
function _chatRepartidoresResumen() {
  // Nunca devolver '' en silencio: si la lista está vacía el modelo se inventa
  // que "no tiene acceso a esa información". Mejor decírselo explícitamente,
  // y de paso el propio chat delata que la carga falló.
  if (!_chatRepartidores.length) {
    return [
      '── REPARTIDORES ──',
      'La lista de repartidores llegó VACÍA (0 registros).',
      'Responde que no se pudieron cargar los repartidores y que se revise la',
      'pantalla Repartidores del panel. NO digas que no tienes acceso a ese dato.',
      '──────────────────',
    ].join('\n');
  }

  const filas = _chatRepartidores.slice(0, 25).map(d => {
    const ped   = _pedidosDeRepartidor(d.id);
    const entr  = ped.filter(o => _norm(o.status) === 'entregado').length;
    const curso = ped.filter(o => _ESTADOS_EN_CURSO.includes(_norm(o.status))).length;
    const canc  = ped.filter(o => _norm(o.status) === 'cancelado').length;
    const monto = ped
      .filter(o => _norm(o.status) === 'entregado')
      .reduce((s, o) => s + (Number(o.total) || 0), 0);

    return `• ${d.name} — ${_VEHICULO_LABEL[d.vehicle] || d.vehicle || 'sin vehículo'}`
         + ` · zona: ${d.zone || '—'} · ${_ESTADO_DRIVER[d.status] || d.status || '—'}`
         + ` · asignados ${ped.length} · entregados ${entr} · pendientes ${curso}`
         + (canc ? ` · cancelados ${canc}` : '')
         + ` · valor entregado RD$ ${monto.toFixed(2)}`;
  }).join('\n');

  // Pedidos que ya salieron pero no tienen a nadie detrás: dato útil de control
  const repartidos = _chatPedidos.filter(o => ['enviado', 'entregado'].includes(_norm(o.status)));
  const sinAsignar = repartidos.filter(o => !o.driverId).length;
  const retiro     = _chatPedidos.filter(o => String(o.driverId) === _DRIVER_RETIRO).length;

  return [
    '── REPARTIDORES ──',
    `Total registrados: ${_chatRepartidores.length}`,
    filas,
    `Pedidos enviados/entregados SIN repartidor asignado: ${sinAsignar}`,
    `Pedidos marcados como retiro en tienda: ${retiro}`,
    '──────────────────',
  ].filter(Boolean).join('\n');
}

/** Detalle ampliado cuando el admin nombra a un repartidor concreto. */
function _chatRepartidorDetalle(userMsg) {
  const encontrados = _chatBuscarRepartidores(userMsg);
  if (!encontrados.length) return '';

  return encontrados.map(d => {
    const ped = _pedidosDeRepartidor(d.id);
    const cnt = _contarPorEstado(ped);
    const ultimos = ped.slice(-5).reverse()
      .map(o => `  • #${o.order_number || o.id} — ${o.date || 's/f'} — ${o.status} — ${o.customer || 'cliente s/n'} — RD$ ${(Number(o.total) || 0).toFixed(2)}`)
      .join('\n');

    return [
      `── REPARTIDOR: ${d.name} ──`,
      `Vehículo: ${_VEHICULO_LABEL[d.vehicle] || d.vehicle || '—'}${d.plate ? ' (placa ' + d.plate + ')' : ''}`,
      `Zona: ${d.zone || '—'} · Estado: ${_ESTADO_DRIVER[d.status] || d.status || '—'}`,
      `Pedidos asignados en total: ${ped.length}`,
      `Desglose por estado: ${_fmtEstados(cnt)}`,
      ped.length ? `Últimos pedidos:\n${ultimos}` : 'Todavía no tiene pedidos asignados.',
      '──────────────────',
    ].join('\n');
  }).join('\n');
}

/** Estadísticas globales del negocio. Tamaño fijo y pequeño: va siempre. */
function _chatEstadisticasGlobales() {
  if (!_chatPedidos.length && !_chatClientes.length) return '';

  const cnt = _contarPorEstado(_chatPedidos);
  const ventas = _chatPedidos
    .filter(o => _norm(o.status) !== 'cancelado')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);

  // El top se calcula contando pedidos reales, NO leyendo customers.spent:
  // esas columnas son contadores denormalizados que se desincronizan
  // (ver la sección "contadores de cliente" en casamota-estado.md).
  const top = _chatClientes
    .map(c => {
      const suyos = _pedidosDeCliente(c).filter(o => _norm(o.status) !== 'cancelado');
      return {
        name:  c.name,
        n:     suyos.length,
        total: suyos.reduce((s, o) => s + (Number(o.total) || 0), 0),
      };
    })
    .filter(x => x.n > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((c, i) => `  ${i + 1}. ${c.name} — RD$ ${c.total.toFixed(2)} (${c.n} pedidos)`)
    .join('\n');

  return [
    '── ESTADÍSTICAS GLOBALES ──',
    `Pedidos totales: ${_chatPedidos.length}`,
    `Desglose por estado: ${_fmtEstados(cnt)}`,
    `Ventas acumuladas (sin cancelados): RD$ ${ventas.toFixed(2)}`,
    `Clientes registrados: ${_chatClientes.length}`,
    top ? `Top 5 clientes por gasto:\n${top}` : '',
    '──────────────────',
  ].filter(Boolean).join('\n');
}

/** Resumen de inventario para el prompt de admin.
 *  Se calcula aparte del catálogo porque las preguntas tipo "¿qué tiene poco
 *  stock?" no contienen el nombre de ningún producto, y el filtro por
 *  relevancia jamás los seleccionaría. */
function _chatInventarioResumen() {
  if (!_chatProdCache.length) return 'INVENTARIO: sin datos cargados todavía.';

  const agotados = _chatProdCache.filter(p => p.stock === 0);
  const bajos    = _chatProdCache
    .filter(p => p.stock > 0 && p.stock < _STOCK_BAJO)
    .sort((a, b) => a.stock - b.stock);

  const lista = arr => arr.slice(0, 20)
    .map(p => `• ${p.name} — ${p.stock} ${p.unit || 'uds'}`)
    .join('\n');

  return [
    `── INVENTARIO (umbral de stock bajo: menos de ${_STOCK_BAJO} unidades) ──`,
    `Productos activos: ${_chatProdCache.length}`,
    `Sin stock (0 unidades): ${agotados.length}`,
    agotados.length ? lista(agotados) : '• ninguno',
    `Stock bajo (1 a ${_STOCK_BAJO - 1} unidades): ${bajos.length}`,
    bajos.length ? lista(bajos) : '• ninguno',
    '──────────────────',
  ].join('\n');
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
        _chatLoadGestion(),      // pedidos + clientes (solo admin)
        _chatGroqKey(),          // precalentar clave en cache
      ]).catch(logFail('la precarga del contexto de Maya'));
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
          ? 'Soy <strong>Maya</strong>, tu asistente de gestión de <strong>Casa Mota</strong>. Consulto inventario, pedidos y clientes en tiempo real. 📊'
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
    /* 🔴 BUILD 417 · Si `_chatCallAI` averiguó la causa REAL, se muestra esa y
     * no la genérica. Va PRIMERO a propósito: cualquier comprobación por
     * delante volvería a sepultar el diagnóstico, que es el fallo a corregir.
     * Solo el corte de red real tiene prioridad, porque en ese caso el motivo
     * guardado sería engañoso. */
    const _motivo = (e.message && e.message.startsWith('_CHAT_MOTIVO:'))
      ? e.message.slice('_CHAT_MOTIVO:'.length)
      : null;
    if (!navigator.onLine) {
      errMsg = '📵 Sin conexión a internet. Por favor verifica tu red e intenta de nuevo.';
    } else if (_motivo) {
      errMsg = _motivo;
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

  // Preguntas de inventario ("¿qué tiene poco stock?") no nombran ningún producto,
  // así que el filtro por palabras devolvería los primeros por orden alfabético.
  // En ese caso ordenamos por stock ascendente, que es lo que se está preguntando.
  const msgNorm = normalize(userMsg);
  const esPreguntaStock = ['stock', 'inventario', 'agotad', 'existencia', 'quedan',
                           'reponer', 'reabastec', 'faltan', 'poco']
                          .some(k => msgNorm.includes(k));
  if (esPreguntaStock) {
    return [..._chatProdCache].sort((a, b) => a.stock - b.stock).slice(0, 40);
  }

  const words = msgNorm.split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return _chatProdCache.slice(0, 40);

  // Puntuar cada producto según relevancia
  const scored = _chatProdCache.map(p => {
    const pNorm = normalize((p.name || '') + ' ' + (p.category || ''));
    let score = 0;
    words.forEach(w => { if (pNorm.includes(w)) score += 2; });
    return { p, score };
  });

  // Ordenar por score desc, tomar top 40
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 40).map(s => s.p);
}

/* 🔴 BUILD 417 · Traduce el fallo REAL de la IA a algo que se pueda arreglar.
 *
 * Motivo: Maya decía «No pude procesar tu consulta» cuando la causa era
 * `401 Invalid API Key` — la variable GROQ_API_KEY de Cloudflare seguía
 * teniendo una clave revocada. El dueño tuvo que abrir la consola del
 * navegador para enterarse. Es el MISMO defecto que se corrigió en
 * `js/api.js` en el build 416: un mensaje genérico que oculta la causa no
 * protege a nadie, solo impide arreglar el problema.
 *
 * Devuelve null si el estado no tiene una explicación mejor que la genérica:
 * inventar un diagnóstico equivocado sería peor que no dar ninguno.
 */
function _chatMotivoFallo(status, data) {
  const crudo = (() => {
    try { return JSON.stringify(data || '').toLowerCase(); } catch (e) { return ''; }
  })();

  /* 401/403 con «api key» = la clave que usa el PROXY no sirve. Ojo: es la
   * variable GROQ_API_KEY de Cloudflare Pages, NO la que se guarda en
   * `settings` desde el panel. Son dos copias distintas y esa distinción es
   * justo la que costó una sesión entera de diagnóstico. */
  if ((status === 401 || status === 403) &&
      (crudo.includes('api key') || crudo.includes('api_key') || crudo.includes('unauthorized'))) {
    return '🔑 La clave de IA no es válida. Hay que actualizar la variable '
         + '**GROQ_API_KEY** en Cloudflare Pages (Settings → Variables and Secrets) '
         + 'y volver a desplegar. Ojo: no es la misma clave que se guarda en el panel.';
  }
  if (status === 401 || status === 403) {
    return '🔒 El servicio de IA rechazó la petición (error ' + status + '). '
         + 'Revisa la clave y los permisos de modelos en console.groq.com.';
  }
  if (status === 500 && crudo.includes('groq_api_key')) {
    return '🔑 Falta configurar la variable **GROQ_API_KEY** en Cloudflare Pages.';
  }
  if (status === 502) {
    return '📡 No se pudo contactar con el servicio de IA. Vuelve a intentarlo en un momento.';
  }
  return null;
}

async function _chatCallAI(userMsg) {
  // Refrescar desde DBCached (memoria) por si el admin acaba de editar algo
  await _chatLoadProducts();
  await _chatLoadGestion();

  // Contexto de productos: máx 15 más relevantes para no exceder tokens de Groq
  const relevant = _getRelevantProducts(userMsg).slice(0, 15);
  const catalog = relevant
    .map(p => `• ${p.name} RD$${p.price}${p.unit ? ' / ' + p.unit : ''}`
      + (_IS_ADMIN ? ` · stock: ${p.stock}` : '')
      + (p.badge ? ` [${p.badge}]` : ''))
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

${_chatInventarioResumen()}

${_chatEstadisticasGlobales()}

${_chatRepartidoresResumen()}

${_chatClienteResumen(userMsg)}

${_chatRepartidorDetalle(userMsg)}

── PRODUCTOS RELEVANTES A LA PREGUNTA ──
${catalog || 'Sin coincidencias'}
──────────────────

ESTADOS DE PEDIDO VÁLIDOS: pendiente, procesando, enviado, entregado, cancelado.

ESTADOS DE REPARTIDOR: activo, en ruta, en descanso, inactivo.

INSTRUCCIONES:
- Los bloques INVENTARIO, ESTADÍSTICAS GLOBALES, REPARTIDORES, CLIENTE y
  REPARTIDOR son datos REALES y actuales de la base de datos. ÚSALOS.
- NUNCA digas que no tienes acceso ni que debes consultar a otro departamento:
  los datos ya están arriba.
- Si te preguntan por stock bajo o productos agotados, responde con los nombres y
  las cantidades exactas del bloque INVENTARIO.
- Para preguntas sobre un cliente concreto usa SOLO su bloque CLIENTE. Si no
  aparece ningún bloque CLIENTE, di que no encontraste a esa persona y pide el
  nombre completo. NO uses las cifras globales como si fueran de ese cliente.
- Si aparecen varios bloques CLIENTE, es que el nombre es ambiguo: muéstralos y
  pide que concreten.
- Para repartidores usa el bloque REPARTIDORES (tabla de todos) o el bloque
  REPARTIDOR (detalle de uno concreto). "Pendientes" de un repartidor = pedidos
  suyos en estado pendiente, procesando o enviado; "entregados" = solo entregado.
- NO confundas clientes con repartidores: son listas distintas. Un cliente COMPRA,
  un repartidor ENTREGA.
- Si un repartidor tiene 0 pedidos, dilo tal cual y menciona, si procede, cuántos
  pedidos enviados/entregados están SIN repartidor asignado: esos no cuentan para
  nadie hasta que se les asigne uno en Pedidos → Ver detalles.
- Da siempre cifras exactas, nunca aproximaciones.
- Si una lista está vacía ("ninguno"), dilo con claridad: es un dato válido, no una falta de información.
- No reveles teléfonos ni direcciones: no los tienes y no debes inventarlos.
- Español dominicano profesional. Máx 3 oraciones, salvo que te pidan una lista.
- No inventes datos que no estén en este contexto.`
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

  /* 🔴 BUILD 417 · Declarada AQUÍ, en el ámbito de la función, y no dentro del
   * `if` de abajo: el mensaje se compone al final de `_chatCallAI`, fuera de
   * ese bloque. Declararla dentro habría dado un `ReferenceError` — o sea, un
   * fallo nuevo mientras se arregla el de los mensajes que ocultan fallos. */
  let _motivoDiagnostico = null;

  // 1️⃣ Intentar Groq primero
  const groqKey = await _chatGroqKey();
  if (groqKey || _CHAT_USE_PROXY) {
    /* BUILD 414 · Se recorren los modelos autorizados en vez de fijar uno.
     * Este bucle está aquí y no en `iaLlamarGroq` porque el chat NO llama a
     * Groq directamente: pasa antes por el proxy /api/chat (con timeout y
     * caída a llamada directa) y esa lógica no se puede meter en el módulo
     * sin duplicarla. Lo que sí se comparte es la DECISIÓN de cuándo un
     * fallo se arregla cambiando de modelo: `iaModeloMuerto()`.
     *
     * Solo se pasa al siguiente si el modelo está retirado o no autorizado.
     * Un 401 o un 429 no mejoran cambiando de modelo: reintentar solo
     * gastaría cuota (verificado: 1.000 peticiones al DÍA por modelo con los
     * `gpt-oss`; los 250 que decía antes eran mi estimación, no un dato) y
     * retrasaría el mensaje real para el cliente. */
    /* 🔴 BUILD 414 · El respaldo de emergencia (solo se usa si ia-modelos.js
     * no llegó a cargar) nombraba `groq/compound-mini` y `groq/compound`:
     * justo los DOS ÚNICOS que NO pueden funcionar en esta cuenta, porque su
     * motor interno (`llama-3.3-70b-versatile`) está bloqueado y encima no
     * figuran en los permisos del proyecto. O sea: el plan B garantizaba el
     * fallo. Ahora nombra los `gpt-oss`, que son los reales. */
    const modelos = (typeof iaListaTexto === 'function')
      ? iaListaTexto()
      : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

    // Solo se amplia el presupuesto UNA vez en toda la tanda, no por modelo:
    // si no, cada modelo doblaría tokens y la espera se haría larga.
    let _yaAmplieTokens = false;



    for (const modelo of modelos) {
      try {
        const groqBody = {
          model: modelo,   // BUILD 414 · ver js/ia-modelos.js
          messages: [
            { role: 'system', content: systemPrompt },
            ...safeHistory,
            { role: 'user', content: userMsg }
          ],
          /* 🔴 BUILD 414 · Aquí ponía 200 fijos y DEJABA MUDA A MAYA. Los
           * `gpt-oss` razonan antes de escribir y ese gasto sale del mismo
           * `max_tokens`: con 200 se agota pensando y Groq devuelve 200 OK con
           * el texto vacío. Es el mismo fallo del «respondió pero sin texto».
           *
           * Este fichero NO pasa por `iaLlamarGroq` (su petición va primero al
           * proxy), así que el arreglo central no le llegaba: hay que pedir el
           * presupuesto correcto aquí también. */
          max_tokens: (typeof iaTokensSeguros === 'function')
            ? iaTokensSeguros(modelo, 200)
            : 512,
          temperature: 0.7
        };
        const res = await _chatLLMFetch(groqBody, groqKey);
        if (!res) {
          /* 🔴 BUILD 417 · Ni proxy ni clave: el caso del panel abierto sin
           * sesión válida y con la Function caída. Se nombra en vez de dejarlo
           * caer en el mensaje genérico. */
          if (!_motivoDiagnostico) {
            _motivoDiagnostico = '⚠️ El servicio de IA no está disponible: no responde el proxy '
              + '`/api/chat` y este navegador no tiene clave. Comprueba que la Function '
              + 'esté desplegada en Cloudflare Pages.';
          }
          throw new Error('Sin proxy ni clave disponible');
        }
        // Leer el body UNA SOLA VEZ (no se puede leer dos veces)
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          const text = data.choices?.[0]?.message?.content;
          if (text && text.trim()) {
            if (typeof iaRecordarTexto === 'function') iaRecordarTexto(modelo);
            return text.trim();
          }
          /* 🔴 200 OK CON TEXTO VACÍO. Antes este caso no hacía NADA: caía al
           * `break` de abajo y Maya lanzaba «Sin conexión a la IA» — mintiendo,
           * porque la conexión funcionó perfectamente. Pasa cuando el modelo
           * agota el presupuesto razonando (`finish_reason: "length"`).
           * Se reintenta UNA vez con el doble antes de rendirse. */
          const fin = data.choices?.[0]?.finish_reason;
          console.warn(`[Chat] «${modelo}» devolvió texto vacío (finish_reason=${fin}).`);
          if (fin === 'length' && !_yaAmplieTokens) {
            _yaAmplieTokens = true;
            const masBody = { ...groqBody, max_tokens: (groqBody.max_tokens || 512) * 2 };
            const res3 = await _chatLLMFetch(masBody, groqKey);
            const d3 = res3 ? await res3.json().catch(() => null) : null;
            const t3 = d3?.choices?.[0]?.message?.content;
            if (res3 && res3.ok && t3 && t3.trim()) {
              if (typeof iaRecordarTexto === 'function') iaRecordarTexto(modelo);
              return t3.trim();
            }
          }
          // Sigue vacío: quizá otro modelo sí conteste. Merece el intento.
          continue;
        } else {
          console.warn('Groq error:', res.status, JSON.stringify(data));

          /* 🔴 BUILD 417 · Guardar la causa ANTES de cualquier `continue` o
           * `break`: si no, se pierde por el camino y la persona vuelve a ver
           * «No pude procesar tu consulta» sin saber qué arreglar. */
          if (!_motivoDiagnostico) _motivoDiagnostico = _chatMotivoFallo(res.status, data);

          // ¿El modelo ya no existe o la organización no lo permite?
          // Entonces sí merece la pena probar el siguiente de la lista.
          const crudo = data ? JSON.stringify(data) : '';
          if (typeof iaModeloMuerto === 'function' && iaModeloMuerto(res.status, crudo)) {
            console.warn(`[Chat] «${modelo}» no disponible — probando el siguiente…`);
            continue;
          }

          // 429 = tope de uso alcanzado (nuestro proxy en functions/api/chat.js
          // o el propio Groq). No reintentar: devolver el aviso a la persona.
          if (res.status === 429) {
            const espera = Number(data && data.esperar) || 0;
            const base = (data && data.codigo === 'rate_limited' && data.error)
              ? data.error
              : 'El servicio de IA está saturado ahora mismo.';
            return espera ? `${base}\n\n⏳ Vuelve a intentarlo en unos ${espera} segundos.` : base;
          }
          // Si es error de payload muy grande, reintentar con prompt reducido
          if ((res.status === 413 || res.status === 400) && data) {
            const shortPrompt = systemPrompt.split('\n').slice(0, 8).join('\n');
            const shortBody = { ...groqBody, messages: [{ role: 'system', content: shortPrompt }, { role: 'user', content: userMsg }] };
            const res2 = await _chatLLMFetch(shortBody, groqKey);
            const d2 = res2 ? await res2.json().catch(() => null) : null;
            if (res2 && res2.ok && d2) {
              const t2 = d2.choices?.[0]?.message?.content;
              if (t2) {
                if (typeof iaRecordarTexto === 'function') iaRecordarTexto(modelo);
                return t2.trim();
              }
            }
          }
        }
      } catch (e) { console.error('🔴 Groq exception:', e.message, e); }
      break; // el fallo no era de modelo: no tiene sentido seguir probando
    }
  }

  /* Si se agotaron los modelos, el mensaje NO debe culpar a la conexión: el
   * caso más probable a estas alturas es que respondieran vacío.
   *
   * 🔴 BUILD 417 · Pero si SÍ se conoce la causa (clave inválida, permisos,
   * proxy caído), se dice esa y no la genérica. `_CHAT_MOTIVO` es la marca que
   * `_chatSendMsg` reconoce para mostrar el texto tal cual en vez de
   * sustituirlo por «No pude procesar tu consulta». */
  if (_motivoDiagnostico) {
    throw new Error('_CHAT_MOTIVO:' + _motivoDiagnostico);
  }
  throw new Error('La IA no devolvió respuesta. Vuelve a intentarlo.');
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
