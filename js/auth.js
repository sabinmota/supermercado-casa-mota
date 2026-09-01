/**
 * SUPERMERCADO CASA MOTA — AUTH & ROLES
 * Autenticación, sesión y control de acceso por rol
 */

// ─── Roles y sus permisos ────────────────────────────────────────────────────
const ROLES = {
  superadmin: {
    label: 'Super Admin',
    color: '#7c3aed',
    icon:  'fa-crown',
    sections: ['dashboard','products','orders','inventory','customers','staff','drivers','loyalty','reportes','cupones','notificaciones','settings'],
    canEditPrices:    true,
    canDeleteProducts:true,
    canCreateProducts:true,
    canManageStaff:   true,
    canManageSettings:true,
  },
  admin: {
    label: 'Administrador',
    color: '#1565c0',
    icon:  'fa-user-shield',
    sections: ['dashboard','products','orders','inventory','customers','drivers','loyalty','reportes','cupones','notificaciones','settings'],
    canEditPrices:    true,
    canDeleteProducts:true,
    canCreateProducts:true,
    canManageStaff:   false,
    canManageSettings:true,
  },
  operador: {
    label: 'Operador',
    color: '#1a7c3e',
    icon:  'fa-user-gear',
    sections: ['dashboard','orders','inventory','drivers','reportes'],
    canEditPrices:    false,
    canDeleteProducts:false,
    canCreateProducts:false,
    canManageStaff:   false,
    canManageSettings:false,
  },
};

/* ─── BUILD 395 · DEFAULT_STAFF BORRADO ────────────────────────────────────────
 *
 * Aquí había 4 empleados de ejemplo con la contraseña escrita en claro:
 *   admin@casamota.com.do / Admin2024!   ← superadmin
 *   ana.ramirez@…         / Ana2024!
 *   pedro.sanchez@…       / Pedro2024!
 *   maria.fernandez@…     / Maria2024!
 *
 * Este fichero lo descarga cualquiera que abra la web, así que esas cuatro
 * contraseñas eran públicas.
 *
 * 🔴 Y eran una trampa activa: login() las usaba como respaldo cuando fallaba
 * la consulta a `staff`. Al quitarle a `anon` el permiso de leer esa tabla,
 * la consulta EMPEZARÍA a fallar siempre… y el panel habría pasado a aceptar
 * 'Admin2024!' como contraseña de superadministrador. El propio arreglo de
 * seguridad habría abierto una puerta peor que la que cerraba.
 * ─────────────────────────────────────────────────────────────────────────── */

// ─── Helpers de sesión ───────────────────────────────────────────────────────
// Obtener staff desde la API (asíncrono)
async function getStaffList() {
  try {
    return await DB.getStaff();
  } catch(e) {
    // BUILD 395 · Antes devolvía DEFAULT_STAFF, una lista de empleados de
    // ejemplo con contraseñas en claro. Ahora un fallo se propaga como fallo:
    // es preferible una lista vacía a una lista inventada.
    console.warn('[auth] no se pudo cargar el personal:', e && e.message);
    return [];
  }
}

// saveStaffList ya no se usa directamente — se hace desde DB.updateStaff / DB.patchStaff
function saveStaffList(list) {
  // Deprecated: uso solo para compatibilidad. Las operaciones de escritura
  // se hacen con DB.createStaff / DB.updateStaff / DB.patchStaff individualmente.
  console.warn('saveStaffList() está deprecado. Usa DB.updateStaff() directamente.');
}

function getSession() {
  try { return JSON.parse(sessionStorage.getItem('cm_session') || 'null'); }
  catch { return null; }
}

function setSession(user) {
  sessionStorage.setItem('cm_session', JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem('cm_session');
}

function getRole(roleKey) {
  return ROLES[roleKey] || ROLES.operador;
}

// ─── Autenticación ───────────────────────────────────────────────────────────
/* BUILD 395 · La contraseña YA NO se comprueba en el navegador.
 *
 * ⚠️ ESTE es el fichero que carga login.html — la puerta real del panel.
 * `js/auth.v33.js` es el que carga admin.html. Los dos tenían el mismo fallo:
 * arreglar solo uno no habría servido de nada.
 *
 * Antes: `DB.getStaff()` + `s.password === password`. Para poder comparar, el
 * navegador se descargaba la columna `password` de todo el personal — y `anon`
 * podía pedir esa misma lista desde la tienda.
 *
 * Ver seguridad/31-contrasenas.sql. */
async function login(email, password) {
  const correo = (email || '').trim();
  const clave  = (password || '').trim();
  if (!correo || !clave) return { ok: false, msg: 'Correo o contraseña incorrectos.' };

  let user = null;
  try {
    const res = await fetch(`${_SB_URL}/rpc/verify_staff_password`, {
      method:  'POST',
      headers: _SB_HEADERS,
      body:    JSON.stringify({ p_email: correo, p_password: clave })
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const rows = await res.json();
    user = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    // Un fallo de red NO puede dejar entrar a nadie. Antes se caía a
    // DEFAULT_STAFF, con 'Admin2024!' escrito en este mismo fichero público.
    console.warn('[auth] no se pudo verificar la contraseña:', e && e.message);
    return { ok: false, msg: 'No se pudo conectar para verificar tu acceso. Revisa tu conexión e inténtalo de nuevo.' };
  }

  if (!user || !user.id) return { ok: false, msg: 'Correo o contraseña incorrectos.' };

  // BUILD 397 · El `vale` es lo que permite escribir en `staff`. Sin él, crear,
  // editar o borrar empleados falla: `anon` perdió esos permisos en
  // seguridad/36-cerrar-escritura-staff.sql. Se guarda aparte de la sesión, en
  // sessionStorage, y caduca a las 12 horas en la propia base.
  _guardarValeAdmin(user.vale);

  // BUILD 397 · Ya no se escribe `lastLogin` desde el navegador: lo hace la
  // propia `verify_staff_password` por dentro. Antes esto era un DB.patchStaff,
  // que ahora fallaría por falta de permisos.
  const now = new Date();
  const ts  = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // Guardar sesión (sin contraseña y sin el vale, que va en su propia clave)
  const { password: _pw, vale: _vale, ...safeUser } = { ...user, lastLogin: ts };
  setSession(safeUser);
  return { ok: true, user: safeUser };
}

function logout() {
  // BUILD 397 · Avisar a la base para que borre el vale. Si falla (sin red),
  // da igual: caduca solo a las 12 horas y aquí se borra igualmente.
  const vale = _valeAdmin();
  if (vale) {
    try {
      fetch(`${_SB_URL}/rpc/admin_cerrar_sesion`, {
        method:  'POST',
        headers: _SB_HEADERS,
        body:    JSON.stringify({ p_vale: vale }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignorado */ }
  }
  _borrarValeAdmin();
  clearSession();
  window.location.href = 'login.html';
}

// ─── Guard: redirigir si no hay sesión (admin) ───────────────────────────────
function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTENTICACIÓN DE CLIENTES (tienda pública)
// ═══════════════════════════════════════════════════════════════════════════════

function getClientSession() {
  try { return JSON.parse(localStorage.getItem('cm_client_session') || sessionStorage.getItem('cm_client_session') || 'null'); }
  catch { return null; }
}

function setClientSession(client) {
  localStorage.setItem('cm_client_session', JSON.stringify(client));
  sessionStorage.setItem('cm_client_session', JSON.stringify(client));
}

function clearClientSession() {
  localStorage.removeItem('cm_client_session');
  sessionStorage.removeItem('cm_client_session');
}

/* BUILD 421 · Al salir se invalida el vale TAMBIÉN EN LA BASE. Ver el comentario
 * gemelo en js/auth.v33.js. Sin esto el vale seguiría vivo 12 horas después de
 * que el cliente creyera haber cerrado la sesión. */
async function logoutCliente() {
  try {
    if (typeof DB !== 'undefined' && DB && typeof DB.cerrarSesionCliente === 'function') {
      await Promise.race([
        DB.cerrarSesionCliente(),
        new Promise(r => setTimeout(r, 2500)),
      ]);
    } else if (typeof _borrarValeCliente === 'function') {
      _borrarValeCliente();
    }
  } catch (e) { /* salir nunca debe fallar */ }
  clearClientSession();
  window.location.href = 'login-cliente.html';
}

/* Guard para la tienda: redirige a login si no hay sesión de cliente.
 *
 * 🔴 BUILD 421 · SE COMPRUEBA TAMBIÉN EL VALE, Y HAY UN MOTIVO CONCRETO.
 *
 * Este fichero y `auth.v33.js` NO guardan la sesión en el mismo sitio, y eso
 * crea un desajuste que habría dado un fallo dificilísimo de diagnosticar:
 *
 *   auth.v33.js  (login-cliente.html) → sessionStorage
 *   auth.js      (index.html, aquí)   → localStorage **Y** sessionStorage
 *
 * El vale vive en `sessionStorage` a propósito (no debe sobrevivir al cierre de
 * la pestaña en un navegador compartido). Pero la sesión SÍ sobrevive, porque
 * `setClientSession` de este fichero la escribe en `localStorage`.
 *
 * Consecuencia: cierra la pestaña, vuelve a abrir la tienda al día siguiente
 * → PARECE que sigue dentro (su nombre, su carrito) pero NO TIENE VALE. Todo
 * lo que dependa del vale —los puntos, y mañana el canje— fallaría con
 * «tu sesión caducó» mientras la pantalla insiste en que está conectado.
 *
 * Se resuelve donde se detecta: si hay sesión pero no hay vale, la sesión no
 * sirve. Se limpia y se pide entrar otra vez. Molesta una vez; la alternativa
 * es una tienda que miente sobre su propio estado. */
function requireClientAuth() {
  const session = getClientSession();
  if (!session) {
    window.location.href = 'login-cliente.html';
    return null;
  }

  if (typeof _valeCliente === 'function' && !_valeCliente()) {
    console.warn('[auth] sesión de cliente sin vale (pestaña reabierta) — se pide entrar de nuevo.');
    clearClientSession();
    window.location.href = 'login-cliente.html';
    return null;
  }

  return session;
}

/* ─── Login del cliente ────────────────────────────────────────────────────────
 * BUILD 395 · Reescrito por el mismo motivo que login(): la contraseña ya no
 * se comprueba aquí, se pregunta a Supabase.
 *
 * Antes, `DB.getCustomers()` descargaba la lista de clientes CON sus
 * contraseñas y la comparación se hacía en el navegador. Si la red fallaba,
 * caía en `_getDefaultClients()`: 5 fichas con contraseñas en claro.
 *
 * Ahora hay una sola vía y sin respaldo. La función SQL comprueba también
 * `deleted = false` y `access = true` — antes NINGUNA de las dos se miraba, así
 * que un cliente borrado o deshabilitado desde el panel seguía entrando.
 * ─────────────────────────────────────────────────────────────────────────── */
async function loginCliente(email, password) {
  const correo = (email || '').trim();
  const clave  = (password || '').trim();
  if (!correo || !clave) {
    return { ok: false, msg: 'Escribe tu correo y tu contraseña.' };
  }

  let client = null;
  try {
    const res = await fetch(`${_SB_URL}/rpc/verify_customer_password`, {
      method:  'POST',
      headers: _SB_HEADERS,
      body:    JSON.stringify({ p_email: correo, p_password: clave })
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const rows = await res.json();
    client = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    console.warn('[auth] no se pudo verificar la contraseña del cliente:', e && e.message);
    return { ok: false, msg: 'No se pudo conectar para verificar tu acceso. Revisa tu conexión e inténtalo de nuevo.' };
  }

  // Un solo mensaje para «no existe», «clave incorrecta», «borrado» y
  // «deshabilitado»: decirle a un desconocido cuál de los cuatro es le confirma
  // qué correos están registrados en la tienda.
  if (!client || !client.id) {
    return { ok: false, msg: 'Correo o contraseña incorrectos. Si no tienes acceso, contacta al supermercado.' };
  }

  /* 🔴 BUILD 421b · GUARDAR EL VALE QUE LA BASE ACABA DE EMITIR.
   *
   * Faltaba en este fichero. `auth.v33.js` sí lo hacía (línea 306) porque es
   * donde vive el formulario de `login-cliente.html`, y por eso el hueco no se
   * veía: hoy nadie entra por aquí. Pero `requireClientAuth` de ESTE fichero
   * EXIGE el vale desde el 421 — así que si algún día un formulario llamara a
   * este `loginCliente`, el cliente entraría sin vale y el guard lo echaría
   * inmediatamente a `login-cliente.html`, en un bucle: entra, se le expulsa,
   * entra otra vez. Un fallo de los que no se diagnostican en cinco minutos. */
  if (typeof _guardarValeCliente === 'function' && client.vale) {
    _guardarValeCliente(client.vale);
  }

  /* Registrar último acceso.
   * 🔴 BUILD 421b · A la base el NÚMERO (la columna es BIGINT), a la sesión el
   * texto legible. Ver el comentario gemelo en js/auth.v33.js. */
  const now = new Date();
  const ts  = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  try {
    await DB.patchCustomer(client.id, { lastLogin: Date.now() });
  } catch(e) { /* no crítico */ }

  /* Guardar sesión SIN contraseña Y SIN VALE.
   *
   * 🔴 BUILD 421b · EL `vale` SE SACA AQUÍ, Y NO ES UN DETALLE.
   *
   * Este fichero guarda la sesión con `setClientSession`, que la escribe en
   * **localStorage además de sessionStorage** (línea 191). El vale vive en
   * `sessionStorage` A PROPÓSITO: no debe sobrevivir al cierre de la pestaña en
   * un navegador compartido. Si se colara dentro del objeto de sesión,
   * terminaría COPIADO EN localStorage y sobreviviría días — justo lo que el
   * vale existe para evitar.
   *
   * Y peor: `app.js` y `location.js` vuelven a llamar a `setClientSession(...)`
   * con el objeto de sesión, así que el vale se reescribiría solo en cada
   * actualización de perfil, y bastaría un descuido para acabar mandándolo a la
   * base dentro de un PATCH.
   *
   * Su gemela de `auth.v33.js` (línea 319) ya lo sacaba; esta se había quedado
   * atrás. Lo encontró la prueba 15 del arnés del 421b, no una lectura: la
   * prueba ejecuta el `loginCliente` real y mira QUÉ CLAVES tiene la sesión
   * resultante. */
  const { password: _pw, vale: _vale, ...safeClient } = { ...client, lastLogin: ts };
  setClientSession(safeClient);
  return { ok: true, client: safeClient };
}

/* BUILD 395 · _getDefaultClients() BORRADO.
 *
 * Eran 5 fichas de cliente con contraseñas escritas en claro
 * ('Ana2024!', 'Carlos2024!'…) en un fichero que sirve la web a cualquiera.
 * Solo se usaban como respaldo de loginCliente() cuando fallaba la red — es
 * decir, justo cuando más peligroso era dejar entrar a alguien.
 *
 * Ahora no hay respaldo: si no se puede verificar contra la base de datos,
 * no se entra. */

// ─── Aplicar permisos en el DOM ──────────────────────────────────────────────
function applyPermissions(session) {
  const role = getRole(session.role);

  // Mostrar/ocultar ítems del sidebar según secciones permitidas
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    const sec = link.getAttribute('data-section');
    link.closest('li').style.display = role.sections.includes(sec) ? '' : 'none';
  });

  // Ocultar secciones de contenido no permitidas
  document.querySelectorAll('.section-content').forEach(sec => {
    const id = sec.id.replace('sec-','');
    if (!role.sections.includes(id)) sec.style.display = 'none';
  });

  // Botón "Nuevo producto" en header de productos
  const btnNewProd = document.querySelector('#sec-products .btn-primary');
  if (btnNewProd && !role.canCreateProducts) btnNewProd.style.display = 'none';

  // Botón "Nuevo empleado" solo para quien puede gestionar personal
  const btnNewStaff = document.getElementById('btnNewStaff');
  if (btnNewStaff && !role.canManageStaff) btnNewStaff.style.display = 'none';

  // Campos de precio: deshabilitar si no puede cambiar precios
  if (!role.canEditPrices) {
    document.querySelectorAll('#pPrice, #pOriginalPrice').forEach(el => {
      el.disabled = true;
      el.style.background = '#f5f5f5';
      el.title = 'No tienes permiso para cambiar precios';
    });
  }

  // Badge de rol en topbar
  const roleEl = document.getElementById('topbarRole');
  if (roleEl) {
    roleEl.textContent      = role.label;
    roleEl.style.background = role.color + '22';
    roleEl.style.color      = role.color;
    roleEl.style.border     = '1px solid ' + role.color + '44';
  }

  // Nombre de usuario en topbar
  const nameEl = document.getElementById('topbarUserName');
  if (nameEl) nameEl.textContent = session.firstName + ' ' + session.lastName;

  // Avatar en topbar
  const avatarEl = document.getElementById('topbarAvatar');
  if (avatarEl) {
    const initials = (session.firstName[0] + session.lastName[0]).toUpperCase();
    avatarEl.textContent      = initials;
    avatarEl.style.background = role.color;
  }
}
