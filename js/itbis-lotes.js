/* ════════════════════════════════════════════════════════════════════════════
 * 475 · ASIGNAR ITBIS POR LOTES · sección Productos del panel
 * Creado 2026-09-26 · depende de seguridad/78-itbis-por-lotes.sql
 *
 * Decisión del dueño (opción A): botón «Asignar ITBIS (N pendientes)» en la
 * cabecera de Productos, sin tocar el menú. Abre una ventana con SOLO los
 * productos sin tasa; se filtran/buscan, se marcan varios y se pulsa 18 %,
 * 16 % o 0 %. Los asignados desaparecen y el contador baja.
 *
 * 🔴 NADA SE DEDUCE: el dueño decide cada tasa. (Regla ya aprendida: por
 *    nombre, «chocolate» puede ser 16 % o 18 %.)
 * 🔴 FICHERO APARTE: no toca admin.v33.js. Se engancha envolviendo showSection.
 * 🔴 La lectura y el guardado van por RPC con vale + rol superadmin/admin.
 * 🔴 Todo texto de la base se ESCAPA.
 *
 * DEPENDE DE: js/api.js (_SB_URL, _SB_HEADERS, _valeAdmin), catLabel y
 *             showAdminToast de js/admin.v33.js (opcionales).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dinero(n) {
    return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function nombreCat(c) {
    try { if (typeof catLabel === 'function') { return catLabel(c); } } catch (e) { /* sigue */ }
    return c || '(sin categoría)';
  }
  function aviso(txt, tipo) {
    if (typeof showAdminToast === 'function') { showAdminToast(esc(txt), tipo); }
    else { window.alert(txt); }
  }
  function sinAcentos(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  var MENSAJES = {
    NO_INSTALADO:      'Falta ejecutar seguridad/78-itbis-por-lotes.sql en Supabase.',
    SESION_INVALIDA:   'Su sesión caducó. Vuelva a entrar al panel.',
    ROL_NO_AUTORIZADO: 'Solo el superadministrador o un administrador puede asignar el ITBIS.',
    TASA_INVALIDA:     'Tasa no válida (solo 0, 16 o 18).'
  };

  var _prods = [];            // productos sin tasa
  var _marcados = {};         // id → true
  var _guardando = false;

  async function rpc(nombre, cuerpo) {
    var res = await fetch(_SB_URL + '/rpc/' + nombre, {
      method: 'POST', headers: _SB_HEADERS, body: JSON.stringify(cuerpo)
    });
    var txt = await res.text();
    if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { throw new Error(MENSAJES.NO_INSTALADO); }
    if (!res.ok) { throw new Error('La base respondió con un error (HTTP ' + res.status + ').'); }
    var j = JSON.parse(txt);
    j = Array.isArray(j) ? j[0] : j;
    if (!j || !j.ok) {
      var e = new Error(MENSAJES[j && j.error] || ('Error: ' + (j && j.error)));
      e.codigo = j && j.error;
      throw e;
    }
    return j;
  }
  function vale() { return (typeof _valeAdmin === 'function') ? _valeAdmin() : ''; }

  /* ── Botón de la cabecera ─────────────────────────────────────────────── */
  function boton() {
    var b = $('btnItbisLotes');
    if (b) { return b; }
    var nuevo = $('sec-products') && $('sec-products').querySelector('.page-header > div');
    if (!nuevo) { return null; }
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnItbisLotes';
    b.className = 'itl-btn';
    b.title = 'Poner la tasa de ITBIS a los productos que aún no la tienen';
    b.addEventListener('click', abrir);
    var ref = $('btnBulkDesc');
    nuevo.insertBefore(b, ref || nuevo.firstChild);
    return b;
  }

  function pintarBoton(n) {
    var b = boton();
    if (!b) { return; }
    if (n > 0) {
      b.innerHTML = '<i class="fas fa-percent"></i> Asignar ITBIS <span class="itl-btn__n">' + n + ' pendientes</span>';
      b.classList.remove('itl-btn--ok');
    } else {
      b.innerHTML = '<i class="fas fa-check"></i> ITBIS asignado a todos';
      b.classList.add('itl-btn--ok');
    }
  }

  async function contar() {
    try {
      var r = await rpc('admin_productos_sin_itbis', { p_vale: vale() });
      _prods = r.productos || [];
      pintarBoton(_prods.length);
    } catch (e) {
      /* Sin permiso: el botón no se crea (un operador no asigna impuestos). */
      if (e.codigo === 'ROL_NO_AUTORIZADO') { var b = $('btnItbisLotes'); if (b) { b.remove(); } return; }
      var bb = boton();
      if (bb) { bb.innerHTML = '<i class="fas fa-percent"></i> Asignar ITBIS'; bb.title = e.message; }
    }
  }

  /* ── Ventana ──────────────────────────────────────────────────────────── */
  function ventana() {
    var v = $('itlModal');
    if (v) { return v; }
    v = document.createElement('div');
    v.id = 'itlModal';
    v.className = 'itl-fondo';
    v.hidden = true;
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-modal', 'true');
    v.setAttribute('aria-labelledby', 'itlTit');
    v.innerHTML =
      '<div class="itl-caja">' +
        '<header class="itl-cab">' +
          '<div><h2 id="itlTit">Asignar ITBIS</h2>' +
          '<p class="itl-sub"><b id="itlPend">0</b> productos sin tasa · la caja no los factura hasta que tengan una</p></div>' +
          '<button type="button" class="itl-x" id="itlCerrar" aria-label="Cerrar">✕</button>' +
        '</header>' +
        '<div class="itl-filtros">' +
          '<input type="search" id="itlBuscar" class="filter-input" placeholder="Buscar por nombre… (ej. yogurt, agua, harina)">' +
          '<select id="itlCat" class="filter-select"></select>' +
        '</div>' +
        '<div class="itl-barra">' +
          '<label class="itl-todos"><input type="checkbox" id="itlTodos"> Marcar todos los que se ven (<span id="itlVisibles">0</span>)</label>' +
          '<span class="itl-sel"><b id="itlNsel">0</b> marcados</span>' +
          '<span class="itl-sep"></span>' +
          '<span class="itl-poner">Poner a los marcados:</span>' +
          '<button type="button" class="itl-tasa itl-tasa--18" data-tasa="18">18 %</button>' +
          '<button type="button" class="itl-tasa itl-tasa--16" data-tasa="16">16 %</button>' +
          '<button type="button" class="itl-tasa itl-tasa--0" data-tasa="0">0 % exento</button>' +
        '</div>' +
        '<p class="itl-estado" id="itlEstado" hidden></p>' +
        '<div class="itl-lista" id="itlLista"></div>' +
      '</div>';
    document.body.appendChild(v);

    $('itlCerrar').addEventListener('click', cerrar);
    v.addEventListener('click', function (ev) { if (ev.target === v) { cerrar(); } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !v.hidden) { cerrar(); } });
    $('itlBuscar').addEventListener('input', pintarLista);
    $('itlCat').addEventListener('change', pintarLista);
    $('itlTodos').addEventListener('change', function () {
      var vis = visibles(), on = $('itlTodos').checked;
      for (var i = 0; i < vis.length; i++) { if (on) { _marcados[vis[i].id] = true; } else { delete _marcados[vis[i].id]; } }
      pintarLista();
    });
    $('itlLista').addEventListener('change', function (ev) {
      var cb = ev.target;
      if (!cb.matches('input[data-id]')) { return; }
      if (cb.checked) { _marcados[cb.getAttribute('data-id')] = true; } else { delete _marcados[cb.getAttribute('data-id')]; }
      pintarContadores();
    });
    var ts = v.querySelectorAll('.itl-tasa');
    for (var i = 0; i < ts.length; i++) {
      ts[i].addEventListener('click', function (ev) { asignar(Number(ev.currentTarget.getAttribute('data-tasa'))); });
    }
    return v;
  }

  function estado(txt, error) {
    var e = $('itlEstado');
    if (!txt) { e.hidden = true; return; }
    e.textContent = txt;
    e.className = 'itl-estado' + (error ? ' itl-estado--error' : '');
    e.hidden = false;
  }

  async function abrir() {
    var v = ventana();
    _marcados = {};
    $('itlBuscar').value = '';
    v.hidden = false;
    estado('Cargando productos sin tasa…');
    $('itlLista').innerHTML = '';
    try {
      var r = await rpc('admin_productos_sin_itbis', { p_vale: vale() });
      _prods = r.productos || [];
      estado('');
      pintarCategorias();
      pintarLista();
      pintarBoton(_prods.length);
      $('itlBuscar').focus();
    } catch (e) {
      estado(e.message, true);
    }
  }

  function cerrar() {
    var v = $('itlModal');
    if (v) { v.hidden = true; }
  }

  function pintarCategorias() {
    var cuenta = {};
    for (var i = 0; i < _prods.length; i++) { var c = _prods[i].category || ''; cuenta[c] = (cuenta[c] || 0) + 1; }
    var sel = $('itlCat'), actual = sel.value;
    var h = '<option value="">Todas las categorías (' + _prods.length + ')</option>';
    Object.keys(cuenta).sort(function (a, b) { return cuenta[b] - cuenta[a]; }).forEach(function (c) {
      h += '<option value="' + esc(c) + '">' + esc(nombreCat(c)) + ' (' + cuenta[c] + ')</option>';
    });
    sel.innerHTML = h;
    if (actual && cuenta[actual]) { sel.value = actual; }
  }

  function visibles() {
    var q = sinAcentos($('itlBuscar').value.trim()), cat = $('itlCat').value, r = [];
    for (var i = 0; i < _prods.length; i++) {
      var p = _prods[i];
      if (cat && (p.category || '') !== cat) { continue; }
      if (q && sinAcentos(p.name).indexOf(q) < 0) { continue; }
      r.push(p);
    }
    return r;
  }

  function pintarLista() {
    var vis = visibles(), h = '';
    for (var i = 0; i < vis.length; i++) {
      var p = vis[i];
      var foto = p.image
        ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'\'))">'
        : '';
      h += '<label class="itl-fila">' +
             '<input type="checkbox" data-id="' + esc(p.id) + '"' + (_marcados[p.id] ? ' checked' : '') + '>' +
             '<span class="itl-foto">' + foto + '</span>' +
             '<span class="itl-nom">' + esc(p.name) + '<small>' + esc(nombreCat(p.category)) + '</small></span>' +
             '<span class="itl-precio">' + dinero(p.price) + '</span>' +
           '</label>';
    }
    $('itlLista').innerHTML = h || '<p class="itl-vacio">' +
      (_prods.length ? 'Ningún producto coincide con el filtro.' : '✓ Todos los productos tienen su ITBIS.') + '</p>';
    pintarContadores();
  }

  function pintarContadores() {
    var vis = visibles(), n = Object.keys(_marcados).length, visMarc = 0;
    for (var i = 0; i < vis.length; i++) { if (_marcados[vis[i].id]) { visMarc++; } }
    $('itlPend').textContent = _prods.length;
    $('itlVisibles').textContent = vis.length;
    $('itlNsel').textContent = n;
    var todos = $('itlTodos');
    todos.checked = vis.length > 0 && visMarc === vis.length;
    todos.indeterminate = visMarc > 0 && visMarc < vis.length;
    var bs = document.querySelectorAll('#itlModal .itl-tasa');
    for (var k = 0; k < bs.length; k++) { bs[k].disabled = !n || _guardando; }
  }

  async function asignar(tasa) {
    var ids = Object.keys(_marcados);
    if (!ids.length || _guardando) { return; }
    var etiqueta = tasa === 0 ? '0 % (exento)' : tasa + ' %';
    if (!window.confirm('¿Poner ITBIS ' + etiqueta + ' a ' + ids.length +
        (ids.length === 1 ? ' producto?' : ' productos?'))) { return; }
    _guardando = true;
    pintarContadores();
    estado('Guardando…');
    try {
      var r = await rpc('admin_asignar_itbis', { p_vale: vale(), p_ids: ids, p_tasa: tasa });
      var hechos = {};
      for (var i = 0; i < ids.length; i++) { hechos[ids[i]] = true; }
      ponerEnMemoria(hechos, tasa);
      _prods = _prods.filter(function (p) { return !hechos[p.id]; });
      _marcados = {};
      estado('');
      var avisoTxt = r.asignados + (r.asignados === 1 ? ' producto' : ' productos') + ' al ' + etiqueta +
        ' · quedan ' + (r.pendientes !== undefined ? r.pendientes : _prods.length);
      if (r.asignados < ids.length) {
        avisoTxt += ' (' + (ids.length - r.asignados) + ' ya tenían tasa y no se cambiaron)';
      }
      aviso(avisoTxt, 'success');
      pintarCategorias();
      pintarLista();
      pintarBoton(_prods.length);
    } catch (e) {
      estado(e.message, true);
    } finally {
      _guardando = false;
      pintarContadores();
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 476 · LA TASA EN LA FICHA Y EN «EDITAR PRODUCTO» (pedido del dueño)
   *
   * · Ficha de detalle: línea «ITBIS: 18 %» (verde) / 16 % (azul) /
   *   0 % exento (gris) / «sin asignar · la caja no lo factura» (rojo).
   * · Editar / Nuevo producto: selector ITBIS OBLIGATORIO. Sin tasa no se
   *   guarda (así no nacen productos nuevos sin tasa).
   * · El guardado de la tasa va por la RPC `admin_fijar_itbis` (el panel no
   *   tiene permiso de escribir esa columna directamente). Se hace DESPUÉS de
   *   que el producto se guarde bien, dentro del mismo DB.saveProduct, para
   *   que un fallo de validación del formulario no deje la tasa a medias.
   * 🔴 Se envuelven viewProduct / openProductModal / saveProduct /
   *    DB.saveProduct de admin.v33.js sin tocar ese fichero.
   * ════════════════════════════════════════════════════════════════════════ */
  function listaProductos() {
    try { return (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts)) ? adminProducts : []; }
    catch (e) { return []; }
  }
  function buscarProducto(id) {
    var l = listaProductos();
    for (var i = 0; i < l.length; i++) { if (String(l[i].id) === String(id)) { return l[i]; } }
    return null;
  }
  function ponerEnMemoria(ids, tasa) {
    var l = listaProductos();
    for (var i = 0; i < l.length; i++) { if (ids[l[i].id]) { l[i].itbis_tasa = tasa; } }
  }
  function tieneTasa(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

  function pintarFicha(p) {
    var el = $('vpItbis'), fila = $('vpItbisRow');
    if (!el || !fila) { return; }
    fila.className = 'vp-itbis-row';
    if (!p || !tieneTasa(p.itbis_tasa)) {
      el.textContent = 'ITBIS: sin asignar · la caja no lo factura';
      fila.classList.add('vp-itbis-row--sin');
      return;
    }
    var t = Number(p.itbis_tasa);
    el.textContent = 'ITBIS: ' + t + ' %' + (t === 0 ? ' (exento)' : '');
    fila.classList.add(t === 18 ? 'vp-itbis-row--18' : t === 16 ? 'vp-itbis-row--16' : 'vp-itbis-row--0');
  }

  var _tasaOriginal = null;   // la que tenía el producto al abrir el formulario
  var _tasaPendiente = null;  // la que hay que guardar tras DB.saveProduct

  function envolverFicha() {
    if (typeof window.viewProduct === 'function' && !window.viewProduct._conItbis) {
      var ov = window.viewProduct;
      window.viewProduct = function (id) {
        var r = ov.apply(this, arguments);
        pintarFicha(buscarProducto(id));
        return r;
      };
      window.viewProduct._conItbis = true;
    }
    if (typeof window.openProductModal === 'function' && !window.openProductModal._conItbis) {
      var oo = window.openProductModal;
      window.openProductModal = function (id) {
        var r = oo.apply(this, arguments);
        var sel = $('pItbis');
        if (sel) {
          var p = id ? buscarProducto(id) : null;
          _tasaOriginal = p && tieneTasa(p.itbis_tasa) ? String(Number(p.itbis_tasa)) : '';
          sel.value = _tasaOriginal;
          sel.classList.remove('itl-falta');
        }
        return r;
      };
      window.openProductModal._conItbis = true;
    }
    if (typeof window.saveProduct === 'function' && !window.saveProduct._conItbis) {
      var os = window.saveProduct;
      window.saveProduct = function () {
        var sel = $('pItbis');
        _tasaPendiente = null;
        if (sel) {
          if (sel.value === '') {
            aviso('⚠️ Elija la tasa de ITBIS (18 %, 16 % o 0 %). Sin tasa la caja no puede facturar el producto.', 'error');
            sel.classList.add('itl-falta');
            sel.focus();
            return;
          }
          sel.classList.remove('itl-falta');
          /* Nuevo producto: siempre. Edición: solo si cambió. */
          var editando = false;
          try { editando = !!editingProductId; } catch (e) { editando = false; }
          if (!editando || sel.value !== _tasaOriginal) { _tasaPendiente = Number(sel.value); }
        }
        return os.apply(this, arguments);
      };
      window.saveProduct._conItbis = true;
    }
    if (typeof DB !== 'undefined' && DB && typeof DB.saveProduct === 'function' && !DB.saveProduct._conItbis) {
      var od = DB.saveProduct;
      DB.saveProduct = async function (product) {
        var tasa = _tasaPendiente;
        _tasaPendiente = null;
        var saved = await od.apply(this, arguments);
        if (tasa === null) { return saved; }
        var id = (saved && saved.id) || (product && product.id);
        if (!id) { aviso('El producto se guardó, pero no se pudo poner la tasa de ITBIS. Ábralo y vuelva a elegirla.', 'warn'); return saved; }
        try {
          await rpc('admin_fijar_itbis', { p_vale: vale(), p_id: String(id), p_tasa: tasa });
          if (saved) { saved.itbis_tasa = tasa; }
          var p = buscarProducto(id); if (p) { p.itbis_tasa = tasa; }
          if (product) { product.itbis_tasa = tasa; }
          contar();
        } catch (e) {
          /* El producto YA está guardado: no se lanza el error (el formulario
           * se quedaría abierto y un segundo «Guardar» crearía un duplicado). */
          aviso('El producto se guardó, pero la tasa de ITBIS NO: ' + e.message + ' Ábralo y vuelva a elegirla.', 'warn');
        }
        return saved;
      };
      DB.saveProduct._conItbis = true;
    }
  }

  /* ── Enganche: al entrar en Productos, se cuenta ──────────────────────── */
  function enganchar() {
    envolverFicha();
    if (typeof window.showSection === 'function' && !window.showSection._conItbis) {
      var original = window.showSection;
      var envuelta = function (id) {
        var r = original.apply(this, arguments);
        if (id === 'products') { contar(); }
        return r;
      };
      envuelta._conItbis = true;
      for (var k in original) { if (Object.prototype.hasOwnProperty.call(original, k)) { envuelta[k] = original[k]; } }
      window.showSection = envuelta;
    }
    var s = $('sec-products');
    if (s && s.classList.contains('active')) { contar(); }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', enganchar); }
  else { enganchar(); }

  window.CasaMotaItbisLotes = { abrir: abrir, contar: contar, _asignar: asignar, _pintarFicha: pintarFicha,
    _marcar: function (id) { _marcados[id] = true; pintarLista(); } };
})();
