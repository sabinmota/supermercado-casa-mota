/* ════════════════════════════════════════════════════════════════════════════
 * 491 · «SOLO VENTA EN CAJA» · panel → Productos
 * Depende de seguridad/80-solo-caja.sql (columna products.solo_caja + RPC
 * admin_fijar_solo_caja).
 *
 * Pedido del dueño: hay artículos (fósforos, calditos…) que se registran SOLO
 * para facturarlos en la caja y que NO deben salir en la tienda ni en la app.
 * El dueño los marca UNO POR UNO con una casilla en «Editar producto».
 *
 * · Formulario: casilla #pSoloCaja (se rellena al abrir, se limpia al crear).
 * · Ficha de detalle: aviso #vpSoloCaja si está marcado.
 * · Guardado: por la RPC (vale + rol superadmin/admin), DESPUÉS de que el
 *   producto se guarde bien, y solo si la casilla cambió (o si es nuevo y
 *   está marcada). Si la RPC falla, el producto YA está guardado: se avisa y
 *   NO se relanza el error (un segundo «Guardar» crearía un duplicado).
 * · La etiqueta «Solo caja» y el filtro de la tabla están en admin.v33.js
 *   (_esSoloCajaAdm / _pasaFiltroVenta) porque los usan renderProductsTable
 *   y _goPage con el mismo criterio.
 *
 * 🔴 Mismo patrón que js/itbis-lotes.js (476): se envuelven viewProduct,
 *    openProductModal, saveProduct y DB.saveProduct. DEBE cargarse DESPUÉS de
 *    itbis-lotes.js: así cada capa envuelve a la anterior y las dos funcionan.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function aviso(txt, tipo) {
    if (typeof showAdminToast === 'function') { showAdminToast(String(txt), tipo); }
    else { window.alert(txt); }
  }
  function vale() { return (typeof _valeAdmin === 'function') ? _valeAdmin() : ''; }
  function esSoloCaja(p) { return !!p && (p.solo_caja === true || p.solo_caja === 'true' || p.solo_caja === 1); }

  var MENSAJES = {
    NO_INSTALADO:       'Falta ejecutar seguridad/80-solo-caja.sql en Supabase.',
    SESION_INVALIDA:    'Su sesión caducó. Vuelva a entrar al panel.',
    ROL_NO_AUTORIZADO:  'Solo el superadministrador o un administrador puede cambiar «Solo venta en caja».',
    PRODUCTO_NO_EXISTE: 'El producto no se encontró.',
    VALOR_INVALIDO:     'Valor no válido.'
  };

  async function rpc(cuerpo) {
    var res = await fetch(_SB_URL + '/rpc/admin_fijar_solo_caja', {
      method: 'POST', headers: _SB_HEADERS, body: JSON.stringify(cuerpo)
    });
    var txt = await res.text();
    if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { throw new Error(MENSAJES.NO_INSTALADO); }
    if (!res.ok) { throw new Error('La base respondió con un error (HTTP ' + res.status + ').'); }
    var j = JSON.parse(txt);
    j = Array.isArray(j) ? j[0] : j;
    if (!j || !j.ok) { throw new Error(MENSAJES[j && j.error] || ('Error: ' + (j && j.error))); }
    return j;
  }

  function listaProductos() {
    try { return (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts)) ? adminProducts : []; }
    catch (e) { return []; }
  }
  function buscarProducto(id) {
    var l = listaProductos();
    for (var i = 0; i < l.length; i++) { if (String(l[i].id) === String(id)) { return l[i]; } }
    return null;
  }
  function repintarTabla() {
    try { if (typeof renderProductsTable === 'function' && $('productsTbody')) { renderProductsTable(); } }
    catch (e) { /* se verá al volver a Productos */ }
  }

  var _original = false;    // estado de la casilla al abrir el formulario
  var _pendiente = null;    // valor a guardar tras DB.saveProduct (null = nada)
  var _destino = null;      // a quién va: id del producto editado, o NUEVO
  var NUEVO = '__nuevo__';

  /* El valor pendiente solo vale para EL guardado del formulario. Si
   * saveProduct() se corta en una validación (falta nombre, ITBIS…), no llega
   * a DB.saveProduct y el valor quedaría colgado: otra llamada posterior
   * (p. ej. mover productos de categoría) lo aplicaría al producto que NO es.
   * Por eso se comprueba el destino y no solo que haya algo pendiente. */
  function esElDestino(product) {
    if (_destino === null) { return false; }
    var id = product && product.id;
    return _destino === NUEVO ? !id : String(id) === _destino;
  }

  function pintarFicha(p) {
    var el = $('vpSoloCaja');
    if (el) { el.hidden = !esSoloCaja(p); }
  }

  function envolver() {
    if (typeof window.viewProduct === 'function' && !window.viewProduct._conSoloCaja) {
      var ov = window.viewProduct;
      window.viewProduct = function (id) {
        var r = ov.apply(this, arguments);
        pintarFicha(buscarProducto(id));
        return r;
      };
      window.viewProduct._conSoloCaja = true;
    }
    if (typeof window.openProductModal === 'function' && !window.openProductModal._conSoloCaja) {
      var oo = window.openProductModal;
      window.openProductModal = function (id) {
        var r = oo.apply(this, arguments);
        var c = $('pSoloCaja');
        if (c) {
          var p = id ? buscarProducto(id) : null;
          _original = esSoloCaja(p);      // producto nuevo → false
          c.checked = _original;
        }
        _pendiente = null; _destino = null;
        return r;
      };
      window.openProductModal._conSoloCaja = true;
    }
    if (typeof window.saveProduct === 'function' && !window.saveProduct._conSoloCaja) {
      var os = window.saveProduct;
      window.saveProduct = function () {
        var c = $('pSoloCaja');
        _pendiente = null; _destino = null;
        if (c) {
          var editando = null;
          try { editando = editingProductId || null; } catch (e) { editando = null; }
          var valor = !!c.checked;
          /* Edición: solo si cambió. Nuevo: solo si se marcó (la columna ya
           * nace en false por defecto, no hace falta llamar). */
          if (editando ? valor !== _original : valor) {
            _pendiente = valor;
            _destino = editando ? String(editando) : NUEVO;
          }
        }
        return os.apply(this, arguments);
      };
      window.saveProduct._conSoloCaja = true;
    }
    if (typeof DB !== 'undefined' && DB && typeof DB.saveProduct === 'function' && !DB.saveProduct._conSoloCaja) {
      var od = DB.saveProduct;
      DB.saveProduct = async function (product) {
        if (!esElDestino(product)) { return od.apply(this, arguments); }
        var valor = _pendiente;
        _pendiente = null; _destino = null;
        var saved = await od.apply(this, arguments);
        if (valor === null) { return saved; }
        var id = (saved && saved.id) || (product && product.id);
        if (!id) {
          aviso('El producto se guardó, pero no se pudo marcar «Solo venta en caja». Ábralo y vuelva a marcarlo.', 'warning');
          return saved;
        }
        try {
          await rpc({ p_vale: vale(), p_id: String(id), p_valor: valor });
          if (saved) { saved.solo_caja = valor; }
          if (product) { product.solo_caja = valor; }
          var p = buscarProducto(id); if (p) { p.solo_caja = valor; }
          setTimeout(repintarTabla, 0);   // el panel ya repintó antes de la RPC
        } catch (e) {
          aviso('El producto se guardó, pero «Solo venta en caja» NO: ' + e.message + ' Ábralo y vuelva a marcarlo.', 'warning');
        }
        return saved;
      };
      DB.saveProduct._conSoloCaja = true;
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', envolver); }
  else { envolver(); }

  // Solo para pruebas
  window._soloCaja = {
    pintarFicha: pintarFicha, esSoloCaja: esSoloCaja,
    estado: function () { return { pendiente: _pendiente, destino: _destino }; }
  };
})();
