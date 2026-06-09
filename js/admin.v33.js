/**
 * SUPERMERCADO CASA MOTA — ADMIN PANEL JS
 * Dashboard · Productos CRUD · Pedidos · Inventario · Clientes · Personal · Configuración
 */

// ─── Helper de formato de precio ─────────────────────────────────────────────
/**
 * Formatea un número como precio con separador de miles y 2 decimales.
 * Implementación manual 100% compatible con todos los navegadores móviles.
 * Ejemplo: 2450 → "2,450.00"  |  1500.5 → "1,500.50"  |  1090.85 → "1,090.85"
 */
function fmt$(n) {
  const num = Math.abs(parseFloat(n) || 0);
  const sign = (parseFloat(n) || 0) < 0 ? '-' : '';
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${intWithCommas}.${decPart}`;
}

/**
 * Genera HTML de estrellas con soporte de media estrella.
 * Ej: 4.5 → 4 llenas + 1 mitad | 4.9 → 5 llenas | 4.2 → 4 llenas + 1 vacía
 */
function renderStars(rating) {
  const r = parseFloat(rating) || 0;
  const full     = Math.floor(r);
  const half     = (r - full) >= 0.25 && (r - full) < 0.75 ? 1 : 0;
  const extraFull = (r - full) >= 0.75 ? 1 : 0;
  const totalFull = full + extraFull;
  const empty    = 5 - totalFull - half;
  let html = '';
  for (let i = 0; i < totalFull; i++) html += '<i class="fas fa-star"></i>';
  if (half)                           html += '<i class="fas fa-star-half-stroke"></i>';
  for (let i = 0; i < empty; i++)    html += '<i class="far fa-star"></i>';
  return html;
}

// ─── Estado ──────────────────────────────────────────────────────────────────
// Los datos ahora vienen de la API RESTful. Se inicializan vacíos y se
// cargan de forma asíncrona en DOMContentLoaded (ver initAdminData()).
let adminProducts = [];
let orders        = [];
let customers     = [];
let staffList     = [];
let editingProductId  = null;
let editingOrderId    = null;
let editingCustomerId = null;
let deleteCustomerId  = null;
let editingStaffId    = null;
let deleteStaffId     = null;
let sidebarCollapsed  = false;
let salesChartInstance = null;
let _dashboardLoaded  = false; // evita doble render en init
let currentSession    = null;

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ── Debounce: evita re-renderizar en cada tecla (previene parpadeo de imágenes)
function debounce(fn, ms) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
const _debouncedRenderProducts  = debounce(() => { _pages.products = 1; renderProductsTable(); }, 220);
const _debouncedRenderInventory = debounce(() => { _pages.inventory = 1; renderInventory(); }, 220);

// ── Paginación universal ──────────────────────────────────────────────────────
const PAGE_SIZE = 20;  // filas por página en todas las secciones
const _pages = { products: 1, orders: 1, inventory: 1, customers: 1, staff: 1 };

/**
 * Renderiza el paginador. Solo se muestra cuando hay más de PAGE_SIZE filas.
 */
function _renderPaginator(paginatorId, currentPage, totalItems, section, scrollToId) {
  const wrap = document.getElementById(paginatorId);
  if (!wrap) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (totalPages <= 1) { wrap.innerHTML = ''; return; }

  const nums = new Set([1, totalPages]);
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) nums.add(i);
  const sorted = [...nums].sort((a, b) => a - b);

  let numsHTML = '';
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) numsHTML += `<span class="pg-dots">…</span>`;
    numsHTML += `<button class="pg-num${p === currentPage ? ' pg-active' : ''}"
      onclick="_goPage('${section}','${scrollToId}',${p})">${p}</button>`;
    prev = p;
  }

  wrap.innerHTML = `
    <div class="pg-bar">
      <div class="pg-nums">
        <button class="pg-arrow" onclick="_goPage('${section}','${scrollToId}',${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i>
        </button>
        ${numsHTML}
        <button class="pg-arrow" onclick="_goPage('${section}','${scrollToId}',${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
      <div class="pg-actions">
        <button class="pg-action-btn" onclick="_goPage('${section}','${scrollToId}',${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i> Anterior
        </button>
        <button class="pg-action-btn pg-action-last" onclick="_goPage('${section}','${scrollToId}',${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>
          <i class="fas fa-forward-step"></i> Última
        </button>
      </div>
    </div>`;
}

/** Navega a una página de cualquier sección y re-renderiza */
function _goPage(section, scrollToId, page) {
  const totals = {
    products: (() => {
      const q = (document.getElementById('prodSearch')?.value || '').toLowerCase();
      const cat = document.getElementById('prodCatFilter')?.value || '';
      const badge = document.getElementById('prodBadgeFilter')?.value || '';
      return adminProducts.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q)) &&
        (!cat || p.category === cat) && (!badge || p.badge === badge)
      ).length;
    })(),
    orders: (() => {
      const q = (document.getElementById('orderSearch')?.value || '').toLowerCase();
      const status = document.getElementById('orderStatusFilter')?.value || '';
      return orders.filter(o =>
        (!q || o.customer.toLowerCase().includes(q) || String(o.id).includes(q) || o.email.toLowerCase().includes(q)) &&
        (!status || o.status === status)
      ).length;
    })(),
    inventory: (() => {
      const q = (document.getElementById('invSearch')?.value || '').toLowerCase();
      const filter = document.getElementById('invStockFilter')?.value || '';
      return adminProducts.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || (p.barcode||'').toLowerCase().includes(q)) &&
        (!filter || (filter === 'low' ? p.stock < 20 : p.stock >= 20))
      ).length;
    })(),
    customers: (() => {
      const q = (document.getElementById('custSearch')?.value || '').toLowerCase();
      return customers.filter(c =>
        !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.phone||'').includes(q)
      ).length;
    })(),
    staff: (() => {
      const q = (document.getElementById('staffSearch')?.value || '').toLowerCase();
      const role = document.getElementById('staffRoleFilter')?.value || '';
      const status = document.getElementById('staffStatusFilter')?.value || '';
      return staffList.filter(s => {
        const name = (s.firstName + ' ' + s.lastName).toLowerCase();
        return (!q || name.includes(q) || s.email.toLowerCase().includes(q)) &&
               (!role || s.role === role) && (!status || s.status === status);
      }).length;
    })(),
  };
  const totalPages = Math.max(1, Math.ceil((totals[section] || 1) / PAGE_SIZE));
  _pages[section] = Math.max(1, Math.min(page, totalPages));

  const renders = {
    products: renderProductsTable,
    orders: renderOrdersTable,
    inventory: renderInventory,
    customers: renderCustomers,
    staff: renderStaff,
  };
  if (renders[section]) renders[section]();

  const el = document.getElementById(scrollToId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── TELÉFONO — Formato automático + helpers de prefijo ─────────────────────
// Formatea el input en tiempo real: tras 3 dígitos inserta guión automáticamente
// Resultado esperado en el input: "000-0000"
function phoneAutoFormat(input) {
  let val = input.value.replace(/\D/g, '');  // solo dígitos
  if (val.length > 7) val = val.slice(0, 7); // máx 7 dígitos (3+4)
  if (val.length > 3) {
    val = val.slice(0, 3) + '-' + val.slice(3);
  }
  input.value = val;
}

// Formatea cédula dominicana en tiempo real: "000-0000000-0"
// Estructura: 3 dígitos + guión + 7 dígitos + guión + 1 dígito
function cedulaAutoFormat(input) {
  // Preservar posición del cursor para no saltar al final
  const cursorPos = input.selectionStart;
  const prevLen   = input.value.length;

  let val = input.value.replace(/\D/g, ''); // solo dígitos
  if (val.length > 11) val = val.slice(0, 11); // máx 11 dígitos

  let formatted = '';
  if (val.length <= 3) {
    formatted = val;
  } else if (val.length <= 10) {
    formatted = val.slice(0, 3) + '-' + val.slice(3);
  } else {
    formatted = val.slice(0, 3) + '-' + val.slice(3, 10) + '-' + val.slice(10);
  }

  input.value = formatted;

  // Reposicionar el cursor teniendo en cuenta los guiones insertados
  const newLen  = formatted.length;
  const delta   = newLen - prevLen;
  const newPos  = Math.max(0, cursorPos + delta);
  try { input.setSelectionRange(newPos, newPos); } catch(e) {}
}

// Lee el número completo combinando prefijo + input: "809-000-0000"
function getPhoneValue(inputId, prefixId) {
  const prefix = document.getElementById(prefixId)?.value || '809';
  const number = document.getElementById(inputId)?.value.trim() || '';
  if (!number) return '';
  return `${prefix}-${number}`;
}

// Carga un número guardado ("809-000-0000" o "(809) 000-0000") en el widget
function setPhoneValue(inputId, prefixId, fullPhone) {
  if (!fullPhone) {
    const el = document.getElementById(inputId);
    if (el) el.value = '';
    return;
  }
  // Extraer dígitos del número completo
  const digits = fullPhone.replace(/\D/g, ''); // ej: "8090001234"
  if (digits.length < 7) {
    // No tiene prefijo de área — colocar tal cual
    const el = document.getElementById(inputId);
    if (el) el.value = fullPhone;
    return;
  }
  // Los primeros 3 dígitos son el prefijo, el resto el número
  const prefix = digits.slice(0, 3);  // "809"
  const rest   = digits.slice(3);     // "0001234"
  // Formatear la parte numérica: "000-1234"
  const formatted = rest.length > 3
    ? rest.slice(0, 3) + '-' + rest.slice(3, 7)
    : rest;

  const selEl = document.getElementById(prefixId);
  const inpEl = document.getElementById(inputId);
  if (selEl && ['809','829','849'].includes(prefix)) selEl.value = prefix;
  if (inpEl) inpEl.value = formatted;
}

// ─── BARCODE HELPERS ──────────────────────────────────────────────────────────

/**
 * Valida si un código de barras cumple los estándares EAN / UPC.
 * Retorna { valid: bool, type: string, error: string }
 */
function _validateEAN(code) {
  if (!code || typeof code !== 'string') return { valid: false, type: '', error: 'Campo vacío' };

  // Solo dígitos
  if (!/^\d+$/.test(code)) {
    return { valid: false, type: '', error: 'Solo se permiten números (sin letras ni símbolos)' };
  }

  const len = code.length;
  const validLengths = { 6: 'UPC-E', 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'ITF-14' };

  if (!validLengths[len]) {
    return { valid: false, type: '', error: `Longitud inválida (${len} dígitos). Debe ser 6, 8, 12, 13 o 14` };
  }

  // ── UPC-E de 6 dígitos (sin número de sistema ni check) ──────────────────
  if (len === 6) return { valid: true, type: 'UPC-E', error: '' };

  // ── UPC-E de 8 dígitos (formato completo: 0/1 + 6 payload + check) ───────
  // Muchos productos americanos usan este formato. Se expande a UPC-A para
  // verificar el dígito verificador (el algoritmo EAN-8 estándar NO aplica).
  //
  // Regla de expansión oficial GS1:
  //   d0 = número de sistema (0 ó 1)
  //   payload = d1 d2 d3 d4 d5 d6  (6 dígitos)
  //   d7 = dígito verificador
  //
  //   Según d6 (último del payload):
  //   0,1,2 → UPC-A = d0 d1 d2 d6 0 0 0 0 0 d3 d4 d5   (11 dígitos)
  //   3     → UPC-A = d0 d1 d2 d3 0 0 0 0 0 0 d4 d5     (11 dígitos)  ← corrección
  //   4     → UPC-A = d0 d1 d2 d3 d4 0 0 0 0 0 d5       (11 dígitos)
  //   5–9   → UPC-A = d0 d1 d2 d3 d4 d5 0 0 0 0 d6      (11 dígitos)
  if (len === 8) {
    const sys   = parseInt(code[0]);
    const chk   = parseInt(code[7]);
    const d     = code.slice(1, 7).split('').map(Number); // payload [0..5]
    const last  = d[5];

    // Solo UPC-E si comienza con 0 o 1
    if (sys === 0 || sys === 1) {
      let upcA11 = '';
      if      (last <= 2) upcA11 = `${sys}${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
      else if (last === 3) upcA11 = `${sys}${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
      else if (last === 4) upcA11 = `${sys}${d[0]}${d[1]}${d[2]}${d[3]}0000${d[4]}`;
      else                 upcA11 = `${sys}${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}000${last}`;

      if (upcA11.length === 11) {
        const da = upcA11.split('').map(Number);
        let s = 0;
        da.forEach((v, i) => { s += (i % 2 === 0) ? v * 3 : v; });
        const expected = (10 - (s % 10)) % 10;
        if (expected === chk) {
          return { valid: true, type: 'UPC-E', error: '' };
        }
      }
    }

    // No es UPC-E válido → intentar como EAN-8 estándar
    const digs8   = code.split('').map(Number);
    const chk8    = digs8.pop();
    let   sum8    = 0;
    digs8.forEach((v, i) => { sum8 += (i % 2 === 0) ? v * 3 : v; });
    const exp8 = (10 - (sum8 % 10)) % 10;
    if (exp8 === chk8) return { valid: true, type: 'EAN-8', error: '' };

    // Ningún formato de 8 dígitos válido
    return {
      valid: false,
      type: 'EAN-8 / UPC-E',
      error: `Dígito verificador inválido para EAN-8 y UPC-E`
    };
  }

  // ── EAN-8 ya cubierto arriba. Aquí: UPC-A (12), EAN-13, ITF-14 ───────────
  const digits = code.split('').map(Number);
  const check  = digits.pop();
  let sum = 0;
  digits.forEach((d, i) => {
    // Longitud par (12→11, 14→13): pos pares ×3, impares ×1
    // Longitud impar (13→12): pos pares ×1, impares ×3
    const isOdd = (i % 2 === 0);
    if (len % 2 === 0) {
      sum += isOdd ? d * 3 : d;
    } else {
      sum += isOdd ? d : d * 3;
    }
  });
  const calcCheck = (10 - (sum % 10)) % 10;

  if (calcCheck !== check) {
    return {
      valid: false,
      type: validLengths[len],
      error: `Dígito verificador incorrecto (esperado: ${calcCheck}, ingresado: ${check})`
    };
  }

  return { valid: true, type: validLengths[len], error: '' };
}

/**
 * Validación en tiempo real del campo pBarcode:
 * - Verifica formato EAN/UPC
 * - Verifica unicidad contra otros productos
 */
function _checkBarcodeUnique(val, excludeId = null) {
  const status   = document.getElementById('pBarcodeStatus');
  const inputEl  = document.getElementById('pBarcode');
  if (!status) return;

  // Campo vacío
  if (!val || !val.trim()) {
    status.innerHTML = `<span style="color:#e53935">⚠️ Obligatorio</span>`;
    if (inputEl) { inputEl.style.borderColor = ''; inputEl.style.boxShadow = ''; }
    return;
  }

  // Solo dígitos — feedback inmediato si hay letras
  if (!/^\d+$/.test(val)) {
    status.innerHTML = `<span style="color:#e53935">❌ Solo números</span>`;
    if (inputEl) {
      inputEl.style.borderColor = '#e53935';
      inputEl.style.boxShadow   = '0 0 0 3px rgba(229,57,53,.15)';
    }
    return;
  }

  const len = val.length;

  // Mientras escribe — feedback de longitud en curso
  if (len < 6) {
    status.innerHTML = `<span style="color:#9ca3af">Escribe ${6 - len} dígito(s) más…</span>`;
    if (inputEl) { inputEl.style.borderColor = ''; inputEl.style.boxShadow = ''; }
    return;
  }

  // Validar EAN/UPC completo
  const eanResult = _validateEAN(val);

  if (!eanResult.valid) {
    status.innerHTML = `<span style="color:#e53935">❌ ${eanResult.error}</span>`;
    if (inputEl) {
      inputEl.style.borderColor = '#e53935';
      inputEl.style.boxShadow   = '0 0 0 3px rgba(229,57,53,.15)';
    }
    return;
  }

  // Verificar unicidad
  const dup = adminProducts.find(p => p.barcode === val && String(p.id) !== String(excludeId ?? editingProductId));
  if (dup) {
    status.innerHTML = `<span style="color:#e65100">⚠️ Ya asignado a "${dup.name}"</span>`;
    if (inputEl) {
      inputEl.style.borderColor = '#e65100';
      inputEl.style.boxShadow   = '0 0 0 3px rgba(230,81,0,.15)';
    }
    return;
  }

  // ✅ Todo correcto
  status.innerHTML = `<span style="color:#1a7c3e;font-weight:600">✅ ${eanResult.type} válido</span>`;
  if (inputEl) {
    inputEl.style.borderColor = '#1a7c3e';
    inputEl.style.boxShadow   = '0 0 0 3px rgba(26,124,62,.15)';
  }
}

// Búsqueda inmediata por código de barras en gestión de productos
// _barcodeSearchProducts e _barcodeSearchInventory eliminados:
// prodSearch e invSearch ya buscan por nombre, descripción y código de barras.

// Búsqueda/escaneo de barcode en modal de nuevo pedido
// commit=true → añade la línea directamente (al presionar Enter)
function noBarcodeLookup(val, commit = false) {
  const msg = document.getElementById('noBarcodeMsg');
  const input = document.getElementById('noBarcodeInput');
  if (!val || !val.trim()) {
    if (msg) msg.textContent = 'Listo para escanear';
    return;
  }
  const code = val.trim();
  const prod = adminProducts.find(p => p.barcode && p.barcode.trim() === code);

  if (!prod) {
    if (msg) msg.innerHTML = `<span style="color:#e53935">⚠️ Código no encontrado</span>`;
    return;
  }

  if (prod.stock <= 0) {
    if (msg) msg.innerHTML = `<span style="color:#e53935">🚫 Sin stock: ${prod.name}</span>`;
    return;
  }

  if (commit) {
    // Buscar si ya existe una línea para este producto
    const existing = noLines.findIndex(l => String(l.productId) === String(prod.id));
    if (existing > -1) {
      // Incrementar cantidad si hay stock suficiente
      const line = noLines[existing];
      if (line.cantidad < prod.stock) {
        line.cantidad++;
        _noRenderLines();
        _noUpdateTotals();
        if (msg) msg.innerHTML = `<span style="color:#1a7c3e">✅ +1 "${prod.name}" (x${line.cantidad})</span>`;
      } else {
        if (msg) msg.innerHTML = `<span style="color:#e53935">⚠️ Stock máximo alcanzado para "${prod.name}"</span>`;
      }
    } else {
      // Agregar nueva línea
      noLines.push({ productId: String(prod.id), cantidad: 1 });
      _noRenderLines();
      _noUpdateTotals();
      if (msg) msg.innerHTML = `<span style="color:#1a7c3e">✅ Agregado: "${prod.name}"</span>`;
    }
    if (input) input.value = '';
    // Limpiar mensaje después de 2 s
    setTimeout(() => { if (msg) msg.textContent = 'Listo para escanear'; }, 2000);
  } else {
    // Solo mostrar preview mientras escribe
    if (msg) msg.innerHTML = `<i class="fas fa-check-circle" style="color:#1a7c3e"></i> <span style="color:#1a7c3e">${prod.name} · RD$ ${fmt$(prod.price)} · Stock: ${prod.stock}</span>`;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Carga todos los datos desde la API al arrancar el panel.
 * Garantiza que adminProducts, orders, customers, staffList y drivers
 * estén poblados antes de renderizar cualquier tabla.
 */
async function initAdminData() {
  const spinnerEl = document.getElementById('globalLoadingSpinner');
  if (spinnerEl) spinnerEl.style.display = 'flex';

  // Helper: timeout global para no quedar colgados nunca
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`Timeout (${ms}ms): ${label}`)), ms)
      )
    ]);
  }

  // ── FASE 1a: Órdenes + config + categorías (datos ligeros para el dashboard) ─
  let fase1OK = false;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      // Timeout de 30s — datos ligeros, deben llegar rápido
      const [ords, cfg, cats] = await withTimeout(
        Promise.all([
          DB.getOrders(),
          DB.getSettings(),
          DB.getCategories(),
        ]),
        30000,
        `Fase1a intento ${intento}`
      );

      orders           = ords;
      adminCategories  = (cats || []).map(c => ({ ...c, icon: _sanitizeIcon(c.icon) }));
      _cache.orders    = orders;
      _cache.settings  = cfg;
      fase1OK = true;
      break;

    } catch(e) {
      console.warn(`initAdminData fase 1a intento ${intento}/3:`, e.message || e);
      if (intento < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Ocultar loader y renderizar dashboard con lo que tenemos
  if (spinnerEl) spinnerEl.style.display = 'none';

  if (!fase1OK) {
    console.error('initAdminData: Fase 1a fallida tras 3 intentos — usando datos locales');
  }

  try { renderDashboardKpis(); } catch(e) { console.error('renderDashboardKpis:', e); }
  try { renderTopProducts();   } catch(e) { console.error('renderTopProducts:',   e); }
  try { renderRecentOrders();  } catch(e) { console.error('renderRecentOrders:',  e); }
  // Gráfico: esperar 2 frames para que el canvas tenga dimensiones reales
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { renderSalesChart(); } catch(e) { console.error('renderSalesChart:', e); }
  }));
  try { updatePendingBadge();  } catch(e) { console.error('updatePendingBadge:',  e); }
  try { renderOrdersTable();   } catch(e) { console.error('renderOrdersTable:',   e); }

  // ── FASE 1b: Productos (paginado — puede tardar más por los 1645 registros) ───
  setTimeout(async () => {
    try {
      const prods = await withTimeout(DB.getProducts({full:true}), 45000, 'Fase1b productos');
      adminProducts   = prods.length > 0 ? prods : deepClone(PRODUCTS);
      _cache.products = adminProducts;
      try { renderProductsTable(); } catch(e) {}
      try { renderInventory();     } catch(e) {}
      try { renderDashboardKpis(); } catch(e) {} // refrescar KPI "Productos activos"
      // ── Ahora que hay productos, dibujar los gráficos del dashboard ──
      try { renderTopProducts();   } catch(e) {}
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { renderSalesChart();  } catch(e) {}
      }));
    } catch(e) {
      console.warn('initAdminData fase 1b (productos):', e.message || e);
      if (!adminProducts.length && typeof PRODUCTS !== 'undefined') {
        adminProducts = deepClone(PRODUCTS);
      }
      try { renderProductsTable(); } catch(e2) {}
      try { renderInventory();     } catch(e2) {}
    }
  }, 50);

  // ── FASE 2: Clientes, staff, repartidores en segundo plano ──────────────────
  setTimeout(async () => {
    try {
      const [custs, stf, drvs] = await withTimeout(
        Promise.all([
          DB.getCustomers(),
          DB.getStaff(),
          DB.getDrivers(),
        ]),
        30000,
        'Fase2'
      );

      customers  = custs;
      staffList  = stf.length > 0 ? stf : DEFAULT_STAFF;
      drivers    = drvs;

      _cache.customers = customers;
      _cache.staff     = staffList;
      _cache.drivers   = drivers;

      try { renderCustomers(); } catch(e) {}
      try { renderStaff();     } catch(e) {}
      try { loadCategories();  } catch(e) {}

    } catch(e) {
      console.warn('initAdminData fase 2 error:', e.message || e);
    }
  }, 100);
}

document.addEventListener('DOMContentLoaded', () => {
  // Autenticación: redirigir a login si no hay sesión
  currentSession = requireAuth();
  if (!currentSession) return;

  // Aplicar permisos según rol
  applyPermissions(currentSession);

  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('es-DO', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Cargar configuración y todos los datos desde la API
  loadSettings();
  initAdminData();
  // Cargar display de API keys de IA (si ya estaban guardadas)
  if (typeof loadAiKeysDisplay === 'function') setTimeout(loadAiKeysDisplay, 500);

  // Listener para actualizar permisos del select de rol en modal Personal
  const sRole = document.getElementById('sRole');
  if (sRole) sRole.addEventListener('change', updateRolePermissions);
});

// ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────
function showSection(id, el) {
  // Control de acceso: verificar si el rol puede ver esta sección
  if (currentSession) {
    const role = getRole(currentSession.role);
    if (!role.sections.includes(id)) {
      showAdminToast('No tienes permiso para acceder a esta sección', 'error');
      return false;
    }
  }
  document.querySelectorAll('.section-content').forEach(s => {
    s.classList.remove('active', 'section-nav-animate');
  });
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const sec = document.getElementById('sec-' + id);
  if (sec) {
    sec.style.display = '';
    sec.classList.add('active');
    // La animación de entrada solo al navegar manualmente (no en carga inicial)
    requestAnimationFrame(() => sec.classList.add('section-nav-animate'));
  }
  if (el) el.classList.add('active');
  document.getElementById('breadcrumb').textContent = el?.querySelector('span')?.textContent || id;
  // Resetear paginación al cambiar de sección
  const sectionToPage = { orders:'orders', products:'products', inventory:'inventory', customers:'customers', staff:'staff' };
  if (sectionToPage[id]) _pages[sectionToPage[id]] = 1;

  // El dashboard siempre recarga (el usuario puede querer ver datos frescos)
  if (id === 'dashboard')  loadDashboard();
  if (id === 'orders')     { DB.getOrders().then(list => { orders = list; renderOrdersTable(); updatePendingBadge(); }).catch(() => { renderOrdersTable(); updatePendingBadge(); }); }
  if (id === 'products')   { DB.getProducts({full:true}).then(list => { if(list.length) adminProducts = list; renderProductsTable(); }).catch(() => renderProductsTable()); }
  if (id === 'inventory')  { DB.getProducts({full:true}).then(list => { if(list.length) adminProducts = list; renderInventory(); }).catch(() => renderInventory()); }
  if (id === 'staff')      renderStaff();
  if (id === 'customers')  { DB.getCustomers ? DB.getCustomers().then(list => { if(list.length) customers = list; renderCustomers(); }).catch(() => renderCustomers()) : renderCustomers(); }
  if (id === 'drivers')    { drivers = getDrivers(); renderDrivers(); }
  if (id === 'loyalty')         loadLoyalty();
  if (id === 'settings')        { loadSettings(); if (typeof loadAiKeysDisplay === 'function') loadAiKeysDisplay(); }
  if (id === 'reportes')       { if (typeof loadReportes       === 'function') loadReportes(); }
  if (id === 'cupones')        { if (typeof loadCupones        === 'function') loadCupones(); }
  if (id === 'notificaciones') { if (typeof loadNotificaciones === 'function') loadNotificaciones(); }
  if (id === 'categories')      loadCategories();
  if (id === 'respaldo')        initRespaldo();

  return false;
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  document.getElementById('mainContent').classList.toggle('expanded', sidebarCollapsed);
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

/**
 * Anima un número desde 0 hasta `end` en `duration` ms.
 * Si el valor NO es numérico (ej: "RD$ 1,200") lo anima extrayendo el número.
 */
function _animateKpi(el, targetVal, duration = 900) {
  if (!el) return;
  el.style.opacity = '1';

  // Detectar si es un valor monetario tipo "RD$ 1,234.56"
  const moneyMatch = String(targetVal).match(/^(RD\$\s*)([\d,]+\.?\d*)$/);
  const isNumber   = typeof targetVal === 'number' || (/^\d+$/.test(String(targetVal).trim()));

  if (moneyMatch) {
    const prefix = moneyMatch[1];
    const end    = parseFloat(moneyMatch[2].replace(/,/g, ''));
    let start    = 0;
    const step   = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current  = Math.round(ease * end);
      el.textContent = prefix + fmt$(current);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = targetVal;
    };
    requestAnimationFrame(step);

  } else if (isNumber) {
    const end  = parseInt(String(targetVal).trim(), 10);
    let start  = 0;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(ease * end);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = end;
    };
    requestAnimationFrame(step);

  } else {
    // Valor no numérico: aparece directo
    el.textContent = String(targetVal);
  }
}

function _setKpi(id, val, animate = true) {
  const el = document.getElementById(id);
  if (!el) return;
  if (animate) {
    _animateKpi(el, val);
  } else {
    el.style.opacity = '1';
    el.textContent   = String(val);
  }
}

function renderDashboardKpis() {
  // Usa los datos YA cargados en memoria — sin llamadas HTTP adicionales
  const totalSales = orders.reduce((s,o) => s + (o.status !== 'cancelado' ? (Number(o.total) || 0) : 0), 0);
  const lowStock   = adminProducts.filter(p => Number(p.stock) < 20).length;
  _setKpi('kpiSales',    `RD$ ${fmt$(totalSales)}`);
  _setKpi('kpiOrders',   orders.length);
  // Usar el total real de la BD si está disponible (evita el límite de 500)
  const totalProds = (typeof _totalProductsInDB !== 'undefined' && _totalProductsInDB > 0)
    ? _totalProductsInDB
    : adminProducts.length;
  _setKpi('kpiProducts', totalProds);
  _setKpi('kpiLowStock', lowStock);

  // Notificaciones no leídas (usa el array global cargado por extras.v32.js)
  const notiArr    = (typeof notificaciones !== 'undefined') ? notificaciones : [];
  const noLeidas   = notiArr.filter(n => n.leido === false).length;
  const totalNoti  = notiArr.length;
  _setKpi('kpiNotiNoLeidas', noLeidas);
  const sub = document.getElementById('kpiNotiSublabel');
  if (sub) sub.textContent = noLeidas === 1 ? 'sin leer' : noLeidas > 1 ? 'sin leer' : totalNoti > 0 ? 'todas leídas' : 'sin notificaciones';
}

async function loadDashboard() {
  // 1. Mostrar datos actuales en memoria DE INMEDIATO
  renderDashboardKpis();
  renderSalesChart();
  if (adminProducts.length > 0) renderTopProducts();
  if (orders.length > 0)        renderRecentOrders();

  // 2. Refrescar desde Supabase y re-renderizar TODO
  try {
    const [prods, ords] = await Promise.all([ DB.getProducts({full:true}), DB.getOrders() ]);

    if (prods.length > 0) adminProducts = prods;
    if (ords.length  > 0) orders        = ords;

    renderDashboardKpis();
    renderTopProducts();
    renderRecentOrders();

  } catch(e) {
    console.warn('loadDashboard: error al refrescar desde API', e);
    // Si falla, mostrar botón de reintento en el widget
    renderTopProducts();
    renderRecentOrders();
    _showDashboardRetry();
  }
}

/** Muestra un botón de reintento en el dashboard cuando la API falla */
function _showDashboardRetry() {
  const el = document.getElementById('topProducts');
  if (!el || adminProducts.length > 0) return;
  el.innerHTML = `
    <li style="padding:16px 0;text-align:center">
      <div style="color:var(--text-light);font-size:.84rem;margin-bottom:10px">
        <i class="fas fa-wifi" style="margin-right:6px;color:#e53935"></i>
        No se pudo conectar con el servidor
      </div>
      <button onclick="loadDashboard()" style="
        background:var(--primary);color:#fff;border:none;border-radius:8px;
        padding:8px 18px;font-size:.85rem;cursor:pointer;font-weight:600">
        <i class="fas fa-rotate-right" style="margin-right:6px"></i>Reintentar
      </button>
    </li>`;
}

function renderTopProducts() {
  const el = document.getElementById('topProducts');
  if (!el) return;

  // ── Sin datos aún: mostrar indicador de carga (transitorio)
  if (!adminProducts || adminProducts.length === 0) {
    el.innerHTML = '<li style="color:var(--text-light);font-size:.84rem;padding:12px 0">' +
      '<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Cargando productos…</li>';
    return;
  }

  // ── Agrupar por nombre: calcular rating promedio
  const map = {};
  adminProducts.forEach(p => {
    if (!p || !p.name) return;
    const r = Number(p.rating) || 0;
    if (!map[p.name]) map[p.name] = { sum: 0, count: 0 };
    map[p.name].sum   += r;
    map[p.name].count += 1;
  });

  // ── Ordenar por rating promedio desc, top 5
  const sorted = Object.entries(map)
    .map(([name, d]) => [name, d.count > 0 ? d.sum / d.count : 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!sorted.length) {
    el.innerHTML = '<li style="color:var(--text-light);font-size:.84rem;padding:12px 0">Sin productos registrados</li>';
    return;
  }

  const max = sorted[0][1] || 5; // evita división por cero

  el.innerHTML = sorted.map(([name, avg], i) => {
    const pct   = Math.max(8, Math.round(((avg || 0) / max) * 100));
    const label = avg > 0 ? '★ ' + avg.toFixed(1) : 'Sin rating';
    return `
    <li style="animation-delay:${.08 + i * .09}s">
      <span class="top-rank">${i + 1}</span>
      <span class="top-name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
      <div class="top-bar-wrap" style="width:80px;flex-shrink:0">
        <div class="top-bar-fill" data-pct="${pct}"></div>
      </div>
      <span class="top-sales" style="min-width:52px;text-align:right">${label}</span>
    </li>`;
  }).join('');

  // ── Animar barras de progreso con pequeño delay
  requestAnimationFrame(() => {
    document.querySelectorAll('#topProducts .top-bar-fill').forEach(bar => {
      const pct = bar.dataset.pct || '0';
      setTimeout(() => { bar.style.width = pct + '%'; }, 150);
    });
  });
}

function renderRecentOrders() {
  const recent = [...orders].sort((a,b) => b.id - a.id).slice(0,6);
  document.getElementById('recentOrdersTbody').innerHTML = recent.map((o,i) => `
    <tr class="anim-row" style="animation-delay:${.05 + i * .07}s">
      <td><strong>#${o.order_number || o.id}</strong></td>
      <td>${o.customer}</td>
      <td>${o.items} productos</td>
      <td><strong>RD$ ${fmt$(o.total)}</strong></td>
      <td><span class="status-pill status-${o.status}">${ucFirst(o.status)}</span></td>
      <td>${o.date}</td>
    </tr>`).join('');
}

function renderSalesChart() {
  // ── Canvas ───────────────────────────────────────────────────────────────────
  const canvasEl = document.getElementById('salesChart');
  if (!canvasEl) return;

  // Si el canvas aún no tiene dimensiones reales (está oculto o no renderizado),
  // esperamos un frame y reintentamos hasta que esté listo
  if (canvasEl.offsetWidth === 0 || canvasEl.offsetHeight === 0) {
    requestAnimationFrame(() => {
      setTimeout(() => renderSalesChart(), 150);
    });
    return;
  }

  // ── Datos ────────────────────────────────────────────────────────────────────
  // Construir set de slugs válidos — solo los que existen en adminCategories
  const validSlugs = new Set(
    (adminCategories || []).map(c => c.slug || c.id).filter(Boolean)
  );

  const catTotals = {};
  adminProducts.forEach(p => {
    // Solo incluir productos cuya categoría exista actualmente en la BD
    if (!validSlugs.has(p.category)) return;
    const label = catLabel(p.category);
    catTotals[label] = (catTotals[label] || 0) + (Number(p.price) || 0) * (Math.floor(Math.random() * 20) + 5);
  });
  const labels = Object.keys(catTotals);
  const data   = Object.values(catTotals);
  const colors = ['#1a7c3e','#27a35a','#1565c0','#f57c00','#e53935','#6a1b9a','#00838f','#f9a825'];

  // El canvas ya es visible en el DOM (el skeleton lo tapa con z-index).
  // Solo necesitamos destruir chart anterior y crear uno nuevo.
  if (salesChartInstance) {
    salesChartInstance.destroy();
    salesChartInstance = null;
  }

  // ── Crear chart ──────────────────────────────────────────────────────────────
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;

  salesChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1100,
        easing: 'easeInOutQuart',
        animateRotate: true,   // gira desde 0° hasta el valor real
        animateScale: true,    // escala desde el centro
        onComplete: () => {
          const sk = document.getElementById('salesChartSkeleton');
          if (sk) {
            sk.style.transition = 'opacity .35s';
            sk.style.opacity = '0';
            setTimeout(() => { if (sk && sk.parentNode) sk.remove(); }, 380);
          }
        }
      },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { family: 'Inter', size: 11 },
            padding: 12,
            boxWidth: 12
          }
        },
        tooltip: {
          callbacks: { label: c => ` RD$ ${fmt$(c.parsed)}` }
        }
      }
    }
  });
}

// ─── PRODUCTOS TABLE ──────────────────────────────────────────────────────────
// ─── ORDENAMIENTO DE TABLA DE PRODUCTOS ──────────────────────────────────────
let _prodSortField = null;   // campo activo: 'name' | 'category' | 'price' | 'stock'
let _prodSortDir   = 'asc';  // 'asc' | 'desc'

function sortProductsBy(field) {
  if (_prodSortField === field) {
    // Mismo campo → invertir dirección
    _prodSortDir = _prodSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    // Campo nuevo → ascendente por defecto
    _prodSortField = field;
    _prodSortDir   = 'asc';
  }
  // Actualizar íconos en los headers
  ['name','category','price','stock'].forEach(f => {
    const icon = document.getElementById(`sort-icon-${f}`);
    const th   = icon?.closest('th');
    if (!icon) return;
    if (f === _prodSortField) {
      icon.textContent = _prodSortDir === 'asc' ? '↑' : '↓';
      th?.classList.add('sort-active');
    } else {
      icon.textContent = '⇅';
      th?.classList.remove('sort-active');
    }
  });
  _pages.products = 1;
  renderProductsTable();
}

function renderProductsTable() {
  const q       = (document.getElementById('prodSearch')?.value || '').toLowerCase();
  const cat     = document.getElementById('prodCatFilter')?.value || '';
  const badge   = document.getElementById('prodBadgeFilter')?.value || '';

  const filtered = adminProducts
    .filter(p => {
      if (!p || !p.name) return false;
      const matchQ = !q || (p.name || '').toLowerCase().includes(q)
                        || (p.description || '').toLowerCase().includes(q)
                        || (p.barcode || '').toString().toLowerCase().includes(q);
      const matchC = !cat   || p.category === cat;
      const matchB = !badge || p.badge    === badge;
      return matchQ && matchC && matchB;
    })
    // Ordenamiento por columna clicada, o por defecto más reciente primero
    .sort((a, b) => {
      if (_prodSortField) {
        let va = a[_prodSortField], vb = b[_prodSortField];
        // Normalizar para comparación
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        va = va ?? '';
        vb = vb ?? '';
        if (va < vb) return _prodSortDir === 'asc' ? -1 :  1;
        if (va > vb) return _prodSortDir === 'asc' ?  1 : -1;
        return 0;
      }
      // Sin orden activo → más reciente primero
      return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
    });

  const total = filtered.length;
  const pg    = _pages.products;
  const start = (pg - 1) * PAGE_SIZE;
  const list  = filtered.slice(start, start + PAGE_SIZE);
  const from  = total === 0 ? 0 : start + 1;
  const to    = Math.min(start + PAGE_SIZE, total);

  document.getElementById('prodCount').textContent =
    total === 0 ? 'Sin resultados' : `${from}–${to} de ${total} producto${total !== 1 ? 's' : ''}`;

  const canEdit   = !currentSession || getRole(currentSession.role).canCreateProducts;
  const canDelete = !currentSession || getRole(currentSession.role).canDeleteProducts;
  const tbody     = document.getElementById('productsTbody');

  // ── Limpiar y renderizar solo la página actual ──────────────────────────
  tbody.innerHTML = '';

  // 2) Insertar cada fila de la página
  list.forEach(p => {
    const discount   = p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : null;
    const stockClass = p.stock === 0 ? 'stock-zero' : p.stock < 20 ? 'stock-low' : 'stock-ok';
    const badgeHTML  = p.badge
      ? `<span class="badge-pill badge-${p.badge}">${p.badge==='offer'?'Oferta':p.badge==='new'?'Nuevo':'Favorito'}</span>`
      : `<span class="badge-pill badge-none">—</span>`;

    const tr = document.createElement('tr');
    tr.dataset.pid = p.id;
    tr.innerHTML = `
      <td><img src="${p.image}" alt="${p.name}" class="td-img" onerror="this.src='images/logo-casamota.png'" /></td>
      <td>${p.name}</td>
      <td><span class="td-cat">${catLabel(p.category)}</span></td>
      <td><strong>RD$ ${fmt$(p.price)}</strong>${p.originalPrice ? `<br><small style="text-decoration:line-through;color:#aaa">RD$ ${fmt$(p.originalPrice)}</small>` : ''}</td>
      <td><span class="${stockClass}">${p.stock}</span></td>
      <td>${p.unit ? `<span class="td-unit-pill">${p.unit}</span>` : `<span style="color:#ddd;font-size:.78rem">—</span>`}</td>
      <td>${badgeHTML}</td>
      <td><span class="vp-stars">${renderStars(p.rating)}</span></td>
      <td>${p.barcode ? `<span style="font-family:monospace;font-size:.8rem;background:#f4f4f4;padding:2px 6px;border-radius:4px;letter-spacing:.04em"><i class="fas fa-barcode" style="color:#666;margin-right:3px"></i>${p.barcode}</span>` : `<span style="color:#ddd;font-size:.78rem">—</span>`}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn action-btn-view" onclick="viewProduct('${p.id}')" title="Ver artículo"><i class="fas fa-eye"></i></button>
          ${canEdit   ? `<button class="action-btn action-btn-edit" onclick="openProductModal('${p.id}')" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
          ${canDelete ? `<button class="action-btn action-btn-del"  onclick="deleteProduct('${p.id}')"  title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
          ${!canEdit && !canDelete ? '<span style="color:#bbb;font-size:.78rem">Sin permiso</span>' : ''}
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  _renderPaginator('prodPaginator', pg, total, 'products', 'productsTable');
}

// ─── MODAL PRODUCTO ───────────────────────────────────────────────────────────
function openProductModal(id = null) {
  editingProductId = id;
  const modal = document.getElementById('prodModalBackdrop');
  document.getElementById('prodModalTitle').textContent = id ? 'Editar Producto' : 'Nuevo Producto';

  if (id) {
    const p = adminProducts.find(x => String(x.id) === String(id));
    if (!p) return;
    document.getElementById('pName').value          = p.name;
    document.getElementById('pCategory').value      = p.category;
    document.getElementById('pPrice').value         = p.price;
    document.getElementById('pOriginalPrice').value = p.originalPrice || '';
    document.getElementById('pUnit').value          = p.unit;
    document.getElementById('pStock').value         = p.stock;
    document.getElementById('pBadge').value         = p.badge || '';
    document.getElementById('pRating').value        = p.rating;
    document.getElementById('pDescription').value   = p.description;
    document.getElementById('pImage').value         = p.image;
    document.getElementById('pBarcode').value       = p.barcode || '';
    _checkBarcodeUnique(p.barcode || '', p.id);
    // Mostrar preview de la imagen existente
    resetImgUpload();
    if (p.image) setImgPreview(p.image, '✅ Imagen actual del producto');
    // Cargar imágenes adicionales
    _loadExtraImages(Array.isArray(p.images) ? p.images : []);
  } else {
    ['pName','pPrice','pOriginalPrice','pUnit','pStock','pRating','pDescription','pImage','pBarcode']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('pCategory').value = '';
    document.getElementById('pBadge').value    = '';
    _loadExtraImages([]);
    const bcStatus = document.getElementById('pBarcodeStatus');
    if (bcStatus) bcStatus.textContent = '';
    resetImgUpload();
  }
  modal.classList.remove('hidden');
  // Siempre mostrar el scroll desde arriba al abrir el modal
  const modalBody = document.querySelector('#prodModal .modal-body');
  if (modalBody) {
    modalBody.scrollTop = 0;
    requestAnimationFrame(() => { modalBody.scrollTop = 0; });
  }
}

function closeProductModal() {
  // Si hay un guardado en curso, NO cerrar el modal — esperar a que termine
  // Esto evita que el usuario cancele mientras el POST ya fue enviado al servidor
  if (_savingProduct) {
    showAdminToast('⏳ Guardando producto, espera un momento…', 'info');
    return;
  }
  document.getElementById('prodModalBackdrop').classList.add('hidden');
  editingProductId = null;
  // Resetear flag de guardado y restaurar botón
  _savingProduct = false;
  const saveBtn = document.querySelector('[onclick="saveProduct()"]');
  if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Guardar producto'; }
  // Limpiar preview de imagen
  resetImgUpload();
}

// ─── VISTA PREVIA DEL ARTÍCULO ────────────────────────────────────────────────

function viewProduct(id) {
  const p = adminProducts.find(x => String(x.id) === String(id));
  if (!p) return;

  const modal = document.getElementById('viewProductBackdrop');
  if (!modal) return;

  // ── Construir lista de todas las imágenes ──────────────────────────────────
  const allImgs = [p.image, ...(Array.isArray(p.images) ? p.images : [])]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);   // deduplicar

  // ── Carrusel en vp-img-wrap ────────────────────────────────────────────────
  const wrap = document.getElementById('vpImgWrap');
  if (wrap) {
    // Badge (siempre fuera del carrusel para que no se mueva)
    const badgeEl = document.getElementById('vpBadge');

    if (allImgs.length <= 1) {
      // ── Una sola imagen: simple, sin controles ──
      wrap.innerHTML = `
        <img id="vpImage" src="${allImgs[0] || 'images/logo-casamota.png'}"
             alt="${p.name}"
             style="width:100%;height:100%;object-fit:contain;padding:16px;display:block;cursor:zoom-in"
             onclick="_vpLightboxFromCarousel()"
             onerror="this.src='images/logo-casamota.png'" />`;
    } else {
      // ── Múltiples imágenes: carrusel físico ────
      const slides = allImgs.map((url, i) => `
        <div class="vp-car-slide" data-idx="${i}" onclick="if(!_vpDragged)_vpLightboxFromCarousel()">
          <img src="${url}" alt="${p.name} ${i+1}"
               onerror="this.src='images/logo-casamota.png'" />
        </div>`).join('');

      const dots = allImgs.map((_, i) =>
        `<button class="vp-car-dot${i===0?' vp-car-dot--active':''}" data-idx="${i}" onclick="_vpCarGo(${i})" aria-label="Imagen ${i+1}"></button>`
      ).join('');

      // Todos los controles van DENTRO del viewport — igual que en la tienda
      wrap.innerHTML = `
        <div class="vp-car-viewport" id="vpCarViewport">
          <div class="vp-car-strip" id="vpCarStrip">${slides}</div>
          <button class="vp-car-arrow vp-car-arrow--prev" onclick="_vpCarGo(_vpCarIdx-1)" aria-label="Anterior">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button class="vp-car-arrow vp-car-arrow--next" onclick="_vpCarGo(_vpCarIdx+1)" aria-label="Siguiente">
            <i class="fas fa-chevron-right"></i>
          </button>
          <div class="vp-car-dots" id="vpCarDots">${dots}</div>
          <div class="vp-car-counter" id="vpCarCounter">1 / ${allImgs.length}</div>
        </div>`;

      // Inicializar estado y touch del carrusel VP
      _vpCarIdx   = 0;
      _vpCarTotal = allImgs.length;
      requestAnimationFrame(() => _vpCarInit());
    }

    // Re-insertar badge (se borró con innerHTML)
    if (badgeEl) {
      wrap.appendChild(badgeEl);
      if (p.badge) {
        const badgeLabel = p.badge === 'offer'
          ? 'Oferta'
          : p.badge === 'new' ? 'Nuevo' : 'Favorito';
        // Colores por tipo de badge (inline para evitar conflictos con caché CSS)
        const badgeColors = {
          offer: { bg: '#ffebee', color: '#c62828' },
          new:   { bg: '#e8f5e9', color: '#2e7d32' },
          best:  { bg: '#fff3e0', color: '#e65100' }
        };
        const bc = badgeColors[p.badge] || { bg: '#f5f5f5', color: '#333' };
        badgeEl.textContent        = badgeLabel;
        badgeEl.className          = 'vp-badge';
        badgeEl.style.display      = '';
        badgeEl.style.background   = bc.bg;
        badgeEl.style.color        = bc.color;
      } else {
        badgeEl.style.display      = 'none';
        badgeEl.style.background   = '';
        badgeEl.style.color        = '';
      }
    }
  }

  // ── Datos del producto ─────────────────────────────────────────────────────
  document.getElementById('vpName').textContent     = p.name || '—';
  document.getElementById('vpCategory').textContent = catLabel(p.category) || p.category || '—';

  const priceEl = document.getElementById('vpPrice');
  const origEl  = document.getElementById('vpOriginalPrice');
  if (priceEl) priceEl.textContent = p.price ? `RD$ ${fmt$(p.price)}` : '—';
  if (origEl) {
    if (p.originalPrice && Number(p.originalPrice) > Number(p.price)) {
      origEl.textContent   = `RD$ ${fmt$(p.originalPrice)}`;
      origEl.style.display = '';
    } else {
      origEl.style.display = 'none';
    }
  }

  const discountEl = document.getElementById('vpDiscount');
  if (discountEl) {
    if (p.originalPrice && Number(p.originalPrice) > Number(p.price)) {
      const pct = Math.round((1 - p.price / p.originalPrice) * 100);
      discountEl.textContent   = `-${pct}%`;
      discountEl.style.display = '';
    } else {
      discountEl.style.display = 'none';
    }
  }

  const stockEl = document.getElementById('vpStock');
  if (stockEl) {
    const s = Number(p.stock);
    stockEl.textContent = s > 0 ? `${s} en stock` : 'Sin stock';
    stockEl.className   = 'vp-stock-badge ' + (s > 10 ? 'stock-ok' : s > 0 ? 'stock-low' : 'stock-out');
  }

  const unitEl = document.getElementById('vpUnit');
  if (unitEl) unitEl.textContent = p.unit ? `Unidad: ${p.unit}` : '';

  const ratingEl = document.getElementById('vpRating');
  if (ratingEl) ratingEl.innerHTML = `<span class="vp-stars">${renderStars(Number(p.rating)||0)}</span>`;

  const descEl = document.getElementById('vpDescription');
  if (descEl) descEl.textContent = p.description || 'Sin descripción.';

  const bcEl = document.getElementById('vpBarcode');
  if (bcEl) {
    bcEl.textContent   = p.barcode ? `${p.barcode}` : 'Sin código asignado';
    bcEl.style.opacity = p.barcode ? '1' : '0.45';
  }

  const editBtn = document.getElementById('vpEditBtn');
  if (editBtn) editBtn.onclick = () => { closeViewProduct(); openProductModal(p.id); };

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// ─── CARRUSEL DE VISTA PREVIA ADMIN ──────────────────────────────────────────
let _vpCarIdx   = 0;
let _vpCarTotal = 0;
let _vpDragX    = null;
let _vpDragged  = false;

function _vpCarInit() {
  const strip    = document.getElementById('vpCarStrip');
  const viewport = document.getElementById('vpCarViewport');
  if (!strip || !viewport) return;

  const W = viewport.offsetWidth || 300;
  strip.style.width = `${W * _vpCarTotal}px`;
  strip.querySelectorAll('.vp-car-slide').forEach(s => { s.style.width = W + 'px'; });
  _vpCarSnap(false);

  // Touch
  viewport.addEventListener('touchstart', e => {
    _vpDragX   = e.touches[0].clientX;
    _vpDragged = false;
  }, { passive: true });
  viewport.addEventListener('touchmove', e => {
    if (_vpDragX === null) return;
    if (Math.abs(e.touches[0].clientX - _vpDragX) > 8) _vpDragged = true;
  }, { passive: true });
  viewport.addEventListener('touchend', e => {
    if (_vpDragX === null) return;
    const dx = e.changedTouches[0].clientX - _vpDragX;
    if (Math.abs(dx) > 40) _vpCarGo(_vpCarIdx + (dx < 0 ? 1 : -1));
    _vpDragX = null;
  });

  // Mouse drag (desktop)
  let _mX = null;
  viewport.addEventListener('mousedown', e => { _mX = e.clientX; _vpDragged = false; });
  viewport.addEventListener('mousemove', e => { if (_mX !== null && Math.abs(e.clientX - _mX) > 8) _vpDragged = true; });
  viewport.addEventListener('mouseup',   e => {
    if (_mX === null) return;
    const dx = e.clientX - _mX;
    if (Math.abs(dx) > 40) _vpCarGo(_vpCarIdx + (dx < 0 ? 1 : -1));
    _mX = null;
  });
}

function _vpCarGo(idx) {
  _vpCarIdx = Math.max(0, Math.min(idx, _vpCarTotal - 1));
  _vpCarSnap(true);
  _vpCarUpdateUI();
}

function _vpCarSnap(animate) {
  const strip    = document.getElementById('vpCarStrip');
  const viewport = document.getElementById('vpCarViewport');
  if (!strip || !viewport) return;
  const W = viewport.offsetWidth || 300;
  strip.style.transition = animate ? 'transform .35s cubic-bezier(.25,.46,.45,.94)' : 'none';
  strip.style.transform  = `translateX(${-_vpCarIdx * W}px)`;
}

function _vpCarUpdateUI() {
  // Contador
  const counter = document.getElementById('vpCarCounter');
  if (counter) counter.textContent = `${_vpCarIdx + 1} / ${_vpCarTotal}`;
  // Dots
  document.querySelectorAll('#vpCarDots .vp-car-dot').forEach((d, i) => {
    d.classList.toggle('vp-car-dot--active', i === _vpCarIdx);
  });
}

function closeViewProduct() {
  const modal = document.getElementById('viewProductBackdrop');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── LIGHTBOX — Visor de imagen ampliada (admin viewProduct) ─────────────────
// Igual al de la tienda: pinch-to-zoom, doble toque zoom×2.5, arrastre, rueda
(function() {
  let _scale     = 1;
  let _posX      = 0;
  let _posY      = 0;
  let _lastDist  = 0;
  let _lastTap   = 0;
  let _dragStart = null;
  let _hintTimer = null;

  function _getDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _applyTransform(img) {
    img.style.transform = `translate(${_posX}px,${_posY}px) scale(${_scale})`;
  }

  function _reset(img) {
    _scale = 1; _posX = 0; _posY = 0;
    img.style.transition = 'transform .3s ease';
    _applyTransform(img);
    setTimeout(() => { if (img) img.style.transition = ''; }, 300);
  }

  function _bindGestures(img) {
    if (img._vpLbBound) return;
    img._vpLbBound = true;

    // ── Touch: pinch-zoom + doble toque + arrastre ──────────────────────────
    img.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        _lastDist = _getDist(e.touches);
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - _lastTap < 300) {
          e.preventDefault();
          if (_scale > 1) {
            _reset(img);
          } else {
            _scale = 2.5; _posX = 0; _posY = 0;
            img.style.transition = 'transform .3s ease';
            _applyTransform(img);
            setTimeout(() => { img.style.transition = ''; }, 300);
          }
          _lastTap = 0;
        } else {
          _lastTap = now;
          _dragStart = { x: e.touches[0].clientX - _posX, y: e.touches[0].clientY - _posY };
        }
      }
    }, { passive: false });

    img.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dist = _getDist(e.touches);
        const delta = dist / _lastDist;
        _lastDist = dist;
        _scale = Math.min(5, Math.max(1, _scale * delta));
        _applyTransform(img);
      } else if (e.touches.length === 1 && _scale > 1 && _dragStart) {
        _posX = e.touches[0].clientX - _dragStart.x;
        _posY = e.touches[0].clientY - _dragStart.y;
        _applyTransform(img);
      }
    }, { passive: false });

    img.addEventListener('touchend', () => {
      _dragStart = null;
      if (_scale <= 1) { _scale = 1; _posX = 0; _posY = 0; _applyTransform(img); }
    });

    // ── Rueda del ratón (desktop) ───────────────────────────────────────────
    img.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.85 : 1.15;
      _scale = Math.min(5, Math.max(1, _scale * delta));
      _applyTransform(img);
    }, { passive: false });
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  window._vpOpenLightbox = function(src, alt) {
    const lb  = document.getElementById('vpLightbox');
    const img = document.getElementById('vpLbImg');
    if (!lb || !img) return;

    // Reset zoom
    _scale = 1; _posX = 0; _posY = 0;
    img.style.transform  = '';
    img.style.transition = '';

    img.src = src || '';
    img.alt = alt  || '';
    lb.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Vincular gestos (solo la primera vez por elemento)
    _bindGestures(img);

    // Cerrar con Escape
    document._vpLbKey = e => { if (e.key === 'Escape') window._vpCloseLightbox(); };
    document.addEventListener('keydown', document._vpLbKey);

    // Hint — desvanece a los 2.5s
    const hint = document.getElementById('vpLbHint');
    if (hint) {
      hint.style.opacity = '1';
      clearTimeout(_hintTimer);
      _hintTimer = setTimeout(() => { if (hint) hint.style.opacity = '0'; }, 2500);
    }
  };

  window._vpCloseLightbox = function() {
    const lb  = document.getElementById('vpLightbox');
    const img = document.getElementById('vpLbImg');
    if (lb)  lb.style.display = 'none';
    if (img) { _scale = 1; _posX = 0; _posY = 0; img.style.transform = ''; }
    // Restaurar scroll solo si el modal viewProduct sigue abierto
    const vpModal = document.getElementById('viewProductBackdrop');
    if (!vpModal || vpModal.classList.contains('hidden')) {
      document.body.style.overflow = '';
    }
    if (document._vpLbKey) {
      document.removeEventListener('keydown', document._vpLbKey);
      document._vpLbKey = null;
    }
  };
})();

/** Abre el lightbox con la imagen del slide activo (carrusel) o imagen simple */
function _vpLightboxFromCarousel() {
  // Caso 1: imagen simple (sin carrusel)
  const simpleImg = document.querySelector('#vpImgWrap > img');
  if (simpleImg) {
    window._vpOpenLightbox(simpleImg.src, simpleImg.alt);
    return;
  }
  // Caso 2: carrusel — usar slide activo
  const slides = document.querySelectorAll('.vp-car-slide');
  if (slides.length > 0) {
    const slide = slides[_vpCarIdx] || slides[0];
    const img   = slide.querySelector('img');
    if (img) window._vpOpenLightbox(img.src, img.alt);
  }
}

// ─── Helpers de carga de imagen en modal producto ─────────────────────────────
// ── GALERÍA DE IMÁGENES ADICIONALES ─────────────────────────────────────────

// Array temporal con las URLs extra mientras el modal está abierto
let _extraImages = [];

/**
 * Renderiza la cuadrícula de imágenes adicionales en el modal.
 */
function _renderExtraImagesGrid() {
  const grid = document.getElementById('extraImagesGrid');
  const btn  = document.getElementById('btnAddExtraImg');
  if (!grid) return;

  grid.innerHTML = _extraImages.map((url, i) => `
    <div style="position:relative;border:2px solid #e5e7eb;border-radius:10px;overflow:hidden;aspect-ratio:1;background:#f9fafb">
      <img src="${url}" alt="Foto ${i+2}"
           style="width:100%;height:100%;object-fit:contain;padding:4px"
           onerror="this.src='images/logo-casamota.png'" />
      <button type="button" onclick="_removeExtraImage(${i})"
              title="Eliminar"
              style="position:absolute;top:3px;right:3px;background:rgba(229,57,53,.9);color:#fff;
                     border:none;border-radius:50%;width:20px;height:20px;font-size:.65rem;
                     cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">
        <i class="fas fa-times"></i>
      </button>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.45);color:#fff;
                  font-size:.6rem;text-align:center;padding:2px 0">Foto ${i+2}</div>
    </div>`).join('');

  // Ocultar botón si ya hay 4 imágenes extra
  if (btn) btn.style.display = _extraImages.length >= 4 ? 'none' : 'inline-flex';
}

/** Carga imágenes adicionales al abrir modal en modo edición */
function _loadExtraImages(arr) {
  _extraImages = arr.slice(0, 4);
  _renderExtraImagesGrid();
}

/** Agrega un slot nuevo — abre file picker o muestra input URL */
function addExtraImageSlot() {
  if (_extraImages.length >= 4) return;
  // Mostramos un pequeño dialog inline
  const url = prompt('Pega la URL de la imagen adicional (o deja vacío para subir desde tu equipo):');
  if (url === null) return; // cancelado
  if (url.trim()) {
    _extraImages.push(url.trim());
    _renderExtraImagesGrid();
  } else {
    // Abrir file picker
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const b64 = await _compressImage(file, 400);
        _extraImages.push(b64);
        _renderExtraImagesGrid();
      } catch { showAdminToast('Error al cargar la imagen', 'error'); }
    };
    inp.click();
  }
}

/** Elimina una imagen extra por índice */
function _removeExtraImage(idx) {
  _extraImages.splice(idx, 1);
  _renderExtraImagesGrid();
}

function resetImgUpload() {
  const zone        = document.getElementById('imgUploadZone');
  const placeholder = document.getElementById('imgUploadPlaceholder');
  const preview     = document.getElementById('imgPreview');
  const status      = document.getElementById('imgUploadStatus');
  const fileInput   = document.getElementById('pImageFile');
  const clearBtn    = document.getElementById('btnClearImage');
  if (zone)        zone.classList.remove('drag-over');
  if (placeholder) placeholder.style.display = 'flex';
  if (preview)     { preview.style.display = 'none'; preview.src = ''; }
  if (status)      status.textContent = '';
  if (fileInput)   fileInput.value = '';
  if (clearBtn)    clearBtn.style.display = 'none';
}

function setImgPreview(src, label) {
  const placeholder = document.getElementById('imgUploadPlaceholder');
  const preview     = document.getElementById('imgPreview');
  const status      = document.getElementById('imgUploadStatus');
  const clearBtn    = document.getElementById('btnClearImage');
  if (placeholder) placeholder.style.display = 'none';
  if (preview)     { preview.src = src; preview.style.display = 'block'; }
  if (status)      status.textContent = label || '';
  if (clearBtn)    { clearBtn.style.display = 'flex'; }
}

/**
 * Comprime una imagen usando canvas y devuelve un base64 JPEG ≤ maxKB KB.
 * Reduce primero las dimensiones (máx. 600px) y luego la calidad JPEG.
 */
function _compressImage(file, maxKB = 180) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function(e) {
      const img = new Image();
      img.onerror = reject;
      img.onload = function() {
        // Tamaño máximo 600×600 px
        const MAX_DIM = 600;
        let w = img.width, h = img.height;
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
          else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Reducir calidad hasta que el base64 quepa en maxKB
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxKB * 1024 * 1.37 && quality > 0.25) {
          quality -= 0.08;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Cargar imagen desde archivo local → comprimir → preview
function handleImgFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showAdminToast('Solo se aceptan archivos de imagen.', 'error'); return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showAdminToast('La imagen supera los 10 MB. Elige un archivo más pequeño.', 'error');
    return;
  }
  const status = document.getElementById('imgUploadStatus');
  if (status) status.textContent = '⏳ Comprimiendo imagen…';

  _compressImage(file, 180)
    .then(base64 => {
      document.getElementById('pImage').value = base64;
      const sizeKB = Math.round(base64.length * 0.75 / 1024);
      setImgPreview(base64, `✅ ${file.name} · ${sizeKB} KB (comprimida)`);
    })
    .catch(() => {
      // Fallback: leer sin comprimir si canvas falla
      const reader = new FileReader();
      reader.onload = function(ev) {
        document.getElementById('pImage').value = ev.target.result;
        setImgPreview(ev.target.result, `✅ ${file.name} (sin comprimir)`);
      };
      reader.readAsDataURL(file);
    });
}

// Drag & drop sobre la zona
function handleImgDrop(e) {
  e.preventDefault();
  document.getElementById('imgUploadZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) {
    showAdminToast('Solo se aceptan archivos de imagen.', 'error'); return;
  }
  // Comprimir directamente sin pasar por el input file
  const status = document.getElementById('imgUploadStatus');
  if (status) status.textContent = '⏳ Comprimiendo imagen…';
  _compressImage(file, 180)
    .then(base64 => {
      document.getElementById('pImage').value = base64;
      const sizeKB = Math.round(base64.length * 0.75 / 1024);
      setImgPreview(base64, `✅ ${file.name} · ${sizeKB} KB (comprimida)`);
    })
    .catch(() => showAdminToast('Error al procesar la imagen.', 'error'));
}

// Preview al escribir URL manualmente
function previewFromUrl(url) {
  const clearBtn = document.getElementById('btnClearImage');
  if (!url || url.length < 5) { resetImgUpload(); return; }
  const placeholder = document.getElementById('imgUploadPlaceholder');
  const preview     = document.getElementById('imgPreview');
  const status      = document.getElementById('imgUploadStatus');
  if (placeholder) placeholder.style.display = 'none';
  if (preview) {
    preview.style.display = 'block';
    preview.src = url;
    preview.onerror = () => {
      preview.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
      if (status)   status.textContent = '⚠️ No se pudo cargar la imagen desde esa URL';
      if (clearBtn) clearBtn.style.display = 'none';
    };
    preview.onload = () => {
      if (status)   status.textContent = '✅ Imagen cargada desde URL';
      if (clearBtn) clearBtn.style.display = 'flex';
    };
  }
}

// Eliminar imagen seleccionada y volver al estado vacío
function clearProductImage() {
  document.getElementById('pImage').value = '';
  resetImgUpload();
  showAdminToast('🗑️ Imagen eliminada', 'info');
}

// Convierte un error de API en un mensaje legible para el usuario
// (evita mostrar HTML de Cloudflare o mensajes técnicos crudos)
function _friendlyApiError(err) {
  if (!err) return 'Error desconocido';
  const msg = err.message || '';
  if (msg.includes('520') || msg.includes('521') || msg.includes('522') || msg.includes('524')) {
    return '⚠️ El servidor no respondió (error de red transitorio). Intenta de nuevo en unos segundos.';
  }
  if (msg.includes('502') || msg.includes('503') || msg.includes('504')) {
    return '⚠️ El servidor está ocupado. Intenta de nuevo en unos segundos.';
  }
  if (msg.includes('500')) {
    return '⚠️ Error interno del servidor (500). Verifica los datos e intenta de nuevo.';
  }
  if (msg.includes('AbortError') || msg.includes('abort')) {
    return '⚠️ La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.';
  }
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
    return '⚠️ Sin conexión a internet. Verifica tu red e intenta de nuevo.';
  }
  // Fallback: mostrar solo los primeros 80 caracteres (no HTML completo)
  return msg.replace(/<[^>]+>/g, '').substring(0, 80) || 'Error desconocido';
}

let _savingProduct = false; // evita doble envío al hacer clic repetido

function saveProduct() {
  // Bloquear si ya hay un guardado en curso
  if (_savingProduct) return;
  // Activar flag YA — antes de cualquier async — para que doble clic quede bloqueado
  _savingProduct = true;
  const saveBtn = document.querySelector('[onclick="saveProduct()"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }

  const _unlock = () => {
    _savingProduct = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Guardar producto'; }
  };

  // Validar permisos
  if (currentSession) {
    const role = getRole(currentSession.role);
    if (!role.canCreateProducts) { showAdminToast('No tienes permiso para crear o editar productos', 'error'); _unlock(); return; }
    if (!role.canEditPrices && !editingProductId) { showAdminToast('No tienes permiso para cambiar precios', 'error'); _unlock(); return; }
  }
  const name     = document.getElementById('pName').value.trim();
  const category = document.getElementById('pCategory').value.trim();
  const price    = parseFloat(document.getElementById('pPrice').value);
  const unit     = document.getElementById('pUnit').value.trim();
  const stock    = parseInt(document.getElementById('pStock').value);
  if (!name)     { showAdminToast('⚠️ El nombre es obligatorio', 'error'); document.getElementById('pName')?.focus(); _unlock(); return; }
  if (!category) { showAdminToast('⚠️ Debes seleccionar una categoría', 'error'); document.getElementById('pCategory')?.focus(); _unlock(); return; }
  if (isNaN(price) || price <= 0) { showAdminToast('⚠️ El precio debe ser mayor a 0', 'error'); document.getElementById('pPrice')?.focus(); _unlock(); return; }
  if (!unit)     { showAdminToast('⚠️ La unidad es obligatoria (ej: lb, unidad, litro…)', 'warn'); document.getElementById('pUnit')?.focus(); _unlock(); return; }
  if (isNaN(stock) || stock <= 0) { showAdminToast('⚠️ El stock debe ser mayor a 0', 'warn'); document.getElementById('pStock')?.focus(); _unlock(); return; }

  const barcodeVal   = document.getElementById('pBarcode').value.trim();
  const barcodeField = document.getElementById('pBarcode');

  // ── Helper: resaltar campo en rojo y hacer foco ──────────────────────────
  const _barcodeError = (msg) => {
    showAdminToast(msg, 'error');
    barcodeField?.focus();
    if (barcodeField) {
      barcodeField.style.borderColor = '#e53935';
      barcodeField.style.boxShadow   = '0 0 0 3px rgba(229,57,53,.18)';
      setTimeout(() => { barcodeField.style.borderColor = ''; barcodeField.style.boxShadow = ''; }, 3000);
    }
  };

  // 1) Obligatorio
  if (!barcodeVal) { _barcodeError('⚠️ El código de barras es obligatorio'); _unlock(); return; }

  // 2) Validar formato EAN / UPC (longitud + solo números + dígito verificador)
  const eanResult = _validateEAN(barcodeVal);
  if (!eanResult.valid) {
    _barcodeError(`⚠️ Código inválido: ${eanResult.error}`);
    _unlock(); return;
  }

  // 3) Verificar que no esté duplicado en otro producto
  const dup = adminProducts.find(p => p.barcode === barcodeVal && String(p.id) !== String(editingProductId));
  if (dup) { _barcodeError(`⚠️ Ese código ya está asignado a "${dup.name}"`); _unlock(); return; }

  const data = {
    name,
    category,
    price,
    originalPrice: parseFloat(document.getElementById('pOriginalPrice').value) || null,
    unit:          unit,
    stock:         stock,
    badge:         document.getElementById('pBadge').value || null,
    rating:        Math.min(5, Math.max(1, parseFloat(document.getElementById('pRating').value) || 4.5)),
    description:   document.getElementById('pDescription').value.trim(),
    image:         document.getElementById('pImage').value.trim() || 'images/logo-casamota.png',
    images:        _extraImages.length > 0 ? [..._extraImages] : [],
    barcode:       barcodeVal || null,
    reviews:       0,
    isNew:         false,
  };

  // ── El bloqueo y _unlock ya están definidos al inicio de la función ──────────

  if (editingProductId) {
    const idx = adminProducts.findIndex(p => String(p.id) === String(editingProductId));
    const updated = idx > -1 ? { ...adminProducts[idx], ...data } : { id: editingProductId, ...data };
    // Usar PATCH con solo los campos editados (data) → mucho más rápido que PUT completo
    DB.saveProduct(updated, data)
      .then(saved => {
        if (idx > -1) adminProducts[idx] = { ...updated, ...(saved || {}) };
        DBCached.invalidateProducts();
        _unlock();                    // ← desbloquear ANTES de cerrar el modal
        closeProductModal();
        showAdminToast('Producto actualizado ✅', 'success');
        requestAnimationFrame(() => {
          const sec = document.querySelector('.section-content.active')?.id;
          if (sec === 'sec-inventory') renderInventory();
          else renderProductsTable();
        });
      })
      .catch(err => {
        const msg = _friendlyApiError(err);
        showAdminToast('Error al guardar el producto: ' + msg, 'error');
        _unlock();
      });
  } else {
    // Limpiar payload antes de POST — la API de Genspark rechaza:
    //  - campos null/undefined
    //  - arrays vacíos (images:[])
    //  - isNew (no existe en schema de products)
    //  - reviews (lo generamos en 0 pero puede causar conflicto)
    const VALID_FIELDS = new Set(['name','category','price','originalPrice','unit','stock','badge','rating','description','image','images','barcode','isNew','reviews']);
    const newProd = Object.fromEntries(
      Object.entries(data)
        .filter(([k, v]) =>
          VALID_FIELDS.has(k) &&
          v !== null &&
          v !== undefined &&
          v !== '' &&
          !(Array.isArray(v) && v.length === 0)
        )
    );
    // ── POST: Genspark usa tables/, producción usa Supabase ──────────────
    if (typeof _IS_GENSPARK !== 'undefined' && _IS_GENSPARK) {
      // ── Genspark: fetch directo a tables/products ────────────────────────
      fetch('tables/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProd)
      })
        .then(async res => {
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`API error ${res.status}: ${txt}`);
          }
          return res.json();
        })
        .then(saved => {
          const finalProd = saved || newProd;
          if (!finalProd.created_at) finalProd.created_at = Date.now();
          adminProducts.push(finalProd);
          if (typeof _totalProductsInDB !== 'undefined') _totalProductsInDB = adminProducts.length;
          DBCached.invalidateProducts();
          _pages.products = 1;
          _unlock();
          closeProductModal();
          showAdminToast('Producto creado ✅', 'success');
          requestAnimationFrame(() => {
            const sec = document.querySelector('.section-content.active')?.id;
            if (sec === 'sec-inventory') renderInventory();
            else renderProductsTable();
          });
        })
        .catch(err => {
          console.error('Error al crear producto:', err);
          const msg = _friendlyApiError(err);
          showAdminToast('Error al crear el producto: ' + msg, 'error');
          _unlock();
        });
    } else {
      // ── Producción/Supabase: usar DB.saveProduct ─────────────────────────
      DB.saveProduct(newProd)
        .then(saved => {
          const finalProd = saved || newProd;
          if (!finalProd.created_at) finalProd.created_at = Date.now();
          adminProducts.unshift(finalProd);
          if (typeof _totalProductsInDB !== 'undefined') _totalProductsInDB = adminProducts.length;
          DBCached.invalidateProducts();
          _pages.products = 1;
          _unlock();
          closeProductModal();
          showAdminToast('Producto creado ✅', 'success');
          requestAnimationFrame(() => {
            const sec = document.querySelector('.section-content.active')?.id;
            if (sec === 'sec-inventory') renderInventory();
            else renderProductsTable();
          });
        })
        .catch(err => {
          console.error('Error al crear producto:', err);
          const msg = _friendlyApiError(err);
          showAdminToast('Error al crear el producto: ' + msg, 'error');
          _unlock();
        });
    }
  }
}

function deleteProduct(id) {
  if (currentSession && !getRole(currentSession.role).canDeleteProducts) {
    showAdminToast('No tienes permiso para eliminar productos', 'error'); return;
  }
  if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
  DB.deleteProduct(id)
    .then(() => {
      adminProducts = adminProducts.filter(p => String(p.id) !== String(id));
      // Actualizar el conteo total real para el KPI del dashboard
      if (typeof _totalProductsInDB !== 'undefined' && _totalProductsInDB > 0) _totalProductsInDB--;
      DBCached.invalidateProducts();
      renderProductsTable();
      renderInventory();
      showAdminToast('Producto eliminado', 'info');
    })
    .catch(() => showAdminToast('Error al eliminar el producto', 'error'));
}

// saveAdminProducts() ya no hace falta (sustituida por DB.saveProduct)
function saveAdminProducts() {
  // Deprecated: cada operación ahora llama directamente a DB.saveProduct/deleteProduct
}

// ─── PEDIDOS ──────────────────────────────────────────────────────────────────

/**
 * Actualiza SOLO la fila del pedido en la tabla de fondo (sin re-renderizar todo).
 * Se usa cuando el modal ya actualizó sus propios campos via DOM directo.
 */
function _patchOrderRow(orderId) {
  // Si el modal está abierto, NO tocar la tabla de fondo — causa reflow y mueve el modal.
  // La tabla se actualizará sola cuando se cierre el modal y se llame renderOrdersTable().
  const backdrop = document.getElementById('orderModalBackdrop');
  if (backdrop && !backdrop.classList.contains('hidden')) {
    updatePendingBadge();
    return;
  }

  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const tbody = document.getElementById('ordersTbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    const viewBtn = row.querySelector(`[onclick="openOrderModal('${orderId}')"]`);
    if (!viewBtn) return;
    const cells = row.querySelectorAll('td');
    if (cells[4]) cells[4].innerHTML = `<strong>RD$ ${fmt$(o.total)}</strong>`;
    if (cells[3]) cells[3].textContent = `${o.productLines ? o.productLines.length : o.items} productos`;
  });
  updatePendingBadge();
}

function renderOrdersTable() {
  const q      = (document.getElementById('orderSearch')?.value || '').toLowerCase();
  const status = document.getElementById('orderStatusFilter')?.value || '';

  let list = orders.filter(o => {
    const matchQ = !q || o.customer.toLowerCase().includes(q) || String(o.id).includes(q) || o.email.toLowerCase().includes(q);
    const matchS = !status || o.status === status;
    return matchQ && matchS;
  });

  // Ordenar por fecha más reciente primero (formato DD/MM/YYYY HH:MM)
  list.sort((a, b) => {
    const parseDate = d => {
      if (!d) return 0;
      // Soporta "DD/MM/YYYY HH:MM" y timestamps numéricos
      if (typeof d === 'number') return d;
      const [datePart, timePart = '00:00'] = d.split(' ');
      const [dd, mm, yyyy] = datePart.split('/');
      const [hh, mi] = timePart.split(':');
      return new Date(yyyy, mm - 1, dd, hh, mi).getTime();
    };
    return parseDate(b.date) - parseDate(a.date); // más reciente primero
  });

  const total = list.length;
  const pg    = _pages.orders;
  const start = (pg - 1) * PAGE_SIZE;
  const page  = list.slice(start, start + PAGE_SIZE);
  const from  = total === 0 ? 0 : start + 1;
  const to    = Math.min(start + PAGE_SIZE, total);

  document.getElementById('orderCount').textContent =
    total === 0 ? 'Sin resultados' : `${from}–${to} de ${total} pedido${total !== 1 ? 's' : ''}`;

  document.getElementById('ordersTbody').innerHTML = page.map(o => {
    const sourceBadge = o.source === 'tienda'
      ? `<span style="font-size:.68rem;background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:4px"><i class="fas fa-store"></i> Tienda</span>`
      : '';
    return `
    <tr${o.source==='tienda' ? ' style="background:rgba(29,78,216,.03)"' : ''}>
      <td><strong>#${o.order_number || o.id}</strong>${sourceBadge}</td>
      <td>${o.customer}</td>
      <td>${o.email}</td>
      <td>${o.items} productos</td>
      <td><strong>RD$ ${fmt$(o.total)}</strong></td>
      <td><span class="status-pill status-${o.status}">${ucFirst(o.status)}</span></td>
      <td>${o.date}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn action-btn-view" onclick="openOrderModal('${o.id}')" title="Ver detalle"><i class="fas fa-eye"></i></button>
          <button class="action-btn" style="background:linear-gradient(135deg,#1565c0,#42a5f5);color:#fff" onclick="printOrderPDF('${o.id}')" title="Imprimir PDF"><i class="fas fa-file-pdf"></i></button>
          <button class="action-btn action-btn-del"  onclick="deleteOrder('${o.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  _renderPaginator('ordersPaginator', pg, total, 'orders', 'ordersTable');
}

function openOrderModal(id) {
  const o = orders.find(x => String(x.id) === String(id));
  if (!o) return;
  editingOrderId = id;
  document.getElementById('orderModalTitle').textContent = `Pedido #${o.order_number || o.id} — ${o.customer}`;

  _renderOrderModalProducts(o);

  document.getElementById('orderModalBackdrop').classList.remove('hidden');
  // Bloquear scroll del body para evitar reflow que resetea el scroll del modal
  document.body.style.overflow = 'hidden';
}

// ── Renderiza (o re-renderiza) la sección de productos + resto del modal ──────
function _renderOrderModalProducts(o) {
  const isPending = o.status === 'pendiente';
  const lines     = o.productLines || [];
  const subtotal  = lines.reduce((s, l) => s + l.subtotal, 0);

  // ── Filas de productos ────────────────────────────────────────────────────
  const productRowsHTML = lines.length > 0
    ? lines.map((l, idx) => {
        const stockAvail = _getProductStock(l.productId);
        if (isPending) {
          // Fila editable: controles de cantidad + botón eliminar
          const hasSust   = 'sustitucion' in l;
          const sustBadge = !hasSust ? '' : l.sustitucion
            ? `<span class="sust-badge sust-badge--yes" title="Cliente autorizó sustituir"><i class="fas fa-shuffle"></i> Sustituible</span>`
            : `<span class="sust-badge sust-badge--no" title="No autorizado"><i class="fas fa-ban"></i> No sustituir</span>`;
          return `
            <tr class="order-prod-row" id="opr-${idx}">
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <img src="${l.image}" alt="${l.name}"
                       onerror="this.src='images/logo-casamota.png'"
                       style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid #eee;flex-shrink:0" />
                  <div>
                    <div style="font-weight:600;font-size:.9rem">${l.name}</div>
                    <div style="font-size:.75rem;color:#888;text-transform:capitalize">${catLabel(l.category)} · ${l.unit}</div>
                    <div style="font-size:.7rem;color:#aaa;margin-top:2px">Stock disp.: <b>${stockAvail + l.cantidad}</b></div>
                    ${sustBadge ? `<div style="margin-top:4px">${sustBadge}</div>` : ''}
                  </div>
                </div>
              </td>
              <td style="text-align:center">
                <div class="opd-qty-ctrl">
                  <button class="opd-qty-btn" onclick="orderLineQty(${idx},-1)" title="Disminuir">
                    <i class="fas fa-minus"></i>
                  </button>
                  <input class="opd-qty-input" type="number" min="1" max="${stockAvail + l.cantidad}"
                         value="${l.cantidad}" id="opd-qty-${idx}"
                         onchange="orderLineQtySet(${idx}, this.value)"
                         onclick="this.select()" />
                  <button class="opd-qty-btn" onclick="orderLineQty(${idx},+1)" title="Aumentar">
                    <i class="fas fa-plus"></i>
                  </button>
                </div>
              </td>
              <td style="text-align:right;white-space:nowrap">
                RD$ ${fmt$(l.price)}
              </td>
              <td style="text-align:right;white-space:nowrap;font-weight:700;color:var(--green)" id="opd-sub-${idx}">
                RD$ ${fmt$(l.subtotal)}
              </td>
              <td style="text-align:center;width:44px">
                <button class="opd-del-btn" onclick="orderLineRemove(${idx})" title="Eliminar producto del pedido">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>`;
        } else {
          // Fila de sólo lectura (cualquier otro estado)
          const hasSustRO   = 'sustitucion' in l;
          const sustBadgeRO = !hasSustRO ? '' : l.sustitucion
            ? `<span class="sust-badge sust-badge--yes"><i class="fas fa-shuffle"></i> Sustituible</span>`
            : `<span class="sust-badge sust-badge--no"><i class="fas fa-ban"></i> No sustituir</span>`;
          return `
            <tr class="order-prod-row">
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <img src="${l.image}" alt="${l.name}"
                       onerror="this.src='images/logo-casamota.png'"
                       style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid #eee;flex-shrink:0" />
                  <div>
                    <div style="font-weight:600;font-size:.9rem">${l.name}</div>
                    <div style="font-size:.75rem;color:#888;text-transform:capitalize">${catLabel(l.category)} · ${l.unit}</div>
                    ${sustBadgeRO ? `<div style="margin-top:4px">${sustBadgeRO}</div>` : ''}
                  </div>
                </div>
              </td>
              <td style="text-align:center">
                <span class="order-qty-badge">${l.cantidad}</span>
              </td>
              <td style="text-align:right;white-space:nowrap">
                RD$ ${fmt$(l.price)}
              </td>
              <td style="text-align:right;white-space:nowrap;font-weight:700;color:var(--green)">
                RD$ ${fmt$(l.subtotal)}
              </td>
            </tr>`;
        }
      }).join('')
    : `<tr><td colspan="${isPending?5:4}" style="text-align:center;color:#aaa;padding:20px">Sin detalle de productos disponible</td></tr>`;

  // Banner de aviso editable
  const editBanner = isPending ? `
    <div class="opd-edit-banner">
      <i class="fas fa-pen-to-square"></i>
      <span>Pedido <b>pendiente</b> — puedes ajustar cantidades o eliminar productos. Los cambios afectan el inventario y el total del pedido.</span>
    </div>` : '';

  // Cabecera de tabla (columna extra de acciones si es editable)
  const thActions = isPending ? `<th style="width:44px"></th>` : '';

  document.getElementById('orderModalBody').innerHTML = `

    <!-- INFO DEL CLIENTE -->
    <div class="order-customer-banner">
      <div class="order-customer-avatar">${o.customer.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}</div>
      <div class="order-customer-info">
        <div class="order-customer-name">${o.customer}</div>
        <div class="order-customer-meta">
          <span><i class="fas fa-envelope"></i> ${o.email}</span>
          <span><i class="fas fa-phone"></i> ${o.phone}</span>
          <span><i class="fas fa-calendar"></i> ${o.date}</span>
        </div>
      </div>
      <span class="status-pill status-${o.status}" style="margin-left:auto;align-self:flex-start">${ucFirst(o.status)}</span>
    </div>

    <!-- DIRECCIÓN -->
    <div class="order-address-row">
      <i class="fas fa-location-dot"></i>
      ${(()=>{
        const cl   = customers.find(c=>c.id===o.clientId||c.email===o.email);
        const city = o.city || cl?.city || '';
        const addr = [o.address, city].filter(Boolean).join(', ') || 'Sin dirección registrada';
        const mapBtn = cl&&cl.mapLink ? `<a href="${cl.mapLink}" target="_blank" rel="noopener" class="btn-map-link" style="margin-left:auto;font-size:.75rem"><i class="fas fa-map-location-dot"></i> Ver en Maps</a>` : '';
        return `<span>${addr}</span>${mapBtn}`;
      })()}
    </div>

    <!-- BANNER EDICIÓN -->
    ${editBanner}

    <!-- TABLA DE PRODUCTOS -->
    <div class="order-products-section">
      <div class="order-section-title">
        <i class="fas fa-cart-shopping"></i>
        Productos del pedido
        <span class="order-items-count" id="opd-items-count">${lines.length} artículo${lines.length!==1?'s':''}</span>
      </div>
      <div class="order-products-table-wrap">
        <table class="order-products-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th style="text-align:center">Cant.</th>
              <th style="text-align:right">Precio unit.</th>
              <th style="text-align:right">Subtotal</th>
              ${thActions}
            </tr>
          </thead>
          <tbody id="opd-tbody">${productRowsHTML}</tbody>
        </table>
      </div>
      ${(()=>{
        const _sub  = lines.reduce((s,l) => s + (Number(l.subtotal)||(Number(l.price)*Number(l.cantidad||1))), 0);
        const _ship = Number(o.shipping || 0);
        const _desc = Number(o.descuento || 0);
        const _cup  = o.cuponUsado || '';
        return `
        <div class="opd-totals-box">
          <div class="opd-totals-row">
            <span>Subtotal:</span>
            <span>RD$ ${fmt$(_sub)}</span>
          </div>
          <div class="opd-totals-row">
            <span>Envío:</span>
            <span style="color:${_ship===0?'#1a7c3e':'#555'}">${_ship===0?'<strong>¡Gratis!</strong>':'RD$ '+fmt$(_ship)}</span>
          </div>
          ${_desc > 0 ? `
          <div class="opd-totals-row" style="color:#1a7c3e;font-weight:600">
            <span><i class="fas fa-tag"></i> Descuento${_cup ? ` (${_cup})` : ''}:</span>
            <span>- RD$ ${fmt$(_desc)}</span>
          </div>` : ''}
          <div class="opd-totals-row opd-totals-total">
            <span>Total del pedido:</span>
            <span id="opd-total-cell">RD$ ${fmt$(o.total)}</span>
          </div>
        </div>`;
      })()}
    </div>

    <!-- MÉTODO DE PAGO -->
    ${o.payMethodLabel ? `
    <div style="display:flex;align-items:center;gap:10px;background:#f0faf4;border:1px solid #b2dfcc;border-radius:10px;padding:10px 14px;margin-bottom:4px">
      <div style="width:36px;height:36px;border-radius:9px;background:#1a7c3e22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-${o.payMethod==='efectivo'?'money-bill-wave':o.payMethod&&o.payMethod.includes('tarjeta')?'credit-card':'building-columns'}" style="color:#1a7c3e;font-size:1rem"></i>
      </div>
      <div>
        <div style="font-size:.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.4px">Método de pago</div>
        <div style="font-size:.92rem;font-weight:700;color:#1a1a2e">${o.payMethodLabel}</div>
      </div>
    </div>` : ''}

    <!-- COMPROBANTE FISCAL -->
    ${o.fiscalSolicitado ? `
    <div style="display:flex;align-items:center;gap:10px;background:#fff8e1;border:1px solid #ffe082;border-radius:10px;padding:10px 14px;margin-bottom:4px">
      <div style="width:36px;height:36px;border-radius:9px;background:#fff3cd;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-file-invoice" style="color:#f9a825;font-size:1rem"></i>
      </div>
      <div>
        <div style="font-size:.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.4px">Comprobante Fiscal (NCF)</div>
        <div style="font-size:.92rem;font-weight:700;color:#1a1a2e">${o.fiscalNombre || '—'}</div>
        <div style="font-size:.82rem;color:#555">RNC / Cédula: <strong>${o.fiscalRNC || '—'}</strong></div>
      </div>
    </div>` : ''}

    <!-- CAMBIAR ESTADO -->
    <div class="order-status-section">
      <div class="order-section-title"><i class="fas fa-rotate"></i> Actualizar estado del pedido</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        <select class="form-input" id="orderStatusEdit" style="max-width:240px">
          <option value="pendiente"  ${o.status==='pendiente' ?'selected':''}>⏳ Pendiente</option>
          <option value="procesando" ${o.status==='procesando'?'selected':''}>⚙️ Procesando</option>
          <option value="enviado"    ${o.status==='enviado'   ?'selected':''}>🚚 Enviado</option>
          <option value="entregado"  ${o.status==='entregado' ?'selected':''}>✅ Entregado</option>
          <option value="cancelado"  ${o.status==='cancelado' ?'selected':''}>❌ Cancelado</option>
        </select>
        <div style="font-size:.8rem;color:#888">El cliente será notificado al cambiar el estado.</div>
      </div>
    </div>

    <!-- NOTAS INTERNAS -->
    <div class="form-group" style="margin-top:16px">
      <label style="font-size:.8rem;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.4px">
        <i class="fas fa-note-sticky"></i> Notas internas (opcional)
      </label>
      <textarea class="form-input form-textarea" id="orderNotes" rows="2"
                placeholder="Instrucciones de entrega, observaciones…"
                style="margin-top:6px">${o.notes || ''}</textarea>
    </div>`;
}

// ── Helper: stock actual de un producto en adminProducts (en memoria) ─────────
function _getProductStock(productId) {
  const p = adminProducts.find(x => Number(x.id) === Number(productId));
  return p ? (p.stock || 0) : 0;
}

// ── Cambiar cantidad de una línea en el modal (botones +/−) ──────────────────
function orderLineQty(lineIdx, delta) {
  const o = orders.find(x => x.id === editingOrderId);
  if (!o || o.status !== 'pendiente') return;
  const line = o.productLines[lineIdx];
  if (!line) return;

  const newQty = line.cantidad + delta;

  if (newQty <= 0) {
    // Misma lógica que eliminar
    orderLineRemove(lineIdx);
    return;
  }

  // Validar stock disponible al aumentar
  if (delta > 0) {
    const stockAvail = _getProductStock(line.productId);
    if (stockAvail < 1) {
      showAdminToast(`Sin stock disponible para "${line.name}"`, 'warning');
      return;
    }
  }

  // Ajustar stock en cm_products
  _adjustOrderLineStock(line.productId, -delta); // -delta: si aumenta cantidad, descuenta stock

  // Actualizar línea
  line.cantidad = newQty;
  line.subtotal = parseFloat((line.price * newQty).toFixed(2));

  // Recalcular total del pedido
  o.total = parseFloat(o.productLines.reduce((s, l) => s + l.subtotal, 0).toFixed(2));

  // Guardar en API
  DB.updateOrder(o.id, o).catch(e => console.warn('Error guardando pedido:', e));
  DBCached.invalidateOrders();

  // Actualizar UI sin re-renderizar todo el modal
  const _mb1 = document.getElementById('orderModalBody');
  const _st1 = _mb1 ? _mb1.scrollTop : 0;
  const input = document.getElementById(`opd-qty-${lineIdx}`);
  const subEl = document.getElementById(`opd-sub-${lineIdx}`);
  const minBtn = document.querySelector(`#opr-${lineIdx} .opd-qty-btn`);
  if (input) input.value = newQty;
  if (subEl) subEl.textContent = `RD$ ${fmt$(line.subtotal)}`;
  if (minBtn) minBtn.innerHTML = `<i class="fas fa-minus"></i>`;
  const totalCell = document.getElementById('opd-total-cell');
  if (totalCell) totalCell.textContent = `RD$ ${fmt$(o.total)}`;
  if (_mb1) requestAnimationFrame(() => { _mb1.scrollTop = _st1; });

  _patchOrderRow(editingOrderId);
}

// ── Cambiar cantidad via input directo ────────────────────────────────────────
function orderLineQtySet(lineIdx, rawVal) {
  const o = orders.find(x => x.id === editingOrderId);
  if (!o || o.status !== 'pendiente') return;
  const line = o.productLines[lineIdx];
  if (!line) return;

  const newQty = Math.max(1, parseInt(rawVal, 10) || 1);
  const diff   = newQty - line.cantidad; // positivo = aumenta, negativo = disminuye

  if (diff === 0) return;

  // Validar stock al aumentar
  if (diff > 0) {
    const stockAvail = _getProductStock(line.productId);
    if (stockAvail < diff) {
      showAdminToast(`Stock insuficiente para "${line.name}" (disponible: ${stockAvail})`, 'warning');
      const input = document.getElementById(`opd-qty-${lineIdx}`);
      if (input) input.value = line.cantidad; // revertir
      return;
    }
  }

  _adjustOrderLineStock(line.productId, -diff);
  line.cantidad = newQty;
  line.subtotal = parseFloat((line.price * newQty).toFixed(2));
  o.total = parseFloat(o.productLines.reduce((s, l) => s + l.subtotal, 0).toFixed(2));
  DB.updateOrder(o.id, o).catch(e => console.warn('Error guardando pedido:', e));
  DBCached.invalidateOrders();

  const subEl   = document.getElementById(`opd-sub-${lineIdx}`);
  const minBtn  = document.querySelector(`#opr-${lineIdx} .opd-qty-btn`);
  const totalCell = document.getElementById('opd-total-cell');
  const _mb2 = document.getElementById('orderModalBody');
  const _st2 = _mb2 ? _mb2.scrollTop : 0;
  if (subEl)    subEl.textContent = `RD$ ${fmt$(line.subtotal)}`;
  if (minBtn)   minBtn.innerHTML  = `<i class="fas fa-minus"></i>`;
  if (totalCell) totalCell.textContent = `RD$ ${fmt$(o.total)}`;

  if (_mb2) requestAnimationFrame(() => { _mb2.scrollTop = _st2; });

  _patchOrderRow(editingOrderId);
}

// ── Eliminar una línea de producto del pedido ─────────────────────────────────
function orderLineRemove(lineIdx) {
  const o = orders.find(x => x.id === editingOrderId);
  if (!o || o.status !== 'pendiente') return;
  if (o.productLines.length <= 1) {
    showAdminToast('No puedes eliminar el único producto. Cancela el pedido si es necesario.', 'warning');
    return;
  }
  const line = o.productLines[lineIdx];
  if (!line) return;

  if (!confirm(`¿Eliminar "${line.name}" del pedido?`)) return;

  // Reponer stock del producto eliminado
  _adjustOrderLineStock(line.productId, line.cantidad); // devolver toda la cantidad al stock

  // Eliminar línea
  o.productLines.splice(lineIdx, 1);
  o.total = parseFloat(o.productLines.reduce((s, l) => s + l.subtotal, 0).toFixed(2));
  DB.updateOrder(o.id, o).catch(e => console.warn('Error guardando pedido:', e));
  DBCached.invalidateOrders();

  showAdminToast(`"${line.name}" eliminado del pedido. Stock repuesto.`, 'info');

  // Re-renderizar sólo la sección de productos del modal
  _renderOrderModalProducts(o);
  _patchOrderRow(editingOrderId); // actualiza solo la fila en la tabla de fondo
}

// ── Ajustar stock de un producto en la API (delta positivo = reponer) ────────
function _adjustOrderLineStock(productId, delta) {
  if (delta === 0) return;
  const p = adminProducts.find(x => Number(x.id) === Number(productId));
  if (p) {
    p.stock = Math.max(0, (p.stock || 0) + delta);
    _apiPatch('products', p.id, { stock: p.stock }).catch(() => {});
    DBCached.invalidateProducts();
  }
}

function closeOrderModal() {
  _savingOrderStatus = false;
  const prevId = editingOrderId;
  document.getElementById('orderModalBackdrop').classList.add('hidden');
  editingOrderId = null;
  document.body.style.overflow = '';
  // Ahora sí actualizamos la tabla de fondo sin interferir con el modal
  if (prevId) {
    const o = orders.find(x => x.id === prevId);
    if (o) {
      const tbody = document.getElementById('ordersTbody');
      if (tbody) {
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
          const viewBtn = row.querySelector(`[onclick="openOrderModal('${prevId}')"]`);
          if (!viewBtn) return;
          const cells = row.querySelectorAll('td');
          if (cells[4]) cells[4].innerHTML = `<strong>RD$ ${fmt$(o.total)}</strong>`;
          if (cells[3]) cells[3].textContent = `${o.productLines ? o.productLines.length : o.items} productos`;
        });
      }
    }
    updatePendingBadge();
  }
}

// ── Reposición de stock al cancelar/eliminar un pedido ───────────────────────
function restoreStock(order) {
  if (!order || !order.productLines || order.productLines.length === 0) return;
  let changed = false;
  order.productLines.forEach(line => {
    const prod = adminProducts.find(p => Number(p.id) === Number(line.productId));
    if (prod) {
      prod.stock = (prod.stock || 0) + (line.cantidad || 0);
      _apiPatch('products', prod.id, { stock: prod.stock }).catch(() => {});
      changed = true;
    }
  });
  if (changed) DBCached.invalidateProducts();
}

let _savingOrderStatus = false;
function saveOrderStatus() {
  if (_savingOrderStatus) return;
  if (!editingOrderId) return;
  _savingOrderStatus = true;
  const _btnOS = document.querySelector('#orderModalBackdrop .btn-primary[onclick="saveOrderStatus()"]');
  if (_btnOS) { _btnOS.disabled = true; _btnOS.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  const _unlockOS = () => {
    _savingOrderStatus = false;
    if (_btnOS) { _btnOS.disabled = false; _btnOS.innerHTML = '<i class="fas fa-save"></i> Actualizar estado'; }
  };
  const newStatus = document.getElementById('orderStatusEdit').value;
  const notes     = document.getElementById('orderNotes')?.value || '';
  const idx = orders.findIndex(o => o.id === editingOrderId);
  if (idx === -1) return;

  const order      = orders[idx];
  const prevStatus = order.status;

  // ── Lógica de stock ───────────────────────────────────────────────────────
  // Caso 1: se cancela un pedido que antes NO estaba cancelado → reponer stock
  if (newStatus === 'cancelado' && prevStatus !== 'cancelado') {
    restoreStock(order);
    showAdminToast('Stock repuesto al inventario por cancelación', 'info');
  }
  // Caso 2: se reactiva un pedido que estaba cancelado → descontar stock de nuevo
  if (prevStatus === 'cancelado' && newStatus !== 'cancelado') {
    (order.productLines || []).forEach(line => {
      const prod = adminProducts.find(p => Number(p.id) === Number(line.productId));
      if (prod) {
        prod.stock = Math.max(0, (prod.stock || 0) - (line.cantidad || 0));
        _apiPatch('products', prod.id, { stock: prod.stock }).catch(() => {});
      }
    });
    DBCached.invalidateProducts();
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Puntos de fidelización ────────────────────────────────────────────────
  // Caso A: pedido pasa a ENTREGADO → acumular puntos al cliente
  if (newStatus === 'entregado' && prevStatus !== 'entregado') {
    const pts = calcPoints(order.total || 0);
    if (pts > 0) {
      // Buscar cliente por email o por clientId
      const cust = customers.find(c =>
        c.id === order.clientId || c.email === order.email
      );
      if (cust) {
        addPointsToCustomer(cust.id, pts,
          `🛒 Pedido #${order.order_number || order.id} entregado (RD$ ${fmt$(order.total||0)})`,
          order.id
        );
        showAdminToast(`+${pts} puntos acreditados a ${cust.name}`, 'success');
      }
    }
  }
  // Caso B: se revierte un pedido entregado → descontar puntos
  if (prevStatus === 'entregado' && newStatus !== 'entregado') {
    const pts = calcPoints(order.total || 0);
    if (pts > 0) {
      const cust = customers.find(c =>
        c.id === order.clientId || c.email === order.email
      );
      if (cust) {
        addPointsToCustomer(cust.id, -pts,
          `↩️ Pedido #${order.order_number || order.id} revertido de entregado`,
          order.id
        );
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  orders[idx].status = newStatus;
  orders[idx].notes  = notes;
  DB.updateOrder(orders[idx].id, orders[idx])
    .then(() => {
      DBCached.invalidateOrders();
      renderOrdersTable();
      renderInventory();
      updatePendingBadge();
      _unlockOS();
      closeOrderModal();
      showAdminToast('Pedido actualizado correctamente', 'success');
      // ── Notificación automática al cliente ──────────────────────
      if (newStatus !== prevStatus && typeof sendOrderStatusNotification === 'function') {
        sendOrderStatusNotification(orders[idx], newStatus);
      }
    })
    .catch(() => { _unlockOS(); showAdminToast('Error al guardar el pedido', 'error'); });
}

function deleteOrder(id) {
  if (!confirm('¿Eliminar este pedido?')) return;
  // Normalizar a string para comparaciones seguras
  const sid   = String(id);
  const order = orders.find(o => String(o.id) === sid);
  // Reponer stock solo si el pedido NO estaba ya cancelado
  if (order && order.status !== 'cancelado') {
    restoreStock(order);
    showAdminToast('Stock repuesto al inventario', 'info');
  }
  DB.deleteOrder(sid)
    .then(() => {
      orders = orders.filter(o => String(o.id) !== sid);
      DBCached.invalidateOrders();
      renderOrdersTable();
      renderInventory();
      updatePendingBadge();
      showAdminToast('Pedido eliminado', 'info');
    })
    .catch(() => showAdminToast('Error al eliminar el pedido', 'error'));
}

// ─── NUEVO PEDIDO (desde admin) ───────────────────────────────────────────────
let noLines = []; // líneas del pedido en construcción

function openNewOrderModal() {
  noLines = [];

  // Poblar select de clientes desde memoria
  const selC = document.getElementById('noClient');
  if (selC) {
    selC.innerHTML = '<option value="">— Selecciona un cliente —</option>' +
      customers.map(c => `<option value="${c.id}">${c.name} — ${c.email}</option>`).join('');
  }

  // Poblar select de repartidores desde memoria
  const selD = document.getElementById('noDriver');
  if (selD) {
    selD.innerHTML = '<option value="">— Sin asignar —</option>' +
      drivers.filter(d => d.status !== 'inactivo')
             .map(d => `<option value="${d.id}">${d.name} (${d.zone||'sin zona'})</option>`).join('');
  }

  // Resetear campos
  ['noAddress','noCity','noNotes','noMapLink','noBarcodeInput'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const noBarcodeMsg = document.getElementById('noBarcodeMsg');
  if (noBarcodeMsg) noBarcodeMsg.textContent = 'Listo para escanear';
  _noResetMap();
  const noStatus = document.getElementById('noStatus');
  if (noStatus) noStatus.value = 'pendiente';
  const noPayMethod = document.getElementById('noPayMethod');
  if (noPayMethod) noPayMethod.value = 'efectivo';

  const clientInfo = document.getElementById('noClientInfo');
  if (clientInfo) clientInfo.classList.add('hidden');

  _noRenderLines();
  _noUpdateTotals();

  document.getElementById('newOrderBackdrop').classList.remove('hidden');
}

function closeNewOrderModal() {
  _savingNewOrder = false;
  document.getElementById('newOrderBackdrop').classList.add('hidden');
  noLines = [];
  _noResetMap();
}

// ── Helpers de Google Maps en el modal de nuevo pedido ───────────────────────
function _noResetMap() {
  const preview = document.getElementById('noMapPreview');
  const frame   = document.getElementById('noMapFrame');
  const btn     = document.getElementById('noMapLinkBtn');
  if (preview) preview.style.display = 'none';
  if (frame)   frame.src = '';
  if (btn)     btn.style.display = 'none';
}

function noPreviewMap() {
  const url     = (document.getElementById('noMapLink')?.value || '').trim();
  const preview = document.getElementById('noMapPreview');
  const frame   = document.getElementById('noMapFrame');
  const btn     = document.getElementById('noMapLinkBtn');
  if (!preview || !frame) return;

  if (!url) { _noResetMap(); return; }
  if (btn) { btn.href = url; btn.style.display = ''; }

  let embedSrc = '';
  if (url.includes('maps/embed')) {
    embedSrc = url;
  } else if (url.includes('maps.google.com') || url.includes('google.com/maps')) {
    embedSrc = url
      .replace('https://www.google.com/maps', 'https://www.google.com/maps/embed')
      .replace('https://maps.google.com/maps', 'https://www.google.com/maps/embed');
    if (!embedSrc.includes('/embed')) {
      const qMatch = url.match(/[?&]q=([^&]+)/);
      const place  = qMatch ? qMatch[1] : encodeURIComponent(url);
      embedSrc = `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU3MeQ&q=${place}`;
    }
  } else if (url.includes('goo.gl') || url.includes('maps.app')) {
    // Enlace corto: solo mostrar botón
    if (preview) preview.style.display = 'none';
    return;
  }

  if (embedSrc) {
    frame.src = embedSrc;
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

// Botón "Del cliente" → carga el mapLink guardado del cliente seleccionado
function noUseClientMap() {
  const clientId = document.getElementById('noClient')?.value;
  if (!clientId) { showAdminToast('Primero selecciona un cliente', 'warning'); return; }
  const c = customers.find(x => x.id === clientId);
  if (!c || !c.mapLink) {
    showAdminToast('Este cliente no tiene ubicación guardada en Maps', 'warning');
    return;
  }
  const inp = document.getElementById('noMapLink');
  if (inp) inp.value = c.mapLink;
  noPreviewMap();
  showAdminToast('Ubicación del cliente cargada', 'success');
}

// Al seleccionar cliente → rellenar dirección y mostrar info
function onNoClientChange() {
  const id  = document.getElementById('noClient')?.value;
  const box = document.getElementById('noClientInfo');
  if (!id) { box.classList.add('hidden'); return; }

  const c = customers.find(x => x.id === id);
  if (!c) { box.classList.add('hidden'); return; }

  // Autorellenar dirección
  const addrEl = document.getElementById('noAddress');
  const cityEl = document.getElementById('noCity');
  if (addrEl && !addrEl.value) addrEl.value = c.address || '';
  if (cityEl && !cityEl.value) cityEl.value = c.city    || '';

  box.classList.remove('hidden');
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;background:#f0faf4;border:1px solid #b2dfcc;border-radius:8px;padding:10px 14px">
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#1a7c3e,#27a35a);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;flex-shrink:0">
        ${c.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
      </div>
      <div style="flex:1;font-size:.83rem">
        <strong>${c.name}</strong>
        <div style="color:#666">${c.email} · ${c.phone||'—'}</div>
        ${c.mapLink ? `<a href="${c.mapLink}" target="_blank" style="font-size:.75rem;color:#1a56c4"><i class="fas fa-location-dot"></i> Ver ubicación en Maps</a>` : ''}
      </div>
      <span style="font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px;background:${c.status==='deshabilitado'||c.status==='inactivo'?'#fce4ec':'#e8f5ee'};color:${c.status==='deshabilitado'||c.status==='inactivo'?'#c62828':'#1a7c3e'}">
        ${c.status==='deshabilitado'||c.status==='inactivo'?'🚫 Deshabilitado':'✅ Habilitado'}
      </span>
      <span style="font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px;margin-left:4px;background:${(c.ranking||c.loyaltyTier||'bronce')==='vip'?'#f3eeff':(c.ranking||c.loyaltyTier||'bronce')==='oro'?'#fff8e1':(c.ranking||c.loyaltyTier||'bronce')==='plata'?'#f1f5f9':'#fff3e0'};color:${(c.ranking||c.loyaltyTier||'bronce')==='vip'?'#7c3aed':(c.ranking||c.loyaltyTier||'bronce')==='oro'?'#c77a00':(c.ranking||c.loyaltyTier||'bronce')==='plata'?'#475569':'#b45309'}">
        ${{vip:'💎 VIP',oro:'🥇 Oro',plata:'🥈 Plata',bronce:'🥉 Bronce'}[(c.ranking||c.loyaltyTier||'bronce')]||'🥉 Bronce'}
      </span>
    </div>`;
}

// Agregar línea de producto vacía
function noAddProductLine() {
  noLines.push({ productId: '', cantidad: 1 });
  _noRenderLines();
}

// Eliminar línea
function noRemoveLine(idx) {
  noLines.splice(idx, 1);
  _noRenderLines();
  _noUpdateTotals();
}

// Cambiar producto seleccionado en una línea
function noLineProductChange(idx, productId) {
  noLines[idx].productId = productId;
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (prod && noLines[idx].cantidad > prod.stock) noLines[idx].cantidad = prod.stock || 1;

  // ── Actualizar imagen e info INMEDIATAMENTE sin re-renderizar toda la lista ──
  const imgBox = document.getElementById(`no-img-${idx}`);
  if (imgBox) {
    if (prod) {
      imgBox.innerHTML = `<img src="${prod.image}" alt="${prod.name}"
        onerror="this.src='images/logo-casamota.png'"
        style="width:46px;height:46px;border-radius:8px;object-fit:cover;border:1px solid #eee;flex-shrink:0" />`;
    } else {
      imgBox.innerHTML = `<div style="width:46px;height:46px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-image" style="color:#ccc;font-size:1.1rem"></i>
      </div>`;
    }
  }

  // Actualizar info del producto (stock / precio / unidad) debajo del selector
  const lineDiv = document.getElementById(`no-line-${idx}`);
  if (lineDiv) {
    const infoEl = lineDiv.querySelector('.no-prod-info');
    if (infoEl) {
      infoEl.innerHTML = prod
        ? `Stock disponible: <b>${prod.stock}</b> · RD$ ${fmt$(prod.price)} / ${prod.unit || 'u.'}`
        : '';
    }
  }

  // Actualizar max del input de cantidad y subtotal
  const qInput = document.getElementById(`no-qty-${idx}`);
  if (qInput && prod) qInput.max = prod.stock;

  // Actualizar subtotal de la línea inmediatamente
  const subEl = document.getElementById(`no-sub-${idx}`);
  if (subEl) {
    subEl.textContent = prod
      ? `RD$ ${fmt$(prod.price * (noLines[idx].cantidad || 1))}`
      : '—';
  }

  _noUpdateTotals();
}

// Cambiar cantidad de una línea
function noLineQtyChange(idx, val) {
  const qty  = Math.max(1, parseInt(val, 10) || 1);
  const prod = adminProducts.find(p => String(p.id) === String(noLines[idx].productId));
  if (prod && qty > prod.stock) {
    showAdminToast(`Stock insuficiente para "${prod.name}" (disponible: ${prod.stock})`, 'warning');
    document.getElementById(`no-qty-${idx}`).value = Math.min(qty, prod.stock);
    noLines[idx].cantidad = Math.min(qty, prod.stock);
  } else {
    noLines[idx].cantidad = qty;
  }
  _noUpdateTotals();
}

// Renderizar líneas de productos
function _noRenderLines() {
  const container = document.getElementById('noProductLines');
  if (!container) return;

  if (noLines.length === 0) {
    container.innerHTML = `
      <div class="no-empty-lines">
        <i class="fas fa-basket-shopping" style="font-size:2rem;color:#ddd;margin-bottom:8px"></i>
        <div style="color:#aaa;font-size:.85rem">Aún no hay productos. Pulsa "+ Agregar producto".</div>
      </div>`;
    _noUpdateTotals();
    return;
  }

  container.innerHTML = noLines.map((line, idx) => {
    const prod = adminProducts.find(p => String(p.id) === String(line.productId));
    const prodOptions = adminProducts
      .filter(p => p.stock > 0)
      .map(p => `<option value="${p.id}" ${String(p.id)===String(line.productId)?'selected':''}>${p.name} (Stock: ${p.stock}) — RD$ ${fmt$(p.price)}</option>`)
      .join('');

    // Foto del producto (si está seleccionado)
    const imgHTML = prod
      ? `<img src="${prod.image}" alt="${prod.name}"
              onerror="this.src='images/logo-casamota.png'"
              style="width:46px;height:46px;border-radius:8px;object-fit:cover;border:1px solid #eee;flex-shrink:0" />`
      : `<div style="width:46px;height:46px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;flex-shrink:0">
           <i class="fas fa-image" style="color:#ccc;font-size:1.1rem"></i>
         </div>`;

    const maxQty    = prod ? prod.stock : 999;
    const subtotal  = prod ? `RD$ ${fmt$(prod.price * line.cantidad)}` : '—';
    const isOne     = line.cantidad === 1;

    return `
      <div class="no-prod-line" id="no-line-${idx}">
        <!-- Foto -->
        <div class="no-prod-img" id="no-img-${idx}">${imgHTML}</div>

        <!-- Selector de producto -->
        <div class="no-prod-select">
          <select class="form-input" id="no-sel-${idx}"
                  onchange="noLineProductChange(${idx},this.value)"
                  style="font-size:.82rem">
            <option value="">— Selecciona producto —</option>
            ${prodOptions}
          </select>
          <div class="no-prod-info" style="font-size:.72rem;color:#aaa;margin-top:3px">${prod ? `Stock disponible: <b>${prod.stock}</b> · RD$ ${fmt$(prod.price)} / ${prod.unit||'u.'}` : ''}</div>
        </div>

        <!-- Controles cantidad -->
        <div class="no-qty-ctrl">
          <button class="no-qty-btn" onclick="noLineQty(${idx},-1)" title="Disminuir">
            <i class="fas fa-minus"></i>
          </button>
          <input class="no-qty-input" type="number" id="no-qty-${idx}"
                 value="${line.cantidad}" min="1" max="${maxQty}"
                 onchange="noLineQtyChange(${idx},this.value)"
                 onclick="this.select()" />
          <button class="no-qty-btn" onclick="noLineQty(${idx},+1)" title="Aumentar">
            <i class="fas fa-plus"></i>
          </button>
        </div>

        <!-- Subtotal -->
        <div class="no-prod-subtotal" id="no-sub-${idx}">${subtotal}</div>

        <!-- Eliminar -->
        <button class="no-del-line-btn" onclick="noRemoveLine(${idx})" title="Eliminar línea">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
  }).join('');
}

// Botones +/− en líneas de producto
function noLineQty(idx, delta) {
  const line = noLines[idx];
  if (!line) return;
  const newQty = line.cantidad + delta;
  if (newQty <= 0) { noRemoveLine(idx); return; }
  const prod = adminProducts.find(p => String(p.id) === String(line.productId));
  if (delta > 0 && prod && newQty > prod.stock) {
    showAdminToast(`Stock máximo para "${prod.name}": ${prod.stock}`, 'warning');
    return;
  }
  line.cantidad = newQty;
  // Actualizar UI sin re-renderizar todo
  const input   = document.getElementById(`no-qty-${idx}`);
  const subEl   = document.getElementById(`no-sub-${idx}`);
  const minBtn  = document.querySelector(`#no-line-${idx} .no-qty-btn`);
  if (input)  input.value = newQty;
  if (subEl && prod)  subEl.textContent = `RD$ ${fmt$(prod.price * newQty)}`;
  if (minBtn) minBtn.innerHTML = `<i class="fas fa-minus"></i>`;
  _noUpdateTotals();
}

// Calcular y mostrar totales
function _noUpdateTotals() {
  // Leer config desde caché en memoria (no localStorage)
  const cachedSettings = _cache.settings || {};
  const shippingFee    = parseFloat(cachedSettings.shippingFee    || '150');
  const freeThreshold  = parseFloat(cachedSettings.freeShippingMin || '1500');

  let subtotal = 0;
  noLines.forEach(line => {
    const prod = adminProducts.find(p => String(p.id) === String(line.productId));
    if (prod) subtotal += prod.price * line.cantidad;
  });

  const shipping = subtotal >= freeThreshold ? 0 : (noLines.length > 0 ? shippingFee : 0);
  const total    = subtotal + shipping;

  const box = document.getElementById('noTotalsBox');
  if (box) box.style.display = noLines.length > 0 ? '' : 'none';

  const subEl  = document.getElementById('noSubtotal');
  const shipEl = document.getElementById('noShipping');
  const shipRow= document.getElementById('noShippingRow');
  const totEl  = document.getElementById('noTotal');

  if (subEl)  subEl.textContent  = `RD$ ${fmt$(subtotal)}`;
  if (shipEl) shipEl.textContent = shipping === 0 ? '🎉 Gratis' : `RD$ ${fmt$(shipping)}`;
  if (shipRow) shipRow.style.color = shipping === 0 ? '#1a7c3e' : '';
  if (totEl)  totEl.textContent  = `RD$ ${fmt$(total)}`;
}

// Guardar el nuevo pedido
let _savingNewOrder = false;
async function saveNewOrder() {
  if (_savingNewOrder) return;
  const clientId = document.getElementById('noClient')?.value;
  if (!clientId) { showAdminToast('Selecciona un cliente', 'error'); return; }

  const validLines = noLines.filter(l => l.productId);
  if (validLines.length === 0) { showAdminToast('Agrega al menos un producto', 'error'); return; }

  // Verificar stock
  for (const line of validLines) {
    const prod = adminProducts.find(p => String(p.id) === String(line.productId));
    if (!prod) continue;
    if (line.cantidad > prod.stock) {
      showAdminToast(`Stock insuficiente para "${prod.name}" (disponible: ${prod.stock})`, 'error');
      return;
    }
  }

  const client = customers.find(c => c.id === clientId);
  if (!client) { showAdminToast('Cliente no encontrado', 'error'); return; }
  let shippingFee = 150, freeThreshold = 1500;
  try {
    const settings = await DB.getSettings();
    shippingFee   = parseFloat(settings.shippingFee     || 150);
    freeThreshold = parseFloat(settings.freeShippingMin || 1500);
  } catch(e) { /* usa defaults */ }

  const payMethodMap = {
    efectivo:         'Efectivo contra entrega',
    tarjeta_credito:  'Tarjeta',
    transferencia:    'Transferencia bancaria',
  };
  const payMethod = document.getElementById('noPayMethod')?.value || 'efectivo';

  // Construir líneas de productos
  const productLines = validLines.map(line => {
    const prod = adminProducts.find(p => String(p.id) === String(line.productId));
    return {
      productId: prod.id,
      name:      prod.name,
      image:     prod.image,
      category:  prod.category,
      unit:      prod.unit || 'unidad',
      price:     prod.price,
      cantidad:  line.cantidad,
      subtotal:  parseFloat((prod.price * line.cantidad).toFixed(2)),
    };
  });

  const subtotal = productLines.reduce((s, l) => s + l.subtotal, 0);
  const shipping = subtotal >= freeThreshold ? 0 : shippingFee;
  const total    = parseFloat((subtotal + shipping).toFixed(2));

  // Generar número correlativo basado en order_number (no en id que ahora es UUID)
  const maxId = orders.reduce((mx, o) => Math.max(mx, Number(o.order_number) || Number(o.id) || 0), 0);
  const newId = maxId + 1;

  const now     = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const driverId = document.getElementById('noDriver')?.value || null;

  const newOrder = {
    id:             newId,
    clientId:       client.id,
    customer:       client.name,
    email:          client.email,
    phone:          client.phone || '',
    address:        (document.getElementById('noAddress')?.value || client.address || '').trim(),
    city:           (document.getElementById('noCity')?.value    || client.city    || '').trim(),
    items:          productLines.length,
    productLines,
    total,
    subtotal,
    shipping,
    status:         document.getElementById('noStatus')?.value || 'pendiente',
    payMethod,
    payMethodLabel: payMethodMap[payMethod] || payMethod,
    notes:          document.getElementById('noNotes')?.value.trim() || '',
    mapLink:        document.getElementById('noMapLink')?.value.trim() || '',
    date:           dateStr,
    source:         'admin',
    driverId:       driverId || null,
    createdAt:      now.toISOString(),
  };

  // Descontar stock en API y en memoria
  productLines.forEach(line => {
    const p = adminProducts.find(x => Number(x.id) === Number(line.productId));
    if (p) {
      p.stock = Math.max(0, (p.stock || 0) - line.cantidad);
      _apiPatch('products', p.id, { stock: p.stock }).catch(() => {});
    }
  });
  DBCached.invalidateProducts();

  // Actualizar estadísticas del cliente en API y en memoria
  const cIdx = customers.findIndex(c => c.id === clientId);
  if (cIdx !== -1) {
    customers[cIdx].orders    = (customers[cIdx].orders || 0) + 1;
    customers[cIdx].spent     = (customers[cIdx].spent  || 0) + total;
    customers[cIdx].lastOrder = dateStr;
    DB.patchCustomer(clientId, {
      orders:    customers[cIdx].orders,
      spent:     customers[cIdx].spent,
      lastOrder: dateStr,
    }).catch(() => {});
    DBCached.invalidateCustomers();
  }

  // Bloquear botón
  _savingNewOrder = true;
  const _btnNO = document.getElementById('noSaveBtn');
  if (_btnNO) { _btnNO.disabled = true; _btnNO.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  const _unlockNO = () => {
    _savingNewOrder = false;
    if (_btnNO) { _btnNO.disabled = false; _btnNO.innerHTML = '<i class="fas fa-save"></i> Crear pedido'; }
  };

  // Guardar pedido en API y en memoria
  DB.createOrder(newOrder)
    .then(saved => {
      orders.unshift(saved || newOrder);
      DBCached.invalidateOrders();
      _unlockNO();
      closeNewOrderModal();
      renderOrdersTable();
      updatePendingBadge();
      renderInventory();
      showAdminToast(`✅ Pedido #${newId} creado para ${client.name}`, 'success');
    })
    .catch(() => { _unlockNO(); showAdminToast('Error al guardar el pedido', 'error'); });
}

function updatePendingBadge() {
  // Badges del sidebar desactivados — los conteos se muestran en las KPI cards del Dashboard
}

// ─── INVENTARIO ───────────────────────────────────────────────────────────────
// ─── ORDENAMIENTO INVENTARIO ────────────────────────────────────────────────
let _invSortField = null;
let _invSortDir   = 'asc';

function sortInventoryBy(field) {
  if (_invSortField === field) {
    _invSortDir = _invSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _invSortField = field;
    _invSortDir   = 'asc';
  }
  ['name','category','stock'].forEach(f => {
    const icon = document.getElementById(`inv-sort-icon-${f}`);
    const th   = icon?.closest('th');
    if (!icon) return;
    if (f === _invSortField) {
      icon.textContent = _invSortDir === 'asc' ? '↑' : '↓';
      th?.classList.add('sort-active');
    } else {
      icon.textContent = '⇅';
      th?.classList.remove('sort-active');
    }
  });
  _pages.inventory = 1;
  renderInventory();
}

function renderInventory() {
  const q      = (document.getElementById('invSearch')?.value || '').toLowerCase();
  const filter = document.getElementById('invStockFilter')?.value || '';

  const list = adminProducts.filter(p => {
    const matchQ = !q || p.name.toLowerCase().includes(q)
                       || (p.barcode || '').toLowerCase().includes(q)
                       || (p.description || '').toLowerCase().includes(q);
    const matchF = !filter || (filter === 'low' ? Number(p.stock) < 20 : Number(p.stock) >= 20);
    return matchQ && matchF;
  }).sort((a, b) => {
    if (_invSortField) {
      let va = a[_invSortField], vb = b[_invSortField];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      va = va ?? ''; vb = vb ?? '';
      if (va < vb) return _invSortDir === 'asc' ? -1 :  1;
      if (va > vb) return _invSortDir === 'asc' ?  1 : -1;
      return 0;
    }
    return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
  });

  const total = adminProducts.reduce((s, p) => s + (Number(p.stock) || 0), 0);
  const low   = adminProducts.filter(p => Number(p.stock) > 0 && Number(p.stock) < 20).length;
  const zero  = adminProducts.filter(p => Number(p.stock) === 0).length;

  document.getElementById('invTotal').textContent = total;
  document.getElementById('invLow').textContent   = low;
  document.getElementById('invZero').textContent  = zero;

  const filtTotal = list.length;
  const pg        = _pages.inventory;
  const start     = (pg - 1) * PAGE_SIZE;
  const page      = list.slice(start, start + PAGE_SIZE);
  const from      = filtTotal === 0 ? 0 : start + 1;
  const to        = Math.min(start + PAGE_SIZE, filtTotal);

  document.getElementById('invCount').textContent =
    filtTotal === 0 ? 'Sin resultados' : `${from}–${to} de ${filtTotal} producto${filtTotal !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('inventoryTbody');
  tbody.innerHTML = '';

  page.forEach(p => {
    const _stock   = Number(p.stock) || 0;
    const cls      = _stock === 0 ? 'stock-zero' : _stock < 20 ? 'stock-low' : 'stock-ok';
    const label    = _stock === 0 ? '🔴 Sin stock' : _stock < 20 ? '🟡 Stock bajo' : '🟢 Normal';
    const pct      = Math.min(100, Math.round(_stock / 150 * 100));
    const barColor = p.stock === 0 ? '#e53935' : p.stock < 20 ? '#f57c00' : '#1a7c3e';

    const tr = document.createElement('tr');
    tr.dataset.invid = p.id;
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <img src="${p.image}" alt="${p.name}" class="td-img" onerror="this.src='images/logo-casamota.png'"
               style="cursor:zoom-in" title="Ver imagen"
               onclick="viewProduct('${p.id}')"/>
          <div style="display:flex;align-items:center;gap:6px">
            <strong>${p.name}</strong>
            <button class="action-btn action-btn-view" title="Ver imágenes del producto"
                    onclick="viewProduct('${p.id}')">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </div>
      </td>
      <td><span class="td-cat">${catLabel(p.category)}</span></td>
      <td>
        <span class="${cls}" style="font-size:1.05rem">${_stock}</span>
        <div class="stock-bar-wrap"><div class="stock-bar" style="width:${pct}%;background:${barColor}"></div></div>
      </td>
      <td>${label}</td>
      <td>${p.barcode ? `<span style="font-family:monospace;font-size:.8rem;background:#f4f4f4;padding:2px 6px;border-radius:4px;letter-spacing:.04em"><i class="fas fa-barcode" style="color:#666;margin-right:3px"></i>${p.barcode}</span>` : `<span style="color:#ddd;font-size:.78rem">—</span>`}</td>
      <td>
        <div class="inv-adjust">
          <button class="inv-btn" onclick="adjustStock('${p.id}',-5)">-5</button>
          <button class="inv-btn" onclick="adjustStock('${p.id}',-1)">-1</button>
          <span class="inv-qty">${_stock}</span>
          <button class="inv-btn" onclick="adjustStock('${p.id}',1)">+1</button>
          <button class="inv-btn" onclick="adjustStock('${p.id}',10)">+10</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  _renderPaginator('invPaginator', pg, filtTotal, 'inventory', 'inventoryTable');
}

function adjustStock(id, delta) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  p.stock = Math.max(0, (Number(p.stock) || 0) + delta);
  _apiPatch('products', p.id, { stock: p.stock }).catch(() => {});
  DBCached.invalidateProducts();
  renderInventory();
  renderProductsTable();
}

function exportInventory() {
  const rows = [['ID','Nombre','Categoría','Precio','Stock','Badge','Código de barras']];
  adminProducts.forEach(p => rows.push([p.id, p.name, p.category, p.price, p.stock, p.badge||'', p.barcode||'']));
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'inventario-casamota.csv';
  a.click();
  showAdminToast('Inventario exportado como CSV', 'success');
}

// ─── PROGRAMA DE PUNTOS / FIDELIZACIÓN ───────────────────────────────────────
const LOYALTY_KEY     = 'cm_loyalty_config';
const LOYALTY_LEVELS  = [
  { name: 'Bronce', min: 0,    max: 499,      icon: '🥉', color: '#cd7f32', bg: '#fdf3e7' },
  { name: 'Plata',  min: 500,  max: 1499,     icon: '🥈', color: '#888',    bg: '#f4f4f4' },
  { name: 'Oro',    min: 1500, max: 2999,     icon: '🥇', color: '#c9a500', bg: '#fffbea' },
  { name: 'VIP',    min: 3000, max: Infinity, icon: '💎', color: '#7c3aed', bg: '#f3eeff' },
];

// Config por defecto (se sobreescribe con lo guardado en localStorage)
// Config por defecto: por cada RD$ 10 → 1 punto, cada punto vale RD$ 1
const LOYALTY_DEFAULTS = {
  pesosPerPoint:  10,   // cada cuántos RD$ se gana el punto
  pointsEarned:   1,    // cuántos puntos se ganan
  pointValue:     1,    // cuántos RD$ vale 1 punto al canjear
  expiryMonths:   6,
  levels: LOYALTY_LEVELS,
};

// Cache en memoria para la config de fidelización (evita llamadas repetidas)
let _loyaltyConfigCache = null;

// Lee config activa desde API (con fallback a defaults)
function getLoyaltyConfig() {
  if (_loyaltyConfigCache) return _loyaltyConfigCache;
  // Intentar leer de settings en memoria si ya está disponible
  const saved = {};
  _loyaltyConfigCache = {
    pesosPerPoint: parseInt(saved.pesosPerPoint ?? LOYALTY_DEFAULTS.pesosPerPoint, 10),
    pointsEarned:  parseInt(saved.pointsEarned  ?? LOYALTY_DEFAULTS.pointsEarned,  10),
    pointValue:    parseInt(saved.pointValue    ?? LOYALTY_DEFAULTS.pointValue,    10),
    expiryMonths:  parseInt(saved.expiryMonths  ?? LOYALTY_DEFAULTS.expiryMonths,  10),
    levels: LOYALTY_DEFAULTS.levels,
  };
  // Cargar asincrono y actualizar cache
  DB.getSettings().then(s => {
    if (s) {
      _loyaltyConfigCache = {
        pesosPerPoint: parseInt(s.loyaltyPesosPerPoint ?? LOYALTY_DEFAULTS.pesosPerPoint, 10),
        pointsEarned:  parseInt(s.loyaltyPointsEarned  ?? LOYALTY_DEFAULTS.pointsEarned,  10),
        pointValue:    parseInt(s.loyaltyPointValue    ?? LOYALTY_DEFAULTS.pointValue,    10),
        expiryMonths:  parseInt(s.loyaltyExpiryMonths  ?? LOYALTY_DEFAULTS.expiryMonths,  10),
        levels: LOYALTY_DEFAULTS.levels,
      };
    }
  }).catch(() => {});
  return _loyaltyConfigCache;
}

// Alias corto para todo el código existente
const LOYALTY = {
  get pesosPerPoint() { return getLoyaltyConfig().pesosPerPoint; },
  get pointsEarned()  { return getLoyaltyConfig().pointsEarned; },
  get pointValue()    { return getLoyaltyConfig().pointValue; },
  get expiryMonths()  { return getLoyaltyConfig().expiryMonths; },
  get levels()        { return getLoyaltyConfig().levels || LOYALTY_LEVELS; },
};

// Devuelve el nivel según puntos
function getLoyaltyLevel(points) {
  const lvls = (getLoyaltyConfig().levels || LOYALTY_LEVELS);
  return [...lvls].reverse().find(l => points >= (l.min||0)) || lvls[0];
}

// ── MÓDULO ADMIN: Fidelización ────────────────────────────────────────────────
const LOYALTY_LEVEL_META = LOYALTY_LEVELS; // Referencia fija para el formulario

function loadLoyalty() {
  const cfg = getLoyaltyConfig();

  // Rellenar campos de configuración
  const pesosEl  = document.getElementById('lCfgPesosPerPoint');
  const earnedEl = document.getElementById('lCfgPointsEarned');
  const valueEl  = document.getElementById('lCfgPointValue');
  const expiryEl = document.getElementById('lCfgExpiry');
  if (pesosEl)  pesosEl.value  = cfg.pesosPerPoint;
  if (earnedEl) earnedEl.value = cfg.pointsEarned;
  if (valueEl)  valueEl.value  = cfg.pointValue;
  if (expiryEl) expiryEl.value = cfg.expiryMonths;
  _updateRulePreview();

  // Renderizar campos de niveles
  const levelsWrap = document.getElementById('lCfgLevels');
  if (levelsWrap) {
    levelsWrap.innerHTML = LOYALTY_LEVEL_META.map((lvl, i) => `
      <div style="background:${lvl.bg};border:1px solid ${lvl.color}44;border-radius:10px;padding:10px 12px">
        <div style="font-size:.8rem;font-weight:800;color:${lvl.color};margin-bottom:6px">${lvl.icon} ${lvl.name}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:.72rem;color:#888;white-space:nowrap">Desde (pts)</label>
          <input type="number" class="form-input" id="lLvlMin_${i}"
                 value="${(cfg.levels[i]||lvl).min}" min="0" step="1"
                 style="padding:5px 8px;font-size:.82rem"
                 ${i === 0 ? 'readonly style="padding:5px 8px;font-size:.82rem;background:#f9f9f9"' : ''} />
        </div>
      </div>`).join('');
  }

  // KPIs
  renderLoyaltyKpis();
  renderLoyaltyRanking();
  renderLoyaltyHist();
}

// Actualiza los textos de vista previa en tiempo real
function _updateRulePreview() {
  const pesos  = parseInt(document.getElementById('lCfgPesosPerPoint')?.value || '10', 10);
  const earned = parseInt(document.getElementById('lCfgPointsEarned')?.value  || '1',  10);
  const value  = parseInt(document.getElementById('lCfgPointValue')?.value    || '1',  10);

  // Preview acumulación
  const ruleEl = document.getElementById('lRulePreviewText');
  if (ruleEl) {
    const valid = !isNaN(pesos) && pesos >= 1 && !isNaN(earned) && earned >= 1;
    ruleEl.textContent = valid
      ? `Por cada RD$ ${pesos} el cliente gana ${earned} punto${earned!==1?'s':''}`
      : 'Completa los campos para ver la vista previa';
  }

  // Preview valor del punto
  const valEl = document.getElementById('lValuePreviewText');
  if (valEl && !isNaN(value) && value >= 1) {
    const example = 100;
    valEl.textContent = `${example} puntos = RD$ ${(example * value).toLocaleString('es-DO')} de descuento al canjear`;
  }
}

function saveLoyaltyConfig() {
  const pesos  = parseInt(document.getElementById('lCfgPesosPerPoint')?.value, 10);
  const earned = parseInt(document.getElementById('lCfgPointsEarned')?.value,  10);
  const expiry = parseInt(document.getElementById('lCfgExpiry')?.value, 10);

  const value  = parseInt(document.getElementById('lCfgPointValue')?.value,  10);

  if (isNaN(pesos) || pesos < 1) {
    showAdminToast('El monto en RD$ debe ser al menos 1', 'error'); return;
  }
  if (isNaN(earned) || earned < 1) {
    showAdminToast('Los puntos ganados deben ser al menos 1', 'error'); return;
  }
  if (isNaN(value) || value < 1) {
    showAdminToast('El valor del punto debe ser al menos RD$ 1', 'error'); return;
  }
  if (isNaN(expiry) || expiry < 0) {
    showAdminToast('La caducidad debe ser 0 o más meses', 'error'); return;
  }

  // Leer umbrales de niveles
  const newLevels = LOYALTY_LEVEL_META.map((lvl, i) => {
    const minVal = i === 0 ? 0 : parseInt(document.getElementById(`lLvlMin_${i}`)?.value || lvl.min, 10);
    const nextMin = i < LOYALTY_LEVEL_META.length - 1
      ? parseInt(document.getElementById(`lLvlMin_${i+1}`)?.value || (lvl.max + 1), 10)
      : Infinity;
    return { ...lvl, min: minVal, max: i < LOYALTY_LEVEL_META.length - 1 ? nextMin - 1 : Infinity };
  });

  // Validar que cada nivel empiece después del anterior
  for (let i = 1; i < newLevels.length; i++) {
    if (newLevels[i].min <= newLevels[i-1].min) {
      showAdminToast(`El mínimo de "${newLevels[i].name}" debe ser mayor al de "${newLevels[i-1].name}"`, 'error');
      return;
    }
  }

  const cfg = { pesosPerPoint: pesos, pointsEarned: earned, pointValue: value, expiryMonths: expiry, levels: newLevels };
  _loyaltyConfigCache = cfg;
  DB.saveSettings({
    loyaltyPesosPerPoint: pesos,
    loyaltyPointsEarned:  earned,
    loyaltyPointValue:    value,
    loyaltyExpiryMonths:  expiry,
  }).then(() => {
    DBCached.invalidateSettings();
    showAdminToast(`✅ Guardado: RD$ ${pesos} → ${earned} pt${earned!==1?'s':''} · 1 pt = RD$ ${value}`, 'success');
    renderLoyaltyKpis();
    renderLoyaltyRanking();
  }).catch(() => showAdminToast('Error al guardar configuración de fidelización', 'error'));
}

function renderLoyaltyKpis() {
  const all   = customers;
  const withPts = all.filter(c => (c.loyaltyPoints || 0) > 0);
  const total   = withPts.reduce((s, c) => s + (c.loyaltyPoints || 0), 0);
  const avg     = withPts.length ? Math.round(total / withPts.length) : 0;
  const cfg     = getLoyaltyConfig();
  const topLevels = (cfg.levels || LOYALTY_LEVELS).slice(-2); // Oro y VIP
  const topMin  = topLevels[0]?.min || 1500;
  const topCount = all.filter(c => (c.loyaltyPoints || 0) >= topMin).length;

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('lKpiActive', withPts.length);
  el('lKpiTotal',  total.toLocaleString('es-DO'));
  el('lKpiAvg',    avg.toLocaleString('es-DO'));
  el('lKpiTop',    topCount);
}

function renderLoyaltyRanking() {
  const q   = (document.getElementById('lSearch')?.value || '').toLowerCase();
  const all = customers;
  const list = all
    .filter(c => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
    .sort((a, b) => (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0));

  const wrap = document.getElementById('loyaltyRankingList');
  if (!wrap) return;

  if (list.length === 0) {
    wrap.innerHTML = `<div style="color:#bbb;text-align:center;padding:24px;font-size:.88rem">Sin clientes</div>`;
    return;
  }

  wrap.innerHTML = list.map((c, i) => {
    const pts  = c.loyaltyPoints || 0;
    const lvl  = getLoyaltyLevel(pts);
    const cfg  = getLoyaltyConfig();
    const levs = cfg.levels || LOYALTY_LEVELS;
    const nextLvl = levs.find(l => l.min > pts);
    const pct  = nextLvl
      ? Math.min(100, Math.round((pts - lvl.min) / (nextLvl.min - lvl.min) * 100))
      : 100;
    const initials = c.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid #f5f5f5;${i===0?'background:#fdf3e7;border-radius:8px;':''}">
        <div style="font-size:1.1rem;font-weight:900;color:#bbb;min-width:22px;text-align:center">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div>
        <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,${lvl.color},${lvl.color}99);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.78rem;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.87rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span style="font-size:.7rem;background:${lvl.bg};color:${lvl.color};border-radius:20px;padding:1px 7px;font-weight:700;border:1px solid ${lvl.color}44">${lvl.icon} ${lvl.name}</span>
            <div style="flex:1;background:#e0e0e0;border-radius:10px;height:4px;max-width:80px">
              <div style="height:100%;border-radius:10px;background:${lvl.color};width:${pct}%"></div>
            </div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:800;color:${lvl.color};font-size:.95rem">${pts.toLocaleString('es-DO')}</div>
          <div style="font-size:.7rem;color:#bbb">pts</div>
        </div>
        <button onclick="openAdjustPointsModal('${c.id}')"
                title="Gestionar puntos"
                style="background:#f3eeff;color:#7c3aed;border:1px solid #d8b4fe;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:.8rem;flex-shrink:0">
          <i class="fas fa-star"></i>
        </button>
      </div>`;
  }).join('');
}

function renderLoyaltyHist() {
  const tbody = document.getElementById('loyaltyHistTbody');
  if (!tbody) return;

  const all = customers;

  // Recopilar todos los movimientos con nombre del cliente
  const moves = [];
  all.forEach(c => {
    (c.loyaltyHistory || []).forEach(h => {
      moves.push({ clientName: c.name, clientId: c.id, ...h });
    });
  });

  // Ordenar por fecha descendente (usamos índice original como proxy)
  // Los movimientos ya están en orden inverso (unshift) dentro de cada cliente
  const countEl = document.getElementById('lHistCount');
  if (countEl) countEl.textContent = `${moves.length} movimiento${moves.length!==1?'s':''}`;

  if (moves.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#bbb;padding:24px">Sin movimientos aún</td></tr>`;
    return;
  }

  tbody.innerHTML = moves.slice(0, 100).map(m => {
    const ptsCls = m.pts > 0 ? 'color:#1a7c3e;font-weight:700' : m.pts < 0 ? 'color:#e53935;font-weight:700' : 'color:#888';
    const ptsStr = m.pts > 0 ? `+${m.pts}` : m.pts < 0 ? `${m.pts}` : '—';
    const initials = m.clientName.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cust-avatar" style="width:30px;height:30px;font-size:.72rem">${initials}</div>
            <div>
              <div style="font-weight:600;font-size:.85rem">${m.clientName}</div>
            </div>
          </div>
        </td>
        <td><span style="${ptsCls}">${ptsStr} pts</span></td>
        <td style="font-size:.83rem;color:#555;max-width:220px">${m.reason || '—'}</td>
        <td style="font-size:.8rem;color:#888">${m.date || '—'}</td>
        <td><strong>${(m.balance||0).toLocaleString('es-DO')} pts</strong></td>
        <td>
          <button class="action-btn" onclick="openAdjustPointsModal('${m.clientId}')" title="Gestionar puntos"
                  style="background:#f3eeff;color:#7c3aed;border:1px solid #d8b4fe">
            <i class="fas fa-star"></i>
          </button>
        </td>
      </tr>`;
  }).join('');
}

// Calcula puntos ganados por un total de compra (sin fracciones)
function calcPoints(total) {
  const cfg = getLoyaltyConfig();
  const pesos  = cfg.pesosPerPoint || 10;
  const earned = cfg.pointsEarned  || 1;
  return Math.floor((total || 0) / pesos) * earned;
}

// Añade puntos a un cliente y registra en historial
function addPointsToCustomer(customerId, pts, reason, orderId = null) {
  if (pts === 0) return;
  const idx = customers.findIndex(c => c.id === customerId);
  if (idx === -1) return;

  if (!customers[idx].loyaltyPoints)   customers[idx].loyaltyPoints   = 0;
  if (!customers[idx].loyaltyHistory)  customers[idx].loyaltyHistory  = [];

  customers[idx].loyaltyPoints     += pts;
  if (customers[idx].loyaltyPoints < 0) customers[idx].loyaltyPoints = 0;
  customers[idx].loyaltyLastActivity = Date.now();

  customers[idx].loyaltyHistory.unshift({
    date:    new Date().toLocaleDateString('es-DO'),
    pts,
    reason,
    orderId,
    balance: customers[idx].loyaltyPoints
  });

  DB.patchCustomer(customerId, { loyaltyPoints: customers[customers.findIndex(c => c.id === customerId)].loyaltyPoints, loyaltyTier: customers[customers.findIndex(c => c.id === customerId)].loyaltyTier, loyaltyHistory: customers[customers.findIndex(c => c.id === customerId)].loyaltyHistory })
    .catch(() => {});
  DBCached.invalidateCustomers();
}

// Verifica y aplica vencimiento de puntos (6 meses sin actividad)
function checkPointsExpiry(customer) {
  if (!customer.loyaltyLastActivity || !customer.loyaltyPoints) return customer;
  const lastAct   = new Date(Number(customer.loyaltyLastActivity));
  const monthsDiff = (Date.now() - lastAct) / (1000 * 60 * 60 * 24 * 30);
  if (monthsDiff >= LOYALTY.expiryMonths && customer.loyaltyPoints > 0) {
    customer.loyaltyPoints        = 0;
    customer.loyaltyLastActivity  = Date.now();
    if (!customer.loyaltyHistory) customer.loyaltyHistory = [];
    customer.loyaltyHistory.unshift({
      date:    new Date().toLocaleDateString('es-DO'),
      pts:     0,
      reason:  `⏰ Puntos vencidos por inactividad (${LOYALTY.expiryMonths} meses)`,
      balance: 0
    });
  }
  return customer;
}

// Renderiza el badge de nivel para usarlo en tablas
function loyaltyBadgeHTML(points) {
  const lvl = getLoyaltyLevel(points || 0);
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${lvl.bg};color:${lvl.color};border-radius:20px;padding:2px 9px;font-size:.72rem;font-weight:700;border:1px solid ${lvl.color}33">${lvl.icon} ${lvl.name}</span>`;
}

// Modal de ajuste manual de puntos
function openAdjustPointsModal(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (!c) return;
  checkPointsExpiry(c);
  const pts   = c.loyaltyPoints || 0;
  const lvl   = getLoyaltyLevel(pts);
  const nextLvl = LOYALTY.levels.find(l => l.min > pts);
  const ptsToNext = nextLvl ? nextLvl.min - pts : null;

  // Historial (últimas 10 entradas)
  const history = (c.loyaltyHistory || []).slice(0, 10);
  const histHTML = history.length === 0
    ? `<div style="color:#bbb;text-align:center;padding:16px;font-size:.85rem">Sin movimientos aún</div>`
    : history.map(h => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:.83rem">
          <div>
            <span style="color:${h.pts > 0 ? '#1a7c3e' : h.pts < 0 ? '#e53935' : '#888'};font-weight:700">
              ${h.pts > 0 ? '+' : ''}${h.pts !== 0 ? h.pts + ' pts' : '—'}
            </span>
            <span style="color:#666;margin-left:8px">${h.reason}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
            <span style="font-size:.72rem;color:#aaa">${h.date}</span>
            <span style="font-size:.72rem;color:#888">Saldo: <b>${h.balance}</b></span>
          </div>
        </div>`).join('');

  document.getElementById('orderModalTitle').textContent = `🎯 Puntos — ${c.name}`;
  document.getElementById('orderModalBody').innerHTML = `
    <!-- Tarjeta de nivel -->
    <div style="background:${lvl.bg};border:2px solid ${lvl.color}44;border-radius:14px;padding:18px 20px;margin-bottom:18px;display:flex;align-items:center;gap:16px">
      <div style="font-size:2.6rem;line-height:1">${lvl.icon}</div>
      <div style="flex:1">
        <div style="font-size:1rem;font-weight:800;color:${lvl.color}">${lvl.name}</div>
        <div style="font-size:1.8rem;font-weight:900;color:${lvl.color};line-height:1.1">${pts.toLocaleString('es-DO')} <span style="font-size:.9rem">pts</span></div>
        ${ptsToNext !== null
          ? `<div style="font-size:.75rem;color:#888;margin-top:4px">Faltan <b>${ptsToNext}</b> pts para <b>${nextLvl.name} ${nextLvl.icon}</b></div>
             <div style="background:#e0e0e0;border-radius:10px;height:6px;margin-top:6px;overflow:hidden">
               <div style="height:100%;border-radius:10px;background:${lvl.color};width:${Math.min(100,Math.round((pts - lvl.min)/(nextLvl.min - lvl.min)*100))}%;transition:width .4s"></div>
             </div>`
          : `<div style="font-size:.75rem;color:${lvl.color};margin-top:4px;font-weight:700">🏆 Nivel máximo alcanzado</div>`
        }
      </div>
    </div>

    <!-- Ajuste manual -->
    <div style="background:#f8f9fa;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-weight:700;font-size:.88rem;margin-bottom:10px;color:#333"><i class="fas fa-sliders" style="color:#1a7c3e;margin-right:6px"></i>Ajuste manual de puntos</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:100px">
          <label style="font-size:.75rem;color:#888;display:block;margin-bottom:4px">Puntos (+ bonificar / − descontar)</label>
          <input type="number" id="adjPtsAmount" placeholder="Ej: 50 ó -30"
                 style="width:100%;border:1.5px solid #e0e0e0;border-radius:8px;padding:8px 10px;font-size:.92rem;outline:none" />
        </div>
        <div style="flex:2;min-width:160px">
          <label style="font-size:.75rem;color:#888;display:block;margin-bottom:4px">Motivo</label>
          <input type="text" id="adjPtsReason" placeholder="Ej: Bono bienvenida, Canje solicitado…"
                 style="width:100%;border:1.5px solid #e0e0e0;border-radius:8px;padding:8px 10px;font-size:.92rem;outline:none" />
        </div>
        <button onclick="applyPointsAdjustment('${c.id}')"
                style="background:#1a7c3e;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-weight:700;cursor:pointer;font-size:.88rem;white-space:nowrap">
          <i class="fas fa-check"></i> Aplicar
        </button>
      </div>
    </div>

    <!-- Historial -->
    <div style="font-weight:700;font-size:.88rem;margin-bottom:8px;color:#333"><i class="fas fa-clock-rotate-left" style="color:#1a7c3e;margin-right:6px"></i>Historial (últimos 10 movimientos)</div>
    <div style="max-height:220px;overflow-y:auto;padding-right:4px">${histHTML}</div>

    <div style="margin-top:14px;display:flex;gap:10px">
      <button class="btn-secondary" style="flex:1" onclick="closeOrderModal();openCustomerModal('${c.id}')"><i class="fas fa-pen"></i> Editar cliente</button>
    </div>`;

  document.getElementById('orderModalBackdrop').classList.remove('hidden');
}

// Aplica el ajuste desde el modal
function applyPointsAdjustment(customerId) {
  const amtEl    = document.getElementById('adjPtsAmount');
  const reasonEl = document.getElementById('adjPtsReason');
  const amt    = parseInt(amtEl?.value || '0', 10);
  const reason = (reasonEl?.value || '').trim() || 'Ajuste manual';

  if (isNaN(amt) || amt === 0) {
    showAdminToast('Introduce un valor distinto de 0', 'error'); return;
  }
  addPointsToCustomer(customerId, amt, `✏️ ${reason}`);
  showAdminToast(`${amt > 0 ? '+' : ''}${amt} puntos aplicados a ${customers.find(c=>c.id===customerId)?.name}`, 'success');
  // Refrescar el modal
  openAdjustPointsModal(customerId);
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
function renderCustomers() {
  const q    = (document.getElementById('custSearch')?.value || '').toLowerCase();
  const sort = document.getElementById('custSortFilter')?.value || '';

  let list = customers.filter(c =>
    !q || c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          (c.phone || '').includes(q)
  );

  if (sort === 'name')   list = list.sort((a,b) => a.name.localeCompare(b.name));
  if (sort === 'spent')  list = list.sort((a,b) => b.spent  - a.spent);
  if (sort === 'orders') list = list.sort((a,b) => b.orders - a.orders);

  const total = list.length;
  const pg    = _pages.customers;
  const start = (pg - 1) * PAGE_SIZE;
  const page  = list.slice(start, start + PAGE_SIZE);
  const from  = total === 0 ? 0 : start + 1;
  const to    = Math.min(start + PAGE_SIZE, total);

  document.getElementById('custCount').textContent =
    total === 0 ? 'Sin resultados' : `${from}–${to} de ${total} cliente${total !== 1 ? 's' : ''}`;

  document.getElementById('customersTbody').innerHTML = page.map((c,i) => {
    // Estado: habilitado / deshabilitado (controla acceso a la tienda)
    const statusMap   = { habilitado:'cst-activo', deshabilitado:'cst-inactivo', activo:'cst-activo', inactivo:'cst-inactivo' };
    const statusLabel = { habilitado:'✅ Habilitado', deshabilitado:'🚫 Deshabilitado', activo:'✅ Habilitado', inactivo:'🚫 Deshabilitado' };
    const stCls    = statusMap[c.status] || 'cst-activo';
    // Ranking: bronce / plata / oro / vip (independiente del estado)
    const rankingMap   = { vip:'cst-vip', oro:'cst-oro', plata:'cst-plata', bronce:'cst-bronce' };
    const rankingLabel = { vip:'💎 VIP', oro:'🥇 Oro', plata:'🥈 Plata', bronce:'🥉 Bronce' };
    const rkVal  = (c.ranking || c.loyaltyTier || 'bronce').toLowerCase();
    const rkCls  = rankingMap[rkVal]  || 'cst-bronce';
    const rkLbl  = rankingLabel[rkVal] || '🥉 Bronce';
    const initials = c.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    // Indicador de acceso a la tienda (tiene contraseña?)
    const accessIcon = c.password
      ? `<span title="Puede iniciar sesión en la tienda" style="display:inline-flex;align-items:center;gap:3px;background:#e8f5ee;color:#1a7c3e;border-radius:12px;padding:2px 8px;font-size:.72rem;font-weight:600"><i class="fas fa-circle-check"></i> Acceso</span>`
      : `<span title="Sin contraseña — no puede entrar a la tienda" style="display:inline-flex;align-items:center;gap:3px;background:#fff3cd;color:#856404;border-radius:12px;padding:2px 8px;font-size:.72rem;font-weight:600"><i class="fas fa-lock"></i> Sin acceso</span>`;
    return `
    <tr>
      <td><strong>${i+1}</strong></td>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="cust-avatar">${initials}</div>
          <div>
            <div style="font-weight:600">${c.name}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px">
              <span class="cust-status ${stCls}">${statusLabel[c.status]||'✅ Habilitado'}</span>
              <span class="cust-status ${rkCls}">${rkLbl}</span>
              ${accessIcon}
              ${loyaltyBadgeHTML(c.loyaltyPoints || 0)}
            </div>
          </div>
        </div>
      </td>
      <td>${c.email}</td>
      <td>${c.phone || '&mdash;'}</td>
      <td style="max-width:160px;font-size:0.83rem;color:#555">${c.address || '&mdash;'}</td>
      <td><strong>${c.orders}</strong></td>
      <td><strong style="color:#1a7c3e">RD$ ${fmt$(c.spent||0)}</strong></td>
      <td>${c.lastOrder || '&mdash;'}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn action-btn-view" onclick="viewCustomerDetail('${c.id}')" title="Ver detalle"><i class="fas fa-eye"></i></button>
          <button class="action-btn" onclick="openAdjustPointsModal('${c.id}')" title="Puntos" style="background:#f3eeff;color:#7c3aed;border:1px solid #d8b4fe"><i class="fas fa-star"></i></button>
          <button class="action-btn action-btn-edit" onclick="openCustomerModal('${c.id}')" title="Editar"><i class="fas fa-pen"></i></button>
          <button class="action-btn action-btn-del"  onclick="askDeleteCustomer('${c.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  _renderPaginator('custPaginator', pg, total, 'customers', 'customersTable');
}

function openCustomerModal(id) {
  editingCustomerId = id || null;
  const isEdit = !!id;
  document.getElementById('custModalTitle').textContent = isEdit ? 'Editar Cliente' : 'Nuevo Cliente';

  // Ajustar etiquetas e indicadores de contraseña según modo
  const passHint = document.getElementById('cPassHint');
  const passReq  = document.getElementById('cPassReq');
  const pass2Req = document.getElementById('cPass2Req');
  if (isEdit) {
    if (passHint) passHint.classList.remove('hidden');
    if (passReq)  passReq.style.display  = 'none';
    if (pass2Req) pass2Req.style.display = 'none';
  } else {
    if (passHint) passHint.classList.add('hidden');
    if (passReq)  passReq.style.display  = '';
    if (pass2Req) pass2Req.style.display = '';
  }

  // Limpiar contraseñas siempre
  const cp  = document.getElementById('cPassword');
  const cp2 = document.getElementById('cPassword2');
  if (cp)  cp.value  = '';
  if (cp2) cp2.value = '';

  if (isEdit) {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    document.getElementById('cName').value    = c.name    || '';
    document.getElementById('cEmail').value   = c.email   || '';
    setPhoneValue('cPhone', 'cPhonePrefix', c.phone || '');
    document.getElementById('cCedula').value  = c.cedula  || '';
    document.getElementById('cAddress').value = c.address || '';
    document.getElementById('cCity').value    = c.city    || '';
    // Normalizar status legacy (activo→habilitado, inactivo→deshabilitado)
    const rawStatus = (c.status || 'habilitado').toLowerCase();
    const normStatus = rawStatus === 'activo' ? 'habilitado' : rawStatus === 'inactivo' ? 'deshabilitado' : rawStatus;
    document.getElementById('cStatus').value   = normStatus;
    // Ranking
    const rawRanking = (c.ranking || c.loyaltyTier || 'bronce').toLowerCase();
    document.getElementById('cRanking').value  = rawRanking;
    document.getElementById('cNotes').value   = c.notes   || '';
    document.getElementById('cMapLink').value = c.mapLink || '';
    previewCustMap();
  } else {
    setPhoneValue('cPhone', 'cPhonePrefix', '');
    ['cName','cEmail','cCedula','cAddress','cCity','cNotes','cMapLink'].forEach(f => {
      document.getElementById(f).value = '';
    });
    document.getElementById('cStatus').value  = 'habilitado';
    document.getElementById('cRanking').value = 'bronce';
    previewCustMap();
  }
  document.getElementById('custModalBackdrop').classList.remove('hidden');
  setTimeout(() => document.getElementById('cName').focus(), 100);
}

/** Resalta un campo en rojo para indicar error de validación */
function _markError(fieldId) {
  const el = document.getElementById(fieldId);
  if (el) {
    el.style.borderColor = '#e53935';
    el.style.boxShadow   = '0 0 0 2px rgba(229,57,53,.18)';
    // Quitar el rojo cuando el usuario empieza a corregir
    el.addEventListener('input', function clear() {
      el.style.borderColor = '';
      el.style.boxShadow   = '';
      el.removeEventListener('input', clear);
    }, { once: true });
  }
}

function toggleCustPass(fieldId, iconId) {
  const inp  = document.getElementById(fieldId);
  const icon = document.getElementById(iconId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  if (icon) icon.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
}

function closeCustomerModal() {
  _savingCustomer = false;
  document.getElementById('custModalBackdrop').classList.add('hidden');
  editingCustomerId = null;
  const cp  = document.getElementById('cPassword');
  const cp2 = document.getElementById('cPassword2');
  if (cp)  cp.value  = '';
  if (cp2) cp2.value = '';
  const ml = document.getElementById('cMapLink');
  if (ml) ml.value = '';
  previewCustMap();
}

// ── Preview del mapa en el modal de cliente ───────────────────────────────────
function previewCustMap() {
  const url     = (document.getElementById('cMapLink')?.value || '').trim();
  const preview = document.getElementById('cMapPreview');
  const frame   = document.getElementById('cMapFrame');
  const btn     = document.getElementById('cMapLinkBtn');
  if (!preview || !frame) return;

  if (!url) {
    preview.style.display = 'none';
    if (btn) btn.style.display = 'none';
    frame.src = '';
    return;
  }

  // Mostrar botón "Ver"
  if (btn) { btn.href = url; btn.style.display = ''; }

  // Construir src embebible para el iframe
  let embedSrc = '';
  // Formato: https://www.google.com/maps/embed?pb=... (ya embebible)
  if (url.includes('maps/embed')) {
    embedSrc = url;
  }
  // Formato: https://maps.google.com/maps?q=... o https://www.google.com/maps?q=...
  else if (url.includes('maps.google.com') || url.includes('google.com/maps')) {
    // Transformar URL normal a embed
    embedSrc = url
      .replace('https://www.google.com/maps', 'https://www.google.com/maps/embed')
      .replace('https://maps.google.com/maps', 'https://www.google.com/maps/embed');
    if (!embedSrc.includes('/embed')) {
      // Fallback: usar q= param
      const qMatch = url.match(/[?&]q=([^&]+)/);
      const place  = qMatch ? qMatch[1] : encodeURIComponent(url);
      embedSrc = `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU3MeQ&q=${place}`;
    }
  }
  // Formato corto goo.gl/maps o maps.app.goo.gl
  else if (url.includes('goo.gl') || url.includes('maps.app')) {
    // No se puede embeber directamente; mostrar sólo el botón
    preview.style.display = 'none';
    return;
  }

  if (embedSrc) {
    frame.src = embedSrc;
    preview.style.display = '';
  } else {
    preview.style.display = 'none';
  }
}

let _savingCustomer = false;
function saveCustomer() {
  if (_savingCustomer) return;
  const name     = document.getElementById('cName').value.trim();
  const email    = document.getElementById('cEmail').value.trim();
  const phone    = document.getElementById('cPhone')?.value.trim() || '';
  const cedula   = document.getElementById('cCedula').value.trim();
  const address  = document.getElementById('cAddress').value.trim();
  const city     = document.getElementById('cCity').value.trim();
  const password = document.getElementById('cPassword')?.value  || '';
  const password2= document.getElementById('cPassword2')?.value || '';

  // ── Resetear bordes de error anteriores ──────────────────────────────────────
  ['cName','cEmail','cPhone','cCedula','cAddress','cCity'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.borderColor = '';
  });

  // ── Validar campos obligatorios ───────────────────────────────────────────────
  const missing = [];
  if (!name)    { missing.push('Nombre completo'); _markError('cName'); }
  if (!email)   { missing.push('Email');           _markError('cEmail'); }
  if (!phone)   { missing.push('Teléfono');        _markError('cPhone'); }
  if (!cedula)  { missing.push('Cédula / RNC');    _markError('cCedula'); }
  if (!address) { missing.push('Dirección');       _markError('cAddress'); }
  if (!city)    { missing.push('Ciudad');          _markError('cCity'); }

  if (missing.length > 0) {
    showAdminToast(
      `Faltan campos obligatorios: ${missing.join(', ')}`,
      'error'
    );
    return;
  }

  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    _markError('cEmail');
    showAdminToast('El email no tiene un formato válido', 'error'); return;
  }
  const duplicate = customers.find(c => c.email === email && c.id !== editingCustomerId);
  if (duplicate) { _markError('cEmail'); showAdminToast('Ya existe un cliente con ese email', 'error'); return; }

  // Contraseña: obligatoria en creación, opcional en edición
  if (!editingCustomerId && !password) {
    showAdminToast('La contraseña es obligatoria para crear el acceso del cliente', 'error'); return;
  }
  if (password && password.length < 6) {
    showAdminToast('La contraseña debe tener al menos 6 caracteres', 'error'); return;
  }
  if (password && password !== password2) {
    showAdminToast('Las contraseñas no coinciden', 'error'); return;
  }

  const now   = new Date();
  const today = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

  const data = {
    name,
    email,
    phone:   getPhoneValue('cPhone', 'cPhonePrefix'),
    cedula:  document.getElementById('cCedula').value.trim(),
    address: document.getElementById('cAddress').value.trim(),
    city:    document.getElementById('cCity').value.trim(),
    status:  document.getElementById('cStatus').value,
    ranking: document.getElementById('cRanking').value,
    notes:   document.getElementById('cNotes').value.trim(),
    mapLink: document.getElementById('cMapLink').value.trim(),
  };
  // Solo actualizar contraseña si se ingresó una nueva
  if (password) data.password = password;

  _savingCustomer = true;
  const _btnC = document.querySelector('#custModalBackdrop .btn-primary[onclick="saveCustomer()"]');
  if (_btnC) { _btnC.disabled = true; _btnC.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  const _unlockC = () => {
    _savingCustomer = false;
    if (_btnC) { _btnC.disabled = false; _btnC.innerHTML = '<i class="fas fa-save"></i> Guardar cliente'; }
  };

  if (editingCustomerId) {
    const idx = customers.findIndex(c => c.id === editingCustomerId);
    if (idx > -1) customers[idx] = { ...customers[idx], ...data };
    // ── PATCH: solo los campos del formulario (evita enviar campos JS que no existen en Supabase)
    DB.patchCustomer(editingCustomerId, data)
      .then(() => { _unlockC(); DBCached.invalidateCustomers(); renderCustomers(); closeCustomerModal(); showAdminToast('Cliente actualizado correctamente', 'success'); })
      .catch(err => {
        // Si el error es que la columna 'ranking' no existe aún en Supabase,
        // reintentamos sin ese campo y avisamos al admin
        const msg = err?.message || '';
        if (msg.includes('ranking') && msg.includes('PGRST204')) {
          console.warn('Columna ranking no existe en Supabase — guardando sin ranking');
          const { ranking: _r, ...dataWithoutRanking } = data;
          DB.patchCustomer(editingCustomerId, dataWithoutRanking)
            .then(() => { _unlockC(); DBCached.invalidateCustomers(); renderCustomers(); closeCustomerModal(); showAdminToast('Cliente actualizado (ejecuta supabase_ranking_column.sql para activar el campo Ranking)', 'warning'); })
            .catch(err2 => { _unlockC(); console.error('saveCustomer PATCH error:', err2); showAdminToast('Error al guardar cliente: ' + (err2?.message || err2), 'error'); });
        } else {
          _unlockC(); console.error('saveCustomer PATCH error:', err); showAdminToast('Error al guardar cliente: ' + (err?.message || err), 'error');
        }
      });
  } else {
    // ── Solo enviamos a Supabase los campos que existen en la tabla ──────────
    const newC = {
      // NO incluir id: Supabase lo genera como UUID automáticamente
      name:                 data.name,
      email:                data.email,
      phone:                data.phone    || '',
      cedula:               data.cedula   || '',
      address:              data.address  || '',
      city:                 data.city     || '',
      status:               data.status   || 'habilitado',
      ranking:              data.ranking  || 'bronce',
      notes:                data.notes    || '',
      mapLink:              data.mapLink  || '',
      password:             data.password || '',
      orders:               0,
      spent:                0,
      points:               0,
      loyaltyPoints:        0,
      loyaltyTier:          'bronze',
      loyaltyHistory:       [],
      loyaltyLastActivity:  Date.now(), // compatible con BIGINT y TEXT en Supabase
      access:               true,
      deleted:              false,
      // ⚠️ created_at / updated_at los pone _apiCreate automáticamente (BIGINT ms)
    };
    DB.createCustomer(newC)
      .then(saved => {
        // Añadir al array local con el registro real devuelto por Supabase (tiene UUID real)
        const record = saved || { ...newC, id: 'tmp_' + Date.now() };
        customers.push(record);
        _unlockC();
        DBCached.invalidateCustomers();
        renderCustomers();
        closeCustomerModal();
        showAdminToast('Cliente creado — ya puede iniciar sesión en la tienda', 'success');
      })
      .catch(err => { _unlockC(); console.error('createCustomer error:', err); showAdminToast('Error al crear cliente: ' + (err?.message || err), 'error'); });
  }
}

function askDeleteCustomer(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  deleteCustomerId = id;
  document.getElementById('custDeleteName').textContent = c.name;
  document.getElementById('custDeleteBackdrop').classList.remove('hidden');
}

function closeCustDeleteModal() {
  document.getElementById('custDeleteBackdrop').classList.add('hidden');
  deleteCustomerId = null;
}

function confirmDeleteCustomer() {
  if (!deleteCustomerId) return;
  DB.deleteCustomer(deleteCustomerId)
    .then(() => {
      customers = customers.filter(c => c.id !== deleteCustomerId);
      DBCached.invalidateCustomers();
      renderCustomers();
      closeCustDeleteModal();
      showAdminToast('Cliente eliminado', 'info');
    })
    .catch(() => showAdminToast('Error al eliminar cliente', 'error'));
}

function viewCustomerDetail(id) {
  const c = customers.find(x => x.id === id);
  if (!c) return;
  const statusLabel = { activo:'Activo', inactivo:'Inactivo', vip:'⭐ VIP' };
  const stCls = c.status === 'vip' ? 'cst-vip' : c.status === 'inactivo' ? 'cst-inactivo' : 'cst-activo';
  const initials = c.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();

  // Estado de acceso a la tienda
  const hasAccess = !!c.password;
  const accessBadge = hasAccess
    ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#e8f5ee;color:#1a7c3e;border:1px solid #b2dfcc;border-radius:20px;padding:3px 10px;font-size:.78rem;font-weight:700"><i class="fas fa-circle-check"></i> Acceso activo</span>`
    : `<span style="display:inline-flex;align-items:center;gap:5px;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:20px;padding:3px 10px;font-size:.78rem;font-weight:700"><i class="fas fa-triangle-exclamation"></i> Sin contraseña</span>`;

  document.getElementById('orderModalTitle').textContent = 'Perfil: ' + c.name;
  document.getElementById('orderModalBody').innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap">
      <div class="cust-avatar" style="width:60px;height:60px;font-size:1.5rem">${initials}</div>
      <div style="flex:1">
        <div style="font-size:1.2rem;font-weight:700;margin-bottom:6px">${c.name}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="cust-status ${stCls}">${statusLabel[c.status]||'Activo'}</span>
          ${accessBadge}
        </div>
      </div>
    </div>

    ${!hasAccess ? `
    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:.85rem;color:#795548">
      <i class="fas fa-info-circle" style="color:#f9a825;font-size:1rem"></i>
      <span>Este cliente <strong>no puede iniciar sesión</strong> en la tienda. <a href="javascript:void(0)" onclick="closeOrderModal();openCustomerModal('${c.id}')" style="color:#1a7c3e;font-weight:700;text-decoration:underline">Editar para asignar contraseña →</a></span>
    </div>` : ''}

    <div class="order-detail-grid">
      <div class="order-detail-item"><label>Email</label><span>${c.email}</span></div>
      <div class="order-detail-item"><label>Teléfono</label><span>${c.phone||'—'}</span></div>
      <div class="order-detail-item"><label>Cédula / RNC</label><span>${c.cedula||'—'}</span></div>
      <div class="order-detail-item"><label>Ciudad</label><span>${c.city||'—'}</span></div>
      <div class="order-detail-item"><label>Dirección</label><span>${c.address||'—'}</span></div>
      ${c.mapLink ? `<div class="order-detail-item" style="grid-column:1/-1"><label><i class="fas fa-location-dot" style="color:#e53935"></i> Ubicación en Maps</label><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px"><a href="${c.mapLink}" target="_blank" rel="noopener" class="btn-map-link"><i class="fas fa-map-location-dot"></i> Abrir en Google Maps</a><span style="font-size:.73rem;color:#aaa">Compartir con el repartidor</span></div></div>` : `<div class="order-detail-item"><label><i class="fas fa-location-dot" style="color:#ccc"></i> Ubicación Maps</label><span style="color:#bbb;font-size:.82rem">No registrada</span></div>`}
      <div class="order-detail-item"><label>Pedidos realizados</label><span><strong>${c.orders}</strong></span></div>
      <div class="order-detail-item"><label>Total gastado</label><span style="color:#1a7c3e;font-weight:700">RD$ ${fmt$(c.spent||0)}</span></div>
      <div class="order-detail-item"><label>Último pedido</label><span>${c.lastOrder||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-star" style="color:#7c3aed"></i> Puntos acumulados</label><span style="font-weight:800;font-size:1.05rem;color:#7c3aed">${(c.loyaltyPoints||0).toLocaleString('es-DO')} pts &nbsp;${loyaltyBadgeHTML(c.loyaltyPoints||0)}</span></div>
      ${c.createdAt ? `<div class="order-detail-item"><label>Registrado</label><span>${c.createdAt}</span></div>` : ''}
      ${c.lastLogin ? `<div class="order-detail-item"><label>Último acceso tienda</label><span>${c.lastLogin}</span></div>` : ''}
    </div>
    ${c.notes ? `<div style="margin-top:16px"><label style="font-size:0.8rem;color:#888;font-weight:600;display:block;margin-bottom:6px">NOTAS INTERNAS</label><p style="margin:0;padding:12px;background:#f8f9fa;border-radius:8px;font-size:0.9rem">${c.notes}</p></div>` : ''}
    <div style="margin-top:16px;display:flex;gap:10px">
      <button class="btn-secondary" style="flex:1" onclick="closeOrderModal();openCustomerModal('${c.id}')"><i class="fas fa-pen"></i> Editar cliente</button>
      <button style="flex:1;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;font-size:.88rem;display:flex;align-items:center;justify-content:center;gap:6px" onclick="closeOrderModal();openAdjustPointsModal('${c.id}')"><i class="fas fa-star"></i> Gestionar puntos</button>
    </div>`;
  document.getElementById('orderModalBackdrop').classList.remove('hidden');
}

// saveCustomers() ya no usa localStorage — operaciones individuales con DB
function saveCustomers() {
  // Deprecated: cada operación ahora llama directamente a DB.updateCustomer / DB.createCustomer
}

// ─── PERSONAL (CRUD completo) ─────────────────────────────────────────────────
function renderStaff() {
  // staffList ya está en memoria (cargado desde API en initAdminData)
  const q      = (document.getElementById('staffSearch')?.value || '').toLowerCase();
  const role   = document.getElementById('staffRoleFilter')?.value  || '';
  const status = document.getElementById('staffStatusFilter')?.value || '';

  let list = staffList.filter(s => {
    const fullName = (s.firstName + ' ' + s.lastName).toLowerCase();
    const matchQ = !q || fullName.includes(q) || s.email.toLowerCase().includes(q) || (s.cargo||'').toLowerCase().includes(q);
    const matchR = !role   || s.role   === role;
    const matchS = !status || s.status === status;
    return matchQ && matchR && matchS;
  });

  // KPIs
  document.getElementById('staffTotal').textContent      = staffList.length;
  document.getElementById('staffSuperadmin').textContent = staffList.filter(s=>s.role==='superadmin').length;
  document.getElementById('staffAdmin').textContent      = staffList.filter(s=>s.role==='admin').length;
  document.getElementById('staffOperador').textContent   = staffList.filter(s=>s.role==='operador').length;

  const total = list.length;
  const pg    = _pages.staff;
  const start = (pg - 1) * PAGE_SIZE;
  const page  = list.slice(start, start + PAGE_SIZE);
  const from  = total === 0 ? 0 : start + 1;
  const to    = Math.min(start + PAGE_SIZE, total);

  document.getElementById('staffCount').textContent =
    total === 0 ? 'Sin resultados' : `${from}–${to} de ${total} empleado${total !== 1 ? 's' : ''}`;

  const roleColors = { superadmin:'#7c3aed', admin:'#1565c0', operador:'#1a7c3e' };
  const roleLabels = { superadmin:'Super Admin', admin:'Administrador', operador:'Operador' };
  const roleIcons  = { superadmin:'fa-crown', admin:'fa-user-shield', operador:'fa-user-gear' };

  // Saber si el usuario actual puede gestionar personal
  const canManage = currentSession && getRole(currentSession.role).canManageStaff;
  // No permitir eliminar la propia cuenta
  const myId = currentSession ? currentSession.id : null;

  document.getElementById('staffTbody').innerHTML = page.map((s,i) => {
    const initials = (s.firstName[0] + s.lastName[0]).toUpperCase();
    const color    = roleColors[s.role] || '#1a7c3e';
    const statusCls = s.status === 'activo' ? 'sstatus-activo' : 'sstatus-inactivo';
    const isMe = s.id === myId;
    return `
    <tr${isMe ? ' style="background:rgba(26,124,62,.04)"' : ''}>
      <td><strong>${i+1}</strong>${isMe ? ' <span style="font-size:.7rem;background:#e8f5ee;color:#1a7c3e;padding:1px 6px;border-radius:10px;font-weight:700">Tú</span>' : ''}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="staff-avatar" style="background:${color}">${initials}</div>
          <div>
            <div style="font-weight:600">${s.firstName} ${s.lastName}</div>
            <div style="font-size:.78rem;color:#888">${s.cedula || ''}</div>
          </div>
        </div>
      </td>
      <td>${s.cargo || '&mdash;'}</td>
      <td>${s.email}</td>
      <td>${s.phone || '&mdash;'}</td>
      <td><span class="role-badge role-${s.role}"><i class="fas ${roleIcons[s.role]}"></i> ${roleLabels[s.role]}</span></td>
      <td><span class="staff-status ${statusCls}">${s.status === 'activo' ? 'Activo' : 'Inactivo'}</span></td>
      <td style="font-size:.8rem;color:#888">${s.lastLogin || 'Nunca'}</td>
      <td>
        <div class="action-btns">
          ${canManage ? `
          <button class="action-btn action-btn-edit" onclick="openStaffModal('${s.id}')" title="Editar"><i class="fas fa-pen"></i></button>
          ${!isMe ? `<button class="action-btn action-btn-del" onclick="askDeleteStaff('${s.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
          ` : '<span style="color:#bbb;font-size:.78rem">Sin permiso</span>'}
        </div>
      </td>
    </tr>`;
  }).join('');

  _renderPaginator('staffPaginator', pg, total, 'staff', 'staffTable');
}

function openStaffModal(id) {
  editingStaffId = id || null;
  const isEdit = !!id;
  document.getElementById('staffModalTitle').textContent = isEdit ? 'Editar Empleado' : 'Nuevo Empleado';

  // Hint de contraseña en modo edición
  const hint  = document.getElementById('sPassHint');
  const pLbl  = document.getElementById('sPassLabel');
  const p2Lbl = document.getElementById('sPass2Label');
  if (isEdit) {
    if (hint)  hint.textContent  = 'Dejar en blanco para no cambiar la contraseña.';
    if (pLbl)  pLbl.innerHTML    = 'Nueva contraseña';
    if (p2Lbl) p2Lbl.innerHTML   = 'Confirmar nueva contraseña';
  } else {
    if (hint)  hint.textContent  = '';
    if (pLbl)  pLbl.innerHTML    = 'Contraseña <span class="req">*</span>';
    if (p2Lbl) p2Lbl.innerHTML   = 'Confirmar contraseña <span class="req">*</span>';
  }

  if (isEdit) {
    const s = staffList.find(x => x.id === id);
    if (!s) return;
    document.getElementById('sFirstName').value = s.firstName || '';
    document.getElementById('sLastName').value  = s.lastName  || '';
    document.getElementById('sCedula').value    = s.cedula    || '';
    setPhoneValue('sPhone', 'sPhonePrefix', s.phone || '');
    document.getElementById('sCargo').value     = s.cargo     || '';
    document.getElementById('sRole').value      = s.role      || 'operador';
    document.getElementById('sEmail').value     = s.email     || '';
    document.getElementById('sPassword').value  = '';
    document.getElementById('sPassword2').value = '';
    document.getElementById('sNotes').value     = s.notes     || '';
    // Estado
    document.querySelectorAll('input[name="sStatus"]').forEach(r => {
      r.checked = r.value === s.status;
    });
  } else {
    setPhoneValue('sPhone', 'sPhonePrefix', '');
    ['sFirstName','sLastName','sCedula','sCargo','sEmail','sPassword','sPassword2','sNotes'].forEach(f => {
      document.getElementById(f).value = '';
    });
    document.getElementById('sRole').value = 'operador';
    document.querySelectorAll('input[name="sStatus"]').forEach(r => {
      r.checked = r.value === 'activo';
    });
  }

  updateStaffAvatar();
  updateRolePermissions();
  document.getElementById('staffModalBackdrop').classList.remove('hidden');
  setTimeout(() => document.getElementById('sFirstName').focus(), 100);
}

function closeStaffModal() {
  _savingStaff = false;
  document.getElementById('staffModalBackdrop').classList.add('hidden');
  editingStaffId = null;
}

let _savingStaff = false;
function saveStaff() {
  if (_savingStaff) return;
  const firstName = document.getElementById('sFirstName').value.trim();
  const lastName  = document.getElementById('sLastName').value.trim();
  const email     = document.getElementById('sEmail').value.trim();
  const password  = document.getElementById('sPassword').value;
  const password2 = document.getElementById('sPassword2').value;
  const cargo     = document.getElementById('sCargo').value.trim();
  const role      = document.getElementById('sRole').value;
  const status    = document.querySelector('input[name="sStatus"]:checked')?.value || 'activo';

  // Validaciones
  if (!firstName) { showAdminToast('El nombre es obligatorio', 'error'); return; }
  if (!lastName)  { showAdminToast('El apellido es obligatorio', 'error'); return; }
  if (!cargo)     { showAdminToast('El cargo es obligatorio', 'error'); return; }
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    showAdminToast('El email no es válido', 'error'); return;
  }
  // Email duplicado
  const dup = staffList.find(s => s.email.toLowerCase() === email.toLowerCase() && s.id !== editingStaffId);
  if (dup) { showAdminToast('Ya existe un empleado con ese email', 'error'); return; }

  // Cédula y Teléfono obligatorios
  const sCedula = document.getElementById('sCedula').value.trim();
  const sPhone  = document.getElementById('sPhone')?.value.trim() || '';
  const missingS = [];
  if (!sCedula) { missingS.push('Cédula'); _markError('sCedula'); }
  if (!sPhone)  { missingS.push('Teléfono'); _markError('sPhone'); }
  if (missingS.length > 0) {
    showAdminToast(`Faltan campos obligatorios: ${missingS.join(', ')}`, 'error');
    return;
  }

  // Contraseña (obligatoria solo en creación)
  if (!editingStaffId && !password) {
    showAdminToast('La contraseña es obligatoria', 'error'); return;
  }
  if (password && password.length < 6) {
    showAdminToast('La contraseña debe tener al menos 6 caracteres', 'error'); return;
  }
  if (password && password !== password2) {
    showAdminToast('Las contraseñas no coinciden', 'error'); return;
  }

  const now   = new Date();
  const today = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

  const data = {
    firstName,
    lastName,
    email,
    cedula:  document.getElementById('sCedula').value.trim(),
    phone:   getPhoneValue('sPhone', 'sPhonePrefix'),
    cargo,
    role,
    status,
    notes:   document.getElementById('sNotes').value.trim(),
  };
  if (password) data.password = password;

  _savingStaff = true;
  const _btnS = document.querySelector('#staffModalBackdrop .btn-primary[onclick="saveStaff()"]');
  if (_btnS) { _btnS.disabled = true; _btnS.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  const _unlockS = () => {
    _savingStaff = false;
    if (_btnS) { _btnS.disabled = false; _btnS.innerHTML = '<i class="fas fa-save"></i> Guardar empleado'; }
  };

  if (editingStaffId) {
    const idx = staffList.findIndex(s => s.id === editingStaffId);
    if (idx > -1) staffList[idx] = { ...staffList[idx], ...data };
    // Actualizar sesión si se edita la propia cuenta
    if (currentSession && currentSession.id === editingStaffId) {
      const { password: _pw, ...safe } = staffList[idx];
      setSession(safe);
      currentSession = safe;
      applyPermissions(currentSession);
    }
    DB.patchStaff(editingStaffId, data)
      .then(() => { _unlockS(); DBCached.invalidateStaff(); renderStaff(); closeStaffModal(); showAdminToast('Empleado actualizado correctamente', 'success'); })
      .catch(err => { _unlockS(); console.error('saveStaff PATCH error:', err); showAdminToast('Error al guardar empleado: ' + (err?.message || err), 'error'); });
  } else {
    // ── Nuevo empleado: solo campos que existen en la tabla staff de Supabase ──
    // NO incluir id (Supabase lo genera como UUID), ni campos JS internos
    const newS = {
      firstName,
      lastName,
      email,
      cedula:    document.getElementById('sCedula').value.trim(),
      phone:     getPhoneValue('sPhone', 'sPhonePrefix'),
      cargo,
      role,
      status,
      notes:     document.getElementById('sNotes').value.trim(),
      avatar:    '',
      lastLogin: null,
    };
    if (password) newS.password = password;

    DB.createStaff(newS)
      .then(saved => {
        const record = saved || { ...newS, id: 'tmp_' + Date.now() };
        staffList.push(record);
        _unlockS();
        DBCached.invalidateStaff();
        renderStaff();
        closeStaffModal();
        showAdminToast('Empleado creado correctamente', 'success');
      })
      .catch(err => { _unlockS(); console.error('createStaff error:', err); showAdminToast('Error al crear empleado: ' + (err?.message || err), 'error'); });
  }
}

function askDeleteStaff(id) {
  const s = staffList.find(x => x.id === id);
  if (!s) return;
  deleteStaffId = id;
  document.getElementById('staffDeleteName').textContent = s.firstName + ' ' + s.lastName;
  document.getElementById('staffDeleteBackdrop').classList.remove('hidden');
}

function closeStaffDeleteModal() {
  document.getElementById('staffDeleteBackdrop').classList.add('hidden');
  deleteStaffId = null;
}

function confirmDeleteStaff() {
  if (!deleteStaffId) return;
  if (deleteStaffId === currentSession?.id) {
    showAdminToast('No puedes eliminar tu propia cuenta', 'error');
    closeStaffDeleteModal();
    return;
  }
  DB.deleteStaff(deleteStaffId)
    .then(() => {
      staffList = staffList.filter(s => s.id !== deleteStaffId);
      DBCached.invalidateStaff();
      renderStaff();
      closeStaffDeleteModal();
      showAdminToast('Empleado eliminado', 'info');
    })
    .catch(() => showAdminToast('Error al eliminar empleado', 'error'));
}

// ─── Helpers del modal Personal ──────────────────────────────────────────────
function updateStaffAvatar() {
  const fn = document.getElementById('sFirstName')?.value || '';
  const ln = document.getElementById('sLastName')?.value  || '';
  const initials = ((fn[0]||'') + (ln[0]||'')).toUpperCase() || '??';
  const preview  = document.getElementById('staffAvatarPreview');
  if (preview) preview.textContent = initials;
}

function updateRolePermissions() {
  const roleKey = document.getElementById('sRole')?.value || 'operador';
  const role    = getRole(roleKey);
  const colors  = { superadmin:'#7c3aed', admin:'#1565c0', operador:'#1a7c3e' };
  const color   = colors[roleKey] || '#1a7c3e';

  // Actualizar color del avatar
  const preview = document.getElementById('staffAvatarPreview');
  if (preview) preview.style.background = `linear-gradient(135deg, ${color}, ${color}aa)`;

  const perms = [
    { label: 'Ver Dashboard',        key: 'sections', val: 'dashboard' },
    { label: 'Gestionar Productos',  key: 'canCreateProducts' },
    { label: 'Cambiar Precios',      key: 'canEditPrices' },
    { label: 'Eliminar Productos',   key: 'canDeleteProducts' },
    { label: 'Gestionar Pedidos',    key: 'sections', val: 'orders' },
    { label: 'Control Inventario',   key: 'sections', val: 'inventory' },
    { label: 'Gestionar Clientes',   key: 'sections', val: 'customers' },
    { label: 'Gestionar Personal',   key: 'canManageStaff' },
    { label: 'Configuración',        key: 'canManageSettings' },
  ];

  const container = document.getElementById('rolePermissions');
  if (!container) return;
  container.innerHTML = perms.map(p => {
    let allowed;
    if (p.val) {
      allowed = role.sections.includes(p.val);
    } else {
      allowed = !!role[p.key];
    }
    return `<span class="perm-chip ${allowed?'perm-yes':'perm-no'}">
      <i class="fas ${allowed?'fa-check':'fa-xmark'}"></i> ${p.label}
    </span>`;
  }).join('');
}

function toggleStaffPass(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.className = 'fas fa-eye-slash';
  } else {
    input.type = 'password';
    if (icon) icon.className = 'fas fa-eye';
  }
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'cm_settings';

// Campos y sus valores por defecto
const SETTINGS_FIELDS = {
  settingName:        'Supermercado Casa Mota',
  settingAddress:     'Av. Winston Churchill #35, Santo Domingo',
  settingPhone:       '(809) 555-2684',
  settingEmail:       'info@casamota.com.do',
  settingShipping:    '150',
  settingFreeShipping:'1500',
  settingZone:        'Santo Domingo, Santiago, La Romana',
  settingHoursWk:     '7:00 AM – 10:00 PM',
  settingHoursSun:    '8:00 AM – 8:00 PM',
};

async function loadSettings() {
  let saved = {};
  try { saved = await DB.getSettings(); } catch(e) { saved = {}; }
  // mapeo campo HTML → campo API (todos los campos)
  const apiMap = {
    settingName:         'storeName',
    settingAddress:      'storeAddress',
    settingPhone:        'storePhone',
    settingEmail:        'storeEmail',
    settingShipping:     'shippingFee',
    settingFreeShipping: 'freeShippingMin',
    settingZone:         'serviceZones',
    settingHoursWk:      'hoursWeekday',
    settingHoursSun:     'hoursSunday',
  };
  Object.keys(SETTINGS_FIELDS).forEach(id => {
    const apiKey = apiMap[id];
    const val = apiKey && saved[apiKey] !== undefined ? String(saved[apiKey]) : SETTINGS_FIELDS[id];
    if (id === 'settingPhone') {
      setPhoneValue('settingPhone', 'settingPhonePrefix', val);
    } else {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
  });
}

function saveSettings() {
  const data = {};
  let allOk  = true;

  // Validaciones básicas
  const name = document.getElementById('settingName')?.value.trim();
  if (!name) { showAdminToast('El nombre de la tienda no puede estar vacío', 'error'); allOk = false; }

  const email = document.getElementById('settingEmail')?.value.trim();
  if (email && !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    showAdminToast('El email no tiene un formato válido', 'error'); allOk = false;
  }

  if (!allOk) return;

  // ── Bloquear TODOS los botones de guardar configuración ──────────────────
  const settingsBtns = document.querySelectorAll('#sec-settings button[onclick="saveSettings()"]');
  settingsBtns.forEach(btn => {
    btn.disabled = true;
    btn._originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
  });

  const _restoreSettingsBtns = () => {
    settingsBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = btn._originalHTML;
    });
  };

  Object.keys(SETTINGS_FIELDS).forEach(id => {
    if (id === 'settingPhone') {
      data[id] = getPhoneValue('settingPhone', 'settingPhonePrefix');
    } else {
      const el = document.getElementById(id);
      if (el) data[id] = el.value.trim();
    }
  });

  // Leer configuración actual para no perder campos no editables (loyalty, etc.)
  DB.getSettings().then(current => {
    const apiData = {
      ...current,                                          // preservar loyalty y otros campos
      storeName:       data.settingName         || '',
      storeAddress:    data.settingAddress      || '',
      storePhone:      data.settingPhone        || '',
      storeEmail:      data.settingEmail        || '',
      shippingFee:     parseFloat(data.settingShipping     || 150),
      freeShippingMin: parseFloat(data.settingFreeShipping || 1500),
      serviceZones:    data.settingZone         || '',
      hoursWeekday:    data.settingHoursWk      || '',
      hoursSunday:     data.settingHoursSun     || '',
    };
    return DB.saveSettings(apiData);
  })
    .then(() => {
      DBCached.invalidateSettings();
      _restoreSettingsBtns();
      showAdminToast('✅ Configuración guardada correctamente', 'success');
    })
    .catch(() => {
      _restoreSettingsBtns();
      showAdminToast('Error al guardar configuración', 'error');
    });
}

// ─── REPARTIDORES ─────────────────────────────────────────────────────────────
const DRIVERS_KEY = 'cm_drivers'; // mantenido por compatibilidad
let drivers = []; // cargado desde API en initAdminData
let editingDriverId = null;
let deleteDriverId  = null;

const _debouncedRenderDrivers = debounce(() => renderDrivers(), 220);

function getDrivers()   { return drivers; }
function saveDriversLS(){ /* Deprecated: usar DB.createDriver / DB.updateDriver */ }

// ── Render tabla ──────────────────────────────────────────────────────────────
function renderDrivers() {
  const q       = (document.getElementById('drvSearch')?.value       || '').toLowerCase();
  const stFilt  = document.getElementById('drvStatusFilter')?.value  || '';
  const vhFilt  = document.getElementById('drvVehicleFilter')?.value || '';

  const list = drivers.filter(d => {
    const matchQ  = !q      || d.name.toLowerCase().includes(q) || (d.phone||'').includes(q) || (d.zone||'').toLowerCase().includes(q);
    const matchSt = !stFilt || d.status  === stFilt;
    const matchVh = !vhFilt || d.vehicle === vhFilt;
    return matchQ && matchSt && matchVh;
  });

  // KPIs globales (sobre todos, no sobre filtro)
  const allOrders = orders;
  document.getElementById('drvTotal').textContent     = drivers.length;
  document.getElementById('drvActive').textContent    = drivers.filter(d => d.status === 'activo' || d.status === 'en_ruta').length;
  document.getElementById('drvOnRoute').textContent   = drivers.filter(d => d.status === 'en_ruta').length;
  document.getElementById('drvDelivered').textContent = drivers.reduce((s,d) => s + _driverDelivered(d.id, allOrders), 0);
  document.getElementById('drvCount').textContent     = `${list.length} repartidor${list.length!==1?'es':''}`;

  const statusCfg = {
    activo:   { cls:'drv-activo',   label:'Activo',   icon:'fa-circle-check' },
    en_ruta:  { cls:'drv-en-ruta',  label:'En ruta',  icon:'fa-motorcycle'   },
    descanso: { cls:'drv-descanso', label:'Descanso', icon:'fa-mug-hot'      },
    inactivo: { cls:'drv-inactivo', label:'Inactivo', icon:'fa-circle-xmark' },
  };
  const vehicleIcon = { moto:'fa-motorcycle', bicicleta:'fa-bicycle', carro:'fa-car', a_pie:'fa-person-walking' };
  const vehicleLabel= { moto:'Moto', bicicleta:'Bicicleta', carro:'Carro', a_pie:'A pie' };

  const tbody = document.getElementById('driversTbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#aaa;padding:30px">No hay repartidores que coincidan con el filtro</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(d => {
    const st   = statusCfg[d.status] || statusCfg.activo;
    const ini  = d.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    const asgn = _driverAssigned(d.id, allOrders);
    const delv = _driverDelivered(d.id, allOrders);
    const pend = _driverPending(d.id, allOrders);
    const wBtn = d.whatsapp || d.phone
      ? `<a href="https://wa.me/${(d.whatsapp||d.phone).replace(/[^+\d]/g,'')}" target="_blank" class="drv-wa-btn" title="WhatsApp"><i class="fab fa-whatsapp"></i></a>`
      : '';
    return `
      <tr>
        <td><div class="drv-avatar">${ini}</div></td>
        <td><strong style="font-size:.9rem">${d.name}</strong><br><small style="color:#aaa;font-size:.73rem">${d.cedula||''}</small></td>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:.85rem">${d.phone||'—'}</span>
            ${wBtn}
          </div>
        </td>
        <td><span class="drv-vehicle"><i class="fas ${vehicleIcon[d.vehicle]||'fa-motorcycle'}"></i> ${vehicleLabel[d.vehicle]||d.vehicle}</span></td>
        <td><span class="drv-status ${st.cls}"><i class="fas ${st.icon}"></i> ${st.label}</span></td>
        <td style="text-align:center"><span class="drv-num drv-num-total">${asgn}</span></td>
        <td style="text-align:center"><span class="drv-num drv-num-ok">${delv}</span></td>
        <td style="text-align:center"><span class="drv-num drv-num-pend">${pend}</span></td>
        <td style="font-size:.82rem;color:#666">${d.zone||'—'}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn" style="background:#e8f0ff;color:#1a56c4" onclick="viewDriverDetail('${d.id}')" title="Ver perfil"><i class="fas fa-eye"></i></button>
            <button class="action-btn action-btn-edit" onclick="openDriverModal('${d.id}')" title="Editar"><i class="fas fa-pen"></i></button>
            <button class="action-btn action-btn-del" onclick="deleteDriver('${d.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ── Helpers de pedidos por repartidor ─────────────────────────────────────────
function _driverAssigned(drvId, allOrders) {
  return allOrders.filter(o => o.driverId === drvId).length;
}
function _driverDelivered(drvId, allOrders) {
  return allOrders.filter(o => o.driverId === drvId && o.status === 'entregado').length;
}
function _driverPending(drvId, allOrders) {
  return allOrders.filter(o => o.driverId === drvId && ['pendiente','procesando','enviado'].includes(o.status)).length;
}

// ── Modal crear/editar ────────────────────────────────────────────────────────
function openDriverModal(id = null) {
  editingDriverId = id;
  document.getElementById('drvModalTitle').textContent = id ? 'Editar Repartidor' : 'Nuevo Repartidor';

  if (id) {
    const d = drivers.find(x => x.id === id);
    if (!d) return;
    document.getElementById('drvName').value      = d.name      || '';
    document.getElementById('drvCedula').value    = d.cedula    || '';
    setPhoneValue('drvPhone',    'drvPhonePrefix',    d.phone    || '');
    setPhoneValue('drvWhatsapp', 'drvWhatsappPrefix', d.whatsapp || '');
    document.getElementById('drvEmail').value     = d.email     || '';
    document.getElementById('drvStartDate').value = d.startDate || '';
    document.getElementById('drvVehicle').value   = d.vehicle   || 'moto';
    document.getElementById('drvPlate').value     = d.plate     || '';
    document.getElementById('drvZone').value      = d.zone      || '';
    document.getElementById('drvStatus').value    = d.status    || 'activo';
    document.getElementById('drvAddress').value   = d.address   || '';
    document.getElementById('drvNotes').value     = d.notes     || '';
  } else {
    setPhoneValue('drvPhone',    'drvPhonePrefix',    '');
    setPhoneValue('drvWhatsapp', 'drvWhatsappPrefix', '');
    ['drvName','drvCedula','drvEmail','drvPlate','drvZone','drvAddress','drvNotes'].forEach(f => {
      document.getElementById(f).value = '';
    });
    document.getElementById('drvVehicle').value   = 'moto';
    document.getElementById('drvStatus').value    = 'activo';
    document.getElementById('drvStartDate').value = new Date().toISOString().split('T')[0];
  }
  updateDrvAvatar();
  document.getElementById('drvModalBackdrop').classList.remove('hidden');
  setTimeout(() => document.getElementById('drvName').focus(), 100);
}

function closeDriverModal() {
  _savingDriver = false;
  document.getElementById('drvModalBackdrop').classList.add('hidden');
  editingDriverId = null;
}

function updateDrvAvatar() {
  const name = document.getElementById('drvName')?.value || '';
  const ini  = name.trim().split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
  const el   = document.getElementById('drvAvatarPreview');
  if (el) el.textContent = ini;
}

let _savingDriver = false;
function saveDriver() {
  if (_savingDriver) return;
  const name  = document.getElementById('drvName').value.trim();
  const phone = getPhoneValue('drvPhone', 'drvPhonePrefix');
  if (!name)  { showAdminToast('El nombre es obligatorio', 'error'); return; }
  if (!phone) { showAdminToast('El teléfono es obligatorio', 'error'); return; }

  // Cédula, Tipo de vehículo y Placa obligatorios
  const drvCedula  = document.getElementById('drvCedula').value.trim();
  const drvVehicle = document.getElementById('drvVehicle').value;
  const drvPlate   = document.getElementById('drvPlate').value.trim();
  const missingD   = [];
  if (!drvCedula)  { missingD.push('Cédula'); _markError('drvCedula'); }
  if (!drvVehicle) { missingD.push('Tipo de vehículo'); _markError('drvVehicle'); }
  if (!drvPlate)   { missingD.push('Placa / Matrícula'); _markError('drvPlate'); }
  if (missingD.length > 0) {
    showAdminToast(`Faltan campos obligatorios: ${missingD.join(', ')}`, 'error');
    return;
  }

  const data = {
    name,
    cedula:    document.getElementById('drvCedula').value.trim(),
    phone,
    whatsapp:  getPhoneValue('drvWhatsapp', 'drvWhatsappPrefix'),
    email:     document.getElementById('drvEmail').value.trim(),
    startDate: document.getElementById('drvStartDate').value,
    vehicle:   document.getElementById('drvVehicle').value,
    plate:     document.getElementById('drvPlate').value.trim(),
    zone:      document.getElementById('drvZone').value.trim(),
    status:    document.getElementById('drvStatus').value,
    address:   document.getElementById('drvAddress').value.trim(),
    notes:     document.getElementById('drvNotes').value.trim(),
  };

  _savingDriver = true;
  const _btnD = document.querySelector('#drvModalBackdrop .btn-primary[onclick="saveDriver()"]');
  if (_btnD) { _btnD.disabled = true; _btnD.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  const _unlockD = () => {
    _savingDriver = false;
    if (_btnD) { _btnD.disabled = false; _btnD.innerHTML = '<i class="fas fa-save"></i> Guardar'; }
  };

  if (editingDriverId) {
    const idx = drivers.findIndex(d => d.id === editingDriverId);
    if (idx > -1) drivers[idx] = { ...drivers[idx], ...data };
    DB.patchDriver(editingDriverId, data)
      .then(() => { _unlockD(); DBCached.invalidateDrivers(); closeDriverModal(); renderDrivers(); showAdminToast('Repartidor actualizado correctamente', 'success'); })
      .catch(err => { _unlockD(); console.error('saveDriver PATCH error:', err); showAdminToast('Error al guardar repartidor: ' + (err?.message || err), 'error'); });
  } else {
    // NO incluir id ni campos JS internos — Supabase genera el UUID
    const newD = { ...data };
    DB.createDriver(newD)
      .then(saved => {
        const record = saved || { ...newD, id: 'tmp_' + Date.now() };
        drivers.push(record);
        _unlockD();
        DBCached.invalidateDrivers();
        closeDriverModal();
        renderDrivers();
        showAdminToast('Repartidor registrado correctamente', 'success');
      })
      .catch(err => { _unlockD(); console.error('createDriver error:', err); showAdminToast('Error al crear repartidor: ' + (err?.message || err), 'error'); });
  }
}

function deleteDriver(id) {
  const d = drivers.find(x => x.id === id);
  if (!d) return;
  if (!confirm(`¿Eliminar al repartidor "${d.name}"? Esta acción no se puede deshacer.`)) return;
  DB.deleteDriver(id)
    .then(() => { drivers = drivers.filter(x => x.id !== id); DBCached.invalidateDrivers(); renderDrivers(); showAdminToast('Repartidor eliminado', 'info'); })
    .catch(() => showAdminToast('Error al eliminar repartidor', 'error'));
}

// ── Vista de perfil detallado del repartidor ──────────────────────────────────
function viewDriverDetail(id) {
  const d = drivers.find(x => x.id === id);
  if (!d) return;

  const myOrders = orders.filter(o => o.driverId === id);
  const delivered = myOrders.filter(o => o.status === 'entregado');
  const pending   = myOrders.filter(o => ['pendiente','procesando','enviado'].includes(o.status));
  const cancelled = myOrders.filter(o => o.status === 'cancelado');
  const ini       = d.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();

  const statusCfg = {
    activo:   { cls:'drv-activo',   label:'Activo'  },
    en_ruta:  { cls:'drv-en-ruta',  label:'En ruta' },
    descanso: { cls:'drv-descanso', label:'Descanso'},
    inactivo: { cls:'drv-inactivo', label:'Inactivo'},
  };
  const st = statusCfg[d.status] || statusCfg.activo;

  const vehicleIcon = { moto:'fa-motorcycle', bicicleta:'fa-bicycle', carro:'fa-car', a_pie:'fa-person-walking' };
  const vehicleLabel= { moto:'Moto', bicicleta:'Bicicleta', carro:'Carro', a_pie:'A pie' };

  const waLink = d.whatsapp || d.phone
    ? `<a href="https://wa.me/${(d.whatsapp||d.phone).replace(/[^+\d]/g,'')}" target="_blank"
         style="display:inline-flex;align-items:center;gap:6px;background:#25d366;color:#fff;padding:5px 12px;border-radius:7px;text-decoration:none;font-size:.8rem;font-weight:700">
         <i class="fab fa-whatsapp"></i> WhatsApp
       </a>` : '';

  const ordersRowsHTML = myOrders.length > 0
    ? myOrders.slice(0,15).map(o => {
        const stO = { pendiente:'⏳', procesando:'⚙️', enviado:'🚚', entregado:'✅', cancelado:'❌' }[o.status] || '—';
        return `<tr>
          <td style="font-size:.82rem;font-weight:700">#${o.id}</td>
          <td style="font-size:.82rem">${o.customer}</td>
          <td style="font-size:.82rem">${o.date}</td>
          <td style="font-size:.82rem">${stO} ${o.status}</td>
          <td style="font-size:.82rem;text-align:right;font-weight:700;color:#1a7c3e">RD$ ${fmt$(o.total||0)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:16px">Ningún pedido asignado aún</td></tr>`;

  document.getElementById('drvDetailTitle').textContent = 'Perfil: ' + d.name;
  document.getElementById('drvDetailBody').innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap">
      <div class="drv-avatar-big">${ini}</div>
      <div style="flex:1">
        <div style="font-size:1.15rem;font-weight:800;color:#1a1a2e">${d.name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          <span class="drv-status ${st.cls}"><i class="fas fa-circle"></i> ${st.label}</span>
          <span class="drv-vehicle"><i class="fas ${vehicleIcon[d.vehicle]||'fa-motorcycle'}"></i> ${vehicleLabel[d.vehicle]||d.vehicle}${d.plate?' · '+d.plate:''}</span>
        </div>
      </div>
      ${waLink}
    </div>

    <!-- Grid de datos -->
    <div class="order-detail-grid" style="margin-bottom:18px">
      <div class="order-detail-item"><label><i class="fas fa-phone"></i> Teléfono</label><span>${d.phone||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fab fa-whatsapp"></i> WhatsApp</label><span>${d.whatsapp||d.phone||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-envelope"></i> Email</label><span>${d.email||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-id-card"></i> Cédula</label><span>${d.cedula||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-location-dot"></i> Dirección</label><span>${d.address||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-map"></i> Zona de cobertura</label><span>${d.zone||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-calendar"></i> Fecha de ingreso</label><span>${d.startDate||'—'}</span></div>
      <div class="order-detail-item"><label><i class="fas fa-calendar-check"></i> Registrado</label><span>${d.createdAt||'—'}</span></div>
    </div>

    <!-- Stats de pedidos -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">
      <div style="background:#e8f5ee;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#1a7c3e">${myOrders.length}</div>
        <div style="font-size:.75rem;color:#555;font-weight:600">Total asignados</div>
      </div>
      <div style="background:#e3f2fd;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#1565c0">${delivered.length}</div>
        <div style="font-size:.75rem;color:#555;font-weight:600">Entregados</div>
      </div>
      <div style="background:#fff8e1;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#f57c00">${pending.length}</div>
        <div style="font-size:.75rem;color:#555;font-weight:600">Pendientes</div>
      </div>
    </div>

    <!-- Historial de pedidos -->
    <div style="font-size:.78rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">
      <i class="fas fa-clock-rotate-left"></i> Historial de pedidos asignados
    </div>
    <div style="overflow-x:auto;border-radius:8px;border:1px solid #eee">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f8f9fa">
            <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#888">Pedido</th>
            <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#888">Cliente</th>
            <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#888">Fecha</th>
            <th style="padding:8px 12px;text-align:left;font-size:.75rem;color:#888">Estado</th>
            <th style="padding:8px 12px;text-align:right;font-size:.75rem;color:#888">Total</th>
          </tr>
        </thead>
        <tbody>${ordersRowsHTML}</tbody>
      </table>
    </div>

    ${d.notes ? `<div style="margin-top:14px;background:#f9f9f9;border-radius:8px;padding:12px;font-size:.85rem;color:#555"><b>Notas:</b> ${d.notes}</div>` : ''}

    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn-secondary" style="flex:1" onclick="closeDriverDetail();openDriverModal('${d.id}')">
        <i class="fas fa-pen"></i> Editar repartidor
      </button>
      <button class="btn-primary" style="flex:1" onclick="closeDriverDetail();showSection('orders',document.querySelector('[data-section=orders]'))">
        <i class="fas fa-box"></i> Ver pedidos
      </button>
    </div>`;

  document.getElementById('drvDetailBackdrop').classList.remove('hidden');
}

function closeDriverDetail() {
  document.getElementById('drvDetailBackdrop').classList.add('hidden');
}

// ── Asignar repartidor a un pedido (desde el modal de pedido) ─────────────────
function assignDriverToOrder(orderId, driverId) {
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return;
  orders[idx].driverId = driverId || null;
  localStorage.setItem('cm_orders', JSON.stringify(orders));
  showAdminToast('Repartidor asignado al pedido', 'success');
  renderOrdersTable();
}

// ── Demo drivers ──────────────────────────────────────────────────────────────
function generateDemoDrivers() {
  return [
    { id:'drv_1', name:'Ramón Jiménez',  cedula:'001-1234567-8', phone:'(809) 111-2233', whatsapp:'(809) 111-2233',
      email:'ramon@casamota.com.do', startDate:'2024-01-15', vehicle:'moto', plate:'M-001234',
      zone:'Zona Norte / Ensanche Ozama', status:'activo',
      address:'C/ Las Palmas #12, Los Alcarrizos', notes:'Disponible de 8am a 6pm.', createdAt:'15/01/2024' },
    { id:'drv_2', name:'Pedro Santana',   cedula:'001-9876543-2', phone:'(809) 222-4455', whatsapp:'',
      email:'pedro@casamota.com.do',  startDate:'2024-03-10', vehicle:'bicicleta', plate:'',
      zone:'Zona Sur / Gazcue', status:'en_ruta',
      address:'Av. Independencia #88, Santo Domingo', notes:'Turno tarde.', createdAt:'10/03/2024' },
    { id:'drv_3', name:'Luis Fernández',  cedula:'002-3456789-1', phone:'(849) 333-6677', whatsapp:'(849) 333-6677',
      email:'luis@casamota.com.do',   startDate:'2024-06-01', vehicle:'carro', plate:'A-234567',
      zone:'Santiago / Zona Centro', status:'descanso',
      address:'C/ Del Sol #45, Santiago', notes:'Carro propio, zona amplia.', createdAt:'01/06/2024' },
  ];
}

// ─── BÚSQUEDA GLOBAL ──────────────────────────────────────────────────────────
function onGlobalSearch(val) {
  if (!val.trim()) return;

  // Detectar sección activa
  const activeSec = document.querySelector('.section-content.active');
  const secId = activeSec ? activeSec.id.replace('sec-', '') : 'products';

  // Buscar en la sección donde el usuario ya está
  const searchMap = {
    products:       () => { const el = document.getElementById('prodSearch');    if (el) { el.value = val; renderProductsTable(); } },
    inventory:      () => { const el = document.getElementById('invSearch');     if (el) { el.value = val; renderInventory(); } },
    orders:         () => { const el = document.getElementById('orderSearch');   if (el) { el.value = val; renderOrdersTable(); } },
    customers:      () => { const el = document.getElementById('custSearch');    if (el) { el.value = val; renderCustomers(); } },
    staff:          () => { const el = document.getElementById('staffSearch');   if (el) { el.value = val; renderStaff(); } },
    cupones:        () => { const el = document.getElementById('cuponSearch');  if (el) { el.value = val; if (typeof renderCupones        === 'function') renderCupones(); } },
    notificaciones: () => { const el = document.getElementById('notiSearch');   if (el) { el.value = val; if (typeof renderNotificaciones === 'function') renderNotificaciones(); } },
  };

  if (searchMap[secId]) {
    searchMap[secId]();
  } else {
    // Si la sección no tiene búsqueda propia, ir a Productos
    document.getElementById('prodSearch').value = val;
    showSection('products', document.querySelector('[data-section=products]'));
    renderProductsTable();
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showAdminToast(msg, type = 'success') {
  const container = document.getElementById('adminToasts');
  const t = document.createElement('div');
  t.className = `admin-toast ${type}`;
  const icons = { success:'fa-check-circle', error:'fa-circle-xmark', info:'fa-circle-info', warn:'fa-triangle-exclamation' };
  t.innerHTML = `<i class="fas ${icons[type]||'fa-circle-info'}"></i> ${msg}`;
  container.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 3200);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function catLabel(cat) {
  // Intentar usar las categorías dinámicas cargadas desde la API
  if (adminCategories && adminCategories.length > 0) {
    const found = adminCategories.find(c => (c.slug || c.id) === cat);
    if (found) return found.name;
  }
  // Fallback estático
  const m = {
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
  return m[cat] || cat;
}
function ucFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ══════════════════════════════════════════════════════════════════════════════
// GESTIÓN DE CATEGORÍAS
// ══════════════════════════════════════════════════════════════════════════════

/** Lista en memoria de categorías cargadas desde la API */
let adminCategories = [];

/** UUID de la categoría que se está editando (null = nueva) */
let editingCategoryUuid = null;
/** Slug original de la categoría antes de editar (para detectar cambios) */
let editingCategoryOldSlug = null;

/** UUID de la categoría pendiente de eliminar */
let deletingCategoryUuid = null;

// ─── Mapa de íconos FA Pro → FA Free (sanitización automática) ────────────────
const _FA_PRO_TO_FREE = {
  'fa-bottle-droplet' : 'fas fa-flask',
  'fa-jar'            : 'fas fa-box-open',
  'fa-sausage'        : 'fas fa-hotdog',
  'fa-candy-cane'     : 'fas fa-circle-dot',
  'fa-bottle-water'   : 'fas fa-droplet',
  'fa-pump-soap'      : 'fas fa-hand-sparkles',
  'fa-bread-slice'    : 'fas fa-cookie-bite',
  'fa-mug-saucer'     : 'fas fa-mug-hot',
  'fa-drumstick-bite' : 'fas fa-fire',
  'fa-apple-whole'    : 'fas fa-apple-alt',
  'fa-seedling'       : 'fas fa-spa',
  'fa-box-archive'    : 'fas fa-box-archive',   // este SÍ es free, lo dejamos
};

function _sanitizeIcon(icon) {
  if (!icon) return icon;
  for (const [pro, free] of Object.entries(_FA_PRO_TO_FREE)) {
    if (icon.includes(pro)) return free;
  }
  return icon;
}

// ─── Cargar y refrescar ───────────────────────────────────────────────────────

async function loadCategories() {
  try {
    const raw = await DB.getCategories();
    // Sanitizar íconos Pro → Free en tiempo de carga
    adminCategories = raw.map(c => ({ ...c, icon: _sanitizeIcon(c.icon) }));
  } catch(e) {
    console.warn('[Categories] Error al cargar:', e);
    adminCategories = [];
  }
  renderCategoriesTable();
  refreshCategorySelects();   // actualiza todos los <select> de categoría
}

// ─── Render tabla ─────────────────────────────────────────────────────────────

function renderCategoriesTable() {
  const search = (document.getElementById('catSearch')?.value || '').toLowerCase();
  const status = document.getElementById('catStatusFilter')?.value || '';

  // Ordenar siempre alfabéticamente por nombre
  let list = [...adminCategories].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })
  );

  if (search) {
    list = list.filter(c =>
      (c.name  || '').toLowerCase().includes(search) ||
      (c.id    || '').toLowerCase().includes(search) ||
      (c.description || '').toLowerCase().includes(search)
    );
  }
  if (status === 'active')   list = list.filter(c => c.active === true  || c.active === 'true');
  if (status === 'inactive') list = list.filter(c => c.active === false || c.active === 'false');

  // KPIs
  const total    = adminCategories.length;
  const activos  = adminCategories.filter(c => c.active === true || c.active === 'true').length;
  const inactivos= total - activos;
  _setText('catKpiTotal',    total);
  _setText('catKpiActive',   activos);
  _setText('catKpiInactive', inactivos);
  _setText('catCount', `${list.length} categoría${list.length !== 1 ? 's' : ''}`);

  const tbody = document.getElementById('categoriesTbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#aaa">
      <i class="fas fa-tags" style="font-size:2rem;display:block;margin-bottom:8px;opacity:.3"></i>
      No se encontraron categorías
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const isActive = c.active === true || c.active === 'true';
    const apiUuid  = c.id; // UUID real de la API
    const safeName = (c.name || '').replace(/'/g, "\\'");
    const iconHtml = c.icon
      ? `<i class="${c.icon}" style="color:${c.color||'#1a7c3e'};font-size:1.3rem" title="${c.name}"></i>`
      : `<span style="font-size:1.4rem">${c.emoji || '🏷️'}</span>`;

    return `<tr data-uuid="${apiUuid}">
      <td style="text-align:center">${iconHtml}</td>
      <td>
        <strong>${c.name || '—'}</strong>
        ${c.emoji ? `<span style="margin-left:4px">${c.emoji}</span>` : ''}
      </td>
      <td><code class="cat-slug-badge">${c.slug || '—'}</code></td>
      <td style="color:#666;font-size:.85rem">${c.description || '<em style="color:#bbb">Sin descripción</em>'}</td>
      <td style="text-align:center;color:#888">${c.sort_order ?? '—'}</td>
      <td style="text-align:center">
        <span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">
          ${isActive ? 'Activa' : 'Inactiva'}
        </span>
      </td>
      <td>
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="action-btn action-btn-edit" title="Editar"
                  onclick="openCategoryModal('${apiUuid}')">
            <i class="fas fa-pen"></i>
          </button>
          <button class="action-btn action-btn-delete" title="Eliminar"
                  onclick="openCatDeleteModal('${apiUuid}','${safeName}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─── Modal crear / editar ─────────────────────────────────────────────────────

function openCategoryModal(uuid) {
  editingCategoryUuid = uuid || null;

  const titleEl  = document.getElementById('categoryModalTitle');
  const backdrop = document.getElementById('categoryModalBackdrop');

  if (uuid) {
    // Editar: buscar por UUID real de la API (campo id del sistema)
    const cat = adminCategories.find(c => c.id === uuid);
    if (!cat) { showAdminToast('Categoría no encontrada', 'error'); return; }

    titleEl.textContent = 'Editar Categoría';
    document.getElementById('catName').value    = cat.name       || '';
    document.getElementById('catSlug').value    = cat.slug       || '';
    document.getElementById('catDesc').value    = cat.description|| '';
    document.getElementById('catIcon').value    = cat.icon       || '';
    document.getElementById('catEmoji').value   = cat.emoji      || '';
    document.getElementById('catColor').value   = cat.color      || '#1a7c3e';
    document.getElementById('catOrder').value   = cat.sort_order ?? '';
    document.getElementById('catActive').value  = String(cat.active !== false && cat.active !== 'false');

    // Guardar slug original y habilitar edición con aviso
    editingCategoryOldSlug = cat.slug || '';
    const slugFld = document.getElementById('catSlug');
    slugFld.disabled = false;
    slugFld.style.background = '';
    slugFld.style.border = '2px solid #f59e0b';
    slugFld.title = 'Si cambias el slug, todos los productos de esta categoría se actualizarán automáticamente';
  } else {
    titleEl.textContent = 'Nueva Categoría';
    ['catName','catSlug','catDesc','catIcon','catEmoji'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('catColor').value   = '#1a7c3e';
    document.getElementById('catOrder').value   = adminCategories.length + 1;
    document.getElementById('catActive').value  = 'true';
    document.getElementById('catSlug').disabled = false;
    document.getElementById('catSlug').style.background = '';
  }

  updateCatPreview();
  // El backdrop ya está en <body> directamente — solo mostrarlo con flex
  backdrop.style.cssText = backdrop.style.cssText; // fuerza repaint
  backdrop.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCategoryModal() {
  const backdrop = document.getElementById('categoryModalBackdrop');
  backdrop.style.display = 'none';
  document.body.style.overflow = '';
  editingCategoryUuid = null;
}

// Auto-generar slug desde el nombre
function catAutoSlug() {
  if (editingCategoryUuid) return; // no auto-generar slug al editar
  const name = document.getElementById('catName').value;
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s_]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  document.getElementById('catSlug').value = slug;
  updateCatPreview();
}

// Limpiar caracteres inválidos del slug
function catSlugClean() {
  const el = document.getElementById('catSlug');
  el.value = el.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  updateCatPreview();
}

// Actualizar la vista previa (tarjeta grande + pill + nota slug)
function updateCatPreview() {
  const name  = document.getElementById('catName')?.value  || 'Categoría';
  const icon  = (document.getElementById('catIcon')?.value  || '').trim();
  const emoji = (document.getElementById('catEmoji')?.value || '').trim();
  const color = document.getElementById('catColor')?.value  || '#1a7c3e';
  const slug  = document.getElementById('catSlug')?.value   || '';

  // Contenido del ícono (FA primero, emoji si no, fallback genérico)
  const iconHtmlColor = `<i class="${icon}" style="color:${color}"></i>`;
  const iconHtmlWhite = `<i class="${icon}" style="color:#fff"></i>`;
  const emojiHtml     = `<span style="font-size:2rem;line-height:1">${emoji}</span>`;
  const fallbackColor = `<i class="fas fa-tag" style="color:${color}"></i>`;
  const fallbackWhite = `<i class="fas fa-tag" style="color:#fff"></i>`;

  const cardIconContent = icon ? iconHtmlWhite : (emoji ? emojiHtml : fallbackWhite);
  const pillIconContent = icon ? iconHtmlColor : (emoji ? `<span>${emoji}</span>` : fallbackColor);

  // ── Tarjeta grande ──
  const card = document.getElementById('catPreviewCard');
  const cardIcon = document.getElementById('catPreviewCardIcon');
  if (card) {
    card.style.background = `linear-gradient(135deg, ${color}dd, ${color}99)`;
    card.style.borderColor = color;
  }
  if (cardIcon) cardIcon.innerHTML = cardIconContent;

  // Nombre en la tarjeta
  const cardName = document.getElementById('catPreviewName');
  if (cardName) cardName.textContent = name;

  // Cabecera del modal
  const headerIcon = document.getElementById('catHeaderIcon');
  if (headerIcon) {
    headerIcon.style.background = color + '22';
    headerIcon.style.color      = color;
    headerIcon.innerHTML = icon
      ? `<i class="${icon}"></i>`
      : (emoji ? emoji : '<i class="fas fa-tags"></i>');
  }

  // ── Pill de navegación ──
  const pill = document.getElementById('catPreviewPill');
  const pillIcon = document.getElementById('catPreviewIcon');
  const pillName = document.getElementById('catPreviewPillName');
  if (pill) {
    pill.style.borderColor = color;
    pill.style.color       = color;
  }
  if (pillIcon) pillIcon.innerHTML = pillIconContent;
  if (pillName) pillName.textContent = name;

  // ── Nota de slug ──
  const slugEl = document.getElementById('catPreviewSlug');
  if (slugEl) slugEl.textContent = slug || '—';
}

// ─── Guardar ─────────────────────────────────────────────────────────────────

async function saveCategory() {
  const name   = (document.getElementById('catName').value  || '').trim();
  const slug   = (document.getElementById('catSlug').value  || '').trim();
  const desc   = (document.getElementById('catDesc').value  || '').trim();
  const icon   = (document.getElementById('catIcon').value  || '').trim();
  const emoji  = (document.getElementById('catEmoji').value || '').trim();
  const color  = document.getElementById('catColor').value  || '#1a7c3e';
  const order  = parseInt(document.getElementById('catOrder').value) || 99;
  const active = document.getElementById('catActive').value !== 'false';

  // Validación
  if (!name) { showAdminToast('El nombre es obligatorio', 'error'); return; }
  if (!slug) { showAdminToast('El slug/ID es obligatorio', 'error'); return; }
  if (!/^[a-z0-9_]+$/.test(slug)) {
    showAdminToast('El slug solo puede tener letras minúsculas, números y _', 'error');
    return;
  }

  // Verificar slug único (solo en creación)
  if (!editingCategoryUuid) {
    const exists = adminCategories.some(c => c.slug === slug);
    if (exists) {
      showAdminToast(`Ya existe una categoría con el slug "${slug}"`, 'error');
      return;
    }
  }

  const btn = document.getElementById('catSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';

  // catData usa 'slug' como clave de negocio; 'id' lo gestiona la API como UUID
  const catData = { slug, name, description: desc, icon, emoji, color,
                    sort_order: order, active };

  try {
    if (editingCategoryUuid) {
      // Actualizar: usar el UUID real de la API
      await _apiUpdate('categories', editingCategoryUuid, catData);
      showAdminToast(`Categoría "${name}" actualizada ✔`, 'success');
    } else {
      await _apiCreate('categories', catData);
      showAdminToast(`Categoría "${name}" creada ✔`, 'success');
    }

    closeCategoryModal();
    await loadCategories();       // recargar lista + selects

    // ── Migrar productos si el slug cambió ───────────────────────────────────
    if (editingCategoryUuid && editingCategoryOldSlug && editingCategoryOldSlug !== slug) {
      await _migrateProductsCategory(editingCategoryOldSlug, slug);
    }

  } catch(e) {
    console.error('[saveCategory]', e);
    showAdminToast('Error al guardar la categoría', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
    editingCategoryOldSlug = null;
  }
}

/**
 * Actualiza el campo `category` de todos los productos que tenían el slug viejo.
 * Se ejecuta automáticamente cuando se cambia el slug de una categoría.
 */
async function _migrateProductsCategory(oldSlug, newSlug) {
  try {
    // 1. Cargar todos los productos (máx 2000)
    const res = await fetch('tables/products?limit=2000');
    const data = await res.json();
    const allProducts = data.data || [];

    // 2. Filtrar los que usan el slug viejo
    const toUpdate = allProducts.filter(p => p.category === oldSlug);

    if (toUpdate.length === 0) {
      showAdminToast(`No había productos con categoría "${oldSlug}"`, 'info');
      return;
    }

    // 3. Actualizar en paralelo (máx 10 simultáneos para no saturar)
    let updated = 0;
    const BATCH = 10;
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const batch = toUpdate.slice(i, i + BATCH);
      await Promise.all(batch.map(p =>
        fetch(`tables/products/${p.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newSlug })
        })
      ));
      updated += batch.length;
    }

    showAdminToast(
      `✔ ${updated} producto${updated !== 1 ? 's' : ''} movido${updated !== 1 ? 's' : ''} a "${newSlug}"`,
      'success'
    );

    // 4. Recargar la lista de productos en pantalla
    if (typeof loadProducts === 'function') await loadProducts();

  } catch(e) {
    console.error('[_migrateProductsCategory]', e);
    showAdminToast('Error al migrar productos a la nueva categoría', 'error');
  }
}

// ─── Eliminar ─────────────────────────────────────────────────────────────────

function openCatDeleteModal(uuid, name) {
  deletingCategoryUuid = uuid;
  const nameEl = document.getElementById('catDeleteName');
  if (nameEl) nameEl.textContent = name || uuid;
  document.getElementById('catDeleteModalBackdrop').style.display = 'flex';
}

function closeCatDeleteModal() {
  document.getElementById('catDeleteModalBackdrop').style.display = 'none';
  deletingCategoryUuid = null;
}

async function confirmDeleteCategory() {
  if (!deletingCategoryUuid) return;

  const btn = document.getElementById('catDeleteConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando…';

  try {
    await _apiDelete('categories', deletingCategoryUuid);
    showAdminToast('Categoría eliminada', 'success');
    closeCatDeleteModal();
    await loadCategories();
  } catch(e) {
    console.error('[deleteCategory]', e);
    showAdminToast('Error al eliminar la categoría', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-trash"></i> Eliminar';
  }
}

// ─── Poblar selects dinámicamente ────────────────────────────────────────────

/**
 * Actualiza TODOS los <select> de categorías en el admin (filtro, form de producto)
 * con las categorías cargadas desde la API.
 */
function refreshCategorySelects() {
  const cats = adminCategories.length > 0
    ? adminCategories
    : _getBuiltinCategories();

  // Generar opciones ordenadas alfabéticamente por nombre
  const optionsHtml = cats
    .filter(c => c.active === true || c.active === 'true' || c.active === undefined)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'))
    .map(c => `<option value="${c.slug || c.id}">${c.name}</option>`)
    .join('');

  // 1. Select del formulario de producto (#pCategory)
  const pCat = document.getElementById('pCategory');
  if (pCat) {
    const currentVal = pCat.value;
    pCat.innerHTML = `<option value="">— Selecciona una categoría —</option>${optionsHtml}`;
    if (currentVal) pCat.value = currentVal; // restaurar selección al editar
  }

  // 2. Select del filtro de productos (#prodCatFilter)
  const prodFilt = document.getElementById('prodCatFilter');
  if (prodFilt) {
    const currentVal = prodFilt.value;
    prodFilt.innerHTML = `<option value="">Todas las categorías</option>${optionsHtml}`;
    if (currentVal) prodFilt.value = currentVal;
  }

  // 3. Select del filtro del escáner / nueva orden (#noCatFilter) si existiera
  const noCat = document.getElementById('noCatFilter');
  if (noCat) {
    noCat.innerHTML = `<option value="">Todas las categorías</option>${optionsHtml}`;
  }
}

/** Categorías integradas como fallback — íconos 100% FA Free 6.4 */
function _getBuiltinCategories() {
  return [
    {slug:'aceites_vinagres',    name:'Aceites y Vinagres',    icon:'fas fa-flask',               active:true},
    {slug:'aceitunas_encurtidos',name:'Aceitunas y Encurtidos', icon:'fas fa-box-open',            active:true},
    {slug:'agua_refrescos',      name:'Agua y Refrescos',       icon:'fas fa-droplet',             active:true},
    {slug:'bebe',                name:'Bebé',                   icon:'fas fa-baby',                active:true},
    {slug:'bebidas',             name:'Bebidas',                icon:'fas fa-mug-hot',             active:true},
    {slug:'bodega',              name:'Bodega',                 icon:'fas fa-warehouse',           active:true},
    {slug:'carnes',              name:'Carnes',                 icon:'fas fa-fire',                active:true},
    {slug:'cuidado_personal',    name:'Cuidado Personal',       icon:'fas fa-hand-sparkles',       active:true},
    {slug:'despensa',            name:'Despensa',               icon:'fas fa-boxes-stacked',       active:true},
    {slug:'dulces_caramelos',    name:'Dulces y Caramelos',     icon:'fas fa-circle-dot',          active:true},
    {slug:'electrodomesticos',   name:'Electrodomésticos',      icon:'fas fa-blender',             active:true},
    {slug:'embutidos',           name:'Embutidos',              icon:'fas fa-hotdog',              active:true},
    {slug:'enlatados',           name:'Enlatados',              icon:'fas fa-box-archive',         active:true},
    {slug:'ferreteria',          name:'Ferretería',             icon:'fas fa-hammer',              active:true},
    {slug:'frutas',              name:'Frutas',                 icon:'fas fa-apple-alt',           active:true},
    {slug:'granos',              name:'Granos',                 icon:'fas fa-spa',                 active:true},
    {slug:'higiene_salud',       name:'Higiene y Salud',        icon:'fas fa-hand-holding-medical',active:true},
    {slug:'hogar_limpieza',      name:'Hogar y Limpieza',       icon:'fas fa-broom',               active:true},
    {slug:'lacteos',             name:'Lácteos',                icon:'fas fa-cheese',              active:true},
    {slug:'mariscos',            name:'Mariscos',               icon:'fas fa-fish',                active:true},
    {slug:'panaderia',           name:'Panadería',              icon:'fas fa-cookie-bite',         active:true},
    {slug:'pastas',              name:'Pastas Alimenticias',    icon:'fas fa-utensils',            active:true},
    {slug:'vegetales',           name:'Vegetales',              icon:'fas fa-leaf',                active:true},
  ];
}

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
function generateDemoOrders() {
  const names    = ['Ana García','Carlos Mota','María Pérez','Luis Rodríguez','Carmen Díaz','José Martínez','Rosa Jiménez','Pedro Álvarez','Sandra Torres','Miguel López'];
  const statuses = ['pendiente','procesando','enviado','entregado','entregado','entregado','cancelado'];
  const addrs    = ['Av. Churchill #35','Calle El Conde #12','C/ Las Mercedes #88','Av. Independencia #210','C/ José Reyes #5'];
  const orders   = [];

  // Función interna para generar líneas de productos aleatorias
  function buildProductLines() {
    const pool = adminProducts && adminProducts.length > 0 ? adminProducts : PRODUCTS;
    const qty  = Math.floor(Math.random() * 6) + 1;  // 1-6 productos distintos
    const used = new Set();
    const lines = [];
    let attempts = 0;
    while (lines.length < qty && attempts < 40) {
      attempts++;
      const p   = pool[Math.floor(Math.random() * pool.length)];
      if (used.has(p.id)) continue;
      used.add(p.id);
      const cantidad = Math.floor(Math.random() * 4) + 1;
      lines.push({
        productId:  p.id,
        name:       p.name,
        image:      p.image,
        category:   p.category,
        unit:       p.unit || 'unidad',
        price:      p.price,
        cantidad,
        subtotal:   +(p.price * cantidad).toFixed(2),
      });
    }
    return lines;
  }

  for (let i = 1; i <= 24; i++) {
    const name  = names[i % names.length];
    const day   = String(Math.floor(Math.random()*28)+1).padStart(2,'0');
    const mon   = String(Math.floor(Math.random()*3)+1).padStart(2,'0');
    const lines = buildProductLines();
    const total = lines.reduce((s, l) => s + l.subtotal, 0);

    orders.push({
      id:           i,
      customer:     name,
      email:        name.toLowerCase().replace(' ','.')+`@gmail.com`,
      phone:        `(809) ${Math.floor(100+Math.random()*900)}-${Math.floor(1000+Math.random()*9000)}`,
      items:        lines.length,
      productLines: lines,          // ← Array detallado de productos
      total:        Math.round(total),
      status:       statuses[i % statuses.length],
      date:         `${day}/0${mon}/2026`,
      address:      addrs[i % addrs.length],
      notes:        '',
    });
  }
  return orders;
}

function generateDemoCustomers() {
  // NOTA: Los primeros 5 tienen contraseña para poder iniciar sesión en la tienda.
  // Contraseñas demo: Ana2024!, Carlos2024!, Maria2024!, Luis2024!, Carmen2024!
  const data = [
    { name:'Ana Garcia',        email:'ana.garcia@gmail.com',       password:'Ana2024!',     phone:'(809) 234-5678', city:'Santo Domingo', address:'Av. Churchill #35',       orders:8,  spent:34200, lastOrder:'28/03/2026', status:'vip' },
    { name:'Carlos Mota',       email:'carlos.mota@gmail.com',      password:'Carlos2024!',  phone:'(809) 312-4567', city:'Santiago',      address:'Calle El Conde #12',      orders:5,  spent:18500, lastOrder:'25/03/2026', status:'activo' },
    { name:'Maria Perez',       email:'maria.perez@gmail.com',       password:'Maria2024!',   phone:'(809) 456-7890', city:'Santo Domingo', address:'C/ Las Mercedes #88',     orders:12, spent:52000, lastOrder:'30/03/2026', status:'vip' },
    { name:'Luis Rodriguez',    email:'luis.rodriguez@gmail.com',   password:'Luis2024!',    phone:'(809) 567-8901', city:'La Romana',     address:'Av. Independencia #210',  orders:3,  spent:9800,  lastOrder:'20/03/2026', status:'activo' },
    { name:'Carmen Diaz',       email:'carmen.diaz@gmail.com',      password:'Carmen2024!',  phone:'(809) 678-9012', city:'Santo Domingo', address:'C/ Jose Reyes #5',        orders:7,  spent:27500, lastOrder:'27/03/2026', status:'activo' },
    { name:'Jose Martinez',     email:'jose.martinez@gmail.com',    password:'',             phone:'(809) 789-0123', city:'San Pedro',     address:'Av. Mella #100',          orders:2,  spent:6200,  lastOrder:'15/03/2026', status:'inactivo' },
    { name:'Rosa Jimenez',      email:'rosa.jimenez@gmail.com',     password:'',             phone:'(809) 890-1234', city:'Santiago',      address:'C/ Del Sol #44',          orders:6,  spent:21000, lastOrder:'29/03/2026', status:'activo' },
    { name:'Pedro Alvarez',     email:'pedro.alvarez@gmail.com',    password:'',             phone:'(809) 901-2345', city:'Santo Domingo', address:'Los Prados #78',          orders:4,  spent:14300, lastOrder:'22/03/2026', status:'activo' },
    { name:'Sandra Torres',     email:'sandra.torres@gmail.com',    password:'',             phone:'(809) 112-3456', city:'La Vega',       address:'Av. Colon #55',           orders:9,  spent:38900, lastOrder:'26/03/2026', status:'vip' },
    { name:'Miguel Lopez',      email:'miguel.lopez@gmail.com',     password:'',             phone:'(809) 223-4567', city:'Santo Domingo', address:'Bella Vista #22',         orders:1,  spent:3100,  lastOrder:'10/03/2026', status:'inactivo' },
    { name:'Beatriz Nunez',     email:'beatriz.nunez@gmail.com',    password:'',             phone:'(809) 334-5678', city:'Santiago',      address:'Av. Francia #17',         orders:11, spent:46700, lastOrder:'30/03/2026', status:'vip' },
    { name:'Fernando Castillo', email:'fernando.castillo@gmail.com',password:'',             phone:'(809) 445-6789', city:'Santo Domingo', address:'C/ Hostos #33',           orders:3,  spent:10500, lastOrder:'18/03/2026', status:'activo' },
  ];
  return data.map((c,i) => ({ id: `demo_${i+1}`, ...c, cedula:'', notes:'', createdAt:'01/01/2026' }));
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN RESPALDO — bk* functions
// ══════════════════════════════════════════════════════════════════════════════

const BK_TABLES = [
  { name:'products',       label:'Productos',       icon:'🛒', statId:'bkStatProducts'   },
  { name:'categories',     label:'Categorías',      icon:'🏷️', statId:'bkStatCategories' },
  { name:'orders',         label:'Pedidos',         icon:'📦', statId:'bkStatOrders'     },
  { name:'customers',      label:'Clientes',        icon:'👥', statId:'bkStatCustomers'  },
  { name:'drivers',        label:'Repartidores',    icon:'🏍️', statId:'bkStatDrivers'    },
  { name:'staff',          label:'Personal',        icon:'👤', statId:null               },
  { name:'cupones',        label:'Cupones',         icon:'🎟️', statId:'bkStatCupones'    },
  { name:'notificaciones', label:'Notificaciones',  icon:'🔔', statId:null               },
  { name:'settings',       label:'Configuración',   icon:'⚙️', statId:null               },
];

// ─── Mapa tabla → función DB para usar Supabase directamente ─────────────────
const BK_DB_MAP = {
  products:       () => DB.getProducts({full:true}),
  categories:     () => DB.getCategories(),
  orders:         () => DB.getOrders(),
  customers:      () => DB.getCustomers(),
  drivers:        () => DB.getDrivers(),
  staff:          () => DB.getStaff(),
  cupones:        () => _supaFetch('cupones?select=*&limit=500&order=created_at.asc'),
  notificaciones: () => _supaFetch('notificaciones?select=*&limit=1000&order=created_at.asc'),
  settings:       () => _supaFetch('settings?select=*&limit=50&order=created_at.desc'),
};

let _bkSelected    = new Set(BK_TABLES.map(t => t.name));
let _bkExportData  = {};
let _bkLogLines    = 0;
let _bkImportData  = null;
let _bkImportFile  = null;

// ─── Init sección ─────────────────────────────────────────────────────────────
function initRespaldo() {
  _bkRenderTableList();
  _bkLoadStats();
  _bkRenderHistory();
  _bkInitChecklist();
  // Listener para mode replace/append
  document.querySelectorAll('input[name="bkMode"]').forEach(r =>
    r.addEventListener('change', () => {
      const warn = document.getElementById('bkReplaceWarning');
      if (warn) warn.style.display = r.value === 'replace' && r.checked ? 'flex' : 'none';
    })
  );
}

// ─── Cargar contadores de stats — usa Supabase directamente ──────────────────
async function _bkLoadStats() {
  for (const t of BK_TABLES) {
    if (!t.statId) continue;
    try {
      const fn = BK_DB_MAP[t.name];
      if (!fn) continue;
      const rows = await fn();
      const n = Array.isArray(rows) ? rows.length : 0;
      const el = document.getElementById(t.statId);
      if (el) el.textContent = n.toLocaleString();
    } catch { /* silencioso */ }
  }
}

// ─── Render lista de tablas exportar ─────────────────────────────────────────
function _bkRenderTableList() {
  const list = document.getElementById('bkTableList');
  if (!list) return;
  list.innerHTML = BK_TABLES.map(t => `
    <div class="bk-table-row active" id="bkRow-${t.name}" onclick="bkToggleTable('${t.name}')">
      <span class="bk-tr-icon">${t.icon}</span>
      <span class="bk-tr-name">${t.label}</span>
      <span class="bk-tr-count" id="bkRowCount-${t.name}">—</span>
      <i class="fas fa-check bk-tr-check"></i>
    </div>
  `).join('');
  // Cargar conteos en la lista — usa Supabase directamente
  BK_TABLES.forEach(async t => {
    try {
      const fn = BK_DB_MAP[t.name];
      if (!fn) return;
      const rows = await fn();
      const el = document.getElementById(`bkRowCount-${t.name}`);
      if (el) el.textContent = `${Array.isArray(rows) ? rows.length : 0} reg.`;
    } catch { /* silencioso */ }
  });
}

function bkToggleTable(name) {
  const row = document.getElementById(`bkRow-${name}`);
  if (_bkSelected.has(name)) { _bkSelected.delete(name); row?.classList.remove('active'); }
  else                        { _bkSelected.add(name);    row?.classList.add('active');    }
}
function bkSelectAll()   { BK_TABLES.forEach(t => { _bkSelected.add(t.name);    document.getElementById(`bkRow-${t.name}`)?.classList.add('active');    }); }
function bkDeselectAll() { BK_TABLES.forEach(t => { _bkSelected.delete(t.name); document.getElementById(`bkRow-${t.name}`)?.classList.remove('active'); }); }

// ─── LOG helpers ─────────────────────────────────────────────────────────────
function _bkLog(msg, type = '') {
  const body = document.getElementById('bkLogBody');
  if (!body) return;
  const ts   = new Date().toLocaleTimeString('es-DO');
  const line = document.createElement('div');
  line.className = `bk-log-line ${type}`;
  line.innerHTML = `<span class="ts">[${ts}]</span><span class="msg">${msg}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  _bkLogLines++;
  const cnt = document.getElementById('bkLogCount');
  if (cnt) cnt.textContent = _bkLogLines;
}
function _bkLogImport(msg, type = '') {
  const body = document.getElementById('bkImportLogBody');
  if (!body) return;
  const ts   = new Date().toLocaleTimeString('es-DO');
  const line = document.createElement('div');
  line.className = `bk-log-line ${type}`;
  line.innerHTML = `<span class="ts">[${ts}]</span><span class="msg">${msg}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  const cnt = document.getElementById('bkImportLogCount');
  if (cnt) cnt.textContent = parseInt(cnt.textContent || 0) + 1;
}

// ─── Exportar ─────────────────────────────────────────────────────────────────
async function bkStartExport() {
  if (!_bkSelected.size) { showAdminToast('Selecciona al menos una tabla', 'warn'); return; }

  _bkExportData = {};
  _bkLogLines   = 0;
  const logBody = document.getElementById('bkLogBody');
  if (logBody) logBody.innerHTML = '';

  const progressWrap = document.getElementById('bkProgressWrap');
  const logWrap      = document.getElementById('bkLog');
  const resultEl     = document.getElementById('bkResult');
  const btnExport    = document.getElementById('bkBtnExport');

  if (progressWrap) progressWrap.style.display = 'block';
  if (logWrap)      logWrap.style.display      = 'block';
  if (resultEl)     resultEl.style.display     = 'none';
  if (btnExport)    btnExport.disabled          = true;
  if (btnExport)    btnExport.innerHTML         = '<i class="fas fa-spinner fa-spin"></i> Exportando…';

  const tables  = BK_TABLES.filter(t => _bkSelected.has(t.name));
  const results = [];

  _bkLog(`🚀 Iniciando backup de ${tables.length} tabla(s)…`, 'info');

  for (let i = 0; i < tables.length; i++) {
    const t   = tables[i];
    const pct = Math.round((i / tables.length) * 100);
    _bkSetProgress(pct, `Exportando ${t.label} (${i+1}/${tables.length})…`);

    try {
      const rows = await _bkFetchAll(t);
      _bkExportData[t.name] = rows;
      const size = _bkFormatBytes(JSON.stringify(rows).length);
      results.push({ name:t.name, label:t.label, icon:t.icon, count:rows.length, size, status:'ok' });
      _bkLog(`✅ "${t.label}" — ${rows.length} registros (${size})`, 'ok');
    } catch(e) {
      results.push({ name:t.name, label:t.label, icon:t.icon, count:0, size:'—', status:'error', err:e.message });
      _bkLog(`❌ Error en "${t.label}": ${e.message}`, 'err');
    }
  }

  _bkSetProgress(100, '✅ Exportación completada');
  _bkLog(`🏁 Finalizado. ${results.filter(r=>r.status==='ok').length}/${tables.length} tablas exportadas.`, 'info');

  _bkShowResult(results);
  _bkSaveHistory(results);

  if (btnExport) { btnExport.disabled = false; btnExport.innerHTML = '<i class="fas fa-download"></i> Exportar y Descargar JSON'; }
}

// ─── _bkFetchAll — usa DB.*/Supabase en lugar de tables/ de Genspark ─────────
async function _bkFetchAll(tableCfg) {
  const fn = BK_DB_MAP[tableCfg.name];
  if (!fn) throw new Error(`No hay función DB para la tabla "${tableCfg.name}"`);
  _bkLog(`   · Descargando "${tableCfg.label}" desde Supabase…`, 'ok');
  const rows = await fn();
  if (!Array.isArray(rows)) throw new Error('La respuesta no es un array');
  _bkLog(`   · ${rows.length} registros obtenidos`, 'ok');
  return rows;
}

function _bkSetProgress(pct, label) {
  const fill  = document.getElementById('bkProgressFill');
  const lbl   = document.getElementById('bkProgressLabel');
  if (fill) fill.style.width   = pct + '%';
  if (lbl)  lbl.textContent    = label;
}

function _bkShowResult(results) {
  const el    = document.getElementById('bkResult');
  const tbody = document.getElementById('bkResultTable');
  const sumEl = document.getElementById('bkResultSummary');
  if (!el || !tbody) return;

  const total = results.reduce((s,r) => s + r.count, 0);
  if (sumEl) sumEl.textContent = `${results.filter(r=>r.status==='ok').length} tablas · ${total.toLocaleString()} registros`;

  tbody.innerHTML = `
    <tr style="background:#dcfce7">
      <th style="padding:6px 10px;text-align:left;color:#166534">Tabla</th>
      <th style="padding:6px 10px;text-align:left;color:#166534">Registros</th>
      <th style="padding:6px 10px;text-align:left;color:#166534">Tamaño</th>
      <th style="padding:6px 10px;text-align:left;color:#166534">Estado</th>
    </tr>
    ${results.map(r => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #d1fae5">${r.icon} <strong>${r.label}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #d1fae5">${r.count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #d1fae5">${r.size}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #d1fae5">
          ${r.status==='ok'
            ? (r.count>0 ? `<span class="bk-badge-ok">✅ OK</span>` : `<span class="bk-badge-empty">⚠️ Vacía</span>`)
            : `<span class="bk-badge-err">❌ Error</span>`}
        </td>
      </tr>`).join('')}
  `;
  el.style.display = 'block';
}

function bkDownloadFinal() {
  if (!Object.keys(_bkExportData).length) { showAdminToast('Primero exporta los datos', 'warn'); return; }
  const now     = new Date();
  const stamp   = `${now.getFullYear()}${_bkPad(now.getMonth()+1)}${_bkPad(now.getDate())}_${_bkPad(now.getHours())}${_bkPad(now.getMinutes())}`;
  const payload = {
    _meta: {
      exportDate:   now.toISOString(),
      exportedBy:   'admin.html — Sección Respaldo',
      project:      'Casa Mota Supermercado',
      tables:       Object.keys(_bkExportData),
      totalRecords: Object.values(_bkExportData).reduce((s,a) => s + a.length, 0),
    },
    ..._bkExportData
  };
  const json = JSON.stringify(payload, null, 2);
  _bkDownloadJSON(json, `casamota-backup-${stamp}.json`);
  _bkLog(`💾 Descargado: casamota-backup-${stamp}.json (${_bkFormatBytes(json.length)})`, 'ok');
  showAdminToast('✅ Backup descargado correctamente', 'success');
}

// ─── Importar ─────────────────────────────────────────────────────────────────
function bkHandleDrop(e) {
  e.preventDefault();
  document.getElementById('bkImportZone')?.classList.remove('bk-drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) _bkProcessFile(file);
}
function bkHandleFile(input) {
  const file = input.files?.[0];
  if (file) _bkProcessFile(file);
  input.value = '';
}
function _bkProcessFile(file) {
  if (!file.name.endsWith('.json')) { showAdminToast('Solo se aceptan archivos .json', 'error'); return; }
  _bkImportFile = file;
  const reader  = new FileReader();
  reader.onload = e => {
    try {
      _bkImportData = JSON.parse(e.target.result);
      _bkShowImportInfo(file, _bkImportData);
    } catch {
      showAdminToast('Error al leer el archivo JSON', 'error');
      _bkImportData = null;
    }
  };
  reader.readAsText(file);
}

function _bkShowImportInfo(file, data) {
  const infoEl = document.getElementById('bkFileInfo');
  const optsEl = document.getElementById('bkImportOpts');
  const listEl = document.getElementById('bkImportTableList');
  if (!infoEl || !optsEl || !listEl) return;

  const meta    = data._meta || {};
  const tables  = Object.keys(data).filter(k => k !== '_meta');
  const total   = tables.reduce((s,k) => s + (Array.isArray(data[k]) ? data[k].length : 0), 0);
  const stamp   = meta.exportDate ? new Date(meta.exportDate).toLocaleString('es-DO') : 'Desconocida';

  infoEl.style.display = 'block';
  infoEl.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <span style="font-size:1.8rem">📂</span>
      <div>
        <strong>${file.name}</strong><br>
        <span style="color:#6b7280">Tamaño: ${_bkFormatBytes(file.size)}</span> &nbsp;|&nbsp;
        <span style="color:#6b7280">Exportado: ${stamp}</span><br>
        <span style="color:#1d4ed8;font-weight:700">${tables.length} tablas · ${total.toLocaleString()} registros totales</span>
      </div>
    </div>`;

  listEl.innerHTML = tables.map(t => {
    const cfg  = BK_TABLES.find(x => x.name === t) || { icon:'📋', label:t };
    const cnt  = Array.isArray(data[t]) ? data[t].length : 0;
    return `
      <div class="bk-table-row active" id="bkImportRow-${t}" onclick="bkToggleImportTable('${t}')">
        <span class="bk-tr-icon">${cfg.icon}</span>
        <span class="bk-tr-name">${cfg.label}</span>
        <span class="bk-tr-count">${cnt} reg.</span>
        <i class="fas fa-check bk-tr-check"></i>
      </div>`;
  }).join('');

  optsEl.style.display = 'block';
}

let _bkImportSelected = new Set();
function bkToggleImportTable(name) {
  const row = document.getElementById(`bkImportRow-${name}`);
  if (_bkImportSelected.has(name)) { _bkImportSelected.delete(name); row?.classList.remove('active'); }
  else                              { _bkImportSelected.add(name);    row?.classList.add('active');    }
}

async function bkStartImport() {
  if (!_bkImportData) { showAdminToast('Carga un archivo JSON primero', 'warn'); return; }

  const tables = Object.keys(_bkImportData)
    .filter(k => k !== '_meta')
    .filter(k => {
      const row = document.getElementById(`bkImportRow-${k}`);
      return row && row.classList.contains('active');
    });

  if (!tables.length) { showAdminToast('Selecciona al menos una tabla para importar', 'warn'); return; }

  const mode = document.querySelector('input[name="bkMode"]:checked')?.value || 'append';
  const conf = mode === 'replace'
    ? confirm(`⚠️ MODO REEMPLAZAR: Se eliminarán TODOS los datos actuales de ${tables.length} tabla(s) antes de importar.\n\n¿Estás seguro?`)
    : true;
  if (!conf) return;

  const logEl  = document.getElementById('bkImportLog');
  const btnImp = document.getElementById('bkBtnImport');
  const logCnt = document.getElementById('bkImportLogCount');
  if (logEl)  logEl.style.display  = 'block';
  if (logCnt) logCnt.textContent   = '0';
  if (btnImp) { btnImp.disabled = true; btnImp.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando…'; }

  const logBody = document.getElementById('bkImportLogBody');
  if (logBody) logBody.innerHTML = '';

  _bkLogImport(`🚀 Iniciando importación — modo: ${mode === 'replace' ? 'REEMPLAZAR' : 'AGREGAR'}`, 'info');

  let totalImported = 0;
  let totalErrors   = 0;

  for (const tableName of tables) {
    const rows = _bkImportData[tableName];
    if (!Array.isArray(rows)) { _bkLogImport(`⚠️ "${tableName}" no contiene un array válido`, 'err'); continue; }

    _bkLogImport(`📋 Tabla "${tableName}" — ${rows.length} registros…`, 'info');

    // Si modo replace, no podemos borrar en bloque, advertimos
    if (mode === 'replace') {
      _bkLogImport(`   ⚠️ Modo Reemplazar: los registros existentes no se eliminan automáticamente (usa el admin para limpiar primero)`, 'err');
    }

    let ok = 0, err = 0;
    for (const row of rows) {
      try {
        const body = { ...row };
        // Quitar campos del sistema para evitar conflictos
        delete body.gs_project_id;
        delete body.gs_table_name;
        // Para Supabase: quitar id para que lo genere automáticamente (evita duplicados)
        // Solo lo quitamos si ya existe ese id en Supabase (modo append)
        // En modo replace el usuario ya limpió manualmente
        delete body.id;
        delete body.created_at;
        delete body.updated_at;

        // Usar _supaFetch para escribir directamente en Supabase
        await _supaFetch(`${tableName}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body)
        });
        ok++; totalImported++;
      } catch(e) { err++; totalErrors++; }
    }
    _bkLogImport(`   ✅ ${ok} importados · ❌ ${err} errores`, ok > 0 ? 'ok' : 'err');
  }

  _bkLogImport(`🏁 Importación finalizada — ${totalImported} registros importados · ${totalErrors} errores.`, 'info');
  showAdminToast(`✅ Importación completa: ${totalImported} registros`, 'success');

  if (btnImp) { btnImp.disabled = false; btnImp.innerHTML = '<i class="fas fa-upload"></i> Iniciar Importación'; }

  // Refrescar stats
  _bkLoadStats();
  _bkRenderTableList();
}

// ─── Historial (localStorage) ─────────────────────────────────────────────────
const BK_HISTORY_KEY = 'casamota_bk_history';

function _bkSaveHistory(results) {
  const ok    = results.filter(r => r.status === 'ok');
  const total = ok.reduce((s,r) => s + r.count, 0);
  const entry = {
    date:    new Date().toISOString(),
    tables:  ok.length,
    records: total,
    size:    _bkFormatBytes(JSON.stringify(_bkExportData).length),
    label:   ok.map(r => r.label).join(', ')
  };
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(BK_HISTORY_KEY) || '[]'); } catch { hist = []; }
  hist.unshift(entry);
  if (hist.length > 20) hist = hist.slice(0, 20);
  localStorage.setItem(BK_HISTORY_KEY, JSON.stringify(hist));
  _bkRenderHistory();
}

function _bkRenderHistory() {
  const listEl = document.getElementById('bkHistoryList');
  if (!listEl) return;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(BK_HISTORY_KEY) || '[]'); } catch { hist = []; }
  if (!hist.length) {
    listEl.innerHTML = '<p style="color:#9ca3af;font-size:.85rem;text-align:center;padding:20px">No hay backups registrados aún.</p>';
    return;
  }
  listEl.innerHTML = hist.map((h, i) => {
    const d = new Date(h.date).toLocaleString('es-DO');
    return `
      <div class="bk-history-item">
        <span class="bk-hi-icon">🛡️</span>
        <div class="bk-hi-info">
          <div class="bk-hi-name">Backup #${hist.length - i} — ${h.size}</div>
          <div class="bk-hi-meta">${d} · ${h.tables} tablas · ${h.records.toLocaleString()} registros</div>
          <div class="bk-hi-meta" style="margin-top:2px;font-size:.72rem;color:#9ca3af">${h.label}</div>
        </div>
        <span class="bk-badge-ok">✅ OK</span>
      </div>`;
  }).join('');
}

function bkClearHistory() {
  if (!confirm('¿Limpiar el historial de backups?')) return;
  localStorage.removeItem(BK_HISTORY_KEY);
  _bkRenderHistory();
  showAdminToast('Historial limpiado', 'info');
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function _bkFormatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(2) + ' MB';
}
function _bkPad(n) { return String(n).padStart(2,'0'); }
function _bkDownloadJSON(json, filename) {
  const blob = new Blob([json], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Checklist archivos proyecto ─────────────────────────────────────────────
function _bkInitChecklist() {
  const ids = ['chkBD','chkHTML','chkJS','chkCSS','chkIMG','chkPWA'];
  const KEY = 'casamota_bk_checklist';

  // Restaurar estado guardado
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && saved[id]) el.checked = true;
    });
  } catch { /* silencioso */ }

  // Actualizar contador y guardar al cambiar
  function update() {
    const checked = ids.filter(id => document.getElementById(id)?.checked).length;
    const status  = document.getElementById('bkChecklistStatus');
    if (status) {
      const all = checked === ids.length;
      status.innerHTML = all
        ? `<span style="color:#1a7c3e;font-weight:700">🎉 ¡Backup 100% completo! Todos los archivos respaldados.</span>`
        : `<span style="color:#6b7280">${checked} de ${ids.length} completados${checked > 0 ? ' — ¡vas bien!' : ''}</span>`;
    }
    // Guardar estado
    const state = {};
    ids.forEach(id => { state[id] = document.getElementById(id)?.checked || false; });
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', update);
  });

  update(); // Calcular estado inicial
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── MIGRACIÓN DE IMÁGENES ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

let _migProducts  = [];   // todos los productos cargados
let _migImageList = [];   // [{name, url, isCdn}]

// ── Detecta si una URL es del CDN de Genspark ────────────────────────────
function _migIsCdn(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('genspark.ai') || url.includes('gensparkspace.com');
}

// ── Formatea bytes ────────────────────────────────────────────────────────
function _migFmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}

// ── Log en pantalla ───────────────────────────────────────────────────────
function _migLog(msg, type='info') {
  const el = document.getElementById('migLog');
  if (!el) return;
  const color = type==='ok' ? '#34d399' : type==='error' ? '#f87171' : type==='warn' ? '#fbbf24' : '#94a3b8';
  const time  = new Date().toLocaleTimeString('es-ES');
  el.innerHTML += `<div style="color:${color}">[${time}] ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

// ── Actualiza barra de progreso ───────────────────────────────────────────
function _migSetProgress(pct, label) {
  const bar   = document.getElementById('migProgressBar');
  const pctEl = document.getElementById('migProgressPct');
  const lblEl = document.getElementById('migProgressLabel');
  if (bar)   bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (lblEl) lblEl.textContent = label || '';
}

// ── Función pública: llamada al exponer el checklist ─────────────────────
function _bkUpdateChecklist() {
  const ids = ['chkBD','chkHTML','chkJS','chkCSS','chkIMG','chkPWA'];
  const checked = ids.filter(id => document.getElementById(id)?.checked).length;
  const status  = document.getElementById('bkChecklistStatus');
  if (status) {
    const all = checked === ids.length;
    status.innerHTML = all
      ? `<span style="color:#1a7c3e;font-weight:700">🎉 ¡Backup 100% completo! Todos los archivos respaldados.</span>`
      : `<span style="color:#6b7280">${checked} de ${ids.length} completados${checked > 0 ? ' — ¡vas bien!' : ''}</span>`;
  }
}

// ── PASO 1: Escanear imágenes ─────────────────────────────────────────────
async function migScanImages() {
  const btnScan = document.getElementById('migBtnScan');
  const btnZip  = document.getElementById('migBtnZip');
  const btnTxt  = document.getElementById('migBtnTxt');
  const btnJson = document.getElementById('migBtnJson');

  btnScan.disabled = true;
  btnScan.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Escaneando...';

  // Mostrar log y progreso
  const logEl  = document.getElementById('migLog');
  const progWr = document.getElementById('migProgressWrap');
  if (logEl)  { logEl.innerHTML = ''; logEl.style.display = 'block'; }
  if (progWr) progWr.style.display = 'block';

  _migLog('🔍 Cargando productos desde la base de datos...');
  _migSetProgress(5, 'Cargando productos...');

  try {
    // Cargar TODOS los productos usando DB.getProducts() (ya tiene paginación Supabase)
    _migLog('📡 Conectando con Supabase...', 'ok');
    _migSetProgress(10, 'Cargando productos...');
    const allProds = await DB.getProducts({full:true});
    _migProducts = allProds;
    _migLog(`✅ Total productos: ${allProds.length}`, 'ok');
    _migSetProgress(40, 'Analizando imágenes...');

    // Analizar imágenes
    _migImageList = [];
    let sinImg = 0;

    allProds.forEach((p, i) => {
      const url = p.image || '';
      if (!url) { sinImg++; return; }
      // Nombre de archivo seguro basado en nombre del producto
      const safeName = (p.name || `producto_${i}`)
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-zA-Z0-9_\-]/g,'_')
        .substring(0, 60);
      const ext = url.includes('.png') ? '.png'
                : url.includes('.webp') ? '.webp'
                : url.includes('.gif') ? '.gif'
                : '.jpg';
      _migImageList.push({
        id:     p.id,
        name:   p.name || `Producto ${i}`,
        file:   `${safeName}_${i}${ext}`,
        url:    url,
        isCdn:  _migIsCdn(url)
      });
    });

    const cdnCount   = _migImageList.filter(x => x.isCdn).length;
    const localCount = _migImageList.filter(x => !x.isCdn).length;

    // Actualizar stats
    document.getElementById('migTotalProducts').textContent = allProds.length;
    document.getElementById('migTotalImages').textContent   = _migImageList.length;
    document.getElementById('migCdnImages').textContent     = cdnCount;
    document.getElementById('migLocalImages').textContent   = localCount;

    _migLog(`🖼️  Con imagen: ${_migImageList.length} | Sin imagen: ${sinImg}`, 'ok');
    _migLog(`☁️  En CDN Genspark: ${cdnCount}`, cdnCount > 0 ? 'warn' : 'ok');
    _migLog(`💾 Locales/otras: ${localCount}`, 'ok');
    _migSetProgress(70, 'Generando vista previa...');

    // Renderizar tabla de vista previa
    _migRenderTable();
    _migSetProgress(100, '✅ Escaneo completado');

    // Habilitar botones
    btnZip.disabled  = false;
    btnZip.style.background = '';
    btnTxt.disabled  = false;
    btnJson.disabled = false;

    _migLog(`🎉 Escaneo completado. ${cdnCount} imágenes listas para descargar en ZIP.`, 'ok');

  } catch(err) {
    _migLog('❌ Error al escanear: ' + err.message, 'error');
    _migSetProgress(0, 'Error');
  }

  btnScan.disabled = false;
  btnScan.innerHTML = '<i class="fas fa-magnifying-glass"></i> Re-escanear';
}

// ── Renderiza tabla de vista previa ───────────────────────────────────────
function _migRenderTable() {
  const wrap = document.getElementById('migResultsWrap');
  const tbl  = document.getElementById('migResultsTable');
  if (!wrap || !tbl) return;

  if (_migImageList.length === 0) {
    tbl.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px">No se encontraron imágenes.</p>';
    wrap.style.display = 'block';
    return;
  }

  let html = `
    <table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead>
        <tr style="background:#f3f4f6;position:sticky;top:0">
          <th style="padding:8px 10px;text-align:left;font-weight:600;color:#374151">#</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;color:#374151">Vista</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;color:#374151">Producto</th>
          <th style="padding:8px 10px;text-align:left;font-weight:600;color:#374151">Archivo ZIP</th>
          <th style="padding:8px 10px;text-align:center;font-weight:600;color:#374151">Origen</th>
        </tr>
      </thead>
      <tbody>`;

  _migImageList.forEach((img, i) => {
    const badge = img.isCdn
      ? `<span style="background:#fff3e0;color:#e65100;padding:2px 7px;border-radius:999px;font-size:.7rem;font-weight:600">CDN Genspark</span>`
      : `<span style="background:#e8f5ee;color:#1a7c3e;padding:2px 7px;border-radius:999px;font-size:.7rem;font-weight:600">Local/Otro</span>`;
    html += `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:6px 10px;color:#9ca3af">${i+1}</td>
        <td style="padding:6px 10px">
          <img src="${img.url}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb"
               onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect fill=%22%23f3f4f6%22 width=%2240%22 height=%2240%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2212%22 text-anchor=%22middle%22>❌</text></svg>'">
        </td>
        <td style="padding:6px 10px;color:#1f2937;font-weight:500">${img.name}</td>
        <td style="padding:6px 10px;color:#6b7280;font-family:monospace;font-size:.72rem">${img.file}</td>
        <td style="padding:6px 10px;text-align:center">${badge}</td>
      </tr>`;
  });

  html += '</tbody></table>';
  tbl.innerHTML = html;
  wrap.style.display = 'block';
}

// ── PASO 2: Descargar ZIP ─────────────────────────────────────────────────
async function migDownloadZip() {
  if (_migImageList.length === 0) {
    showAdminToast('Primero haz clic en "Escanear imágenes"', 'error'); return;
  }

  const btn = document.getElementById('migBtnZip');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando ZIP...';

  const logEl  = document.getElementById('migLog');
  const progWr = document.getElementById('migProgressWrap');
  if (logEl)  { logEl.innerHTML = ''; logEl.style.display = 'block'; }
  if (progWr) progWr.style.display = 'block';

  _migLog('📦 Iniciando descarga de imágenes...');
  _migSetProgress(0, 'Iniciando...');

  const zip      = new JSZip();
  const folder   = zip.folder('casamota-imagenes');
  const total    = _migImageList.length;
  let ok = 0, fail = 0;

  for (let i = 0; i < total; i++) {
    const img = _migImageList[i];
    const pct = Math.round(((i+1)/total)*85);
    _migSetProgress(pct, `Descargando ${i+1}/${total}: ${img.name.substring(0,30)}...`);

    try {
      // Usar proxy CORS si es necesario
      const resp = await fetch(img.url, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      folder.file(img.file, blob);
      ok++;
      if (i % 20 === 0 || i === total-1) {
        _migLog(`✅ ${ok}/${total} imágenes descargadas`, 'ok');
      }
    } catch(err) {
      fail++;
      _migLog(`⚠️ Error en "${img.name}": ${err.message} — URL: ${img.url.substring(0,60)}`, 'warn');
      // Agregar un archivo de texto con la URL para descarga manual
      folder.file(img.file.replace(/\.\w+$/,'.url.txt'), img.url);
    }
  }

  _migLog(`📦 Generando archivo ZIP (${ok} imágenes + ${fail} con error)...`);
  _migSetProgress(90, 'Comprimiendo ZIP...');

  try {
    const content = await zip.generateAsync({ type:'blob', compression:'STORE' },
      meta => _migSetProgress(90 + Math.round(meta.percent * 0.1), `Comprimiendo ${Math.round(meta.percent)}%...`)
    );

    const now  = new Date();
    const ts   = `${now.getFullYear()}${_bkPad(now.getMonth()+1)}${_bkPad(now.getDate())}_${_bkPad(now.getHours())}${_bkPad(now.getMinutes())}`;
    const fname = `casamota-imagenes-${ts}.zip`;

    const url = URL.createObjectURL(content);
    const a   = document.createElement('a');
    a.href = url; a.download = fname; a.click();
    URL.revokeObjectURL(url);

    _migSetProgress(100, '✅ ZIP descargado correctamente');
    _migLog(`🎉 ZIP generado: ${fname} | ✅ ${ok} imágenes | ⚠️ ${fail} errores`, 'ok');
    showAdminToast(`ZIP descargado: ${ok} imágenes (${fail} con error)`, ok > 0 ? 'success' : 'error');

    // Marcar checkbox de imágenes en checklist
    const chk = document.getElementById('chkIMG');
    if (chk && ok > 0) { chk.checked = true; _bkUpdateChecklist(); }

  } catch(err) {
    _migLog('❌ Error generando ZIP: ' + err.message, 'error');
    showAdminToast('Error generando ZIP: ' + err.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-file-zipper"></i> Descargar ZIP';
}

// ── PASO 3: Exportar lista de URLs en TXT ─────────────────────────────────
function migExportTxt() {
  if (_migImageList.length === 0) {
    showAdminToast('Primero escanea las imágenes', 'error'); return;
  }
  let txt = `CASAMOTA — Lista de imágenes de productos\nGenerado: ${new Date().toLocaleString('es-ES')}\nTotal: ${_migImageList.length} imágenes\n`;
  txt += '='.repeat(70) + '\n\n';
  _migImageList.forEach((img, i) => {
    txt += `[${i+1}] ${img.name}\n`;
    txt += `    Archivo: ${img.file}\n`;
    txt += `    URL:     ${img.url}\n`;
    txt += `    Origen:  ${img.isCdn ? 'CDN Genspark' : 'Local/Otro'}\n\n`;
  });
  const blob = new Blob([txt], { type:'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `casamota-imagenes-urls-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showAdminToast(`Lista exportada: ${_migImageList.length} URLs`, 'success');
}

// ── PASO 4: Exportar JSON con rutas actualizadas ──────────────────────────
function migExportJsonUpdated() {
  if (_migProducts.length === 0) {
    showAdminToast('Primero escanea las imágenes', 'error'); return;
  }

  // Clonar productos y actualizar las rutas de imagen a rutas locales relativas
  const updated = _migProducts.map((p, i) => {
    const found = _migImageList.find(img => img.id === p.id);
    if (found) {
      return { ...p, image: `images/products/${found.file}`, _image_original: p.image };
    }
    return { ...p };
  });

  const json = JSON.stringify({
    _meta: {
      generado: new Date().toISOString(),
      descripcion: 'Productos con rutas de imagen actualizadas para servidor privado',
      instrucciones: 'Sube las imágenes del ZIP a la carpeta images/products/ de tu servidor, luego importa este JSON en el panel de Respaldo.'
    },
    products: updated
  }, null, 2);

  _bkDownloadJSON(json, `casamota-products-rutas-locales-${new Date().toISOString().slice(0,10)}.json`);
  showAdminToast('JSON con rutas actualizadas descargado', 'success');
}
