/* ════════════════════════════════════════════════════════════════════════════
 * 553e · «REFERENCIA DEL PROVEEDOR» EN LA FICHA DEL PRODUCTO (seguridad/113)
 *
 * Pedido del dueño (20-nov): cada proveedor pone su propio código a cada
 * producto. Ese código se guarda en la ficha del producto y sirve para:
 *   · BUSCAR el producto en el catálogo del panel (Productos, Inventario y los
 *     buscadores de Recepción de mercancía);
 *   · EMPAREJAR las líneas de la factura en Recepción (js/conta.js), que ya no
 *     empareja por la descripción.
 * Una referencia POR PROVEEDOR (un producto puede tener varias). Un mismo
 * proveedor no puede repetir una referencia en dos productos. Mayúsculas y
 * espacios no cuentan («rc 889» = «RC889»), igual que `ref_norm` en la base.
 *
 * · Formulario: bloque #pRefsBox (filas proveedor + referencia). Solo lo ven
 *   Super Admin y Administrador (mismo permiso que Contabilidad; la base lo
 *   vuelve a comprobar en conta_guardar_referencias).
 * · Guardado: DESPUÉS de que el producto se guarde bien y solo si cambió. Si
 *   falla, el producto YA está guardado: se avisa y no se relanza el error.
 * · Búsqueda: cada producto recibe `refs_txt` (sus referencias en texto); los
 *   buscadores de admin.v33.js y conta.js lo incluyen.
 *
 * 🔴 Mismo patrón que js/solo-caja.js (491): se envuelven openProductModal,
 *    saveProduct, DB.saveProduct y DB.getProducts. Se carga DESPUÉS de
 *    solo-caja.js: cada capa envuelve a la anterior y todas siguen funcionando.
 * Expone window.CasaMotaRefs = { cargar, productoDe, refsDe, ... } para conta.js.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function aviso(txt, tipo) {
    if (typeof showAdminToast === 'function') { showAdminToast(String(txt), tipo); }
    else { window.alert(txt); }
  }
  function vale() { try { return (typeof _valeAdmin === 'function') ? _valeAdmin() : ''; } catch (e) { return ''; } }
  /* Igual que ref_norm de la base: sin espacios y en mayúsculas. */
  function norm(r) { return String(r || '').trim().replace(/\s+/g, '').toUpperCase(); }

  function permitido() {
    try {
      var s = (typeof getSession === 'function') ? getSession() : null;
      return !!(s && typeof getRole === 'function' && getRole(s.role).sections.indexOf('contabilidad') >= 0);
    } catch (e) { return false; }
  }

  var MENSAJES = {
    SESION_INVALIDA: 'Su sesión no es válida. Vuelva a entrar al panel.',
    SESION_CADUCADA: 'Su sesión caducó. Vuelva a entrar al panel.',
    CUENTA_DESACTIVADA: 'Su cuenta ya no está activa.',
    SIN_PERMISO_CONTABILIDAD: 'Solo Super Admin y Administrador pueden cambiar las referencias del proveedor.',
    PRODUCTO_NO_EXISTE: 'El producto no se encontró.',
    PROVEEDOR_NO_EXISTE: 'Uno de los proveedores ya no existe. Recargue la página.',
    REFERENCIA_VACIA: 'Hay una referencia vacía.',
    REFERENCIA_DUPLICADA: 'Ha escrito dos veces la misma referencia del mismo proveedor.',
    DEMASIADAS_REFERENCIAS: 'Como máximo 20 referencias por producto.',
    DATOS_INVALIDOS: 'Los datos de las referencias no llegaron bien.'
  };

  function traducir(txt, status) {
    var msg = String(txt || '');
    try { var j = JSON.parse(msg); msg = j.message || msg; } catch (e) { /* texto plano */ }
    var rep = /REFERENCIA_REPETIDA\s+(.*)\|(.*)/.exec(msg);
    if (rep) { return 'La referencia «' + rep[1] + '» de ese proveedor ya está en «' + (rep[2] || 'otro producto') + '».'; }
    for (var k in MENSAJES) { if (msg.indexOf(k) >= 0) { return MENSAJES[k]; } }
    if (status === 404 || msg.indexOf('PGRST202') >= 0) { return 'Falta ejecutar seguridad/113-referencias-proveedor.sql en Supabase.'; }
    return 'La base respondió con un error (HTTP ' + status + ').';
  }

  async function rpc(fn, params, lista) {
    var v = vale();
    if (!v) { throw new Error(MENSAJES.SESION_CADUCADA); }
    var cuerpo = JSON.stringify(Object.assign({ p_vale: v }, params || {}));
    if (!lista) {
      var res = await fetch(_SB_URL + '/rpc/' + fn, { method: 'POST', headers: _SB_HEADERS, body: cuerpo });
      var t = await res.text();
      if (!res.ok) { throw new Error(traducir(t, res.status)); }
      return (!t || t === 'null') ? null : JSON.parse(t);
    }
    var todo = [], desde = 0;
    for (var vuelta = 0; vuelta < 200; vuelta++) {
      var r = await fetch(_SB_URL + '/rpc/' + fn + '?limit=1000&offset=' + desde,
        { method: 'POST', headers: _SB_HEADERS, body: cuerpo });
      var tx = await r.text();
      if (!r.ok) { throw new Error(traducir(tx, r.status)); }
      var filas = tx ? JSON.parse(tx) : [];
      if (!Array.isArray(filas) || !filas.length) { break; }
      todo = todo.concat(filas);
      if (filas.length < 1000) { break; }
      desde += filas.length;
    }
    return todo;
  }

  // ─── Datos ──────────────────────────────────────────────────────────────────
  var S = {
    cargado: false,
    porProd: {},     // producto_id → [{ proveedor_id, proveedor_nombre, referencia }]
    porClave: {},    // proveedor_id|REFNORM → producto_id
    prov: [],        // [{ id, nombre }]
    error: ''
  };
  var _cargando = null;

  function listaProductos() {
    try { return (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts)) ? adminProducts : []; }
    catch (e) { return []; }
  }
  function buscarProducto(id) {
    var l = listaProductos();
    for (var i = 0; i < l.length; i++) { if (String(l[i].id) === String(id)) { return l[i]; } }
    return null;
  }

  function indexar(filas) {
    S.porProd = {}; S.porClave = {};
    (filas || []).forEach(function (f) {
      if (!f || f.producto_id == null) { return; }
      var pid = String(f.producto_id);
      (S.porProd[pid] = S.porProd[pid] || []).push({
        proveedor_id: String(f.proveedor_id), proveedor_nombre: f.proveedor_nombre || '', referencia: f.referencia || ''
      });
      S.porClave[String(f.proveedor_id) + '|' + norm(f.referencia)] = pid;
    });
  }

  /* Pone `refs_txt` en cada producto para que los buscadores lo encuentren. */
  function aplicarAProductos(lista) {
    (lista || listaProductos()).forEach(function (p) {
      if (!p) { return; }
      var rs = S.porProd[String(p.id)] || [];
      p.refs_txt = rs.map(function (r) { return r.referencia; }).join(' ');
    });
  }

  function cargar(forzar) {
    if (!permitido() || !vale()) { return Promise.resolve(false); }
    if (S.cargado && !forzar) { return Promise.resolve(true); }
    if (_cargando) { return _cargando; }
    _cargando = Promise.all([
      rpc('conta_leer_referencias', {}, true),
      rpc('conta_leer_proveedores', {}, true)
    ]).then(function (r) {
      indexar(r[0]);
      S.prov = (r[1] || []).map(function (p) { return { id: String(p.id), nombre: p.nombre }; })
        .sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
      S.cargado = true; S.error = '';
      aplicarAProductos();
      return true;
    }).catch(function (e) {
      S.error = e.message || String(e);
      console.warn('[referencias del proveedor] no se pudieron leer:', S.error);
      return false;
    }).finally(function () { _cargando = null; });
    return _cargando;
  }

  function productoDe(provId, cod) {
    var n = norm(cod);
    if (!provId || !n) { return null; }
    return S.porClave[String(provId) + '|' + n] || null;
  }
  function refsDe(prodId) { return (S.porProd[String(prodId)] || []).slice(); }

  // ─── Formulario del producto ───────────────────────────────────────────────
  var _original = '[]';     // referencias al abrir (texto para comparar)
  var _abiertoPara = null;  // id del producto abierto (null = nuevo)
  var _tocado = false;      // el empleado ya cambió algo en el bloque
  var _pendiente = null;    // lista a guardar tras DB.saveProduct (null = nada)
  var _destino = null;      // id del producto, o NUEVO
  var NUEVO = '__nuevo__';

  function opcionesProv(sel) {
    var html = '<option value="">— Proveedor —</option>';
    var esta = false;
    S.prov.forEach(function (p) {
      if (p.id === sel) { esta = true; }
      html += '<option value="' + esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.nombre) + '</option>';
    });
    if (sel && !esta) { html += '<option value="' + esc(sel) + '" selected>(proveedor dado de baja)</option>'; }
    return html;
  }

  function fila(r) {
    return '<div class="ref-fila">' +
      '<select class="form-input ref-prov" aria-label="Proveedor">' + opcionesProv(r.proveedor_id || '') + '</select>' +
      '<input type="text" class="form-input ref-cod" maxlength="40" placeholder="Referencia (ej. RC-889)" autocomplete="off" spellcheck="false" value="' + esc(r.referencia || '') + '" aria-label="Referencia del proveedor" />' +
      '<button type="button" class="action-btn action-btn-del ref-quitar" title="Quitar esta referencia"><i class="fas fa-times"></i></button>' +
      '</div>';
  }

  function pintarFilas(lista) {
    var box = $('pRefsLista');
    if (!box) { return; }
    var l = (lista && lista.length) ? lista : [{ proveedor_id: '', referencia: '' }];
    box.innerHTML = l.map(fila).join('');
    var aviso1 = $('pRefsAviso');
    if (aviso1) {
      aviso1.hidden = !(S.error || !S.prov.length);
      aviso1.textContent = S.error
        ? 'No se pudieron leer las referencias: ' + S.error
        : 'Todavía no hay proveedores: créelos en Contabilidad → Proveedores.';
    }
  }

  /* Lee las filas del formulario. Devuelve { lista } o { error, foco }. */
  function leerFilas() {
    var filas = document.querySelectorAll('#pRefsLista .ref-fila');
    var lista = [], vistos = {};
    for (var i = 0; i < filas.length; i++) {
      var sel = filas[i].querySelector('.ref-prov');
      var inp = filas[i].querySelector('.ref-cod');
      var prov = sel.value, ref = inp.value.trim();
      if (!prov && !ref) { continue; }
      if (!prov) { return { error: 'Elija el proveedor de la referencia «' + ref + '».', foco: sel }; }
      if (!ref) { return { error: 'Escriba la referencia del proveedor elegido (o quite la fila).', foco: inp }; }
      var k = prov + '|' + norm(ref);
      if (vistos[k]) { return { error: MENSAJES.REFERENCIA_DUPLICADA, foco: inp }; }
      vistos[k] = true;
      var otro = S.porClave[k];
      if (otro && String(otro) !== String(_abiertoPara || '')) {
        var po = buscarProducto(otro);
        if (po) {
          return { error: 'La referencia «' + ref + '» de ese proveedor ya está en «' + (po.name || 'otro producto') + '».', foco: inp };
        }
      }
      lista.push({ proveedor_id: prov, referencia: ref });
    }
    return { lista: lista };
  }

  function firma(lista) {
    return JSON.stringify((lista || []).map(function (r) { return r.proveedor_id + '|' + norm(r.referencia); }).sort());
  }

  function alAbrir(id) {
    var box = $('pRefsBox');
    if (!box) { return; }
    _pendiente = null; _destino = null; _tocado = false;
    _abiertoPara = id ? String(id) : null;
    if (!permitido()) { box.hidden = true; return; }
    box.hidden = false;
    var actuales = _abiertoPara ? refsDe(_abiertoPara) : [];
    _original = firma(actuales);
    pintarFilas(actuales);
    /* Si aún no se habían leído (primera vez), se leen y se repinta solo si
     * el empleado no ha tocado nada todavía y sigue en el mismo producto. */
    var para = _abiertoPara;
    cargar(!S.cargado).then(function () {
      if (_tocado || _abiertoPara !== para) { return; }
      var act = para ? refsDe(para) : [];
      _original = firma(act);
      pintarFilas(act);
    });
  }

  function envolver() {
    if (typeof window.openProductModal === 'function' && !window.openProductModal._conRefs) {
      var oo = window.openProductModal;
      window.openProductModal = function (id) {
        var r = oo.apply(this, arguments);
        alAbrir(id);
        return r;
      };
      window.openProductModal._conRefs = true;
    }

    if (typeof window.saveProduct === 'function' && !window.saveProduct._conRefs) {
      var os = window.saveProduct;
      window.saveProduct = function () {
        _pendiente = null; _destino = null;
        var box = $('pRefsBox');
        if (box && !box.hidden && permitido()) {
          var lr = leerFilas();
          if (lr.error) {
            aviso('⚠️ ' + lr.error, 'error');
            if (lr.foco) { lr.foco.focus(); }
            return;   // no se guarda nada: el empleado corrige y vuelve a pulsar
          }
          var editando = null;
          try { editando = editingProductId || null; } catch (e) { editando = null; }
          var cambio = firma(lr.lista) !== _original;
          if (editando ? cambio : lr.lista.length > 0) {
            _pendiente = lr.lista;
            _destino = editando ? String(editando) : NUEVO;
          }
        }
        return os.apply(this, arguments);
      };
      window.saveProduct._conRefs = true;
    }

    if (typeof DB !== 'undefined' && DB && typeof DB.saveProduct === 'function' && !DB.saveProduct._conRefs) {
      var od = DB.saveProduct;
      DB.saveProduct = async function (product) {
        var id0 = product && product.id;
        var esDestino = _destino !== null && (_destino === NUEVO ? !id0 : String(id0) === _destino);
        if (!esDestino) { return od.apply(this, arguments); }
        var lista = _pendiente;
        _pendiente = null; _destino = null;
        var saved = await od.apply(this, arguments);
        var id = (saved && saved.id) || id0;
        if (!id) {
          aviso('El producto se guardó, pero no las referencias del proveedor. Ábralo y vuelva a escribirlas.', 'warning');
          return saved;
        }
        try {
          await rpc('conta_guardar_referencias', { p_producto: String(id), p_refs: lista });
          var pid = String(id);
          Object.keys(S.porClave).forEach(function (k) { if (S.porClave[k] === pid) { delete S.porClave[k]; } });
          S.porProd[pid] = lista.map(function (r) {
            var p = S.prov.filter(function (x) { return x.id === r.proveedor_id; })[0];
            S.porClave[r.proveedor_id + '|' + norm(r.referencia)] = pid;
            return { proveedor_id: r.proveedor_id, proveedor_nombre: p ? p.nombre : '', referencia: r.referencia };
          });
          var txt = lista.map(function (r) { return r.referencia; }).join(' ');
          if (saved) { saved.refs_txt = txt; }
          if (product) { product.refs_txt = txt; }
          var pr = buscarProducto(id); if (pr) { pr.refs_txt = txt; }
        } catch (e) {
          aviso('El producto se guardó, pero las referencias del proveedor NO: ' + e.message + ' Ábralo y vuelva a guardarlas.', 'warning');
        }
        return saved;
      };
      DB.saveProduct._conRefs = true;
    }

    /* Cuando el panel vuelve a leer los productos, se les devuelve refs_txt. */
    if (typeof DB !== 'undefined' && DB && typeof DB.getProducts === 'function' && !DB.getProducts._conRefs) {
      var og = DB.getProducts;
      DB.getProducts = async function () {
        var lista = await og.apply(this, arguments);
        if (S.cargado && Array.isArray(lista)) { aplicarAProductos(lista); }
        return lista;
      };
      DB.getProducts._conRefs = true;
    }

    // Botones del bloque
    var add = $('pRefsAdd');
    if (add && !add._conRefs) {
      add._conRefs = true;
      add.addEventListener('click', function () {
        var box = $('pRefsLista');
        if (!box) { return; }
        _tocado = true;
        box.insertAdjacentHTML('beforeend', fila({ proveedor_id: '', referencia: '' }));
        var ult = box.querySelector('.ref-fila:last-child .ref-prov');
        if (ult) { ult.focus(); }
      });
    }
    var lst = $('pRefsLista');
    if (lst && !lst._conRefs) {
      lst._conRefs = true;
      lst.addEventListener('click', function (ev) {
        var b = ev.target.closest('.ref-quitar');
        if (!b) { return; }
        _tocado = true;
        var f = b.closest('.ref-fila');
        if (lst.querySelectorAll('.ref-fila').length > 1) { f.remove(); }
        else { f.querySelector('.ref-prov').value = ''; f.querySelector('.ref-cod').value = ''; }
      });
      lst.addEventListener('input', function () { _tocado = true; });
      lst.addEventListener('change', function () { _tocado = true; });
    }

    /* Se leen al entrar al panel para que el buscador de Productos ya las use. */
    setTimeout(function () {
      cargar().then(function (ok) {
        if (!ok) { return; }
        try {
          var sec = document.querySelector('.section-content.active');
          var q = ($('prodSearch') && $('prodSearch').value) || ($('invSearch') && $('invSearch').value);
          if (q && sec && sec.id === 'sec-products' && typeof renderProductsTable === 'function') { renderProductsTable(); }
          if (q && sec && sec.id === 'sec-inventory' && typeof renderInventory === 'function') { renderInventory(); }
        } catch (e) { /* se verá al volver a buscar */ }
      });
    }, 1800);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', envolver); }
  else { envolver(); }

  window.CasaMotaRefs = {
    cargar: cargar, productoDe: productoDe, refsDe: refsDe, norm: norm,
    _S: S, _leerFilas: leerFilas, _estado: function () { return { pendiente: _pendiente, destino: _destino }; }
  };
})();
