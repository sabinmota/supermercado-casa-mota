/* ════════════════════════════════════════════════════════════════════════════
 * BORRAR CUENTA · Casa Mota
 * Creado: 2026-09-22 · exigido por Apple (directriz 5.1.1(v))
 *
 * 🔴 POR QUÉ EXISTE: Apple rechazó la app el 2026-09-21 con la frase
 *    «Account deletion is required in apps that support account creation».
 *    La tienda deja registrarse y no dejaba borrarse.
 *
 * 🔴 FICHERO NUEVO Y APARTE. No modifica `app.js` ni `auth.js`. Se engancha
 *    solo si encuentra su contenedor en el HTML, así que cargarlo en una
 *    página que no lo tenga no rompe nada.
 *
 * 🔴 EN UN .js EXTERNO, NO EN UN <script> EMBEBIDO: este código construye
 *    HTML en cadenas, y dentro de un script embebido una secuencia de cierre
 *    rompe el parseo y vuelca el resto de la página como texto visible SIN
 *    dar un solo error de consola. Ya pasó en este proyecto.
 *
 * DEPENDE DE: js/api.js (para `_SB_URL`, `_SB_HEADERS` y el vale de cliente)
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var VALE_KEY = 'cm_cliente_vale';   // misma clave que usa js/api.js

  function $(id) { return document.getElementById(id); }

  function vale() {
    try { return sessionStorage.getItem(VALE_KEY) || ''; }
    catch (e) { return ''; }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * LLAMADA A LA RPC
   *
   * 🔴 NO SE MANDA NI CORREO NI ID. La identidad sale del vale y solo del
   *    vale. Si la función aceptara `p_email`, cualquiera podría mandar el
   *    correo ajeno y borrar la cuenta de otra persona — recuérdese que la
   *    clave `anon` está PUBLICADA en js/api.js:22.
   * ══════════════════════════════════════════════════════════════════════ */
  async function borrarEnLaBase() {
    var v = vale();
    if (!v) {
      throw new Error('Tu sesión caducó. Vuelve a entrar para borrar tu cuenta.');
    }

    var res = await fetch(_SB_URL + '/rpc/cliente_borrar_cuenta', {
      method:  'POST',
      headers: _SB_HEADERS,
      body:    JSON.stringify({ p_vale: v })
    });

    var texto = await res.text();

    if (!res.ok) {
      /* Mensajes concretos: «no se pudo» no dice si hay que volver a entrar
       * o si es un fallo del servidor. */
      if (texto.indexOf('SESION_INVALIDA') >= 0) {
        throw new Error('Tu sesión caducó. Vuelve a entrar e inténtalo de nuevo.');
      }
      if (texto.indexOf('CUENTA_NO_ENCONTRADA') >= 0) {
        throw new Error('Esta cuenta ya no existe.');
      }
      console.error('[borrar-cuenta] HTTP ' + res.status + ' · ' + texto);
      throw new Error('No se pudo completar el borrado (' + res.status + '). ' +
                      'Inténtalo más tarde o escríbenos.');
    }

    /* 🔴 UN 200 NO BASTA. Cuando RLS oculta una fila, PostgREST devuelve
     *    200 OK con cuerpo vacío — fue la causa del build 461, donde los
     *    cupones «se guardaban» sin guardarse. Aquí, dar por borrada una
     *    cuenta que sigue viva sería peor: el usuario creería que sus datos
     *    desaparecieron. Se exige que la respuesta traiga `ok`. */
    var datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = null; }
    if (Array.isArray(datos)) { datos = datos[0]; }

    if (!datos || datos.ok !== true) {
      console.error('[borrar-cuenta] respuesta inesperada:', texto);
      throw new Error('El servidor no confirmó el borrado. ' +
                      'Tu cuenta NO se ha eliminado. Escríbenos para revisarlo.');
    }

    return datos;
  }

  /* ── Limpieza local ─────────────────────────────────────────────────────
   * Tras borrar en la base hay que dejar el navegador limpio. Si no, el
   * carrito y los favoritos del build 422c seguirían en `localStorage` con
   * el id del cliente borrado. */
  function limpiarNavegador() {
    try {
      sessionStorage.removeItem(VALE_KEY);
      sessionStorage.removeItem('cm_cliente_sesion');
      localStorage.removeItem('cm_cliente_sesion');

      /* Las claves de carrito y favoritos llevan el id detrás
       * (`casamota_cart_<id>`), así que se barren por prefijo. */
      var fuera = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf('casamota_cart') === 0 ||
                  k.indexOf('casamota_favorites') === 0)) {
          fuera.push(k);
        }
      }
      for (var j = 0; j < fuera.length; j++) { localStorage.removeItem(fuera[j]); }
    } catch (e) { /* modo privado: no hay nada que limpiar */ }
  }

  /* ── Flujo de la pantalla ───────────────────────────────────────────── */
  function montar() {
    var abrir = $('bc-abrir');
    if (!abrir) { return; }          // la página no tiene esta sección

    abrir.addEventListener('click', function () {
      $('bc-modal').hidden = false;
      $('bc-paso1').hidden = false;
      $('bc-paso2').hidden = true;
      $('bc-hecho').hidden = true;
      $('bc-error').hidden = true;
      $('bc-confirmacion').value = '';
      $('bc-final').disabled = true;
    });

    $('bc-cancelar').addEventListener('click', cerrar);
    $('bc-cancelar2').addEventListener('click', cerrar);

    $('bc-seguir').addEventListener('click', function () {
      $('bc-paso1').hidden = true;
      $('bc-paso2').hidden = false;
      $('bc-confirmacion').focus();
    });

    /* 🔴 SE EXIGE ESCRIBIR «ELIMINAR» A MANO.
     *    Un borrado irreversible detrás de un solo botón se pulsa por error.
     *    Apple pide que se pueda borrar la cuenta, no que sea fácil hacerlo
     *    sin querer. */
    $('bc-confirmacion').addEventListener('input', function (ev) {
      var ok = ev.target.value.trim().toUpperCase() === 'ELIMINAR';
      $('bc-final').disabled = !ok;
    });

    $('bc-final').addEventListener('click', ejecutar);
  }

  function cerrar() {
    $('bc-modal').hidden = true;
  }

  async function ejecutar() {
    var btn = $('bc-final');
    var err = $('bc-error');

    btn.disabled = true;
    btn.textContent = 'Eliminando…';
    err.hidden = true;

    try {
      var r = await borrarEnLaBase();
      limpiarNavegador();

      $('bc-paso2').hidden = true;
      $('bc-hecho').hidden = false;

      /* Se dice lo que ha pasado con los pedidos, no se oculta. */
      var det = $('bc-detalle');
      if (det && r.pedidos_anonimos > 0) {
        det.textContent = 'Se desvincularon ' + r.pedidos_anonimos +
          ' pedido(s) de tu nombre. Se conservan sin tus datos personales ' +
          'porque son comprobantes de venta.';
        det.hidden = false;
      }

      /* Se sale a la portada sola: dejar la tienda abierta con una sesión
       * que ya no existe daría errores raros en cada pantalla. */
      setTimeout(function () { window.location.href = 'index.html'; }, 6000);

    } catch (e) {
      err.textContent = e && e.message ? e.message : String(e);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Eliminar mi cuenta definitivamente';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }

  window.CasaMotaBorrarCuenta = { _borrar: borrarEnLaBase, _limpiar: limpiarNavegador };
})();
