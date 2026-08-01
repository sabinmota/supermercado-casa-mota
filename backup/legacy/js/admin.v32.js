/**
 * SUPERMERCADO CASA MOTA — ADMIN PANEL JS
 * Dashboard · Productos CRUD · Pedidos · Inventario · Clientes · Personal · Configuración
 */

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
const _debouncedRenderProducts  = debounce(() => renderProductsTable(), 220);
const _debouncedRenderInventory = debounce(() => renderInventory(), 220);

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
// Verificar unicidad del código de barras en tiempo real (al escribir)
function _checkBarcodeUnique(val, excludeId = null) {
  const status = document.getElementById('pBarcodeStatus');
  if (!status) return;
  if (!val) { status.textContent = ''; return; }
  const dup = adminProducts.find(p => p.barcode === val && p.id !== (excludeId ?? editingProductId));
  if (dup) {
    status.innerHTML = `<span style="color:#e53935">⚠️ Ya asignado a "${dup.name}"</span>`;
  } else {
    status.innerHTML = `<span style="color:#1a7c3e">✅ Disponible</span>`;
  }
}

// Búsqueda inmediata por código de barras en gestión de productos
function _barcodeSearchProducts(val) {
  // Limpiar búsqueda de texto si hay código de barras
  if (val) {
    const qs = document.getElementById('prodSearch');
    if (qs) qs.value = '';
  }
  renderProductsTable();
}

// Búsqueda inmediata por código de barras en inventario
function _barcodeSearchInventory(val) {
  if (val) {
    const qs = document.getElementById('invSearch');
    if (qs) qs.value = '';
  }
  renderInventory();
}

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
    if (msg) msg.innerHTML = `<i class="fas fa-check-circle" style="color:#1a7c3e"></i> <span style="color:#1a7c3e">${prod.name} · RD$ ${prod.price} · Stock: ${prod.stock}</span>`;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Carga todos los datos desde la API al arrancar el panel.
 * Garantiza que adminProducts, orders, customers, staffList y drivers
 * estén poblados antes de renderizar cualquier tabla.
 */
async function initAdminData() {
  // Mostrar indicador de carga
  const spinnerEl = document.getElementById('globalLoadingSpinner');
  if (spinnerEl) spinnerEl.style.display = 'flex';

  try {
    const [prods, ords, custs, stf, drvs, cfg] = await Promise.all([
      DB.getProducts(),
      DB.getOrders(),
      DB.getCustomers(),
      DB.getStaff(),
      DB.getDrivers(),
      DB.getSettings(),
    ]);

    adminProducts = prods.length > 0 ? prods : deepClone(PRODUCTS);
    orders        = ords;
    customers     = custs;
    staffList     = stf.length > 0 ? stf : DEFAULT_STAFF;
    drivers       = drvs;

    // Poblar cache de settings para _noUpdateTotals y otras funciones
    _cache.settings  = cfg;
    _cache.products  = adminProducts;
    _cache.orders    = orders;
    _cache.customers = customers;
    _cache.staff     = staffList;
    _cache.drivers   = drivers;

  } catch(e) {
    console.warn('initAdminData: error cargando datos desde API, usando estado en memoria:', e);
  }

  if (spinnerEl) spinnerEl.style.display = 'none';

  // Renderizar KPIs del dashboard INMEDIATAMENTE con los datos ya cargados
  renderDashboardKpis();
  renderTopProducts();
  renderRecentOrders();
  renderSalesChart();

  // Renderizar el resto de secciones
  renderProductsTable();
  renderOrdersTable();
  renderInventory();
  renderCustomers();
  renderStaff();
  updatePendingBadge();
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
  // El dashboard siempre recarga (el usuario puede querer ver datos frescos)
  if (id === 'dashboard')  loadDashboard();
  if (id === 'orders')     { DB.getOrders().then(list => { orders = list; renderOrdersTable(); updatePendingBadge(); }).catch(() => { renderOrdersTable(); updatePendingBadge(); }); }
  if (id === 'products')   { DB.getProducts().then(list => { if(list.length) adminProducts = list; renderProductsTable(); }).catch(() => renderProductsTable()); }
  if (id === 'inventory')  { DB.getProducts().then(list => { if(list.length) adminProducts = list; renderInventory(); }).catch(() => renderInventory()); }
  if (id === 'staff')      renderStaff();
  if (id === 'drivers')    { drivers = getDrivers(); renderDrivers(); }
  if (id === 'loyalty')         loadLoyalty();
  if (id === 'settings')        loadSettings();
  if (id === 'reportes')       { if (typeof loadReportes       === 'function') loadReportes(); }
  if (id === 'cupones')        { if (typeof loadCupones        === 'function') loadCupones(); }
  if (id === 'notificaciones') { if (typeof loadNotificaciones === 'function') loadNotificaciones(); }

  return false;
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  document.getElementById('mainContent').classList.toggle('expanded', sidebarCollapsed);
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function _setKpi(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.opacity = '1';
  el.textContent   = String(val);
}

function renderDashboardKpis() {
  // Usa los datos YA cargados en memoria — sin llamadas HTTP adicionales
  const totalSales = orders.reduce((s,o) => s + (o.status !== 'cancelado' ? o.total : 0), 0);
  const lowStock   = adminProducts.filter(p => p.stock < 20).length;
  _setKpi('kpiSales',    `RD$ ${totalSales.toLocaleString('es-DO')}`);
  _setKpi('kpiOrders',   orders.length);
  _setKpi('kpiProducts', adminProducts.length);
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
  // 1. Mostrar datos actuales en memoria DE INMEDIATO (sin esperar la API)
  renderDashboardKpis();
  renderTopProducts();
  renderRecentOrders();
  renderSalesChart();

  // 2. Refrescar desde la API en segundo plano y actualizar si hay cambios
  try {
    const [prods, ords] = await Promise.all([ DB.getProducts(), DB.getOrders() ]);
    let changed = false;
    if (prods.length > 0 && prods.length !== adminProducts.length) {
      adminProducts = prods; changed = true;
    }
    if (ords.length !== orders.length) {
      orders = ords; changed = true;
    }
    // Solo re-renderizar si los datos cambiaron (evita parpadeo innecesario)
    if (changed) {
      renderDashboardKpis();
      renderTopProducts();
      renderRecentOrders();
    }
  } catch(e) { /* usa estado en memoria */ }
}

function renderTopProducts() {
  const cats = {};
  adminProducts.forEach(p => { cats[p.name] = (cats[p.name] || 0) + p.reviews; });
  const sorted = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0,5);
  document.getElementById('topProducts').innerHTML = sorted.map(([name,cnt],i) => `
    <li>
      <span class="top-rank">${i+1}</span>
      <span class="top-name">${name}</span>
      <span class="top-sales">${cnt} reseñas</span>
    </li>`).join('');
}

function renderRecentOrders() {
  const recent = [...orders].sort((a,b) => b.id - a.id).slice(0,6);
  document.getElementById('recentOrdersTbody').innerHTML = recent.map(o => `
    <tr>
      <td><strong>#${o.id}</strong></td>
      <td>${o.customer}</td>
      <td>${o.items} productos</td>
      <td><strong>RD$ ${o.total.toLocaleString('es-DO')}</strong></td>
      <td><span class="status-pill status-${o.status}">${ucFirst(o.status)}</span></td>
      <td>${o.date}</td>
    </tr>`).join('');
}

function renderSalesChart() {
  // ── Datos ────────────────────────────────────────────────────────────────────
  const catTotals = {};
  adminProducts.forEach(p => {
    const cat = catLabel(p.category);
    catTotals[cat] = (catTotals[cat] || 0) + p.price * (Math.floor(Math.random() * 20) + 5);
  });
  const labels = Object.keys(catTotals);
  const data   = Object.values(catTotals);
  const colors = ['#1a7c3e','#27a35a','#1565c0','#f57c00','#e53935','#6a1b9a','#00838f','#f9a825'];

  // ── Canvas ───────────────────────────────────────────────────────────────────
  const canvasEl = document.getElementById('salesChart');
  if (!canvasEl) return;

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
        duration: 600,
        easing: 'easeOutQuart',
        // Cuando la animación termine, el chart ya está dibujado correctamente
        onComplete: () => {
          const sk = document.getElementById('salesChartSkeleton');
          if (sk) {
            sk.style.transition = 'opacity .3s';
            sk.style.opacity = '0';
            setTimeout(() => { if (sk.parentNode) sk.remove(); }, 320);
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
          callbacks: { label: c => ` RD$ ${c.parsed.toLocaleString('es-DO')}` }
        }
      }
    }
  });
}

// ─── PRODUCTOS TABLE ──────────────────────────────────────────────────────────
function renderProductsTable() {
  const q       = (document.getElementById('prodSearch')?.value || '').toLowerCase();
  const cat     = document.getElementById('prodCatFilter')?.value || '';
  const badge   = document.getElementById('prodBadgeFilter')?.value || '';
  const barcode = (document.getElementById('prodBarcodeSearch')?.value || '').trim();

  const list = adminProducts.filter(p => {
    const matchQ = !q || p.name.toLowerCase().includes(q)
                      || (p.description || '').toLowerCase().includes(q)
                      || (p.barcode || '').toLowerCase().includes(q);
    const matchC = !cat   || p.category === cat;
    const matchB = !badge || p.badge    === badge;
    const matchBar = !barcode || (p.barcode || '').toLowerCase().includes(barcode.toLowerCase());
    return matchQ && matchC && matchB && matchBar;
  });

  document.getElementById('prodCount').textContent = `${list.length} producto${list.length!==1?'s':''}`;

  const canEdit   = !currentSession || getRole(currentSession.role).canCreateProducts;
  const canDelete = !currentSession || getRole(currentSession.role).canDeleteProducts;
  const tbody     = document.getElementById('productsTbody');

  // ── IDs actualmente en el DOM ────────────────────────────────────────────
  const existingIds = new Set(
    [...tbody.querySelectorAll('tr[data-pid]')].map(tr => Number(tr.dataset.pid))
  );
  const newIds = new Set(list.map(p => p.id));

  // 1) Eliminar filas que ya no están en la lista filtrada
  tbody.querySelectorAll('tr[data-pid]').forEach(tr => {
    if (!newIds.has(Number(tr.dataset.pid))) tr.remove();
  });

  // 2) Insertar o actualizar cada fila en orden
  list.forEach((p, i) => {
    const discount   = p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : null;
    const stockClass = p.stock === 0 ? 'stock-zero' : p.stock < 20 ? 'stock-low' : 'stock-ok';
    const badgeHTML  = p.badge
      ? `<span class="badge-pill badge-${p.badge}">${p.badge==='offer'?`-${discount}%`:p.badge==='new'?'Nuevo':'Favorito'}</span>`
      : `<span class="badge-pill badge-none">—</span>`;

    let tr = tbody.querySelector(`tr[data-pid="${p.id}"]`);

    if (!tr) {
      // Fila nueva: crearla completa (incluyendo <img>)
      tr = document.createElement('tr');
      tr.dataset.pid = p.id;
      tr.innerHTML = `
        <td><img src="${p.image}" alt="${p.name}" class="td-img" onerror="this.src='images/frutas.jpg'" /></td>
        <td class="td-name"></td>
        <td><span class="td-cat"></span></td>
        <td class="td-price-cell"></td>
        <td class="td-stock-cell"></td>
        <td class="td-badge-cell"></td>
        <td class="td-rating-cell"></td>
        <td class="td-barcode-cell"></td>
        <td>
          <div class="action-btns">
            ${canEdit   ? `<button class="action-btn action-btn-edit" onclick="openProductModal(${p.id})" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
            ${canDelete ? `<button class="action-btn action-btn-del"  onclick="deleteProduct(${p.id})"  title="Eliminar"><i class="fas fa-trash"></i></button>` : ''}
            ${!canEdit && !canDelete ? '<span style="color:#bbb;font-size:.78rem">Sin permiso</span>' : ''}
          </div>
        </td>`;
    } else {
      // Fila existente: actualizar imagen SOLO si el src cambió (evita parpadeo)
      const img = tr.querySelector('img.td-img');
      if (img && img.src !== p.image && !img.src.endsWith(p.image)) {
        img.src = p.image;
        img.alt = p.name;
      }
    }

    // Actualizar celdas de texto (nunca tocan la imagen)
    tr.querySelector('.td-name').textContent = p.name;
    tr.querySelector('.td-cat').textContent  = catLabel(p.category);
    tr.querySelector('.td-price-cell').innerHTML =
      `<strong>RD$ ${p.price}</strong>${p.originalPrice ? `<br><small style="text-decoration:line-through;color:#aaa">RD$ ${p.originalPrice}</small>` : ''}`;
    tr.querySelector('.td-stock-cell').innerHTML  = `<span class="${stockClass}">${p.stock}</span>`;
    tr.querySelector('.td-badge-cell').innerHTML  = badgeHTML;
    tr.querySelector('.td-rating-cell').innerHTML = `⭐ ${p.rating} <small style="color:#aaa">(${p.reviews})</small>`;
    tr.querySelector('.td-barcode-cell').innerHTML = p.barcode
      ? `<span style="font-family:monospace;font-size:.8rem;background:#f4f4f4;padding:2px 6px;border-radius:4px;letter-spacing:.04em"><i class="fas fa-barcode" style="color:#666;margin-right:3px"></i>${p.barcode}</span>`
      : `<span style="color:#ddd;font-size:.78rem">—</span>`;

    // Reordenar si la posición en el DOM no coincide con la lista filtrada
    const current = tbody.children[i];
    if (current !== tr) tbody.insertBefore(tr, current || null);
  });
}

// ─── MODAL PRODUCTO ───────────────────────────────────────────────────────────
function openProductModal(id = null) {
  editingProductId = id;
  const modal = document.getElementById('prodModalBackdrop');
  document.getElementById('prodModalTitle').textContent = id ? 'Editar Producto' : 'Nuevo Producto';

  if (id) {
    const p = adminProducts.find(x => x.id === id);
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
  } else {
    ['pName','pPrice','pOriginalPrice','pUnit','pStock','pRating','pDescription','pImage','pBarcode']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('pCategory').value = 'frutas';
    document.getElementById('pBadge').value    = '';
    const bcStatus = document.getElementById('pBarcodeStatus');
    if (bcStatus) bcStatus.textContent = '';
    resetImgUpload();
  }
  modal.classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('prodModalBackdrop').classList.add('hidden');
  editingProductId = null;
  // Limpiar preview de imagen
  resetImgUpload();
}

// ─── Helpers de carga de imagen en modal producto ─────────────────────────────
function resetImgUpload() {
  const zone        = document.getElementById('imgUploadZone');
  const placeholder = document.getElementById('imgUploadPlaceholder');
  const preview     = document.getElementById('imgPreview');
  const status      = document.getElementById('imgUploadStatus');
  const fileInput   = document.getElementById('pImageFile');
  if (zone)        zone.classList.remove('drag-over');
  if (placeholder) placeholder.style.display = 'flex';
  if (preview)     { preview.style.display = 'none'; preview.src = ''; }
  if (status)      status.textContent = '';
  if (fileInput)   fileInput.value = '';
}

function setImgPreview(src, label) {
  const placeholder = document.getElementById('imgUploadPlaceholder');
  const preview     = document.getElementById('imgPreview');
  const status      = document.getElementById('imgUploadStatus');
  if (placeholder) placeholder.style.display = 'none';
  if (preview)     { preview.src = src; preview.style.display = 'block'; }
  if (status)      status.textContent = label || '';
}

// Cargar imagen desde archivo local → convertir a base64 → preview
function handleImgFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showAdminToast('La imagen supera los 5 MB. Elige un archivo más pequeño.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    document.getElementById('pImage').value = base64;
    setImgPreview(base64, `✅ ${file.name} (${(file.size/1024).toFixed(0)} KB)`);
  };
  reader.readAsDataURL(file);
}

// Drag & drop sobre la zona
function handleImgDrop(e) {
  e.preventDefault();
  document.getElementById('imgUploadZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) {
    showAdminToast('Solo se aceptan archivos de imagen.', 'error'); return;
  }
  // Simular asignación al input file
  const dt   = new DataTransfer();
  dt.items.add(file);
  const inp  = document.getElementById('pImageFile');
  inp.files  = dt.files;
  handleImgFile(inp);
}

// Preview al escribir URL manualmente
function previewFromUrl(url) {
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
      if (status) status.textContent = '⚠️ No se pudo cargar la imagen desde esa URL';
    };
    preview.onload = () => {
      if (status) status.textContent = '✅ Imagen cargada desde URL';
    };
  }
}

function saveProduct() {
  // Validar permisos
  if (currentSession) {
    const role = getRole(currentSession.role);
    if (!role.canCreateProducts) { showAdminToast('No tienes permiso para crear o editar productos', 'error'); return; }
    if (!role.canEditPrices && !editingProductId) { showAdminToast('No tienes permiso para cambiar precios', 'error'); return; }
  }
  const name  = document.getElementById('pName').value.trim();
  const price = parseFloat(document.getElementById('pPrice').value);
  if (!name) { showAdminToast('El nombre es obligatorio', 'error'); return; }
  if (isNaN(price) || price <= 0) { showAdminToast('El precio debe ser mayor a 0', 'error'); return; }

  const barcodeVal = document.getElementById('pBarcode').value.trim();
  // Verificar que el código de barras no esté duplicado (salvo el mismo producto)
  if (barcodeVal) {
    const dup = adminProducts.find(p => p.barcode === barcodeVal && p.id !== editingProductId);
    if (dup) { showAdminToast(`El código de barras ya está asignado a "${dup.name}"`, 'error'); return; }
  }

  const data = {
    name,
    category:      document.getElementById('pCategory').value,
    price,
    originalPrice: parseFloat(document.getElementById('pOriginalPrice').value) || null,
    unit:          document.getElementById('pUnit').value || 'unidad',
    stock:         parseInt(document.getElementById('pStock').value) || 0,
    badge:         document.getElementById('pBadge').value || null,
    rating:        parseFloat(document.getElementById('pRating').value) || 4.5,
    description:   document.getElementById('pDescription').value.trim(),
    image:         document.getElementById('pImage').value.trim() || 'images/frutas.jpg',
    barcode:       barcodeVal || null,
    reviews:       0,
    isNew:         false,
  };

  if (editingProductId) {
    const idx = adminProducts.findIndex(p => p.id === editingProductId);
    const updated = idx > -1 ? { ...adminProducts[idx], ...data } : { id: editingProductId, ...data };
    DB.saveProduct(updated)
      .then(saved => {
        if (idx > -1) adminProducts[idx] = saved || updated;
        DBCached.invalidateProducts();
        showAdminToast('Producto actualizado correctamente', 'success');
        renderProductsTable();
        renderInventory();
        closeProductModal();
      })
      .catch(() => showAdminToast('Error al guardar el producto', 'error'));
  } else {
    const newId = String(Date.now());
    const newProd = { id: newId, ...data, reviews: 0, isNew: false };
    _apiCreate('products', newProd)
      .then(saved => {
        adminProducts.push(saved || newProd);
        DBCached.invalidateProducts();
        showAdminToast('Producto creado correctamente', 'success');
        renderProductsTable();
        renderInventory();
        closeProductModal();
      })
      .catch(() => showAdminToast('Error al crear el producto', 'error'));
  }
}

function deleteProduct(id) {
  if (currentSession && !getRole(currentSession.role).canDeleteProducts) {
    showAdminToast('No tienes permiso para eliminar productos', 'error'); return;
  }
  if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
  DB.deleteProduct(id)
    .then(() => {
      adminProducts = adminProducts.filter(p => p.id !== id);
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
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  // Busca la fila por el botón de ver que tiene el orderId
  const tbody = document.getElementById('ordersTbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    const viewBtn = row.querySelector(`[onclick="openOrderModal('${orderId}')"]`);
    if (!viewBtn) return;
    // Actualizar total en la celda 5 (índice 4)
    const cells = row.querySelectorAll('td');
    if (cells[4]) cells[4].innerHTML = `<strong>RD$ ${o.total.toLocaleString('es-DO')}</strong>`;
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

  document.getElementById('orderCount').textContent = `${list.length} pedido${list.length!==1?'s':''}`;

  document.getElementById('ordersTbody').innerHTML = list.map(o => {
    const sourceBadge = o.source === 'tienda'
      ? `<span style="font-size:.68rem;background:#dbeafe;color:#1d4ed8;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:4px"><i class="fas fa-store"></i> Tienda</span>`
      : '';
    return `
    <tr${o.source==='tienda' ? ' style="background:rgba(29,78,216,.03)"' : ''}>
      <td><strong>#${o.id}</strong>${sourceBadge}</td>
      <td>${o.customer}</td>
      <td>${o.email}</td>
      <td>${o.items} productos</td>
      <td><strong>RD$ ${o.total.toLocaleString('es-DO')}</strong></td>
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
}

function openOrderModal(id) {
  const o = orders.find(x => String(x.id) === String(id));
  if (!o) return;
  editingOrderId = id;
  document.getElementById('orderModalTitle').textContent = `Pedido #${o.id} — ${o.customer}`;

  _renderOrderModalProducts(o);

  document.getElementById('orderModalBackdrop').classList.remove('hidden');
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
                       onerror="this.src='images/frutas.jpg'"
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
                RD$ ${l.price.toLocaleString('es-DO')}
              </td>
              <td style="text-align:right;white-space:nowrap;font-weight:700;color:var(--green)" id="opd-sub-${idx}">
                RD$ ${l.subtotal.toLocaleString('es-DO')}
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
                       onerror="this.src='images/frutas.jpg'"
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
                RD$ ${l.price.toLocaleString('es-DO')}
              </td>
              <td style="text-align:right;white-space:nowrap;font-weight:700;color:var(--green)">
                RD$ ${l.subtotal.toLocaleString('es-DO')}
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
      <span>${o.address || 'Sin dirección registrada'}</span>
      ${(()=>{ const cl = customers.find(c=>c.id===o.clientId||c.email===o.email); return cl&&cl.mapLink ? `<a href="${cl.mapLink}" target="_blank" rel="noopener" class="btn-map-link" style="margin-left:auto;font-size:.75rem"><i class="fas fa-map-location-dot"></i> Ver en Maps</a>` : ''; })()}
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
          <tfoot>
            ${(()=>{
              const _sub  = lines.reduce((s,l) => s + (Number(l.subtotal)||(Number(l.price)*Number(l.cantidad||1))), 0);
              const _ship = Number(o.shipping || 0);
              const _desc = Number(o.descuento || 0);
              const _cup  = o.cuponUsado || '';
              const cols  = isPending ? 4 : 3;
              return `
                <tr style="font-size:.85rem;color:#555">
                  <td colspan="${cols}" style="text-align:right;padding-right:16px">Subtotal:</td>
                  <td style="text-align:right;white-space:nowrap">RD$ ${_sub.toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
                  ${isPending?'<td></td>':''}
                </tr>
                <tr style="font-size:.85rem;color:#555">
                  <td colspan="${cols}" style="text-align:right;padding-right:16px">Envío:</td>
                  <td style="text-align:right;white-space:nowrap;color:${_ship===0?'#1a7c3e':'#555'}">${_ship===0?'<strong>¡Gratis!</strong>':'RD$ '+_ship.toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
                  ${isPending?'<td></td>':''}
                </tr>
                ${_desc > 0 ? `
                <tr style="font-size:.85rem;color:#1a7c3e;font-weight:600">
                  <td colspan="${cols}" style="text-align:right;padding-right:16px">
                    <i class="fas fa-tag"></i> Descuento${_cup ? ` (cupón: ${_cup})` : ''}:
                  </td>
                  <td style="text-align:right;white-space:nowrap">- RD$ ${_desc.toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
                  ${isPending?'<td></td>':''}
                </tr>` : ''}
                <tr class="order-total-row">
                  <td colspan="${cols}" style="text-align:right;font-weight:700;padding-right:16px;border-top:2px solid #e2e8f0">Total del pedido:</td>
                  <td style="text-align:right;font-size:1.15rem;font-weight:800;color:var(--green);white-space:nowrap;border-top:2px solid #e2e8f0" id="opd-total-cell">
                    RD$ ${o.total.toLocaleString('es-DO',{minimumFractionDigits:2})}
                  </td>
                  ${isPending?'<td style="border-top:2px solid #e2e8f0"></td>':''}
                </tr>`;
            })()}
          </tfoot>
        </table>
      </div>
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
  const input = document.getElementById(`opd-qty-${lineIdx}`);
  const subEl = document.getElementById(`opd-sub-${lineIdx}`);
  const minBtn = document.querySelector(`#opr-${lineIdx} .opd-qty-btn`);
  if (input) input.value = newQty;
  if (subEl) subEl.textContent = `RD$ ${line.subtotal.toLocaleString('es-DO')}`;
  if (minBtn) minBtn.innerHTML = `<i class="fas fa-minus"></i>`;
  const totalCell = document.getElementById('opd-total-cell');
  if (totalCell) totalCell.textContent = `RD$ ${o.total.toLocaleString('es-DO')}`;

  _patchOrderRow(editingOrderId); // actualiza solo la fila en la tabla de fondo
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
  if (subEl)    subEl.textContent = `RD$ ${line.subtotal.toLocaleString('es-DO')}`;
  if (minBtn)   minBtn.innerHTML  = `<i class="fas fa-minus"></i>`;
  if (totalCell) totalCell.textContent = `RD$ ${o.total.toLocaleString('es-DO')}`;

  _patchOrderRow(editingOrderId); // actualiza solo la fila en la tabla de fondo
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
  document.getElementById('orderModalBackdrop').classList.add('hidden');
  editingOrderId = null;
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

function saveOrderStatus() {
  if (!editingOrderId) return;
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
          `🛒 Pedido #${order.id} entregado (RD$ ${(order.total||0).toLocaleString('es-DO')})`,
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
          `↩️ Pedido #${order.id} revertido de entregado`,
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
      closeOrderModal();
      showAdminToast('Pedido actualizado correctamente', 'success');
      // ── Notificación automática al cliente ──────────────────────
      if (newStatus !== prevStatus && typeof sendOrderStatusNotification === 'function') {
        sendOrderStatusNotification(orders[idx], newStatus);
      }
    })
    .catch(() => showAdminToast('Error al guardar el pedido', 'error'));
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
      <span style="font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px;background:${c.status==='vip'?'#fff8e1':c.status==='inactivo'?'#fce4ec':'#e8f5ee'};color:${c.status==='vip'?'#c77a00':c.status==='inactivo'?'#c62828':'#1a7c3e'}">
        ${c.status==='vip'?'⭐ VIP':c.status==='inactivo'?'Inactivo':'Activo'}
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
        onerror="this.src='images/frutas.jpg'"
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
        ? `Stock disponible: <b>${prod.stock}</b> · RD$ ${prod.price} / ${prod.unit || 'u.'}`
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
      ? `RD$ ${(prod.price * (noLines[idx].cantidad || 1)).toLocaleString('es-DO')}`
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
      .map(p => `<option value="${p.id}" ${String(p.id)===String(line.productId)?'selected':''}>${p.name} (Stock: ${p.stock}) — RD$ ${p.price}</option>`)
      .join('');

    // Foto del producto (si está seleccionado)
    const imgHTML = prod
      ? `<img src="${prod.image}" alt="${prod.name}"
              onerror="this.src='images/frutas.jpg'"
              style="width:46px;height:46px;border-radius:8px;object-fit:cover;border:1px solid #eee;flex-shrink:0" />`
      : `<div style="width:46px;height:46px;border-radius:8px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;flex-shrink:0">
           <i class="fas fa-image" style="color:#ccc;font-size:1.1rem"></i>
         </div>`;

    const maxQty    = prod ? prod.stock : 999;
    const subtotal  = prod ? `RD$ ${(prod.price * line.cantidad).toLocaleString('es-DO')}` : '—';
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
          <div class="no-prod-info" style="font-size:.72rem;color:#aaa;margin-top:3px">${prod ? `Stock disponible: <b>${prod.stock}</b> · RD$ ${prod.price} / ${prod.unit||'u.'}` : ''}</div>
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
  if (subEl && prod)  subEl.textContent = `RD$ ${(prod.price * newQty).toLocaleString('es-DO')}`;
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

  if (subEl)  subEl.textContent  = `RD$ ${subtotal.toLocaleString('es-DO')}`;
  if (shipEl) shipEl.textContent = shipping === 0 ? '🎉 Gratis' : `RD$ ${shipping.toLocaleString('es-DO')}`;
  if (shipRow) shipRow.style.color = shipping === 0 ? '#1a7c3e' : '';
  if (totEl)  totEl.textContent  = `RD$ ${total.toLocaleString('es-DO')}`;
}

// Guardar el nuevo pedido
async function saveNewOrder() {
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

  // Generar ID incremental basado en pedidos en memoria
  const maxId = orders.reduce((mx, o) => Math.max(mx, Number(o.id) || 0), 0);
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

  // Guardar pedido en API y en memoria
  DB.createOrder(newOrder)
    .then(saved => {
      orders.unshift(saved || newOrder);
      DBCached.invalidateOrders();
      closeNewOrderModal();
      renderOrdersTable();
      updatePendingBadge();
      renderInventory();
      showAdminToast(`✅ Pedido #${newId} creado para ${client.name}`, 'success');
    })
    .catch(() => showAdminToast('Error al guardar el pedido', 'error'));
}

function updatePendingBadge() {
  // Badges del sidebar desactivados — los conteos se muestran en las KPI cards del Dashboard
}

// ─── INVENTARIO ───────────────────────────────────────────────────────────────
function renderInventory() {
  const q       = (document.getElementById('invSearch')?.value || '').toLowerCase();
  const filter  = document.getElementById('invStockFilter')?.value || '';
  const barcode = (document.getElementById('invBarcodeSearch')?.value || '').trim();

  const list = adminProducts.filter(p => {
    const matchQ   = !q || p.name.toLowerCase().includes(q)
                         || (p.barcode || '').toLowerCase().includes(q);
    const matchF   = !filter || (filter === 'low' ? p.stock < 20 : p.stock >= 20);
    const matchBar = !barcode || (p.barcode || '').toLowerCase().includes(barcode.toLowerCase());
    return matchQ && matchF && matchBar;
  });

  const total = adminProducts.reduce((s, p) => s + p.stock, 0);
  const low   = adminProducts.filter(p => p.stock > 0 && p.stock < 20).length;
  const zero  = adminProducts.filter(p => p.stock === 0).length;

  document.getElementById('invTotal').textContent = total;
  document.getElementById('invLow').textContent   = low;
  document.getElementById('invZero').textContent  = zero;
  document.getElementById('invCount').textContent = `${list.length} producto${list.length!==1?'s':''}`;

  const tbody  = document.getElementById('inventoryTbody');
  const newIds = new Set(list.map(p => p.id));

  // 1) Eliminar filas que ya no están en la lista filtrada
  tbody.querySelectorAll('tr[data-invid]').forEach(tr => {
    if (!newIds.has(Number(tr.dataset.invid))) tr.remove();
  });

  // 2) Insertar o actualizar cada fila preservando las imágenes
  list.forEach((p, i) => {
    const cls      = p.stock === 0 ? 'stock-zero' : p.stock < 20 ? 'stock-low' : 'stock-ok';
    const label    = p.stock === 0 ? '🔴 Sin stock' : p.stock < 20 ? '🟡 Stock bajo' : '🟢 Normal';
    const pct      = Math.min(100, Math.round(p.stock / 150 * 100));
    const barColor = p.stock === 0 ? '#e53935' : p.stock < 20 ? '#f57c00' : '#1a7c3e';

    let tr = tbody.querySelector(`tr[data-invid="${p.id}"]`);

    if (!tr) {
      // Fila nueva: crear con imagen
      tr = document.createElement('tr');
      tr.dataset.invid = p.id;
      tr.innerHTML = `
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <img src="${p.image}" data-inv-img
                 style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0"
                 onerror="this.src='images/frutas.jpg'" />
            <strong class="inv-prod-name"></strong>
          </div>
        </td>
        <td><span class="td-cat inv-cat"></span></td>
        <td class="inv-stock-cell"></td>
        <td class="inv-label-cell"></td>
        <td class="inv-barcode-cell"></td>
        <td>
          <div class="inv-adjust">
            <button class="inv-btn" onclick="adjustStock(${p.id},-5)">-5</button>
            <button class="inv-btn" onclick="adjustStock(${p.id},-1)">-1</button>
            <span class="inv-qty"></span>
            <button class="inv-btn" onclick="adjustStock(${p.id},1)">+1</button>
            <button class="inv-btn" onclick="adjustStock(${p.id},10)">+10</button>
          </div>
        </td>`;
    } else {
      // Actualizar imagen solo si cambió el src
      const img = tr.querySelector('img[data-inv-img]');
      if (img && img.src !== p.image && !img.src.endsWith(p.image)) {
        img.src = p.image;
      }
    }

    // Actualizar celdas de texto/stock (sin tocar la imagen)
    tr.querySelector('.inv-prod-name').textContent = p.name;
    tr.querySelector('.inv-cat').textContent        = catLabel(p.category);
    tr.querySelector('.inv-stock-cell').innerHTML   =
      `<span class="${cls}" style="font-size:1.05rem">${p.stock}</span>
       <div class="stock-bar-wrap"><div class="stock-bar" style="width:${pct}%;background:${barColor}"></div></div>`;
    tr.querySelector('.inv-label-cell').textContent = label;
    tr.querySelector('.inv-barcode-cell').innerHTML = p.barcode
      ? `<span style="font-family:monospace;font-size:.8rem;background:#f4f4f4;padding:2px 6px;border-radius:4px;letter-spacing:.04em"><i class="fas fa-barcode" style="color:#666;margin-right:3px"></i>${p.barcode}</span>`
      : `<span style="color:#ddd;font-size:.78rem">—</span>`;
    tr.querySelector('.inv-qty').textContent        = p.stock;

    // Reordenar si es necesario
    const current = tbody.children[i];
    if (current !== tr) tbody.insertBefore(tr, current || null);
  });
}

function adjustStock(id, delta) {
  const p = adminProducts.find(x => x.id === id);
  if (!p) return;
  p.stock = Math.max(0, p.stock + delta);
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
  customers[idx].loyaltyLastActivity = new Date().toISOString();

  customers[idx].loyaltyHistory.unshift({
    date:    new Date().toLocaleDateString('es-DO'),
    pts,
    reason,
    orderId,
    balance: customers[idx].loyaltyPoints
  });

  DB.updateCustomer(customerId, customers[customers.findIndex(c => c.id === customerId)])
    .catch(() => {});
  DBCached.invalidateCustomers();
}

// Verifica y aplica vencimiento de puntos (6 meses sin actividad)
function checkPointsExpiry(customer) {
  if (!customer.loyaltyLastActivity || !customer.loyaltyPoints) return customer;
  const lastAct   = new Date(customer.loyaltyLastActivity);
  const monthsDiff = (Date.now() - lastAct) / (1000 * 60 * 60 * 24 * 30);
  if (monthsDiff >= LOYALTY.expiryMonths && customer.loyaltyPoints > 0) {
    customer.loyaltyPoints        = 0;
    customer.loyaltyLastActivity  = new Date().toISOString();
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

  document.getElementById('custCount').textContent = `${list.length} cliente${list.length!==1?'s':''}`;

  document.getElementById('customersTbody').innerHTML = list.map((c,i) => {
    const statusMap   = { activo:'cst-activo', inactivo:'cst-inactivo', vip:'cst-vip' };
    const statusLabel = { activo:'Activo', inactivo:'Inactivo', vip:'⭐ VIP' };
    const stCls    = statusMap[c.status] || 'cst-activo';
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
              <span class="cust-status ${stCls}">${statusLabel[c.status]||'Activo'}</span>
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
      <td><strong style="color:#1a7c3e">RD$ ${(c.spent||0).toLocaleString('es-DO')}</strong></td>
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
    document.getElementById('cStatus').value  = c.status  || 'activo';
    document.getElementById('cNotes').value   = c.notes   || '';
    document.getElementById('cMapLink').value = c.mapLink || '';
    previewCustMap();
  } else {
    setPhoneValue('cPhone', 'cPhonePrefix', '');
    ['cName','cEmail','cCedula','cAddress','cCity','cNotes','cMapLink'].forEach(f => {
      document.getElementById(f).value = '';
    });
    document.getElementById('cStatus').value = 'activo';
    previewCustMap();
  }
  document.getElementById('custModalBackdrop').classList.remove('hidden');
  setTimeout(() => document.getElementById('cName').focus(), 100);
}

function toggleCustPass(fieldId, iconId) {
  const inp  = document.getElementById(fieldId);
  const icon = document.getElementById(iconId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  if (icon) icon.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
}

function closeCustomerModal() {
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

function saveCustomer() {
  const name     = document.getElementById('cName').value.trim();
  const email    = document.getElementById('cEmail').value.trim();
  const password = document.getElementById('cPassword')?.value  || '';
  const password2= document.getElementById('cPassword2')?.value || '';

  if (!name)  { showAdminToast('El nombre es obligatorio', 'error'); return; }
  if (!email) { showAdminToast('El email es obligatorio', 'error'); return; }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    showAdminToast('El email no tiene un formato válido', 'error'); return;
  }
  const duplicate = customers.find(c => c.email === email && c.id !== editingCustomerId);
  if (duplicate) { showAdminToast('Ya existe un cliente con ese email', 'error'); return; }

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
    notes:   document.getElementById('cNotes').value.trim(),
    mapLink: document.getElementById('cMapLink').value.trim(),
  };
  // Solo actualizar contraseña si se ingresó una nueva
  if (password) data.password = password;

  if (editingCustomerId) {
    const idx = customers.findIndex(c => c.id === editingCustomerId);
    if (idx > -1) customers[idx] = { ...customers[idx], ...data };
    DB.updateCustomer(editingCustomerId, customers[customers.findIndex(c => c.id === editingCustomerId)])
      .then(() => { DBCached.invalidateCustomers(); renderCustomers(); closeCustomerModal(); showAdminToast('Cliente actualizado correctamente', 'success'); })
      .catch(() => showAdminToast('Error al guardar cliente', 'error'));
  } else {
    const newC = {
      id: 'c_' + Date.now(),
      ...data,
      orders: 0, spent: 0, lastOrder: null, createdAt: today,
      loyaltyPoints: 0, loyaltyHistory: [], loyaltyLastActivity: new Date().toISOString(),
    };
    customers.push(newC);
    DB.createCustomer(newC)
      .then(saved => { if(saved) customers[customers.length-1] = saved; DBCached.invalidateCustomers(); renderCustomers(); closeCustomerModal(); showAdminToast('Cliente creado — ya puede iniciar sesión en la tienda', 'success'); })
      .catch(() => showAdminToast('Error al crear cliente', 'error'));
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
      <div class="order-detail-item"><label>Total gastado</label><span style="color:#1a7c3e;font-weight:700">RD$ ${(c.spent||0).toLocaleString('es-DO')}</span></div>
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
  document.getElementById('staffCount').textContent      = `${list.length} empleado${list.length!==1?'s':''}`;

  const roleColors = { superadmin:'#7c3aed', admin:'#1565c0', operador:'#1a7c3e' };
  const roleLabels = { superadmin:'Super Admin', admin:'Administrador', operador:'Operador' };
  const roleIcons  = { superadmin:'fa-crown', admin:'fa-user-shield', operador:'fa-user-gear' };

  // Saber si el usuario actual puede gestionar personal
  const canManage = currentSession && getRole(currentSession.role).canManageStaff;
  // No permitir eliminar la propia cuenta
  const myId = currentSession ? currentSession.id : null;

  document.getElementById('staffTbody').innerHTML = list.map((s,i) => {
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
  document.getElementById('staffModalBackdrop').classList.add('hidden');
  editingStaffId = null;
}

function saveStaff() {
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
    DB.updateStaff(editingStaffId, staffList[staffList.findIndex(s => s.id === editingStaffId)])
      .then(() => { DBCached.invalidateStaff(); renderStaff(); closeStaffModal(); showAdminToast('Empleado actualizado correctamente', 'success'); })
      .catch(() => showAdminToast('Error al guardar empleado', 'error'));
  } else {
    const newS = { id: 'staff_' + Date.now(), ...data, avatar: '', createdAt: today, lastLogin: null };
    staffList.push(newS);
    DB.createStaff(newS)
      .then(saved => { if(saved) staffList[staffList.length-1] = saved; DBCached.invalidateStaff(); renderStaff(); closeStaffModal(); showAdminToast('Empleado creado correctamente', 'success'); })
      .catch(() => showAdminToast('Error al crear empleado', 'error'));
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
    .then(() => { DBCached.invalidateSettings(); showAdminToast('✅ Configuración guardada correctamente', 'success'); })
    .catch(() => showAdminToast('Error al guardar configuración', 'error'));
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
  document.getElementById('drvModalBackdrop').classList.add('hidden');
  editingDriverId = null;
}

function updateDrvAvatar() {
  const name = document.getElementById('drvName')?.value || '';
  const ini  = name.trim().split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
  const el   = document.getElementById('drvAvatarPreview');
  if (el) el.textContent = ini;
}

function saveDriver() {
  const name  = document.getElementById('drvName').value.trim();
  const phone = getPhoneValue('drvPhone', 'drvPhonePrefix');
  if (!name)  { showAdminToast('El nombre es obligatorio', 'error'); return; }
  if (!phone) { showAdminToast('El teléfono es obligatorio', 'error'); return; }

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

  if (editingDriverId) {
    const idx = drivers.findIndex(d => d.id === editingDriverId);
    if (idx > -1) drivers[idx] = { ...drivers[idx], ...data };
    DB.updateDriver(editingDriverId, drivers[drivers.findIndex(d => d.id === editingDriverId)])
      .then(() => { DBCached.invalidateDrivers(); closeDriverModal(); renderDrivers(); showAdminToast('Repartidor actualizado correctamente', 'success'); })
      .catch(() => showAdminToast('Error al guardar repartidor', 'error'));
  } else {
    const newD = { id: 'drv_' + Date.now(), ...data, createdAt: new Date().toLocaleDateString('es-DO') };
    drivers.push(newD);
    DB.createDriver(newD)
      .then(saved => { if(saved) drivers[drivers.length-1] = saved; DBCached.invalidateDrivers(); closeDriverModal(); renderDrivers(); showAdminToast('Repartidor registrado correctamente', 'success'); })
      .catch(() => showAdminToast('Error al crear repartidor', 'error'));
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
          <td style="font-size:.82rem;text-align:right;font-weight:700;color:#1a7c3e">RD$ ${(o.total||0).toLocaleString('es-DO')}</td>
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
  const icons = { success:'fa-check-circle', error:'fa-circle-xmark', info:'fa-circle-info' };
  t.innerHTML = `<i class="fas ${icons[type]||'fa-circle-info'}"></i> ${msg}`;
  container.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 3200);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function catLabel(cat) {
  const m = { frutas:'Frutas', vegetales:'Vegetales', carnes:'Carnes', lacteos:'Lácteos', panaderia:'Panadería', mariscos:'Mariscos', bebidas:'Bebidas', despensa:'Despensa', embutidos:'Embutidos', cuidado_personal:'Cuidado Personal', electrodomesticos:'Electrodomésticos', ferreteria:'Ferretería' };
  return m[cat] || cat;
}
function ucFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

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
