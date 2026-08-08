/* ═══════════════════════════════════════════════════════════════════════════════
 *  VIGILANCIA DE PEDIDOS — auto-refresco cada 30 s + aviso sonoro
 *  Supermercado Casa Mota · build 374
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  EL PROBLEMA QUE RESUELVE
 *  ────────────────────────
 *  Los pedidos solo se recargaban al ENTRAR en la sección (admin.v33.js:660).
 *  Si dejabas el panel abierto en la lista, un pedido nuevo no aparecía nunca:
 *  había que salir y volver, o pulsar F5. En un mostrador eso significa
 *  perder pedidos.
 *
 *  CÓMO FUNCIONA
 *  ─────────────
 *  · Sondea `orders` cada 30 s SIEMPRE que el panel esté abierto y haya sesión:
 *    en cualquier sección y también con la pestaña en segundo plano.
 *  · Compara los ids conocidos con los recibidos. Si aparece alguno nuevo
 *    → suena el aviso + toast + parpadeo del título de la pestaña.
 *  · El sonido se genera con Web Audio API (osciladores). No hay ficheros
 *    .mp3 que subir ni que cachear.
 *
 *  POR QUÉ VIGILA EN TODAS LAS SECCIONES (corrección del diseño inicial)
 *  ────────────────────────────────────────────────────────────────────
 *  La primera versión solo vigilaba en Pedidos/Dashboard y con la pestaña
 *  visible, para ahorrar cuota de Supabase. Era la prioridad equivocada:
 *  avisaba justo cuando MENOS falta hace (ya estás mirando la lista) y se
 *  callaba cuando más falta hace (estás en Inventario, o en otra pestaña).
 *  El coste real de vigilar siempre son ~960 consultas/día con el panel 8 h
 *  abierto — nada frente al plan gratuito de Supabase (500.000/mes).
 *
 *  LO QUE ESTO NO HACE
 *  ───────────────────
 *  Con el panel CERRADO no suena nada. Es una limitación del navegador, no
 *  del código: hace falta que la página esté viva. Para avisar con el panel
 *  cerrado se necesitarían notificaciones push (Service Worker + claves VAPID
 *  + un disparador en el servidor), que es una función aparte.
 *
 *  POR QUÉ NO SUPABASE REALTIME
 *  ────────────────────────────
 *  Realtime (WebSocket) sería instantáneo y más elegante, pero exige habilitar
 *  la replicación en la tabla desde el panel de Supabase y su propia ronda de
 *  pruebas. El sondeo reutiliza `DB.getOrders()`, que ya está probado.
 *  Si algún día se migra a Realtime, el único punto a cambiar es _pvSondear().
 *
 *  LIMITACIÓN HONESTA DEL SONIDO
 *  ─────────────────────────────
 *  Los navegadores BLOQUEAN el audio hasta que el usuario interactúa con la
 *  página (política de autoplay). El primer aviso tras cargar el panel puede
 *  no sonar si no has hecho ni un clic. Por eso el AudioContext se
 *  "desbloquea" al primer clic/tecla en cualquier parte del panel.
 *  El toast y el parpadeo del título SÍ funcionan siempre.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  const PV_INTERVALO_MS = 30_000;                 // sondeo cada 30 s
  const PV_KEY_SONIDO   = 'cm_pedidos_sonido';    // localStorage

  let _pvTimer      = null;
  let _pvIdsVistos  = null;   // Set con los ids ya conocidos. null = sin inicializar
  let _pvSonando    = false;
  let _pvAudioCtx   = null;
  let _pvTituloOrig = document.title;
  let _pvTituloTimer= null;
  let _pvSondeando  = false;  // evita solapar dos sondeos lentos

  // ─── Preferencia de sonido ──────────────────────────────────────────────────

  function pvSonidoActivo() {
    // Por defecto ACTIVADO: quien monta una tienda quiere enterarse.
    return localStorage.getItem(PV_KEY_SONIDO) !== 'off';
  }

  function pvToggleSonido() {
    const nuevo = !pvSonidoActivo();
    localStorage.setItem(PV_KEY_SONIDO, nuevo ? 'on' : 'off');
    _pvPintarBotonSonido();
    if (nuevo) {
      _pvDesbloquearAudio();
      _pvSonar();  // confirmación audible de que quedó activo
      if (typeof showAdminToast === 'function') {
        showAdminToast('Aviso sonoro activado 🔔', 'success');
      }
    } else if (typeof showAdminToast === 'function') {
      showAdminToast('Aviso sonoro silenciado 🔇', 'info');
    }
  }

  function _pvPintarBotonSonido() {
    const btn = document.getElementById('pvBtnSonido');
    if (!btn) return;
    const on = pvSonidoActivo();
    btn.innerHTML = on
      ? '<i class="fas fa-bell"></i> Aviso: activado'
      : '<i class="fas fa-bell-slash"></i> Aviso: silenciado';
    btn.title = on
      ? 'Suena un aviso cuando entra un pedido nuevo, estés en cualquier '
        + 'sección del panel. Requiere tener el panel abierto. Clic para silenciar.'
      : 'No sonará ningún aviso. Clic para activarlo.';
    btn.style.opacity = on ? '1' : '.55';
  }

  // ─── Sonido (Web Audio API, sin ficheros externos) ──────────────────────────

  function _pvDesbloquearAudio() {
    try {
      if (!_pvAudioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        _pvAudioCtx = new AC();
      }
      if (_pvAudioCtx.state === 'suspended') _pvAudioCtx.resume();
    } catch (e) {
      console.warn('[pedidos] no se pudo iniciar el audio:', e && e.message);
    }
  }

  // Dos notas ascendentes (do-sol) repetidas: reconocible sin ser estridente.
  function _pvSonar() {
    if (!pvSonidoActivo()) return;
    _pvDesbloquearAudio();
    if (!_pvAudioCtx || _pvAudioCtx.state !== 'running') return;
    if (_pvSonando) return;
    _pvSonando = true;

    try {
      const ctx   = _pvAudioCtx;
      const notas = [
        { f: 523.25, t: 0.00, d: 0.16 },  // do5
        { f: 783.99, t: 0.18, d: 0.22 },  // sol5
        { f: 523.25, t: 0.46, d: 0.16 },
        { f: 783.99, t: 0.64, d: 0.30 },
      ];
      notas.forEach(n => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type            = 'sine';
        osc.frequency.value = n.f;
        // Rampa suave para que no chasquee al empezar/terminar
        const t0 = ctx.currentTime + n.t;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + n.d + 0.02);
      });
    } catch (e) {
      console.warn('[pedidos] fallo al reproducir el aviso:', e && e.message);
    }

    setTimeout(() => { _pvSonando = false; }, 1200);
  }

  // ─── Parpadeo del título de la pestaña ──────────────────────────────────────
  // Útil cuando el panel está en una pestaña de fondo.

  function _pvParpadearTitulo(n) {
    if (_pvTituloTimer) { clearInterval(_pvTituloTimer); _pvTituloTimer = null; }
    const aviso = `🔔 ${n} pedido${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}`;
    let alterna = false;
    _pvTituloTimer = setInterval(() => {
      document.title = alterna ? _pvTituloOrig : aviso;
      alterna = !alterna;
    }, 1000);
    // Al volver a la pestaña, restaurar el título
    const restaurar = () => {
      if (document.hidden) return;
      if (_pvTituloTimer) { clearInterval(_pvTituloTimer); _pvTituloTimer = null; }
      document.title = _pvTituloOrig;
      document.removeEventListener('visibilitychange', restaurar);
    };
    document.addEventListener('visibilitychange', restaurar);
  }

  // ─── Sondeo ─────────────────────────────────────────────────────────────────

  function _pvSeccionActiva() {
    const sec = document.querySelector('.section-content.active');
    return sec ? String(sec.id || '').replace(/^sec-/, '') : '';
  }

  // ¿Hay algún modal abierto? Si lo hay, NO se repinta la tabla:
  // renderOrdersTable() reconstruye el <tbody> y podría estropear algo que el
  // usuario esté editando encima.
  //
  // En este panel los modales se ocultan con la clase `.hidden` (no con
  // `.show`/`.active`) y algunos con `style.display`. En vez de adivinar la
  // convención, se comprueba la visibilidad real con offsetParent.
  function _pvHayModalAbierto() {
    const modales = document.querySelectorAll('.modal-backdrop');
    for (const m of modales) {
      if (m.offsetParent !== null) return true;
    }
    return false;
  }

  // Solo dos motivos para NO sondear:
  //  1) no hay sesión de staff → estamos en el login, no hay nada que vigilar
  //  2) la API todavía no está cargada
  function _pvDebeVigilar() {
    if (typeof DB === 'undefined' || !DB.getOrders) return false;
    if (typeof getSession === 'function' && !getSession()) return false;
    return true;
  }

  async function _pvSondear({ silencioso = false } = {}) {
    if (_pvSondeando) return;
    if (typeof DB === 'undefined' || !DB.getOrders) return;
    _pvSondeando = true;

    try {
      const lista = await DB.getOrders();
      if (!Array.isArray(lista)) return;

      const idsAhora = new Set(lista.map(o => String(o.id)));

      // Primera pasada: solo memorizar, sin avisar. Si no, anunciaría TODOS los
      // pedidos existentes como si acabaran de entrar. La tabla sí se repinta.
      const esPrimeraPasada = (_pvIdsVistos === null);
      const nuevos = esPrimeraPasada
        ? []
        : lista.filter(o => !_pvIdsVistos.has(String(o.id)));
      _pvIdsVistos = idsAhora;

      // Mantener `orders` al día aunque estés en otra sección: así al entrar en
      // Pedidos ya está fresco.
      if (typeof orders !== 'undefined') orders = lista;

      // Repintar SOLO si hay algo que cambió y la sección visible lo muestra.
      //
      // ⚠️ CUIDADO CON EL PARPADEO — regresión corregida en v=4.
      // La versión anterior llamaba a loadDashboard() en cada sondeo. Eso:
      //   1) volvía a descargar los 1.913 productos (redundante: el sondeo ya
      //      tiene los pedidos, y los productos no cambian solos), y
      //   2) repintaba el gráfico DOS veces más. Como renderSalesChart()
      //      destruye y recrea el chart (admin.v33.js:917-926) en vez de
      //      actualizarlo, cada repintado es un parpadeo visible.
      // El usuario lo notó como «recarga y recarga varias veces» al entrar.
      //
      // Ahora: si no hay pedidos nuevos, NO se toca la interfaz. Y cuando los
      // hay, se llama a las funciones de dibujado concretas — nunca a
      // loadDashboard(), que vuelve a bajar el catálogo completo.
      const hayCambios = nuevos.length > 0;
      if (hayCambios && !_pvHayModalAbierto()) {
        const seccion = _pvSeccionActiva();
        if (seccion === 'orders' && typeof renderOrdersTable === 'function') {
          try { renderOrdersTable(); } catch (e) {}
        }
        if (seccion === 'dashboard') {
          // Solo lo que depende de los pedidos. El gráfico de categorías se
          // alimenta de productos, así que no hace falta redibujarlo.
          try { if (typeof renderDashboardKpis === 'function') renderDashboardKpis(); } catch (e) {}
          try { if (typeof renderRecentOrders  === 'function') renderRecentOrders();  } catch (e) {}
        }
      }
      // Invalidar la caché solo si algo cambió. Hacerlo en cada sondeo forzaría
      // a otras pantallas a volver a consultar sin motivo.
      if (hayCambios && typeof DBCached !== 'undefined' && DBCached.invalidateOrders) {
        DBCached.invalidateOrders();
      }

      if (nuevos.length > 0 && !silencioso) {
        _pvAvisar(nuevos);
      }

      // Registrar en la campana los pedidos recientes que aun no tengan aviso.
      //
      // Se llama en CADA sondeo, no solo cuando `nuevos` trae algo, y esa es la
      // clave del arreglo: `nuevos` compara contra ids memorizados en esta
      // sesion del navegador, asi que un pedido entrado con el panel cerrado
      // (o antes de un F5) nunca aparecia ahi. La sincronizacion decide con un
      // criterio duradero — si el pedido ya tiene su fila en `notificaciones` —
      // y por eso es idempotente: repetirla no duplica nada.
      if (typeof sincronizarNotificacionesPedidos === 'function') {
        try { await sincronizarNotificacionesPedidos(lista); } catch (e) {}
      }
    } catch (e) {
      // Un fallo de red no debe romper el ciclo: se reintenta al siguiente tick.
      console.warn('[pedidos] sondeo falló:', e && e.message);
    } finally {
      _pvSondeando = false;
    }
  }

  function _pvAvisar(nuevos) {
    _pvSonar();
    _pvParpadearTitulo(nuevos.length);

    // Dejar constancia en la campana. El sonido y el aviso flotante son
    // efimeros: si nadie mira la pantalla en ese momento, el pedido pasaba sin
    // rastro en el listado de notificaciones. Esto lo registra.
    //
    // Se hace desde aqui, y no desde la tienda al crear el pedido, porque la
    // tienda usa la clave anon: escribir notificaciones desde el navegador del
    // cliente le permitiria crear avisos arbitrarios en el panel. Ademas la
    // deteccion de "que es nuevo" ya vive aqui, y duplicarla en otro sitio
    // llevaria a dos criterios que acabarian discrepando.
    // NOTA: el registro en la campana ya NO se hace aqui. Ver _pvSondear().
    // Colgarlo de esta funcion era un error: solo se ejecuta cuando aparece un
    // id que no estaba en memoria, asi que un pedido entrado con el panel
    // cerrado no generaba nada (al arrancar se siembra como "ya visto").

    const n = nuevos.length;
    if (typeof showAdminToast === 'function') {
      const detalle = n === 1
        ? `Pedido #${nuevos[0].order_number || '—'} de ${nuevos[0].customer || 'cliente'}`
        : `${n} pedidos nuevos`;
      showAdminToast(`🔔 ${detalle}`, 'success');
    }
    console.log(`[pedidos] ${n} pedido(s) nuevo(s) detectado(s).`);
  }

  // ─── Arranque / parada del timer ────────────────────────────────────────────

  function _pvArrancar() {
    if (_pvTimer !== null) return;
    _pvTimer = setInterval(() => {
      // Si la sesión caducó o se cerró, dejar de sondear: si no, seguiríamos
      // consultando Supabase indefinidamente contra un panel ya bloqueado.
      if (!_pvDebeVigilar()) { _pvParar(); return; }
      _pvSondear();
    }, PV_INTERVALO_MS);
  }

  function _pvParar() {
    if (_pvTimer === null) return;
    clearInterval(_pvTimer);
    _pvTimer = null;
  }

  // Al volver a la pestaña: sondear ya, sin esperar el resto de los 30 s.
  // (El timer sigue corriendo en segundo plano, pero el navegador puede
  //  ralentizarlo en pestañas ocultas; esto recupera el retraso al instante.)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _pvDebeVigilar()) _pvSondear();
  });

  // Desbloquear el audio en la primera interacción del usuario.
  ['click', 'keydown', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, _pvDesbloquearAudio, { once: true, passive: true });
  });

  // ─── Arranque automático ────────────────────────────────────────────────────
  // OJO: no se puede depender de showSection() para arrancar. Al cargar el
  // panel, el Dashboard ya viene con class="active" puesta en el HTML
  // (admin.html:249) y showSection() NO se llama hasta que el usuario pulsa
  // algo en el menú. Si el arranque colgara de ahí, la vigilancia no empezaría
  // hasta el primer clic.
  function _pvIniciar() {
    _pvPintarBotonSonido();
    if (!_pvDebeVigilar()) {
      // Login, o API aún sin cargar: reintentar en unos segundos.
      setTimeout(_pvIniciar, 3000);
      return;
    }

    // Sembrar los ids con lo que initAdminData() ya descargó, SIN volver a
    // consultar. Antes se lanzaba un _pvSondear() aquí, que repetía una
    // petición recién hecha y (en el dashboard) provocaba otro repintado justo
    // cuando la carga inicial acababa de terminar.
    if (typeof orders !== 'undefined' && Array.isArray(orders) && orders.length > 0) {
      _pvIdsVistos = new Set(orders.map(o => String(o.id)));
    }
    // Si `orders` está vacío no se siembra nada: _pvIdsVistos sigue en null y el
    // primer tick de los 30 s hará de primera pasada (memoriza, no avisa).

    _pvArrancar();
    console.log('[pedidos] vigilancia activa — sondeo cada 30 s en todo el panel.');
  }

  // 4 s de margen para que initAdminData() (fase 1a + fase 1b, 1.913 productos)
  // haya terminado. Así el arranque no se solapa con la carga inicial.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_pvIniciar, 4000));
  } else {
    setTimeout(_pvIniciar, 4000);
  }

  // ─── API pública ────────────────────────────────────────────────────────────

  window.pvToggleSonido = pvToggleSonido;

  // Llamada por admin.v33.js al cambiar de sección. Ya NO arranca ni para el
  // timer (la vigilancia es permanente): solo repinta el botón de sonido, que
  // vive en la sección Pedidos y puede no existir aún al arrancar.
  window.pvNotificarSeccion = function () {
    _pvPintarBotonSonido();
  };

  // Siembra los ids conocidos con una lista que otro código ya descargó,
  // para no repetir la consulta. La llama showSection() con el resultado
  // de su propio DB.getOrders().
  window.pvRegistrarLista = function (lista) {
    if (!Array.isArray(lista)) return;
    _pvIdsVistos = new Set(lista.map(o => String(o.id)));
  };

  // Botón "Refrescar": fuerza un sondeo inmediato sin esperar los 30 s.
  window.pvSondearAhora = function () { _pvSondear(); };

  // Para depurar desde la consola del navegador.
  window.pvEstado = function () {
    return {
      vigilando   : _pvTimer !== null,
      debeVigilar : _pvDebeVigilar(),
      idsConocidos: _pvIdsVistos ? _pvIdsVistos.size : null,
      sonidoActivo: pvSonidoActivo(),
      audio       : _pvAudioCtx ? _pvAudioCtx.state : 'sin iniciar',
      seccion     : _pvSeccionActiva(),
    };
  };

  console.log('[pedidos] módulo de vigilancia cargado.');
})();
