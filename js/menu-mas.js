/* ════════════════════════════════════════════════════════════════════════════
 * MENÚ «··· MÁS» · barra lateral del panel
 * Creado 2026-09-23 · build 469 · pedido del dueño
 *
 * Va justo después de «Configuración». Decisión del dueño (469b): el menú
 * queda igual que antes y SOLO «Respaldo» y «Ventas POS» van dentro.
 *
 * 🔴 FICHERO APARTE: no toca admin.v33.js. Envuelve showSection() SOLO para
 *    abrir el desplegable cuando la sección activa está dentro (por ejemplo,
 *    si otra parte del panel navega a «Respaldo» por código).
 * 🔴 Si el rol no tiene ninguna opción de «Más» (applyPermissions las oculta
 *    todas), la fila «Más» también desaparece: nada de un desplegable vacío.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function abrir(si) {
    var btn = $('navMas'), lista = $('navMasLista');
    if (!btn || !lista) { return; }
    lista.hidden = !si;
    btn.setAttribute('aria-expanded', si ? 'true' : 'false');
  }

  /* Abre el desplegable si la opción activa está dentro. */
  function sincronizar() {
    var lista = $('navMasLista');
    if (lista && lista.querySelector('.nav-link.active')) { abrir(true); }
  }

  /* Oculta «Más» si todas sus opciones están ocultas para este rol. */
  function revisarVisibles() {
    var lista = $('navMasLista'), li = document.querySelector('.dsh-more-li');
    if (!lista || !li) { return; }
    var items = lista.querySelectorAll(':scope > li');
    var alguno = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].style.display !== 'none') { alguno = true; break; }
    }
    li.style.display = alguno ? '' : 'none';
  }

  function montar() {
    var btn = $('navMas');
    if (!btn) { return; }
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var lista = $('navMasLista');
      var abriendo = lista.hidden;
      abrir(abriendo);
      /* Si al abrir no cabe todo, el menú se desliza solo hasta la última
       * opción (el menú ya tiene desplazamiento propio con la rueda). */
      if (abriendo && lista.lastElementChild && lista.lastElementChild.scrollIntoView) {
        lista.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    if (typeof window.showSection === 'function' && !window.showSection._conMas) {
      var original = window.showSection;
      var envuelta = function () {
        var r = original.apply(this, arguments);
        sincronizar();
        return r;
      };
      envuelta._conMas = true;
      window.showSection = envuelta;
    }

    /* applyPermissions() corre en DOMContentLoaded de admin.v33.js; se
     * revisa después para no leer el estado antes de que oculte nada. */
    setTimeout(function () { revisarVisibles(); sincronizar(); }, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }

  window.CasaMotaMenuMas = { abrir: abrir, _revisar: revisarVisibles };
})();
