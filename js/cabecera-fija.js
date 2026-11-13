/* ════════════════════════════════════════════════════════════════════════════
 * 546 · LA CABECERA SE IBA CON LA PÁGINA AL TENER EL TECLADO ABIERTO (iPhone)
 *
 * Síntoma (vídeo del dueño, app y Safari): con el teclado abierto, al arrastrar
 * la pantalla se movía TODO —logo, buscador, Avisos, Favoritos— y arriba
 * quedaba un hueco blanco. Sin teclado, la cabecera se queda fija bien.
 *
 * Causa: en iOS, con el teclado abierto, lo que se ve se desliza por encima de
 * la página, y un `position: fixed` se queda pegado a la página, no a la
 * pantalla. Pasa igual en Safari y en la app (WKWebView).
 *
 * v1 (descartada por el dueño): bajaba la cabecera con JS siguiendo ese
 * desplazamiento. Quedaba fija, pero TEMBLABA: iOS mueve la pantalla primero
 * y avisa después, así que la cabecera siempre llega un instante tarde.
 * Perseguir el desplazamiento con JS no se puede hacer sin temblor.
 *
 * v2 (esta): lo que hacen las apps nativas de iPhone (App Store, Instagram…):
 * en cuanto el cliente ARRASTRA la pantalla con el teclado abierto, el teclado
 * se baja solo. Sin teclado, iOS ya mantiene la cabecera fija y el
 * desplazamiento es el normal. No se mueve nada por JS: cero temblor.
 *
 * No actúa:
 *  - en un toque corto (menos de 10 px): escribir y tocar sugerencias sigue
 *    igual;
 *  - si el dedo empieza sobre el propio campo (mover el cursor, seleccionar);
 *  - si el campo está dentro de una ventana o panel fijo (carrito, checkout,
 *    detalle…): ahí la cabecera no se ve y no hay nada que arreglar.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var cab = document.querySelector('header.header');
  if (!cab) return;

  var UMBRAL = 10;      // px de arrastre para considerar que «desplaza»
  var y0 = null;

  function esCampoConTeclado(el) {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'tel', 'email', 'password', 'number', 'url'].indexOf(t) >= 0;
  }

  // ¿El campo está dentro de una ventana/panel fijo que no sea la cabecera?
  function enPanelFijo(el) {
    for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (n === cab) return false;
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }

  document.addEventListener('touchstart', function (e) {
    var a = document.activeElement;
    y0 = null;
    if (!esCampoConTeclado(a)) return;
    if (a === e.target || a.contains(e.target)) return;   // dedo sobre el campo
    if (enPanelFijo(a)) return;
    y0 = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (y0 === null) return;
    if (Math.abs(e.touches[0].clientY - y0) < UMBRAL) return;
    y0 = null;
    var a = document.activeElement;
    if (esCampoConTeclado(a)) a.blur();                    // baja el teclado
  }, { passive: true });

  document.addEventListener('touchend', function () { y0 = null; }, { passive: true });
  document.addEventListener('touchcancel', function () { y0 = null; }, { passive: true });
})();
