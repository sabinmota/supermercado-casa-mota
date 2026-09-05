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
  /* 🔴 BUILD 415 · `settings` YA NO pide '*', por el mismo motivo que
   * `customers` y `staff` arriba: el asterisco incluía `groqApiKey`, columna
   * que `anon` ya no puede leer, y PostgREST rechaza la petición ENTERA con
   * un 403 cuando una sola columna está prohibida. Un '*' aquí dejaría la
   * pantalla de Configuración en blanco sin decir por qué.
   * El panel, que necesita la fila completa, usa DB.getSettingsAdmin(). */
  settings:  'id,created_at,updated_at,deleted,"storeName","storeEmail","storePhone","storeWhatsapp","storeAddress","storeCity",currency,"shippingFee","freeShippingMin","serviceZones","hoursWeekday","hoursSunday","taxPercent","loyaltyPesosPerPoint","loyaltyPointsEarned","loyaltyPointValue","loyaltyExpiryMonths"',
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
/* 🔴 BUILD 422b1 · LO QUE UNA ESCRITURA DEVUELVE ES TAMBIÉN UNA LECTURA
 *
 * Hasta aquí, escribir en `customers` pedía de vuelta las VEINTISIETE columnas
 * de `_SELECT_FIELDS.customers` — `cedula`, `spent` y `loyaltyPoints`
 * incluidas. Eso convierte cada INSERT y cada PATCH en una lectura de esas
 * columnas, y PostgREST rechaza **la petición ENTERA con 403** cuando una sola
 * está prohibida (la lección del 396 para `password`, y del 415 para
 * `settings`).
 *
 * Consecuencia si el 422b revocase el SELECT sin tocar esto: se romperían
 * OCHO caminos de escritura, y el peor de todos es **el checkout de la
 * tienda** (`app.js:3088`), que además lo haría en silencio porque su `catch`
 * marca el fallo como «no crítico». Sería el fallo del 420 por tercera vez:
 * revocar mirando quién lee con un SELECT, cuando también lee quien escribe.
 *
 * 🔴 POR QUÉ NO SE DEVUELVE NADA EN ABSOLUTO (lo primero que se pensó, y era
 * un error): el registro por Google **SÍ usa la fila devuelta**. En la línea
 * 2247 lanza «Supabase no devolvió el cliente creado» si llega vacía, en la
 * 2251 usa `created.id`, y en la 2267 **esa fila SE CONVIERTE en la sesión del
 * cliente**. Como `_apiFetch` (línea 71) devuelve `null` con cuerpo vacío,
 * suprimir la respuesta habría roto el registro de todo cliente nuevo — y
 * seis de los nueve clientes actuales entran con Google. Otra vez «se rompe
 * para gente que TODAVÍA NO EXISTE», como el `status` del 419.
 *
 * Se devuelve, entonces, LO MÍNIMO QUE ALGUIEN USA DE VERDAD, medido llamador
 * por llamador: `id` (registro por Google y el panel al crear), `name` y
 * `email` (la sesión del cliente nuevo), `authProvider` y `avatar` (el sello
 * de Google en la ficha). Ninguna de las cinco está en la lista de cierre del
 * 422b2, así que la escritura ya no depende de un permiso que va a
 * desaparecer.
 *
 * `staff` NO SE TOCA a propósito: el 422b va de `customers`, `staff` tiene su
 * propio cierre pendiente, y mover algo que hoy funciona y que nadie pidió
 * mover es cómo se fabrican fallos nuevos. */
/* 🔴 BUILD 423c · `authProvider` Y `avatar` FUERA DE ESTA LISTA.
 *
 * CONTRADICCIÓN MÍA ENTRE DOS BUILDS, y salió en producción al editar un
 * cliente: el 422b1 decidió devolver `id,name,email,authProvider,avatar`
 * afirmando que «ninguna de las cinco está en la lista de cierre del 422b2»
 * — y **era falso**: el `49-cerrar-lectura-clientes.sql` que yo mismo escribí
 * revoca `authProvider` en su línea 23. `avatar` nunca se concedió.
 *
 * Resultado: cada PATCH y cada INSERT sobre `customers` pedía de vuelta dos
 * columnas prohibidas, y PostgREST rechaza **la petición ENTERA con 401 /
 * 42501** cuando una sola columna lo está. Guardar un cliente desde el panel
 * fallaba con «permission denied for table customers».
 *
 * 🔴 LA LECCIÓN, y es la misma que este proyecto ya tiene anotada dos veces:
 * afirmé una coincidencia entre dos listas **sin comprobarla**, y encima la
 * escribí en el README como si estuviera medida. La lista de cierre y la
 * lista de columnas devueltas **tienen que compararse una contra otra**, no
 * de memoria. El arnés del 423c lo hace: lee los dos ficheros y exige que la
 * intersección esté vacía, así que esta clase de contradicción ya no puede
 * volver sin ponerse roja.
 *
 * Quedan las TRES que sí están concedidas (`49-...sql:41-43`): `id`, `name`,
 * `email`. Es lo mínimo que alguien usa de verdad — `created.id` en el
 * registro por Google (`api.js:2292`) y el `saved.id` del panel. */
const _DEVUELVE_ESCRITURA = {
  customers: 'id,name,email',
};

function _devuelveSel(table) {
  const minimo = _DEVUELVE_ESCRITURA[table];
  if (minimo) return `select=${encodeURIComponent(minimo)}`;

  const campos = _SELECT_FIELDS[table];
  return table === 'staff' && campos && campos !== '*'
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

/* ─── BUILD 418 · `_sinClaveVacia(obj)` ──────────────────────────────────────
 * Devuelve una COPIA del objeto sin la propiedad `password` cuando esa
 * propiedad no lleva nada útil (no existe, es null, o es cadena vacía o solo
 * espacios).
 *
 * POR QUÉ EXISTE, QUE NO ES COSMÉTICA
 * ───────────────────────────────────
 * `js/admin.v33.js`, al CREAR un cliente, arma el objeto con:
 *     password: data.password || ''        (línea 5050)
 * O sea que la propiedad VIENE SIEMPRE, aunque el empleado no haya escrito
 * ninguna contraseña. Este build revoca a `anon` el permiso de INSERT y UPDATE
 * sobre la columna `password`, así que un INSERT que MENCIONE esa columna
 * —incluso para meterle una cadena vacía— lo rechaza PostgreSQL con un 403 y
 * el aviso en pantalla no explicaría el motivo. Se borra la propiedad en vez
 * de mandarla vacía.
 *
 * Vale también para el camino de Google (`createClientFromOAuth`), que no
 * manda `password` en absoluto: ahí no toca nada y devuelve la copia igual.
 *
 * 🔴 Si lo que llega NO es un objeto (null, undefined), se devuelve TAL CUAL,
 * a propósito. Antes de este build, `createCustomer(null)` reventaba en el
 * desestructurado de `_apiCreate`. Devolver `{}` aquí convertiría ese fallo
 * ruidoso en la creación silenciosa de una ficha vacía en la base — cambiar un
 * error visible por corrupción de datos callada es peor negocio. */
/* `_tieneClave(obj)` — ÚNICA definición de «este objeto trae contraseña».
 *
 * 🔴 Existe porque la primera versión de este build tenía DOS definiciones
 * distintas de lo mismo, y no coincidían. El enrutado preguntaba
 * `if (!customer.password)` mientras `_sinClaveVacia` comparaba con `.trim()`.
 * Para `password: '   '` (solo espacios) eso daba resultados OPUESTOS: el
 * enrutado la veía como contraseña real y mandaba la petición a la RPC, que
 * exige vale de panel; la tienda, que no tiene vale, se habría quedado con un
 * «Tu sesión caducó» imposible de entender. Lo detectó el arnés de pruebas,
 * no yo leyendo el código.
 *
 * Regla que queda: quien decida el camino y quien limpie el objeto tienen que
 * preguntar a ESTA función, nunca cada uno por su cuenta. */
function _tieneClave(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const clave = obj.password;
  if (clave === undefined || clave === null) return false;
  if (typeof clave === 'string') return clave.trim() !== '';
  return true;
}

function _sinClaveVacia(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (_tieneClave(obj)) return obj;
  const copia = { ...obj };
  delete copia.password;
  return copia;
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

// ─── BUILD 410 · ESCRITURA EN `orders` VÍA FUNCIÓN DE BASE DE DATOS ─────────
//
// EL AGUJERO QUE ESTO CIERRA (auditoría del 14/08/2026, SQL 39)
// ────────────────────────────────────────────────────────────
// Con SOLO la clave pública (la que va escrita en este mismo archivo, o sea la
// que cualquiera puede leer con «ver código fuente») estaba MEDIDO que se podía:
//   · Cambiar el importe de un pedido:  RD$275 → RD$0.01  ← CONFIRMADO
//   · Borrar un pedido para siempre                        ← CONFIRMADO
// No era una sospecha: se hizo contra la base real y hubo que reparar los datos.
//
// POR QUÉ NO BASTABA CON QUITAR EL PERMISO
// ────────────────────────────────────────
// La tienda y el panel usan LA MISMA clave `anon`. La base de datos no puede
// distinguir «empleado» de «visitante» mirando solo los permisos de la tabla.
// Si se revoca UPDATE sobre `orders`, se rompe el panel; si no se revoca, el
// agujero sigue abierto. La salida es que el permiso deje de venir de la clave
// y pase a venir de la SESIÓN: el `vale` que la base entrega al validar la
// contraseña en el login (mismo mecanismo del build 397 para `staff`).
//
// EL OTRO MOTIVO, MÁS SUTIL, POR EL QUE HABÍA QUE CAMBIAR ESTE CÓDIGO
// ───────────────────────────────────────────────────────────────────
// El panel guardaba pedidos con `_apiUpdate` → un PUT con LAS 71 COLUMNAS.
// Mandar 71 columnas para cambiar el estado significa que el navegador dicta
// también `total`, `subtotal` y `order_number`. Ahora el importe lo RECALCULA
// LA BASE a partir de las líneas (ver `admin_guardar_pedido` en el SQL 39):
// el navegador ya no puede decidir cuánto cuesta un pedido, ni por error ni
// a propósito.

// Campos que `admin_guardar_pedido` sabe leer. Los demás se ignoran: mandar
// `total` desde aquí ya no serviría de nada, porque la base lo recalcula.
const _CAMPOS_ORDER = [
  'status', 'notes', 'driverId', 'clientId', 'deliveryType',
  'productLines', 'cancelledAt', 'cancelledBy', 'cancelReason',
  'notaRepartidor', 'autorizaSustitucion',
];

function _soloCamposOrder(datos) {
  const limpio = {};
  for (const campo of _CAMPOS_ORDER) {
    if (datos && datos[campo] !== undefined) limpio[campo] = datos[campo];
  }
  return limpio;
}

const _ERRORES_ORDER = {
  SESION_INVALIDA:    'Tu sesión no es válida. Vuelve a entrar al panel.',
  SESION_CADUCADA:    'Tu sesión caducó. Vuelve a entrar al panel.',
  CUENTA_DESACTIVADA: 'Tu cuenta ya no está activa.',
  PEDIDO_NO_EXISTE:   'Ese pedido ya no existe.',
  PEDIDO_AJENO:       'Ese pedido no es tuyo.',
  SOLO_CANCELADOS:    'Solo puedes eliminar pedidos cancelados.',
  // BUILD 413 · ocultar del historial: solo pedidos ya finalizados.
  SOLO_FINALIZADOS:   'Solo puedes ocultar pedidos entregados o cancelados.',
  CAMPO_NO_PERMITIDO: 'Ese campo no se puede desvincular.',
  FALTA_ID:           'Falta indicar el pedido.',
};

/* ─── BUILD 418 · Mensajes de las RPC de CLIENTES ────────────────────────────
 * Mismo patrón que `_ERRORES_STAFF`: la base lanza un código corto y aquí se
 * traduce a algo que un empleado pueda entender y arreglar.
 *
 * `_rpcCliente` NO es una función nueva: reutiliza `_rpcStaff`, que desde el
 * build 416 ya registra el cuerpo completo de la respuesta de PostgREST en
 * consola. Duplicar esa lógica sería duplicar también el defecto que costó
 * cinco rondas de diagnóstico si algún día hay que volver a tocarla. */
const _ERRORES_CLIENTE = {
  SESION_INVALIDA:    'Tu sesión no es válida. Vuelve a entrar al panel.',
  SESION_CADUCADA:    'Tu sesión caducó. Vuelve a entrar al panel.',
  CUENTA_DESACTIVADA: 'Tu cuenta ya no está activa.',
  DATOS_INVALIDOS:    'Los datos del cliente no llegaron correctamente.',
  CLAVE_CORTA:        'La contraseña debe tener al menos 6 caracteres.',
  FALTA_EMAIL:        'Falta el correo del cliente.',
  FALTA_CLAVE:        'Hay que asignar una contraseña para crear el acceso del cliente.',
  EMAIL_DUPLICADO:    'Ya existe un cliente con ese correo.',
  CLIENTE_NO_EXISTE:  'Ese cliente ya no existe.',
  FALTA_ID:           'Falta indicar el cliente.',
};

/* BUILD 419 · Mensajes de `admin_ajustar_puntos`. Hereda los de sesión porque
 * la RPC llama a `admin_sesion_basica` igual que las de clientes. */
const _ERRORES_PUNTOS = {
  SESION_INVALIDA:    'Tu sesión no es válida. Vuelve a entrar al panel.',
  SESION_CADUCADA:    'Tu sesión caducó. Vuelve a entrar al panel.',
  CUENTA_DESACTIVADA: 'Tu cuenta ya no está activa.',
  FALTA_ID:           'Falta indicar el cliente.',
  PUNTOS_CERO:        'La cantidad de puntos no puede ser 0.',
  FALTA_MOTIVO:       'Hay que indicar el motivo del movimiento de puntos.',
  CLIENTE_NO_EXISTE:  'Ese cliente ya no existe.',
};

/* BUILD 418 · Se añade el tercer parámetro `dicc` con valor por omisión
 * `_ERRORES_STAFF`. Así las RPC de clientes reutilizan ESTE manejador —el que
 * ya registra el cuerpo completo de PostgREST desde el 416— con sus propios
 * mensajes, en vez de copiar la función y arrastrar el defecto de partida.
 * Los ocho llamadores anteriores no cambian: al no pasar el tercer argumento,
 * siguen usando el diccionario de personal. */
/* 🔴 BUILD 422a2 · EL CUARTO PARÁMETRO NO ES UN ADORNO: `devolverArreglo`
 *
 * La línea del final de esta función hace `datos[0] ?? null` cuando la
 * respuesta es un arreglo. Eso es CORRECTO para las nueve llamadas que
 * existían antes, porque todas devuelven UNA cosa: un cliente guardado, un
 * saldo, un contador de pedidos desvinculados. PostgREST envuelve ese único
 * resultado en un arreglo de un elemento y aquí se desenvuelve.
 *
 * Pero `admin_listar_clientes` devuelve NUEVE FILAS. Desenvolverlas se queda
 * con la primera y tira las otras ocho — y como el resultado deja de ser un
 * arreglo, `getCustomers()` lo descartaba entero y devolvía `[]`.
 * **Pantalla de Clientes en blanco, sin un solo error en consola.**
 *
 * 🔴 POR QUÉ NO SE CAMBIÓ LA LÍNEA 678 A SECAS: hay NUEVE llamadas más que
 * dependen de que desenvuelva. «Arreglarlo» ahí habría roto guardar clientes,
 * ajustar puntos, borrar clientes y guardar empleados —los cuatro en
 * silencio— para reparar una lectura. Se añade un interruptor y se pide
 * explícitamente donde hace falta.
 *
 * LECCIÓN, y es la MISMA del 419 vista por el otro lado: esta función
 * **ya desenvolvía**. En el 419 el fallo fue desenvolver DOS veces; aquí fue
 * escribir el llamador dando por hecho que no desenvolvía ninguna. El README
 * lo tenía anotado y no lo releí antes de escribir el llamador. */
async function _rpcStaff(funcion, params, dicc = _ERRORES_STAFF, devolverArreglo = false) {
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
    for (const clave in dicc) {
      if (texto.includes(clave)) throw new Error(dicc[clave]);
    }
    /* 🔴 BUILD 416 · Aquí se DESCARTABA `texto` y solo se mostraba el número de
     * estado. Eso convirtió el diagnóstico de un 404 en cinco rondas de
     * hipótesis: PostgREST SIEMPRE explica la causa en el cuerpo de la
     * respuesta (`message`, `details`, `hint`), y este `catch` la tiraba a la
     * basura antes de que nadie la viera.
     *
     * Un manejador de errores que oculta la causa del error no protege al
     * usuario: le impide arreglar el problema, y hace que quien depura vaya
     * adivinando. El mensaje se registra en consola SIEMPRE y se incluye en la
     * excepción para que llegue al aviso de pantalla. */
    console.error('[RPC ' + funcion + '] HTTP ' + res.status + ' — respuesta de la base:', texto);
    let detalle = '';
    try {
      const j = JSON.parse(texto);
      detalle = [j.message, j.details, j.hint].filter(Boolean).join(' · ');
    } catch (e) {
      detalle = (texto || '').slice(0, 300);
    }
    throw new Error(
      `No se pudo guardar (${res.status})` + (detalle ? `: ${detalle}` : '.')
    );
  }

  const texto = await res.text();
  if (!texto || texto === 'null') return devolverArreglo ? [] : null;
  const datos = JSON.parse(texto);
  if (devolverArreglo) return Array.isArray(datos) ? datos : (datos == null ? [] : [datos]);
  return Array.isArray(datos) ? (datos[0] ?? null) : datos;
}

/* ═══ BUILD 421 · VALE DEL CLIENTE ═══════════════════════════════════════════
 *
 * Hermano del vale de empleado (`_VALE_KEY` / `_valeAdmin`, arriba), pero para
 * la TIENDA. Vive en su propia clave para que un cliente y un empleado puedan
 * usar el mismo navegador sin pisarse.
 *
 * 🔴 POR QUÉ HACÍA FALTA, Y POR QUÉ AHORA
 * ───────────────────────────────────────
 * El comentario de `DB.patchCustomer` (más abajo) decía: «los clientes NO
 * TIENEN VALE — no existe `cliente_sesiones` en la base». Ahora existe
 * (`seguridad/47-vale-cliente.sql`), y eso es lo que permite cerrar las
 * columnas que la tienda escribe sin romper el checkout.
 *
 * Va en `sessionStorage`, igual que el del panel: al cerrar la pestaña
 * desaparece. Deliberado. `localStorage` sobreviviría en un navegador
 * compartido —el de un cíber, o el móvil que se presta— y dejaría la sesión
 * abierta al siguiente que lo use.
 *
 * 🔴 EL VALE NO ES UNA CONTRASEÑA Y NO LA SUSTITUYE. Solo dice «esta pestaña
 * ya demostró ser este cliente». Caduca a las 12 horas en la propia base, así
 * que robarlo sirve de poco y por poco tiempo. */
const _VALE_CLIENTE_KEY = 'cm_cliente_vale';

function _valeCliente() {
  try { return sessionStorage.getItem(_VALE_CLIENTE_KEY) || ''; }
  catch { return ''; }
}

function _guardarValeCliente(vale) {
  try {
    if (vale) sessionStorage.setItem(_VALE_CLIENTE_KEY, vale);
    else      sessionStorage.removeItem(_VALE_CLIENTE_KEY);
  } catch { /* modo privado sin almacenamiento: se pedirá entrar de nuevo */ }
}

function _borrarValeCliente() {
  try { sessionStorage.removeItem(_VALE_CLIENTE_KEY); } catch { /* ignorado */ }
}

const _ERRORES_CLIENTE_SESION = {
  SESION_INVALIDA:    'Tu sesión no es válida. Vuelve a entrar.',
  SESION_CADUCADA:    'Tu sesión caducó. Vuelve a entrar.',
  CUENTA_DESACTIVADA: 'Tu cuenta está desactivada. Contacta al supermercado.',
  CORREO_INVALIDO:    'Ese correo no es válido.',
};

/* Hermana de `_rpcStaff`, con el vale del CLIENTE.
 *
 * 🔴 Mismo detalle que costó cinco pruebas en el build 419: la respuesta se lee
 * con `res.text()` y se desenvuelve el arreglo de `RETURNS TABLE` UNA sola vez,
 * aquí. Quien llame a esta función NO debe volver a desenvolver: recibiría el
 * primer CAMPO de la fila en vez de la fila. */
async function _rpcClient(funcion, params, dicc = _ERRORES_CLIENTE_SESION) {
  if (!params.p_vale) {
    throw new Error('Tu sesión caducó. Vuelve a entrar a la tienda.');
  }

  const res = await fetch(`${_SB_URL}/rpc/${funcion}`, {
    method:  'POST',
    headers: _SB_HEADERS,
    body:    JSON.stringify(params),
  });

  if (!res.ok) {
    const texto = await res.text();
    for (const clave in dicc) {
      if (texto.includes(clave)) throw new Error(dicc[clave]);
    }
    console.error('[RPC ' + funcion + '] HTTP ' + res.status + ' — respuesta de la base:', texto);
    let detalle = '';
    try {
      const j = JSON.parse(texto);
      detalle = [j.message, j.details, j.hint].filter(Boolean).join(' · ');
    } catch (e) {
      detalle = (texto || '').slice(0, 300);
    }
    throw new Error(`No se pudo completar la operación (${res.status})` + (detalle ? `: ${detalle}` : '.'));
  }

  const texto = await res.text();
  if (!texto || texto === 'null') return null;
  const datos = JSON.parse(texto);
  return Array.isArray(datos) ? (datos[0] ?? null) : datos;
}

// BUILD 410 · Igual que `_rpcStaff` pero con los mensajes de pedidos, y sin
// exigir vale: `cliente_borrar_pedido` la llama un comprador, que no tiene.
async function _rpcOrder(funcion, params, exigeVale = true) {
  if (exigeVale && !params.p_vale) {
    throw new Error('Tu sesión caducó. Vuelve a entrar al panel.');
  }

  const res = await fetch(`${_SB_URL}/rpc/${funcion}`, {
    method:  'POST',
    headers: _SB_HEADERS,
    body:    JSON.stringify(params),
  });

  if (!res.ok) {
    const texto = await res.text();
    for (const clave in _ERRORES_ORDER) {
      if (texto.includes(clave)) throw new Error(_ERRORES_ORDER[clave]);
    }
    throw new Error(`No se pudo guardar el pedido (${res.status}).`);
  }

  const texto = await res.text();
  if (!texto || texto === 'null') return null;
  const datos = JSON.parse(texto);
  return Array.isArray(datos) ? (datos[0] ?? null) : datos;
}

// PATCH masivo por filtro en vez de por id. Sirve para desvincular de golpe
// todos los pedidos de un cliente con UNA sola petición.
//   _apiPatchWhere('orders', 'clientId=eq.abc', { clientId: null })
//
// BUILD 410 · SIN USAR AHORA MISMO, A PROPÓSITO.
// Sus dos llamadas (desvincular pedidos al borrar un cliente o un repartidor)
// pasaron a `admin_desvincular_pedidos`, porque `anon` ya no puede escribir
// `clientId` ni `driverId`. Se conserva porque el paso 2 (cerrar `drivers`)
// la va a necesitar para tablas que aún no han migrado. Si al terminar el
// paso 2 sigue sin usarse, bórrala: código muerto que parece vivo es peor
// que no tenerlo.
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
//
// 🔴 BUILD 418 · YA NO SE USA. Su único llamador era `DB.deleteCustomer`, que
// ahora hace todo el trabajo en la base con `admin_borrar_cliente` (una sola
// transacción, en vez de tres viajes desde el navegador que podían quedarse a
// medias). Se deja escrito aquí en vez de borrarla porque el paso 2 del cierre
// de seguridad (`drivers`) necesita la misma maniobra para `driverId`, y este
// código ya está probado en producción.
// REGLA: si al cerrar `drivers` sigue sin usarse, BÓRRALA. Código muerto que
// parece vivo es peor que no tenerlo — es la misma nota que dejó el build 410
// sobre `_apiPatchWhere`, y sigue sin cumplirse.

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
  // 🔴 BUILD 422a · Por RPC con vale, no por SELECT con la llave `anon`.
  // Esta lectura pide solo `name,email,phone` (no cédula ni puntos), pero el
  // permiso que usaba era el mismo que el 422b va a revocar: sin este cambio,
  // borrar un cliente dejaría de estampar la identidad en sus pedidos y esos
  // pedidos quedarían huérfanos y sin nombre. El `catch` de abajo lo habría
  // ocultado, así que el fallo no se habría notado hasta ir a buscar un
  // pedido antiguo.
  let ficha = null;
  try {
    const r = await _rpcStaff('admin_ficha_cliente', {
      p_vale: _valeAdmin(),
      p_id:   customerId,
    }, _ERRORES_CLIENTE);
    ficha = Array.isArray(r) ? (r[0] || null) : (r || null);
  } catch (e) {
    console.warn('[deleteCustomer] no se pudo leer la ficha para estampar identidad:', e?.message || e);
  }

  // BUILD 410 · Los pasos 2 y 3 los hace ahora LA BASE DE DATOS en una sola
  // llamada. Motivo: `anon` ya no puede escribir `clientId`, `customer`,
  // `customer_email` ni `customer_phone` (SQL 39), así que ni el estampado de
  // identidad ni el PATCH masivo funcionarían desde el navegador.
  // Ventaja añadida: al ser una sola operación en el servidor, ya no puede
  // quedarse a medias (identidad estampada pero vínculo sin cortar).
  const n = await _rpcOrder('admin_desvincular_pedidos', {
    p_vale:      _valeAdmin(),
    p_campo:     'clientId',
    p_id:        customerId,
    p_identidad: ficha
      ? { name: ficha.name || null, email: ficha.email || null, phone: ficha.phone || null }
      : null,
  });

  return Number(n) || pedidos.length;
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

  /**
   * BUILD 410 · Guardar un pedido desde el PANEL.
   *
   * Antes: PUT con las 71 columnas (`_apiUpdate`). Ahora: función de base de
   * datos que exige el `vale` de la sesión del empleado y que RECALCULA ella
   * misma `subtotal`, `total` e `items` a partir de las líneas. El navegador
   * ya no dicta importes. Ver el comentario largo junto a `_CAMPOS_ORDER`.
   *
   * Solo lo usa el panel. La tienda no llama aquí nunca.
   */
  async updateOrder(id, order) {
    const datos = _soloCamposOrder(_orderToSupa(order));
    const fila  = await _rpcOrder('admin_guardar_pedido', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: datos,
    });
    return fila ? _orderFromSupa(fila) : null;
  },

  // Sigue siendo un PATCH normal: las columnas que toca la TIENDA (status,
  // cancelledAt, cancelledBy, cuponUsado, cuponId, descuento) son las únicas
  // que el SQL 39 deja abiertas a `anon`. Un comprador no tiene vale, así que
  // esta ruta no puede pasar por la función de administración.
  async patchOrder(id, fields) {
    return _apiPatch('orders', id, _orderToSupa(fields));
  },

  /**
   * BUILD 410 · Borrar un pedido.
   *
   * `anon` ya no tiene DELETE sobre `orders`, así que hay dos caminos:
   *   · Con vale (panel)  → `admin_borrar_pedido`, borra cualquier pedido.
   *   · Sin vale (tienda) → `cliente_borrar_pedido`, que la BASE comprueba:
   *     solo borra si el pedido está CANCELADO y el correo coincide con el del
   *     pedido. Antes, cualquiera con la clave pública podía borrar el pedido
   *     de otra persona, en cualquier estado.
   *
   * Se mandan LOS DOS identificadores del comprador (correo y ficha) porque hay
   * pedidos antiguos con `customer_email` vacío que solo se reconocen por
   * `clientId`; la base acepta el borrado si coincide CUALQUIERA de los dos,
   * igual que el filtro de «Mis pedidos» en la tienda.
   *
   * @param {string} id
   * @param {string} [emailCliente]  correo del comprador (vía tienda).
   * @param {string} [clienteId]     id de su ficha (vía tienda).
   */
  async deleteOrder(id, emailCliente, clienteId) {
    const vale = _valeAdmin();
    if (vale) {
      return _rpcOrder('admin_borrar_pedido', { p_vale: vale, p_id: id });
    }
    if (!emailCliente && !clienteId) {
      throw new Error('No se puede eliminar el pedido sin identificar al cliente.');
    }
    return _rpcOrder(
      'cliente_borrar_pedido',
      { p_id: id, p_email: emailCliente || null, p_cliente_id: clienteId || null },
      false
    );
  },

  /**
   * BUILD 413 · Ocultar un pedido del historial DEL CLIENTE — sin borrarlo.
   *
   * Por qué existe y por qué NO es `deleteOrder`:
   * Un pedido entregado es una VENTA. Si el comprador lo borrase de verdad
   * desaparecerían con él el registro contable, los puntos de fidelidad ya
   * otorgados (admin.v33.js:3227), el contador de entregas del repartidor
   * (admin.v33.js:5823) y el histórico del panel. Por eso la base solo permite
   * borrar de verdad los CANCELADOS (`SOLO_CANCELADOS` en 39-*.sql), y esa
   * regla se queda como está.
   *
   * Aquí solo se marca `oculto_cliente = true`: el pedido deja de verse en
   * «Mis pedidos» y sigue entero en la base y en el panel. Es lo que hacen
   * Amazon o Uber Eats con «Archivar pedido».
   *
   * Va por RPC y no por PATCH directo a propósito: `anon` NO tiene permiso de
   * UPDATE sobre la columna `oculto_cliente` (el GRANT de 39-*.sql enumera las
   * columnas escribibles y esta no está). Así nadie puede ocultarle pedidos a
   * otra persona: la BASE comprueba que el pedido es suyo y que está
   * finalizado. Las comprobaciones del navegador solo sirven para dar buenos
   * mensajes; la defensa real está en el servidor.
   *
   * @param {string}  id
   * @param {string}  [emailCliente] correo del comprador.
   * @param {string}  [clienteId]    id de su ficha.
   * @param {boolean} [ocultar=true] false para volver a mostrarlo.
   */
  async hideOrderForClient(id, emailCliente, clienteId, ocultar = true) {
    if (!emailCliente && !clienteId) {
      throw new Error('No se puede ocultar el pedido sin identificar al cliente.');
    }
    return _rpcOrder(
      'cliente_ocultar_pedido',
      {
        p_id:         id,
        p_email:      emailCliente || null,
        p_cliente_id: clienteId || null,
        p_ocultar:    ocultar !== false,
      },
      false
    );
  },

  /* ── Clientes ─────────────────────────────────────────────────────────────
   *
   * 🔴 BUILD 422a · EL PANEL LEE CON SU VALE, NO CON LA LLAVE DE TODOS.
   *
   * Hasta el 421, esta función pedía la tabla directamente con `_SB_HEADERS`,
   * o sea con la llave `anon` que está publicada en la línea 22 de ESTE mismo
   * fichero. Consecuencia medida: **el panel no leía nada que un visitante
   * cualquiera no pudiera leer también.** El vale de administrador solo se
   * usaba para ESCRIBIR; para leer, el panel iba por la puerta de todos.
   *
   * Eso convertía el cierre del agujero en un problema: revocar el SELECT a
   * `anon` habría dejado la pantalla de Clientes en blanco, porque el panel
   * usaba exactamente el mismo permiso que se quería quitar.
   *
   * Ahora se pide por RPC y **la base comprueba el vale** con
   * `admin_sesion_basica`, la misma que ya valida el resto del panel desde el
   * build 39 — no se inventa otro control. Es el mismo patrón que
   * `getSettingsAdmin()` (BUILD 415) para los ajustes con secretos.
   *
   * 🔴 POR QUÉ ESTE BUILD NO REVOCA NADA: primero el mecanismo, después el
   * cierre (422b). Si algo falla aquí, el panel sigue funcionando y se ve al
   * instante; si se cerrara a la vez, un fallo dejaría al dueño sin su
   * herramienta de trabajo y sin saber por qué. Es la misma cautela que
   * funcionó en el 421. */
  async getCustomers() {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/customers?limit=2000');
      const json = await res.json();
      return json.data || [];
    }
    /* El cuarto argumento (`true`) es imprescindible: sin él `_rpcStaff`
     * desenvuelve el arreglo y devuelve SOLO el primer cliente, con lo que
     * esta función veía algo que no era arreglo y devolvía `[]` — la pantalla
     * en blanco del 422a. Ver la nota grande en `_rpcStaff`. */
    const lista = await _rpcStaff('admin_listar_clientes', { p_vale: _valeAdmin() }, _ERRORES_STAFF, true);
    return Array.isArray(lista) ? lista : [];
  },

  /* ─── BUILD 421 · LA FICHA DEL PROPIO CLIENTE, POR VALE ────────────────────
   *
   * Sustituye a `getCustomerByEmail` para la TIENDA. La diferencia no es
   * cosmética:
   *
   *   getCustomerByEmail('x@y.com')  → cualquiera puede pedir la ficha de
   *                                    CUALQUIER correo, con la llave `anon`
   *                                    publicada en este mismo fichero.
   *   misDatos()                     → la base decide de quién es el vale y
   *                                    devuelve SOLO esa ficha.
   *
   * 🔴 Con la primera bastaba ADIVINAR UN CORREO para leer nombre, teléfono,
   * dirección, cédula, cuánto ha gastado alguien, sus puntos y su historial de
   * compras completo. Los correos de Gmail no son secretos.
   *
   * `getCustomerByEmail` se conserva porque el PANEL la usa, y el panel tiene
   * su propio vale. Lo que cambia es quién la llama desde la tienda.
   *
   * Devuelve `null` si no hay vale, en vez de lanzar: la pantalla de puntos
   * debe poder dibujar «vuelve a entrar» sin romperse. */
  async misDatos() {
    const vale = _valeCliente();
    if (!vale) return null;
    return _rpcClient('cliente_mis_datos', { p_vale: vale });
  },

  /* Cierra la sesión del cliente EN LA BASE, no solo en el navegador.
   * Sin esto, el vale seguiría siendo válido 12 horas después de que el cliente
   * pulsara «Cerrar sesión» — y un vale vivo en un navegador compartido es
   * exactamente el problema que se quería evitar. */
  async cerrarSesionCliente() {
    const vale = _valeCliente();
    _borrarValeCliente();
    if (!vale) return true;
    try {
      await fetch(`${_SB_URL}/rpc/cliente_cerrar_sesion`, {
        method:  'POST',
        headers: _SB_HEADERS,
        body:    JSON.stringify({ p_vale: vale }),
      });
    } catch (e) { /* sin red: el vale caducará solo en 12 h */ }
    return true;
  },

  /* 🔴 BUILD 422a · AHORA EXIGE VALE DE PANEL.
   *
   * Esta función era el agujero de lectura más directo del proyecto: bastaba
   * ADIVINAR UN CORREO para obtener nombre, teléfono, dirección, cédula,
   * cuánto ha gastado alguien, sus puntos y su historial completo — con la
   * llave `anon` publicada. Y los correos de Gmail no son secretos.
   *
   * La TIENDA ya no la usa desde el 421 (usa `misDatos()`, donde la base mira
   * de quién es el vale). El único llamador legítimo que queda es el PANEL,
   * que sí tiene vale propio. Así que en vez de borrarla —lo que rompería al
   * panel— pasa por la RPC y **la base decide si quien pregunta tiene derecho
   * a preguntar.**
   *
   * Devuelve `null` en vez de lanzar cuando no hay resultado, igual que antes,
   * para no cambiar el comportamiento de quien la llama. */
  async getCustomerByEmail(email) {
    if (!email) return null;
    try {
      const fila = await _rpcStaff('admin_ficha_cliente_email', {
        p_vale:  _valeAdmin(),
        p_email: String(email).trim(),
      }, _ERRORES_CLIENTE);
      if (!fila) return null;
      return Array.isArray(fila) ? (fila[0] || null) : fila;
    } catch (e) {
      console.warn('[getCustomerByEmail] no se pudo leer la ficha:', e?.message || e);
      return null;
    }
  },

  /* ─── BUILD 418 · CREAR Y EDITAR CLIENTES DESDE EL PANEL ───────────────────
   *
   * EL AGUJERO QUE ESTO CIERRA
   * ──────────────────────────
   * Medido en la base REAL con `seguridad/42-leer-politicas.sql`:
   * `anon` podía ESCRIBIR e INSERTAR la columna `password` de `customers`.
   * Como la clave `anon` está publicada en este mismo fichero (línea 22),
   * cualquiera podía ponerle la contraseña que quisiera a cualquier cliente
   * y entrar como él. No era una fuga de datos: era SECUESTRO DE CUENTAS.
   * El disparador `trg_cifrar_password_customers` la habría cifrado sin
   * inmutarse, dejando la cuenta ajena perfectamente usable.
   *
   * POR QUÉ NO BASTABA UN `REVOKE`
   * ──────────────────────────────
   * El panel NECESITA asignar contraseñas: `admin.v33.js` las envía en
   * `data.password` a través de estos métodos. Un `REVOKE UPDATE (password)`
   * a secas habría roto la creación de clientes — el mismo error que estuve
   * a punto de cometer en el 415 con `settings`. Por eso el permiso no se
   * quita sin más: se MUEVE a una función que exige el vale del panel.
   *
   * `admin_guardar_cliente` sirve para las dos cosas: si `p_id` es null crea,
   * si no, edita. Una sola función porque la validación (correo duplicado,
   * longitud de la clave) es idéntica en ambos casos y duplicarla garantiza
   * que algún día divergan.
   *
   * LO QUE **NO** CAMBIA, Y ES DELIBERADO
   * ─────────────────────────────────────
   * `patchCustomer` sigue escribiendo directamente. La TIENDA lo usa en cinco
   * sitios (contadores del pedido, GPS, mapLink, lastLogin) y los clientes NO
   * TIENEN VALE — no existe `cliente_sesiones` en la base. Enrutarlo por una
   * RPC de admin habría roto el checkout. Cerrar esas columnas es el paso B y
   * exige antes crear el vale de cliente. Aquí se cierra solo `password`,
   * que es lo grave y lo que no tiene ningún uso legítimo desde la tienda. */
  async createCustomer(customer) {
    // Sin contraseña no hay nada que proteger: sigue el camino directo, que es
    // el que usa el registro por Google (`createClientFromOAuth`), donde no
    // hay vale de panel porque no hay ningún empleado delante.
    //
    // 🔴 `_sinClaveVacia` NO es cosmético. `admin.v33.js` construye el objeto
    // de creación con `password: data.password || ''`, o sea que la propiedad
    // VIENE SIEMPRE, aunque vacía. Enviarla vacía por el camino directo sería
    // un INSERT que menciona la columna `password` → 403 por el REVOKE de este
    // mismo build, y el aviso en pantalla no diría por qué. Se borra la
    // propiedad en vez de mandar una cadena vacía.
    if (!_tieneClave(customer)) {
      return _apiCreate('customers', _sinClaveVacia(customer));
    }
    return _rpcStaff('admin_guardar_cliente', {
      p_vale:  _valeAdmin(),
      p_id:    null,
      p_datos: customer,
    }, _ERRORES_CLIENTE);
  },

  async updateCustomer(id, customer) {
    if (!_tieneClave(customer)) {
      return _apiUpdate('customers', id, _sinClaveVacia(customer));
    }
    return _rpcStaff('admin_guardar_cliente', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: customer,
    }, _ERRORES_CLIENTE);
  },

  async patchCustomer(id, fields) {
    if (!_tieneClave(fields)) {
      return _apiPatch('customers', id, _sinClaveVacia(fields));
    }
    return _rpcStaff('admin_guardar_cliente', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: fields,
    }, _ERRORES_CLIENTE);
  },

  /**
   * BUILD 419 · Suma o resta puntos de fidelidad a un cliente.
   *
   * 🔴 POR QUÉ EXISTE ESTE MÉTODO
   * ─────────────────────────────
   * Hasta el build 418, `admin.v33.js` guardaba los puntos con un
   * `patchCustomer` directo: un PATCH a `customers` con la llave `anon`, que
   * está publicada en el código fuente del sitio (`js/api.js:22`). Cualquier
   * persona podía abrir la consola del navegador y regalarse puntos sin ser
   * empleado. Con la configuración de la tienda, 1 punto = RD$ 1 de descuento
   * al canjear, así que la columna abierta era dinero abierto.
   *
   * `46-cerrar-fidelidad.sql` revoca a `anon` el UPDATE de `loyaltyPoints`,
   * `loyaltyTier`, `loyaltyHistory` y `loyaltyLastActivity`, y crea esta RPC
   * como única puerta. Exige vale de panel y guarda en el historial QUIÉN hizo
   * el movimiento.
   *
   * LO QUE NO CAMBIA, Y ES DELIBERADO
   * ─────────────────────────────────
   * `spent` y `orders` SIGUEN abiertas: las escribe la tienda en el checkout
   * (`js/app.js:3082`) y los clientes no tienen vale. Cerrarlas exige el vale
   * de cliente, que es el paso C. El daño de dejarlas es menor de lo que
   * parece: el panel NO las usa para las estadísticas — cuenta los pedidos
   * reales (ver `js/admin.v33.js:4473`), así que un cliente que las falsee no
   * engaña al panel. Falsificar `spent` no da dinero; falsificar
   * `loyaltyPoints` sí. Eso es lo que se cierra aquí.
   *
   * SE MANDA EL DELTA, NO EL TOTAL
   * ──────────────────────────────
   * A propósito. El saldo lo calcula la base con `FOR UPDATE`, así que si dos
   * empleados acreditan puntos al mismo cliente a la vez, los dos movimientos
   * se suman. Con el PATCH anterior, el último sobrescribía al primero.
   *
   * @param   {string}  id       UUID del cliente
   * @param   {number}  pts      Delta: positivo suma, negativo resta
   * @param   {string}  reason   Motivo — obligatorio, queda en el historial
   * @param   {string?} orderId  Pedido que originó el movimiento, si aplica
   * @returns {Promise<{puntos:number, nivel:string, historial:Array, ultima_actividad:number}>}
   */
  async adjustCustomerPoints(id, pts, reason, orderId = null) {
    /* No hace falta desenvolver el arreglo de `RETURNS TABLE`: `_rpcStaff` ya
     * lo hace en su última línea (`Array.isArray(datos) ? datos[0] : datos`).
     * Volver a desenvolverlo aquí devolvería el primer CAMPO de la fila. */
    return _rpcStaff('admin_ajustar_puntos', {
      p_vale:    _valeAdmin(),
      p_cliente: id,
      p_puntos:  pts,
      p_motivo:  reason,
      p_pedido:  orderId,
    }, _ERRORES_PUNTOS);
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
  /* 🔴 BUILD 418 · Reescrito: el borrado lo hace ahora LA BASE DE DATOS.
   *
   * Medido con `seguridad/42-leer-politicas.sql`: `anon` tenía DELETE sobre
   * `customers`. Con la clave `anon` publicada, cualquiera podía borrar las
   * fichas de los 8 clientes con una sola petición.
   *
   * `admin_borrar_cliente` exige el vale del panel y hace las tres cosas en
   * UNA transacción: estampa la identidad en los pedidos, los desvincula y
   * borra la ficha. Antes eran tres viajes desde el navegador y, si el último
   * fallaba, quedaban pedidos ya desvinculados de un cliente que seguía
   * existiendo. Ahora o pasa todo o no pasa nada.
   *
   * Se conserva la misma forma de retorno (`{ pedidosDesvinculados }`) para
   * no tocar `confirmDeleteCustomer()` en el panel, que lee ese campo para
   * decidir el texto del aviso. */
  async deleteCustomer(id) {
    const pedidosDesvinculados = await _rpcStaff('admin_borrar_cliente', {
      p_vale: _valeAdmin(),
      p_id:   id,
    }, _ERRORES_CLIENTE);
    const n = Number(pedidosDesvinculados) || 0;
    if (n > 0) {
      console.log(`[deleteCustomer] ${n} pedido(s) desvinculado(s) y conservados.`);
    }
    return { pedidosDesvinculados: n };
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
          // BUILD 410 · por la base de datos: `anon` ya no puede escribir driverId.
          const n = await _rpcOrder('admin_desvincular_pedidos', {
            p_vale:  _valeAdmin(),
            p_campo: 'driverId',
            p_id:    id,
          });
          pedidosDesvinculados = Number(n) || arr.length;
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
        /* 🔴 BUILD 415 · Antes esto pedía `settings?select=*`, y ese asterisco
         * incluía la columna `groqApiKey`: la clave de IA viajaba al navegador
         * de CUALQUIER visitante de la tienda.
         *
         * Ahora se lee `settings_publico`, una vista que contiene los mismos
         * campos MENOS los secretos (ver seguridad/41-cerrar-settings.sql).
         * La tienda solo necesita 6 de ellos —teléfono, dirección, correo,
         * whatsapp y los dos horarios— y ninguno es sensible.
         *
         * El panel, que sí necesita la fila entera, la pide por RPC con el
         * vale de sesión: DB.getSettingsAdmin(). */
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        let res;
        try {
          res = await fetch(
            `${_SB_URL}/settings_publico?select=*&order=created_at.desc&limit=5`,
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

  /* ── BUILD 415 · Ajustes COMPLETOS para el panel ─────────────────────────
   * `getSettings()` lee la vista pública, que NO trae los secretos. El panel
   * necesita la fila entera (para mostrar la clave de IA como «configurada»),
   * y la pide por RPC: la BASE comprueba el vale de sesión y que quien lo usa
   * sea personal activo. Así el secreto nunca depende de que el navegador
   * «sea» el panel — eso el navegador puede fingirlo, la sesión no. */
  async getSettingsAdmin() {
    const fila = await _rpcStaff('admin_leer_settings', { p_vale: _valeAdmin() });
    return fila || {};
  },

  /* Devuelve la clave de IA. Solo funciona con una sesión de personal válida.
   * Se pide en el momento y NO se guarda en localStorage: guardarla ahí fue
   * exactamente el fallo que este build corrige. */
  async getAiKey() {
    const r = await _rpcStaff('admin_obtener_clave_ia', { p_vale: _valeAdmin() });
    return (typeof r === 'string') ? r : (r && r.admin_obtener_clave_ia) || '';
  },

  async saveAiKey(clave) {
    return _rpcStaff('admin_guardar_clave_ia', {
      p_vale:  _valeAdmin(),
      p_clave: clave,
    });
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
      /* 🔴 BUILD 415 · El `select=id` de esta URL NO es cosmético.
       *
       * `Prefer: return=representation` hace que PostgREST devuelva la fila
       * actualizada, y por omisión la devuelve COMPLETA. Desde este build
       * `anon` ya no puede leer la columna `groqApiKey`, así que devolver la
       * fila entera exigiría un permiso que ya no tiene: el PATCH entero
       * fallaría con 403 y el botón «Guardar cambios» dejaría de funcionar.
       *
       * Con `select=id` solo se devuelve el identificador, que sí es legible.
       * Nadie usa el resto de la respuesta: `saveSettings` solo se comprueba
       * por su éxito o su error. */
      const patchRes = await fetch(
        `${_SB_URL}/settings?id=eq.${id}&select=id`,
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
    /* BUILD 415 · `&select=id` por el mismo motivo que en el PATCH de arriba:
     * `return=representation` devolvería la fila COMPLETA, y `anon` ya no
     * puede leer la columna `groqApiKey`. Sin esto, crear la primera fila de
     * configuración fallaría con 403. */
    const createRes = await fetch(
      `${_SB_URL}/settings?select=id`,
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

/* ═══ BUILD 421 · ENTRAR CON GOOGLE, VERIFICADO EN EL SERVIDOR ═══════════════
 *
 * 🔴 EL AGUJERO QUE ESTO CIERRA — ERA EL CASO MAYORITARIO
 * ───────────────────────────────────────────────────────
 * De los 9 clientes de la tienda, 6 entran con Google. Hasta el build 420 esos
 * 6 estaban identificados por NADA: `login-cliente.html` partía el token de
 * Google por los puntos, leía el correo del trozo del medio y se lo creía. Su
 * propio comentario lo admitía: «sin verificar firma […] La verificación real
 * la haría el servidor». Ese servidor no existía.
 *
 * El trozo del medio de un JWT es Base64, no está cifrado. Cualquiera lo
 * escribe a mano. O sea que **cualquiera podía entrar como cualquier cliente
 * escribiendo su correo**, sin contraseña. Para esos 6 clientes el correo ERA
 * la credencial, y un correo de Gmail no es un secreto.
 *
 * Ahora el token va a `/api/oauth` (Cloudflare Pages Function), que comprueba
 * la FIRMA con la clave pública de Google, más el destinatario, el emisor y la
 * caducidad. Solo entonces la base emite el vale.
 *
 * POR QUÉ NO SE PODÍA HACER EN EL NAVEGADOR
 * ─────────────────────────────────────────
 * Verificar la firma exige una llave de servicio para emitir el vale. Cualquier
 * cosa que esté en el navegador está publicada — es la misma razón por la que
 * la llave `anon` de la línea 22 no protege nada. `cliente_abrir_sesion_oauth`
 * está REVOCADA a `anon` a propósito y concedida solo a `service_role`.
 *
 * 🔴 SI LA FUNCIÓN DEL SERVIDOR NO ESTÁ DESPLEGADA O CONFIGURADA, ESTO FALLA
 * CON UN AVISO CLARO Y NO DEJA ENTRAR A NADIE. Es deliberado: el «respaldo
 * silencioso» que decodifica el token en el navegador es justo lo que estamos
 * quitando. Volver a él ante un error sería reabrir el agujero precisamente
 * cuando algo va mal. Ya nos pasó con el `Fallback: si RPC no existe aún,
 * comparar directo (temporal)` de `auth.v33.js`, que dejó a los clientes sin
 * poder entrar durante builds enteros. */
async function abrirSesionGoogle(credential) {
  if (!credential) throw new Error('Google no devolvió ningún token.');

  let res, datos;
  try {
    res = await fetch('/api/oauth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ credential }),
    });
  } catch (e) {
    throw new Error('No se pudo conectar para verificar tu cuenta. Revisa tu conexión.');
  }

  const texto = await res.text();
  try { datos = JSON.parse(texto); } catch (e) { datos = null; }

  if (!res.ok || !datos || !datos.vale) {
    const msg = (datos && datos.error) || `No se pudo verificar tu cuenta (${res.status}).`;
    console.error('[oauth] respuesta del servidor:', res.status, texto.slice(0, 300));
    throw new Error(msg);
  }

  _guardarValeCliente(datos.vale);
  return { cliente: datos.cliente, creado: Boolean(datos.creado) };
}

/**
 * createClientFromOAuth(profile)
 *
 * 🔴 BUILD 421 · EN DESUSO PARA GOOGLE. Usa `abrirSesionGoogle(credential)`.
 *
 * Se conserva porque Apple Sign In todavía no está activo
 * (`login-cliente.html:1071` responde «estará disponible muy pronto») y cuando
 * se active necesitará el mismo tratamiento: verificar la firma en
 * `/api/oauth` antes de crear nada. Borrarla ahora obligaría a reescribirla;
 * dejarla EN USO sería mantener el agujero abierto por la puerta de Apple.
 *
 * Si al activar Apple esta función sigue sin usarse, bórrala: código muerto que
 * parece vivo es peor que no tenerlo.
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
    // Actualizar lastLogin siempre.
    // BUILD 421b · `_nowMs()`, no `_nowTs()`: la columna es BIGINT y hasta
    // ahora esta escritura fallaba en silencio en cada entrada por Google.
    const safePatch = { lastLogin: _nowMs() };
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

  /* 🔴 BUILD 419 · `status: 'habilitado'` SE QUITÓ de los tres niveles.
   *
   * `46-cerrar-fidelidad.sql` revoca a `anon` el INSERT de `status`, porque el
   * panel es el único que debe decidir si un cliente está habilitado. Pero este
   * INSERT corre en el navegador DEL CLIENTE al entrar con Google por primera
   * vez — ahí no hay ningún empleado ni ningún vale.
   *
   * Si la columna se quedaba mencionada aquí, el INSERT daba 403 y el registro
   * por Google se rompía... para gente que TODAVÍA NO EXISTE. O sea que nadie
   * lo habría notado hasta que un cliente nuevo se quejara, y el mensaje en
   * pantalla solo diría "no se pudo crear el cliente".
   *
   * Peor: los tres niveles de reintento de abajo capturan el error y bajan a un
   * INSERT más pequeño, pero el nivel C TAMBIÉN mencionaba `status`. Los tres
   * habrían fallado por la misma causa, dando la falsa impresión de un problema
   * de schema cache.
   *
   * La solución no es dejar la columna abierta: es que la BASE ponga el valor.
   * El mismo SQL hace `ALTER COLUMN status SET DEFAULT 'habilitado'`, así que
   * un cliente creado sin mencionarla queda igual que antes. */

  // Nivel A — todos los campos conocidos (incluyendo authProvider/avatar)
  const clientFull = {
    name: _name, email, phone: '', address: '', city: '',
    cedula: '', notes: '',
    ranking: 'bronce', orders: 0, spent: 0,
    // BUILD 421b · `lastOrder` es TEXT; `lastLogin` y `createdAt` son BIGINT.
    lastOrder: '', lastLogin: _nowMs(), createdAt: _nowMs(),
    authProvider: profile.authProvider || 'google',
    avatar: profile.picture || '',
  };

  // Nivel B — sin authProvider/avatar (columnas nuevas que pueden faltar)
  const clientBase = {
    name: _name, email, phone: '', address: '', city: '',
    cedula: '', notes: '',
    ranking: 'bronce', orders: 0, spent: 0,
    lastOrder: '', lastLogin: _nowMs(), createdAt: _nowMs(),
  };

  // Nivel C — solo lo absolutamente mínimo (name, email)
  // Útil cuando el schema cache de PostgREST no reconoce columnas que SÍ existen
  // BUILD 419 · `status` fuera: la base la pone por DEFAULT.
  const clientMinimal = {
    name: _name, email,
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

/** Timestamp legible: "31/07/2026 14:30".
 *
 * 🔴 BUILD 421b · SOLO PARA MOSTRAR EN PANTALLA. NO SE MANDA A LA BASE.
 * Ver `_nowMs()` justo debajo para el motivo. */
function _nowTs() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* Marca de tiempo NUMÉRICA (milisegundos desde 1970) para las columnas que la
 * base declara `BIGINT`.
 *
 * 🔴 BUILD 421b · ESTO ARREGLA UN FALLO QUE YA ESTABA EN PRODUCCIÓN, y que
 * salió a la luz porque la función SQL nueva se quejó del tipo:
 *
 *     column "lastLogin" is of type bigint but expression is of type text
 *
 * `supabase_alter.sql` declara **`lastLogin` BIGINT** (línea 161) y
 * **`createdAt` BIGINT** (línea 142). Pero todo el JS les metía `_nowTs()`,
 * que devuelve una CADENA ("01/09/2026 14:30"). Postgres rechaza la escritura.
 *
 * ¿Por qué nadie lo notó nunca? Porque las tres llamadas están envueltas en un
 * `catch` que descarta el error como «no crítico», y el panel solo pinta el
 * dato `if (c.lastLogin)` — así que la ficha simplemente NO mostraba «Último acceso
 * tienda» y no había ningún error a la vista. Es el mismo patrón exacto que el
 * `loyaltyLastActivity` que no se enviaba nunca (build 419): un fallo que no
 * se queja no es un fallo que no exista.
 *
 * `lastOrder` (TEXT, línea 160) y `loyaltyLastActivity` (TEXT, línea 166) SÍ
 * llevan texto: esos siguen usando `_nowTs()`. No se puede aplicar la misma
 * regla a toda la tabla — hay que mirar columna por columna. */
function _nowMs() {
  return Date.now();
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
