/**
 * SUPERMERCADO CASA MOTA - API.JS v3.1
 * Conexion directa a Supabase REST API
 * Reemplaza la API interna de Genspark (tables/) por llamadas directas a Supabase
 * Tablas: products, customers, orders, staff, drivers, settings, categories
 */

// === Configuracion de Supabase ===
function _getSupabaseConfig() {
  var url = localStorage.getItem('supabase_url');
  var key = localStorage.getItem('supabase_anon_key');
  if (!url || !key) {
    console.error('[API] Supabase no configurado.');
  }
  return { url: url, key: key };
}

// === Helpers base ===
function _apiFetchTimeout(method) {
  var m = (method || 'GET').toUpperCase();
  return (['POST', 'PUT', 'PATCH'].indexOf(m) >= 0) ? 45000 : 30000;
}

async function _supaFetch(path, options, _retry) {
  if (options === undefined) options = {};
  if (_retry === undefined) _retry = 1;

  var cfg = _getSupabaseConfig();
  var SUPA_URL = cfg.url;
  var SUPA_KEY = cfg.key;
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase no configurado');

  var method = (options.method || 'GET').toUpperCase();
  var isMutating = (['POST', 'PUT', 'PATCH'].indexOf(method) >= 0);
  var retryCount = isMutating ? 0 : _retry;

  var ctrl = new AbortController();
  var timeout = _apiFetchTimeout(method);
  var _timedOut = false;
  var timer = setTimeout(function() { _timedOut = true; ctrl.abort(); }, timeout);

  var headers = {
    'Content-Type': 'application/json',
    'apikey': SUPA_KEY,
    'Authorization': 'Bearer ' + SUPA_KEY
  };

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  if (['POST', 'PUT', 'PATCH'].indexOf(method) >= 0) {
    headers['Prefer'] = 'return=representation';
  }

  try {
    var fetchOptions = Object.assign({}, options, { headers: headers, signal: ctrl.signal });
    var res = await fetch(SUPA_URL + '/rest/v1/' + path, fetchOptions);
    clearTimeout(timer);

    if (res.status === 204) return null;

    var safeRetry = [502, 503, 504, 520, 521, 522, 524];
    if (!res.ok) {
      var text = await res.text();
      if (_retry > 0 && safeRetry.indexOf(res.status) >= 0) {
        await new Promise(function(r) { setTimeout(r, 1500); });
        return _supaFetch(path, options, _retry - 1);
      }
      throw new Error('Supabase error ' + res.status + ': ' + text);
    }

    var data = await res.json();
    return data;
  } catch (e) {
    clearTimeout(timer);
    var isOurTimeout = (e.name === 'AbortError' && _timedOut);
    var isNetworkErr = (e.name === 'TypeError');
    if (retryCount > 0 && (isOurTimeout || isNetworkErr)) {
      await new Promise(function(r) { setTimeout(r, 1000); });
      return _supaFetch(path, options, retryCount - 1);
    }
    throw e;
  }
}

// === GET todos los registros con paginacion automatica ===
// USA limit/offset como parametros de query (no Range header)
async function _supaGetAll(table, extraParams) {
  if (extraParams === undefined) extraParams = '';
  var LIMIT = 1000;
  var offset = 0;
  var all = [];

  while (true) {
    var qs = '?select=*&order=created_at.asc&limit=' + LIMIT + '&offset=' + offset;
    if (extraParams) qs += '&' + extraParams;

    var res = await _supaFetch(table + qs, {});

    var batch = Array.isArray(res) ? res : (res && res.data ? res.data : []);
    batch = batch.filter(function(r) { return !r.deleted; });
    all = all.concat(batch);

    if (batch.length < LIMIT) break;
    offset += LIMIT;
  }

  return { data: all, total: all.length };
}

// === GET un registro por ID ===
async function _supaGet(table, id) {
  var res = await _supaFetch(table + '?id=eq.' + id + '&select=*');
  return Array.isArray(res) ? res[0] : res;
}

// === POST - crear registro ===
async function _supaCreate(table, data) {
  var res = await _supaFetch(table, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  return Array.isArray(res) ? res[0] : res;
}

// === PATCH - actualizar campos ===
async function _supaPatch(table, id, data) {
  var res = await _supaFetch(table + '?id=eq.' + id, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
  return Array.isArray(res) ? res[0] : res;
}

// === PUT - reemplazar registro ===
async function _supaPut(table, id, data) {
  return _supaPatch(table, id, data);
}

// === DELETE - soft delete ===
async function _supaDelete(table, id) {
  await _supaFetch(table + '?id=eq.' + id, {
    method: 'PATCH',
    body: JSON.stringify({ deleted: true })
  });
  return null;
}

// === OBJETO DB - misma interfaz que antes ===
var _totalProductsInDB = 0;

var DB = {

  getProducts: async function() {
    var res = await _supaGetAll('products');
    if (res.total > 0) _totalProductsInDB = res.total;
    return res.data || [];
  },

  saveProduct: async function(product, changedFields) {
    if (product.id) {
      var payload = changedFields || product;
      return _supaPatch('products', product.id, payload);
    } else {
      return _supaCreate('products', product);
    }
  },

  deleteProduct: async function(id) {
    return _supaDelete('products', id);
  },

  getOrders: async function() {
    var res = await _supaGetAll('orders', 'order=created_at.desc');
    return res.data || [];
  },

  createOrder: async function(order) {
    return _supaCreate('orders', order);
  },

  updateOrder: async function(id, order) {
    return _supaPut('orders', id, order);
  },

  patchOrder: async function(id, fields) {
    return _supaPatch('orders', id, fields);
  },

  deleteOrder: async function(id) {
    return _supaDelete('orders', id);
  },

  getCustomers: async function() {
    var res = await _supaGetAll('customers');
    return res.data || [];
  },

  getCustomerByEmail: async function(email) {
    var res = await _supaFetch(
      'customers?email=eq.' + encodeURIComponent(email) + '&select=*'
    );
    var list = Array.isArray(res) ? res : [];
    list = list.filter(function(r) { return !r.deleted; });
    return list.find(function(c) {
      return c.email && c.email.toLowerCase() === email.toLowerCase();
    }) || null;
  },

  createCustomer: async function(customer) {
    return _supaCreate('customers', customer);
  },

  updateCustomer: async function(id, customer) {
    return _supaPut('customers', id, customer);
  },

  patchCustomer: async function(id, fields) {
    return _supaPatch('customers', id, fields);
  },

  deleteCustomer: async function(id) {
    return _supaDelete('customers', id);
  },

  getStaff: async function() {
    var res = await _supaGetAll('staff');
    return res.data || [];
  },

  getStaffByEmail: async function(email) {
    var res = await _supaFetch(
      'staff?email=eq.' + encodeURIComponent(email) + '&select=*'
    );
    var list = Array.isArray(res) ? res : [];
    list = list.filter(function(r) { return !r.deleted; });
    return list.find(function(s) {
      return s.email && s.email.toLowerCase() === email.toLowerCase();
    }) || null;
  },

  createStaff: async function(member) {
    return _supaCreate('staff', member);
  },

  updateStaff: async function(id, member) {
    return _supaPut('staff', id, member);
  },

  patchStaff: async function(id, fields) {
    return _supaPatch('staff', id, fields);
  },

  deleteStaff: async function(id) {
    return _supaDelete('staff', id);
  },

  getDrivers: async function() {
    var res = await _supaGetAll('drivers');
    return res.data || [];
  },

  createDriver: async function(driver) {
    return _supaCreate('drivers', driver);
  },

  updateDriver: async function(id, driver) {
    return _supaPut('drivers', id, driver);
  },

  deleteDriver: async function(id) {
    return _supaDelete('drivers', id);
  },

  getSettings: async function() {
    var defaults = {
      storeName: 'Supermercado Casa Mota',
      storeEmail: 'info@casamota.com.do',
      storePhone: '809-555-2684',
      storeAddress: 'Av. Principal #123, Santo Domingo',
      storeCity: 'Santo Domingo',
      currency: 'RD$',
      shippingFee: 150,
      freeShippingMin: 1500,
      serviceZones: 'Santo Domingo, Santiago, La Romana',
      hoursWeekday: '7:00 AM - 8:00 PM',
      hoursSunday: '8:00 AM - 8:00 PM',
      taxPercent: 0,
      loyaltyPesosPerPoint: 10,
      loyaltyPointsEarned: 1,
      loyaltyPointValue: 1,
      loyaltyExpiryMonths: 6
    };
    try {
      var res = await _supaGetAll('settings');
      var list = res.data || [];
      if (list.length > 0) {
        return Object.assign({}, defaults, list[0]);
      }
      return defaults;
    } catch(e) {
      return defaults;
    }
  },

  saveSettings: async function(data) {
    try {
      var res = await _supaGetAll('settings');
      var list = res.data || [];
      if (list.length > 0) {
        var existing = list[0];
        var merged = Object.assign({}, existing, data);
        return await _supaPatch('settings', existing.id, merged);
      }
      return await _supaCreate('settings', data);
    } catch(e) {
      console.warn('[DB.saveSettings] Error:', e);
      return await _supaCreate('settings', data);
    }
  },

  getCategories: async function() {
    try {
      var res = await _supaGetAll('categories');
      var raw = res.data || [];
      var seen = {};
      var list = [];
      for (var i = 0; i < raw.length; i++) {
        var cat = raw[i];
        var key = cat.slug || cat.id;
        if (key && !seen[key]) {
          seen[key] = true;
          list.push(cat);
        }
      }
      list.sort(function(a, b) {
        return (Number(a.sort_order) || 99) - (Number(b.sort_order) || 99);
      });
      return list;
    } catch(e) { return []; }
  },

  saveCategory: async function(cat) {
    try {
      if (cat._apiUuid) {
        var uuid = cat._apiUuid;
        var catData = Object.assign({}, cat);
        delete catData._apiUuid;
        return await _supaPatch('categories', uuid, catData);
      }
      var res = await _supaFetch(
        'categories?slug=eq.' + encodeURIComponent(cat.slug) + '&select=*'
      );
      var list = Array.isArray(res) ? res : [];
      list = list.filter(function(r) { return !r.deleted; });
      if (list.length > 0) {
        return await _supaPatch('categories', list[0].id, cat);
      }
      return await _supaCreate('categories', cat);
    } catch(e) {
      console.warn('[DB.saveCategory]', e);
      return await _supaCreate('categories', cat);
    }
  },

  deleteCategory: async function(apiUuid) {
    return _supaDelete('categories', apiUuid);
  }
};

// === Cache en memoria ===
var _cache = {
  products: null,
  customers: null,
  orders: null,
  staff: null,
  drivers: null,
  settings: null
};

var DBCached = {
  getProducts: async function(force) {
    if (!force && _cache.products) return _cache.products;
    _cache.products = await DB.getProducts();
    return _cache.products;
  },
  invalidateProducts: function() { _cache.products = null; },

  getCustomers: async function(force) {
    if (!force && _cache.customers) return _cache.customers;
    _cache.customers = await DB.getCustomers();
    return _cache.customers;
  },
  invalidateCustomers: function() { _cache.customers = null; },

  getOrders: async function(force) {
    if (!force && _cache.orders) return _cache.orders;
    _cache.orders = await DB.getOrders();
    return _cache.orders;
  },
  invalidateOrders: function() { _cache.orders = null; },

  getStaff: async function(force) {
    if (!force && _cache.staff) return _cache.staff;
    _cache.staff = await DB.getStaff();
    return _cache.staff;
  },
  invalidateStaff: function() { _cache.staff = null; },

  getDrivers: async function(force) {
    if (!force && _cache.drivers) return _cache.drivers;
    _cache.drivers = await DB.getDrivers();
    return _cache.drivers;
  },
  invalidateDrivers: function() { _cache.drivers = null; },

  getSettings: async function(force) {
    if (!force && _cache.settings) return _cache.settings;
    _cache.settings = await DB.getSettings();
    return _cache.settings;
  },
  invalidateSettings: function() { _cache.settings = null; }
};
