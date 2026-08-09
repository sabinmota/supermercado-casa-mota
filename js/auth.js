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

  // Actualizar último login en la API
  const now = new Date();
  const ts  = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  try {
    await DB.patchStaff(user.id, { lastLogin: ts });
  } catch(e) { /* no crítico */ }

  // Guardar sesión (sin contraseña)
  const { password: _pw, ...safeUser } = { ...user, lastLogin: ts };
  setSession(safeUser);
  return { ok: true, user: safeUser };
}

function logout() {
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

function logoutCliente() {
  clearClientSession();
  window.location.href = 'login-cliente.html';
}

// Guard para la tienda: redirige a login si no hay sesión de cliente
function requireClientAuth() {
  const session = getClientSession();
  if (!session) {
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

  // Registrar último acceso en la API
  const now = new Date();
  const ts  = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  try {
    await DB.patchCustomer(client.id, { lastLogin: ts });
  } catch(e) { /* no crítico */ }

  // Guardar sesión SIN contraseña
  const { password: _pw, ...safeClient } = { ...client, lastLogin: ts };
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
