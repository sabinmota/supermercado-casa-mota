/* ════════════════════════════════════════════════════════════════════════════
 * 546 · LA CABECERA SE IBA CON LA PÁGINA AL TENER EL TECLADO ABIERTO (iPhone)
 *
 * Síntoma (vídeo del dueño, app y Safari): con el teclado abierto, al arrastrar
 * la pantalla se movía TODO —logo, buscador, Avisos, Favoritos— y arriba
 * quedaba un hueco blanco. Sin teclado, la cabecera se queda fija bien.
 *
 * Causa: en iOS, con el teclado abierto, lo que se ve (el «visual viewport»)
 * es más pequeño que la página y se desliza por encima de ella. Un elemento
 * `position: fixed` queda fijo a la PÁGINA, no a lo que se ve, así que al
 * arrastrar se va con ella. No es un fallo del código de la tienda: es cómo
 * iOS trata `fixed` con el teclado, en Safari y en la app (WKWebView).
 *
 * Arreglo: el navegador dice cuánto se ha desplazado lo visible
 * (`visualViewport.offsetTop`). Se baja la cabecera exactamente eso, para que
 * siga pegada arriba de lo que se ve. Sin teclado ese valor es 0 y la
 * cabecera queda como siempre (no se toca nada).
 *
 * Se mueve con `top` y NO con `transform` a propósito: en /mayor el carrito
 * redondo es `position: fixed` DENTRO de la cabecera, y un `transform` en la
 * cabecera lo arrastraría con ella (dejaría de estar abajo a la derecha).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var vv = window.visualViewport;
  var cab = document.querySelector('header.header');
  if (!vv || !cab) return;

  var pendiente = false;
  var ultimo = 0;

  function aplicar() {
    pendiente = false;
    // Puede ser negativo (tirar hacia abajo con el teclado abierto deja un
    // hueco blanco arriba): también se sigue, para que no aparezca ese hueco
    // entre el borde y la cabecera. Sin teclado es 0 (el zoom está bloqueado).
    var y = Math.round(vv.offsetTop || 0);
    if (y === ultimo) return;
    ultimo = y;
    cab.style.top = y ? y + 'px' : '';
  }

  function pedir() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(aplicar);
  }

  vv.addEventListener('scroll', pedir);
  vv.addEventListener('resize', pedir);
  window.addEventListener('scroll', pedir, { passive: true });
  // Al cerrar el teclado, volver a su sitio aunque iOS no avise del cambio.
  document.addEventListener('focusout', function () { setTimeout(pedir, 50); setTimeout(pedir, 400); });

  aplicar();
})();
