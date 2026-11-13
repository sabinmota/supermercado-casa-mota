/* ════════════════════════════════════════════════════════════════════════════
 * 545 · BÚSQUEDA POR VOZ EN LA TIENDA
 *
 * Botón 🎤 junto a la lupa. Se pulsa, se habla («arroz selecto») y, al callarse,
 * lo dicho se escribe en el buscador y se busca solo, igual que con la lupa.
 *
 * Usa el dictado del propio navegador (Web Speech API): Chrome y Edge en PC,
 * Chrome en Android y Safari en iPhone/iPad. Firefox no lo tiene: ahí el botón
 * no aparece. Exige HTTPS (el dominio ya lo tiene). Misma base que el dictado
 * de Maya en el panel (js/chat.js, build 520), que ya está probado.
 *
 * 🔴 EN LA APP NO SE ACTIVA (hasta la versión 1.0.2): iOS cierra la app al
 *    instante si pide el micrófono sin tener declarado `NSMicrophoneUsageDescription`
 *    y `NSSpeechRecognitionUsageDescription` en el Info.plist, y la 1.0.1 no
 *    los tiene. Se comprueba aquí y también en el CSS (doble seguro).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  function enApp() {
    try {
      if (window.CasaMotaNativo && typeof CasaMotaNativo.enApp === 'function' && CasaMotaNativo.enApp()) return true;
    } catch (e) { /* sigue */ }
    return document.documentElement.classList.contains('es-app-nativa');
  }

  var disponible = !!Reconocedor && !enApp();
  if (disponible) document.documentElement.classList.add('voz-disponible');

  var rec = null;
  var escuchando = false;
  var texto = '';
  var placeholderOriginal = '';

  function $(id) { return document.getElementById(id); }

  function avisar(msg, tipo) {
    if (typeof window.showToast === 'function') window.showToast(msg, tipo || 'info');
    else console.warn('[voz] ' + msg);
  }

  // Safari y Chrome a veces añaden un punto final o mayúscula inicial.
  function limpiar(t) {
    return String(t || '').replace(/[.,;:!?¡¿]+$/g, '').replace(/\s+/g, ' ').trim();
  }

  function pintar() {
    var b = $('btnVozBuscar'), inp = $('searchInput');
    if (b) {
      b.classList.toggle('escuchando', escuchando);
      b.setAttribute('aria-pressed', escuchando ? 'true' : 'false');
      b.title = escuchando ? 'Escuchando… pulsa para parar' : 'Buscar por voz';
      // El icono es SIEMPRE el micrófono (el dueño no quiere el cuadrado de «grabar»).
    }
    if (inp) {
      if (!placeholderOriginal) placeholderOriginal = inp.placeholder;
      inp.placeholder = escuchando ? '🎙️ Te escucho… di lo que buscas' : placeholderOriginal;
    }
  }

  var AVISOS = {
    'not-allowed':         '🎙️ No hay permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones (o en Ajustes del móvil) y vuelve a pulsar el micrófono.',
    'service-not-allowed': '🎙️ Este navegador no permite el dictado aquí. Prueba con Chrome (PC o Android) o Safari (iPhone).',
    'audio-capture':       '🎙️ No se encontró ningún micrófono en este equipo.',
    'network':             '📡 La búsqueda por voz necesita internet y no pudo conectar. Inténtalo de nuevo.',
    'language-not-supported': '🎙️ Este navegador no reconoce el español. Escribe tu búsqueda, por favor.'
  };

  function buscarPorVoz() {
    if (!disponible) return;
    if (escuchando && rec) { try { rec.stop(); } catch (e) {} return; }

    var inp = $('searchInput');
    var r = new Reconocedor();
    r.lang = 'es-DO';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    texto = '';
    var fallo = null;

    r.onresult = function (ev) {
      var final = '', provisional = '';
      for (var i = 0; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) final += res[0].transcript; else provisional += res[0].transcript;
      }
      texto = limpiar(final || provisional);
      if (inp) inp.value = texto;     // se ve lo que va entendiendo
    };
    r.onerror = function (ev) { fallo = ev && ev.error; };
    r.onend = function () {
      escuchando = false;
      rec = null;
      pintar();
      if (fallo && fallo !== 'no-speech' && fallo !== 'aborted') {
        avisar(AVISOS[fallo] || ('🎙️ No se pudo usar el micrófono (' + fallo + ').'), 'warning');
        return;
      }
      if (fallo === 'no-speech' || !texto) {
        if (fallo !== 'aborted') avisar('🎙️ No te escuché. Pulsa el micrófono y habla cerca del teléfono.', 'info');
        return;
      }
      if (inp) inp.value = texto;
      if (typeof window._hideLiveResults === 'function') window._hideLiveResults();
      if (typeof window.handleSearch === 'function') window.handleSearch();   // igual que la lupa
    };

    try {
      if (typeof window._hideLiveResults === 'function') window._hideLiveResults();
      if (inp) inp.value = '';
      r.start();
      rec = r;
      escuchando = true;
      pintar();
    } catch (e) {
      console.warn('[voz] no se pudo empezar:', e);
      escuchando = false;
      rec = null;
      pintar();
      avisar('🎙️ No se pudo activar el micrófono. Inténtalo de nuevo.', 'warning');
    }
  }

  window.buscarPorVoz = buscarPorVoz;
  // Para las pruebas automáticas.
  window.BusquedaVoz = { disponible: function () { return disponible; }, escuchando: function () { return escuchando; } };
})();
