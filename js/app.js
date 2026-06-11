/**
 * SUPERMERCADO CASA MOTA — APP.JS v158
 * Lógica principal: carrito, búsqueda, filtros, slider, modal, paginación
 */

// Limpiar todos los cachés del SW al arrancar (garantiza archivos frescos)
if ('caches' in window) {
  caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Formatea un número como precio con separador de miles y 2 decimales.
 * Implementación manual 100% compatible con todos los navegadores móviles.
 * Ejemplo: 2450    → "2,450.00"
 *          1500.5  → "1,500.50"
 *          100     → "100.00"
 *          1090.85 → "1,090.85"
 */
function fmt$(n) {
  const num = Math.abs(parseFloat(n) || 0);
  const sign = (parseFloat(n) || 0) < 0 ? '-' : '';
  // Fijar 2 decimales y separar parte entera de decimal
  const fixed = num.toFixed(2);           // "1090.85"
  const [intPart, decPart] = fixed.split('.');  // ["1090", "85"]
  // Insertar comas cada 3 dígitos desde la derecha
  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${intWithCommas}.${decPart}`;  // "1,090.85"
}

/**
 * Genera el HTML de estrellas con soporte de media estrella.
 * Ej: 4.5 → 4 estrellas llenas + 1 media + 0 vacías
 *     4.2 → 4 estrellas llenas + 0 medias + 1 vacía  (se usa floor para enteras)
 * NO modifica el tamaño; el CSS existente de .stars gestiona el tamaño.
 */
function renderStars(rating) {
  const r = parseFloat(rating) || 0;
  const full  = Math.floor(r);           // estrellas completas
  const half  = (r - full) >= 0.25 && (r - full) < 0.75 ? 1 : 0;  // media estrella
  const extraFull = (r - full) >= 0.75 ? 1 : 0;   // .75+ se redondea a llena
  const totalFull = full + extraFull;
  const empty = 5 - totalFull - half;

  let html = '';
  for (let i = 0; i < totalFull; i++) html += '<i class="fas fa-star"></i>';
  if (half)                            html += '<i class="fas fa-star-half-stroke"></i>';
  for (let i = 0; i < empty; i++)     html += '<i class="far fa-star"></i>';
  return html;
}

// ─── Estado global ──────────────────────────────────────────────────────────
let cart = JSON.parse(localStorage.getItem('casamota_cart') || '[]');
let favorites = JSON.parse(localStorage.getItem('casamota_favorites') || '[]');
let currentCategory = 'all';
let currentSearch = '';
let currentSort = 'default';
let currentView = 'grid';
let currentPage = 1;
const ITEMS_PER_PAGE = 12;
let sliderIndex = 0;
let sliderTimer = null;
let modalQty = 1;

// ─── Catálogo activo (se puebla desde la API en init) ────────────────────────
// PRODUCTS es el array estático definido en products.js; lo extendemos con los
// productos creados desde el admin que llegan de la API en tiempo de ejecución.
let _liveProducts = null; // null = aún no cargado desde API

/** Devuelve el catálogo activo: primero intenta el cache de API, si no los estáticos */
function getLiveProducts() {
  return _liveProducts !== null ? _liveProducts : PRODUCTS;
}

/** Muestra loader de moto delivery mientras se espera la API */
function _renderSkeletons(count = 8) {
  const grid = document.getElementById('productsGrid');
  const noResults = document.getElementById('noResults');
  const paginationEl = document.getElementById('pagination');
  if (!grid) return;
  noResults && noResults.classList.add('hidden');
  if (paginationEl) paginationEl.innerHTML = '';
  grid.className = 'products-grid';
  grid.innerHTML = `
    <div class="delivery-loader">
      <div class="delivery-loader__scene">
        <div class="delivery-loader__road">
          <div class="delivery-loader__road-dash"></div>
        </div>
        <div class="delivery-loader__moto-wrap">
          <img class="delivery-loader__moto"
               src="images/delivery-loader-v2.png"
               alt="Cargando productos…">
        </div>
      </div>
      <div class="delivery-loader__dots">
        <span></span><span></span><span></span>
      </div>
      <p class="delivery-loader__text">Actualizando productos…</p>
    </div>`;
}

/** Carga los productos desde Supabase y re-renderiza la tienda.
 *
 * ESTRATEGIA 2 FASES para máxima velocidad:
 *   Fase 1 (~470ms) — todos los campos de texto (name, price, description…)
 *                     → renderiza tarjetas al instante con placeholder de imagen
 *   Fase 2 (background) — solo id,image (base64 pesado)
 *                     → parcha _liveProducts e inyecta imágenes reales
 */
async function _loadProductsFromAPI() {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [0, 2000, 4000];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));

    try {
      // ── FASE 1: campos ligeros + categorías en paralelo ───────────────────────
      const [cats, allProds] = await Promise.all([
        DB.getCategories().catch(() => []),
        DB.getProducts().catch(() => [])          // sin image (base64) — description incluida
      ]);

      if (cats && cats.length) {
        _dynamicCategories = _deduplicateCats(cats.filter(c => !c.deleted));
      }

      if (allProds && allProds.length > 0) {
        _liveProducts = allProds.filter(p => !p.deleted);
        buildCategoryNav(_dynamicCategories, _liveProducts);
        renderProducts();        // ← tarjetas visibles al instante (placeholder img)
        updateCartUI();
        if (typeof renderFavorites === 'function') renderFavorites();

        // ── FASE 2: cargar solo image en background ───────────────────────────────
        _loadImagesBackground();

        return; // ✅ éxito
      }

      if (attempt < MAX_RETRIES - 1) continue;

      _liveProducts = [...PRODUCTS];
      buildCategoryNav(_dynamicCategories, _liveProducts);
      renderProducts();
      updateCartUI();
      if (typeof renderFavorites === 'function') renderFavorites();
      return;

    } catch(e) {
      if (attempt < MAX_RETRIES - 1) continue;
      _liveProducts = [...PRODUCTS];
      buildCategoryNav(_dynamicCategories, _liveProducts);
      renderProducts();
      updateCartUI();
    }
  }
}

/** FASE 2 — carga solo image (base64) en background y la inyecta en las tarjetas ya renderizadas */
async function _loadImagesBackground() {
  try {
    const imgData = await DB.getProducts({ imgs: true });   // solo id,image
    if (!imgData || imgData.length === 0) return;

    // Crear mapa id→image para lookup O(1)
    const map = {};
    imgData.forEach(p => { if (p.image) map[p.id] = p.image; });

    // Parchear _liveProducts con image real
    let changed = false;
    _liveProducts.forEach(p => {
      if (map[p.id]) { p.image = map[p.id]; changed = true; }
    });

    if (!changed) return;

    // Inyectar imagen directamente en el DOM sin re-renderizar
    _liveProducts.forEach(p => {
      if (!map[p.id]) return;
      const imgEl = document.querySelector(
        `.product-lazy-img[data-product-id="${p.id}"], [data-id="${p.id}"] .product-lazy-img`
      );
      if (imgEl) {
        imgEl.dataset.src = map[p.id];
        loadImg(imgEl);
      }
    });

    // Re-iniciar lazy loading para imágenes fuera del viewport
    initLazyImages();

    // Actualizar favoritos con las imágenes reales
    if (typeof renderFavorites === 'function') renderFavorites();

  } catch(e) {
    console.warn('_loadImagesBackground error:', e.message);
  }
}

/**
 * Recarga silenciosa de productos desde Supabase.
 * No muestra skeleton — actualiza _liveProducts en segundo plano
 * y re-renderiza solo si hay cambios reales (descripción, precio, stock…).
 */
async function _refreshProductsSilent() {
  try {
    const all = (await DB.getProducts().catch(() => [])).filter(p => !p.deleted);
    if (all.length === 0) return;

    // ── Detectar si hay productos nuevos o eliminados ─────────────────────
    const oldIds = new Set((_liveProducts || []).map(p => String(p.id)));
    const newIds = new Set(all.map(p => String(p.id)));
    const hayNuevos   = all.some(p => !oldIds.has(String(p.id)));
    const hayEliminados = (_liveProducts || []).some(p => !newIds.has(String(p.id)));

    // ── Preservar imágenes ya cargadas en F2 (base64 no viene en F1) ─────────
    const imgMap = {};
    (_liveProducts || []).forEach(p => { if (p.image) imgMap[p.id] = p.image; });
    all.forEach(p => { if (imgMap[p.id]) p.image = imgMap[p.id]; });

    // ── Verificar si algo cambió realmente ───────────────────────────────
    const _sig = arr => JSON.stringify(arr.map(p => `${p.id}|${p.price}|${p.stock}|${p.badge}|${p.name}`));
    const cambiosDatos = _sig(_liveProducts || []) !== _sig(all);

    if (!cambiosDatos && !hayNuevos && !hayEliminados) return; // nada cambió

    _liveProducts = all;

    if (hayNuevos || hayEliminados) {
      // Hay productos nuevos o eliminados: re-renderizar TODO y relanzar fase 2
      renderProducts();
      updateCartUI();
      _loadImagesBackground();
    } else {
      // Solo cambios de datos (precio, stock…): actualizar DOM quirúrgicamente
      // sin tocar las imágenes que ya están cargadas
      updateCartUI();
      _updateProductCardsDOMOnly(all);
    }

    console.log(`🔄 Productos sincronizados silenciosamente (${all.length})`);
  } catch(e) {
    // Fallo silencioso — no interrumpir al usuario
  }
}

/**
 * Inyecta imagen y descripción desde _liveProducts (ya en memoria) en las
 * tarjetas del DOM actual — sin hacer ningún fetch adicional.
 * Se llama después de cada renderProducts() para garantizar consistencia.
 */
function _injectImagesFromMemory() {
  if (!_liveProducts) return;
  _liveProducts.forEach(p => {
    const imgEl = document.querySelector(`.product-lazy-img[data-product-id="${p.id}"]`);
    if (!imgEl) return;

    // Inyectar imagen si ya está en memoria y la tarjeta aún muestra placeholder
    if (p.image && (!imgEl.src || imgEl.src.endsWith('logo-casamota.png'))) {
      imgEl.dataset.src = p.image;
      loadImg(imgEl);
    }

    // Inyectar descripción si está en memoria y la tarjeta la muestra vacía
    if (p.description) {
      const card = imgEl.closest('.product-card');
      if (!card) return;
      const descEl = card.querySelector('.product-desc');
      if (descEl && !descEl.textContent.trim()) {
        descEl.textContent = p.description.length > 80
          ? p.description.slice(0, 80) + '…'
          : p.description;
      }
    }
  });
}

/**
 * Actualiza solo precio/stock/badge en las tarjetas del DOM ya renderizadas,
 * sin destruir las imágenes ni re-renderizar nada.
 */
function _updateProductCardsDOMOnly(products) {
  products.forEach(p => {
    // Buscar la tarjeta de este producto en el DOM actual
    const imgEl = document.querySelector(`.product-lazy-img[data-product-id="${p.id}"]`);
    if (!imgEl) return; // no está en la página actual (otra categoría o página)
    const card = imgEl.closest('.product-card');
    if (!card) return;

    // Actualizar precio
    const priceEl = card.querySelector('.product-price');
    if (priceEl) priceEl.textContent = `RD$ ${fmt$(+p.price || 0)}`;

    // Actualizar badge
    const badgeEl = card.querySelector('.product-badge');
    if (badgeEl) badgeEl.style.display = p.badge ? '' : 'none';
  });
}

// ─── Sesión del cliente actual ───────────────────────────────────────────────
let currentClient = null;

// ─── Cupón activo en el checkout ─────────────────────────────────────────────
let _activeCupon = null;

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Guard: redirigir si no hay sesión de cliente
  currentClient = requireClientAuth();
  if (!currentClient) return;

  // Actualizar header con datos del cliente
  applyClientSession(currentClient);

  // Cargar info de la tienda desde la API (teléfono, dirección, horario)
  applyStoreInfo();

  // Mostrar skeletons inmediatamente (evita el flash de productos viejos)
  _renderSkeletons(8);
  updateCartUI();
  updateFavoritesUI();
  startSlider();

  // Cargar productos reales desde la API; cuando lleguen reemplaza los skeletons
  _loadProductsFromAPI();

  // Pre-calcular posición del panel lateral (safe-area para iOS PWA)
  setTimeout(_applyPanelTop, 300);
  window.addEventListener('resize', _applyPanelTop, { passive: true });

  // Ajustar padding-top del body según la altura real del header
  _applyHeaderHeight();
  setTimeout(_applyHeaderHeight, 100);  // tras primera pintura
  setTimeout(_applyHeaderHeight, 600);  // tras carga de fuentes
  window.addEventListener('resize', _applyHeaderHeight, { passive: true });
  // Cuando las fuentes web estén listas (cambian la altura del header)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(_applyHeaderHeight);
  }

  // ── Sincronización silenciosa al volver a la pestaña ──────────────────────
  // Cuando el usuario regresa desde el admin u otra pestaña, recarga los
  // productos en segundo plano para reflejar descripciones/precios actualizados
  let _lastRefresh = Date.now();
  const REFRESH_INTERVAL = 60 * 1000; // mínimo 60 seg entre refrescos

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const now = Date.now();
      if (now - _lastRefresh > REFRESH_INTERVAL) {
        _lastRefresh = now;
        // Recarga silenciosa — sin mostrar skeleton, solo actualiza _liveProducts
        _refreshProductsSilent();
      }
    }
  });

  window.addEventListener('focus', () => {
    const now = Date.now();
    if (now - _lastRefresh > REFRESH_INTERVAL) {
      _lastRefresh = now;
      _refreshProductsSilent();
    }
  });

  // ── Polling automático cada 5 minutos ─────────────────────────────────────
  // Actualiza productos en segundo plano aunque el usuario no cambie de pestaña
  const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutos
  setInterval(() => {
    // Solo sincronizar si la página está visible (no gastar recursos en background)
    if (document.visibilityState !== 'visible') return;
    _lastRefresh = Date.now();
    _refreshProductsSilent();
    console.log('⏱️ Polling automático — verificando actualizaciones...');
  }, POLL_INTERVAL);
});

// ─── INFO TIENDA DINÁMICA ────────────────────────────────────────────────────
async function applyStoreInfo() {
  let s = {};
  try { s = await DB.getSettings(); } catch(e) { /* usa cadena vacía si falla */ }

  // ── Precachear settings para el checkout (evita segunda llamada a la API) ──
  if (!_checkoutSettingsCache) _checkoutSettingsCache = s;

  const phone    = s.storePhone    || '';
  const address  = s.storeAddress  || '';
  const email    = s.storeEmail    || '';
  const hoursWk  = s.hoursWeekday  || '';
  const hoursSun = s.hoursSunday   || '';
  const hoursHeader = (hoursWk && hoursSun)
    ? `Lun\u2013S\u00e1b ${hoursWk} \u00b7 Dom ${hoursSun}`
    : (hoursWk || hoursSun || '');

  // Siempre sobreescribe (no setIfEmpty) para evitar valores viejos del HTML
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('storeCity',          address);
  set('storePhoneHeader',   phone);
  set('storeHoursHeader',   hoursHeader);
  set('storeAddressFooter', address);
  set('storePhoneFooter',   phone);
  set('storeEmailFooter',   email);
  set('storeHoursWkFooter',  hoursWk  ? `Lun\u2013S\u00e1b: ${hoursWk}`  : '');
  set('storeHoursSunFooter', hoursSun ? `Dom: ${hoursSun}` : '');

  // Mostrar el header-top SOLO después de cargar los datos (evita parpadeo)
  const headerTop = document.querySelector('.header-top');
  if (headerTop) headerTop.classList.add('loaded');
}

// ─── PRODUCTOS ───────────────────────────────────────────────────────────────

function getFilteredProducts() {
  let list = [...getLiveProducts()];

  // Filtro categoría (comparación case-insensitive para tolerar mayúsculas/minúsculas de la BD)
  if (currentCategory !== 'all') {
    const catLower = currentCategory.toLowerCase();
    list = list.filter(p => (p.category || '').toLowerCase() === catLower);
  }

  // Filtro búsqueda (nombre · descripción · categoría · código de barras)
  if (currentSearch.trim()) {
    const q   = currentSearch.trim();
    const qLo = q.toLowerCase();

    // Si la query es 100% numérica (4+ dígitos) → buscar PRIMERO por barcode exacto/parcial
    const isNumericQuery = /^\d{4,}$/.test(q);

    list = list.filter(p => {
      // Búsqueda por código de barras (exacta o parcial)
      const bcStr = String(p.barcode || '').trim();
      if (bcStr && bcStr.includes(q)) return true;

      // Si es puramente numérico y no hubo match por barcode → no mostrar
      // resultados de texto para evitar confusión (ej: "12345" no debería
      // mostrar un producto cuyo nombre contenga "12345" en texto libre)
      if (isNumericQuery) return false;

      // Búsqueda textual: nombre · descripción · categoría
      return (
        (p.name        || '').toLowerCase().includes(qLo) ||
        (p.description || '').toLowerCase().includes(qLo) ||
        (p.category    || '').toLowerCase().includes(qLo)
      );
    });
  }

  // Ordenar
  switch (currentSort) {
    case 'price-asc':  list.sort((a,b) => a.price - b.price); break;
    case 'price-desc': list.sort((a,b) => b.price - a.price); break;
    case 'name-asc':   list.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'name-desc':  list.sort((a,b) => b.name.localeCompare(a.name)); break;
  }

  return list;
}

// ─── SKELETON LOADERS ─────────────────────────────────────────────────────────

function showProductsSkeleton(count = 8) {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  
  grid.className = 'products-grid';
  grid.innerHTML = Array(count).fill(0).map(() => `
    <div class="skeleton-product">
      <div class="skeleton skeleton-product-img"></div>
      <div class="skeleton skeleton-product-title"></div>
      <div class="skeleton skeleton-product-price"></div>
      <div class="skeleton skeleton-product-btn"></div>
    </div>
  `).join('');
}

function showCartSkeleton(count = 3) {
  const wrapper = document.getElementById('cartItems');
  if (!wrapper) return;
  
  wrapper.innerHTML = Array(count).fill(0).map(() => `
    <div class="skeleton-cart-item">
      <div class="skeleton skeleton-cart-img"></div>
      <div class="skeleton-cart-info">
        <div class="skeleton skeleton-cart-name"></div>
        <div class="skeleton skeleton-cart-price"></div>
        <div class="skeleton skeleton-cart-qty"></div>
      </div>
    </div>
  `).join('');
}

// ─── RENDERIZADO DE PRODUCTOS ─────────────────────────────────────────────────

function renderProducts(scroll = false) {
  const grid = document.getElementById('productsGrid');
  const noResults = document.getElementById('noResults');
  const paginationEl = document.getElementById('pagination');

  // ⚠️ Aún cargando desde API — no mostrar "0 productos" prematuramente
  if (_liveProducts === null) return;

  const filtered = getFilteredProducts();

  // Total y paginación
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  if (currentPage > totalPages) currentPage = 1;
  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const paged = filtered.slice(start, start + ITEMS_PER_PAGE);

  // Actualizar título de sección
  const titles = {
    all: 'Todos los Productos',
    frutas: 'Frutas Tropicales',
    vegetales: 'Vegetales Frescos',
    carnes: 'Carnes Frescas',
    lacteos: 'Productos Lácteos',
    panaderia: 'Panadería Artesanal',
    mariscos: 'Mariscos del Caribe',
    bebidas: 'Bebidas y Refrescos',
    despensa: 'Despensa y Básicos',
    embutidos: 'Embutidos',
    cuidado_personal: 'Cuidado Personal',
    electrodomesticos: 'Electrodomésticos',
    ferreteria: 'Ferretería',
    bebe: 'Bebé',
    aceites_vinagres: 'Aceites y Vinagres',
    enlatados: 'Enlatados',
    hogar_limpieza: 'Hogar y Limpieza',
    higiene_salud: 'Higiene y Salud',
    bodega: 'Bodega',
    dulces_caramelos: 'Dulces y Caramelos',
    aceitunas_encurtidos: 'Aceitunas y Encurtidos',
    pastas: 'Pastas Alimenticias',
    granos: 'Granos',
    agua_refrescos: 'Agua y Refrescos'
  };
  document.getElementById('sectionTitle').textContent = currentSearch
    ? `Resultados para "${currentSearch}"`
    : (titles[currentCategory] || 'Productos');
  document.getElementById('sectionSubtitle').textContent =
    `${filtered.length} producto${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`;

  if (paged.length === 0) {
    grid.innerHTML = '';
    noResults.classList.remove('hidden');
    paginationEl.innerHTML = '';
    return;
  }

  noResults.classList.add('hidden');
  grid.className = 'products-grid' + (currentView === 'list' ? ' list-view' : '');
  grid.innerHTML = paged.map(p => productCardHTML(p)).join('');

  // Paginación
  renderPagination(totalPages);

  // Activar lazy loading con IntersectionObserver
  initLazyImages();

  // Inyectar descripciones e imágenes desde memoria (sin fetch extra)
  // Cubre el caso donde renderProducts corre antes de que fase 2 complete
  _injectImagesFromMemory();

  // Scroll al inicio de la sección (solo cuando el usuario filtra/pagina, no al cargar)
  if (scroll) {
    const sec = document.getElementById('productsSection');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ─── Lazy Loading con IntersectionObserver ───────────────────────────────────
function initLazyImages() {
  const imgs = document.querySelectorAll('img.product-lazy-img[data-src]');
  if (!imgs.length) return;

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          loadImg(img);
          observer.unobserve(img);
        }
      });
    }, { rootMargin: '100px 0px', threshold: 0.01 });

    imgs.forEach(img => observer.observe(img));
  } else {
    // Fallback: cargar todas si no hay soporte
    imgs.forEach(img => loadImg(img));
  }
}

function loadImg(img) {
  const src = img.getAttribute('data-src');
  if (!src) return;
  const temp = new Image();
  temp.onload = () => {
    img.src = src;
    img.removeAttribute('data-src');
    img.classList.add('img-loaded');
  };
  temp.onerror = () => {
    img.src = 'images/logo-casamota.png'; // fallback al logo
    img.removeAttribute('data-src');
    img.classList.add('img-loaded');
  };
  temp.src = src;
}

function productCardHTML(p) {
  const discount = p.originalPrice
    ? Math.round((1 - p.price / p.originalPrice) * 100)
    : null;
  const badgeHTML = p.badge ? `
    <div class="product-badge">
      <span class="badge badge-${p.badge}">
        ${p.badge === 'offer' ? (discount != null ? `-${discount}%` : 'Oferta') : p.badge === 'new' ? 'Nuevo' : 'Favorito'}
      </span>
    </div>` : '';
  const stars = renderStars(p.rating);
  
  // Verificar si está en favoritos
  const isFav = favorites && favorites.some(fav => String(fav.id) === String(p.id));
  const favClass = isFav ? 'active' : '';

  return `
    <div class="product-card">
      ${badgeHTML}

      <div class="product-img-wrap"
           ontouchstart="_cardTS(event)"
           ontouchend="_cardTE(event,'${p.id}')"
           onclick="_cardClick(event,'${p.id}')"
           style="cursor:pointer">
        <img 
          data-src="${p.image || ''}" 
          data-product-id="${p.id}"
          src="images/logo-casamota.png"
          alt="${p.name}" 
          class="product-lazy-img"
          onerror="this.src='images/logo-casamota.png'"
        />
        <div class="product-img-overlay">
          <button class="quick-view-btn"><i class="fas fa-eye"></i> Vista rápida</button>
        </div>
      </div>
      <div class="product-info"
           ontouchstart="_cardTS(event)"
           ontouchend="_cardTE(event,'${p.id}')"
           onclick="_cardClick(event,'${p.id}')"
           style="cursor:pointer">
        <div class="product-cat-tag">${catLabel(p.category)}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.description || ''}</div>
        <div class="product-rating">
          <span class="stars">${stars}</span>
        </div>
        <div class="product-price-row">
          <div class="price-group">
            ${p.originalPrice ? `<span class="price-original">RD$ ${fmt$(p.originalPrice)}</span>` : ''}
            <span class="price-current">RD$ ${fmt$(p.price)} <span class="price-unit">/ ${p.unit}</span></span>
          </div>
        </div>
      </div>
      <button class="add-cart-btn" onclick="addToCart('${p.id}')" title="Agregar al carrito">
        <i class="fas fa-cart-plus"></i>
      </button>
    </div>`;
}

// ─── MANEJO DE TOQUE EN TARJETA DE PRODUCTO ──────────────────────────────────
// Diferencia un tap real de un scroll.
// Reglas:
//   • Movimiento  > 12 px en X o Y  → era scroll, NO abrir modal
//   • Duración    > 500 ms           → pulsación larga, NO abrir modal
//   • De lo contrario               → tap real, abrir modal
// En desktop el onclick funciona directamente (sin toques).

let _ctsx = 0, _ctsy = 0, _ctsTime = 0, _ctsPending = false;

function _cardTS(e) {
  // Guarda posición y tiempo cuando el dedo toca la pantalla
  const t = e.touches && e.touches[0];
  _ctsx    = t ? t.clientX : 0;
  _ctsy    = t ? t.clientY : 0;
  _ctsTime = Date.now();
}

function _cardTE(e, productId) {
  const t  = e.changedTouches && e.changedTouches[0];
  const dx = t ? Math.abs(t.clientX - _ctsx) : 0;
  const dy = t ? Math.abs(t.clientY - _ctsy) : 0;
  const dt = Date.now() - _ctsTime;

  // Movimiento > 12 px → el usuario estaba haciendo scroll, ignorar
  if (dx > 12 || dy > 12) return;
  // Toque > 500 ms → pulsación larga (ej. copiar texto), ignorar
  if (dt > 500) return;

  // Tap real confirmado: bloquear el click sintético de iOS y abrir modal
  e.preventDefault();
  if (_ctsPending) return;       // evitar doble disparo
  _ctsPending = true;
  setTimeout(() => { _ctsPending = false; }, 600);
  openModal(productId);
}

function _cardClick(e, productId) {
  // En táctil _cardTE ya abrió el modal y activó _ctsPending → salir
  if (_ctsPending) return;
  // En desktop (mouse) abrir directamente
  openModal(productId);
}

// Caché de categorías dinámicas cargadas desde la API
let _dynamicCategories = [];

// Las categorías se cargan en paralelo dentro de _loadProductsFromAPI()
// para evitar duplicar peticiones de red al arrancar la app.

/**
 * Deduplica la tabla categories: si un mismo slug aparece varias veces,
 * conserva la entrada con nombre más completo (la más larga).
 */
function _deduplicateCats(cats) {
  const map = {};
  cats.forEach(c => {
    const slug = (c.slug || c.id || '').toLowerCase();
    if (!slug) return;
    if (!map[slug]) {
      map[slug] = c;
    } else {
      // Preferir el que tenga nombre más largo (más descriptivo)
      if ((c.name || '').length > (map[slug].name || '').length) {
        map[slug] = c;
      }
    }
  });
  return Object.values(map);
}

/**
 * Reconstruye el menú y el selector de búsqueda.
 * Estrategia: tomar los slugs que REALMENTE tienen productos en la BD,
 * cruzarlos con la tabla categories para obtener nombre e ícono.
 * Esto garantiza que el menú refleje la realidad aunque categories tenga
 * duplicados o slugs sin productos.
 *
 * @param {Array} cats   - categorías de la BD (ya deduplicadas)
 * @param {Array} prods  - lista completa de productos activos
 */
function buildCategoryNav(cats, prods) {
  if (!prods || prods.length === 0) return;

  // ── Construir mapa slug → {name, icon} desde categories (deduplicado) ──
  const catMap = {};
  cats.forEach(c => {
    const slug = (c.slug || c.id || '').toLowerCase();
    if (slug) catMap[slug] = c;
  });

  // ── Obtener slugs únicos que REALMENTE tienen productos ──────────────────
  const slugsConProductos = [...new Set(
    prods
      .map(p => (p.category || '').trim().toLowerCase())
      .filter(s => s.length > 0)
  )];

  // ── Ordenar alfabéticamente por nombre de categoría ──────────────────────
  slugsConProductos.sort((a, b) => {
    const nameA = catMap[a] ? catMap[a].name : a.replace(/_/g, ' ');
    const nameB = catMap[b] ? catMap[b].name : b.replace(/_/g, ' ');
    return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
  });

  if (slugsConProductos.length === 0) return;

  // ── 1. Reconstruir menú de navegación horizontal ─────────────────────────
  // IMPORTANTE: NO añadir clase 'active' aquí — se aplica via _syncActiveCat()
  // para garantizar que nunca haya dos botones activos al mismo tiempo.
  const navEl = document.getElementById('categoryNav');
  if (navEl) {
    let html = `<li><a href="#" class="cat-link" data-cat="all" onclick="filterCategory('all')"><i class="fas fa-th-large"></i> Todo</a></li>`;
    slugsConProductos.forEach(slug => {
      const info = catMap[slug];
      const name = info ? info.name : slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const icon = (info && info.icon) ? info.icon : 'fas fa-tag';
      html += `<li><a href="#" class="cat-link" data-cat="${slug}" onclick="filterCategory('${slug}')"><i class="${icon}"></i> ${name}</a></li>`;
    });
    navEl.innerHTML = html;
  }

  // ── 2. Reconstruir selector de búsqueda ──────────────────────────────────
  const selEl = document.getElementById('searchCategory');
  if (selEl) {
    let opts = '<option value="">Todas las categorías</option>';
    slugsConProductos.forEach(slug => {
      const info = catMap[slug];
      const name = info ? info.name : slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      opts += `<option value="${slug}">${name}</option>`;
    });
    selEl.innerHTML = opts;
  }

  // ── 3. Restaurar estado activo y filtro actuales ──────────────────────────
  // _syncActiveCat pone exactamente UN botón activo y sincroniza el select
  _syncActiveCat(currentCategory);
  if (currentCategory !== 'all') {
    renderProducts(true);
  }
}

function catLabel(cat) {
  // Intentar con categorías dinámicas (slug o id)
  if (_dynamicCategories.length > 0) {
    const found = _dynamicCategories.find(c => (c.slug || c.id) === cat);
    if (found) return found.name;
  }
  // Fallback estático
  const map = {
    frutas:'Frutas', vegetales:'Vegetales', carnes:'Carnes', lacteos:'Lácteos',
    lacteos_frigerados:'Lácteos y Frigerados', lacteos_refrigerados:'Lácteos y Frigerados',
    panaderia:'Panadería', panaderia_reposteria:'Panadería y Repostería',
    mariscos:'Mariscos', bebidas:'Bebidas', despensa:'Despensa',
    embutidos:'Embutidos', cuidado_personal:'Cuidado Personal',
    electrodomesticos:'Electrodomésticos', ferreteria:'Ferretería',
    bebe:'Bebé', aceites_vinagres:'Aceites y Vinagres', enlatados:'Enlatados',
    hogar_limpieza:'Hogar y Limpieza', higiene_salud:'Higiene y Salud', bodega:'Bodega',
    dulces_caramelos:'Dulces y Caramelos', aceitunas_encurtidos:'Aceitunas y Encurtidos',
    pastas:'Pastas Alimenticias', granos:'Granos',
    granos_y_semillas:'Granos y Semillas', granos_y_tuberculos:'Granos y Tubérculos',
    tuberculos:'Tubérculos', condimentos:'Condimentos', codimentos:'Condimentos',
    control_de_plagas:'Control de Plagas', mascotas:'Mascotas',
    galletas_snack:'Galletas y Snack', vinos_licores:'Vinos y Licores',
    whiskys_rones:'Whiskys y Rones', desechables:'Desechables',
    cervezas:'Cervezas', agua_refrescos:'Agua y Refrescos',
  };
  return map[cat] || cat;
}

function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const WING = 1; // páginas visibles a cada lado de la actual
  const start = Math.max(1, currentPage - WING);
  const end   = Math.min(totalPages, currentPage + WING);

  // ── FILA 1: navegación numérica ───────────────────────────────
  let nums = '';

  // Anterior
  if (currentPage > 1) {
    nums += `<button class="page-btn page-arrow" onclick="goToPage(${currentPage - 1})" title="Anterior"><i class="fas fa-chevron-left"></i></button>`;
  }

  // Página 1 fija
  if (start > 1) {
    nums += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (start > 2) nums += `<span class="page-ellipsis">…</span>`;
  }

  // Ventana central
  for (let i = start; i <= end; i++) {
    nums += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }

  // Última página fija
  if (end < totalPages) {
    if (end < totalPages - 1) nums += `<span class="page-ellipsis">…</span>`;
    nums += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  // Siguiente
  if (currentPage < totalPages) {
    nums += `<button class="page-btn page-arrow" onclick="goToPage(${currentPage + 1})" title="Siguiente"><i class="fas fa-chevron-right"></i></button>`;
  }

  // ── FILA 2: botones Siguiente / Última ────────────────────────
  let actions = '';
  if (currentPage < totalPages) {
    actions += `<button class="page-btn page-next" onclick="goToPage(${currentPage + 1})"><i class="fas fa-chevron-right"></i> Siguiente</button>`;
  }
  if (currentPage < totalPages - 1) {
    actions += `<button class="page-btn page-last" onclick="goToPage(${totalPages})"><i class="fas fa-forward"></i> Última</button>`;
  }

  el.innerHTML = `
    <div class="page-row page-row-nums">${nums}</div>
    ${actions ? `<div class="page-row page-row-actions">${actions}</div>` : ''}
  `;
}

function goToPage(page) {
  currentPage = page;
  renderProducts(true);
}

// ─── FILTROS ─────────────────────────────────────────────────────────────────

/**
 * Función centralizada que garantiza UN SOLO botón activo en todo momento.
 * Se llama desde filterCategory, handleSearch, onSearchCategoryChange
 * y buildCategoryNav — así nunca puede haber dos categorías resaltadas.
 */
function _syncActiveCat(cat) {
  // 1) Quitar 'active' de TODOS los cat-link
  document.querySelectorAll('.cat-link').forEach(a => a.classList.remove('active'));
  // 2) Poner 'active' solo en el que corresponde
  document.querySelectorAll('.cat-link').forEach(a => {
    if (a.dataset.cat === cat) a.classList.add('active');
  });
  // 3) Sincronizar el select de la barra de búsqueda
  const catSel = document.getElementById('searchCategory');
  if (catSel) catSel.value = (cat === 'all') ? '' : cat;
  // 4) Actualizar label del botón
  _updateCatBtnLabel();
}

// ─── MODAL DE CATEGORÍAS ──────────────────────────────────────────────────────

function openCatModal() {
  const backdrop = document.getElementById('catModalBackdrop');
  const modal    = document.getElementById('catModal');
  const arrow    = document.querySelector('.cat-all-btn__arrow');
  if (!modal) return;

  // Poblar lista con categorías actuales
  _buildCatModalList();

  backdrop.style.display = 'block';
  modal.style.display    = 'flex';
  if (arrow) arrow.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCatModal() {
  const backdrop = document.getElementById('catModalBackdrop');
  const modal    = document.getElementById('catModal');
  const arrow    = document.querySelector('.cat-all-btn__arrow');
  if (modal) modal.style.display    = 'none';
  if (backdrop) backdrop.style.display = 'none';
  if (arrow) arrow.classList.remove('open');
  document.body.style.overflow = '';
}

function selectCatModal(cat) {
  closeCatModal();
  filterCategory(cat);
}

function _buildCatModalList() {
  const list = document.getElementById('catModalList');
  if (!list) return;

  // Obtener slugs únicos con productos
  const prods = _liveProducts || [];
  const slugsSet = [...new Set(
    prods.map(p => (p.category || '').trim().toLowerCase()).filter(s => s)
  )];

  // Ordenar alfabéticamente por nombre
  slugsSet.sort((a, b) => {
    const na = _getCatDisplayName(a);
    const nb = _getCatDisplayName(b);
    return na.localeCompare(nb, 'es', { sensitivity: 'base' });
  });

  // Construir HTML
  let html = `<li>
    <button class="cat-modal__item cat-modal__item--all${currentCategory === 'all' ? ' selected' : ''}"
            onclick="selectCatModal('all')">
      <span class="cat-modal__emoji">🛒</span>
      <span class="cat-modal__name">Todo</span>
    </button>
  </li>`;

  slugsSet.forEach(slug => {
    const info    = _dynamicCategories.find(c => (c.slug || '').toLowerCase() === slug);
    const name    = info ? info.name : slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const emoji   = (info && info.emoji) ? info.emoji : _defaultEmoji(slug);
    const icon    = (info && info.icon)  ? info.icon  : 'fas fa-tag';
    const sel     = currentCategory === slug ? ' selected' : '';
    // Usar emoji si existe, si no icono FA dentro de span
    const emojiHtml = emoji
      ? `<span class="cat-modal__emoji">${emoji}</span>`
      : `<span class="cat-modal__emoji"><i class="${icon}" style="font-size:.9rem"></i></span>`;
    html += `<li>
      <button class="cat-modal__item${sel}" onclick="selectCatModal('${slug}')">
        ${emojiHtml}
        <span class="cat-modal__name">${name}</span>
      </button>
    </li>`;
  });

  list.innerHTML = html;
}

function _getCatDisplayName(slug) {
  const info = _dynamicCategories.find(c => (c.slug || '').toLowerCase() === slug);
  return info ? info.name : slug.replace(/_/g, ' ');
}

function _defaultEmoji(slug) {
  const map = {
    frutas:'🍎', vegetales:'🥦', carnes:'🥩', lacteos:'🧀',
    panaderia:'🍞', mariscos:'🦐', bebidas:'🥤', despensa:'🧺',
    embutidos:'🌭', enlatados:'🥫', bebe:'👶', aceites_vinagres:'🫙',
    aceitunas_encurtidos:'🫒', galletas_snacks:'🍪', agua_y_bebidas:'💧',
    cuidado_personal:'🧴', higiene_salud:'🩺', hogar_limpieza:'🧹',
    condimentos:'🌶️', dulces_caramelos:'🍬', granos_y_tuberculos:'🌾',
    electrodomesticos:'🔌', ferreteria:'🔧', bodega:'🍷',
    whiskys_y_rones:'🥃', cervezas:'🍺', congelados:'🧊',
    pastas:'🍝', codimentos:'🌶️'
  };
  return map[slug] || '🏪';
}

// Actualizar el texto del botón según categoría activa
function _updateCatBtnLabel() {
  const label = document.getElementById('catActiveName');
  if (!label) return;
  if (currentCategory === 'all') {
    label.textContent = '';
  } else {
    label.textContent = _getCatDisplayName(currentCategory);
  }
}

function filterCategory(cat) {
  currentCategory = cat;
  currentSearch = '';
  const inp = document.getElementById('searchInput');
  if (inp) inp.value = '';
  currentPage = 1;

  _syncActiveCat(cat);
  _updateCatBtnLabel();
  updateActiveFilters();
  renderProducts(true);
  return false;
}

function handleSearch() {
  const raw = (document.getElementById('searchInput')?.value || '').trim();
  currentSearch = raw;

  // Cerrar dropdown de sugerencias al ejecutar búsqueda
  _hideLiveResults();

  // ── Atajo rápido: código de barras numérico exacto ───────────────────────
  // Si el usuario tecleó solo dígitos (6–14), buscar barcode exacto.
  // Si hay un único match, abrir el modal del producto directamente (como
  // hace el escáner físico), en lugar de mostrar la grilla filtrada.
  if (/^\d{6,14}$/.test(raw)) {
    const variants  = (typeof _barcodeVariants === 'function') ? _barcodeVariants(raw) : new Set([raw]);
    const exactProd = getLiveProducts().find(p =>
      p.barcode && variants.has(String(p.barcode).trim().replace(/\s+/g, ''))
    );
    if (exactProd) {
      document.getElementById('searchInput')?.blur();
      // Limpiar el campo de búsqueda para no dejar el código visible
      document.getElementById('searchInput').value = '';
      currentSearch = '';
      updateActiveFilters();
      renderProducts();
      openModal(exactProd.id);
      return;
    }
  }

  // Leer también el selector de categoría de la barra de búsqueda
  const catSel = document.getElementById('searchCategory');
  const catVal = catSel ? catSel.value : '';
  currentCategory = catVal || 'all';

  _syncActiveCat(currentCategory);
  currentPage = 1;
  updateActiveFilters();
  renderProducts(true);

  // Quitar foco del input para ocultar teclado en móvil
  document.getElementById('searchInput')?.blur();
}

// Filtrar al instante cuando el usuario cambia el selector de categoría
function onSearchCategoryChange() {
  const catSel  = document.getElementById('searchCategory');
  const catVal  = catSel ? catSel.value : '';
  currentCategory = catVal || 'all';
  currentSearch   = document.getElementById('searchInput')?.value || '';

  _syncActiveCat(currentCategory);
  currentPage = 1;
  updateActiveFilters();
  renderProducts(true);
}

document.getElementById('searchInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { _hideLiveResults(); handleSearch(); }
});

// Mostrar sugerencias mientras el usuario escribe
document.getElementById('searchInput')?.addEventListener('input', e => {
  const q = e.target.value.trim();
  // Para texto: activar desde 2 caracteres
  // Para números: activar desde 1 dígito (búsqueda por código de barras)
  const isNumeric = /^\d+$/.test(q);
  const minLen    = isNumeric ? 1 : 2;
  if (q.length >= minLen) {
    barcodeLiveSearch(q);
  } else {
    _hideLiveResults();
  }
});

// Cerrar sugerencias al hacer click fuera del campo
document.addEventListener('click', e => {
  const searchBar = document.querySelector('.search-bar');
  if (searchBar && !searchBar.contains(e.target)) {
    _hideLiveResults();
  }
});

function sortProducts() {
  currentSort = document.getElementById('sortSelect').value;
  currentPage = 1;
  renderProducts();
}

function setView(v) {
  currentView = v;
  document.getElementById('gridViewBtn').classList.toggle('active', v === 'grid');
  document.getElementById('listViewBtn').classList.toggle('active', v === 'list');
  renderProducts();
}

function resetFilters() {
  currentCategory = 'all';
  currentSearch = '';
  currentSort = 'default';
  currentPage = 1;
  document.getElementById('searchInput').value = '';
  document.getElementById('sortSelect').value = 'default';
  _syncActiveCat('all');   // ← centralizado: limpia todos y activa solo 'Todo'
  updateActiveFilters();
  renderProducts();
}

function updateActiveFilters() {
  const el = document.getElementById('activeFilters');
  const tags = [];

  if (currentCategory !== 'all') {
    tags.push(`<span class="filter-tag">
      <i class="fas fa-tag"></i> ${catLabel(currentCategory)}
      <button onclick="filterCategory('all')">×</button>
    </span>`);
  }
  if (currentSearch.trim()) {
    tags.push(`<span class="filter-tag">
      <i class="fas fa-search"></i> "${currentSearch}"
      <button onclick="clearSearch()">×</button>
    </span>`);
  }
  el.innerHTML = tags.join('');
}

function clearSearch() {
  currentSearch = '';
  document.getElementById('searchInput').value = '';
  currentPage = 1;
  updateActiveFilters();
  renderProducts();
}

// ─── ESCÁNER DE CÓDIGO DE BARRAS ─────────────────────────────────────────────
// Estrategia SIMPLIFICADA:
//   iOS Safari  → input file capture="environment" + ZXing decodeSingle
//   Android/Chrome (BarcodeDetector disponible) → getUserMedia + loop nativo
//   Otros → getUserMedia + ZXing decodeFromVideoElement
//   Siempre → búsqueda por nombre/código en tiempo real

let _barcodeScanning  = false;
let _barcodeSearchTimer = null;
let _cameraStream     = null;
let _scanRafId        = null;
let _zxingReader      = null;
let _torchActive      = false;   // estado actual de la linterna

/** Normaliza texto para búsqueda (quita acentos, minúsculas) */
function _normalizeText(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Actualizar estado del visor ─────────────────────────────────────────────
// Solo aplica cuando la cámara en vivo está activa.
// En modo foto (iOS/barcodePhotoFallback visible) se ignora para no
// mostrar "Abriendo cámara..." encima del spinner de procesamiento.

function _setStatus(text, type = 'scanning') {
  const fallback = document.getElementById('barcodePhotoFallback');
  const isFotoMode = fallback && !fallback.classList.contains('hidden');
  if (isFotoMode) return; // En modo foto no tocar el barcodeStatus
  const el   = document.getElementById('barcodeStatusText');
  const wrap = document.getElementById('barcodeStatus');
  if (el)   el.textContent = text;
  if (wrap) wrap.className = 'barcode-status bs-' + (type || 'scanning');
}

// ── Helpers de UI ────────────────────────────────────────────────────────────

function _isIOS() {
  return /iP(hone|ad|od)/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ── Linterna (torch) ──────────────────────────────────────────────────────────
// Usa la constraint "torch" de MediaStreamTrack cuando el stream ya está activo.
// En modo FOTO (iOS), pedimos el stream sólo para encender la linterna y lo
// mantenemos hasta que el usuario cierre el escáner o tome la foto.

let _torchStream = null;   // stream auxiliar usado solo para la linterna en iOS

async function _torchOn() {
  _torchActive = true;
  _updateTorchBtn(true);
  try {
    // Si ya tenemos un stream de cámara activo (modo live), usarlo directamente
    const stream = _cameraStream || _torchStream;
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          await track.applyConstraints({ advanced: [{ torch: true }] });
          return;
        }
      }
    }
    // iOS foto-mode: no hay stream activo → abrir uno silencioso solo para torch
    if (!_torchStream) {
      _torchStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    }
    const track = _torchStream.getVideoTracks()[0];
    if (track) {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        await track.applyConstraints({ advanced: [{ torch: true }] });
      }
    }
  } catch(e) {
    // Linterna no soportada → ignorar silenciosamente
    _torchActive = false;
    _updateTorchBtn(false);
  }
}

async function _torchOff() {
  _torchActive = false;
  _updateTorchBtn(false);
  try {
    const stream = _cameraStream || _torchStream;
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          await track.applyConstraints({ advanced: [{ torch: false }] });
        }
      }
    }
    // Liberar stream auxiliar si era solo para la linterna
    if (_torchStream && _torchStream !== _cameraStream) {
      _torchStream.getTracks().forEach(t => t.stop());
      _torchStream = null;
    }
  } catch(e) {}
}

/** Botón que el usuario puede tocar para activar/desactivar manualmente */
async function torchToggle() {
  if (_torchActive) {
    await _torchOff();
  } else {
    await _torchOn();
  }
}

/** Actualiza el icono y color del botón de linterna */
function _updateTorchBtn(on) {
  const btn = document.getElementById('barcodeTorchBtn');
  if (!btn) return;
  btn.title = on ? 'Apagar linterna' : 'Encender linterna';
  btn.innerHTML = on
    ? '<i class="fas fa-bolt" style="color:#ffe066"></i>'
    : '<i class="fas fa-bolt" style="color:#666"></i>';
  btn.classList.toggle('torch-on', on);
  btn.style.display = '';   // siempre visible dentro del escáner
}

// ── Abrir escáner ─────────────────────────────────────────────────────────────

function openBarcodeScanner() {
  const overlay = document.getElementById('barcodeOverlay');
  if (!overlay) return;
  _hideBarcodeResult();
  _clearManualInput();
  _hideLiveResults();
  _barcodeScanning = false;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // ⚠️ iOS Safari: desbloquear AudioContext AQUÍ (dentro del tap del usuario)
  // para que el beep funcione más tarde cuando se detecte el código.
  _unlockAudio();

  _refreshBarcodeProducts();
  _torchActive = false;
  _updateTorchBtn(false);

  if (_isIOS()) {
    // iOS Safari: getUserMedia en live stream tiene problemas con autofoco.
    // Mostramos directamente el modo foto (captura nativa) que sí funciona bien.
    _showPhotoMode();
  } else {
    // Android / Chrome / Desktop: iniciar cámara en vivo
    _startLiveCamera();
  }
}

// ── Cerrar escáner ────────────────────────────────────────────────────────────

function closeBarcodeScanner() {
  _barcodeScanning = false;
  _torchOff();          // apagar linterna al cerrar
  _stopLiveCamera();
  const overlay = document.getElementById('barcodeOverlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
}

function _stopLiveCamera() {
  if (_scanRafId) { cancelAnimationFrame(_scanRafId); _scanRafId = null; }
  if (_zxingReader) { try { _zxingReader.reset(); } catch(e) {} _zxingReader = null; }
  if (_cameraStream) { _cameraStream.getTracks().forEach(t => t.stop()); _cameraStream = null; }
  const area = document.getElementById('barcodeQuaggaArea');
  if (area) area.innerHTML = '';
}

async function _refreshBarcodeProducts() {
  try { const f = await DB.getProducts(); if (f && f.length) _liveProducts = f; } catch(e) {}
}

// ── MODO FOTO (iOS + fallback sin cámara) ─────────────────────────────────────
// Usa el input nativo de la cámara del dispositivo (siempre funciona en iOS)

function _showPhotoMode() {
  document.getElementById('barcodeViewfinder')?.classList.add('hidden');
  const fb = document.getElementById('barcodePhotoFallback');
  if (fb) {
    fb.classList.remove('hidden');
    const hint = fb.querySelector('.barcode-photo-hint');
    if (hint) hint.innerHTML = '<i class="fas fa-camera" style="color:#00e676"></i> Fotografía el código de barras del producto:';
  }
}

function handleBarcodePhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  // Apagar linterna al recibir la foto (ya no la necesitamos)
  _torchOff();
  const proc = document.getElementById('barcodePhotoProcessing');
  if (proc) proc.classList.remove('hidden');
  _hideBarcodeResult();

  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function() {
    URL.revokeObjectURL(url);

    // ── Paso 1: escalar a tamaño óptimo (2000px para máximo detalle) ──────────
    const maxSide = 2000;
    const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
    const w = Math.round(img.width  * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    // ── Paso 2: generar versiones procesadas para mejor lectura ───────────────
    // Versión A: original escalado (full)
    // Versión B: alto contraste en escala de grises
    // Versión C: binarización adaptativa (blanco/negro puro — muy efectiva)
    // Versión D: recorte franja central (40%-70%)
    // Versión E: recorte mitad inferior (donde suele estar el código)
    // Versión F: recorte mitad superior
    // Versión G: nitidez aumentada (sharpening)
    const canvases = [
      canvas,
      _enhanceCanvas(canvas),             // alto contraste + grises
      _binarizeCanvas(canvas),            // binarización adaptativa
      _cropCanvas(canvas, 0.3, 0.7),      // franja central
      _cropCanvas(canvas, 0.4, 1.0),      // 60% inferior
      _cropCanvas(canvas, 0.0, 0.6),      // 60% superior
      _sharpenCanvas(canvas),             // nitidez aumentada
    ];

    // Intentar BarcodeDetector primero en todas las variantes × 4 rotaciones
    // (rápido, nativo del SO — sin límite de intentos)
    if (window.BarcodeDetector) {
      const det = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'] });
      _detectAllVariants(det, canvases).then(code => {
        if (proc) proc.classList.add('hidden');
        if (code) {
          _onBarcodeDetected(code);
        } else {
          // Quagga solo con los 3 canvases más efectivos (evitar los 28 intentos)
          _tryQuaggaAllVariants(canvases.slice(0, 3), proc, input);
        }
      }).catch(() => _tryQuaggaAllVariants(canvases.slice(0, 3), proc, input));
    } else {
      // Sin BarcodeDetector: Quagga con los 4 canvases más útiles × 4 rotaciones = 16 intentos
      _tryQuaggaAllVariants(canvases.slice(0, 4), proc, input);
    }
  };
  img.onerror = function() {
    URL.revokeObjectURL(url);
    if (proc) proc.classList.add('hidden');
    if (input) input.value = '';
    _showBarcodeError('No se pudo cargar la imagen. Intenta de nuevo.');
  };
  img.src = url;
}

/**
 * Devuelve una versión del canvas con alto contraste en escala de grises.
 * Mejora la lectura en envases curvos, brillantes o con fondo de color.
 */
function _enhanceCanvas(src) {
  const dst = document.createElement('canvas');
  dst.width  = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const imageData = ctx.getImageData(0, 0, dst.width, dst.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray     = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    const contrast = Math.min(255, Math.max(0, (gray - 128) * 2.0 + 128)); // factor 2.0 (era 1.8)
    d[i] = d[i+1] = d[i+2] = contrast;
  }
  ctx.putImageData(imageData, 0, 0);
  return dst;
}

/**
 * Binarización adaptativa: convierte la imagen a blanco/negro puro
 * usando el umbral de Otsu (muy efectiva en códigos de barras impresos).
 */
function _binarizeCanvas(src) {
  const dst = document.createElement('canvas');
  dst.width  = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const imageData = ctx.getImageData(0, 0, dst.width, dst.height);
  const d = imageData.data;
  const len = d.length / 4;

  // Calcular histograma de grises
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
    hist[gray]++;
  }

  // Umbral de Otsu
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    wF = len - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v  = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; threshold = t; }
  }

  // Aplicar umbral
  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
    const val  = gray > threshold ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
  return dst;
}

/**
 * Aplica un kernel de nitidez (unsharp mask 3×3) para mejorar
 * la definición de las barras en fotos ligeramente desenfocadas.
 */
function _sharpenCanvas(src) {
  const dst = document.createElement('canvas');
  dst.width  = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d');
  ctx.drawImage(src, 0, 0);
  // Usar filter CSS si está disponible (más rápido)
  try {
    const tmp = document.createElement('canvas');
    tmp.width = src.width; tmp.height = src.height;
    const tc = tmp.getContext('2d');
    tc.filter = 'contrast(1.2) brightness(1.05)';
    tc.drawImage(src, 0, 0);
    return tmp;
  } catch(e) { return dst; }
}

/**
 * Recorta una franja vertical del canvas (fromY y toY en fracción 0.0-1.0).
 * Útil para aislar la zona donde suele estar el código de barras.
 */
function _cropCanvas(src, fromY, toY) {
  const y0 = Math.round(src.height * fromY);
  const y1 = Math.round(src.height * toY);
  const dst = document.createElement('canvas');
  dst.width  = src.width;
  dst.height = y1 - y0;
  dst.getContext('2d').drawImage(src, 0, y0, src.width, y1 - y0, 0, 0, src.width, y1 - y0);
  return dst;
}

/**
 * Rota un canvas en múltiplos de 90° y devuelve el canvas rotado.
 * @param {HTMLCanvasElement} src  Canvas original
 * @param {number} deg  Ángulo: 0, 90, 180 o 270
 */
function _rotateCanvas(src, deg) {
  if (deg === 0) return src;
  const swap = (deg === 90 || deg === 270);
  const dst = document.createElement('canvas');
  dst.width  = swap ? src.height : src.width;
  dst.height = swap ? src.width  : src.height;
  const ctx = dst.getContext('2d');
  ctx.translate(dst.width / 2, dst.height / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return dst;
}

/**
 * Intenta detectar con BarcodeDetector en todas las variantes × 4 rotaciones.
 * Devuelve Promise<string|null>
 */
async function _detectAllVariants(detector, canvases) {
  const rotations = [0, 90, 270, 180];
  for (const src of canvases) {
    for (const deg of rotations) {
      try {
        const rotated = _rotateCanvas(src, deg);
        const codes = await detector.detect(rotated);
        if (codes && codes.length) return codes[0].rawValue;
      } catch(e) { /* continuar */ }
    }
  }
  return null;
}

/**
 * Intenta decodificar con Quagga en todas las variantes × 4 rotaciones.
 * canvases = array de canvas (original + versiones procesadas)
 */
function _tryQuaggaAllVariants(canvases, proc, input) {
  if (typeof Quagga === 'undefined') {
    if (proc) proc.classList.add('hidden');
    if (input) input.value = '';
    _showBarcodeError('No se pudo leer el código. Escribe el nombre o número abajo.');
    return;
  }

  // Generar lista plana: [canvas0_0°, canvas0_90°, ..., canvas1_0°, ...]
  const rotations = [0, 90, 270, 180];
  const attempts = [];
  for (const src of canvases) {
    for (const deg of rotations) {
      attempts.push(_rotateCanvas(src, deg));
    }
  }

  let idx = 0;
  function tryNext() {
    if (idx >= attempts.length) {
      if (proc) proc.classList.add('hidden');
      if (input) input.value = '';
      _showBarcodeError('No se pudo leer el código.\nAsegúrate de que esté bien enfocado e iluminado, o escribe el nombre/código abajo.');
      return;
    }
    const c = attempts[idx++];
    Quagga.decodeSingle({
      src: c.toDataURL('image/jpeg', 0.92),
      numOfWorkers: 0,
      locate: true,
      inputStream: { size: Math.max(c.width, c.height) },
      decoder: {
        readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader'],
        multiple: false
      }
    }, function(result) {
      if (result && result.codeResult && result.codeResult.code) {
        if (proc) proc.classList.add('hidden');
        _onBarcodeDetected(result.codeResult.code);
      } else {
        tryNext();
      }
    });
  }

  tryNext();
}

// ── MODO CÁMARA EN VIVO (Android/Chrome) ─────────────────────────────────────

async function _startLiveCamera() {
  _setStatus('Iniciando cámara…', 'loading');
  document.getElementById('barcodeViewfinder')?.classList.remove('hidden');
  document.getElementById('barcodePhotoFallback')?.classList.add('hidden');

  const area = document.getElementById('barcodeQuaggaArea');
  if (!area) return;
  area.innerHTML = '';

  // Crear video element
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('muted', '');
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;';
  area.appendChild(video);

  // Canvas overlay para feedback visual
  const oc = document.createElement('canvas');
  oc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;';
  area.appendChild(oc);

  // Pedir cámara trasera — máxima resolución + autofoco continuo
  try {
    _cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1920, min: 640 },
        height: { ideal: 1080, min: 480 },
        frameRate: { ideal: 30, min: 15 },
        focusMode: { ideal: 'continuous' }   // autofoco continuo
      },
      audio: false
    });
    // Aplicar autofoco + exposición continua si el dispositivo lo soporta
    try {
      const track = _cameraStream.getVideoTracks()[0];
      const caps  = track.getCapabilities ? track.getCapabilities() : {};
      const adv   = {};
      if (caps.focusMode?.includes('continuous'))   adv.focusMode    = 'continuous';
      if (caps.exposureMode?.includes('continuous')) adv.exposureMode = 'continuous';
      if (caps.whiteBalanceMode?.includes('continuous')) adv.whiteBalanceMode = 'continuous';
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
    } catch(e) { /* ignorar si el navegador no soporta estas constraints */ }
  } catch(err) {
    // Sin permisos → mostrar modo foto
    _showPhotoMode();
    const fb = document.getElementById('barcodePhotoFallback');
    if (fb) {
      const hint = fb.querySelector('.barcode-photo-hint');
      if (hint) hint.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#f57c00"></i> Sin acceso a la cámara. Fotografía el código:';
    }
    return;
  }

  video.srcObject = _cameraStream;
  try { await video.play(); } catch(e) {}
  _setStatus('Apunta al código de barras', 'scanning');

  // ── Usar BarcodeDetector nativo si está disponible (Android Chrome) ────────
  if (window.BarcodeDetector) {
    let formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','code_93'];
    try {
      const sup = await BarcodeDetector.getSupportedFormats();
      const filtered = formats.filter(f => sup.includes(f));
      if (filtered.length) formats = filtered;
    } catch(e) {}

    const detector = new BarcodeDetector({ formats });

    // Throttle: intentar cada 80ms en vez de cada frame (menos CPU, más estable)
    let _lastDetect = 0;
    const DETECT_INTERVAL = 80;

    const loop = () => {
      if (_barcodeScanning || !_cameraStream) return;
      const now = Date.now();
      if (video.readyState >= 2 && now - _lastDetect >= DETECT_INTERVAL) {
        _lastDetect = now;
        detector.detect(video).then(codes => {
          if (codes && codes.length && !_barcodeScanning) {
            // Ordenar por confianza si está disponible (Chrome 95+)
            const best = codes.sort((a,b) => (b.confidence||0)-(a.confidence||0))[0];
            // Flash verde de confirmación
            oc.width  = video.videoWidth;
            oc.height = video.videoHeight;
            const ctx = oc.getContext('2d');
            // Dibujar rectángulo alrededor del código detectado
            if (best.boundingBox) {
              const bb = best.boundingBox;
              ctx.strokeStyle = '#00e676';
              ctx.lineWidth   = 4;
              ctx.shadowBlur  = 12;
              ctx.shadowColor = '#00e676';
              ctx.strokeRect(bb.x, bb.y, bb.width, bb.height);
            }
            ctx.fillStyle = 'rgba(0,230,118,0.18)';
            ctx.fillRect(0,0,oc.width,oc.height);
            setTimeout(() => ctx.clearRect(0,0,oc.width,oc.height), 600);
            _onBarcodeDetected(best.rawValue);
          } else {
            _scanRafId = requestAnimationFrame(loop);
          }
        }).catch(() => { _scanRafId = requestAnimationFrame(loop); });
      } else {
        _scanRafId = requestAnimationFrame(loop);
      }
    };
    _scanRafId = requestAnimationFrame(loop);
    return;
  }

  // ── ZXing como fallback (si BarcodeDetector no está disponible) ──────────
  const ZXingCtor = window.ZXingBrowser?.BrowserMultiFormatReader
                 || window.ZXing?.BrowserMultiFormatReader;
  if (ZXingCtor) {
    try {
      // Hints: TRY_HARDER (3) + POSSIBLE_FORMATS (2) solo para formatos de códigos de barras comunes
      // Esto reduce falsos positivos y acelera la detección
      const hints = new Map();
      hints.set(3, true);   // TRY_HARDER
      hints.set(2, [        // POSSIBLE_FORMATS
        1,   // AZTEC
        8,   // CODE_128
        4,   // CODE_39
        14,  // EAN_13
        13,  // EAN_8
        17,  // UPC_A
        18,  // UPC_E
      ]);
      _zxingReader = new ZXingCtor(hints);
      // Aumentar el tiempo de escaneo entre frames (menos CPU)
      _zxingReader.timeBetweenDecodingAttempts = 100;
      _zxingReader.decodeFromVideoElement(video, (result, err) => {
        if (result && !_barcodeScanning) _onBarcodeDetected(result.getText());
        // Ignorar errores NotFoundException (normales cuando no hay código)
      });
      return;
    } catch(e) {}
  }

  // ── Último recurso: canvas loop con Quagga2 (mejorado) ───────────────────
  const quaggaLoop = () => {
    if (_barcodeScanning || !_cameraStream || video.readyState < 2) {
      if (!_barcodeScanning) setTimeout(quaggaLoop, 250);
      return;
    }
    if (typeof Quagga === 'undefined') return;

    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;

    // Capturar solo la franja central (donde suele estar el código)
    // Esto reduce ruido y acelera Quagga
    const cropH = Math.round(vh * 0.5);   // 50% central vertical
    const cropY = Math.round(vh * 0.25);  // empezar al 25% desde arriba
    const cap = document.createElement('canvas');
    cap.width  = vw;
    cap.height = cropH;
    const ctx = cap.getContext('2d');
    ctx.drawImage(video, 0, cropY, vw, cropH, 0, 0, vw, cropH);

    Quagga.decodeSingle({
      src: cap.toDataURL('image/jpeg', 0.95),
      numOfWorkers: 0,
      locate: true,
      inputStream: { size: Math.max(vw, cropH) },
      decoder: {
        readers: [
          'ean_reader',
          'ean_8_reader',
          'upc_reader',
          'upc_e_reader',
          'code_128_reader',
          'code_39_reader'
        ],
        multiple: false,
        debug: false
      },
      locator: {
        patchSize: 'medium',
        halfSample: false   // más preciso (sin reducir la imagen)
      }
    }, r => {
      if (r && r.codeResult && r.codeResult.code && !_barcodeScanning) {
        // Flash verde en overlay
        oc.width = vw; oc.height = vh;
        const c2 = oc.getContext('2d');
        c2.fillStyle = 'rgba(0,230,118,0.25)';
        c2.fillRect(0,0,vw,vh);
        setTimeout(() => c2.clearRect(0,0,vw,vh), 500);
        _onBarcodeDetected(r.codeResult.code);
      } else if (!_barcodeScanning) {
        setTimeout(quaggaLoop, 180);
      }
    });
  };
  quaggaLoop();
}

// ─── BÚSQUEDA EN VIVO (nombre / descripción / código de barras) ───────────────

function barcodeLiveSearch(query) {
  clearTimeout(_barcodeSearchTimer);
  const q = (query || '').trim();

  if (!q) { _hideLiveResults(); return; }

  // Debounce: 120ms para texto, 80ms para números (respuesta más rápida al teclear)
  const isNumericQuery = /^\d+$/.test(q);
  const delay = isNumericQuery ? 80 : 200;

  _barcodeSearchTimer = setTimeout(() => {
    const norm  = _normalizeText(q);
    const prods = getLiveProducts();
    let results;

    if (isNumericQuery) {
      // ── Modo numérico: buscar SOLO por código de barras (starts-with o contains) ──
      // Ordenar: los que empiezan por la query primero, luego los que la contienen
      const startsWith = [];
      const contains   = [];
      prods.forEach(p => {
        const bc = String(p.barcode || '').trim();
        if (!bc) return;
        if (bc.startsWith(q))     startsWith.push(p);
        else if (bc.includes(q))  contains.push(p);
      });
      results = [...startsWith, ...contains].slice(0, 10);
    } else {
      // ── Modo texto: buscar en nombre + descripción + barcode ──
      results = prods.filter(p => {
        const inName = _normalizeText(p.name).includes(norm);
        const inDesc = _normalizeText(p.description || '').includes(norm);
        const inCode = p.barcode && String(p.barcode).trim().includes(q);
        return inName || inDesc || inCode;
      }).slice(0, 8);
    }

    _renderLiveResults(results, q, isNumericQuery);
  }, delay);
}

function _renderLiveResults(results, query, isNumericQuery) {
  const container = document.getElementById('barcodeLiveResults');
  if (!container) return;

  if (!results.length) {
    // Para numérico: mostrar "sin resultados" solo a partir de 4+ dígitos
    // (con 1-3 dígitos aún puede no haber resultados y es demasiado temprano)
    if (isNumericQuery && query.length < 4) {
      container.classList.add('hidden');
      return;
    }
    container.innerHTML = `<div class="blr-empty"><i class="fas fa-barcode"></i> Sin producto con código <strong>${_escHtml(query)}</strong></div>`;
    container.classList.remove('hidden');
    return;
  }

  const norm = _normalizeText(query);
  container.innerHTML = results.map(p => {
    const price  = `RD$ ${fmt$(+p.price || 0)}`;
    const img    = p.image || 'images/logo-casamota.png';
    const nameH  = isNumericQuery ? _escHtml(p.name) : _highlightText(p.name, norm);

    // Resaltar los dígitos coincidentes en el código de barras
    let bcHTML = '';
    if (p.barcode) {
      const bcStr = String(p.barcode).trim();
      if (isNumericQuery) {
        const idx = bcStr.indexOf(query);
        if (idx >= 0) {
          bcHTML = `<span class="blr-code">`
            + _escHtml(bcStr.substring(0, idx))
            + `<mark style="background:#d1fae5;color:#065f46;border-radius:2px">${_escHtml(bcStr.substring(idx, idx + query.length))}</mark>`
            + _escHtml(bcStr.substring(idx + query.length))
            + `</span>`;
        } else {
          bcHTML = `<span class="blr-code">${_escHtml(bcStr)}</span>`;
        }
      } else {
        bcHTML = `<span class="blr-code">${_escHtml(bcStr)}</span>`;
      }
    }

    return `<div class="blr-item" onclick="_hideLiveResults(); closeBarcodeScanner(); openModal('${p.id}')">
      <img src="${img}" alt="" onerror="this.src='images/logo-casamota.png'" loading="lazy">
      <div class="blr-info">
        <div class="blr-name">${nameH}</div>
        ${bcHTML}
      </div>
      <div class="blr-price">${price}</div>
    </div>`;
  }).join('');

  container.classList.remove('hidden');
}

function _highlightText(text, norm) {
  if (!norm) return _escHtml(text);
  const idx = _normalizeText(text).indexOf(norm);
  if (idx < 0) return _escHtml(text);
  return _escHtml(text.substring(0, idx))
    + `<mark>${_escHtml(text.substring(idx, idx + norm.length))}</mark>`
    + _escHtml(text.substring(idx + norm.length));
}

function _escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _hideLiveResults() {
  const c = document.getElementById('barcodeLiveResults');
  if (c) { c.classList.add('hidden'); c.innerHTML = ''; }
}

// ─── BÚSQUEDA MANUAL (enter / botón) ─────────────────────────────────────────

function submitManualBarcode() {
  const inp  = document.getElementById('barcodeManualInput');
  const code = inp ? inp.value.trim() : '';
  if (!code) return;

  // Primero intentar como código de barras exacto (con variantes EAN-13/UPC-A)
  const cleanCode = code.replace(/\s+/g, '');
  const variants  = _barcodeVariants(cleanCode);
  const byBarcode = getLiveProducts().find(p =>
    p.barcode && variants.has(String(p.barcode).trim().replace(/\s+/g, ''))
  );

  if (byBarcode) {
    // Código encontrado exacto → abrir producto directamente
    _onBarcodeDetected(cleanCode);
    return;
  }

  // Si el código es completamente numérico (viene del escáner de foto),
  // NO hacer búsqueda por nombre — solo mostrar "no encontrado" limpio
  const isNumericCode = /^\d{4,}$/.test(cleanCode);
  if (isNumericCode) {
    // Ocultar lista de resultados antes de mostrar error
    _hideLiveResults();
    _onBarcodeDetected(cleanCode); // mostrará el mensaje "no encontrado" limpio
    return;
  }

  // Si es texto (búsqueda manual escrita), hacer búsqueda por nombre
  barcodeLiveSearch(code);
}

function _clearManualInput() {
  const inp = document.getElementById('barcodeManualInput');
  if (inp) inp.value = '';
  const photoInput = document.getElementById('barcodePhotoInput');
  if (photoInput) photoInput.value = '';
}

// ─── BEEP DE ESCÁNER (Sistema híbrido iOS-compatible) ─────────────────────────
// iOS Safari bloquea AudioContext si no se crea DENTRO de un tap directo.
// Estrategia:
//   1) En el tap de "abrir escáner" → _unlockAudio() crea el contexto Y precarga
//      un AudioBuffer con el beep real ya sintetizado.
//   2) Al detectar → _beepScanner() reproduce el buffer precargado (instantáneo,
//      no requiere nuevo tap) + fallback con Audio() base64 si falla.

let _audioCtx      = null;
let _beepBufFound  = null;   // AudioBuffer precargado: beep de "encontrado"
let _beepBufError  = null;   // AudioBuffer precargado: doble beep de "error"

/** Sintetiza PCM de un beep puro (sin osciladores en tiempo real) */
function _buildBeepBuffer(ctx, freqs, durationEach = 0.18, gap = 0.06) {
  const sr       = ctx.sampleRate;
  const totalSec = freqs.length * durationEach + (freqs.length - 1) * gap;
  const buf      = ctx.createBuffer(1, Math.ceil(sr * totalSec), sr);
  const data     = buf.getChannelData(0);
  let offset = 0;
  freqs.forEach((freq, idx) => {
    const segLen = Math.ceil(sr * durationEach);
    const fadeIn = Math.ceil(sr * 0.008);
    const fadeOut= Math.ceil(sr * 0.04);
    for (let i = 0; i < segLen; i++) {
      let amp = 0.32 * Math.sin(2 * Math.PI * freq * i / sr);
      if (i < fadeIn)                   amp *= i / fadeIn;
      if (i > segLen - fadeOut)         amp *= (segLen - i) / fadeOut;
      if (offset + i < data.length)     data[offset + i] = amp;
    }
    offset += segLen + Math.ceil(sr * gap);
  });
  return buf;
}

/** Llama esto dentro del tap de "Abrir escáner" para desbloquear el audio en iOS */
function _unlockAudio() {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }

    // --- Preconstruir buffers mientras el usuario aún interactúa ---
    if (!_beepBufFound) {
      _beepBufFound = _buildBeepBuffer(_audioCtx, [1850], 0.18, 0);
    }
    if (!_beepBufError) {
      _beepBufError = _buildBeepBuffer(_audioCtx, [520, 400], 0.18, 0.06);
    }

    // Reproducir 1 ms de silencio para "desbloquear" el contexto en iOS
    const silent = _audioCtx.createBuffer(1, 1, 22050);
    const src    = _audioCtx.createBufferSource();
    src.buffer   = silent;
    src.connect(_audioCtx.destination);
    src.start(0);
  } catch(e) {}
}

/** Reproduce el buffer precargado; si falla, usa Audio() con base64 */
function _beepScanner(found = true) {
  // ── Intento 1: AudioBuffer precargado (más rápido, sin artefactos) ──────────
  try {
    if (_audioCtx && _audioCtx.state !== 'closed') {
      // resume() por si volvió a 'suspended' (p.ej. pantalla bloqueada)
      const playBuf = (buf) => {
        const src = _audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(_audioCtx.destination);
        src.start(0);
      };
      if (_audioCtx.state === 'suspended') {
        _audioCtx.resume().then(() => {
          playBuf(found ? _beepBufFound : _beepBufError);
        });
      } else {
        playBuf(found ? _beepBufFound : _beepBufError);
      }
      return; // éxito → salir
    }
  } catch(e) {}

  // ── Intento 2: Sintetizar en tiempo real con Web Audio API ──────────────────
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (found) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 1850;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.22);
    } else {
      [0, 0.28].forEach((delay, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = 520 - i * 120;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.2);
      });
    }
  } catch(e) {}
}

// ─── RESULTADO COMÚN ──────────────────────────────────────────────────────────

/**
 * Fix iPhone: convierte UPC-A (12 dígitos) a EAN-13 añadiendo "0" al inicio.
 * Generamos todas las variantes para comparar contra lo que esté guardado.
 */
function _barcodeVariants(code) {
  const clean = String(code).trim().replace(/\s+/g, '');
  const v = new Set([clean]);
  if (clean.length === 13 && clean.startsWith('0')) v.add(clean.slice(1)); // EAN-13 → UPC-A
  if (clean.length === 12) v.add('0' + clean);                              // UPC-A → EAN-13
  return v;
}

async function _onBarcodeDetected(code) {
  _barcodeScanning = true;
  _stopLiveCamera();
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);

  const cleanCode = String(code).trim().replace(/\s+/g, '');
  const variants  = _barcodeVariants(cleanCode);

  const findByBarcode = list => list.find(p =>
    p.barcode && variants.has(String(p.barcode).trim().replace(/\s+/g, ''))
  );

  // 1) Buscar en catálogo local
  let product = findByBarcode(getLiveProducts());

  // 2) Si no encontrado, forzar recarga fresca desde API
  if (!product) {
    try {
      const freshProds = await DB.getProducts();
      if (freshProds && freshProds.length > 0) {
        _liveProducts = freshProds;
        product = findByBarcode(freshProds);
      }
    } catch(e) { /* ignorar error de red */ }
  }

  if (product) {
    _beepScanner(true);                    // 🔊 beep agudo "encontrado"
    if (navigator.vibrate) navigator.vibrate(300);
    // NO llamar _setStatus aquí — en modo foto haría visible barcodeStatus
    document.getElementById('barcodeResultText').textContent = `✓ ${product.name}`;
    document.getElementById('barcodeResult')?.classList.remove('hidden');
    document.getElementById('barcodeError')?.classList.add('hidden');
    // Asegurar que barcodeStatus sigue oculto
    const stEl = document.getElementById('barcodeStatus');
    if (stEl) stEl.style.display = 'none';
    setTimeout(() => { closeBarcodeScanner(); openModal(product.id); }, 900);
  } else {
    _beepScanner(false);                   // 🔊 doble beep bajo "no encontrado"
    if (navigator.vibrate) navigator.vibrate([100, 80, 100]);
    // Ocultar lista de resultados antes de mostrar error
    _hideLiveResults();
    const msg = '❌ Producto no encontrado. Verifica el código o busca por nombre.';
    _showBarcodeError(msg);
    _barcodeScanning = false; // permitir nuevo intento
    setTimeout(() => {
      _hideBarcodeResult();
      _clearManualInput();
      if (!_isIOS()) _startLiveCamera();
    }, 5000);
  }
}

function _showBarcodeError(msg) {
  // 1) Ocultar TODOS los elementos de estado — sin excepción
  const hint     = document.getElementById('barcodePhotoHint');
  const statusEl = document.getElementById('barcodeStatus');
  const proc     = document.getElementById('barcodePhotoProcessing');
  if (hint)     { hint.style.display = 'none'; hint.textContent = ''; }
  if (statusEl) { statusEl.style.display = 'none'; statusEl.className = 'barcode-status'; }
  if (proc)     { proc.style.display = 'none'; proc.classList.add('hidden'); }

  // 2) Mostrar error con texto limpio
  const el = document.getElementById('barcodeErrorText');
  if (el) el.textContent = msg;
  document.getElementById('barcodeError')?.classList.remove('hidden');
  document.getElementById('barcodeResult')?.classList.add('hidden');

  // 3) Mostrar botón de reintento y ocultar lista de resultados
  if (typeof _setScanState === 'function') {
    _setScanState(null, true);
  } else {
    const btn = document.getElementById('barcodeBtnReopen');
    if (btn) { btn.classList.remove('hidden'); btn.style.display = ''; }
  }
  _hideLiveResults();
}

function _hideBarcodeResult() {
  document.getElementById('barcodeResult')?.classList.add('hidden');
  document.getElementById('barcodeError')?.classList.add('hidden');
}

// ─── CARRITO ──────────────────────────────────────────────────────────────────

function addToCart(productId, qty = 1) {
  const product = getLiveProducts().find(p => String(p.id) === String(productId));
  if (!product) return;

  const existing = cart.find(c => String(c.id) === String(productId));
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ ...product, qty });
  }

  saveCart();
  updateCartUI();
  showToast(`<i class="fas fa-check"></i> ${product.name} agregado al carrito`, 'success');
}

function removeFromCart(productId) {
  const id = String(productId);
  cart = cart.filter(c => String(c.id) !== id);
  saveCart();
  updateCartUI();
  renderCartItems();
}

function updateQty(productId, delta) {
  const id   = String(productId);
  const item = cart.find(c => String(c.id) === id);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) {
    removeFromCart(id);
    return;
  }
  item.qty = newQty;
  saveCart();
  updateCartUI();
  renderCartItems();
}

function saveCart() {
  localStorage.setItem('casamota_cart', JSON.stringify(cart));
}

function updateCartUI() {
  const totalQty  = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal  = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const envio     = cart.length > 0 ? _calcEnvio(totalQty, subtotal) : 0;
  const total     = subtotal + envio;

  // Badge del carrito
  document.getElementById('cartBadge').textContent = totalQty;

  // Subtotal
  const subEl = document.getElementById('cartSubtotal');
  if (subEl) subEl.textContent = `RD$ ${fmt$(subtotal)}`;

  // Envío — mismo texto y color que el checkout
  const shipEl = document.getElementById('cartShipping');
  if (shipEl) {
    if (envio === 0) {
      shipEl.innerHTML = `<span style="color:#1a7c3e;font-weight:700">Gratis</span>`;
    } else {
      shipEl.innerHTML = `RD$ ${fmt$(envio)}`;
      shipEl.style.color = '';
    }
  }

  // Total incluyendo envío
  const totEl = document.getElementById('cartTotal');
  if (totEl) totEl.textContent = `RD$ ${fmt$(total)}`;
}

function renderCartItems() {
  const wrapper = document.getElementById('cartItems');
  const footer  = document.getElementById('cartFooter');
  if (!wrapper) return;

  if (cart.length === 0) {
    wrapper.innerHTML = `
      <div class="cart-empty">
        <i class="fas fa-cart-shopping"></i>
        <p>Tu carrito está vacío</p>
        <span>Agrega productos para comenzar</span>
      </div>`;
    if (footer) footer.classList.add('hidden');
    return;
  }

  if (footer) footer.classList.remove('hidden');

  wrapper.innerHTML = cart.map(item => {
    const sustOn = getSustItemPref(item.id);
    return `
    <div class="cart-item" id="cart-item-${item.id}">
      <div class="cart-item-img">
        <img src="${item.image}" alt="${item.name}" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        ${item.unit ? `<div class="cart-item-unit">1 × RD$ ${fmt$(item.price)} / ${item.unit}</div>` : ''}
        <div class="cart-item-price">
          RD$ ${fmt$(item.price)}
          ${item.qty > 1 ? `<span class="cart-item-total-sub">Total: RD$ ${fmt$(item.price * item.qty)}</span>` : ''}
        </div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateQty('${item.id}', -1)" title="Restar">
            <i class="fas fa-minus"></i>
          </button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="updateQty('${item.id}', 1)" title="Agregar uno más">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <!-- Toggle sustitución individual por producto -->
        <div class="cart-item-sust-row">
          <label class="cart-item-sust-label" for="sust-${item.id}">
            <i class="fas fa-shuffle cart-item-sust-icon"></i>
            <span>Autorizo sustituir</span>
          </label>
          <label class="toggle-switch toggle-switch--sm">
            <input type="checkbox" id="sust-${item.id}"
              ${sustOn ? 'checked' : ''}
              onchange="saveSustItemPref('${item.id}', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart('${item.id}')" title="Eliminar del carrito">
        <i class="fas fa-trash-can"></i>
      </button>
    </div>`;
  }).join('');
}

function _calcSafeTop() {
  // En PWA standalone, leer safe-area-inset-top real del sistema
  try {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:0;width:0;height:0;pointer-events:none;visibility:hidden';
    document.body.appendChild(el);
    const v = parseInt(getComputedStyle(el).top, 10) || 0;
    document.body.removeChild(el);
    if (v > 0) return v;
  } catch(e) {}
  
  // Fallback: detectar si es standalone y aplicar valores conocidos de iOS
  const isStandalone = window.navigator.standalone === true ||
                       window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) {
    // iPhones con notch/dynamic island: ~47-59px; sin notch: 20px
    // Usar heurística basada en altura de pantalla
    const h = window.screen.height;
    if (h >= 844) return 47; // iPhone 12/13/14 Pro Max y similares
    if (h >= 812) return 44; // iPhone X/11 Pro y similares  
    return 20; // iPhones antiguos sin notch
  }
  
  return 0; // Navegador normal o Android
}

function _applyPanelTop() {
  const topPx = _calcSafeTop();
  document.documentElement.style.setProperty('--cart-top', `${topPx}px`);
}

function _applyHeaderHeight() {
  const header = document.querySelector('header');
  if (!header) return;
  const h = header.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
}

function _blurCartBtn() {
  // Quita el foco del botón carrito para evitar que quede con color oscuro
  const btn = document.querySelector('.cart-btn');
  if (btn) {
    btn.blur();
    // Forzar color verde original por JS como último recurso (cubre edge cases en móvil)
    btn.style.background = '';
    void btn.offsetWidth; // reflow
    btn.style.background = 'var(--green-primary)';
    setTimeout(() => { if (btn) btn.style.background = ''; }, 300);
  }
  document.activeElement?.blur();
}

function toggleCart() {
  _blurCartBtn();

  const panel   = document.getElementById('cartPanel');
  const overlay = document.getElementById('cartOverlay');
  const isOpen  = panel.classList.contains('open');

  if (isOpen) {
    // Cerrar carrito → restaurar scroll del body
    panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    // Pequeño delay para asegurar que el foco se quite después de la animación
    setTimeout(_blurCartBtn, 50);
  } else {
    // Abrir carrito
    _applyPanelTop();
    panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
    renderCartItems();
    document.body.style.overflow = 'hidden';
    // Sincronizar toggle global con preferencias individuales de cada ítem
    setTimeout(_updateSustGlobalToggle, 50);
  }
}

// ─── SUSTITUCIÓN DE PRODUCTOS ─────────────────────────────────────────────────
// Leer preferencia individual por artículo
function getSustItemPref(productId) {
  return localStorage.getItem(`cm_sust_${productId}`) === 'true';
}
// Guardar preferencia individual por artículo
function saveSustItemPref(productId, val) {
  localStorage.setItem(`cm_sust_${productId}`, val ? 'true' : 'false');
  _updateSustGlobalToggle();
}
// Toggle global: refleja si al menos 1 artículo tiene sustitución activada
function _updateSustGlobalToggle() {
  const tog = document.getElementById('sustitucionToggle');
  if (!tog) return;
  tog.checked = cart.some(item => getSustItemPref(item.id));
}
// Toggle global del footer: al activar, aplica a TODOS los ítems del carrito
function saveSustitucionPref(val) {
  cart.forEach(item => {
    localStorage.setItem(`cm_sust_${item.id}`, val ? 'true' : 'false');
    const itemTog = document.getElementById(`sust-${item.id}`);
    if (itemTog) itemTog.checked = val;
  });
}
// Leer si algún ítem del carrito tiene sustitución activa (para el badge del checkout)
function getSustitucionPref() {
  return cart.some(item => getSustItemPref(item.id));
}
function openSustitucionInfo() {
  document.getElementById('sustitucionBackdrop')?.classList.remove('hidden');
  const sheet = document.getElementById('sustitucionSheet');
  if (sheet) {
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => sheet.classList.add('open'));
  }
}
function closeSustitucionInfo() {
  const sheet = document.getElementById('sustitucionSheet');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(() => sheet.classList.add('hidden'), 300);
  }
  setTimeout(() => document.getElementById('sustitucionBackdrop')?.classList.add('hidden'), 300);
}

// ─── CHECKOUT — Abrir modal con opciones de pago ────────────────────────────

// Flag anti-doble-tap para el botón "Proceder al pago"
let _isCheckingOut = false;

async function checkout() {
  if (cart.length === 0) {
    showToast('<i class="fas fa-info-circle"></i> Tu carrito está vacío', 'info');
    return;
  }
  if (!currentClient) {
    window.location.href = 'login-cliente.html';
    return;
  }

  // Evitar doble tap
  if (_isCheckingOut) return;
  _isCheckingOut = true;

  // Bloquear el botón visualmente durante la verificación de stock
  const checkoutBtn = document.querySelector('.checkout-btn');
  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando…';
  }

  try {
    // Verificar stock disponible antes de mostrar el modal
    let stockActual;
    try { stockActual = await DB.getProducts(); } catch(e) { stockActual = deepClone(getLiveProducts()); }
    const sinStock = [];
    cart.forEach(item => {
      // Comparación por string para soportar tanto IDs numéricos como UUIDs
      const prod = stockActual.find(p => String(p.id) === String(item.id));
      if (prod && prod.stock < item.qty) {
        sinStock.push(`<strong>${item.name}</strong> (disponible: ${prod.stock}, solicitado: ${item.qty})`);
      }
    });
    if (sinStock.length > 0) {
      showToast(`<i class="fas fa-triangle-exclamation"></i> Stock insuficiente:<br>${sinStock.join('<br>')}`, 'error');
      return;
    }
    openCheckout();
  } finally {
    // Restaurar el botón siempre, tanto en éxito como en error
    _isCheckingOut = false;
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      checkoutBtn.innerHTML = '<i class="fas fa-credit-card"></i> Proceder al pago';
    }
  }
}

async function openCheckout() {
  const overlay = document.getElementById('checkoutOverlay');
  const modal   = document.getElementById('checkoutModal');
  if (!overlay || !modal) return;

  // ── 0. Usar settings precacheados (ya cargados al inicio en applyStoreInfo) ──
  // Solo hace fetch si por alguna razón no están cacheados aún
  if (!_checkoutSettingsCache) {
    try {
      _checkoutSettingsCache = await DB.getSettings();
    } catch(e) {
      _checkoutSettingsCache = {};
    }
  }

  // ── 1. Reset cupón ANTES de calcular totales ──
  _activeCupon = null;
  const ci = document.getElementById('chkCuponInput'); if (ci) { ci.value = ''; ci.disabled = false; }
  const cm = document.getElementById('chkCuponMsg');   if (cm) { cm.style.display = 'none'; cm.innerHTML = ''; }
  const dr = document.getElementById('chkDescuentoRow'); if (dr) dr.style.display = 'none';

  // ── 2. Resetear nota, método de pago y comprobante fiscal ──
  const noteEl = document.getElementById('chkNote'); if (noteEl) noteEl.value = '';
  const firstRadio = document.querySelector('input[name="payMethod"][value="efectivo"]');
  if (firstRadio) firstRadio.checked = true;
  const fiscalTog = document.getElementById('chkFiscalToggle');
  if (fiscalTog) { fiscalTog.checked = false; }
  const fiscalForm = document.getElementById('chkFiscalForm');
  if (fiscalForm) { fiscalForm.classList.add('hidden'); }
  const fiscalRNCEl = document.getElementById('chkFiscalRNC');
  if (fiscalRNCEl) fiscalRNCEl.value = '';
  const fiscalNombreEl = document.getElementById('chkFiscalNombre');
  if (fiscalNombreEl) fiscalNombreEl.value = '';

  // ── 3. Resumen de productos ──
  document.getElementById('chkProducts').innerHTML = cart.map(item => {
    const sust = getSustItemPref(item.id);
    const sustBadge = sust
      ? `<span class="chk-sust-badge chk-sust-yes"><i class="fas fa-shuffle"></i> Autorizo sustituir</span>`
      : `<span class="chk-sust-badge chk-sust-no"><i class="fas fa-ban"></i> No sustituir</span>`;
    return `
    <div class="chk-product-row">
      <img class="chk-product-img" src="${item.image}" alt="${item.name}"
           onerror="this.src='images/frutas.jpg'" />
      <div class="chk-product-info">
        <div class="chk-product-name">${item.name}</div>
        <div class="chk-product-meta">${item.qty} × RD$ ${fmt$(item.price)} / ${item.unit || 'unid.'}</div>
        ${sustBadge}
      </div>
      <div class="chk-product-sub">RD$ ${fmt$(item.price * item.qty)}</div>
    </div>`;
  }).join('');

  // ── 4. Datos de entrega ──
  document.getElementById('chkDelivery').innerHTML = `
    <div class="chk-del-item"><i class="fas fa-user"></i><span>${currentClient.name}</span></div>
    <div class="chk-del-item"><i class="fas fa-phone"></i><span>${currentClient.phone || 'Sin teléfono'}</span></div>
    <div class="chk-del-item"><i class="fas fa-location-dot"></i><span>${currentClient.address || 'Sin dirección registrada'}</span></div>
    <div class="chk-del-item"><i class="fas fa-city"></i><span>${currentClient.city || '—'}</span></div>`;

  // ── 5. Totales + Plan Cero Centavos + Horario de entrega ──
  _recalcCheckoutTotals(); // también llama a _renderHorarioEntrega() internamente

  // Mostrar
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');
  // Cerrar el carrito lateral
  document.getElementById('cartPanel')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('open');
  document.body.style.overflow = 'hidden';
  setTimeout(_blurCartBtn, 50);
}

function closeCheckout(reopenCart = true) {
  document.getElementById('checkoutOverlay')?.classList.add('hidden');
  document.getElementById('checkoutModal')?.classList.add('hidden');
  document.body.style.overflow = '';

  if (!reopenCart) return; // pedido confirmado: no reabrir el carrito

  // Reabrir el carrito para que el cliente pueda modificarlo
  const cartPanel   = document.getElementById('cartPanel');
  const cartOverlay = document.getElementById('cartOverlay');
  if (cartPanel && !cartPanel.classList.contains('open')) {
    _applyPanelTop();
    cartPanel.classList.add('open');
    if (cartOverlay) cartOverlay.classList.add('open');
    renderCartItems();
    setTimeout(_updateSustGlobalToggle, 50);
    document.body.style.overflow = 'hidden';
  }
}

// ─── CHECKOUT — Confirmar y guardar el pedido ────────────────────────────────

// Flag anti-doble-tap para el botón "Confirmar pedido"
let _isConfirmingOrder = false;

async function confirmOrder() {
  // Bloquear si ya hay una confirmación en curso
  if (_isConfirmingOrder) return;
  _isConfirmingOrder = true;

  const btn = document.getElementById('chkConfirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando…';
  }

  // ── Todo dentro de un único try/catch para que el botón SIEMPRE se restaure ──
  try {
    const payMethod   = document.querySelector('input[name="payMethod"]:checked')?.value || 'efectivo';
    const chkNote     = document.getElementById('chkNote')?.value.trim() || '';

    const payLabels = {
      efectivo:  'Efectivo contra entrega',
      tarjeta: 'Tarjeta (Débito/Crédito)',
    };

    const now     = new Date();
    const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const subtotal   = cart.reduce((s, c) => s + c.price * c.qty, 0);
    const totalItems = cart.reduce((s, c) => s + c.qty, 0);
    const envio      = _calcEnvio(totalItems, subtotal);

    // Comprobante fiscal (puede que el toggle no exista si el HTML es viejo)
    const fiscalToggle    = document.getElementById('chkFiscalToggle');
    const fiscalSolicitado = fiscalToggle ? fiscalToggle.checked : false;
    const fiscalRNC       = document.getElementById('chkFiscalRNC')?.value.trim()    || '';
    const fiscalNombre    = document.getElementById('chkFiscalNombre')?.value.trim() || '';

    const descuento      = _activeCupon?.descuento || 0;
    const cuponId        = _activeCupon?.cupon?.id     || '';
    const cuponCodigo    = _activeCupon?.cupon?.codigo || '';
    const descuentoPct   = _activeCupon?.cupon?.tipo !== 'monto_fijo' ? (_activeCupon?.cupon?.valor || 0) : 0;
    const descuentoMonto = _activeCupon?.cupon?.tipo === 'monto_fijo' ? descuento : 0;
    const totalBruto    = +Math.max(0, subtotal + envio - descuento).toFixed(2);
    const ceroCentavos  = _calcCeroCentavos(totalBruto);
    const total         = +(totalBruto - ceroCentavos).toFixed(2);

    // Horario de entrega estimado (usa settings ya cargados desde la API)
    const horario = _calcHorarioEntrega(_checkoutSettingsCache);

    // Construir líneas de productos (incluye flag de sustitución por ítem)
    const productLines = cart.map(c => ({
      productId:   String(c.id),
      name:        c.name,
      image:       c.image || '',
      category:    c.category || '',
      unit:        c.unit || 'unidad',
      price:       c.price,
      cantidad:    c.qty,
      subtotal:    +(c.price * c.qty).toFixed(2),
      sustitucion: getSustItemPref(c.id),   // true = cliente autoriza sustituir este producto
    }));

    // Generar ID correlativo basado en order_number (no en id que ahora es UUID de Supabase)
    let nextNum = 1;
    try {
      const allOrders = await DB.getOrders();
      if (allOrders.length > 0) {
        const maxNum = allOrders.reduce((max, o) => {
          const n = Number(o.order_number) || parseInt(o.id, 10) || 0;
          return (n > max) ? n : max;
        }, 0);
        nextNum = maxNum + 1;
      }
    } catch(e) { nextNum = Date.now() % 100000; }
    const newId = String(nextNum);

    const newOrder = {
      id:             newId,
      customer:       currentClient.name,
      email:          currentClient.email,
      phone:          currentClient.phone   || '',
      address:        currentClient.address || '',
      city:           currentClient.city    || '',
      clientId:       currentClient.id,
      items:          totalItems,
      productLines,
      total,
      status:         'pendiente',
      date:           dateStr,
      payMethod,
      payMethodLabel: payLabels[payMethod] || payMethod,
      notes:          chkNote,
      source:         'tienda',
      subtotal:       +(subtotal).toFixed(2),
      shipping:       envio,
      descuento,
      descuentoPct,
      descuentoMonto,
      ceroCentavos,
      cuponUsado:          cuponCodigo,
      cuponId,
      horarioEntrega:      `${horario.desde} – ${horario.hasta}`,
      fechaEntrega:        horario.fecha,
      fiscalSolicitado,
      fiscalRNC:           fiscalSolicitado ? fiscalRNC    : '',
      fiscalNombre:        fiscalSolicitado ? fiscalNombre : '',
      autorizaSustitucion: getSustitucionPref(),
      mapLink:             currentClient.mapLink || '',
    };

    // Guardar pedido en la API
    await DB.createOrder(newOrder);

    // Descontar stock (fire-and-forget, no bloquea el flujo)
    DB.getProducts().then(stockActual => {
      for (const item of cart) {
        const prod = stockActual.find(p => Number(p.id) === Number(item.id));
        if (prod) {
          const nuevoStock = Math.max(0, (prod.stock || 0) - item.qty);
          _apiPatch('products', prod.id, { stock: nuevoStock }).catch(() => {});
        }
      }
    }).catch(() => {});

    // Actualizar estadísticas del cliente
    const updFields = {
      orders:              (currentClient.orders || 0) + 1,
      spent:               +((currentClient.spent || 0) + total).toFixed(2),
      lastOrder:           dateStr,
      loyaltyLastActivity: new Date().toISOString(),
    };
    DB.patchCustomer(currentClient.id, updFields).then(() => {
      const updClient = { ...currentClient, ...updFields };
      const { password: _pw, ...safe } = updClient;
      setClientSession(safe);
      currentClient = safe;
    }).catch(() => {});

    // Incrementar uso del cupón si se usó uno
    if (cuponId && typeof incrementCuponUso === 'function') {
      incrementCuponUso(cuponId).catch(() => {});
    }
    _activeCupon = null;

    // Cerrar modal y limpiar carrito — sin reabrir el carrito (pedido ya procesado)
    closeCheckout(false);
    cart = [];
    saveCart();
    updateCartUI();
    renderCartItems();
    // Asegurar que el carrito quede cerrado
    document.getElementById('cartPanel')?.classList.remove('open');
    document.getElementById('cartOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(_blurCartBtn, 50);

    if (document.getElementById('accountPanel')?.classList.contains('open')) {
      renderMyOrders();
    }

    showToast(
      `<i class="fas fa-check-circle"></i> ¡Pedido <strong>#${newId}</strong> confirmado!<br>
       <span style="font-size:.82rem;opacity:.85"><i class="fas fa-${payMethod==='efectivo'?'money-bill-wave':'mobile-screen-button'}"></i> ${payLabels[payMethod] || payMethod} · RD$ ${fmt$(total)}</span>`,

      'success'
    );

  } catch(err) {
    console.error('[confirmOrder] Error:', err);
    showToast('<i class="fas fa-circle-xmark"></i> Error al confirmar el pedido. Intenta de nuevo.', 'error');
  } finally {
    // Restaurar el botón SIEMPRE, tanto en éxito como en error
    _isConfirmingOrder = false;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirmar pedido';
    }
  }
}

// ─── MODAL PRODUCTO ───────────────────────────────────────────────────────────

function openModal(productId) {
  const p = getLiveProducts().find(pr => pr.id === productId || String(pr.id) === String(productId));
  if (!p) return;

  modalQty = 1;
  const stars = renderStars(p.rating);
  const discount = p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : null;
  
  // Verificar si está en favoritos
  const isFav = favorites && favorites.some(fav => String(fav.id) === String(p.id));
  const favClass = isFav ? 'active' : '';
  const favText = isFav ? 'En Favoritos' : 'Agregar a Favoritos';

  // ── Construir array de imágenes (principal + extras) ──────────────────
  // p.images puede llegar de Supabase como: Array JS, string JSON "[...]", null o []
  const _parseImages = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'string') {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; } catch(e) { return []; }
    }
    return [];
  };
  const _allImgs = [p.image, ..._parseImages(p.images)].filter(Boolean).filter((v,i,a) => a.indexOf(v) === i);

  // Genera el HTML del bloque de imagen (único o carrusel)
  function _carouselHTML() {
    if (_allImgs.length <= 1) {
      // Sin carrusel — imagen simple
      return `<div class="modal-img" id="modalImgBlock">
        <img src="${_allImgs[0] || p.image}" alt="${p.name}"
             onclick="openLightbox(this.src, this.alt)"
             style="cursor:zoom-in;" title="Toca para ampliar" />
      </div>`;
    }
    // Carrusel con deslizamiento físico — tira horizontal continua
    const dots = _allImgs.map((_, i) =>
      `<button class="car-dot${i === 0 ? ' active' : ''}" data-i="${i}" onclick="carGoTo(${i})" aria-label="Imagen ${i+1}"></button>`
    ).join('');
    const slides = _allImgs.map((src, i) =>
      `<div class="car-slide" data-i="${i}">
         <img src="${src}" alt="${p.name} imagen ${i+1}"
              draggable="false"
              style="cursor:zoom-in; user-select:none; -webkit-user-drag:none;"
              title="Toca para ampliar" />
       </div>`
    ).join('');
    return `<div class="modal-img modal-img--carousel" id="modalImgBlock">
      <div class="car-viewport" id="carViewport">
        <div class="car-strip" id="carStrip">${slides}</div>
      </div>
      <button class="car-arrow car-arrow--prev" onclick="carGoTo(_carState.idx-1)" aria-label="Anterior">
        <i class="fas fa-chevron-left"></i>
      </button>
      <button class="car-arrow car-arrow--next" onclick="carGoTo(_carState.idx+1)" aria-label="Siguiente">
        <i class="fas fa-chevron-right"></i>
      </button>
      <div class="car-dots" id="carDots">${dots}</div>
      <div class="car-counter" id="carCounter">1 / ${_allImgs.length}</div>
    </div>`;
  }

  document.getElementById('modalContent').innerHTML = `
    ${_carouselHTML()}
    <div class="modal-details">
      <div class="modal-cat">${catLabel(p.category)}</div>
      ${p.badge ? `<div class="modal-badge-wrap"><span class="badge badge-${p.badge}">${p.badge === 'offer' ? (discount != null ? `-${discount}%` : 'Oferta') : p.badge === 'new' ? 'Nuevo' : 'Favorito'}</span></div>` : ''}
      <div class="modal-name">${p.name}</div>
      <div class="modal-rating">
        <span class="stars">${stars}</span>
      </div>
      <p class="modal-desc">${p.description}</p>
      <div class="modal-price">
        ${p.originalPrice ? `<span class="price-original">RD$ ${fmt$(p.originalPrice)} ${discount ? `(-${discount}%)` : ''}</span>` : ''}
        <div class="price-current">RD$ ${fmt$(p.price)} <span class="price-unit">/ ${p.unit}</span></div>
      </div>
      <div class="modal-actions-row">
        <div class="modal-qty">
          <button class="modal-qty-btn" onclick="changeModalQty(-1)"><i class="fas fa-minus"></i></button>
          <span class="modal-qty-num" id="modalQtyNum">1</span>
          <button class="modal-qty-btn" onclick="changeModalQty(1)"><i class="fas fa-plus"></i></button>
        </div>
        <div class="modal-actions">
          <button class="modal-favorite-btn ${favClass}" onclick="toggleFavoriteFromModal('${p.id}', this)" aria-label="${favText}">
            <i class="fas fa-heart"></i>
          </button>
          <button class="modal-share-btn" onclick='shareProductWhatsApp(${JSON.stringify(p).replace(/'/g, "\\'")})'>
            <i class="fas fa-share-nodes"></i> Compartir
          </button>
        </div>
      </div>
      <button class="modal-add-btn" onclick="addToCart('${p.id}', modalQty); closeModal();">
        <i class="fas fa-cart-plus"></i> Agregar al carrito · RD$ ${fmt$(p.price)}
      </button>
    </div>`;

  document.getElementById('modalOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Resetear e inicializar el carrusel (solo si hay varias imágenes)
  _carState.idx   = 0;
  _carState.total = _allImgs.length;
  if (_allImgs.length > 1) {
    requestAnimationFrame(() => _carInit());
  }
}

// ── Carrusel del modal — deslizamiento físico tipo app nativa ───────────────
// Estado global compartido (carGoTo() debe ser global por los onclick inline)
let _carState = { idx: 0, total: 0 };

// Mueve la tira al índice n con animación CSS
function carGoTo(n) {
  const total = _carState.total;
  if (total < 2) return;
  _carState.idx = ((n % total) + total) % total;
  _carSnap(_carState.idx, true);
  _carUpdateUI(_carState.idx);
}

// Aplica translateX a la tira (animated = con transición CSS)
function _carSnap(idx, animated) {
  const strip = document.getElementById('carStrip');
  if (!strip) return;
  const vp    = document.getElementById('carViewport');
  const W     = vp ? vp.offsetWidth : strip.offsetWidth;
  if (animated) strip.style.transition = 'transform .38s cubic-bezier(.25,.46,.45,.94)';
  strip.style.transform = `translateX(${-idx * W}px)`;
  if (animated) setTimeout(() => { strip.style.transition = 'none'; }, 400);
}

// Actualiza dots y contador sin mover la tira
function _carUpdateUI(idx) {
  document.querySelectorAll('#carDots .car-dot').forEach((el, i) =>
    el.classList.toggle('active', i === idx)
  );
  const ctr = document.getElementById('carCounter');
  if (ctr) ctr.textContent = `${idx + 1} / ${_carState.total}`;
}

// Inicializa el carrusel: posiciona la tira y enlaza eventos táctiles + ratón
function _carInit() {
  const vp    = document.getElementById('carViewport');
  const strip = document.getElementById('carStrip');
  if (!vp || !strip) return;

  const total = _carState.total;
  const W     = vp.offsetWidth;   // ancho de 1 slide

  // Colocar la tira sin animación en el índice 0
  strip.style.transition = 'none';
  strip.style.transform  = 'translateX(0)';
  strip.style.width      = `${total * W}px`;

  // Cada slide ocupa exactamente el ancho del viewport
  strip.querySelectorAll('.car-slide').forEach(sl => {
    sl.style.width = `${W}px`;
  });

  // ── Tap en slide → lightbox (solo si no hubo arrastre) ──────────────
  // Las imágenes tienen pointer-events:none, el click va en el contenedor
  strip.querySelectorAll('.car-slide').forEach((slide) => {
    const img = slide.querySelector('img');
    slide.addEventListener('click', () => {
      if (!window._carDragged && img) openLightbox(img.src, img.alt);
    });
  });

  // ── Variables de arrastre ─────────────────────────────────────────────
  let _startX   = 0;   // posición X al inicio del gesto
  let _startY   = 0;
  let _curX     = 0;   // posición X actual mientras arrastra
  let _baseX    = 0;   // translateX de partida (en px)
  let _dragging = false;
  let _isHoriz  = null; // null = sin determinar, true = horizontal, false = vertical
  let _velX     = 0;   // velocidad en px/ms al soltar (para momentum)
  let _lastT    = 0;   // timestamp del último touchmove
  let _lastX    = 0;   // X del último touchmove (para velocidad)
  window._carDragged = false;  // para distinguir tap vs arrastre

  function _getBaseX() {
    // Leer el translateX actual del strip (sin transición)
    const m = new DOMMatrix(getComputedStyle(strip).transform);
    return m.m41;
  }

  function _resist(dx) {
    // Efecto goma en los bordes: cuanto más se pasa del límite, más resistencia
    const maxOver = W * 0.3;
    const sign    = dx > 0 ? 1 : -1;
    return sign * Math.min(Math.abs(dx), maxOver) * 0.35;
  }

  function _onStart(clientX, clientY) {
    strip.style.transition = 'none';
    _baseX    = _getBaseX();
    _startX   = clientX;
    _startY   = clientY;
    _curX     = clientX;
    _lastX    = clientX;
    _lastT    = Date.now();
    _dragging = true;
    _isHoriz  = null;
    _velX     = 0;
    window._carDragged = false;
  }

  function _onMove(clientX, clientY) {
    if (!_dragging) return;
    const dx = clientX - _startX;
    const dy = clientY - _startY;

    // Determinar orientación del gesto en los primeros píxeles
    if (_isHoriz === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      _isHoriz = Math.abs(dx) > Math.abs(dy);
    }
    if (_isHoriz === false) { _dragging = false; return; } // gesto vertical → abortar
    if (_isHoriz !== true) return;

    // Velocidad instantánea
    const now = Date.now();
    if (now - _lastT > 0) _velX = (clientX - _lastX) / (now - _lastT);
    _lastX = clientX; _lastT = now;

    // Calcular nuevo translateX con resistencia en bordes
    let newX = _baseX + dx;
    const minX = -(total - 1) * W;
    if (newX > 0)    newX = _resist(newX);         // resistencia borde izquierdo
    if (newX < minX) newX = minX + _resist(newX - minX); // resistencia borde derecho

    strip.style.transform = `translateX(${newX}px)`;
    if (Math.abs(dx) > 8) window._carDragged = true;
  }

  function _onEnd(clientX) {
    if (!_dragging) return;
    _dragging = false;
    if (_isHoriz !== true) return;

    const dx         = clientX - _startX;
    const momentum   = _velX * 80; // proyección por inercia
    const effectiveX = _getBaseX() + momentum;
    const snapIdx    = Math.round(-effectiveX / W);
    const finalIdx   = Math.max(0, Math.min(total - 1, snapIdx));

    // Si el arrastre es pequeño pero rápido → cambiar slide
    let dest = _carState.idx;
    if (Math.abs(dx) > W * 0.15 || Math.abs(_velX) > 0.3) {
      dest = dx < 0 ? Math.min(_carState.idx + 1, total - 1)
                    : Math.max(_carState.idx - 1, 0);
    }
    // Dar prioridad al índice calculado por momentum si difiere
    _carState.idx = Math.abs(finalIdx - _carState.idx) <= 1 ? finalIdx : dest;
    _carSnap(_carState.idx, true);
    _carUpdateUI(_carState.idx);
  }

  // ── Eventos táctiles ──────────────────────────────────────────────────
  vp.addEventListener('touchstart', e => {
    _onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  vp.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - _startX;
    const dy = e.touches[0].clientY - _startY;
    // Bloquear scroll del modal solo cuando el gesto es claramente horizontal
    if (_isHoriz === true || (_isHoriz === null && Math.abs(dx) > Math.abs(dy) + 4)) {
      e.preventDefault();
    }
    _onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  vp.addEventListener('touchend', e => {
    _onEnd(e.changedTouches[0].clientX);
  }, { passive: true });

  // ── Eventos ratón (desktop) ───────────────────────────────────────────
  vp.addEventListener('mousedown', e => {
    e.preventDefault();
    _onStart(e.clientX, e.clientY);
    vp.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => { _onMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup',   e => {
    _onEnd(e.clientX);
    vp.style.cursor = '';
  });
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── LIGHTBOX — visor de imagen con pinch-to-zoom + doble toque ───────────
(function() {
  // Estado del zoom
  let _lbScale     = 1;
  let _lbMinScale  = 1;
  let _lbMaxScale  = 5;
  let _lbPosX      = 0;
  let _lbPosY      = 0;

  // Estado touch
  let _lbLastDist  = 0;   // distancia entre dos dedos
  let _lbLastTap   = 0;   // timestamp último toque (doble tap)
  let _lbDragStart = null; // posición inicio arrastre

  function _lbGetDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function _lbApplyTransform(img) {
    img.style.transform = `translate(${_lbPosX}px, ${_lbPosY}px) scale(${_lbScale})`;
  }

  function _lbReset(img) {
    _lbScale = 1; _lbPosX = 0; _lbPosY = 0;
    img.style.transition = 'transform .3s ease';
    _lbApplyTransform(img);
    setTimeout(() => { img.style.transition = ''; }, 300);
  }

  function _lbBindGestures(img, lb) {
    // ── Pinch to zoom (2 dedos) ──────────────────────────────────────────
    img.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        _lbLastDist = _lbGetDist(e.touches);
      } else if (e.touches.length === 1) {
        // Doble toque para zoom x2 / reset
        const now = Date.now();
        if (now - _lbLastTap < 300) {
          e.preventDefault();
          if (_lbScale > 1) {
            _lbReset(img);
          } else {
            _lbScale = 2.5; _lbPosX = 0; _lbPosY = 0;
            img.style.transition = 'transform .3s ease';
            _lbApplyTransform(img);
            setTimeout(() => { img.style.transition = ''; }, 300);
          }
          _lbLastTap = 0;
        } else {
          _lbLastTap = now;
          // Inicio arrastre
          _lbDragStart = { x: e.touches[0].clientX - _lbPosX, y: e.touches[0].clientY - _lbPosY };
        }
      }
    }, { passive: false });

    img.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        // Pinch zoom
        const dist    = _lbGetDist(e.touches);
        const delta   = dist / _lbLastDist;
        _lbLastDist   = dist;
        _lbScale      = Math.min(_lbMaxScale, Math.max(_lbMinScale, _lbScale * delta));
        _lbApplyTransform(img);
      } else if (e.touches.length === 1 && _lbScale > 1 && _lbDragStart) {
        // Arrastre cuando está con zoom
        _lbPosX = e.touches[0].clientX - _lbDragStart.x;
        _lbPosY = e.touches[0].clientY - _lbDragStart.y;
        _lbApplyTransform(img);
      }
    }, { passive: false });

    img.addEventListener('touchend', e => {
      _lbDragStart = null;
      // Si quedó con zoom mínimo, resetear posición
      if (_lbScale <= 1) { _lbScale = 1; _lbPosX = 0; _lbPosY = 0; _lbApplyTransform(img); }
    });

    // ── Rueda del mouse (desktop) ─────────────────────────────────────────
    img.addEventListener('wheel', e => {
      e.preventDefault();
      const delta  = e.deltaY > 0 ? 0.85 : 1.15;
      _lbScale     = Math.min(_lbMaxScale, Math.max(_lbMinScale, _lbScale * delta));
      _lbApplyTransform(img);
    }, { passive: false });
  }

  // ── API pública ───────────────────────────────────────────────────────────
  window.openLightbox = function(src, alt) {
    const lb  = document.getElementById('imgLightbox');
    const img = document.getElementById('imgLightboxImg');
    if (!lb || !img) return;

    // Reset zoom
    _lbScale = 1; _lbPosX = 0; _lbPosY = 0;
    img.style.transform = '';
    img.style.transition = '';

    img.src = src;
    img.alt = alt || '';
    lb.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Vincular gestos (solo una vez)
    if (!img._lbBound) {
      _lbBindGestures(img, lb);
      img._lbBound = true;
    }

    // Cerrar con Escape
    document._lbKeyHandler = (e) => {
      if (e.key === 'Escape') window.closeLightbox();
    };
    document.addEventListener('keydown', document._lbKeyHandler);
  };

  window.closeLightbox = function() {
    const lb  = document.getElementById('imgLightbox');
    const img = document.getElementById('imgLightboxImg');
    if (lb) lb.style.display = 'none';
    // Reset zoom al cerrar
    if (img) { _lbScale = 1; _lbPosX = 0; _lbPosY = 0; img.style.transform = ''; }
    document.body.style.overflow = '';
    if (document._lbKeyHandler) {
      document.removeEventListener('keydown', document._lbKeyHandler);
      document._lbKeyHandler = null;
    }
  };
})();

function changeModalQty(delta) {
  modalQty = Math.max(1, modalQty + delta);
  const el = document.getElementById('modalQtyNum');
  if (el) el.textContent = modalQty;
}

// ─── HERO SLIDER ─────────────────────────────────────────────────────────────

function goToSlide(index) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.dot');
  slides.forEach(s => s.classList.remove('active'));
  dots.forEach(d => d.classList.remove('active'));
  sliderIndex = (index + slides.length) % slides.length;
  slides[sliderIndex]?.classList.add('active');
  dots[sliderIndex]?.classList.add('active');
}

function nextSlide() {
  goToSlide(sliderIndex + 1);
  resetSliderTimer();
}

function prevSlide() {
  goToSlide(sliderIndex - 1);
  resetSliderTimer();
}

function startSlider() {
  sliderTimer = setInterval(() => goToSlide(sliderIndex + 1), 5000);
}

function resetSliderTimer() {
  clearInterval(sliderTimer);
  startSlider();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}

// ─── Cerrar modal con Escape ──────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    if (document.getElementById('cartPanel')?.classList.contains('open'))   toggleCart();
    if (document.getElementById('accountPanel')?.classList.contains('open')) toggleMyAccount();
  }
});

// ─── SESIÓN DE CLIENTE — Header y panel Mi Cuenta ────────────────────────────

function applyClientSession(client) {
  // Saludo en el header
  const greeting = document.getElementById('clientGreeting');
  const avatarEl = document.getElementById('clientAvatar');
  const nameEl   = document.getElementById('clientName');
  const btnLbl   = document.getElementById('myAccountLabel');

  if (greeting) greeting.classList.remove('hidden');
  const initials = client.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl)   nameEl.textContent   = client.name.split(' ')[0];
  if (btnLbl)   btnLbl.textContent   = 'Mi cuenta';
}

function toggleMyAccount() {
  const panel   = document.getElementById('accountPanel');
  const overlay = document.getElementById('accountOverlay');
  if (!panel) return;
  const open = panel.classList.contains('open');

  if (!open) {
    // Recalcular la posición correcta justo antes de abrir
    _applyPanelTop();
    // Bloquear el scroll del body pero permitir scroll interno del panel
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
  } else {
    // Restaurar scroll del body al cerrar
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
  }

  panel.classList.toggle('open',   !open);
  overlay.classList.toggle('hidden', open);
  if (!open) renderMyAccount();
}

async function renderMyAccount() {
  if (!currentClient) return;
  const initials = currentClient.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
  renderLocationSection();

  // Header del panel
  const pa = document.getElementById('panelAvatar');
  const pn = document.getElementById('panelName');
  const pe = document.getElementById('panelEmail');
  if (pa) pa.textContent = initials;
  if (pn) pn.textContent = currentClient.name;
  if (pe) pe.textContent = currentClient.email;

  // Info grid
  const statusLabel = { habilitado:'✅ Cuenta Habilitada', deshabilitado:'🚫 Cuenta Deshabilitada', activo:'✅ Cuenta Habilitada', inactivo:'🚫 Cuenta Deshabilitada' };
  const rankingLabel = { vip:'💎 VIP', oro:'🥇 Oro', plata:'🥈 Plata', bronce:'🥉 Bronce' };
  const rkVal = (currentClient.ranking || currentClient.loyaltyTier || 'bronce').toLowerCase();
  const grid = document.getElementById('accountInfoGrid');
  if (grid) {
    grid.innerHTML = `
      <div class="acc-info-item"><i class="fas fa-phone"></i><span>${currentClient.phone || '—'}</span></div>
      <div class="acc-info-item"><i class="fas fa-location-dot"></i><span>${currentClient.address || '—'}</span></div>
      <div class="acc-info-item"><i class="fas fa-city"></i><span>${currentClient.city || '—'}</span></div>
      <div class="acc-info-item"><i class="fas fa-circle-check"></i><span>${statusLabel[currentClient.status] || '✅ Cuenta Habilitada'}</span></div>
      <div class="acc-info-item"><i class="fas fa-ranking-star"></i><span>${rankingLabel[rkVal] || '🥉 Bronce'}</span></div>
      <div class="acc-info-item"><i class="fas fa-cart-shopping"></i><span>${currentClient.orders || 0} pedido${(currentClient.orders||0)!==1?'s':''}</span></div>
      <div class="acc-info-item"><i class="fas fa-dollar-sign"></i><span>RD$ ${fmt$(currentClient.spent||0)} gastado</span></div>`;
  }

  renderMyOrders();
  renderLoyaltyCard();
  renderMyCoupons();
  renderClientNotificaciones();
}

// ─── SECCIÓN MI PUNTOS ────────────────────────────────────────────────────────
async function renderLoyaltyCard() {
  const container = document.getElementById('loyaltyCard');
  if (!container || !currentClient) return;

  // Leer datos frescos del cliente desde la API
  let fresh = null;
  try {
    fresh = await DB.getCustomerByEmail(currentClient.email);
  } catch(e) { fresh = currentClient; }
  const pts     = (fresh?.loyaltyPoints) || 0;
  const history = (fresh?.loyaltyHistory || []).slice(0, 5);

  // Niveles (misma config que admin)
  const levels = [
    { name:'Bronce', min:0,    max:499,       icon:'🥉', color:'#cd7f32', bg:'#fdf3e7' },
    { name:'Plata',  min:500,  max:1499,      icon:'🥈', color:'#888',    bg:'#f4f4f4' },
    { name:'Oro',    min:1500, max:2999,      icon:'🥇', color:'#c9a500', bg:'#fffbea' },
    { name:'VIP',    min:3000, max:Infinity,  icon:'💎', color:'#7c3aed', bg:'#f3eeff' },
  ];
  const lvl     = [...levels].reverse().find(l => pts >= l.min) || levels[0];
  const nextLvl = levels.find(l => l.min > pts);
  const ptsToNext = nextLvl ? nextLvl.min - pts : null;
  const pct = nextLvl
    ? Math.min(100, Math.round((pts - lvl.min) / (nextLvl.min - lvl.min) * 100))
    : 100;

  // Historial
  const histHTML = history.length === 0
    ? `<p style="color:#bbb;font-size:.8rem;text-align:center;margin:8px 0">Sin movimientos aún</p>`
    : history.map(h => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:.8rem">
          <span style="color:${h.pts > 0 ? '#1a7c3e' : h.pts < 0 ? '#e53935' : '#888'};font-weight:700">
            ${h.pts > 0 ? '+' : ''}${h.pts !== 0 ? h.pts + ' pts' : '—'}
          </span>
          <span style="color:#555;flex:1;margin:0 8px;font-size:.77rem">${h.reason}</span>
          <span style="color:#aaa;font-size:.72rem">${h.date}</span>
        </div>`).join('');

  container.innerHTML = `
    <!-- Tarjeta nivel -->
    <div class="loyalty-card" style="background:${lvl.bg};border:2px solid ${lvl.color}44;border-radius:14px;padding:16px 18px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="font-size:2.4rem;line-height:1">${lvl.icon}</div>
        <div style="flex:1">
          <div style="font-size:.78rem;font-weight:700;color:${lvl.color};text-transform:uppercase;letter-spacing:.05em">${lvl.name}</div>
          <div style="font-size:1.7rem;font-weight:900;color:${lvl.color};line-height:1.1">${pts.toLocaleString('es-DO')} <span style="font-size:.85rem;font-weight:600">pts</span></div>
          ${ptsToNext !== null
            ? `<div style="font-size:.72rem;color:#888;margin-top:3px">Faltan <b>${ptsToNext}</b> pts para <b>${nextLvl.name} ${nextLvl.icon}</b></div>
               <div style="background:#ddd;border-radius:10px;height:5px;margin-top:5px;overflow:hidden">
                 <div style="height:100%;border-radius:10px;background:${lvl.color};width:${pct}%"></div>
               </div>`
            : `<div style="font-size:.72rem;color:${lvl.color};font-weight:700;margin-top:3px">🏆 ¡Nivel máximo!</div>`
          }
        </div>
      </div>
      <div style="margin-top:12px;background:rgba(255,255,255,.7);border-radius:8px;padding:8px 12px;font-size:.78rem;color:#555;display:flex;align-items:flex-start;gap:8px">
        <i class="fas fa-circle-info" style="color:${lvl.color};margin-top:2px;flex-shrink:0"></i>
        <span>Ganas <b>1 punto por cada RD$ 10</b> en tus compras. Para canjear puntos, <b>comunícate con nosotros</b>. Los puntos vencen tras <b>6 meses</b> de inactividad.</span>
      </div>
    </div>

    <!-- Historial -->
    <div style="background:#fff;border-radius:10px;padding:12px 14px;border:1px solid #f0f0f0">
      <div style="font-weight:700;font-size:.83rem;color:#444;margin-bottom:8px"><i class="fas fa-clock-rotate-left" style="color:#7c3aed;margin-right:5px"></i>Últimos movimientos</div>
      ${histHTML}
    </div>`;
}

async function renderMyOrders() {
  if (!currentClient) return;
  const container = document.getElementById('myOrdersList');
  if (!container) return;

  let myOrders = [];
  try {
    const allOrders = await DB.getOrders();
    myOrders = allOrders.filter(o => o.clientId === currentClient.id || o.email === currentClient.email);
  } catch(e) {
    container.innerHTML = `<div class="account-empty"><i class="fas fa-exclamation-circle"></i><span>Error al cargar pedidos</span></div>`;
    return;
  }

  if (myOrders.length === 0) {
    container.innerHTML = `<div class="account-empty"><i class="fas fa-box-open"></i><span>Aún no tienes pedidos</span></div>`;
    return;
  }

  const statusConfig = {
    pendiente:  { label:'Pendiente',   cls:'ord-pendiente',  icon:'fa-clock' },
    procesando: { label:'Procesando',  cls:'ord-procesando', icon:'fa-gear' },
    enviado:    { label:'Enviado',     cls:'ord-enviado',    icon:'fa-truck' },
    entregado:  { label:'Entregado',   cls:'ord-entregado',  icon:'fa-circle-check' },
    cancelado:  { label:'Cancelado',   cls:'ord-cancelado',  icon:'fa-circle-xmark' },
  };

  // Comprobar si hay pedidos cancelados para mostrar el botón de limpiar
  const hasCancelled = myOrders.some(o => o.status === 'cancelado');
  const clearCancelledBtn = hasCancelled
    ? `<button class="btn-clear-cancelled" onclick="clearCancelledOrders()" title="Eliminar pedidos cancelados del historial">
         <i class="fas fa-trash-can"></i> Limpiar cancelados
       </button>`
    : '';

  // Encabezado con título y botón de limpiar (si aplica)
  const header = `<div class="my-orders-header">
    <span class="my-orders-title"><i class="fas fa-bag-shopping"></i> Mis pedidos</span>
    ${clearCancelledBtn}
  </div>`;

  const cards = myOrders.slice(0, 20).map(o => {
    const st = statusConfig[o.status] || statusConfig.pendiente;
    const lines = o.productLines || [];
    const preview = lines.slice(0, 3).map(l =>
      `<img src="${l.image}" alt="${l.name}" title="${l.name}" onerror="this.src='images/frutas.jpg'" style="width:32px;height:32px;border-radius:6px;object-fit:cover;border:1px solid #eee">`
    ).join('');
    const extra = lines.length > 3 ? `<span style="font-size:.75rem;color:#888;margin-left:4px">+${lines.length-3} más</span>` : '';

    // Botón cancelar: solo en estados cancelables
    const canCancel = ['pendiente', 'procesando'].includes(o.status);
    // Botón eliminar: solo en pedidos cancelados
    const isCancelled = o.status === 'cancelado';

    const actionBtn = canCancel
      ? `<button class="btn-cancel-order" onclick="cancelClientOrder('${o.id}')" title="Cancelar pedido">
           <i class="fas fa-xmark"></i> Cancelar
         </button>`
      : isCancelled
        ? `<button class="btn-delete-order" onclick="deleteClientOrder('${o.id}')" title="Eliminar del historial">
             <i class="fas fa-trash-can"></i>
           </button>`
        : '';

    return `
      <div class="my-order-card" id="order-card-${o.id}">
        <div class="my-order-top">
          <div>
            <span class="my-order-id">#${o.id}</span>
            <span class="my-order-date">${o.date}</span>
          </div>
          <span class="my-order-status ${st.cls}"><i class="fas ${st.icon}"></i> ${st.label}</span>
        </div>
        <div class="my-order-products">${preview}${extra}</div>
        <div class="my-order-bottom">
          <span>${o.items || lines.length} artículo${(o.items || lines.length) !== 1 ? 's' : ''}</span>
          <span class="my-order-total">RD$ ${fmt$(o.total || 0)}</span>
          ${actionBtn}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = header + cards;
}

// ─── Cancelar pedido desde la tienda (cliente) ────────────────────────────────
async function cancelClientOrder(orderId) {
  if (!currentClient) return;
  if (!confirm('¿Cancelar este pedido? Esta acción no se puede deshacer.')) return;

  // ── Feedback inmediato: cambiar la tarjeta visualmente YA ──
  const card = document.getElementById(`order-card-${orderId}`);
  if (card) {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
    const cancelBtn = card.querySelector('.btn-cancel-order');
    if (cancelBtn) {
      cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      cancelBtn.disabled = true;
    }
  }

  try {
    // 1) Leer el pedido para validar y obtener productLines
    const order = await _apiFetch(`tables/orders/${orderId}`).catch(() => null);
    if (!order) {
      if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
      showToast('Pedido no encontrado', 'error');
      return;
    }
    if (order.clientId !== currentClient.id && order.email !== currentClient.email) {
      if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
      showToast('No tienes permiso para cancelar este pedido', 'error');
      return;
    }
    if (!['pendiente', 'procesando'].includes(order.status)) {
      if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
      showToast('Este pedido ya no puede cancelarse', 'warning');
      return;
    }

    // 2) Marcar el pedido como cancelado — ÚNICA operación crítica que el usuario espera
    await DB.patchOrder(orderId, {
      status:      'cancelado',
      cancelledBy: 'cliente',
      cancelledAt: new Date().toISOString(),
    });

    // ── Feedback de éxito inmediato — el usuario ya puede seguir ──
    showToast(`<i class="fas fa-check-circle"></i> Pedido <strong>#${orderId}</strong> cancelado.`, 'success');
    renderMyOrders(); // Re-renderizar la lista ya con el nuevo estado

    // 3) Reponer stock y actualizar estadísticas en background (fire-and-forget)
    //    Se ejecutan en PARALELO y no bloquean al usuario
    const restoreStock = async () => {
      if (!order.productLines || order.productLines.length === 0) return;
      // Obtener todos los productos de una sola llamada (en vez de una por artículo)
      const allProds = await DB.getProducts().catch(() => []);
      await Promise.all(order.productLines.map(line => {
        const prod = allProds.find(p => String(p.id) === String(line.productId));
        if (!prod) return Promise.resolve();
        return _apiPatch('products', prod.id, {
          stock: Math.max(0, (prod.stock || 0) + (line.cantidad || 0))
        }).catch(() => {});
      }));
    };

    const updateStats = async () => {
      const newOrders = Math.max(0, (currentClient.orders || 0) - 1);
      const newSpent  = Math.max(0, (currentClient.spent  || 0) - (order.total || 0));
      await DB.patchCustomer(currentClient.id, { orders: newOrders, spent: newSpent }).catch(() => {});
      const updClient = { ...currentClient, orders: newOrders, spent: newSpent };
      const { password: _pw, ...safe } = updClient;
      setClientSession(safe);
      currentClient = safe;
    };

    // Ejecutar en paralelo, sin await — el usuario ya recibió su feedback
    Promise.all([restoreStock(), updateStats()]).catch(() => {});

  } catch(e) {
    console.error('[cancelClientOrder]', e);
    // Restaurar la tarjeta si algo falló antes del éxito
    if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
    showToast('Error al cancelar el pedido. Intenta de nuevo.', 'error');
  }
}

// ─── Eliminar un pedido cancelado del historial (solo vista del cliente) ─────
async function deleteClientOrder(orderId) {
  if (!currentClient) return;
  // Confirmar antes de borrar
  if (!confirm('¿Eliminar este pedido cancelado de tu historial? Esta acción no se puede deshacer.')) return;

  try {
    // Verificar que el pedido pertenece al cliente y está cancelado
    const order = await _apiFetch(`tables/orders/${orderId}`).catch(() => null);
    if (!order) { showToast('Pedido no encontrado', 'error'); return; }
    if (order.clientId !== currentClient.id && order.email !== currentClient.email) {
      showToast('No tienes permiso para eliminar este pedido', 'error');
      return;
    }
    if (order.status !== 'cancelado') {
      showToast('Solo puedes eliminar pedidos cancelados', 'warning');
      return;
    }

    // Eliminar el pedido de la API
    await DB.deleteOrder(orderId);

    // Animación de salida en la tarjeta antes de re-renderizar
    const card = document.getElementById(`order-card-${orderId}`);
    if (card) {
      card.style.transition = 'opacity .3s, transform .3s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px)';
      await new Promise(r => setTimeout(r, 300));
    }

    showToast('<i class="fas fa-trash-can"></i> Pedido eliminado del historial', 'success');
    renderMyOrders();

  } catch(e) {
    console.error('[deleteClientOrder]', e);
    showToast('Error al eliminar el pedido. Intenta de nuevo.', 'error');
  }
}

// ─── Eliminar TODOS los pedidos cancelados del historial de una vez ──────────
async function clearCancelledOrders() {
  if (!currentClient) return;
  if (!confirm('¿Eliminar todos los pedidos cancelados de tu historial? Esta acción no se puede deshacer.')) return;

  try {
    const allOrders = await DB.getOrders();
    const cancelled = allOrders.filter(o =>
      (o.clientId === currentClient.id || o.email === currentClient.email) &&
      o.status === 'cancelado'
    );

    if (cancelled.length === 0) {
      showToast('No hay pedidos cancelados para eliminar', 'info');
      return;
    }

    // Eliminar todos en paralelo
    await Promise.all(cancelled.map(o => DB.deleteOrder(o.id).catch(() => {})));

    showToast(`<i class="fas fa-trash-can"></i> ${cancelled.length} pedido${cancelled.length !== 1 ? 's' : ''} cancelado${cancelled.length !== 1 ? 's' : ''} eliminado${cancelled.length !== 1 ? 's' : ''} del historial`, 'success');
    renderMyOrders();

  } catch(e) {
    console.error('[clearCancelledOrders]', e);
    showToast('Error al limpiar el historial. Intenta de nuevo.', 'error');
  }
}

// ─── HISTORIAL DE CUPONES USADOS ─────────────────────────────────────────────

async function renderMyCoupons() {
  if (!currentClient) return;
  const container = document.getElementById('myCouponsList');
  const badgeEl   = document.getElementById('totalSavingsBadge');
  const headerEl  = document.getElementById('myCouponsHeader');
  if (!container) return;

  let myOrders = [];
  try {
    const allOrders = await DB.getOrders();
    // Filtrar solo pedidos del cliente que tienen cupón
    myOrders = allOrders.filter(o =>
      (o.clientId === currentClient.id || o.email === currentClient.email) &&
      o.cuponUsado &&
      o.descuento > 0
    );
  } catch(e) {
    container.innerHTML = `<div class="account-empty"><i class="fas fa-exclamation-circle"></i><span>Error al cargar cupones</span></div>`;
    return;
  }

  if (myOrders.length === 0) {
    container.innerHTML = `<div class="account-empty"><i class="fas fa-ticket"></i><span>No has usado cupones aún</span></div>`;
    if (badgeEl) badgeEl.textContent = 'Ahorro total: RD$ 0.00';
    // Ocultar botón limpiar si no hay cupones
    if (headerEl) { const btn = headerEl.querySelector('.btn-clear-coupons'); if (btn) btn.style.display = 'none'; }
    return;
  }

  // Calcular ahorro total
  const totalSavings = myOrders.reduce((sum, o) => sum + (o.descuento || 0), 0);
  if (badgeEl) badgeEl.textContent = `Ahorro total: RD$ ${fmt$(totalSavings)}`;

  // Mostrar botón "Limpiar todo" en el header si hay entradas
  if (headerEl) {
    let clearBtn = headerEl.querySelector('.btn-clear-coupons');
    if (!clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.className = 'btn-clear-coupons';
      clearBtn.innerHTML = '<i class="fas fa-trash-can"></i> Limpiar todo';
      clearBtn.title = 'Eliminar todo el historial de cupones';
      clearBtn.onclick = clearAllCouponHistory;
      headerEl.appendChild(clearBtn);
    }
    clearBtn.style.display = '';
  }

  // Renderizar historial (más recientes primero)
  container.innerHTML = [...myOrders].reverse().map(o => {
    const discountPercent = o.subtotal > 0 ? Math.round((o.descuento / o.subtotal) * 100) : 0;
    return `
      <div class="coupon-history-card" id="coupon-entry-${o.id}">
        <div class="coupon-history-top">
          <span class="coupon-code"><i class="fas fa-ticket"></i> ${o.cuponUsado}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="coupon-discount-badge">-RD$ ${fmt$(o.descuento)}</span>
            <button class="btn-delete-coupon-entry" onclick="deleteCouponEntry('${o.id}')" title="Eliminar esta entrada del historial">
              <i class="fas fa-trash-can"></i>
            </button>
          </div>
        </div>
        <div class="coupon-history-middle">
          <i class="fas fa-receipt" style="color:#aaa"></i>
          <span>Usado en pedido</span>
          <a href="#" class="coupon-order-link" onclick="event.preventDefault(); scrollToOrder('${o.id}');">#${o.id}</a>
          <span style="color:#aaa">•</span>
          <span style="color:var(--green-primary);font-weight:600">${discountPercent}% OFF</span>
        </div>
        <div class="coupon-history-date">
          <i class="fas fa-calendar"></i>
          <span>${o.date}</span>
        </div>
      </div>`;
  }).join('');
}

// ─── Eliminar una entrada individual del historial de cupones ─────────────────
// No borra el pedido — solo limpia los campos de cupón en ese pedido
async function deleteCouponEntry(orderId) {
  if (!confirm('¿Eliminar esta entrada del historial de cupones? El pedido seguirá visible en Mis pedidos.')) return;
  try {
    await DB.patchOrder(orderId, {
      cuponUsado: '',
      cuponId:    '',
      descuento:  0,
    });

    // Animación de salida
    const card = document.getElementById(`coupon-entry-${orderId}`);
    if (card) {
      card.style.transition = 'opacity .3s, transform .3s';
      card.style.opacity    = '0';
      card.style.transform  = 'translateX(40px)';
      await new Promise(r => setTimeout(r, 300));
    }

    showToast('<i class="fas fa-trash-can"></i> Entrada eliminada del historial', 'success');
    renderMyCoupons();
  } catch(e) {
    console.error('[deleteCouponEntry]', e);
    showToast('Error al eliminar la entrada. Intenta de nuevo.', 'error');
  }
}

// ─── Eliminar TODO el historial de cupones del cliente ────────────────────────
async function clearAllCouponHistory() {
  if (!currentClient) return;
  if (!confirm('¿Limpiar todo el historial de cupones usados? Los pedidos seguirán visibles en Mis pedidos.')) return;
  try {
    const allOrders = await DB.getOrders();
    const withCoupon = allOrders.filter(o =>
      (o.clientId === currentClient.id || o.email === currentClient.email) &&
      o.cuponUsado &&
      o.descuento > 0
    );

    if (withCoupon.length === 0) {
      showToast('No hay entradas para limpiar', 'info');
      return;
    }

    // Limpiar campos de cupón en todos los pedidos afectados (en paralelo)
    await Promise.all(withCoupon.map(o =>
      DB.patchOrder(o.id, { cuponUsado: '', cuponId: '', descuento: 0 }).catch(() => {})
    ));

    showToast(`<i class="fas fa-trash-can"></i> ${withCoupon.length} entrada${withCoupon.length !== 1 ? 's' : ''} eliminada${withCoupon.length !== 1 ? 's' : ''} del historial`, 'success');
    renderMyCoupons();
  } catch(e) {
    console.error('[clearAllCouponHistory]', e);
    showToast('Error al limpiar el historial. Intenta de nuevo.', 'error');
  }
}

// Scroll al pedido específico en la sección "Mis pedidos"
function scrollToOrder(orderId) {
  const orderCard = document.getElementById(`order-card-${orderId}`);
  if (orderCard) {
    orderCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight temporal
    orderCard.style.background = '#fff3cd';
    setTimeout(() => { orderCard.style.background = ''; }, 2000);
  }
}

// ─── UBICACIÓN DE ENTREGA DEL CLIENTE ────────────────────────────────────────

function renderLocationSection() {
  if (!currentClient) return;
  // Usar mapLink de la sesión activa (se actualiza con _saveClientMapLink)
  const mapLink = currentClient.mapLink || '';

  const statusBox  = document.getElementById('locationStatus');
  const previewWrap = document.getElementById('mapPreviewWrap');
  const openLink   = document.getElementById('mapOpenLink');

  if (!statusBox) return;

  if (mapLink) {
    statusBox.innerHTML = '';
    if (previewWrap) previewWrap.classList.remove('hidden');
    if (openLink)  { openLink.href = mapLink; }
  } else {
    statusBox.innerHTML = `<span style="color:#aaa;font-size:.8rem"><i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i> Sin ubicación registrada. Agrégala para facilitar tu entrega.</span>`;
    if (previewWrap) previewWrap.classList.add('hidden');
  }
}

function shareMyLocation() {
  if (!navigator.geolocation) {
    showToast('Tu navegador no soporta geolocalización', 'error');
    return;
  }
  const btn = document.querySelector('.btn-location-gps');
  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo…'; btn.disabled = true; }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const link = `https://www.google.com/maps?q=${lat},${lng}`;
      _saveClientMapLink(link);
      if (btn) { btn.innerHTML = '<i class="fas fa-crosshairs"></i> Usar mi ubicación GPS'; btn.disabled = false; }
      showToast('📍 Ubicación guardada correctamente', 'success');
    },
    err => {
      if (btn) { btn.innerHTML = '<i class="fas fa-crosshairs"></i> Usar mi ubicación GPS'; btn.disabled = false; }
      const msgs = {
        1: 'Permiso de ubicación denegado. Actívalo en tu navegador.',
        2: 'No se pudo obtener la ubicación. Intenta de nuevo.',
        3: 'Tiempo de espera agotado. Intenta de nuevo.'
      };
      showToast(msgs[err.code] || 'Error al obtener ubicación', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function toggleMapLinkInput() {
  const wrap = document.getElementById('mapLinkInputWrap');
  if (!wrap) return;
  wrap.classList.toggle('hidden');
  if (!wrap.classList.contains('hidden')) {
    const inp = document.getElementById('mapLinkInput');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

function saveMapLink() {
  const url = (document.getElementById('mapLinkInput')?.value || '').trim();
  if (!url) { showToast('Pega un enlace de Google Maps válido', 'error'); return; }
  if (!url.includes('google.com/maps') && !url.includes('goo.gl') && !url.includes('maps.app')) {
    showToast('El enlace no parece ser de Google Maps', 'error'); return;
  }
  _saveClientMapLink(url);
  document.getElementById('mapLinkInputWrap').classList.add('hidden');
  showToast('📍 Ubicación guardada correctamente', 'success');
}

function deleteMyLocation() {
  if (!confirm('¿Eliminar tu ubicación guardada?')) return;
  _saveClientMapLink('');
  showToast('Ubicación eliminada', 'info');
}

function _saveClientMapLink(link) {
  if (!currentClient) return;
  // Actualizar en la API
  DB.patchCustomer(currentClient.id, { mapLink: link }).catch(() => {});
  // Actualizar sesión
  const updClient = { ...currentClient, mapLink: link };
  const { password: _pw, ...safe } = updClient;
  setClientSession(safe);
  currentClient = safe;
  renderLocationSection();
}

// ═══════════════════════════════════════════════════════════════════
// CUPONES — Validar y aplicar en el checkout
// ═══════════════════════════════════════════════════════════════════

async function applyCupon() {
  const codigo   = (document.getElementById('chkCuponInput')?.value || '').trim().toUpperCase();
  const msgEl    = document.getElementById('chkCuponMsg');
  const inputEl  = document.getElementById('chkCuponInput');

  if (!msgEl) return;
  msgEl.style.display = 'block';

  if (!codigo) {
    msgEl.style.color = '#e53935';
    msgEl.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Ingresa un código de cupón';
    return;
  }

  // Estado de carga
  msgEl.style.color = '#888';
  msgEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando…';
  if (inputEl) inputEl.disabled = true;

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const result   = await validateCupon(codigo, subtotal);

  if (inputEl) inputEl.disabled = false;

  if (!result.valid) {
    msgEl.style.color = '#e53935';
    msgEl.innerHTML = `<i class="fas fa-times-circle"></i> ${result.msg}`;
    _activeCupon = null;
    _recalcCheckoutTotals();
    return;
  }

  // Cupón válido → guardar y recalcular
  _activeCupon = result;   // { valid, cupon, descuento }
  const tipoCupon = result.cupon?.tipo === 'monto_fijo'
    ? `RD$ ${fmt$(result.descuento)}`
    : `${result.cupon?.valor}%`;
  msgEl.style.color = '#1a7c3e';
  msgEl.innerHTML = `<i class="fas fa-check-circle"></i> <strong>${result.cupon?.codigo}</strong> aplicado — Ahorras ${tipoCupon}`;

  _recalcCheckoutTotals();
}

// ─── Recalcula y actualiza el desglose de totales + footer en el checkout ────
// ── Tarifa de envío según cantidad total de artículos ──────────────────────
function _calcEnvio(totalItems, subtotal) {
  if (subtotal >= 1500) return 0;          // Envío gratis ≥ RD$1,500
  if (totalItems <= 2)  return  75;        // 1-2 artículos  → RD$75
  if (totalItems <= 5)  return 125;        // 3-5 artículos  → RD$125
  if (totalItems <= 10) return 175;        // 6-10 artículos → RD$175
  return 225;                              // 11+ artículos  → RD$225
}

// ── Plan Cero Centavos: calcula los centavos a descontar para redondear ──────
// Ej: total = 100.75 → centavos = 0.75 → total final = 100.00
function _calcCeroCentavos(total) {
  const centavos = +(total % 1).toFixed(2);  // fracción decimal
  return centavos > 0 ? +centavos.toFixed(2) : 0;
}

// ── Cache de settings para el checkout (se invalida al abrir) ───────────────
let _checkoutSettingsCache = null;

// ── Horario de entrega: desde ahora hasta la hora de cierre del día ──────────
// cfg: objeto de settings cargado desde la API (campos: hoursWeekday, hoursSunday)
function _calcHorarioEntrega(cfg) {
  const now  = new Date();
  const diaSemana = now.getDay(); // 0=Domingo

  // Los campos reales guardados por el admin son: hoursWeekday y hoursSunday
  // Por defecto: 8:00 PM para no inventar horarios
  const horasWeekday = (cfg && cfg.hoursWeekday) || '7:00 AM – 8:00 PM';
  const horasSunday  = (cfg && cfg.hoursSunday)  || '8:00 AM – 8:00 PM';
  const horasHoy     = diaSemana === 0 ? horasSunday : horasWeekday;

  // Parsear hora de cierre desde el string "H:MM AM – H:MM PM"
  let cierreH = 20; // default seguro: 8 PM
  let cierreM = 0;
  try {
    // Busca la segunda parte del rango (después del –)
    const partes = horasHoy.split(/[–\-]/);
    if (partes.length >= 2) {
      const cierreStr = partes[partes.length - 1].trim(); // ej: "10:00 PM"
      const match = cierreStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const ampm = (match[3] || '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        cierreH = h;
        cierreM = m;
      }
    }
  } catch(e) {}

  // Construir hora de cierre de hoy
  const cierre = new Date(now);
  cierre.setHours(cierreH, cierreM, 0, 0);

  // Meses en español
  const meses = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const fechaLabel = `${now.getDate()} DE ${meses[now.getMonth()]}`;

  // Ventana de "próximo a cerrar": menos de 60 minutos para el cierre
  const msParaCierre = cierre - now;
  const proximoACerrar = msParaCierre > 0 && msParaCierre <= 60 * 60 * 1000;

  // Si ya pasó la hora de cierre → CERRADO, pedido para mañana
  if (now >= cierre) {
    const manana = new Date(now);
    manana.setDate(manana.getDate() + 1);
    const fechaManana = `${manana.getDate()} DE ${meses[manana.getMonth()]}`;
    return {
      desde:      '8:00 a.m.',
      hasta:      _fmt12h(cierreH, cierreM),
      fecha:      fechaManana,
      esMañana:   true,
      cerrado:    true,   // ← supermercado YA cerrado
      proximoACerrar: false,
    };
  }

  // Si está a menos de 60 min del cierre → PRÓXIMO A CERRAR, pedido para mañana
  if (proximoACerrar) {
    const manana = new Date(now);
    manana.setDate(manana.getDate() + 1);
    const fechaManana = `${manana.getDate()} DE ${meses[manana.getMonth()]}`;
    return {
      desde:      '8:00 a.m.',
      hasta:      _fmt12h(cierreH, cierreM),
      fecha:      fechaManana,
      esMañana:   true,
      cerrado:    false,
      proximoACerrar: true,  // ← menos de 1h para cerrar
    };
  }

  // Hora de entrega = desde ahora hasta cierre
  const desdeH = now.getHours();
  const desdeM = now.getMinutes();

  return {
    desde:    _fmt12h(desdeH, desdeM),
    hasta:    _fmt12h(cierreH, cierreM),
    fecha:    fechaLabel,
    esMañana: false,
    cerrado:  false,
    proximoACerrar: false,
  };
}

// Formatea horas a "H:MM a.m./p.m."
function _fmt12h(h, m) {
  const ampm = h >= 12 ? 'p.m.' : 'a.m.';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// Renderiza el bloque de horario de entrega en el checkout
// cfg viene cargado desde la API en openCheckout
function _renderHorarioEntrega(cfg) {
  const el = document.getElementById('chkScheduleCard');
  if (!el) return;
  const h = _calcHorarioEntrega(cfg);
  el.innerHTML = `
    <div class="chk-schedule-inner">
      <div class="chk-schedule-time">
        <i class="fas fa-clock chk-schedule-icon"></i>
        <span class="chk-schedule-range">${h.desde} – ${h.hasta}</span>
      </div>
      <div class="chk-schedule-date">
        <span class="chk-schedule-dot"></span>
        <span>${h.esMañana ? '<i class="fas fa-moon" style="font-size:.75rem"></i> ' : ''}${h.fecha}</span>
      </div>
    </div>
    ${h.cerrado        ? '<p class="chk-schedule-note chk-schedule-closed"><i class="fas fa-store-slash"></i> El supermercado está cerrado. Tu pedido se entregará mañana.</p>' : ''}
    ${h.proximoACerrar ? '<p class="chk-schedule-note"><i class="fas fa-circle-info"></i> El supermercado está próximo a cerrar. Tu pedido se entregará mañana.</p>' : ''}
  `;
}

function _recalcCheckoutTotals() {
  const totalItems = cart.reduce((s, c) => s + c.qty, 0);
  const subtotal   = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const envio      = _calcEnvio(totalItems, subtotal);
  const descuento  = _activeCupon?.descuento || 0;
  const totalBruto = Math.max(0, subtotal + envio - descuento);

  // ── Plan Cero Centavos ──
  const ceroCentavos = _calcCeroCentavos(totalBruto);
  const total        = +(totalBruto - ceroCentavos).toFixed(2);

  const descRow  = document.getElementById('chkDescuentoRow');
  const descAmt  = document.getElementById('chkDescuentoAmt');
  const footerTt = document.getElementById('chkFooterTotal');
  const totalsEl = document.getElementById('chkTotals');
  const subtitleEl = document.getElementById('chkSubtitle');

  // Texto de envío
  let envioLabel;
  if (envio === 0) {
    envioLabel = `<span style="color:#1a7c3e;font-weight:700">¡Gratis!</span>`;
  } else {
    envioLabel = `RD$ ${fmt$(envio)} <span style="font-size:.75rem;color:#888">(${totalItems} art.)</span>`;
  }

  // Indicador de sustitución autorizada
  const sustPref = getSustitucionPref();
  const sustRow  = sustPref
    ? `<div class="chk-total-row chk-sustitucion-row">
         <span><i class="fas fa-shuffle"></i> Sustitución autorizada</span>
         <span class="chk-sust-badge"><i class="fas fa-check"></i> Sí</span>
       </div>`
    : '';

  // Fila Plan Cero Centavos (solo si hay centavos que descontar)
  const ceroCentavosRow = ceroCentavos > 0
    ? `<div class="chk-total-row chk-cero-centavos-row">
         <span><i class="fas fa-coins"></i> Plan Cero Centavos</span>
         <span class="chk-cero-centavos-amt">- RD$ ${fmt$(ceroCentavos)}</span>
       </div>`
    : '';

  // Actualizar desglose
  if (totalsEl) {
    totalsEl.innerHTML = `
      <div class="chk-total-row"><span>Subtotal (${totalItems} artículo${totalItems!==1?'s':''})</span><span>RD$ ${fmt$(subtotal)}</span></div>
      <div class="chk-total-row"><span>Gastos de envío</span><span>${envioLabel}</span></div>
      ${descuento > 0 ? `<div class="chk-total-row" style="color:#1a7c3e;font-weight:600"><span><i class="fas fa-tag"></i> Cupón ${_activeCupon?.cupon?.codigo || ''}</span><span>- RD$ ${fmt$(descuento)}</span></div>` : ''}
      ${ceroCentavosRow}
      <div class="chk-total-row total-final"><span>Total a pagar</span><span>RD$ ${fmt$(total)}</span></div>
      ${sustRow}`;
  }

  // Badge de descuento en footer
  if (descRow) descRow.style.display = descuento > 0 ? 'block' : 'none';
  if (descAmt) descAmt.textContent   = `- RD$ ${fmt$(descuento)}`;
  if (footerTt) footerTt.textContent = `RD$ ${fmt$(total)}`;
  if (subtitleEl) subtitleEl.textContent = `${totalItems} artículo${totalItems!==1?'s':''} · RD$ ${fmt$(total)}`;

  // Renderizar horario usando el cache de settings cargado desde la API
  _renderHorarioEntrega(_checkoutSettingsCache);
}

// ── Toggle del formulario de comprobante fiscal ────────────────────────────
function toggleFiscalForm() {
  const toggle = document.getElementById('chkFiscalToggle');
  const form   = document.getElementById('chkFiscalForm');
  if (!toggle || !form) return;
  if (toggle.checked) {
    form.classList.remove('hidden');
  } else {
    form.classList.add('hidden');
    // Limpiar campos al desactivar
    const rnc    = document.getElementById('chkFiscalRNC');
    const nombre = document.getElementById('chkFiscalNombre');
    if (rnc)    rnc.value = '';
    if (nombre) nombre.value = '';
  }
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICACIONES DEL CLIENTE — Ver cambios de estado de pedidos
// ═══════════════════════════════════════════════════════════════════

let _clientNotiBadge = 0;

async function loadClientNotificaciones() {
  if (!currentClient?.email) return;
  try {
    const emailEnc = encodeURIComponent(currentClient.email);
    const json = await _supaFetch(
      `notificaciones?select=*&limit=50&order=created_at.desc&or=(cliente_email.eq.${emailEnc},cliente_email.eq.todos)`
    ).catch(() => []);
    const all  = (Array.isArray(json) ? json : []).filter(n =>
      n.cliente_email === currentClient.email || n.cliente_email === 'todos'
    );

    const unread = all.filter(n => !n.leida).length;
    _clientNotiBadge = unread;

    // Mostrar badge en el botón "Mi cuenta"
    _updateClientNotiBadge(unread);

    return all;
  } catch(e) { return []; }
}

function _updateClientNotiBadge(count) {
  let badge = document.getElementById('clientNotiBadge');
  if (!badge) {
    const btn = document.querySelector('.myaccount-btn, #myAccountBtn, .action-btn.account');
    if (btn) {
      badge = document.createElement('span');
      badge.id = 'clientNotiBadge';
      badge.style.cssText = 'background:#e53935;color:#fff;border-radius:10px;font-size:.65rem;font-weight:700;padding:1px 6px;margin-left:4px;vertical-align:top';
      btn.appendChild(badge);
    }
  }
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

async function renderClientNotificaciones() {
  const notiContainer = document.getElementById('clientNotiList');
  if (!notiContainer) return;

  // Skeleton loader mientras carga
  notiContainer.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
      ${[1,2,3].map(()=>`
        <div style="background:#f0f0f0;border-radius:14px;height:72px;animation:notiPulse 1.4s ease infinite"></div>
      `).join('')}
    </div>
    <style>@keyframes notiPulse{0%,100%{opacity:.6}50%{opacity:1}}</style>`;

  const list = await loadClientNotificaciones();

  if (!list || !list.length) {
    notiContainer.innerHTML = `
      <div style="
        text-align:center;
        padding:32px 16px;
        background:linear-gradient(135deg,#f7f9f4,#e8f5ee);
        border-radius:16px;
        border:1.5px dashed #b2dfcc;
      ">
        <div style="font-size:2.5rem;margin-bottom:10px">🔔</div>
        <div style="font-weight:700;color:#1a7c3e;font-size:.95rem;margin-bottom:4px">Todo al día</div>
        <div style="font-size:.82rem;color:#888">No tienes notificaciones por el momento</div>
      </div>`;
    return;
  }

  // Configuración visual por tipo
  const tipoConfig = {
    cambio_estado: {
      icon: 'fa-truck',
      gradient: 'linear-gradient(135deg,#1a7c3e,#27a35a)',
      badge: '#e8f5ee', badgeText: '#1a7c3e',
      label: 'Pedido',
    },
    nueva_oferta: {
      icon: 'fa-tag',
      gradient: 'linear-gradient(135deg,#f57c00,#ffb74d)',
      badge: '#fff8e1', badgeText: '#f57c00',
      label: 'Oferta',
    },
    cupon: {
      icon: 'fa-ticket',
      gradient: 'linear-gradient(135deg,#7b1fa2,#ba68c8)',
      badge: '#f3e5f5', badgeText: '#7b1fa2',
      label: 'Cupón',
    },
    sistema: {
      icon: 'fa-bell',
      gradient: 'linear-gradient(135deg,#1565c0,#42a5f5)',
      badge: '#e3f2fd', badgeText: '#1565c0',
      label: 'Sistema',
    },
  };

  // Estado del pedido — colores y etiquetas
  const estadoConfig = {
    pendiente:  { color:'#f57c00', bg:'#fff3e0', label:'Pendiente',  icon:'fa-hourglass-half' },
    procesando: { color:'#1565c0', bg:'#e3f2fd', label:'Preparando', icon:'fa-gear' },
    enviado:    { color:'#7b1fa2', bg:'#f3e5f5', label:'En camino',  icon:'fa-truck' },
    entregado:  { color:'#1a7c3e', bg:'#e8f5ee', label:'Entregado',  icon:'fa-circle-check' },
    cancelado:  { color:'#e53935', bg:'#fce8e8', label:'Cancelado',  icon:'fa-ban' },
  };

  const unread = list.filter(n => !n.leida).length;

  notiContainer.innerHTML = `
    <!-- Cabecera del panel -->
    <div style="
      display:flex; justify-content:space-between; align-items:center;
      margin-bottom:14px; padding-bottom:10px;
      border-bottom:2px solid #e8f5ee;
    ">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-weight:800;color:#1a1a2e;font-size:.95rem">Notificaciones</span>
        ${unread > 0 ? `<span style="
          background:linear-gradient(135deg,#e53935,#ef5350);
          color:#fff; font-size:.7rem; font-weight:700;
          padding:2px 8px; border-radius:20px;
          box-shadow:0 2px 6px rgba(229,57,53,.35);
        ">${unread} nueva${unread>1?'s':''}</span>` : ''}
      </div>
      <button onclick="renderClientNotificaciones()" style="
        background:none;border:none;cursor:pointer;
        color:#1a7c3e;font-size:.78rem;font-weight:600;
        display:flex;align-items:center;gap:4px;
        padding:4px 8px;border-radius:8px;
        transition:background .2s;
      " onmouseover="this.style.background='#e8f5ee'" onmouseout="this.style.background='none'">
        <i class="fas fa-rotate-right"></i> Actualizar
      </button>
    </div>

    <!-- Lista de notificaciones -->
    <div style="display:flex;flex-direction:column;gap:10px">
      ${list.slice(0, 12).map(n => {
        const cfg    = tipoConfig[n.tipo] || tipoConfig.sistema;
        const est    = n.estado_pedido ? (estadoConfig[n.estado_pedido] || null) : null;
        const recId  = n.id;
        const fecha  = n.fecha || '-';
        const isNew  = !n.leida;

        return `
        <div style="
          position:relative;
          background:${isNew ? '#fff' : '#fafafa'};
          border-radius:14px;
          border:1.5px solid ${isNew ? '#b2dfcc' : '#e8ecf0'};
          overflow:hidden;
          box-shadow:${isNew ? '0 4px 16px rgba(26,124,62,.12)' : '0 1px 4px rgba(0,0,0,.05)'};
          transition:box-shadow .2s, transform .2s;
          cursor:default;
        " onmouseover="this.style.boxShadow='0 6px 20px rgba(0,0,0,.12)';this.style.transform='translateY(-1px)'"
           onmouseout="this.style.boxShadow='${isNew ? '0 4px 16px rgba(26,124,62,.12)' : '0 1px 4px rgba(0,0,0,.05)'}';this.style.transform='translateY(0)'">

          <!-- Franja lateral de color -->
          <div style="
            position:absolute;left:0;top:0;bottom:0;width:4px;
            background:${cfg.gradient};
            border-radius:4px 0 0 4px;
          "></div>

          <!-- Contenido principal -->
          <div style="padding:14px 14px 12px 18px;display:flex;gap:12px;align-items:flex-start">

            <!-- Ícono circular -->
            <div style="
              width:42px;height:42px;flex-shrink:0;
              border-radius:50%;
              background:${cfg.gradient};
              display:flex;align-items:center;justify-content:center;
              color:#fff;font-size:1rem;
              box-shadow:0 3px 10px rgba(0,0,0,.2);
            ">
              <i class="fas ${cfg.icon}"></i>
            </div>

            <!-- Texto -->
            <div style="flex:1;min-width:0">

              <!-- Fila superior: badge tipo + título -->
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
                <span style="
                  background:${cfg.badge};color:${cfg.badgeText};
                  font-size:.68rem;font-weight:700;
                  padding:2px 8px;border-radius:20px;
                  text-transform:uppercase;letter-spacing:.04em;
                ">${cfg.label}</span>
                ${isNew ? `<span style="
                  background:linear-gradient(135deg,#1a7c3e,#27a35a);
                  color:#fff;font-size:.65rem;font-weight:700;
                  padding:2px 7px;border-radius:20px;
                ">● Nuevo</span>` : ''}
              </div>

              <!-- Título -->
              <div style="
                font-weight:700;color:#1a1a2e;font-size:.88rem;
                margin-bottom:3px;line-height:1.3;
              ">${n.titulo || 'Sin título'}</div>

              <!-- Mensaje -->
              <div style="
                font-size:.82rem;color:#667;
                line-height:1.45;margin-bottom:6px;
              ">${n.mensaje || ''}</div>

              <!-- Estado del pedido pill (si aplica) -->
              ${est ? `
              <div style="
                display:inline-flex;align-items:center;gap:5px;
                background:${est.bg};color:${est.color};
                font-size:.75rem;font-weight:700;
                padding:3px 10px;border-radius:20px;
                border:1px solid ${est.color}30;
                margin-bottom:6px;
              ">
                <i class="fas ${est.icon}" style="font-size:.7rem"></i>
                ${est.label}
              </div>` : ''}

              <!-- Fecha -->
              <div style="
                font-size:.72rem;color:#aab;
                display:flex;align-items:center;gap:4px;
              ">
                <i class="fas fa-clock" style="font-size:.68rem"></i> ${fecha}
              </div>
            </div>

            <!-- Botón marcar leída -->
            ${isNew ? `
            <button onclick="markClientNotiRead('${recId}')" style="
              flex-shrink:0;
              width:30px;height:30px;
              border-radius:50%;
              border:1.5px solid #1a7c3e;
              background:#fff;color:#1a7c3e;
              cursor:pointer;font-size:.8rem;
              display:flex;align-items:center;justify-content:center;
              transition:all .2s;
            " title="Marcar como leída"
               onmouseover="this.style.background='#1a7c3e';this.style.color='#fff'"
               onmouseout="this.style.background='#fff';this.style.color='#1a7c3e'">
              <i class="fas fa-check"></i>
            </button>` : `
            <div style="
              width:30px;height:30px;border-radius:50%;
              background:#e8f5ee;color:#1a7c3e;
              display:flex;align-items:center;justify-content:center;
              font-size:.75rem;flex-shrink:0;
            " title="Leída">
              <i class="fas fa-check-double"></i>
            </div>`}
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- Pie: total de notificaciones -->
    ${list.length > 12 ? `
    <div style="text-align:center;margin-top:12px;font-size:.78rem;color:#aaa">
      Mostrando 12 de ${list.length} notificaciones
    </div>` : ''}
  `;
}

async function markClientNotiRead(id) {
  try {
    await _supaFetch(`notificaciones?id=eq.${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ leida: true })
    });
    renderClientNotificaciones();
  } catch(e) {}
}

// Llamar al cargar la sesión del cliente
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (currentClient) loadClientNotificaciones();
  }, 2000);
});
