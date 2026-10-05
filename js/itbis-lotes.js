/* ════════════════════════════════════════════════════════════════════════════
 * 476 · TASA DE ITBIS EN LA FICHA Y EN «EDITAR / NUEVO PRODUCTO»
 * Creado 2026-09-26 · depende de seguridad/78 (RPC admin_fijar_itbis)
 *
 * · Ficha de detalle: línea «ITBIS: 18 %» (verde) / 16 % (azul) /
 *   0 % exento (gris) / «sin asignar · la caja no lo factura» (rojo).
 * · Editar / Nuevo producto: selector ITBIS OBLIGATORIO. Sin tasa no se
 *   guarda (así no nacen productos nuevos sin tasa).
 * · La tasa se guarda por la RPC `admin_fijar_itbis` (el panel no tiene
 *   permiso de escribir esa columna directamente), DESPUÉS de que el
 *   producto se guarde bien, dentro del mismo DB.saveProduct.
 *
 * 484 (4-oct) · Se BORRÓ la pantalla «Asignar ITBIS» por lotes (475): el
 *   dueño terminó de asignar (0 productos sin tasa, SQL 81) y pidió quitarla.
 *   Se borraron el botón, la ventana, contar/abrir/asignar y el enganche a
 *   showSection; en la base, el SQL 85 borra sus dos RPC. El nombre del
 *   fichero se mantiene para no tocar el orden de carga de admin.html
 *   (solo-caja.js va DESPUÉS de este).
 *
 * 🔴 Se envuelven viewProduct / openProductModal / saveProduct /
 *    DB.saveProduct de admin.v33.js sin tocar ese fichero.
 *
 * DEPENDE DE: js/api.js (_SB_URL, _SB_HEADERS, _valeAdmin) y
 *             showAdminToast de js/admin.v33.js (opcional).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function aviso(txt, tipo) {
    if (typeof showAdminToast === 'function') { showAdminToast(esc(txt), tipo); }
    else { window.alert(txt); }
  }

  var MENSAJES = {
    NO_INSTALADO:      'Falta ejecutar seguridad/78-itbis-por-lotes.sql en Supabase.',
    SESION_INVALIDA:   'Su sesión caducó. Vuelva a entrar al panel.',
    ROL_NO_AUTORIZADO: 'Solo el superadministrador o un administrador puede asignar el ITBIS.',
    TASA_INVALIDA:     'Tasa no válida (solo 0, 16 o 18).'
  };

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

  function listaProductos() {
    try { return (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts)) ? adminProducts : []; }
    catch (e) { return []; }
  }
  function buscarProducto(id) {
    var l = listaProductos();
    for (var i = 0; i < l.length; i++) { if (String(l[i].id) === String(id)) { return l[i]; } }
    return null;
  }
  /* 477 · la columna ITBIS de la tabla se actualiza al momento */
  function repintarTabla() {
    try { if (typeof renderProductsTable === 'function' && $('productsTbody')) { renderProductsTable(); } }
    catch (e) { /* la tabla se verá al volver a Productos */ }
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
          setTimeout(repintarTabla, 0);   // el panel ya repintó antes de la RPC
          if (product) { product.itbis_tasa = tasa; }
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

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', envolverFicha); }
  else { envolverFicha(); }

  window.CasaMotaItbis = { _pintarFicha: pintarFicha };
})();
