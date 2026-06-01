/**
 * SUPERMERCADO CASA MOTA — API.JS
 * Capa de acceso unificada a la API RESTful
 * Reemplaza todas las operaciones de localStorage para datos persistentes.
 *
 * Tablas disponibles: products, customers, orders, staff, drivers, settings, categories
 *
 * NOTA: El carrito (casamota_cart) y la sesión activa (cm_session) siguen
 * usando localStorage/sessionStorage porque son datos locales del dispositivo.
 */

// ─── Helpers base ─────────────────────────────────────────────────────────────

// Timeouts diferenciados:
//   - GET/DELETE  → 20 s  (lecturas rápidas)
//   - POST/PUT/PATCH → 45 s  (escrituras con payload grande pueden tardar más)
function _apiFetchTimeout(method) {
  const m = (method || 'GET').toUpperCase();
  return ['POST', 'PUT', 'PATCH'].includes(m) ? 45000 : 20000;
}

async function _apiFetch(path, options = {}, _retry = 1) {
  // ⚠️ POST nunca se reintenta: si el servidor recibió la petición y la respuesta
  // se perdió, un retry crearía un duplicado en la BD.
  // Solo GET y DELETE son seguros de reintentar (idempotentes).
  const method      = (options.method || 'GET').toUpperCase();
  const isMutating  = ['POST', 'PUT', 'PATCH'].includes(method);
  const retryCount  = isMutating ? 0 : _retry; // POST/PUT/PATCH → sin retry

  // Crear un AbortController NUEVO en cada intento (no reutilizar uno ya abortado)
  const ctrl    = new AbortController();
  const timeout = _apiFetchTimeout(method);
  let   _timedOut = false;
  const timer   = setTimeout(() => { _timedOut = true; ctrl.abort(); }, timeout);

  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 204) return null; // DELETE devuelve sin cuerpo
    if (!res.ok) {
      const text = await res.text();
      // Errores de infraestructura seguros de reintentar incluso en POST:
      // 502/503/504 = servidor caído/sobrecargado, nunca procesó la petición
      // 520/521/522/524 = Cloudflare no pudo conectar al servidor backend
      // En todos estos casos el servidor NO llegó a escribir nada en la BD
      const safeRetry = [502, 503, 504, 520, 521, 522, 524];
      if (_retry > 0 && safeRetry.includes(res.status)) {
        await new Promise(r => setTimeout(r, 1500));
        return _apiFetch(path, options, _retry - 1);
      }
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    // Retry solo si fue nuestro timeout o fallo de red — solo en GETs
    const isOurTimeout = e.name === 'AbortError' && _timedOut;
    const isNetworkErr = e.name === 'TypeError';
    if (retryCount > 0 && (isOurTimeout || isNetworkErr)) {
      await new Promise(r => setTimeout(r, 1000));
      return _apiFetch(path, options, retryCount - 1);
    }
    throw e;
  }
}

// GET con paginación automática — si hay más de 500 registros, carga todas las páginas
async function _apiGetAll(table, params = {}) {
  // Primera página
  const qs1  = new URLSearchParams({ limit: 500, page: 1, ...params }).toString();
  const res1 = await _apiFetch(`tables/${table}?${qs1}`);
  if (!res1) return { data: [], total: 0 };

  const total = res1.total || 0;
  const limit = res1.limit || 500;
  let   all   = res1.data  || [];

  // Si hay más páginas, cargarlas en paralelo
  if (total > limit) {
    const pages = Math.ceil(total / limit);
    const fetches = [];
    for (let p = 2; p <= pages; p++) {
      const qs = new URLSearchParams({ limit: 500, page: p, ...params }).toString();
      fetches.push(_apiFetch(`tables/${table}?${qs}`).then(r => r?.data || []));
    }
    const extras = await Promise.all(fetches);
    for (const batch of extras) all = all.concat(batch);
  }

  return { data: all, total, limit };
}

async function _apiGet(table, id) {
  return _apiFetch(`tables/${table}/${id}`);
}

async function _apiCreate(table, data) {
  return _apiFetch(`tables/${table}`, { method: 'POST', body: JSON.stringify(data) });
}

async function _apiUpdate(table, id, data) {
  return _apiFetch(`tables/${table}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

async function _apiPatch(table, id, data) {
  return _apiFetch(`tables/${table}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

async function _apiDelete(table, id) {
  return _apiFetch(`tables/${table}/${id}`, { method: 'DELETE' });
}

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────

// Total REAL de productos en la BD (se actualiza con cada llamada a getProducts)
// Se usa en el dashboard KPI para mostrar el número correcto cuando hay > 500
let _totalProductsInDB = 0;

const DB = {

  // ── Productos ──────────────────────────────────────────────────────────────
  async getProducts() {
    const res = await _apiGetAll('products');
    // Guardar el total real para el KPI del dashboard
    if (res.total > 0) _totalProductsInDB = res.total;
    return res.data || [];
  },

  async saveProduct(product, changedFields = null) {
    // Si tiene id → edición
    // changedFields: objeto con solo los campos modificados → usa PATCH (más rápido)
    // sin changedFields: usa PATCH con todo el producto (evita PUT lento)
    if (product.id) {
      const payload = changedFields || product;
      return _apiPatch('products', product.id, payload);
    } else {
      return _apiCreate('products', product);
    }
  },

  async deleteProduct(id) {
    return _apiDelete('products', id);
  },

  // ── Pedidos ────────────────────────────────────────────────────────────────
  async getOrders() {
    const res = await _apiGetAll('orders', { sort: 'created_at' });
    return res.data || [];
  },

  async createOrder(order) {
    return _apiCreate('orders', order);
  },

  async updateOrder(id, order) {
    return _apiUpdate('orders', id, order);
  },

  async patchOrder(id, fields) {
    return _apiPatch('orders', id, fields);
  },

  async deleteOrder(id) {
    return _apiDelete('orders', id);
  },

  // ── Clientes ───────────────────────────────────────────────────────────────
  async getCustomers() {
    const res = await _apiGetAll('customers');
    return res.data || [];
  },

  async getCustomerByEmail(email) {
    const res = await _apiGetAll('customers', { search: email });
    const list = res.data || [];
    return list.find(c => c.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async createCustomer(customer) {
    return _apiCreate('customers', customer);
  },

  async updateCustomer(id, customer) {
    return _apiUpdate('customers', id, customer);
  },

  async patchCustomer(id, fields) {
    return _apiPatch('customers', id, fields);
  },

  async deleteCustomer(id) {
    return _apiDelete('customers', id);
  },

  // ── Personal (Staff) ───────────────────────────────────────────────────────
  async getStaff() {
    const res = await _apiGetAll('staff');
    return res.data || [];
  },

  async getStaffByEmail(email) {
    const res = await _apiGetAll('staff', { search: email });
    const list = res.data || [];
    return list.find(s => s.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async createStaff(member) {
    return _apiCreate('staff', member);
  },

  async updateStaff(id, member) {
    return _apiUpdate('staff', id, member);
  },

  async patchStaff(id, fields) {
    return _apiPatch('staff', id, fields);
  },

  async deleteStaff(id) {
    return _apiDelete('staff', id);
  },

  // ── Repartidores ───────────────────────────────────────────────────────────
  async getDrivers() {
    const res = await _apiGetAll('drivers');
    return res.data || [];
  },

  async createDriver(driver) {
    return _apiCreate('drivers', driver);
  },

  async updateDriver(id, driver) {
    return _apiUpdate('drivers', id, driver);
  },

  async deleteDriver(id) {
    return _apiDelete('drivers', id);
  },

  // ── Configuración ──────────────────────────────────────────────────────────
  async getSettings() {
    const _defaults = {
      storeName: 'Supermercado Casa Mota',
      storeEmail: 'info@casamota.com.do',
      storePhone: '809-555-2684',
      storeAddress: 'Av. Principal #123, Santo Domingo',
      storeCity: 'Santo Domingo',
      currency: 'RD$',
      shippingFee: 150,
      freeShippingMin: 1500,
      serviceZones: 'Santo Domingo, Santiago, La Romana',
      hoursWeekday: '7:00 AM – 8:00 PM',
      hoursSunday:  '8:00 AM – 8:00 PM',
      taxPercent: 0,
      loyaltyPesosPerPoint: 10,
      loyaltyPointsEarned: 1,
      loyaltyPointValue: 1,
      loyaltyExpiryMonths: 6,
    };
    try {
      // Buscar el registro de settings en la tabla (puede ser cualquier UUID)
      const res = await _apiGetAll('settings');
      const list = res.data || [];
      if (list.length > 0) {
        // Tomar el primero no eliminado y mergearlo con defaults
        const active = list.filter(r => !r.deleted);
        const saved  = active.length > 0 ? active[0] : list[0];
        return { ..._defaults, ...saved };
      }
      return _defaults;
    } catch {
      return _defaults;
    }
  },

  // ── Categorías ─────────────────────────────────────────────────────────────
  // NOTA: Las categorías usan el campo "slug" como identificador de negocio.
  //       El campo "id" es el UUID interno generado por la API REST.
  async getCategories() {
    try {
      const res = await _apiGetAll('categories', { limit: 500 });
      const raw = (res.data || []).filter(r => !r.deleted);

      // Deduplicar por slug: quedarse solo con el primero de cada slug
      const seen = new Map();
      for (const cat of raw) {
        const key = cat.slug || cat.id;
        if (key && !seen.has(key)) seen.set(key, cat);
      }
      const list = [...seen.values()];

      return list.sort((a, b) => (Number(a.sort_order) || 99) - (Number(b.sort_order) || 99));
    } catch { return []; }
  },

  async saveCategory(cat) {
    // cat._apiUuid: UUID real de la API (presente en edición), cat.slug: slug de negocio
    try {
      if (cat._apiUuid) {
        // Edición: actualizar por UUID real
        const { _apiUuid, ...catData } = cat;
        return await _apiUpdate('categories', _apiUuid, catData);
      }
      // Creación: buscar si ya existe por slug para no duplicar
      const res  = await _apiGetAll('categories', { search: cat.slug });
      const list = (res.data || []).filter(r => !r.deleted && r.slug === cat.slug);
      if (list.length > 0) {
        return await _apiUpdate('categories', list[0].id, cat);
      }
      return await _apiCreate('categories', cat);
    } catch(e) {
      console.warn('[DB.saveCategory]', e);
      return await _apiCreate('categories', cat);
    }
  },

  async deleteCategory(apiUuid) {
    return _apiDelete('categories', apiUuid);
  },

  async saveSettings(data) {
    // Obtener el registro existente para saber su UUID real en la API.
    // IMPORTANTE: la tabla usa UUIDs generados por la API, NO el campo id:'main'.
    try {
      const res = await _apiGetAll('settings');
      const list = (res.data || []).filter(r => !r.deleted);
      if (list.length > 0) {
        // Actualizar el primer registro no eliminado fusionando con datos existentes
        const existing = list[0];
        const merged = { ...existing, ...data };
        return await _apiUpdate('settings', existing.id, merged);
      }
      // No existe ningún registro → crear uno nuevo
      return await _apiCreate('settings', { ...data });
    } catch(e) {
      console.warn('[DB.saveSettings] Error:', e);
      // Último fallback: crear
      return await _apiCreate('settings', { ...data });
    }
  },

};

// ─── Cache en memoria (para no repetir llamadas dentro de la misma sesión) ────
// Los módulos que necesitan velocidad pueden usar esta cache.
// Se invalida al hacer operaciones de escritura.
const _cache = {
  products:  null,
  customers: null,
  orders:    null,
  staff:     null,
  drivers:   null,
  settings:  null,
};

const DBCached = {
  async getProducts(force = false) {
    if (!force && _cache.products) return _cache.products;
    _cache.products = await DB.getProducts();
    return _cache.products;
  },
  invalidateProducts() { _cache.products = null; },

  async getCustomers(force = false) {
    if (!force && _cache.customers) return _cache.customers;
    _cache.customers = await DB.getCustomers();
    return _cache.customers;
  },
  invalidateCustomers() { _cache.customers = null; },

  async getOrders(force = false) {
    if (!force && _cache.orders) return _cache.orders;
    _cache.orders = await DB.getOrders();
    return _cache.orders;
  },
  invalidateOrders() { _cache.orders = null; },

  async getStaff(force = false) {
    if (!force && _cache.staff) return _cache.staff;
    _cache.staff = await DB.getStaff();
    return _cache.staff;
  },
  invalidateStaff() { _cache.staff = null; },

  async getDrivers(force = false) {
    if (!force && _cache.drivers) return _cache.drivers;
    _cache.drivers = await DB.getDrivers();
    return _cache.drivers;
  },
  invalidateDrivers() { _cache.drivers = null; },

  async getSettings(force = false) {
    if (!force && _cache.settings) return _cache.settings;
    _cache.settings = await DB.getSettings();
    return _cache.settings;
  },
  invalidateSettings() { _cache.settings = null; },
};
