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

// ─── Personal demo inicial (Super Admin por defecto) ────────────────────────
const DEFAULT_STAFF = [
  {
    id:        'staff_1',
    firstName: 'Carlos',
    lastName:  'Mota',
    email:     'admin@casamota.com.do',
    password:  'Admin2024!',
    phone:     '(809) 555-0001',
    cedula:    '001-0000001-1',
    role:      'superadmin',
    cargo:     'Gerente General',
    status:    'activo',
    avatar:    '',
    createdAt: '01/01/2026',
    lastLogin: null,
    notes:     'Cuenta principal del sistema.',
  },
  {
    id:        'staff_2',
    firstName: 'Ana',
    lastName:  'Ramirez',
    email:     'ana.ramirez@casamota.com.do',
    password:  'Ana2024!',
    phone:     '(809) 555-0002',
    cedula:    '001-0000002-2',
    role:      'admin',
    cargo:     'Administradora de Tienda',
    status:    'activo',
    avatar:    '',
    createdAt: '15/01/2026',
    lastLogin: null,
    notes:     '',
  },
  {
    id:        'staff_3',
    firstName: 'Pedro',
    lastName:  'Sanchez',
    email:     'pedro.sanchez@casamota.com.do',
    password:  'Pedro2024!',
    phone:     '(809) 555-0003',
    cedula:    '001-0000003-3',
    role:      'operador',
    cargo:     'Cajero',
    status:    'activo',
    avatar:    '',
    createdAt: '20/01/2026',
    lastLogin: null,
    notes:     '',
  },
  {
    id:        'staff_4',
    firstName: 'Maria',
    lastName:  'Fernandez',
    email:     'maria.fernandez@casamota.com.do',
    password:  'Maria2024!',
    phone:     '(809) 555-0004',
    cedula:    '001-0000004-4',
    role:      'operador',
    cargo:     'Encargada de Inventario',
    status:    'activo',
    avatar:    '',
    createdAt: '01/02/2026',
    lastLogin: null,
    notes:     '',
  },
];

// ─── Helpers de sesión ───────────────────────────────────────────────────────
// Obtener staff desde la API (asíncrono)
async function getStaffList() {
  try {
    return await DB.getStaff();
  } catch(e) {
    console.warn('getStaffList API error, usando defaults:', e);
    return DEFAULT_STAFF;
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
async function login(email, password) {
  let list;
  try {
    list = await DB.getStaff();
  } catch(e) {
    list = DEFAULT_STAFF;
  }

  const user = list.find(s => s.email.toLowerCase() === email.toLowerCase().trim() && s.password === password);
  if (!user)  return { ok: false, msg: 'Correo o contraseña incorrectos.' };
  if (user.status !== 'activo') return { ok: false, msg: 'Tu cuenta está inactiva. Contacta al administrador.' };

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

// Login del cliente usando la API
async function loginCliente(email, password) {
  let list;
  try {
    list = await DB.getCustomers();
  } catch(e) {
    list = _getDefaultClients();
  }

  // Primero buscar por email para dar mensajes específicos
  const byEmail = list.find(c => c.email.toLowerCase() === email.toLowerCase().trim());

  if (!byEmail) {
    return { ok: false, msg: 'No existe una cuenta con ese correo. Contacta al supermercado para crear tu acceso.' };
  }
  if (!byEmail.password) {
    return { ok: false, msg: 'Tu cuenta no tiene contraseña asignada. Contacta al supermercado para activar tu acceso a la tienda.' };
  }
  if (byEmail.password !== password) {
    return { ok: false, msg: 'Contraseña incorrecta. Verifica e intenta de nuevo.' };
  }
  if (byEmail.status === 'inactivo') {
    return { ok: false, msg: 'Tu cuenta está inactiva. Contacta al supermercado.' };
  }

  const client = { ...byEmail };

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

// Clientes demo con contraseña para pruebas
// IMPORTANTE: estos IDs (demo_1..demo_5) deben coincidir con generateDemoCustomers() en admin.js
function _getDefaultClients() {
  return [
    { id:'demo_1', name:'Ana Garcia',     email:'ana.garcia@gmail.com',      password:'Ana2024!',    phone:'(809) 234-5678', city:'Santo Domingo', address:'Av. Churchill #35',      status:'vip',    orders:8,  spent:34200, lastOrder:'28/03/2026', cedula:'', notes:'', createdAt:'01/01/2026' },
    { id:'demo_2', name:'Carlos Mota',    email:'carlos.mota@gmail.com',     password:'Carlos2024!', phone:'(809) 312-4567', city:'Santiago',      address:'Calle El Conde #12',     status:'activo', orders:5,  spent:18500, lastOrder:'25/03/2026', cedula:'', notes:'', createdAt:'01/01/2026' },
    { id:'demo_3', name:'Maria Perez',    email:'maria.perez@gmail.com',     password:'Maria2024!',  phone:'(809) 456-7890', city:'Santo Domingo', address:'C/ Las Mercedes #88',    status:'vip',    orders:12, spent:52000, lastOrder:'30/03/2026', cedula:'', notes:'', createdAt:'01/01/2026' },
    { id:'demo_4', name:'Luis Rodriguez', email:'luis.rodriguez@gmail.com',  password:'Luis2024!',   phone:'(809) 567-8901', city:'La Romana',     address:'Av. Independencia #210', status:'activo', orders:3,  spent:9800,  lastOrder:'20/03/2026', cedula:'', notes:'', createdAt:'01/01/2026' },
    { id:'demo_5', name:'Carmen Diaz',    email:'carmen.diaz@gmail.com',     password:'Carmen2024!', phone:'(809) 678-9012', city:'Santo Domingo', address:'C/ Jose Reyes #5',       status:'activo', orders:7,  spent:27500, lastOrder:'27/03/2026', cedula:'', notes:'', createdAt:'01/01/2026' },
  ];
}

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
