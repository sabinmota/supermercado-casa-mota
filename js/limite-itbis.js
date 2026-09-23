/* ════════════════════════════════════════════════════════════════════════════
 * LÍMITE DIARIO DE ITBIS · tarjeta del panel (Configuración)
 * Creado 2026-09-23 · POS-2 · depende de seguridad/69-limite-itbis-diario.sql
 *
 * 🔴 FICHERO APARTE: no toca admin.v33.js. Se engancha solo si encuentra
 *    #cardLimiteItbis; si no está, no hace nada.
 *
 * 🔴 NO USA saveSettings(). El límite vive en `pos_config`, sin permisos para
 *    la clave pública; se lee con `pos_estado_limite` y se cambia con
 *    `admin_fijar_limite_itbis`, que exige vale y rol superadmin EN LA BASE.
 *    La comprobación del rol no se hace aquí: el navegador se puede fingir.
 *
 * DEPENDE DE: js/api.js (_SB_URL, _SB_HEADERS, _valeAdmin)
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function dinero(n) {
    return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function rpc(nombre, cuerpo) {
    var res = await fetch(_SB_URL + '/rpc/' + nombre, {
      method: 'POST', headers: _SB_HEADERS, body: JSON.stringify(cuerpo)
    });
    var txt = await res.text();
    if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { throw new Error('NO_INSTALADO'); }
    if (!res.ok) {
      if (txt.indexOf('ROL_NO_AUTORIZADO') >= 0) { throw new Error('ROL'); }
      if (txt.indexOf('LIMITE_INVALIDO') >= 0)   { throw new Error('INVALIDO'); }
      if (/SESION_(INVALIDA|CADUCADA)/.test(txt)) { throw new Error('SESION'); }
      throw new Error('HTTP ' + res.status + ' · ' + txt);
    }
    var j = txt ? JSON.parse(txt) : null;
    return Array.isArray(j) ? j[0] : j;
  }

  function pintarEstado(e) {
    var el = $('limiteItbisEstado');
    var lim = e && e.limite !== null && e.limite !== undefined ? Number(e.limite) : null;
    var acum = Number(e && e.acumulado) || 0;
    if (!lim) {
      el.innerHTML = 'Sin límite. ITBIS facturado hoy: <b>RD$ ' + dinero(acum) + '</b>';
      el.style.color = '#374151';
      return;
    }
    var lleno = acum >= lim;
    el.innerHTML = 'ITBIS facturado hoy: <b>RD$ ' + dinero(acum) + '</b> de RD$ ' + dinero(lim) +
      (lleno ? ' · <b>🔴 CAJAS BLOQUEADAS</b> — suba el límite para desbloquear'
             : ' · quedan RD$ ' + dinero(lim - acum));
    el.style.color = lleno ? '#b42318' : '#0f7b34';
  }

  function explicar(err) {
    var m = err && err.message;
    if (m === 'NO_INSTALADO') { return 'Falta ejecutar seguridad/69-limite-itbis-diario.sql en Supabase.'; }
    if (m === 'ROL')          { return 'Solo el superadministrador puede cambiar el límite.'; }
    if (m === 'INVALIDO')     { return 'El límite no puede ser negativo.'; }
    if (m === 'SESION')       { return 'Su sesión caducó. Vuelva a entrar al panel.'; }
    return 'No se pudo completar: ' + m;
  }

  async function cargar() {
    try {
      var e = await rpc('pos_estado_limite', { p_vale: _valeAdmin() });
      $('limiteItbisInput').value = e && e.limite ? Number(e.limite).toFixed(2) : '';
      pintarEstado(e);
    } catch (err) {
      $('limiteItbisEstado').textContent = explicar(err);
      $('limiteItbisEstado').style.color = '#b42318';
    }
  }

  async function guardar() {
    var btn = $('limiteItbisGuardar');
    var bruto = String($('limiteItbisInput').value || '').trim();
    var valor = bruto === '' ? null : Number(bruto);
    if (valor !== null && (!isFinite(valor) || valor < 0)) {
      showAdminToast('Escriba una cifra válida (0 o mayor)', 'error');
      return;
    }
    btn.disabled = true;
    try {
      var e = await rpc('admin_fijar_limite_itbis', { p_vale: _valeAdmin(), p_limite: valor });
      pintarEstado(e);
      $('limiteItbisInput').value = e && e.limite ? Number(e.limite).toFixed(2) : '';
      showAdminToast(e && e.limite ? '✅ Límite diario guardado: RD$ ' + dinero(e.limite)
                                   : '✅ Límite quitado: el POS factura sin límite', 'success');
    } catch (err) {
      showAdminToast(explicar(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function montar() {
    if (!$('cardLimiteItbis')) { return; }
    $('limiteItbisGuardar').addEventListener('click', guardar);
    cargar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }

  window.CasaMotaLimiteItbis = { _cargar: cargar, _guardar: guardar };
})();
