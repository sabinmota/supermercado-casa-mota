/* ═══════════════════════════════════════════════════════════════════════════
   523 · MAYORISTAS EN EL PANEL  (seguridad/99-100)
   ───────────────────────────────────────────────────────────────────────────
   · Pantalla «Mayoristas»: lista, aprobar / rechazar, alta (queda aprobado)
     y nueva contraseña cuando la olvidan.
   · «Pedido al por mayor»: el vendedor toma el pedido en nombre de un
     mayorista aprobado. La BASE pone precios, envío y total y los compara con
     lo que se ve aquí; si no coinciden, lo rechaza y esta pantalla se
     actualiza sola. No descuenta inventario.
   Depende de admin.v33.js (adminProducts, orders, showAdminToast, fmt$,
   _escAdm, _admBuscar, renderOrdersTable) y de api.js (DB.*).
   ═══════════════════════════════════════════════════════════════════════════ */

let mayoristas = [];
let _myrCargando = false;

const _MYR_EST = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };

function _myrTel(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(t || '');
}
function _myrFecha(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Lista ───────────────────────────────────────────────────────────────────
async function loadMayoristas() {
  const tb = document.getElementById('myrTbody');
  if (!tb || _myrCargando) return;
  _myrCargando = true;
  if (!mayoristas.length) tb.innerHTML = '<tr><td colspan="6" class="myr-vacio">Cargando…</td></tr>';
  try {
    mayoristas = (await DB.leerMayoristas()) || [];
    renderMayoristas();
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6" class="myr-vacio">⚠️ ${_escAdm(e.message || 'No se pudo cargar la lista')}</td></tr>`;
  } finally {
    _myrCargando = false;
  }
}

function renderMayoristas() {
  const tb = document.getElementById('myrTbody');
  if (!tb) return;
  const q   = document.getElementById('myrSearch')?.value || '';
  const est = document.getElementById('myrEstadoFilter')?.value || '';
  const lista = mayoristas.filter(m =>
    (!est || m.estado === est) && _admBuscar(q, m.nombre, m.telefono, _myrTel(m.telefono)));

  const pend = mayoristas.filter(m => m.estado === 'pendiente').length;
  const chip = document.getElementById('myrPendientes');
  if (chip) { chip.textContent = pend ? `${pend} pendiente${pend !== 1 ? 's' : ''} de aprobar` : ''; chip.hidden = !pend; }
  const cnt = document.getElementById('myrCount');
  if (cnt) cnt.textContent = lista.length ? `${lista.length} mayorista${lista.length !== 1 ? 's' : ''}` : 'Sin resultados';

  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="6" class="myr-vacio">${mayoristas.length
      ? 'Ningún mayorista coincide con la búsqueda.'
      : 'Todavía no hay mayoristas. Se registran en <b>supermercadocasamota.com/mayor</b> o los das de alta con «Nuevo mayorista».'}</td></tr>`;
    return;
  }

  tb.innerHTML = lista.map(m => {
    const id = String(m.id);
    let acciones = '';
    if (m.estado === 'pendiente') {
      acciones = `
        <button class="btn-myr btn-myr--ok" onclick="mayoristaCambiarEstado('${id}','aprobado')"><i class="fas fa-check"></i> Aprobar</button>
        <button class="action-btn action-btn-del" onclick="mayoristaCambiarEstado('${id}','rechazado')" title="Rechazar"><i class="fas fa-xmark"></i></button>`;
    } else if (m.estado === 'aprobado') {
      acciones = `
        <button class="action-btn action-btn-view" onclick="openPedidoMayorModal('${id}')" title="Tomar pedido"><i class="fas fa-cart-plus"></i></button>
        <button class="action-btn" onclick="mayoristaNuevaClave('${id}')" title="Nueva contraseña"><i class="fas fa-key"></i></button>
        <button class="action-btn action-btn-del" onclick="mayoristaCambiarEstado('${id}','rechazado')" title="Desactivar"><i class="fas fa-ban"></i></button>`;
    } else {
      acciones = `<button class="btn-myr" onclick="mayoristaCambiarEstado('${id}','aprobado')"><i class="fas fa-rotate-left"></i> Reactivar</button>`;
    }
    return `
      <tr>
        <td><strong>${_escAdm(m.nombre)}</strong></td>
        <td><a href="tel:${_escAdm(m.telefono)}">${_escAdm(_myrTel(m.telefono))}</a></td>
        <td><span class="myr-est myr-est--${_escAdm(m.estado)}">${_MYR_EST[m.estado] || _escAdm(m.estado)}</span></td>
        <td>${_myrFecha(m.creado)}</td>
        <td>${Number(m.pedidos) || 0}</td>
        <td><div class="action-btns">${acciones}</div></td>
      </tr>`;
  }).join('');
}

async function mayoristaCambiarEstado(id, estado) {
  const m = mayoristas.find(x => String(x.id) === String(id));
  if (!m) return;
  if (estado === 'rechazado' &&
      !confirm(`¿${m.estado === 'aprobado' ? 'Desactivar' : 'Rechazar'} a «${m.nombre}»?\n\nNo podrá entrar ni hacer pedidos al por mayor.`)) return;
  try {
    await DB.mayoristaEstado(id, estado);
    m.estado = estado;
    renderMayoristas();
    showAdminToast(estado === 'aprobado'
      ? `✅ ${m.nombre} aprobado: ya ve los precios y puede pedir.`
      : `${m.nombre} ya no puede comprar al por mayor.`, estado === 'aprobado' ? 'success' : 'info');
  } catch (e) {
    showAdminToast(e.message || 'No se pudo cambiar el estado', 'error');
  }
}

async function mayoristaNuevaClave(id) {
  const m = mayoristas.find(x => String(x.id) === String(id));
  if (!m) return;
  const clave = prompt(`Nueva contraseña para «${m.nombre}» (mínimo 6 caracteres).\nDíctasela por teléfono; se cerrarán sus sesiones abiertas.`);
  if (clave === null) return;
  if (clave.trim().length < 6) { showAdminToast('La contraseña debe tener al menos 6 caracteres.', 'warning'); return; }
  try {
    await DB.mayoristaClave(id, clave.trim());
    showAdminToast(`🔑 Contraseña cambiada para ${m.nombre}.`, 'success');
  } catch (e) {
    showAdminToast(e.message || 'No se pudo cambiar la contraseña', 'error');
  }
}

// ─── Alta desde el panel ─────────────────────────────────────────────────────
function openMayoristaModal() {
  ['myrNombre', 'myrTelefono', 'myrClave'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  document.getElementById('myrModalBackdrop').classList.remove('hidden');
  setTimeout(() => document.getElementById('myrNombre')?.focus(), 50);
}
function closeMayoristaModal() {
  document.getElementById('myrModalBackdrop').classList.add('hidden');
}
let _myrGuardando = false;
async function saveMayorista() {
  if (_myrGuardando) return;
  const nombre = document.getElementById('myrNombre').value.trim();
  const tel    = document.getElementById('myrTelefono').value.trim();
  const clave  = document.getElementById('myrClave').value.trim();
  if (nombre.length < 2) { showAdminToast('Escribe el nombre o el negocio.', 'warning'); return; }
  if (!/^1?\d{10}$/.test(tel.replace(/\D/g, ''))) { showAdminToast('El teléfono debe tener 10 números.', 'warning'); return; }
  if (clave.length < 6) { showAdminToast('La contraseña debe tener al menos 6 caracteres.', 'warning'); return; }
  _myrGuardando = true;
  const btn = document.getElementById('myrSaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  try {
    await DB.mayoristaCrear(nombre, tel, clave);
    closeMayoristaModal();
    showAdminToast(`✅ ${nombre} dado de alta y aprobado. Entra en /mayor con su teléfono y esa contraseña.`, 'success');
    await loadMayoristas();
  } catch (e) {
    showAdminToast(e.message || 'No se pudo dar de alta', 'error');
  } finally {
    _myrGuardando = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar'; }
  }
}

// ─── Pedido al por mayor (lo toma el vendedor) ───────────────────────────────
let _mpLineas = {};          // idProducto → cantidad
let _mpEnvio  = null;        // { tarifa, minimo_gratis }
let _mpGuardando = false;

const _mpCents = n => Math.round((Number(n) || 0) * 100);

function _mpProductos() {
  return (typeof adminProducts !== 'undefined' ? adminProducts : []).filter(p =>
    p && !p.deleted && p.mayor && p.mayor.activo && Number(p.mayor.precio) > 0 && p.mayor.unidad);
}
function _mpProd(id) { return _mpProductos().find(p => String(p.id) === String(id)); }

async function openPedidoMayorModal(preId) {
  _mpLineas = {};
  const bd = document.getElementById('myrPedBackdrop');
  bd.classList.remove('hidden');
  document.getElementById('mpError').hidden = true;
  ['mpBuscar', 'mpDireccion', 'mpNotas'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  document.getElementById('mpCiudad').value = 'Hato Mayor';
  document.querySelector('input[name="mpEntrega"][value="domicilio"]').checked = true;
  document.getElementById('mpResultados').innerHTML = '';
  _mpRenderLineas();

  const sel = document.getElementById('mpMayorista');
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const tareas = [DB.mayorEnvio().then(r => { _mpEnvio = r; }).catch(() => { _mpEnvio = null; })];
    if (!mayoristas.length) tareas.push(DB.leerMayoristas().then(l => { mayoristas = l || []; }));
    if (!_mpProductos().length && typeof DB.getProducts === 'function') {
      tareas.push(DB.getProducts({ full: true }).then(l => { if (l && l.length) adminProducts = l; }));
    }
    await Promise.all(tareas);
  } catch (e) {
    showAdminToast(e.message || 'No se pudieron cargar los datos', 'error');
  }

  const aprobados = mayoristas.filter(m => m.estado === 'aprobado')
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  sel.innerHTML = '<option value="">— Selecciona un mayorista —</option>' +
    aprobados.map(m => `<option value="${_escAdm(m.id)}">${_escAdm(m.nombre)} · ${_escAdm(_myrTel(m.telefono))}</option>`).join('');
  if (preId) sel.value = String(preId);

  const nProd = _mpProductos().length;
  document.getElementById('mpAvisoProductos').hidden = nProd > 0;
  if (!aprobados.length) _mpError('No hay mayoristas aprobados. Apruébalos en la lista o da uno de alta.');
  if (!_mpEnvio) _mpError('No se pudo leer la tarifa de envío. Puedes tomar pedidos con «Recoger en el almacén».');
  _mpTotales();
  setTimeout(() => document.getElementById(preId ? 'mpBuscar' : 'mpMayorista')?.focus(), 60);
}

function closePedidoMayorModal() {
  document.getElementById('myrPedBackdrop').classList.add('hidden');
  _mpLineas = {};
}

function _mpError(msg) {
  const e = document.getElementById('mpError');
  e.textContent = msg || '';
  e.hidden = !msg;
}

function mpBuscar() {
  const q   = document.getElementById('mpBuscar').value;
  const box = document.getElementById('mpResultados');
  if (!q.trim()) { box.innerHTML = ''; return; }
  const res = _mpProductos().filter(p => _admBuscar(q, p.name, p.barcode, p.barcode_alt)).slice(0, 8);
  box.innerHTML = res.length
    ? res.map(p => `
        <button type="button" class="mp-res" onclick="mpAgregar('${_escAdm(p.id)}')">
          <span><b>${_escAdm(p.name)}</b><small>${_escAdm(p.mayor.unidad)}</small></span>
          <span class="mp-res__precio">RD$ ${fmt$(p.mayor.precio)}</span>
        </button>`).join('')
    : '<div class="mp-res-vacio">Ningún producto al por mayor coincide. Actívalo en Productos → «Al por mayor».</div>';
}

function mpAgregar(id) {
  if (!_mpProd(id)) return;
  _mpLineas[id] = (_mpLineas[id] || 0) + 1;
  document.getElementById('mpBuscar').value = '';
  document.getElementById('mpResultados').innerHTML = '';
  _mpRenderLineas();
  document.getElementById('mpBuscar').focus();
}

function mpCantidad(id, valor, delta) {
  let n = delta != null ? (_mpLineas[id] || 0) + delta : Math.floor(Number(valor) || 0);
  n = Math.max(0, Math.min(100000, n));
  if (n) _mpLineas[id] = n; else delete _mpLineas[id];
  _mpRenderLineas();
}

function _mpRenderLineas() {
  const box = document.getElementById('mpLineas');
  const ids = Object.keys(_mpLineas).filter(id => _mpProd(id));
  if (!ids.length) {
    box.innerHTML = '<div class="mp-vacio"><i class="fas fa-boxes-stacked"></i> Busca y añade productos al por mayor.</div>';
  } else {
    box.innerHTML = ids.map(id => {
      const p = _mpProd(id), c = _mpLineas[id];
      return `
        <div class="no-prod-line">
          <div class="no-prod-select"><b>${_escAdm(p.name)}</b>
            <div style="font-size:.76rem;color:#888">${_escAdm(p.mayor.unidad)} · RD$ ${fmt$(p.mayor.precio)}</div></div>
          <div class="no-qty-ctrl">
            <button type="button" class="no-qty-btn" onclick="mpCantidad('${_escAdm(id)}',null,-1)"><i class="fas fa-minus"></i></button>
            <input class="no-qty-input" type="number" min="0" step="1" value="${c}" onchange="mpCantidad('${_escAdm(id)}',this.value)">
            <button type="button" class="no-qty-btn" onclick="mpCantidad('${_escAdm(id)}',null,1)"><i class="fas fa-plus"></i></button>
          </div>
          <div class="no-prod-subtotal">RD$ ${fmt$(_mpCents(p.mayor.precio) * c / 100)}</div>
          <button type="button" class="no-del-line-btn" onclick="mpCantidad('${_escAdm(id)}',0)" title="Quitar"><i class="fas fa-trash"></i></button>
        </div>`;
    }).join('');
  }
  _mpTotales();
}

function _mpCalcular() {
  let sub = 0, items = 0;
  Object.keys(_mpLineas).forEach(id => {
    const p = _mpProd(id); if (!p) return;
    sub += _mpCents(p.mayor.precio) * _mpLineas[id];
    items += _mpLineas[id];
  });
  const dom = (document.querySelector('input[name="mpEntrega"]:checked') || {}).value !== 'recogida';
  let env = 0;
  if (dom && sub > 0 && _mpEnvio) env = sub >= _mpCents(_mpEnvio.minimo_gratis) ? 0 : _mpCents(_mpEnvio.tarifa);
  return { sub: sub / 100, env: env / 100, tot: (sub + env) / 100, items, domicilio: dom };
}

function _mpTotales() {
  const t = _mpCalcular();
  document.getElementById('mpDireccionBox').hidden = !t.domicilio;
  document.getElementById('mpSub').textContent = `RD$ ${fmt$(t.sub)}`;
  document.getElementById('mpEnv').textContent = !t.domicilio ? 'No aplica' : (!_mpEnvio ? '—' : (t.env ? `RD$ ${fmt$(t.env)}` : 'Gratis'));
  document.getElementById('mpTot').textContent = `RD$ ${fmt$(t.tot)}`;
}

async function savePedidoMayor() {
  if (_mpGuardando) return;
  _mpError('');
  const mid = document.getElementById('mpMayorista').value;
  const t   = _mpCalcular();
  const dir = document.getElementById('mpDireccion').value.trim();
  if (!mid)      { _mpError('Selecciona el mayorista.'); return; }
  if (!t.items)  { _mpError('Añade al menos un producto.'); return; }
  if (t.domicilio && !_mpEnvio) { _mpError('Sin la tarifa de envío no se puede calcular la entrega. Elige «Recoger en el almacén» o vuelve a abrir esta ventana.'); return; }
  if (t.domicilio && dir.length < 5) { _mpError('Escribe la dirección de entrega.'); document.getElementById('mpDireccion').focus(); return; }

  const lineas = Object.keys(_mpLineas).filter(id => _mpProd(id)).map(id => ({
    productId: id, cantidad: _mpLineas[id], price: Number(_mpProd(id).mayor.precio),
  }));
  _mpGuardando = true;
  const btn = document.getElementById('mpSaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }
  try {
    const o = await DB.crearPedidoMayor(mid, {
      entrega: t.domicilio ? 'domicilio' : 'recogida',
      address: t.domicilio ? dir : '',
      city:    t.domicilio ? document.getElementById('mpCiudad').value.trim() : '',
      notes:   document.getElementById('mpNotas').value.trim(),
      total:   t.tot,
      productLines: lineas,
    });
    const m = mayoristas.find(x => String(x.id) === String(mid));
    if (m) m.pedidos = (Number(m.pedidos) || 0) + 1;
    if (o && typeof orders !== 'undefined' && Array.isArray(orders)) orders.unshift(o);
    if (typeof DBCached !== 'undefined' && DBCached.invalidateOrders) DBCached.invalidateOrders();
    closePedidoMayorModal();
    if (document.getElementById('sec-orders')?.classList.contains('active') && typeof renderOrdersTable === 'function') renderOrdersTable();
    if (document.getElementById('sec-mayoristas')?.classList.contains('active')) renderMayoristas();
    const num = o && o.order_number != null ? ` #${o.order_number}` : '';
    showAdminToast(`✅ Pedido al por mayor${num} creado para ${m ? m.nombre : 'el mayorista'}`, 'success');
  } catch (e) {
    const msg = e?.message || 'No se pudo crear el pedido';
    const E = typeof _ERRORES_ORDER !== 'undefined' ? _ERRORES_ORDER : {};
    const recargar = msg.startsWith(E.PRECIO_CAMBIO || '§') || msg === E.TOTAL_CAMBIO || msg === E.PRODUCTO_NO_DISPONIBLE;
    if (recargar) {
      // La base tiene otros precios o tarifa: se recargan y se repinta.
      try {
        const [lista, env] = await Promise.all([DB.getProducts({ full: true }), DB.mayorEnvio().catch(() => _mpEnvio)]);
        if (lista && lista.length) adminProducts = lista;
        _mpEnvio = env;
      } catch (_) { /* se muestra igualmente el aviso */ }
      _mpRenderLineas();
      _mpError(msg.replace(/ Vuelve a abrir «Nuevo pedido»\./, '') + ' Ya actualicé los precios: revisa el total y confirma de nuevo.');
    } else {
      _mpError(msg);
    }
  } finally {
    _mpGuardando = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirmar pedido'; }
  }
}
