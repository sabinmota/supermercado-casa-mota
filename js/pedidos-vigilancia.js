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
  // BUILD 434 · `created_at` del pedido más reciente visto en la última
  // sesión. Permite avisar de lo que entró con el panel cerrado.
  const PV_KEY_ULTIMO   = 'cm_pedidos_ultima_marca';

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
  // convención, se comprueba la visibilidad real.
  //
  // 🔴 BUILD 408 · ESTA FUNCIÓN NO PROTEGÍA NADA.
  //
  // Hasta ahora hacía `m.offsetParent !== null`. Suena razonable, pero está
  // MEDIDO que no funciona con estos elementos:
  //
  //   elemento                      offsetParent   getClientRects()
  //   .modal-backdrop VISIBLE       null  🔴       1
  //   .modal-backdrop oculto        null           0
  //
  // Por especificación `offsetParent` devuelve `null` para TODO elemento con
  // `position: fixed`, esté visible o no. Y `css/admin.v33.css` línea 1042
  // define `.modal-backdrop { position: fixed; … }`. Resultado: la condición
  // `!_pvHayModalAbierto()` de la línea ~247 SIEMPRE se cumplía, así que la
  // vigilancia repintaba la tabla de pedidos aunque hubiera un formulario
  // abierto encima — justo lo que este guardián existía para impedir.
  //
  // Se descubrió al arreglar el mismo defecto en `_hayModalAbierto()` de
  // `js/admin.v33.js` (build 407), que había copiado este método de aquí.
  //
  // `getClientRects().length` cuenta las cajas que el navegador REALMENTE
  // pinta: da 0 si el elemento está oculto por `.hidden`, por su propio
  // `style.display:none` o por cualquier ancestro oculto — y funciona con
  // `position: fixed`. Se añaden también los `.cat-modal-backdrop`, que son
  // modales de pleno derecho y antes ni se miraban.
  //
  // (`checkVisibility()` daría lo mismo, pero no existe en Safari antiguo y
  // este panel se usa desde iPhone.)
  function _pvHayModalAbierto() {
    const modales = document.querySelectorAll('.modal-backdrop, .cat-modal-backdrop');
    for (const m of modales) {
      if (m.getClientRects().length > 0) return true;
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

      // BUILD 434 · Mover la marca de «lo último visto» en CADA sondeo.
      //
      // 🔴 SIN ESTO EL AVISO DE AUSENCIA SE REPETIRÍA ETERNAMENTE: la marca
      //    solo se guardaba al arrancar, así que un pedido entrado con el
      //    panel YA abierto no la movía. A la siguiente apertura se lo
      //    encontraría «posterior a la marca» y volvería a anunciarlo, aunque
      //    el empleado ya lo hubiera visto y hasta despachado.
      //    El panel está abierto: lo que llega ahora se está viendo ahora.
      try {
        const masReciente = lista.reduce((max, o) => {
          const t = String(o.created_at || '');
          return t > max ? t : max;
        }, '');
        if (masReciente) localStorage.setItem(PV_KEY_ULTIMO, masReciente);
      } catch (e) { /* localStorage lleno o bloqueado: no es crítico */ }

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
      //
      // 🔴 BUILD 434 · EL `catch (e) {}` VACÍO QUE HABÍA AQUÍ ERA EL PROBLEMA.
      //    Se tragaba CUALQUIER fallo de la sincronización sin dejar rastro:
      //    ni en consola, ni en pantalla, ni en ningún sitio. Al diagnosticar
      //    «la campana no subió hasta entrar en Pedidos», `pvSondearAhora()`
      //    devolvió SILENCIO ABSOLUTO — y ese silencio era indistinguible
      //    entre «todo bien, nada que registrar» y «reventó y nadie se enteró».
      //    Un `catch` mudo no protege el código: le quita la voz.
      //    Ahora todo fallo se registra con su motivo.
      if (typeof sincronizarNotificacionesPedidos === 'function') {
        try {
          await sincronizarNotificacionesPedidos(lista);
        } catch (e) {
          console.warn('[pedidos] la sincronización con la campana falló:',
                       e && (e.message || e));
        }
      } else {
        console.warn('[pedidos] sincronizarNotificacionesPedidos NO existe: ' +
                     'js/extras.v33.js no se cargó o cambió de nombre.');
      }
    } catch (e) {
      // Un fallo de red no debe romper el ciclo: se reintenta al siguiente tick.
      console.warn('[pedidos] sondeo falló:', e && e.message);
    } finally {
      _pvSondeando = false;
    }
  }

  /**
   * BUILD 434 · Aviso de los pedidos que entraron con el panel cerrado.
   *
   * Distinto de `_pvAvisar()` a propósito: el mensaje dice explícitamente que
   * llegaron «mientras el panel estaba cerrado». Un aviso idéntico al de un
   * pedido recién entrado haría creer al empleado que acaba de llegar y que
   * el cliente está esperando ahora mismo, cuando puede ser de anoche.
   */
  function _pvAvisarDeAusencia(entrados) {
    const n = entrados.length;
    _pvSonar();
    _pvParpadearTitulo(n);

    if (typeof showAdminToast === 'function') {
      const cuales = entrados
        .slice(0, 3)
        .map(o => '#' + (o.order_number || '?'))
        .join(', ');
      const resto = n > 3 ? ' y ' + (n - 3) + ' más' : '';
      showAdminToast(
        `🔔 ${n} pedido${n === 1 ? '' : 's'} entr${n === 1 ? 'ó' : 'aron'} ` +
        `mientras el panel estaba cerrado: ${cuales}${resto}`, 'success');
    }
    console.log(`[pedidos] ${n} pedido(s) entraron con el panel cerrado.`);
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

      // ── BUILD 434 · AVISO DE LO ENTRADO MIENTRAS EL PANEL ESTABA CERRADO ──
      //
      // 🔴 EL HUECO QUE ESTO TAPA, Y CÓMO SE ENCONTRÓ: el dueño hizo un pedido
      //    en la tienda, se pasó al panel, y no sonó nada. Su medición lo
      //    explicó sin ambigüedad — `pvEstado()` daba `idsConocidos: 12` y el
      //    dashboard mostraba `Pedidos totales: 12`. Los mismos doce.
      //    O sea: al abrir el panel, la siembra de arriba metió su pedido
      //    recién creado en la lista de «ya vistos», así que para el vigilante
      //    NUNCA fue nuevo. No había nada roto; simplemente el pedido ya
      //    estaba ahí cuando el panel abrió los ojos.
      //
      // 🔴 POR QUÉ ESTA COMPROBACIÓN Y NO «AVISAR DE TODO LO PENDIENTE»:
      //    se valoraron las dos. Avisar de los pendientes suena cada vez que
      //    se abre el panel si el dueño deja cinco sin atender a propósito —
      //    una alarma que se repite es una alarma que se ignora. Esta versión
      //    responde a la pregunta correcta: «¿entró algo mientras yo no
      //    miraba?». Compara contra la marca de tiempo del pedido más reciente
      //    que se vio en la última sesión, guardada en localStorage.
      //
      // 🔴 SE USA LA FECHA DEL PEDIDO, NO LA HORA DEL NAVEGADOR: el reloj del
      //    PC puede ir descuadrado, y una diferencia de minutos decidiría mal.
      //    `created_at` lo pone la base, es el mismo dato para todos.
      try {
        const marcaPrevia = localStorage.getItem(PV_KEY_ULTIMO) || '';
        const masReciente = orders.reduce((max, o) => {
          const t = String(o.created_at || '');
          return t > max ? t : max;
        }, '');

        if (marcaPrevia && masReciente) {
          const entrados = orders.filter(o =>
            String(o.created_at || '') > marcaPrevia);
          if (entrados.length > 0) {
            // Retraso para no solaparse con la carga inicial y para que el
            // AudioContext tenga ocasión de desbloquearse con el primer clic.
            setTimeout(() => _pvAvisarDeAusencia(entrados), 1200);
          }
        }
        if (masReciente) localStorage.setItem(PV_KEY_ULTIMO, masReciente);
      } catch (e) {
        console.warn('[pedidos] no se pudo comprobar lo entrado en ausencia:',
                     e && e.message);
      }
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

  /**
   * BUILD 434 · Diagnóstico paso a paso de la cadena pedido → campana.
   *
   * 🔴 POR QUÉ EXISTE: `pvSondearAhora()` devolvía SILENCIO, y un silencio no
   *    distingue entre «funcionó y no había nada que hacer» y «falló callado».
   *    Esta función recorre la misma cadena y DICE en cada paso qué encontró.
   *    Es la regla del build 421c: cuando un fallo no da información, el
   *    trabajo no es adivinar la causa sino conseguir información.
   *
   * Se ejecuta desde la consola:  await pvDiagnostico()
   */
  window.pvDiagnostico = async function () {
    const r = { pasos: [] };
    const paso = (n, ok, detalle) => {
      r.pasos.push((ok ? '✓ ' : '✗ ') + n + (detalle ? ' → ' + detalle : ''));
    };

    paso('DB.getOrders existe', typeof DB !== 'undefined' && !!DB.getOrders);
    paso('sincronizarNotificacionesPedidos existe',
         typeof sincronizarNotificacionesPedidos === 'function');
    paso('variable global `notificaciones` existe',
         typeof notificaciones !== 'undefined',
         typeof notificaciones !== 'undefined'
           ? notificaciones.length + ' en memoria' : 'NO DEFINIDA');

    let lista = [];
    try {
      lista = await DB.getOrders();
      paso('DB.getOrders() responde', Array.isArray(lista),
           (lista || []).length + ' pedidos');
    } catch (e) {
      paso('DB.getOrders() responde', false, e.message);
      r.pasos.forEach(p => console.log(p));
      return r;
    }

    // ¿Cuántos pedidos son de las últimas 24 h? Es el filtro que usa la
    // sincronización, y si da 0 nunca creará ninguna notificación.
    const desde = Date.now() - 24 * 3600 * 1000;
    const recientes = lista.filter(o => {
      const t = new Date(o.created_at).getTime();
      return !isNaN(t) && t >= desde;
    });
    paso('pedidos de las últimas 24 h', recientes.length > 0,
         recientes.length + ' recientes');
    if (recientes.length) {
      const u = recientes[0];
      paso('  · el más reciente', true,
           '#' + (u.order_number || '?') + ' · ' + u.created_at +
           ' · estado ' + u.status);
    }

    // ¿Puede LEER la tabla de notificaciones? Si esto falla, la
    // sincronización sale sin escribir nada — y sin decir por qué.
    try {
      const filas = await _supaFetch(
        'notificaciones?select=pedido_id&tipo=eq.nuevo_pedido&limit=1000', {});
      const ids = new Set((Array.isArray(filas) ? filas : [])
        .map(f => String(f.pedido_id || '')).filter(Boolean));
      paso('lectura de la tabla `notificaciones`', true,
           ids.size + ' pedidos ya registrados');
      const faltan = recientes.filter(o => !ids.has(String(o.id)));
      paso('pedidos recientes SIN aviso en la campana', true,
           faltan.length + (faltan.length
             ? ' → deberían registrarse en el próximo sondeo'
             : ' → nada pendiente, la campana está al día'));
    } catch (e) {
      paso('lectura de la tabla `notificaciones`', false,
           (e && e.message) + '  ← ESTA ES LA CAUSA: sin poder leer lo ya ' +
           'registrado, la sincronización sale SIN escribir, a propósito, ' +
           'para no duplicar avisos cada 30 s');
    }

    r.pasos.forEach(p => console.log(p));
    return r;
  };

  console.log('[pedidos] módulo de vigilancia cargado.');
})();
