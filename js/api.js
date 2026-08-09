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
const _SB_URL = 'https://lpnkdlfejsesxozowlda.supabase.co/rest/v1';
const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo';

const _SB_HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        _SB_KEY,
  'Authorization': `Bearer ${_SB_KEY}`,
};

// Header adicional para operaciones de escritura (INSERT/UPDATE/DELETE)
// Requerido por las políticas RLS de Supabase para tablas protegidas
const _SB_WRITE_HEADERS = {
  ..._SB_HEADERS,
  'x-admin-key': 'CM-Admin-X9k3mP19zJ',
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
  // Tienda fase 1 — sin image NI images (los dos campos pesados)
  // Carga rápida: título + descripción visibles al instante con placeholder de imagen
  //
  // ¡OJO! `images` (JSONB del carrusel) NO va aquí a propósito. Medido en la serie 15:
  // pesa 7 MB repartidos en solo 120 de 1917 productos, y se consume ÚNICAMENTE al
  // abrir el modal de producto (js/app.js, openModal). Tenerlo en la fase 1 obligaba
  // a TODOS los visitantes a esperar 7 MB por un carrusel que la mayoría nunca abre.
  // Ahora se pide bajo demanda con DB.getProductExtraImages(id).
  products:       'id,name,category,price,originalPrice,unit,stock,badge,rating,reviews,barcode,isNew,deleted,description',
  // Tienda fase 2 — solo image para actualizar imágenes
  products_imgs:  'id,image',
  orders:    '*',
  // BUILD 395 · `customers` y `staff` YA NO piden '*'.
  //
  // Pedir '*' incluye la columna `password`. Desde seguridad/31-contrasenas.sql
  // `anon` no tiene permiso de lectura sobre esa columna, así que un '*' hace
  // que PostgREST rechace la petición ENTERA con un 403: las secciones Clientes
  // y Personal se quedarían vacías, sin explicación visible.
  //
  // `has_password` es una columna calculada por la base (true/false). Sirve para
  // pintar el sello "Acceso / Sin contraseña" sin descargar la contraseña.
  customers: 'id,created_at,updated_at,name,email,phone,address,city,cedula,status,access,deleted,notes,avatar,mapLink,loyaltyTier,loyaltyPoints,loyaltyHistory,loyaltyLastActivity,orders,spent,lastOrder,lastLogin,authProvider,ranking,has_password',
  staff:     'id,created_at,updated_at,firstName,lastName,email,phone,cedula,role,cargo,status,avatar,notes,lastLogin,deleted,has_password',
  drivers:   '*',
  categories:'*',
  settings:  '*',
};

// ─── ERRORES SILENCIOSOS ─────────────────────────────────────────────────────
// Sustituto de `.catch(() => {})`. Esas escrituras son deliberadamente
// "fire-and-forget" (no deben bloquear al usuario), pero tragarse el error
// sin más nos costó caro: los contadores de cliente llevaban meses desfasados
// porque los PATCH fallaban sin dejar ni una línea en la consola.
//
//   Antes:  DB.patchCustomer(id, campos).catch(() => {});
//   Ahora:  DB.patchCustomer(id, campos).catch(logFail('contadores del cliente'));
//
// Sigue sin molestar al usuario, pero queda rastro para depurar.
function logFail(contexto) {
  return function (e) {
    console.warn(`⚠️ [Casa Mota] Falló ${contexto}:`, (e && e.message) ? e.message : e);
    return undefined;   // la promesa se resuelve: el flujo continúa igual que antes
  };
}
if (typeof window !== 'undefined') window.logFail = logFail;

// ─── TELÉFONOS — formato dominicano 809-696-1013 ─────────────────────────────
// Fuente ÚNICA de verdad. Vive en api.js porque es el único fichero que cargan
// las dos caras: la tienda (js/location.js, al guardar) y el panel
// (js/admin.v33.js, al mostrar). Así un número guardado en su día como
// "8096961013" se ve con guiones sin tener que tocar la base de datos.
function fmtPhoneDO(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let d = raw.replace(/\D/g, '');
  if (!d) return raw;                                     // texto sin dígitos → intacto
  if (d.length === 11 && d[0] === '1') d = d.slice(1);    // 1-809-… → 809-…
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 7)  return `${d.slice(0, 3)}-${d.slice(3)}`;
  return raw;   // longitud rara o número extranjero → no lo tocamos
}

/** Formato progresivo mientras se escribe: 8 → 809 → 809-69 → 809-696-1013.
 *  Solo dígitos, tope 10. Se usa en los <input type="tel"> de la tienda. */
function fmtPhoneDOPartial(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

if (typeof window !== 'undefined') {
  window.fmtPhoneDO        = fmtPhoneDO;
  window.fmtPhoneDOPartial = fmtPhoneDOPartial;
}

// ─── MAPEO DE CAMPOS orders (app ↔ Supabase) ─────────────────────────────────
// Supabase usa snake_case y nombres distintos; el app usa camelCase propio.
// _orderToSupa  : convierte objeto del app → columnas reales de Supabase
// _orderFromSupa: convierte fila de Supabase → objeto que usa el app

function _orderToSupa(o) {
  const r = { ...o };
  // Renombrar campos que tienen nombre distinto en Supabase
  if ('email'          in r) { r.customer_email = r.email;          delete r.email; }
  if ('phone'          in r) { r.customer_phone = r.phone;          delete r.phone; }
  if ('shipping'       in r) { r.envio          = r.shipping;       delete r.shipping; }
  // cancelledAt → bigint (ms). Si llega como ISO string lo convertimos.
  if ('cancelledAt' in r) {
    const v = r.cancelledAt;
    r.cancelledAt = (typeof v === 'string') ? new Date(v).getTime() : Number(v);
  }
  // Columnas que NO existen en Supabase → eliminar para no causar error 400
  if ('payMethodLabel' in r) { delete r.payMethodLabel; }
  if ('mapLink'        in r) { delete r.mapLink; }
  if ('source'         in r) { delete r.source; }

  // ─── BUILD 379 · clientId / driverId son UUID en la base de datos ──────────
  // Desde supabase_alter.sql bloque 12.2/12.3 estas dos columnas son UUID con clave
  // ajena. Postgres RECHAZA con error 400 cualquier valor que no sea un UUID
  // válido o NULL — antes eran TEXT y se tragaban cualquier cadena.
  //
  // Dos valores que el panel envía y que ahora romperían:
  //   · ''        → cadena vacía cuando no se eligió repartidor/cliente.
  //   · '_retiro' → valor centinela del selector «🏬 Retiro en tienda» del
  //                 modal de pedidos (js/admin.v33.js). NO es un id: es una
  //                 marca de "no hubo reparto". Guardarla en una columna con
  //                 clave ajena es imposible, porque no existe ese repartidor.
  //
  // Se sanean aquí, en la capa de datos, y no en cada pantalla: es el único
  // sitio por el que pasan TODOS los guardados de pedidos, así que ninguna
  // pantalla futura puede saltárselo por olvido.
  const _uuidOk = v => typeof v === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());

  for (const col of ['clientId', 'driverId']) {
    if (!(col in r)) continue;
    const v = r[col];
    if (v === null || v === undefined) { r[col] = null; continue; }
    if (_uuidOk(v)) { r[col] = String(v).trim(); continue; }
    // Cualquier otra cosa ('' , '_retiro', un número legacy…) → NULL.
    // El caso «retiro en tienda» se preserva aparte, justo debajo.
    r[col] = null;
  }

  // El «retiro en tienda» se guarda en deliveryType, que SÍ es texto libre.
  // Así no se pierde la información: sigue siendo consultable y ya no intenta
  // colarse por una columna con clave ajena.
  if (String(o.driverId || '') === '_retiro') {
    r.deliveryType = 'retiro';
  } else if (_uuidOk(o.driverId) && String(o.deliveryType || '') === 'retiro') {
    // BUILD 379b — LIMPIAR LA MARCA AL CAMBIAR DE OPINIÓN.
    // Sin esto quedaba una contradicción en la base de datos: un pedido con
    // repartidor real asignado y deliveryType='retiro' a la vez. Ocurría al
    // marcar «Retiro en tienda», guardar, y luego asignar un repartidor: la
    // marca vieja se quedaba pegada porque nadie la borraba.
    // En pantalla no se notaba (driverId manda), y por eso era peligroso:
    // el dato crudo mentía en exportaciones, informes y consultas SQL.
    r.deliveryType = 'delivery';
  }

  return r;
}

function _orderFromSupa(o) {
  const r = { ...o };
  // Normalizar de vuelta a los nombres que usa el app.
  // La tabla tiene AMBAS columnas: customer_email (original) y email (agregada luego).
  // customer_email es la que siempre se escribe via _orderToSupa, por eso tiene prioridad.
  r.email = r.customer_email ?? r.email ?? '';
  r.phone = r.customer_phone ?? r.phone ?? '';
  if ('envio' in r) { r.shipping = r.envio; }

  // ─── BUILD 379 · Reconstruir el centinela '_retiro' ───────────────────────
  // En la base de datos el retiro en tienda vive en deliveryType='retiro',
  // porque driverId es UUID con clave ajena y no admite valores inventados.
  // El panel (js/admin.v33.js) y Maya (js/chat.js) siguen razonando con
  // o.driverId === '_retiro', así que se les devuelve tal cual esperan.
  // Traducir aquí evita tocar los dos consumidores y que se desincronicen.
  if (r.driverId == null && String(r.deliveryType || '') === 'retiro') {
    r.driverId = '_retiro';
  }
  // NO se rellena order_number con el id.
  //
  // Antes había aquí `if (!r.order_number && r.id) r.order_number = r.id;`, que
  // copiaba el UUID dentro del número de pedido. Consecuencias:
  //   · la tienda mostraba "#3735c83a-d24a-400f-..." en vez de "#1" (bug 373);
  //   · y sobre todo, ENMASCARABA el caso de order_number vacío, haciéndolo
  //     indistinguible de uno legítimo. Ahora un número ausente se ve como
  //     ausente y se puede detectar.
  //
  // Cada punto de visualización ya resuelve el caso vacío por su cuenta
  // (`orderLabel()` en app.js, `order_number || id` en el panel).
  return r;
}


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

// Convierte cualquier timestamp a ISO 8601 que Supabase (timestamptz) acepta.
// Si ya es string ISO lo devuelve tal cual; si es número en ms lo convierte.
function _toIso(val) {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string' && val.includes('T')) return val; // ya es ISO
  const n = Number(val);
  if (!isNaN(n) && n > 1e10) return new Date(n).toISOString();  // ms → ISO
  return new Date().toISOString(); // fallback
}

async function _apiGet(table, id) {
  // BUILD 395 · '*' incluiría `password` en staff/customers → 403. Ver _devuelve().
  const _sel = _SELECT_FIELDS[table] || '*';
  const res = await fetch(`${_SB_URL}/${table}?id=eq.${id}&select=${encodeURIComponent(_sel)}`, {
    headers: _SB_HEADERS,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const arr = await res.json();
  return arr[0] ?? null;
}

// BUILD 395 · `Prefer: return=representation` hace que PostgREST devuelva la
// fila COMPLETA tras escribir — y "completa" incluye `password`. Desde
// seguridad/31-contrasenas.sql `anon` no puede leer esa columna, así que
// devolverla entera provoca un 403 y el guardado falla.
//
// `_devuelveSel(table)` produce el trozo de URL que limita las columnas devueltas.
//
// 🔴 BUILD 396 · CORRIGE UN ERROR DEL BUILD 395.
// La primera versión metía `select=` DENTRO de la cabecera `Prefer`:
//     'Prefer': 'return=representation&select=id,email,...'   ← INVÁLIDO
// En PostgREST `select` es un PARÁMETRO DE LA URL, no una preferencia. La
// cabecera malformada se ignoraba, PostgREST devolvía la fila completa (con
// `password`), y el guardado seguía fallando con 401 / 42501
// «permission denied for table staff» — exactamente el fallo que se pretendía
// arreglar. Se detectó al intentar crear un empleado nuevo en producción.
function _devuelveSel(table) {
  const campos = _SELECT_FIELDS[table];
  return (table === 'staff' || table === 'customers') && campos && campos !== '*'
    ? `select=${encodeURIComponent(campos)}`
    : '';
}

// Une un trozo de consulta a una URL que puede tener ya parámetros o no.
function _conSel(url, sel) {
  if (!sel) return url;
  return url + (url.includes('?') ? '&' : '?') + sel;
}

async function _apiCreate(table, data) {
  // Quitar campos de sistema que Supabase genera automáticamente
  // También quitar 'id' para que Supabase genere el UUID propio
  const { gs_project_id, gs_table_name, id, ...payload } = data;
  // Asegurar timestamps en formato ISO 8601 (Supabase timestamptz)
  payload.created_at = _toIso(payload.created_at);
  payload.updated_at = _toIso(payload.updated_at);

  return _apiFetch(_conSel(`${_SB_URL}/${table}`, _devuelveSel(table)), {
    method:  'POST',
    headers: { ..._SB_WRITE_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

async function _apiUpdate(table, id, data) {
  const { gs_project_id, gs_table_name, id: _id, ...payload } = data;
  // Sanitizar created_at por si viene como número en ms (legacy)
  if (payload.created_at) payload.created_at = _toIso(payload.created_at);
  payload.updated_at = new Date().toISOString();
  // PostgREST PUT requiere el id en el body para el upsert
  payload.id = id;

  return _apiFetch(_conSel(`${_SB_URL}/${table}?id=eq.${id}`, _devuelveSel(table)), {
    method:  'PUT',
    headers: { ..._SB_WRITE_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

async function _apiPatch(table, id, data) {
  const { gs_project_id, gs_table_name, id: _id, ...payload } = data;
  // Sanitizar created_at por si viene como número en ms (legacy)
  if (payload.created_at) payload.created_at = _toIso(payload.created_at);
  payload.updated_at = new Date().toISOString();

  return _apiFetch(_conSel(`${_SB_URL}/${table}?id=eq.${id}`, _devuelveSel(table)), {
    method:  'PATCH',
    headers: { ..._SB_WRITE_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

async function _apiDelete(table, id) {
  return _apiFetch(`${_SB_URL}/${table}?id=eq.${id}`, {
    method:  'DELETE',
    headers: _SB_WRITE_HEADERS,
  });
}

// ─── ESCRITURA EN `staff` VÍA FUNCIÓN DE BASE DE DATOS (build 397) ───────────
//
// Ver el comentario largo en DB.createStaff. Resumen: `anon` ya no puede
// escribir en `staff`; el permiso lo concede el `vale` que la base entrega al
// validar la contraseña en el login.

// Dónde vive el vale. Mismo sitio que la sesión del panel (`cm_session`), para
// que caduquen juntos: al cerrar la pestaña desaparecen los dos.
const _VALE_KEY = 'cm_admin_vale';

function _valeAdmin() {
  try { return sessionStorage.getItem(_VALE_KEY) || ''; }
  catch { return ''; }
}

function _guardarValeAdmin(vale) {
  try {
    if (vale) sessionStorage.setItem(_VALE_KEY, vale);
    else      sessionStorage.removeItem(_VALE_KEY);
  } catch { /* modo privado sin almacenamiento: se pedirá entrar de nuevo */ }
}

function _borrarValeAdmin() {
  try { sessionStorage.removeItem(_VALE_KEY); } catch { /* ignorado */ }
}

// Campos que la función `admin_guardar_empleado` sabe leer del JSON. Mandar
// otros (id, created_at, has_password…) no rompe nada porque los ignora, pero
// filtrar aquí evita enviar basura y deja claro qué se está guardando.
const _CAMPOS_STAFF = [
  'firstName', 'lastName', 'email', 'phone', 'cedula',
  'role', 'cargo', 'status', 'avatar', 'notes', 'password',
];

function _soloCamposStaff(datos) {
  const limpio = {};
  for (const campo of _CAMPOS_STAFF) {
    if (datos && datos[campo] !== undefined && datos[campo] !== null) {
      limpio[campo] = datos[campo];
    }
  }
  return limpio;
}

// Traduce los errores de la base a algo que se pueda leer en un aviso.
const _ERRORES_STAFF = {
  SESION_INVALIDA:      'Tu sesión no es válida. Vuelve a entrar al panel.',
  SESION_CADUCADA:      'Tu sesión caducó. Vuelve a entrar al panel.',
  CUENTA_DESACTIVADA:   'Tu cuenta ya no está activa.',
  SIN_PERMISO_PERSONAL: 'Solo un Super Admin puede gestionar el personal.',
  CORREO_DUPLICADO:     'Ya existe un empleado con ese correo.',
  CORREO_OBLIGATORIO:   'El correo es obligatorio.',
  ROL_DESCONOCIDO:      'Ese rol no existe.',
  EMPLEADO_NO_EXISTE:   'Ese empleado ya no existe.',
  NO_TE_PUEDES_BORRAR:  'No puedes eliminar tu propia cuenta.',
  ULTIMO_SUPERADMIN:    'No puedes dejar el sistema sin ningún Super Admin.',
  FALTA_ID:             'Falta indicar el empleado.',
};

async function _rpcStaff(funcion, params) {
  if (!params.p_vale) {
    throw new Error('Tu sesión caducó. Vuelve a entrar al panel.');
  }

  const res = await fetch(`${_SB_URL}/rpc/${funcion}`, {
    method:  'POST',
    headers: _SB_HEADERS,
    body:    JSON.stringify(params),
  });

  if (!res.ok) {
    const texto = await res.text();
    for (const clave in _ERRORES_STAFF) {
      if (texto.includes(clave)) throw new Error(_ERRORES_STAFF[clave]);
    }
    throw new Error(`No se pudo guardar (${res.status}).`);
  }

  const texto = await res.text();
  if (!texto || texto === 'null') return null;
  const datos = JSON.parse(texto);
  return Array.isArray(datos) ? (datos[0] ?? null) : datos;
}

// PATCH masivo por filtro en vez de por id. Sirve para desvincular de golpe
// todos los pedidos de un cliente con UNA sola petición.
//   _apiPatchWhere('orders', 'clientId=eq.abc', { clientId: null })
async function _apiPatchWhere(table, filter, data) {
  const payload = { ...data, updated_at: new Date().toISOString() };
  return _apiFetch(_conSel(`${_SB_URL}/${table}?${filter}`, _devuelveSel(table)), {
    method:  'PATCH',
    headers: { ..._SB_WRITE_HEADERS, 'Prefer': 'return=representation' },
    body:    JSON.stringify(payload),
  });
}

// ─── BORRADO SEGURO: DESVINCULAR ANTES DE BORRAR ──────────────────────────────
//
// EL BUG QUE ESTO ARREGLA (build 372)
// ───────────────────────────────────
// `_apiDelete` hace un DELETE REAL, no un `deleted = true`. Cuando se borraba
// una ficha de cliente, la fila desaparecía de `customers` pero sus pedidos
// seguían en `orders` con un `clientId` apuntando a un id que ya no existía.
//
// Consecuencia: pedidos HUÉRFANOS. No se los podía atribuir a nadie, no
// aparecían en las estadísticas de ningún cliente, y su importe se esfumaba
// de los totales. En la base de producción encontramos 4 así (RD$1.898).
//
// LO QUE NO SE HACE Y POR QUÉ
// ───────────────────────────
// · NO se borran los pedidos junto al cliente. Son registros contables:
//   una venta entregada ocurrió, aunque la ficha del comprador se elimine.
// · NO se usa borrado suave (`deleted = true`) en `customers`. Habría que
//   filtrar `deleted` en getCustomers(), en el login de la tienda y en cada
//   pantalla del panel; demasiada superficie para este arreglo. El cliente
//   debe desaparecer de verdad, como espera quien pulsa «Eliminar».
//
// LO QUE SÍ SE HACE
// ─────────────────
// Antes del DELETE, los pedidos se vuelven autosuficientes:
//   1. Se les copia la identidad del cliente (nombre / email / teléfono) en
//      sus propias columnas, si les faltaba alguna.
//   2. Se pone `clientId = null` → deja de ser una referencia rota y pasa a
//      ser un pedido explícitamente sin ficha asociada.
// Así el histórico de ventas sobrevive y no queda ni un puntero muerto.

async function _desvincularPedidosDeCliente(customerId) {
  // 1) ¿Qué pedidos cuelgan de esta ficha?
  const url = `${_SB_URL}/orders`
            + `?clientId=eq.${encodeURIComponent(customerId)}`
            + `&select=id,customer,client,customer_email,email,customer_phone,phone`;
  const res = await fetch(url, { headers: _SB_HEADERS });
  if (!res.ok) throw new Error(`No se pudieron leer los pedidos del cliente (${res.status})`);
  const pedidos = await res.json();
  if (!Array.isArray(pedidos) || pedidos.length === 0) return 0;

  // 2) Traer la identidad de la ficha para estamparla donde falte.
  let ficha = null;
  try {
    const r = await fetch(
      `${_SB_URL}/customers?id=eq.${encodeURIComponent(customerId)}&select=name,email,phone`,
      { headers: _SB_HEADERS }
    );
    if (r.ok) { const arr = await r.json(); ficha = Array.isArray(arr) ? arr[0] : null; }
  } catch (e) {
    console.warn('[deleteCustomer] no se pudo leer la ficha para estampar identidad:', e?.message || e);
  }

  if (ficha) {
    for (const p of pedidos) {
      const parche = {};
      if (!p.customer && !p.client && ficha.name)             parche.customer       = ficha.name;
      if (!p.customer_email && !p.email && ficha.email)       parche.customer_email = ficha.email;
      if (!p.customer_phone && !p.phone && ficha.phone)       parche.customer_phone = ficha.phone;
      if (Object.keys(parche).length === 0) continue;
      // Si esto falla no abortamos: lo importante es el paso 3.
      try { await _apiPatch('orders', p.id, parche); }
      catch (e) { console.warn(`[deleteCustomer] pedido ${p.id}: identidad no estampada —`, e?.message || e); }
    }
  }

  // 3) Cortar el vínculo de todos de una vez. Este paso SÍ debe funcionar:
  //    si falla, el error sube y el cliente NO se borra.
  await _apiPatchWhere('orders', `clientId=eq.${encodeURIComponent(customerId)}`, { clientId: null });
  return pedidos.length;
}

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────
let _totalProductsInDB = 0;

const DB = {

  // ── Productos ──────────────────────────────────────────────────────────────
  async getProducts(opts = {}) {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/products?limit=2000');
      const json = await res.json();
      const list = json.data || [];
      _totalProductsInDB = list.length;
      return list;
    }
    // Supabase PostgREST limita a 1000 filas por request — usar paginación
    // opts.full=true  → todas las columnas (admin)
    // opts.imgs=true  → solo id,image,description (fase 2 tienda)
    // por defecto      → campos ligeros tienda (fase 1)
    const fields = opts.full ? '*'
                 : opts.imgs ? _SELECT_FIELDS.products_imgs
                 : _SELECT_FIELDS.products;
    const PAGE    = 1000;
    let   all     = [];
    let   from    = 0;
    let   keepGoing = true;

    while (keepGoing) {
      const to   = from + PAGE - 1;
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000); // 25s en móvil/conexión lenta
      let res;
      try {
        res = await fetch(
          `${_SB_URL}/products?select=${encodeURIComponent(fields)}&order=created_at.desc`,
          {
            headers: { ..._SB_HEADERS, 'Range': `${from}-${to}` },
            signal: ctrl.signal,
          }
        );
      } catch(e) { clearTimeout(timer); throw e; }
      clearTimeout(timer);

      if (res.status === 416) break; // sin más registros

      if (!res.ok) throw new Error(`API error ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;

      all = all.concat(batch);
      if (batch.length < PAGE) {
        keepGoing = false; // última página
      } else {
        from += PAGE;
      }
    }

    _totalProductsInDB = all.length;
    return all;
  },

  async saveProduct(product, changedFields = null) {
    if (product.id) {
      const payload = changedFields || product;
      return _apiPatch('products', product.id, payload);
    } else {
      return _apiCreate('products', product);
    }
  },

  // Carga el carrusel (`images`) de UN producto, bajo demanda al abrir el modal.
  // Contrapartida de haber sacado `images` de _SELECT_FIELDS.products (fase 1).
  // Devuelve siempre un array: [] si no hay extras, si falla la red o si el id no existe.
  async getProductExtraImages(id) {
    if (!id) return [];
    try {
      const res = await fetch(
        `${_SB_URL}/products?select=images&id=eq.${encodeURIComponent(id)}`,
        { headers: _SB_HEADERS }
      );
      if (!res.ok) return [];
      const rows = await res.json();
      const raw  = (Array.isArray(rows) && rows[0]) ? rows[0].images : null;
      if (!raw) return [];
      if (Array.isArray(raw)) return raw.filter(Boolean);
      if (typeof raw === 'string') {
        try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; }
        catch (e) { return []; }
      }
      return [];
    } catch (e) {
      console.warn('⚠️ [Casa Mota] No se pudo cargar el carrusel del producto:', e && e.message);
      return [];
    }
  },

  // Carga imagen+description de uno o varios productos por ID (liviano y rápido)
  async getProductImages(ids = []) {
    if (!ids.length) return [];
    const inClause = `(${ids.map(id => `"${id}"`).join(',')})`;
    const res = await fetch(
      `${_SB_URL}/products?select=id,image,description&id=in.${inClause}`,
      { headers: _SB_HEADERS }
    );
    if (!res.ok) return [];
    return await res.json();
  },

  async deleteProduct(id) {
    return _apiDelete('products', id);
  },

  // ── Pedidos ────────────────────────────────────────────────────────────────
  async getOrders() {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/orders?limit=2000');
      const json = await res.json();
      return Array.isArray(json.data) ? json.data.map(_orderFromSupa) : [];
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
    return Array.isArray(list) ? list.map(_orderFromSupa) : [];
  },

  // El número de pedido lo asigna LA BASE DE DATOS, no el navegador.
  //
  // Antes se enviaba `order_number` calculado en JS como max()+1. Eso reutilizaba
  // números al borrar el pedido más alto, podía dar el mismo número a dos
  // clientes simultáneos, y ante un fallo de red generaba un número aleatorio de
  // 5 cifras (`Date.now() % 100000`).
  //
  // Ahora la columna tiene DEFAULT nextval(orders_order_number_seq) — ver
  // `supabase_alter.sql` bloque 12.1. Basta con NO enviar el campo para
  // que Postgres ponga el siguiente número de forma atómica.
  //
  // Devuelve la fila creada, que ya incluye el `order_number` real: quien llama
  // debe usar ESE valor para mostrárselo al cliente, no uno calculado antes.
  async createOrder(order) {
    const payload = _orderToSupa(order);

    // Nunca imponer el número: se deja que lo ponga la secuencia.
    delete payload.order_number;

    const creado = await _apiCreate('orders', payload);

    // Red de seguridad para el caso de que el SQL de la secuencia aún no se haya
    // ejecutado en esta base de datos: sin DEFAULT, la columna quedaría NULL.
    // Se rellena entonces con el método antiguo, avisando en consola. Es un
    // camino de emergencia, no el normal.
    if (creado && (creado.order_number === null || creado.order_number === undefined)) {
      console.warn(
        '[DB.createOrder] La base de datos no asignó order_number. '
      + '¿Falta ejecutar el bloque 12.1 de supabase_alter.sql? '
      + 'Asignando número de reserva.'
      );
      try {
        const todos = await DB.getOrders();
        const max = todos.reduce(
          (m, o) => Math.max(m, Number(o.order_number) || 0), 0
        );
        const parche = await _apiPatch('orders', creado.id, { order_number: max + 1 });
        return parche || { ...creado, order_number: max + 1 };
      } catch (e) {
        console.error('[DB.createOrder] tampoco se pudo asignar el número de reserva:', e);
      }
    }

    return creado;
  },

  async updateOrder(id, order) {
    return _apiUpdate('orders', id, _orderToSupa(order));
  },

  async patchOrder(id, fields) {
    return _apiPatch('orders', id, _orderToSupa(fields));
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
      // BUILD 395 · antes '*' → incluía `password` → 403 tras el SQL de seguridad.
      `${_SB_URL}/customers?email=ilike.${encoded}&select=${encodeURIComponent(_SELECT_FIELDS.customers)}`,
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

  /**
   * Borra la ficha de un cliente SIN dejar sus pedidos huérfanos.
   *
   * Los pedidos NO se borran (son historial contable): se les estampa la
   * identidad del cliente y se les pone `clientId = null`. Ver el comentario
   * de `_desvincularPedidosDeCliente` arriba para el porqué.
   *
   * Si la desvinculación falla, el cliente NO se borra — antes un botón que
   * da error que una base de datos con referencias rotas.
   *
   * @returns {Promise<{pedidosDesvinculados: number}>}
   */
  async deleteCustomer(id) {
    const pedidosDesvinculados = await _desvincularPedidosDeCliente(id);
    await _apiDelete('customers', id);
    if (pedidosDesvinculados > 0) {
      console.log(`[deleteCustomer] ${pedidosDesvinculados} pedido(s) desvinculado(s) y conservados.`);
    }
    return { pedidosDesvinculados };
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
      // BUILD 395 · antes '*' → incluía `password` → 403 tras el SQL de seguridad.
      `${_SB_URL}/staff?email=ilike.${encoded}&select=${encodeURIComponent(_SELECT_FIELDS.staff)}`,
      { headers: _SB_HEADERS }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    return arr.find(s => s.email.toLowerCase() === email.toLowerCase()) || null;
  },

  // ── ESCRITURA EN `staff` — BUILD 397 ───────────────────────────────────────
  //
  // Estas cuatro ya NO escriben en la tabla: llaman a funciones de la base.
  // Desde seguridad/36-cerrar-escritura-staff.sql, `anon` no tiene INSERT,
  // UPDATE ni DELETE sobre `staff`. Un INSERT directo desde aquí falla, y eso
  // es exactamente lo que se buscaba: antes cualquiera con la consola del
  // navegador abierta podía crearse un superadministrador.
  //
  // El permiso viaja en el `vale`: una cadena aleatoria que la base entrega al
  // validar la contraseña en el login, guardada en `admin_sesiones` (tabla que
  // `anon` no puede ni leer) y caducada a las 12 horas. La función comprueba
  // que el vale existe, que no ha caducado, que la cuenta sigue activa y que
  // el rol es `superadmin` — el único con `canManageStaff` en ROLES.
  //
  // ⚠️ Si el vale falta o caducó, la base responde con SESION_CADUCADA y hay
  // que volver a entrar. No hay respaldo local a propósito: un fallo aquí debe
  // notarse, no disimularse.
  async createStaff(member) {
    return _rpcStaff('admin_guardar_empleado', {
      p_vale:  _valeAdmin(),
      p_id:    null,
      p_datos: _soloCamposStaff(member),
    });
  },

  async updateStaff(id, member) {
    return _rpcStaff('admin_guardar_empleado', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: _soloCamposStaff(member),
    });
  },

  async patchStaff(id, fields) {
    return _rpcStaff('admin_guardar_empleado', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: _soloCamposStaff(fields),
    });
  },

  async deleteStaff(id) {
    return _rpcStaff('admin_borrar_empleado', {
      p_vale: _valeAdmin(),
      p_id:   id,
    });
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

  async patchDriver(id, fields) {
    return _apiPatch('drivers', id, fields);
  },

  /**
   * Borra un repartidor sin dejar pedidos apuntando a un `driverId` inexistente.
   * Mismo criterio que deleteCustomer: los pedidos se conservan, se les copia
   * el nombre del repartidor si la columna existe y se anula la referencia.
   */
  async deleteDriver(id) {
    let pedidosDesvinculados = 0;
    try {
      const r = await fetch(
        `${_SB_URL}/orders?driverId=eq.${encodeURIComponent(id)}&select=id`,
        { headers: _SB_HEADERS }
      );
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length > 0) {
          await _apiPatchWhere('orders', `driverId=eq.${encodeURIComponent(id)}`, { driverId: null });
          pedidosDesvinculados = arr.length;
        }
      }
    } catch (e) {
      // A diferencia del cliente, aquí no bloqueamos el borrado: `driverId`
      // suelto solo afecta a la etiqueta del repartidor, no a las ventas.
      console.warn('[deleteDriver] no se pudo desvincular pedidos:', e?.message || e);
    }
    await _apiDelete('drivers', id);
    return { pedidosDesvinculados };
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
    // Traer solo el id del registro activo — no mezclar existing en el payload.
    // PostgREST hace UPDATE parcial: solo se sobreescriben los campos enviados.
    // Mezclar existing causaba que campos nuevos (ej. storeWhatsapp) llegaran
    // contaminados con valores stale o fueran ignorados por el schema cache.
    const res  = await fetch(
      `${_SB_URL}/settings?select=id&deleted=is.false&order=created_at.desc&limit=1`,
      { headers: _SB_HEADERS }
    );
    const list = res.ok ? (await res.json()) : [];
    if (list.length > 0) {
      const id = list[0].id;
      // PATCH directo — solo los campos de data, updated_at calculado aquí
      const payload = { ...data, updated_at: new Date().toISOString() };
      delete payload.id;             // id va en la URL, no en el body
      delete payload.created_at;     // nunca sobreescribir created_at
      delete payload.deleted;        // nunca sobreescribir deleted por aquí
      const patchRes = await fetch(
        `${_SB_URL}/settings?id=eq.${id}`,
        {
          method:  'PATCH',
          headers: { ..._SB_WRITE_HEADERS, 'Prefer': 'return=representation' },
          body:    JSON.stringify(payload),
        }
      );
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        throw new Error(`API error ${patchRes.status}: ${JSON.stringify(err)}`);
      }
      return await patchRes.json();
    }
    // No existe registro — crear uno nuevo
    const createPayload = { ...data };
    delete createPayload.id;
    delete createPayload.created_at;
    delete createPayload.deleted;
    const createRes = await fetch(
      `${_SB_URL}/settings`,
      {
        method:  'POST',
        headers: { ..._SB_WRITE_HEADERS, 'Prefer': 'return=representation' },
        body:    JSON.stringify(createPayload),
      }
    );
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(`API error ${createRes.status}: ${JSON.stringify(err)}`);
    }
    return await createRes.json();
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

  // ── Exportación genérica (respaldos) ───────────────────────────────────────
  //
  // POR QUÉ EXISTE ESTA FUNCIÓN
  // ───────────────────────────
  // La antigua herramienta suelta `backup-tool.html` llamaba directamente a
  // `fetch('tables/<tabla>')`, que es la API interna de Genspark. En producción
  // esa ruta NO existe → cada tabla fallaba y el backup salía VACÍO, sin error
  // claro: una falsa sensación de seguridad. (Ese fichero se eliminó en el
  // build 378; la única herramienta de respaldo es admin.html → Respaldo.)
  //
  // Se resuelve aquí, en la capa de datos, y no en el HTML: así la sección de
  // respaldo hereda automáticamente la detección de entorno, las cabeceras,
  // los timeouts y los reintentos que ya usa todo lo demás. Y hay UNA SOLA
  // ruta de código para respaldar, en lugar de dos que pueden divergir.
  //
  // Devuelve TODAS las filas, incluidas las marcadas `deleted` — un respaldo
  // debe ser fiel a la base de datos, no una vista filtrada de la tienda.
  //
  // @param {string}   tabla       nombre real de la tabla
  // @param {object}   opts
  // @param {number}   opts.pageSize  filas por petición (por defecto 1000)
  // @param {function} opts.onProgress callback(filasAcumuladas, total|null)
  // @returns {Promise<Array>}
  async exportTable(tabla, opts = {}) {
    const pageSize   = Number(opts.pageSize) || 1000;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    if (_IS_GENSPARK) {
      // Entorno de desarrollo: API interna paginada de Genspark.
      const todo = [];
      let page = 1, total = null;
      while (true) {
        const res = await fetch(`tables/${tabla}?limit=${pageSize}&page=${page}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} al leer "${tabla}"`);
        const json = await res.json();
        if (total === null) total = json.total ?? null;
        const filas = json.data || [];
        todo.push(...filas);
        if (onProgress) onProgress(todo.length, total);
        if (filas.length < pageSize) break;
        if (total !== null && todo.length >= total) break;
        page++;
      }
      return todo;
    }

    // Producción: Supabase PostgREST. La paginación va por cabecera Range,
    // no por ?page= — usar ?page= devolvería SIEMPRE la primera página.
    const todo = [];
    let desde = 0;
    while (true) {
      const hasta = desde + pageSize - 1;
      // BUILD 395 · '*' incluiría `password` en staff/customers → 403 y el
      // respaldo de esas dos tablas fallaría entero. El respaldo NO debe
      // llevarse las contraseñas: son un dato que no sirve de nada fuera de
      // la base (van cifradas) y que no queremos en un fichero descargado.
      const _selExp = _SELECT_FIELDS[tabla] || '*';
      const res = await fetch(
        `${_SB_URL}/${tabla}?select=${encodeURIComponent(_selExp)}&order=id.asc`,
        {
          headers: {
            ..._SB_HEADERS,
            'Range-Unit': 'items',
            'Range': `${desde}-${hasta}`,
            // Pide a PostgREST el total exacto en Content-Range
            'Prefer': 'count=exact',
          },
        }
      );

      // 416 = rango fuera de los datos: significa que ya no hay más filas.
      if (res.status === 416) break;
      if (!res.ok) {
        const detalle = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} al leer "${tabla}"${detalle ? ': ' + detalle.slice(0, 200) : ''}`);
      }

      const filas = await res.json();
      if (!Array.isArray(filas)) throw new Error(`Respuesta inesperada en "${tabla}"`);
      todo.push(...filas);

      // Content-Range: "0-999/4213" → el total va tras la barra
      let total = null;
      const cr = res.headers.get('content-range');
      if (cr && cr.includes('/')) {
        const t = cr.split('/')[1];
        if (t && t !== '*') total = Number(t);
      }
      if (onProgress) onProgress(todo.length, total);

      if (filas.length < pageSize) break;
      if (total !== null && todo.length >= total) break;
      desde += pageSize;
    }
    return todo;
  },

  // Cuenta filas sin descargarlas. Para mostrar los totales antes de exportar.
  // Devuelve null si la tabla no existe o no se puede contar (así la interfaz
  // puede distinguir "0 registros" de "no disponible").
  async countTable(tabla) {
    try {
      if (_IS_GENSPARK) {
        const res = await fetch(`tables/${tabla}?limit=1&page=1`);
        if (!res.ok) return null;
        const json = await res.json();
        return json.total ?? 0;
      }
      const res = await fetch(
        `${_SB_URL}/${tabla}?select=id`,
        {
          headers: {
            ..._SB_HEADERS,
            'Range-Unit': 'items',
            'Range': '0-0',
            'Prefer': 'count=exact',
          },
        }
      );
      if (!res.ok) return null;
      const cr = res.headers.get('content-range');
      if (cr && cr.includes('/')) {
        const t = cr.split('/')[1];
        if (t && t !== '*') return Number(t);
      }
      return null;
    } catch { return null; }
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

// ═══════════════════════════════════════════════════════════════════════════════
//  OAUTH — Auto-creación / recuperación de cliente por proveedor social
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * createClientFromOAuth(profile)
 *
 * Dado un perfil normalizado de Google/Apple, busca al cliente por email en
 * Supabase. Si no existe, lo crea con status='habilitado' y authProvider marcado.
 * Devuelve el objeto cliente listo para guardar en sesión (sin password).
 *
 * @param {object} profile
 *   { email, name, given_name?, picture?, authProvider: 'google'|'apple', sub }
 * @returns {Promise<object>} cliente de Supabase
 */
async function createClientFromOAuth(profile) {
  const email = (profile.email || '').toLowerCase().trim();
  if (!email) throw new Error('OAuth: email no disponible en el perfil.');

  // 1) Buscar cliente existente por email
  let existing = null;
  try {
    existing = await DB.getCustomerByEmail(email);
  } catch(e) { /* continuar — red fallida */ }

  if (existing) {
    // Actualizar lastLogin siempre
    const safePatch = { lastLogin: _nowTs() };
    try { await DB.patchCustomer(existing.id, safePatch); } catch(e) { /* no crítico */ }

    // Patch authProvider + avatar — intentarlo aunque falle (schema cache puede estar desact.)
    const optPatch = {};
    if (profile.authProvider && !existing.authProvider) optPatch.authProvider = profile.authProvider;
    if (profile.picture      && !existing.avatar)       optPatch.avatar       = profile.picture;
    if (Object.keys(optPatch).length > 0) {
      try {
        await DB.patchCustomer(existing.id, optPatch);
        console.log('[OAuth] authProvider actualizado en Supabase ✅', optPatch);
      } catch(e) {
        console.warn('[OAuth] patch authProvider falló (schema cache?) — solo se actualiza en sesión local.', e?.message || e);
      }
    }

    // SIEMPRE incluir authProvider en la sesión local aunque el patch haya fallado,
    // así el admin muestra el badge correcto en esta sesión.
    const sessionOverride = {};
    if (profile.authProvider) sessionOverride.authProvider = profile.authProvider;
    if (profile.picture && !existing.avatar) sessionOverride.avatar = profile.picture;

    const { password: _pw, ...safe } = { ...existing, ...safePatch, ...sessionOverride };
    return safe;
  }

  // 2) No existe → crear cliente nuevo
  // Se intenta en 3 niveles descendentes de columnas para tolerar schema cache desactualizado.

  const _name = profile.name || profile.given_name || email.split('@')[0];

  // Nivel A — todos los campos conocidos (incluyendo authProvider/avatar)
  const clientFull = {
    name: _name, email, phone: '', address: '', city: '',
    cedula: '', notes: '', status: 'habilitado',
    ranking: 'bronce', orders: 0, spent: 0,
    lastOrder: '', lastLogin: _nowTs(), createdAt: _nowTs(),
    authProvider: profile.authProvider || 'google',
    avatar: profile.picture || '',
  };

  // Nivel B — sin authProvider/avatar (columnas nuevas que pueden faltar)
  const clientBase = {
    name: _name, email, phone: '', address: '', city: '',
    cedula: '', notes: '', status: 'habilitado',
    ranking: 'bronce', orders: 0, spent: 0,
    lastOrder: '', lastLogin: _nowTs(), createdAt: _nowTs(),
  };

  // Nivel C — solo lo absolutamente mínimo (name, email, status)
  // Útil cuando el schema cache de PostgREST no reconoce columnas que SÍ existen
  const clientMinimal = {
    name: _name, email, status: 'habilitado',
  };

  function _isSchemaErr(e) {
    const m = (e.message || '').toLowerCase();
    return m.includes('pgrst204') || m.includes('schema cache') ||
           m.includes('could not find') || m.includes('400');
  }

  let created = null;
  let createdWithAuthProvider = false;

  try {
    created = await DB.createCustomer(clientFull);
    createdWithAuthProvider = true;  // Nivel A incluye authProvider
  } catch(e1) {
    if (!_isSchemaErr(e1)) throw e1;
    console.warn('[OAuth] Nivel A falló — reintentando sin authProvider/avatar.');
    try {
      created = await DB.createCustomer(clientBase);
      // Nivel B: creado sin authProvider — intentar parchear inmediatamente
    } catch(e2) {
      if (!_isSchemaErr(e2)) throw e2;
      console.warn('[OAuth] Nivel B falló — reintentando con campos mínimos.');
      try {
        created = await DB.createCustomer(clientMinimal);
        // Nivel C: creado sin authProvider — intentar parchear inmediatamente
      } catch(e3) {
        throw new Error('OAuth: no se pudo crear el cliente. Verifica el schema de Supabase. Detalle: ' + (e3.message || e3));
      }
    }
  }

  if (!created) throw new Error('OAuth: Supabase no devolvió el cliente creado.');

  // Si el cliente fue creado sin authProvider (Nivel B o C),
  // intentar parchear authProvider + avatar de inmediato
  if (!createdWithAuthProvider && created.id) {
    const postPatch = {};
    if (profile.authProvider || 'google') postPatch.authProvider = profile.authProvider || 'google';
    if (profile.picture) postPatch.avatar = profile.picture;
    try {
      await DB.patchCustomer(created.id, postPatch);
      // Incorporar al objeto local aunque el patch haya ido bien
      Object.assign(created, postPatch);
      console.log('[OAuth] authProvider parcheado post-creación ✅');
    } catch(ep) {
      // El patch falló — al menos el objeto local en sesión tendrá authProvider correcto
      Object.assign(created, postPatch);
      console.warn('[OAuth] post-patch authProvider falló — solo en sesión local.', ep?.message || ep);
    }
  }

  const { password: _pw, ...safe } = created;
  return safe;
}

/** Timestamp legible: "31/07/2026 14:30" */
function _nowTs() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

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
