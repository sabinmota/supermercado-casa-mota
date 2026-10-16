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

// SEGURIDAD 95 · Aquí estaba `_SB_WRITE_HEADERS` con la cabecera
// `x-admin-key` y su valor escrito a la vista: cualquiera que abriera este
// fichero podía cambiar precios, stock y la Configuración. Ya no se escribe
// ninguna tabla directamente: todo pasa por funciones con el vale del panel.

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
  // BUILD 452 · `es_alcohol` va en la fase 1 a propósito. Es un boolean (1 byte)
  // y la tienda lo necesita para pintar el aviso «18+» en la tarjeta y en el
  // modal, y para decidir si el checkout pide confirmar la edad. Si llegara
  // tarde (bajo demanda) habría un instante en el que una cerveza se vería sin
  // aviso, que es exactamente lo que la directriz 1.4.3 no permite.
  // 480 · `itbis_tasa` también (un número): el checkout enseña al cliente el
  // ITBIS incluido en su compra, como hace la competencia.
  // 494 · `barcode_alt` (seguridad/86): la búsqueda y el escáner de la tienda
  // encuentran el producto también por su código alternativo.
    products:       'id,name,category,price,originalPrice,unit,stock,badge,rating,reviews,barcode,isNew,deleted,description,es_alcohol,itbis_tasa,solo_caja,barcode_alt',
  // Tienda fase 2 — solo image para actualizar imágenes
  products_imgs:  'id,image',
  // SEGURIDAD 92/93 · `orders`, `customers` y `staff` ya no se leen con la
  // clave pública: todo pasa por funciones con vale (ver DB.getOrders,
  // DB.misPedidos, DB.getCustomers, DB.getStaff y DB.exportTable).
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


// ─── CRUD helpers ─────────────────────────────────────────────────────────────

// SEGURIDAD 95 · `_apiCreate`, `_apiPatch` y `_toIso` borradas: eran la
// escritura directa con la clave del panel. Sus últimos usos (productos,
// stock, descripciones de la IA) van ahora por DB.saveProduct,
// DB.ajustarStock y DB.guardarDescripcion.

/* SEGURIDAD 92/93 · Contraseña vacía = sin contraseña. El panel arma el
 * cliente nuevo con `password: data.password || ''`; se quita la propiedad
 * vacía para que `admin_guardar_cliente` no la vea como «cambiar clave». */
function _sinClaveVacia(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clave = obj.password;
  if (typeof clave === 'string' ? clave.trim() !== '' : clave != null) return obj;
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

// SEGURIDAD 89/90 · Errores de las funciones de categorías, repartidores y
// notificaciones.
const _ERRORES_TABLAS = {
  SESION_INVALIDA:    'Tu sesión no es válida. Vuelve a entrar.',
  SESION_CADUCADA:    'Tu sesión caducó. Vuelve a entrar.',
  CUENTA_DESACTIVADA: 'Tu cuenta ya no está activa.',
  NO_EXISTE:          'Ese registro ya no existe. Recarga la página.',
  SIN_DATOS:          'No hay datos que guardar.',
  NOTIFICACION_AJENA: 'Esa notificación no es tuya.',
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

// SEGURIDAD 92 · Pedido nuevo listo para la base. El número lo pone la
// secuencia de Postgres y el id lo genera la base; el resto lo filtra la
// lista blanca de `cliente_crear_pedido` / `admin_crear_pedido`.
function _pedidoNuevo(order) {
  const datos = _orderToSupa(order);
  delete datos.order_number;
  delete datos.id;
  return datos;
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
  // SEGURIDAD 92
  NO_CANCELABLE:      'Este pedido ya no puede cancelarse.',
  DATOS_INVALIDOS:    'Los datos del pedido no llegaron correctamente.',
  // SEGURIDAD 94 · el panel también recibe los rechazos de la base
  CARRITO_VACIO:          'El pedido no tiene productos.',
  // SEGURIDAD 95
  SOLO_PENDIENTES:        'Solo se pueden cambiar productos de un pedido pendiente.',
  PRODUCTO_NUEVO_NO_PERMITIDO: 'No se pueden añadir productos nuevos a un pedido ya hecho.',
  PRECIO_CAMBIO:          'El precio de algún producto cambió. Vuelve a abrir «Nuevo pedido».',
  SIN_STOCK:              'No hay stock suficiente de algún producto.',
  SOLO_CAJA:              'Algún producto solo se vende en la caja.',
  PRODUCTO_NO_DISPONIBLE: 'Algún producto ya no existe.',
};

// SEGURIDAD 94 · Rechazos del checkout que el carrito sabe arreglar solo.
const _RECHAZOS_PEDIDO = [
  'PRECIO_CAMBIO', 'SIN_STOCK', 'SOLO_CAJA', 'PRODUCTO_NO_DISPONIBLE',
  'CUPON_INVALIDO', 'TOTAL_CAMBIO',
];

// SEGURIDAD 92 · Las mismas claves, con el texto pensado para el CLIENTE
// (no le decimos «vuelve a entrar al panel»).
const _ERRORES_PEDIDO_CLIENTE = {
  ..._ERRORES_ORDER,
  SESION_INVALIDA:    'Tu sesión no es válida. Vuelve a entrar.',
  SESION_CADUCADA:    'Tu sesión caducó. Vuelve a entrar.',
  CUENTA_DESACTIVADA: 'Tu cuenta está desactivada. Contacta al supermercado.',
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

/* 🔴 BUILD 426a · Mensajes del CANJE de puntos.
 *
 * Estos códigos los lanza `seguridad/52-canje-puntos.sql`. Cada uno es una
 * regla de negocio que el dueño decidió, no un fallo técnico, así que el
 * cliente merece leer la razón concreta y no un "error inesperado":
 *
 *   MINIMO_NO_ALCANZADO  decisión 4 · hay que juntar 100 pts
 *   SUPERA_TOPE          decisión 1 · como mucho el 20% del subtotal
 *   CUPON_Y_PUNTOS       decisión 3 · o cupón o puntos, no ambos
 *   CANJE_YA_APLICADO    ese pedido ya gastó puntos
 *   PEDIDO_AJENO         el pedido es de otra cuenta
 *
 * 🔴 `PEDIDO_AJENO` NO debe explicar de quién es el pedido. Quien lo provoca
 * está intentando canjear contra un pedido que no es suyo; confirmarle que
 * existe ya sería contarle de más. */
const _ERRORES_CANJE = {
  SESION_INVALIDA:     'Tu sesión no es válida. Vuelve a entrar.',
  SESION_CADUCADA:     'Tu sesión caducó. Vuelve a entrar.',
  CUENTA_DESACTIVADA:  'Tu cuenta está desactivada. Contacta al supermercado.',
  MINIMO_NO_ALCANZADO: 'Necesitas al menos 100 puntos para canjear.',
  SALDO_INSUFICIENTE:  'No tienes suficientes puntos para ese canje.',
  SUPERA_TOPE:         'Puedes usar como máximo el 20% del valor de tu compra en puntos.',
  CUPON_Y_PUNTOS:      'No puedes usar un cupón y puntos en el mismo pedido. Elige uno.',
  CANJE_YA_APLICADO:   'Este pedido ya tiene un canje de puntos aplicado.',
  PEDIDO_NO_EXISTE:    'No encontramos ese pedido.',
  PEDIDO_AJENO:        'No encontramos ese pedido.',
  PUNTOS_INVALIDOS:    'La cantidad de puntos a canjear no es válida.',
  FALTA_PEDIDO:        'Falta indicar el pedido.',
};

/* BUILD 453 · Mensajes de `admin_borrar_producto`.
 *
 * Hereda los tres de sesión porque la RPC valida con `admin_sesion_basica`,
 * la misma función que usan los pedidos desde el build 39.
 *
 * POR QUÉ UN DICCIONARIO PROPIO Y NO SE REUTILIZA `_ERRORES_STAFF`:
 * el código `FALTA_ID` significa cosas distintas según la RPC —allí es un
 * empleado, aquí un producto—, y un mensaje que nombra lo que no es le hace
 * perder el tiempo a quien lo lee. `PRODUCTO_NO_EXISTE` no existe en ningún
 * otro diccionario. */
const _ERRORES_PRODUCTO = {
  SESION_INVALIDA:     'Tu sesión no es válida. Vuelve a entrar al panel.',
  SESION_CADUCADA:     'Tu sesión caducó. Vuelve a entrar al panel.',
  CUENTA_DESACTIVADA:  'Tu cuenta ya no está activa.',
  FALTA_ID:            'Falta indicar el producto.',
  PRODUCTO_NO_EXISTE:  'Ese producto ya no existe.',
  // SEGURIDAD 95
  NO_EXISTE:           'Ese producto ya no existe. Recarga la página.',
  PRECIO_INVALIDO:     'El precio debe ser mayor a 0.',
  STOCK_INVALIDO:      'El stock no puede ser negativo.',
  DATOS_INVALIDOS:     'Los datos del producto no llegaron correctamente.',
  SIN_DATOS:           'No hay datos que guardar.',
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
async function _rpcClient(funcion, params, dicc = _ERRORES_CLIENTE_SESION, devolverArreglo = false) {
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
  if (!texto || texto === 'null') return devolverArreglo ? [] : null;
  const datos = JSON.parse(texto);
  // SEGURIDAD 92 · mismo interruptor que `_rpcStaff`: las listas (mis pedidos)
  // se devuelven enteras; lo demás se desenvuelve una vez.
  if (devolverArreglo) return Array.isArray(datos) ? datos : (datos == null ? [] : [datos]);
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
    // SEGURIDAD 94 · stock y precio llevan la lista concreta en `details`
    let j = null;
    try { j = JSON.parse(texto); } catch (e) { /* no JSON */ }
    if (j && (j.message === 'SIN_STOCK' || j.message === 'PRECIO_CAMBIO')) {
      let lista = [];
      try { lista = JSON.parse(j.details) || []; } catch (e) { /* sin detalle */ }
      const partes = lista.map(x => j.message === 'SIN_STOCK'
        ? `${x.nombre}: quedan ${x.quedan}`
        : `${x.nombre}: ahora RD$ ${Number(x.ahora).toFixed(2)}`);
      throw new Error(_ERRORES_ORDER[j.message] + (partes.length ? ' ' + partes.join(' · ') : ''));
    }
    for (const clave in _ERRORES_ORDER) {
      if (texto.includes(clave)) throw new Error(_ERRORES_ORDER[clave]);
    }
    console.error('[RPC ' + funcion + '] HTTP ' + res.status + ' — respuesta de la base:', texto);
    throw new Error(`No se pudo guardar el pedido (${res.status}).`);
  }

  const texto = await res.text();
  if (!texto || texto === 'null') return null;
  const datos = JSON.parse(texto);
  return Array.isArray(datos) ? (datos[0] ?? null) : datos;
}

// SEGURIDAD 89/90 · Aquí vivían `_apiPatchWhere` y `_desvincularPedidosDeCliente`,
// sin usar desde los builds 410 y 418 y conservadas «hasta cerrar `drivers`».
// `drivers` ya está cerrado (su borrado lo hace `admin_borrar_repartidor` en la
// base, en una transacción), así que se borraron como pedían sus propias notas.

// Tablas que el respaldo ya no puede leer con la clave pública: se piden con
// el vale del panel. `customers` y `staff` llegan SIN contraseñas.
const _RPC_RESPALDO = {
  drivers:        'admin_exportar_tabla',   // SEGURIDAD 89
  notificaciones: 'admin_exportar_tabla',   // SEGURIDAD 89
  customers:      'admin_respaldo_tabla',   // SEGURIDAD 92b
  orders:         'admin_respaldo_tabla',   // SEGURIDAD 92b
  staff:          'admin_respaldo_tabla',   // SEGURIDAD 92b
};

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

  /* SEGURIDAD 95 · Productos y stock con el vale del panel. La base aplica
   * una lista de campos permitidos: `solo_caja`, ITBIS y borrar tienen sus
   * propias funciones y no se pueden cambiar por aquí.
   *   saveProduct(product, cambios)  crear (sin id) o editar (con id)
   *   ajustarStock(id, delta)        suma o resta; nunca baja de 0
   *   cambiarCategoria(viejo, nuevo) mueve todos los productos de una vez
   *   guardarDescripcion(id, texto)  descripciones de la IA */
  async saveProduct(product, changedFields = null) {
    const datos = changedFields || product;
    return _rpcStaff('admin_guardar_producto', {
      p_vale: _valeAdmin(), p_id: product.id || null, p_datos: datos,
    }, _ERRORES_PRODUCTO);
  },

  async ajustarStock(id, delta) {
    return _rpcStaff('admin_ajustar_stock', {
      p_vale: _valeAdmin(), p_id: id, p_delta: Math.trunc(Number(delta) || 0),
    }, _ERRORES_PRODUCTO);
  },

  async cambiarCategoria(viejo, nuevo) {
    return _rpcStaff('admin_cambiar_categoria', {
      p_vale: _valeAdmin(), p_viejo: viejo, p_nuevo: nuevo,
    }, _ERRORES_PRODUCTO);
  },

  async guardarDescripcion(id, texto) {
    return _rpcStaff('admin_guardar_descripcion', {
      p_vale: _valeAdmin(), p_id: id, p_texto: texto,
    }, _ERRORES_PRODUCTO);
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

  /**
   * BUILD 453 · Borrar un producto.
   *
   * EL SÍNTOMA QUE ARREGLA
   * ──────────────────────
   * El botón de la papelera en Admin → Productos daba 401:
   *     DELETE .../rest/v1/products?id=eq.… 401 (Unauthorized)
   *
   * LA CAUSA, MEDIDA
   * ────────────────
   * Antes esto llamaba a `_apiDelete('products', id)`, que va con
   * `_SB_WRITE_HEADERS`, o sea con la clave `anon` PUBLICADA en la línea 22 de
   * este mismo fichero. Y `seguridad/39-cerrar-escritura-anonima.sql:263`
   * revocó ese permiso el 14 de agosto:
   *     REVOKE DELETE ON public.products FROM anon, authenticated;
   *
   * O sea que llevaba roto casi cinco semanas y nadie lo había notado porque
   * borrar un producto es una operación poco frecuente. **Un permiso revocado
   * no avisa al código que lo usaba: simplemente responde 401 el día que
   * alguien lo intenta.**
   *
   * 🔴 POR QUÉ NO SE ARREGLÓ DEVOLVIENDO EL PERMISO
   * ───────────────────────────────────────────────
   * Un `GRANT DELETE ON public.products TO anon` habría hecho funcionar el
   * botón en una línea, y habría dejado que cualquier visitante borrase los
   * 2.062 artículos desde la consola del navegador con la clave que está en el
   * código fuente de la web. Es el remiendo que la regla del dueño prohíbe:
   * arregla lo que se ve y abre lo que no.
   *
   * EL CAMINO ES EL QUE YA EXISTÍA PARA LOS PEDIDOS
   * ───────────────────────────────────────────────
   * El mismo fichero 39 que revocó este DELETE resolvió el caso idéntico de
   * `orders` con `admin_borrar_pedido(p_vale, p_id)` (su línea 116). Ahora los
   * productos usan su gemela, `admin_borrar_producto`, con la misma firma y el
   * mismo validador `admin_sesion_basica`. **La puerta ya no es el permiso de
   * tabla, es el vale**: solo un empleado con sesión abierta en el panel borra.
   *
   * `_rpcStaff` exige `p_vale` y lanza «Tu sesión caducó» si falta, así que no
   * hace falta comprobarlo aquí — comprobarlo dos veces en sitios distintos es
   * lo que produce mensajes que se contradicen.
   *
   * Requiere `seguridad/59-borrar-producto.sql` ejecutado.
   *
   * @param {string} id  UUID del producto.
   */
  async deleteProduct(id) {
    return _rpcStaff(
      'admin_borrar_producto',
      { p_vale: _valeAdmin(), p_id: id },
      _ERRORES_PRODUCTO
    );
  },

  // ── Pedidos ────────────────────────────────────────────────────────────────
  /* 🔴 SEGURIDAD 92/93 · `orders` ya no se lee ni se escribe con la clave
   * pública. Con ella cualquiera podía leer nombre, teléfono, dirección y
   * compras de TODOS los pedidos, y crear o cambiar pedidos ajenos.
   *
   *   getOrders()     PANEL  → `admin_leer_pedidos` (vale del panel)
   *   misPedidos()    TIENDA → `cliente_mis_pedidos` (la base filtra por el
   *                            dueño del vale; el navegador ya no filtra)
   *   createOrder()   las dos caras; la base decide el número, y en la tienda
   *                   además fuerza `clientId` = dueño del vale y estado
   *                   `pendiente`. Los contadores del cliente (pedidos, gasto,
   *                   último pedido) los suma LA BASE en la misma transacción.
   *
   * `devolverArreglo = true` en las listas: sin él se quedaría solo la 1ª fila. */
  async getOrders() {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/orders?limit=2000');
      const json = await res.json();
      return Array.isArray(json.data) ? json.data.map(_orderFromSupa) : [];
    }
    const lista = await _rpcStaff('admin_leer_pedidos', { p_vale: _valeAdmin() }, _ERRORES_ORDER, true);
    return lista.map(_orderFromSupa);
  },

  async misPedidos() {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/orders?limit=2000');
      const json = await res.json();
      return Array.isArray(json.data) ? json.data.map(_orderFromSupa) : [];
    }
    const vale = _valeCliente();
    if (!vale) return [];
    const lista = await _rpcClient('cliente_mis_pedidos', { p_vale: vale }, _ERRORES_PEDIDO_CLIENTE, true);
    return lista.map(_orderFromSupa);
  },

  // Un pedido propio por id. Sale de la misma lista (la base ya filtra): un
  // cliente no puede pedir por id un pedido que no es suyo.
  async miPedido(id) {
    const lista = await DB.misPedidos();
    return lista.find(o => String(o.id) === String(id)) || null;
  },

  // Dos métodos separados A PROPÓSITO (no uno que mire qué vale hay): un
  // empleado que pase del panel a la tienda en la misma pestaña tiene los dos
  // vales, y el checkout no debe ir nunca por la puerta del panel.
  async createOrder(order) {          // PANEL · modal «Nuevo pedido»
    const fila = await _rpcOrder('admin_crear_pedido', {
      p_vale: _valeAdmin(), p_datos: _pedidoNuevo(order),
    });
    return fila ? _orderFromSupa(fila) : null;
  },

  /* SEGURIDAD 94 · La base calcula precios, envío, cupón y total, y descuenta
   * el stock. Si algo no cuadra NO crea el pedido y explica por qué. Este
   * método no lanza un Error genérico en esos casos: devuelve
   * `{ rechazo: CODIGO, detalle }` para que el checkout pueda ARREGLAR el
   * carrito (precio nuevo, cantidad disponible) en vez de solo mostrar un fallo.
   *   PRECIO_CAMBIO           detalle: [{id, nombre, antes, ahora}]
   *   SIN_STOCK               detalle: [{id, nombre, quedan, pedido}]
   *   SOLO_CAJA               detalle: [{id, nombre}]
   *   PRODUCTO_NO_DISPONIBLE  detalle: [{id}]
   *   CUPON_INVALIDO          detalle: 'texto del motivo'
   *   TOTAL_CAMBIO            detalle: {subtotal, envio, descuento, ceroCentavos, total} */
  async crearMiPedido(order) {        // TIENDA · checkout
    const res = await fetch(`${_SB_URL}/rpc/cliente_crear_pedido`, {
      method:  'POST',
      headers: _SB_HEADERS,
      body:    JSON.stringify({ p_vale: _valeCliente(), p_datos: _pedidoNuevo(order) }),
    });
    const texto = await res.text();
    if (!res.ok) {
      let j = null;
      try { j = JSON.parse(texto); } catch (e) { /* cuerpo no JSON */ }
      const codigo = j && j.message;
      if (_RECHAZOS_PEDIDO.includes(codigo)) {
        let detalle = j.details;
        try { detalle = JSON.parse(j.details); } catch (e) { /* texto plano (cupón) */ }
        return { rechazo: codigo, detalle };
      }
      for (const clave in _ERRORES_PEDIDO_CLIENTE) {
        if (texto.includes(clave)) throw new Error(_ERRORES_PEDIDO_CLIENTE[clave]);
      }
      console.error('[RPC cliente_crear_pedido] HTTP ' + res.status + ' — respuesta de la base:', texto);
      throw new Error(`No se pudo crear el pedido (${res.status}).`);
    }
    const datos = texto ? JSON.parse(texto) : null;
    const fila  = Array.isArray(datos) ? datos[0] : datos;
    return fila ? _orderFromSupa(fila) : null;
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
    /* SEGURIDAD 95 · Las líneas ya no viajan por aquí: cambiarlas mueve
     * stock, y eso lo hace `editarLineasPedido` en la base. Esta función
     * guarda estado, notas, repartidor… y la base repone o descuenta el
     * stock al cancelar o reactivar. */
    const datos = _soloCamposOrder(_orderToSupa(order));
    delete datos.productLines;
    const fila  = await _rpcOrder('admin_guardar_pedido', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: datos,
    });
    return fila ? _orderFromSupa(fila) : null;
  },

  /* SEGURIDAD 95 · Cambiar cantidades o quitar líneas de un pedido
   * pendiente. La base mueve solo la diferencia de stock y recalcula los
   * importes; si no hay stock suficiente no se acepta (decisión A). */
  async editarLineasPedido(id, lineas) {
    const fila = await _rpcOrder('admin_editar_lineas_pedido', {
      p_vale:   _valeAdmin(),
      p_id:     id,
      p_lineas: (lineas || []).map(l => ({ productId: String(l.productId), cantidad: Number(l.cantidad) || 0 })),
    });
    return fila ? _orderFromSupa(fila) : null;
  },

  /* SEGURIDAD 92 · Lo que la TIENDA puede hacer con un pedido suyo. Antes era
   * un PATCH abierto (`patchOrder`) con el que cualquiera podía cancelar o
   * quitar el descuento de un pedido AJENO. Ahora la base comprueba que el
   * pedido es del dueño del vale, y al cancelar resta ella los contadores. */
  async cancelarMiPedido(id) {
    const fila = await _rpcClient('cliente_cancelar_pedido', {
      p_vale: _valeCliente(), p_id: id,
    }, _ERRORES_PEDIDO_CLIENTE);
    return fila ? _orderFromSupa(fila) : null;
  },

  async quitarCuponDeMiHistorial(id) {
    return _rpcClient('cliente_quitar_cupon_historial', {
      p_vale: _valeCliente(), p_id: id,
    }, _ERRORES_PEDIDO_CLIENTE);
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

  // SEGURIDAD 92 · `getCustomerByEmail` borrada: su último llamador era el
  // registro antiguo por OAuth. La tienda usa `misDatos()`.

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
   * que algún día divergan. */
  /* 🔴 SEGURIDAD 92/93 · `customers` ya no se escribe con la clave pública.
   *
   *   createCustomer / patchCustomer → PANEL, siempre `admin_guardar_cliente`
   *                                    (vale del panel). Crear exige clave.
   *   actualizarMisDatos             → TIENDA, `cliente_actualizar_mis_datos`:
   *                                    solo dirección, ciudad, GPS, teléfono,
   *                                    enlace de mapa y último acceso.
   *
   * Los contadores (pedidos, gasto, último pedido) ya no los manda nadie: los
   * suma y resta la base al crear o cancelar un pedido. Antes el navegador
   * mandaba el número ya hecho y cualquiera podía ponerse el gasto que quisiera.
   * El registro con Google lo hace el servidor (`/api/oauth`), no esta capa. */
  async createCustomer(customer) {
    return _rpcStaff('admin_guardar_cliente', {
      p_vale:  _valeAdmin(),
      p_id:    null,
      p_datos: _sinClaveVacia(customer),
    }, _ERRORES_CLIENTE);
  },

  async patchCustomer(id, fields) {
    return _rpcStaff('admin_guardar_cliente', {
      p_vale:  _valeAdmin(),
      p_id:    id,
      p_datos: _sinClaveVacia(fields),
    }, _ERRORES_CLIENTE);
  },

  async actualizarMisDatos(campos) {
    return _rpcClient('cliente_actualizar_mis_datos', {
      p_vale: _valeCliente(), p_datos: campos,
    }, { ..._ERRORES_CLIENTE_SESION, DATOS_INVALIDOS: 'Los datos no llegaron correctamente.' });
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

  /* ─── BUILD 426a · CANJE DE PUNTOS ────────────────────────────────────────
   *
   * Tres métodos, y la separación entre ellos NO es cosmética:
   *
   *   canjeDisponible()   lo pregunta el CLIENTE — solo lee, no compromete nada
   *   canjearPuntos()     lo hace el CLIENTE — mueve dinero, es irreversible
   *   devolverPuntosCanje() lo hace el PANEL — repone lo canjeado al cancelar
   *
   * 🔴 POR QUÉ EL TOPE Y EL MÍNIMO NO SE CALCULAN AQUÍ: el navegador es del
   * cliente. Cualquiera puede abrir la consola y llamar a `canjearPuntos` con
   * los puntos que se le antojen. Todos los límites los impone
   * `cliente_canjear_puntos` en la base, que además bloquea la fila con
   * `FOR UPDATE`. Lo que se calcula aquí es solo para PINTAR el deslizador.
   * Si algún día alguien cambia el 20% en el JavaScript creyendo que ahí vive
   * la regla, la base seguirá rechazándolo — y así debe ser. */

  /**
   * Pregunta a la base cuántos puntos puede usar el cliente en ESTE carrito.
   *
   * No compromete nada: es una consulta. Devuelve también el mínimo y el tope
   * vigentes para que el deslizador se dibuje con los números de verdad y no
   * con constantes copiadas.
   *
   * @param   {number} subtotal  Subtotal del carrito SIN envío (decisión 2:
   *                             los puntos no pagan el envío, así que el tope
   *                             se calcula sobre el subtotal a secas)
   * @returns {Promise<{puntos_saldo:number, puntos_max:number,
   *                    descuento_max:number, valor_punto:number,
   *                    minimo_puntos:number, tope_porcentaje:number,
   *                    puede_canjear:boolean, motivo:string}|null>}
   *          `null` si el cliente no tiene sesión abierta (invitado).
   */
  async canjeDisponible(subtotal) {
    const vale = _valeCliente();
    if (!vale) return null;

    return _rpcClient('cliente_canje_disponible', {
      p_vale:     vale,
      p_subtotal: Number(subtotal) || 0,
    }, _ERRORES_CANJE);
  },

  /**
   * BUILD 432 · Guarda el token de notificaciones push del dispositivo.
   *
   * 🔴 LÍMITE DECLARADO, y es la razón de que esto NO escriba en la base
   *    todavía: guardar el token exige una columna o una tabla que HOY NO
   *    EXISTE, y crearla es un cambio de esquema que el dueño debe aprobar
   *    y ejecutar en Supabase. Escribir aquí un PATCH contra una columna
   *    inexistente daría 400 en cada arranque de la app.
   *
   * 🔴 POR QUÉ EXISTE ESTE HUECO EN LUGAR DE NADA: `js/nativo.js` pregunta
   *    por `DB.guardarTokenPush` y, si no está, deja el token solo en
   *    memoria. Tener el método aquí documenta el contrato y deja el sitio
   *    exacto donde enchufar la RPC cuando la tabla exista — en vez de que
   *    el día que se cree haya que volver a buscar dónde iba.
   *
   * Lo que hace hoy: deja constancia en consola y responde sin error, para
   * que un fallo de push nunca impida usar la tienda.
   *
   * @param {string} token  Token APNs (iOS) o FCM (Android)
   */
  async guardarTokenPush(token) {
    if (!token) return null;
    console.log('[api] token de push recibido, aún sin destino en la base:',
                String(token).slice(0, 12) + '…');
    return { guardado: false, motivo: 'FALTA_TABLA_DISPOSITIVOS' };
  },

  /**
   * Aplica el canje sobre un pedido YA CREADO.
   *
   * 🔴 EL ORDEN IMPORTA Y NO ES NEGOCIABLE: primero nace el pedido, después se
   * canjea contra él. Al revés no se puede, porque la base necesita el UUID
   * del pedido para dejar constancia de cuántos puntos se gastaron ahí — y esa
   * constancia (`puntosUsados`) es lo único que permite devolverlos si el
   * pedido se cancela. Un canje sin pedido asociado sería dinero que se
   * evapora sin rastro.
   *
   * La base descuenta los puntos, recalcula el nivel con `nivel_por_puntos`,
   * anota el movimiento en el historial y baja el total del pedido. Todo en
   * una sola transacción: o pasa completo o no pasa nada.
   *
   * @param   {string} orderId   UUID del pedido recién creado
   * @param   {number} puntos    Puntos a canjear
   * @param   {number} subtotal  Subtotal sin envío, para revalidar el tope
   * @returns {Promise<{puntos_usados:number, descuento:number,
   *                    puntos_restantes:number, nivel:string}>}
   */
  async canjearPuntos(orderId, puntos, subtotal) {
    return _rpcClient('cliente_canjear_puntos', {
      p_vale:     _valeCliente(),
      p_pedido:   orderId,
      p_puntos:   Math.floor(Number(puntos) || 0),
      p_subtotal: Number(subtotal) || 0,
    }, _ERRORES_CANJE);
  },

  /**
   * Devuelve al cliente los puntos que canjeó, cuando el pedido se cancela.
   *
   * Decisión 6 del dueño. Lo llama el PANEL (vale de empleado), no el cliente.
   *
   * 🔴 ES IDEMPOTENTE A PROPÓSITO: la base marca `puntosDevueltos` y si se
   * vuelve a llamar responde `ya_estaba: true` sin repetir el abono. Sin eso,
   * un empleado que cambie el estado del pedido dos veces —o un doble clic—
   * regalaría los puntos dos veces. El panel puede llamarla sin miedo.
   *
   * @param   {string} orderId  UUID del pedido cancelado
   * @returns {Promise<{devueltos:number, puntos_restantes:number|null,
   *                    nivel:string|null, ya_estaba:boolean}>}
   *          `devueltos: 0` si el pedido nunca tuvo canje.
   */
  async devolverPuntosCanje(orderId) {
    return _rpcStaff('admin_devolver_puntos_canje', {
      p_vale:   _valeAdmin(),
      p_pedido: orderId,
    }, _ERRORES_CANJE);
  },

  /**
   * Borra la ficha de un cliente SIN dejar sus pedidos huérfanos.
   *
   * Los pedidos NO se borran (son historial contable): se les estampa la
   * identidad del cliente y se les pone `clientId = null`, así el histórico
   * de ventas sobrevive sin referencias rotas (build 372: 4 pedidos
   * huérfanos, RD$1.898, por borrar sin desvincular).
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
    // SEGURIDAD 92/93 · con el vale del panel; la base quita `password`.
    return _rpcStaff('admin_listar_personal', { p_vale: _valeAdmin() }, _ERRORES_STAFF, true);
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
  /* 🔴 SEGURIDAD 89/90 · `drivers` ya no se lee ni se escribe con la clave
   * pública: tiene cédula, teléfono y dirección de los repartidores, y con
   * la clave `anon` (publicada en este fichero) cualquiera podía leerlos,
   * cambiarlos o borrarlos. Todo pasa por funciones que exigen el vale del
   * panel. `devolverArreglo = true` porque la lectura devuelve la LISTA
   * entera: sin él, `_rpcStaff` se quedaría solo con el primer repartidor. */
  async getDrivers() {
    if (_IS_GENSPARK) {
      const res  = await fetch('tables/drivers?limit=500');
      const json = await res.json();
      return json.data || [];
    }
    return _rpcStaff('admin_leer_repartidores', { p_vale: _valeAdmin() },
                     _ERRORES_TABLAS, true);
  },

  async createDriver(driver) {
    return _rpcStaff('admin_guardar_repartidor', {
      p_vale: _valeAdmin(), p_id: null, p_datos: driver,
    }, _ERRORES_TABLAS);
  },

  async patchDriver(id, fields) {
    return _rpcStaff('admin_guardar_repartidor', {
      p_vale: _valeAdmin(), p_id: id, p_datos: fields,
    }, _ERRORES_TABLAS);
  },

  /* Borra el repartidor y suelta sus pedidos (driverId = NULL) en UNA sola
   * transacción en la base. Antes eran tres viajes desde el navegador y, si
   * el último fallaba, quedaban pedidos sueltos de un repartidor que seguía
   * existiendo. Mantiene la forma de retorno `{ pedidosDesvinculados }`. */
  async deleteDriver(id) {
    const n = await _rpcStaff('admin_borrar_repartidor', {
      p_vale: _valeAdmin(), p_id: id,
    }, _ERRORES_TABLAS);
    return { pedidosDesvinculados: Number(n) || 0 };
  },

  // ── Notificaciones ─────────────────────────────────────────────────────────
  /* 🔴 SEGURIDAD 89/90 · Antes la tienda y el panel leían y escribían
   * `notificaciones` con la clave pública: cualquiera podía leer los avisos
   * de TODOS los clientes (con nombres e importes) o crear avisos falsos
   * «de Casa Mota». Ahora:
   *   · el PANEL lee y escribe con su vale;
   *   · cada CLIENTE recibe solo las suyas y solo puede marcar/borrar las
   *     suyas, con el vale de la tienda. */
  async getNotificacionesAdmin(limite = 300) {
    return _rpcStaff('admin_leer_notificaciones', {
      p_vale: _valeAdmin(), p_limite: limite,
    }, _ERRORES_TABLAS, true);
  },

  async notiPedidosRegistrados() {
    return _rpcStaff('admin_noti_pedidos_registrados', { p_vale: _valeAdmin() },
                     _ERRORES_TABLAS, true);
  },

  async crearNotificacion(datos) {
    return _rpcStaff('admin_guardar_notificacion', {
      p_vale: _valeAdmin(), p_id: null, p_datos: datos,
    }, _ERRORES_TABLAS);
  },

  async patchNotificacion(id, campos) {
    return _rpcStaff('admin_guardar_notificacion', {
      p_vale: _valeAdmin(), p_id: id, p_datos: campos,
    }, _ERRORES_TABLAS);
  },

  /* Lado del CLIENTE. Devuelve [] si no hay vale (invitado o pestaña
   * reabierta) en vez de lanzar: la pantalla debe poder pintar «Todo al día». */
  async misNotificaciones() {
    const vale = _valeCliente();
    if (!vale) return [];
    const res = await fetch(`${_SB_URL}/rpc/cliente_mis_notificaciones`, {
      method: 'POST', headers: _SB_HEADERS, body: JSON.stringify({ p_vale: vale }),
    });
    if (!res.ok) throw new Error(`No se pudieron cargar las notificaciones (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const datos = await res.json();
    return Array.isArray(datos) ? datos : [];
  },

  /* campo: 'leida' (la leyó el cliente) o 'borrada_cliente' (la quitó de su
   * pantalla). La base rechaza cualquier otro campo y cualquier aviso ajeno. */
  async marcarMiNotificacion(id, campo) {
    return _rpcClient('cliente_marcar_notificacion', {
      p_vale: _valeCliente(), p_id: id, p_campo: campo,
    }, { ..._ERRORES_CLIENTE_SESION, ..._ERRORES_TABLAS });
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

  /* SEGURIDAD 95 · Configuración con el vale del panel. La base guarda en la
   * MISMA fila que leen la tienda y el cálculo del envío, con una lista de
   * campos permitidos (datos de la tienda, envío, horarios, fidelización).
   * La clave de la IA no entra aquí: tiene `saveAiKey`. Si no existe aún
   * ninguna fila, la base la crea. */
  async saveSettings(data) {
    return _rpcStaff('admin_guardar_configuracion', {
      p_vale: _valeAdmin(), p_datos: data,
    }, { ..._ERRORES_TABLAS, VALOR_INVALIDO: 'Algún importe no es válido (no puede ser negativo, y el valor del punto debe ser mayor que 0).' });
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

  /* 🔴 SEGURIDAD 89/90 · La tienda sigue LEYENDO `categories` con la clave
   * pública (getCategories, arriba). Crear, editar y borrar pasa a exigir el
   * vale del panel: con la clave `anon` cualquiera podía borrar las 37
   * categorías y dejar la tienda sin menú.
   * id = null → alta; id = UUID → edición. */
  async saveCategory(id, datos) {
    return _rpcStaff('admin_guardar_categoria', {
      p_vale: _valeAdmin(), p_id: id || null, p_datos: datos,
    }, _ERRORES_TABLAS);
  },

  async deleteCategory(id) {
    return _rpcStaff('admin_borrar_categoria', {
      p_vale: _valeAdmin(), p_id: id,
    }, _ERRORES_TABLAS);
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

    // SEGURIDAD 89/90 · Estas dos tablas ya no se leen con la clave pública:
    // el respaldo las pide con el vale del panel (todas las filas, borradas
    // incluidas, sin transformar — igual que el resto del respaldo).
    const _rpc = _RPC_RESPALDO[tabla];
    if (_rpc) {
      const filas = await _rpcStaff(_rpc, {
        p_vale: _valeAdmin(), p_tabla: tabla,
      }, _ERRORES_TABLAS, true);
      if (onProgress) onProgress(filas.length, filas.length);
      return filas;
    }

    // Producción: Supabase PostgREST. La paginación va por cabecera Range,
    // no por ?page= — usar ?page= devolvería SIEMPRE la primera página.
    const todo = [];
    let desde = 0;
    while (true) {
      const hasta = desde + pageSize - 1;
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
      if (_RPC_RESPALDO[tabla]) {
        const filas = await _rpcStaff(_RPC_RESPALDO[tabla], {
          p_vale: _valeAdmin(), p_tabla: tabla,
        }, _ERRORES_TABLAS, true);
        return filas.length;
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
/* 🔴 BUILD 443 · SEGUNDO PARÁMETRO `opciones`, Y SIN ÉL EL LOGIN DE APPLE NO
 *    PODRÍA FUNCIONAR NUNCA. Esta función enviaba solo `{ credential }`, así
 *    que el servidor —que elige las claves públicas y el emisor según
 *    `proveedor`— habría intentado verificar un token de APPLE contra las
 *    claves de GOOGLE. Resultado: `CLAVE_DESCONOCIDA` y un 401, con el
 *    diagnóstico apuntando al código nativo cuando el fallo estaría aquí.
 *
 *    `opciones` es opcional a propósito: las cuatro llamadas que ya existen en
 *    la web siguen funcionando sin tocarlas, y el servidor interpreta la
 *    ausencia de `proveedor` como 'google' (build 442). Añadir un parámetro
 *    con valor por defecto es compatible hacia atrás; cambiar la firma
 *    obligaría a revisar cada llamada y a arriesgar el camino por el que hoy
 *    entran 6 de los 9 clientes.
 *
 *    El nombre conserva «Google» aunque ya sirva para Apple: renombrarla
 *    obligaría a tocar sus llamadas en varias páginas sin ganar nada
 *    funcional, y cada una de esas ediciones es una ocasión de romper algo
 *    que funciona. Queda anotado como deuda de nombre, no de comportamiento. */
async function abrirSesionGoogle(credential, opciones) {
  if (!credential) throw new Error('No se recibió ningún token.');

  const extra = opciones || {};
  let res, datos;
  try {
    res = await fetch('/api/oauth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        credential,
        proveedor: extra.proveedor || 'google',
        nombre:    extra.nombre || '',
      }),
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

/* SEGURIDAD 92 · Aquí vivía `createClientFromOAuth`, el registro antiguo por
 * Google/Apple desde el navegador. Sin uso desde el build 421 (Google entra
 * por `/api/oauth`, verificado en el servidor) y con el cierre de `customers`
 * ya no podría funcionar. Apple, cuando se active, irá por el mismo camino
 * que Google. Se borró junto con `_processOAuthProfile` de login-cliente.html. */

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
