/**
 * SUPERMERCADO CASA MOTA — API.JS
 * Capa de acceso unificada → Supabase PostgREST
 *
 * Tablas: products, customers, orders, staff, drivers, settings, categories,
 *         cupones, notificaciones
 *
 * Entornos:
 *   - Genspark (desarrollo): usa tables/ API interna
 *   - supermercadocasamota.com (producción): usa Supabase PostgREST
 */

// ─── Detección de entorno ─────────────────────────────────────────────────────
// En Genspark usamos tables/ — en producción usamos Supabase directamente
const _IS_GENSPARK = location.hostname.includes('gensparkspace.com')
                  || location.hostname.includes('genspark.ai')
                  || location.hostname === 'localhost'
                  || location.hostname === '127.0.0.1';

// ─── Configuración Supabase ───────────────────────────────────────────────────
const _SB_URL = 'https://hmloadberrekcxdgdcdn.supabase.co/rest/v1';
const _SB_KEY = 'sb_publishable_4CPOJ5ku869otPf5-fteEA_yvBv06Rm';

const _SB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        _SB_KEY,
  'Authorization': `Bearer ${_SB_KEY}`,
};

// ─── Timeouts ─────────────────────────────────────────────────────────────────
function _apiFetchTimeout(method) {
  const m = (method || 'GET').toUpperCase();
  return ['POST', 'PUT', 'PATCH'].includes(m) ? 45000 : 20000;
}

// ─── Fetch base con timeout ───────────────────────────────────────────────────
async function _apiFetch(url, options = {}) {
  const method    = (options.method || 'GET').toUpperCase();
  const ctrl      = new AbortController();
  let   _timedOut = false;
  const timer     = setTimeout(() => { _timedOut = true; ctrl.abort(); }, _apiFetchTimeout(method));

  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);

    if (res.status === 204 || res.status === 201 && res.headers.get('content-length') === '0') {
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      // Errores de infraestructura seguros de reintentar
      const safeRetry = [502, 503, 504, 520, 521, 522, 524];
      if (safeRetry.includes(res.status)) {
        await new Promise(r => setTimeout(r, 1500));
        return _apiFetch(url, options); // 1 solo retry
      }
      throw new Error(`API error ${res.status}: ${text}`);
    }

    // 201 Created o 200 OK con cuerpo
    const text = await res.text();
    if (!text || text === '[]' || text === 'null') return null;
    const parsed = JSON.parse(text);
    // PostgREST devuelve array en POST con Prefer:return=representation → tomar primer elemento
    return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed;

  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError' && _timedOut) {
      throw new Error('La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.');
    }
    throw e;
  }
}

// ─── Campos mínimos por tabla (evita traer columnas pesadas innecesarias) ──────
const _SELECT_FIELDS = {
  products:  'id,name,category,price,stock,image,barcode,badge,description,created_at,updated_at',
  orders:    'id,status,total,items,customer_name,customer_email,customer_phone,address,notes,created_at,updated_at',
  customers: 'id,name,email,phone,address,points,total_spent,created_at,updated_at',
  staff:     'id,name,email,role,phone,permissions,created_at,updated_at',
  drivers:   'id,name,phone,status,email,created_at,updated_at',
  categories:'id,name,slug,icon,sort_order,created_at,updated_at',
  settings:  '*',
};

// ─── GET todos los registros con paginación automática ───────────────────────
// PostgREST usa Range header: "0-199" para la primera página, etc.
async function _apiGetAll(table, opts = {}) {
  const PAGE    = 200;  // Bajado de 500 → menos carga por query en Supabase
  const TIMEOUT = 12000; // 12s máximo por página
  const fields  = _SELECT_FIELDS[table] || '*';
  const extra   = opts.filter ? `&${opts.filter}` : '';
  const order   = opts.sort   ? `&order=${opts.sort}.asc` : '&order=created_at.asc';

  let all  = [];
  let from = 0;
  let keepGoing = true;

  while (keepGoing) {
    const to   = from + PAGE - 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

    let res;
    try {
      res = await fetch(`${_SB_URL}/${table}?select=${encodeURIComponent(fields)}${extra}${order}`, {
        headers: { ..._SB_HEADERS, 'Range': `${from}-${to}` },
        signal: ctrl.signal,
      });
    } catch(e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error(`Timeout cargando ${table} (>${TIMEOUT}ms)`);
      throw e;
    }
    clearTimeout(timer);

    // 416 = Range Not Satisfiable → ya no hay más registros
    if (res.status === 416) break;

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API error ${res.status}: ${t}`);
    }

    const text  = await res.text();
    const batch = text ? JSON.parse(text) : [];

    if (!Array.isArray(batch) || batch.length === 0) break;

    all = all.concat(batch);

    if (batch.length < PAGE) {
      keepGoing = false;
    } else {
      from += PAGE;
    }
  }

  return { data: all, total: all.length };
}

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

async function _apiGet(table, id) {
  const res = await fetch(`${_SB_URL}/${table}?id=eq.${id}&select=*`, {
    headers: _SB_HEADERS,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const arr = await res.json();
  return arr[0] ?? null;
}

async function _apiCreate(table, data) {
  // Quitar campos de sistema que Supabase genera automáticamente
  // También quitar 'id' para que Supabase genere el UUID propio
  const { gs_project_id, gs_table_name, id, ...payload } = data;
  // Asegurar timestamps
  if (!payload.created_at) payload.created_at = Date.now();
  if (!payload.updated_at) payload.updated_at = Date.now();

  return _apiFetch(`${_SB_URL}/${table}`, {
    method:  'POST',
    headers: { ..._SB_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

async function _apiUpdate(table, id, data) {
  const { gs_project_id, gs_table_name, ...payload } = data;
  payload.updated_at = Date.now();

  return _apiFetch(`${_SB_URL}/${table}?id=eq.${id}`, {
    method:  'PUT',
    headers: { ..._SB_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

async function _apiPatch(table, id, data) {
  const { gs_project_id, gs_table_name, id: _id, ...payload } = data;
  payload.updated_at = Date.now();

  return _apiFetch(`${_SB_URL}/${table}?id=eq.${id}`, {
    method:  'PATCH',
    headers: { ..._SB_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

async function _apiDelete(table, id) {
  return _apiFetch(`${_SB_URL}/${table}?id=eq.${id}`, {
    method:  'DELETE',
    headers: _SB_HEADERS,
  });
}

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────
let _totalProductsInDB = 0;

const DB = {

  // ── Productos ──────────────────────────────────────────────────────────────
  async getProducts() {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/products?limit=2000');
      const json = await res.json();
      const list = json.data || [];
      _totalProductsInDB = list.length;
      return list;
    }
    // Pedir solo campos necesarios directamente sin helper (más rápido)
    const fields = _SELECT_FIELDS.products;
    const ctrl   = new AbortController();
    const timer  = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(
        `${_SB_URL}/products?select=${encodeURIComponent(fields)}&order=created_at.asc&limit=2000`,
        { headers: _SB_HEADERS, signal: ctrl.signal }
      );
    } catch(e) {
      clearTimeout(timer);
      throw e;
    }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const list = await res.json();
    _totalProductsInDB = list.length;
    return Array.isArray(list) ? list : [];
  },

  async saveProduct(product, changedFields = null) {
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
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/orders?limit=2000');
      const json = await res.json();
      return json.data || [];
    }
    // Fetch directo con campos específicos y límite para evitar statement timeout
    const fields = _SELECT_FIELDS.orders;
    const ctrl   = new AbortController();
    const timer  = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(
        `${_SB_URL}/orders?select=${encodeURIComponent(fields)}&order=created_at.desc&limit=1000`,
        { headers: _SB_HEADERS, signal: ctrl.signal }
      );
    } catch(e) { clearTimeout(timer); throw e; }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
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
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/customers?limit=2000');
      const json = await res.json();
      return json.data || [];
    }
    const fields = _SELECT_FIELDS.customers;
    const ctrl   = new AbortController();
    const timer  = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(
        `${_SB_URL}/customers?select=${encodeURIComponent(fields)}&order=created_at.desc&limit=2000`,
        { headers: _SB_HEADERS, signal: ctrl.signal }
      );
    } catch(e) { clearTimeout(timer); throw e; }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  },

  async getCustomerByEmail(email) {
    const encoded = encodeURIComponent(email.toLowerCase());
    const res = await fetch(
      `${_SB_URL}/customers?email=ilike.${encoded}&select=*`,
      { headers: _SB_HEADERS }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    return arr.find(c => c.email.toLowerCase() === email.toLowerCase()) || null;
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
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/staff?limit=500');
      const json = await res.json();
      return json.data || [];
    }
    const fields = _SELECT_FIELDS.staff;
    const ctrl   = new AbortController();
    const timer  = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch(
        `${_SB_URL}/staff?select=${encodeURIComponent(fields)}&order=created_at.asc&limit=500`,
        { headers: _SB_HEADERS, signal: ctrl.signal }
      );
    } catch(e) { clearTimeout(timer); throw e; }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  },

  async getStaffByEmail(email) {
    const encoded = encodeURIComponent(email.toLowerCase());
    const res = await fetch(
      `${_SB_URL}/staff?email=ilike.${encoded}&select=*`,
      { headers: _SB_HEADERS }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    return arr.find(s => s.email.toLowerCase() === email.toLowerCase()) || null;
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
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/drivers?limit=500');
      const json = await res.json();
      return json.data || [];
    }
    const fields = _SELECT_FIELDS.drivers;
    const ctrl   = new AbortController();
    const timer  = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch(
        `${_SB_URL}/drivers?select=${encodeURIComponent(fields)}&order=created_at.asc&limit=500`,
        { headers: _SB_HEADERS, signal: ctrl.signal }
      );
    } catch(e) { clearTimeout(timer); throw e; }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
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
      storeName:            'Supermercado Casa Mota',
      storeEmail:           'info@casamota.com.do',
      storePhone:           '809-555-2684',
      storeAddress:         'Av. Principal #123, Santo Domingo',
      storeCity:            'Santo Domingo',
      currency:             'RD$',
      shippingFee:          150,
      freeShippingMin:      1500,
      serviceZones:         'Santo Domingo, Santiago, La Romana',
      hoursWeekday:         '7:00 AM – 8:00 PM',
      hoursSunday:          '8:00 AM – 8:00 PM',
      taxPercent:           0,
      loyaltyPesosPerPoint: 10,
      loyaltyPointsEarned:  1,
      loyaltyPointValue:    1,
      loyaltyExpiryMonths:  6,
    };
    try {
      let list = [];
      if (_IS_GENSPARK) {
        const res = await fetch('tables/settings?limit=10');
        const json = await res.json();
        list = json.data || [];
      } else {
        // Fetch directo — settings es una tabla muy pequeña (1-2 filas)
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        let res;
        try {
          res = await fetch(
            `${_SB_URL}/settings?select=*&order=created_at.desc&limit=5`,
            { headers: _SB_HEADERS, signal: ctrl.signal }
          );
        } catch(e) { clearTimeout(timer); throw e; }
        clearTimeout(timer);
        list = res.ok ? (await res.json()) : [];
      }
      if (list.length > 0) {
        const saved = list.find(r => !r.deleted) || list[0];
        return { ..._defaults, ...saved };
      }
      return _defaults;
    } catch {
      return _defaults;
    }
  },

  async saveSettings(data) {
    try {
      // Fetch directo en lugar de _apiGetAll para evitar timeout
      const res  = await fetch(
        `${_SB_URL}/settings?select=id,deleted&order=created_at.desc&limit=5`,
        { headers: _SB_HEADERS }
      );
      const list = res.ok ? (await res.json()).filter(r => !r.deleted) : [];
      if (list.length > 0) {
        const existing = list[0];
        return await _apiPatch('settings', existing.id, { ...existing, ...data });
      }
      return await _apiCreate('settings', { ...data });
    } catch(e) {
      console.warn('[DB.saveSettings] Error:', e);
      return await _apiCreate('settings', { ...data });
    }
  },

  // ── Categorías ─────────────────────────────────────────────────────────────
  async getCategories() {
    try {
      let rawData = [];
      if (_IS_GENSPARK) {
        const res  = await fetch('tables/categories?limit=500');
        const json = await res.json();
        rawData = json.data || [];
      } else {
        // Fetch directo con campos específicos y sin paginación pesada
        const fields = _SELECT_FIELDS.categories;
        const ctrl   = new AbortController();
        const timer  = setTimeout(() => ctrl.abort(), 10000);
        let res;
        try {
          res = await fetch(
            `${_SB_URL}/categories?select=${encodeURIComponent(fields)}&order=sort_order.asc&limit=500`,
            { headers: _SB_HEADERS, signal: ctrl.signal }
          );
        } catch(e) { clearTimeout(timer); throw e; }
        clearTimeout(timer);
        rawData = res.ok ? (await res.json()) : [];
      }
      const raw = rawData.filter(r => !r.deleted);
      // Deduplicar por slug
      const seen = new Map();
      for (const cat of raw) {
        const key = cat.slug || cat.id;
        if (key && !seen.has(key)) seen.set(key, cat);
      }
      return [...seen.values()].sort(
        (a, b) => (Number(a.sort_order) || 99) - (Number(b.sort_order) || 99)
      );
    } catch { return []; }
  },

  async saveCategory(cat) {
    try {
      if (cat._apiUuid) {
        const { _apiUuid, ...catData } = cat;
        return await _apiUpdate('categories', _apiUuid, catData);
      }
      // Buscar si ya existe por slug
      const res  = await fetch(
        `${_SB_URL}/categories?slug=eq.${encodeURIComponent(cat.slug)}&select=*`,
        { headers: _SB_HEADERS }
      );
      const list = res.ok ? (await res.json()).filter(r => !r.deleted) : [];
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

};

// ─── Cache en memoria ─────────────────────────────────────────────────────────
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

// ─── Helper de error legible ──────────────────────────────────────────────────
function _friendlyApiError(err) {
  if (!err) return 'Error desconocido';
  const msg = err.message || '';
  if (msg.includes('520') || msg.includes('521') || msg.includes('522') || msg.includes('524'))
    return '⚠️ El servidor no respondió. Intenta de nuevo en unos segundos.';
  if (msg.includes('502') || msg.includes('503') || msg.includes('504'))
    return '⚠️ El servidor está ocupado. Intenta de nuevo en unos segundos.';
  if (msg.includes('500'))
    return '⚠️ Error interno del servidor (500). Verifica los datos e intenta de nuevo.';
  if (msg.includes('tardó demasiado') || msg.includes('AbortError'))
    return '⚠️ La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.';
  if (msg.includes('Failed to fetch'))
    return '⚠️ Sin conexión a internet. Verifica tu red e intenta de nuevo.';
  return msg.replace(/<[^>]+>/g, '').substring(0, 80) || 'Error desconocido';
}
