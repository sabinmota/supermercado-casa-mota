/* ════════════════════════════════════════════════════════════════════════════
 * VENTAS POS · sección del panel
 * Creado 2026-09-23 · build 469 · depende de seguridad/72-leer-ventas-pos.sql
 *
 * Muestra las ventas de la caja de un día (hora de RD): totales por forma de
 * pago, ITBIS, resumen por cajera y la lista de tickets con sus artículos.
 *
 * 🔴 FICHERO APARTE: no toca admin.v33.js. Se carga al entrar en la sección
 *    envolviendo showSection().
 * 🔴 LAS VENTAS NO SE LEEN DE LA TABLA: `pos_ventas` no tiene permisos para
 *    la clave pública. Se piden a la RPC `admin_ventas_pos`, que exige el vale
 *    del panel y rol superadmin/admin EN LA BASE.
 * 🔴 Todo texto que viene de la base se ESCAPA antes de pintarlo (nombres de
 *    productos y de cajeras).
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
  function hoyRD() {
    /* Fecha de hoy en República Dominicana, no la del ordenador en UTC. */
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }

  var NOMBRE_PAGO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
  var MENSAJES = {
    NO_INSTALADO:       'Falta ejecutar seguridad/72-leer-ventas-pos.sql en Supabase.',
    ROL_NO_AUTORIZADO:  'Solo el superadministrador o un administrador puede ver las ventas.',
    SESION_INVALIDA:    'Su sesión caducó. Vuelva a entrar al panel.',
    SESION_CADUCADA:    'Su sesión caducó. Vuelva a entrar al panel.',
    CUENTA_DESACTIVADA: 'Su usuario está desactivado.'
  };

  var _ventas = [];
  var _abierta = null;
  var _puedeAnular = false;   // lo decide la BASE (solo superadmin); aquí solo se muestra el botón

  var MENSAJES_ANULAR = {
    NO_INSTALADO:      'Falta ejecutar seguridad/73-anular-y-autorizar-pos.sql en Supabase.',
    ROL_NO_AUTORIZADO: 'Solo el superadministrador puede anular ventas.',
    MOTIVO_REQUERIDO:  'Escriba el motivo de la anulación (mínimo 4 letras).',
    YA_ANULADA:        'Esa venta ya estaba anulada.',
    VENTA_NO_EXISTE:   'La venta no existe.',
    SESION_INVALIDA:   'Su sesión caducó. Vuelva a entrar al panel.',
    SESION_CADUCADA:   'Su sesión caducó. Vuelva a entrar al panel.'
  };

  async function anular(v) {
    var motivo = window.prompt('Anular el ticket Nº ' + String(v.numero).padStart(6, '0') +
      ' (' + dinero(v.total) + ').\n\nEscriba el motivo de la anulación:');
    if (motivo === null) { return; }
    motivo = motivo.trim();
    if (motivo.length < 4) { aviso(MENSAJES_ANULAR.MOTIVO_REQUERIDO, 'error'); return; }
    try {
      var res = await fetch(_SB_URL + '/rpc/admin_anular_venta_pos', {
        method: 'POST', headers: _SB_HEADERS,
        body: JSON.stringify({ p_vale: (typeof _valeAdmin === 'function') ? _valeAdmin() : '', p_id: v.id, p_motivo: motivo })
      });
      var txt = await res.text();
      if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { throw new Error(MENSAJES_ANULAR.NO_INSTALADO); }
      if (!res.ok) {
        for (var k in MENSAJES_ANULAR) { if (txt.indexOf(k) >= 0) { throw new Error(MENSAJES_ANULAR[k]); } }
        throw new Error('No se pudo anular (HTTP ' + res.status + ').');
      }
      aviso('Ticket Nº ' + String(v.numero).padStart(6, '0') + ' anulado', 'success');
      await cargar();
    } catch (e) {
      aviso(e && e.message ? e.message : String(e), 'error');
    }
  }

  function aviso(txt, tipo) {
    if (typeof showAdminToast === 'function') { showAdminToast(txt, tipo); }
    else { window.alert(txt); }
  }

  async function pedir(dia) {
    var res = await fetch(_SB_URL + '/rpc/admin_ventas_pos', {
      method: 'POST', headers: _SB_HEADERS,
      body: JSON.stringify({ p_vale: (typeof _valeAdmin === 'function') ? _valeAdmin() : '', p_dia: dia })
    });
    var txt = await res.text();
    if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { throw new Error(MENSAJES.NO_INSTALADO); }
    if (!res.ok) {
      for (var k in MENSAJES) { if (txt.indexOf(k) >= 0) { throw new Error(MENSAJES[k]); } }
      throw new Error('No se pudieron leer las ventas (HTTP ' + res.status + ').');
    }
    var j = JSON.parse(txt);
    return Array.isArray(j) ? j[0] : j;
  }

  /* Totales del día. Las ventas anuladas se listan pero NO suman. */
  function resumir(ventas) {
    var r = { total: 0, itbis: 0, n: 0, efectivo: 0, tarjeta: 0, transferencia: 0, cajeras: {} };
    for (var i = 0; i < ventas.length; i++) {
      var v = ventas[i];
      if (v.anulada) { continue; }
      var t = Number(v.total) || 0;
      r.total += t; r.itbis += Number(v.itbis) || 0; r.n++;
      if (r[v.forma_pago] !== undefined) { r[v.forma_pago] += t; }
      var c = v.cajera || '—';
      if (!r.cajeras[c]) { r.cajeras[c] = { n: 0, total: 0, efectivo: 0 }; }
      r.cajeras[c].n++; r.cajeras[c].total += t;
      if (v.forma_pago === 'efectivo') { r.cajeras[c].efectivo += t; }
    }
    return r;
  }

  function pintar() {
    var r = resumir(_ventas);
    $('vpTotal').textContent     = dinero(r.total);
    $('vpNum').textContent       = r.n + (r.n === 1 ? ' venta' : ' ventas');
    $('vpEfectivo').textContent  = dinero(r.efectivo);
    $('vpTarjeta').textContent   = dinero(r.tarjeta);
    $('vpTransf').textContent    = dinero(r.transferencia);
    $('vpItbis').textContent     = dinero(r.itbis);

    var nombres = Object.keys(r.cajeras);
    $('vpCajeras').innerHTML = nombres.length
      ? nombres.map(function (c) {
          var x = r.cajeras[c];
          return '<div class="vp-cajera"><b>' + esc(c) + '</b>' +
                 '<span>' + x.n + (x.n === 1 ? ' venta' : ' ventas') + '</span>' +
                 '<span>Total ' + dinero(x.total) + '</span>' +
                 '<span>Efectivo en caja ' + dinero(x.efectivo) + '</span></div>';
        }).join('')
      : '<p class="vp-vacio">Sin ventas.</p>';

    var cuerpo = $('vpCuerpo');
    if (!_ventas.length) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="vp-vacio">No hay ventas en este día.</td></tr>';
      return;
    }
    var h = '';
    for (var i = 0; i < _ventas.length; i++) {
      var v = _ventas[i];
      h += '<tr class="vp-fila' + (v.anulada ? ' vp-fila--anulada' : '') + '" data-i="' + i + '" tabindex="0">' +
             '<td><b>' + esc(String(v.numero).padStart(6, '0')) + '</b>' + (v.anulada ? ' <span class="vp-anulada">ANULADA</span>' : '') + '</td>' +
             '<td>' + esc(v.hora) + '</td>' +
             '<td>' + esc(v.cajera) + '</td>' +
             '<td>' + esc(v.caja) + '</td>' +
             '<td>' + esc(NOMBRE_PAGO[v.forma_pago] || v.forma_pago || '—') + '</td>' +
             '<td class="n">' + esc(Number(v.articulos || 0).toLocaleString('es-DO')) + '</td>' +
             '<td class="n">' + dinero(v.itbis) + '</td>' +
             '<td class="n"><b>' + dinero(v.total) + '</b></td>' +
           '</tr>';
      if (_abierta === i) { h += detalle(v); }
    }
    cuerpo.innerHTML = h;
  }

  function detalle(v) {
    var ls = Array.isArray(v.lineas) ? v.lineas : [];
    var filas = ls.map(function (l) {
      var cant = l.esPeso ? Number(l.cantidad).toFixed(2) + ' lb' : String(l.cantidad);
      return '<tr><td>' + esc(l.nombre) + '</td><td class="n">' + esc(cant) + '</td>' +
             '<td class="n">' + dinero(l.precio) + '</td><td class="n">' + esc(l.tasa) + '%</td>' +
             '<td class="n">' + dinero(l.importe !== undefined ? l.importe : l.precio * l.cantidad) + '</td></tr>';
    }).join('');
    var pago = v.forma_pago === 'efectivo'
      ? 'Recibido ' + dinero(v.recibido) + ' · Cambio ' + dinero(v.cambio)
      : (NOMBRE_PAGO[v.forma_pago] || v.forma_pago);
    var extra = v.anulada
      ? '<p class="vp-detalle__anul">ANULADA' + (v.anulada_en ? ' el ' + esc(v.anulada_en) : '') +
        (v.anulada_por ? ' por ' + esc(v.anulada_por) : '') +
        (v.motivo_anulacion ? ' · Motivo: ' + esc(v.motivo_anulacion) : '') + '</p>'
      : (_puedeAnular ? '<button type="button" class="vp-anular" data-anular="' + esc(v.id) + '">' +
                        '<i class="fas fa-ban"></i> Anular venta</button>' : '');
    return '<tr class="vp-detalle"><td colspan="8">' +
             '<table class="vp-lineas"><thead><tr><th>Artículo</th><th class="n">Cant.</th>' +
             '<th class="n">Precio</th><th class="n">ITBIS</th><th class="n">Importe</th></tr></thead>' +
             '<tbody>' + (filas || '<tr><td colspan="5">Sin detalle.</td></tr>') + '</tbody></table>' +
             '<p class="vp-detalle__pie">Subtotal ' + dinero(v.subtotal) + ' · ITBIS ' + dinero(v.itbis) +
             ' · <b>Total ' + dinero(v.total) + '</b> · ' + esc(pago) + '</p>' +
             extra +
           '</td></tr>';
  }

  async function cargar() {
    var inp = $('vpDia');
    if (!inp) { return; }
    if (!inp.value) { inp.value = hoyRD(); }
    var est = $('vpEstado');
    est.textContent = 'Cargando…';
    est.className = 'vp-estado';
    _abierta = null;
    try {
      var r = await pedir(inp.value);
      _ventas = (r && Array.isArray(r.ventas)) ? r.ventas : [];
      _puedeAnular = !!(r && r.puede_anular);
      est.textContent = _ventas.length ? '' : '';
      est.hidden = true;
      pintar();
    } catch (e) {
      _ventas = [];
      pintar();
      est.hidden = false;
      est.textContent = e && e.message ? e.message : String(e);
      est.className = 'vp-estado vp-estado--error';
    }
  }

  function montar() {
    if (!$('sec-ventaspos')) { return; }
    $('vpDia').value = hoyRD();
    $('vpDia').addEventListener('change', cargar);
    $('vpRecargar').addEventListener('click', cargar);
    $('vpHoy').addEventListener('click', function () { $('vpDia').value = hoyRD(); cargar(); });
    $('vpCuerpo').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-anular]');
      if (b) {
        var id = b.getAttribute('data-anular');
        for (var k = 0; k < _ventas.length; k++) { if (_ventas[k].id === id) { anular(_ventas[k]); break; } }
        return;
      }
      var tr = ev.target.closest('.vp-fila');
      if (!tr) { return; }
      var i = parseInt(tr.getAttribute('data-i'), 10);
      _abierta = (_abierta === i) ? null : i;
      pintar();
    });
    $('vpCuerpo').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.classList.contains('vp-fila')) { ev.target.click(); }
    });

    if (typeof window.showSection === 'function' && !window.showSection._conVentas) {
      var original = window.showSection;
      var envuelta = function (id) {
        var r = original.apply(this, arguments);
        if (id === 'ventaspos') { cargar(); }
        return r;
      };
      envuelta._conVentas = true;
      envuelta._conMas = original._conMas;
      window.showSection = envuelta;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }

  window.CasaMotaVentasPOS = { _cargar: cargar, _resumir: resumir,
    _pintar: function (v, puede) { _ventas = v; _puedeAnular = !!puede; pintar(); },
    _abrir: function (i) { _abierta = i; pintar(); } };
})();
