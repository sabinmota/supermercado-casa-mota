/* ════════════════════════════════════════════════════════════════════════════
 * 479 · LA SESIÓN DEL PANEL (Y DE LA CAJA) SE RENUEVA MIENTRAS SE USA
 * Creado 2026-09-26 · depende de seguridad/79-renovar-sesion-panel.sql
 *
 * Pedido del dueño: que no salga «Tu sesión caducó. Vuelve a entrar al panel».
 * El vale dura 12 horas desde que se entra. Con este fichero, mientras haya
 * ACTIVIDAD (ratón, teclado, pistola de la caja), se renueva a 12 horas más.
 * Solo caduca tras 12 horas SEGUIDAS sin tocar nada.
 *
 * 🔴 SIN ACTIVIDAD NO SE RENUEVA: si fuera por reloj, un panel abandonado
 *    seguiría abierto para siempre, que es justo lo que no se quiere.
 * 🔴 Como mucho una renovación cada 10 minutos (no se llama a la base en
 *    cada tecla).
 * 🔴 Si falla (sin red, sesión ya caducada), no avisa ni molesta: el aviso
 *    normal del panel sale solo si de verdad hace falta volver a entrar.
 *
 * DEPENDE DE: js/api.js (_SB_URL, _SB_HEADERS, _valeAdmin). Fichero aparte:
 * no toca admin.v33.js ni pos.js.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CADA_MS      = 10 * 60 * 1000;   // mínimo entre dos renovaciones
  var REVISAR_MS   = 60 * 1000;        // cada minuto se mira si toca renovar
  var _ultimaRenov = 0;                // cuándo se renovó por última vez
  var _ultimaAct   = Date.now();       // última actividad (abrir la página cuenta)
  var _enCurso     = false;
  var _desactivado = false;            // falta el SQL 79: no se insiste

  function vale() {
    try { return (typeof _valeAdmin === 'function') ? _valeAdmin() : ''; } catch (e) { return ''; }
  }

  async function renovar() {
    if (_enCurso || _desactivado) { return; }
    var v = vale();
    if (!v || typeof _SB_URL === 'undefined') { return; }
    _enCurso = true;
    try {
      var res = await fetch(_SB_URL + '/rpc/admin_renovar_sesion', {
        method: 'POST', headers: _SB_HEADERS, body: JSON.stringify({ p_vale: v })
      });
      var txt = await res.text();
      if (res.status === 404 || txt.indexOf('PGRST202') >= 0) {
        _desactivado = true;
        console.warn('[sesión] Falta ejecutar seguridad/79-renovar-sesion-panel.sql: la sesión no se renueva.');
        return;
      }
      var j = null;
      try { j = JSON.parse(txt); j = Array.isArray(j) ? j[0] : j; } catch (e) { j = null; }
      if (j && j.ok) { _ultimaRenov = Date.now(); }
      else if (j && j.error) { console.warn('[sesión] no se renovó:', j.error); _ultimaRenov = Date.now(); }
    } catch (e) {
      /* sin red: se reintenta en la próxima revisión */
    } finally {
      _enCurso = false;
    }
  }

  function revisar() {
    /* Solo si hubo actividad DESPUÉS de la última renovación y ya pasaron 10 min */
    if (_ultimaAct > _ultimaRenov && Date.now() - _ultimaRenov >= CADA_MS) { renovar(); }
  }

  function actividad() {
    _ultimaAct = Date.now();
    if (Date.now() - _ultimaRenov >= CADA_MS) { revisar(); }
  }

  ['click', 'keydown', 'mousemove', 'wheel', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, actividad, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { actividad(); }
  });
  setInterval(revisar, REVISAR_MS);

  /* Al abrir la página, se renueva en cuanto haya vale (el login lo crea) */
  setTimeout(revisar, 3000);

  window.CasaMotaSesionViva = { renovar: renovar, _estado: function () {
    return { ultimaRenov: _ultimaRenov, ultimaAct: _ultimaAct, desactivado: _desactivado };
  } };
})();
