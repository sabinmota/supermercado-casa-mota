/* ════════════════════════════════════════════════════════════════════════════
 * CIERRES DE TURNO · pestaña de «Ventas POS» en el panel
 * Creado 2026-09-23 · build 472 · depende de seguridad/76-leer-cierres-pos.sql
 *
 * Pedido del dueño: revisar los cuadres de cada cajera. Muestra los cierres
 * HECHOS en el día elegido (mismo selector de día de Ventas POS): cajera, caja,
 * ventas, totales por forma de pago, fondo y EFECTIVO QUE DEBE HABER EN CAJA.
 * Al pulsar uno se ve el cuadre completo y se puede reimprimir el recibo.
 *
 * 🔴 FICHERO APARTE: no toca admin.v33.js ni ventas-pos.js.
 * 🔴 Los cierres NO se leen de la tabla (`pos_cierres` sin permisos para la
 *    clave pública): RPC `admin_cierres_pos`, vale + rol superadmin/admin EN LA BASE.
 * 🔴 Todo texto de la base se ESCAPA antes de pintarlo.
 *
 * DEPENDE DE: js/api.js (_SB_URL, _SB_HEADERS, _valeAdmin)
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function dinero(n) {
    return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function tk(n) { return (n === null || n === undefined) ? '—' : String(n).padStart(6, '0'); }

  var MENSAJES = {
    NO_INSTALADO:       'Falta ejecutar seguridad/76-leer-cierres-pos.sql en Supabase.',
    ROL_NO_AUTORIZADO:  'Solo el superadministrador o un administrador puede ver los cierres.',
    SESION_INVALIDA:    'Su sesión caducó. Vuelva a entrar al panel.',
    SESION_CADUCADA:    'Su sesión caducó. Vuelva a entrar al panel.',
    CUENTA_DESACTIVADA: 'Su usuario está desactivado.'
  };

  var _cierres = [];
  var _abierto = null;
  var _pestana = 'ventas';

  async function pedir(dia) {
    var res = await fetch(_SB_URL + '/rpc/admin_cierres_pos', {
      method: 'POST', headers: _SB_HEADERS,
      body: JSON.stringify({ p_vale: (typeof _valeAdmin === 'function') ? _valeAdmin() : '', p_dia: dia })
    });
    var txt = await res.text();
    if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { throw new Error(MENSAJES.NO_INSTALADO); }
    if (!res.ok) {
      for (var k in MENSAJES) { if (txt.indexOf(k) >= 0) { throw new Error(MENSAJES[k]); } }
      throw new Error('No se pudieron leer los cierres (HTTP ' + res.status + ').');
    }
    var j = JSON.parse(txt);
    return Array.isArray(j) ? j[0] : j;
  }

  function filasCuadre(c) {
    function f(a, b, fuerte) { return '<div class="f' + (fuerte ? ' g' : '') + '"><span>' + a + '</span><b>' + b + '</b></div>'; }
    return f('Desde', esc(c.desde || '—')) + f('Hasta', esc(c.hasta)) +
           f('Tickets', tk(c.primer_ticket) + ' a ' + tk(c.ultimo_ticket)) +
           f('Ventas', esc(c.ventas)) +
           (Number(c.anuladas) ? f('Anuladas (no suman)', esc(c.anuladas)) : '') +
           '<hr>' +
           f('Efectivo', dinero(c.efectivo)) + f('Tarjeta', dinero(c.tarjeta)) +
           f('Transferencia', dinero(c.transferencia)) +
           f('TOTAL VENDIDO', dinero(c.total), true) + f('ITBIS incluido', dinero(c.itbis)) +
           '<hr>' +
           f('Fondo inicial', dinero(c.fondo)) + f('+ Ventas en efectivo', dinero(c.efectivo)) +
           f('= Efectivo que debe haber en caja', dinero(c.esperado), true);
  }

  function pintar() {
    var total = 0, esperado = 0, itbis = 0, cajeras = {};
    for (var i = 0; i < _cierres.length; i++) {
      var c = _cierres[i];
      total += Number(c.total) || 0; esperado += Number(c.esperado) || 0; itbis += Number(c.itbis) || 0;
      cajeras[c.cajera || '—'] = true;
    }
    var nombres = Object.keys(cajeras);
    $('vcNum').textContent = _cierres.length;
    $('vcCajeras').textContent = nombres.length ? nombres.join(', ') : '—';
    $('vcTotal').textContent = dinero(total);
    $('vcEsperado').textContent = dinero(esperado);
    $('vcItbis').textContent = dinero(itbis);

    var cuerpo = $('vcCuerpo');
    if (!_cierres.length) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="vp-vacio">No hay cierres de turno en este día.</td></tr>';
      return;
    }
    var h = '';
    for (var j = 0; j < _cierres.length; j++) {
      var x = _cierres[j];
      h += '<tr class="vp-fila vc-fila" data-i="' + j + '" tabindex="0">' +
             '<td><b>Nº ' + esc(String(x.cierre).padStart(5, '0')) + '</b></td>' +
             '<td>' + esc(x.hora) + '</td>' +
             '<td>' + esc(x.cajera) + '</td>' +
             '<td>' + esc(x.caja) + '</td>' +
             '<td class="n">' + esc(x.ventas) + '</td>' +
             '<td class="n">' + dinero(x.total) + '</td>' +
             '<td class="n">' + dinero(x.fondo) + '</td>' +
             '<td class="n"><b class="vc-esperado">' + dinero(x.esperado) + '</b></td>' +
           '</tr>';
      if (_abierto === j) {
        h += '<tr class="vp-detalle"><td colspan="8"><div class="vc-cuadre">' +
               '<div class="vc-cuadre__tabla">' + filasCuadre(x) + '</div>' +
               '<button type="button" class="vc-imprimir" data-imprimir="' + j + '">' +
               '<i class="fas fa-print"></i> Imprimir cierre</button>' +
             '</div></td></tr>';
      }
    }
    cuerpo.innerHTML = h;
  }

  /* Reimprime el cierre en papel de 80 mm, en una ventana aparte, para no
   * alterar el panel ni su CSS. */
  function imprimir(c) {
    var v = window.open('', '_blank', 'width=420,height=700');
    if (!v) { window.alert('El navegador bloqueó la ventana de impresión. Permita las ventanas emergentes para este sitio.'); return; }
    var css = '@page{size:80mm auto;margin:0}body{margin:0}' +
      '.r{width:72mm;margin:0 auto;padding:3mm 0 8mm;font-family:"Courier New",monospace;font-size:11.5px;line-height:1.35;color:#000}' +
      'h1{font-size:15px;text-align:center;margin:0 0 2px}.c{text-align:center}' +
      '.f{display:flex;justify-content:space-between;gap:6px}.g{font-weight:700;font-size:13px}' +
      'hr{border:0;border-top:1px dashed #000;margin:4px 0}' +
      '.firma{margin-top:12mm;border-top:1px solid #000;text-align:center;padding-top:1mm}';
    v.document.open();
    v.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cierre ' +
      esc(String(c.cierre).padStart(5, '0')) + '</title><style>' + css + '</style></head><body><div class="r">' +
      '<h1>SUPERMERCADO CASA MOTA</h1>' +
      '<div class="c">CIERRE DE TURNO Nº ' + esc(String(c.cierre).padStart(5, '0')) + ' (COPIA)</div>' +
      '<div class="c">Cajera: ' + esc(c.cajera) + ' · Caja ' + esc(c.caja) + '</div>' +
      '<hr>' + filasCuadre(c) + '<hr>' +
      '<div class="f"><span>Efectivo contado:</span><b>RD$ ____________</b></div>' +
      '<div class="firma">Firma cajera</div><div class="firma">Firma supervisor</div>' +
      '</div></body></html>');
    v.document.close();
    v.focus();
    setTimeout(function () { v.print(); }, 250);
  }

  async function cargar() {
    var inp = $('vpDia');
    if (!inp || !$('vcCuerpo')) { return; }
    var est = $('vcEstado');
    est.hidden = false; est.className = 'vp-estado'; est.textContent = 'Cargando…';
    _abierto = null;
    try {
      var r = await pedir(inp.value);
      _cierres = (r && Array.isArray(r.cierres)) ? r.cierres : [];
      est.hidden = true;
      pintar();
    } catch (e) {
      _cierres = [];
      pintar();
      est.hidden = false;
      est.className = 'vp-estado vp-estado--error';
      est.textContent = e && e.message ? e.message : String(e);
    }
  }

  function elegir(pest) {
    _pestana = pest;
    var esVentas = pest === 'ventas';
    $('vpPanelVentas').hidden = !esVentas;
    $('vpPanelCierres').hidden = esVentas;
    $('vpTabVentas').classList.toggle('vp-tab--activa', esVentas);
    $('vpTabCierres').classList.toggle('vp-tab--activa', !esVentas);
    $('vpTabVentas').setAttribute('aria-selected', esVentas ? 'true' : 'false');
    $('vpTabCierres').setAttribute('aria-selected', esVentas ? 'false' : 'true');
    if (!esVentas) { cargar(); }
  }

  function montar() {
    if (!$('vpPanelCierres')) { return; }
    $('vpTabVentas').addEventListener('click', function () { elegir('ventas'); });
    $('vpTabCierres').addEventListener('click', function () { elegir('cierres'); });
    /* El mismo selector de día, «Hoy» y «Actualizar» sirven para las dos
     * pestañas: si la de cierres está abierta, también se recarga. */
    ['vpDia', 'vpHoy', 'vpRecargar'].forEach(function (id) {
      var el = $(id); if (!el) { return; }
      el.addEventListener(id === 'vpDia' ? 'change' : 'click', function () {
        if (_pestana === 'cierres') { setTimeout(cargar, 0); }
      });
    });
    $('vcCuerpo').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-imprimir]');
      if (b) { imprimir(_cierres[parseInt(b.getAttribute('data-imprimir'), 10)]); return; }
      var tr = ev.target.closest('.vc-fila');
      if (!tr) { return; }
      var i = parseInt(tr.getAttribute('data-i'), 10);
      _abierto = (_abierto === i) ? null : i;
      pintar();
    });
    $('vcCuerpo').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.classList.contains('vc-fila')) { ev.target.click(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }

  window.CasaMotaCierresPOS = { _cargar: cargar, _elegir: elegir, _imprimir: imprimir };
})();
