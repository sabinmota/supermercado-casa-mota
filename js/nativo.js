/* ============================================================================
 * CASA MOTA · CAPA NATIVA (BUILD 432)
 * ----------------------------------------------------------------------------
 * Escáner de códigos y notificaciones push NATIVOS cuando la tienda corre
 * dentro de la app de iOS/Android. En un navegador normal este fichero no
 * hace absolutamente nada y todo sigue funcionando como hasta ahora.
 *
 * 🔴 POR QUÉ NO SE USA `import` DE NPM, Y ES LA DECISIÓN CENTRAL DE ESTE
 *    FICHERO: este proyecto NO tiene empaquetador. No hay package.json en el
 *    repositorio, no hay Webpack ni Vite, y los scripts se cargan con
 *    <script src="...">. Un `import { BarcodeScanner } from '@capacitor-mlkit/
 *    barcode-scanning'` NO funcionaría: el navegador no sabe resolver el
 *    nombre de un paquete npm.
 *    La vía correcta aquí es `window.Capacitor.Plugins.X`. Capacitor inyecta
 *    ese objeto en el WebView y CADA PLUGIN NATIVO SE REGISTRA SOLO por su
 *    nombre en cuanto su pod está instalado. El paquete de npm solo aporta
 *    tipos de TypeScript y un respaldo web — nada que necesitemos.
 *
 * 🔴 POR QUÉ ESTO IMPORTA PARA APPLE (directriz 4.2 · Minimum Functionality):
 *    `capacitor.config.json` apunta con `server.url` al sitio web, así que la
 *    app ES la web dentro de un marco. Ése es el motivo de rechazo más común
 *    en apps montadas así. El escáner nativo es la respuesta concreta: usa la
 *    cámara con el motor de reconocimiento del sistema, algo que un navegador
 *    en iOS NO puede hacer (`BarcodeDetector` no existe en Safari — lo dice el
 *    propio diagnóstico del proyecto en test-scanner.html:174).
 *
 * 🔴 LO QUE ESTE FICHERO NO ROMPE, VERIFICADO ANTES DE ESCRIBIRLO:
 *    - `openBarcodeScanner()` (js/app.js:1658) sigue existiendo intacta.
 *    - `_onBarcodeDetected(code)` (js/app.js:2501) es el único punto de
 *      entrega de un código encontrado, y lo nativo entrega POR AHÍ MISMO.
 *      Así el beep, la vibración, la búsqueda en catálogo, la recarga desde
 *      la API y la apertura del modal son EXACTAMENTE el mismo código que
 *      ya está probado en producción. No se duplica ni una línea de eso.
 *    - En navegador, `esNativo()` devuelve false y no se toca nada.
 * ==========================================================================*/

(function (global) {
  'use strict';

  // ─── DETECCIÓN DE ENTORNO ────────────────────────────────────────────────
  // No se mira el user-agent: es falsificable y cambia con cada versión de
  // iOS. Se pregunta a Capacitor, que solo existe si hay envoltorio nativo.

  function _cap() {
    return (global.Capacitor && typeof global.Capacitor === 'object')
      ? global.Capacitor : null;
  }

  function _plugin(nombre) {
    var c = _cap();
    return (c && c.Plugins && c.Plugins[nombre]) ? c.Plugins[nombre] : null;
  }

  /** ¿Corremos dentro de la app nativa (no en un navegador)? */
  function esNativo() {
    var c = _cap();
    if (!c) return false;
    // isNativePlatform es la API oficial desde Capacitor 3.
    if (typeof c.isNativePlatform === 'function') {
      try { return c.isNativePlatform() === true; } catch (e) { return false; }
    }
    // Respaldo para versiones antiguas.
    if (typeof c.getPlatform === 'function') {
      try { return c.getPlatform() !== 'web'; } catch (e) { return false; }
    }
    return false;
  }

  /** 'ios' | 'android' | 'web' */
  function plataforma() {
    var c = _cap();
    if (c && typeof c.getPlatform === 'function') {
      try { return c.getPlatform(); } catch (e) { /* sigue */ }
    }
    return 'web';
  }

  // ─── REGISTRO INTERNO ────────────────────────────────────────────────────
  // Un rastro legible en consola vale más que un fallo mudo. Toda la sesión
  // de MacInCloud se va a diagnosticar leyendo estas líneas.

  var _traza = [];

  function log(msg, dato) {
    var linea = '[nativo] ' + msg;
    _traza.push({ t: Date.now(), msg: msg, dato: dato });
    if (dato !== undefined) { console.log(linea, dato); }
    else { console.log(linea); }
  }

  function traza() { return _traza.slice(); }

  // ═════════════════════════════════════════════════════════════════════════
  //  ESCÁNER NATIVO
  // ═════════════════════════════════════════════════════════════════════════

  var NOMBRE_ESCANER = 'BarcodeScanner';   // @capacitor-mlkit/barcode-scanning

  /* 🔴 BUILD 438 · ESPERA PARA QUE LA VISTA NATIVA ACABE DE RETIRARSE.
   *
   *    DEFECTO MEDIDO POR EL DUEÑO EN SU iPhone 14 Pro Max: al leer un código
   *    se abría la ficha del producto pero el RECUADRO BLANCO de puntería, la
   *    X de cerrar y el botón de linterna SEGUÍAN EN PANTALLA unos instantes,
   *    encima de la tienda. Sus capturas lo prueban: la X arriba a la
   *    izquierda tapando la barra de búsqueda, el círculo negro de la linterna
   *    abajo al centro y las líneas verticales del marco cruzando el texto
   *    «Todo lo que necesitas para tu hogar».
   *
   *    CAUSA: `p.scan()` resuelve EN EL INSTANTE EN QUE DETECTA EL CÓDIGO, no
   *    cuando su vista se ha ido. La retirada de un controlador de vista de
   *    iOS es ANIMADA y esa animación la marca Apple, no este código. Así que
   *    entregar el código de inmediato pinta el modal ENCIMA de un escáner que
   *    todavía se está cerrando. No es un residuo visual: son dos pantallas
   *    vivas a la vez.
   *
   *    POR QUÉ EL ARREGLO VIVE AQUÍ Y NO EN js/app.js: esta capa es la única
   *    dueña de la vista nativa. `app.js` no sabe que existe una animación de
   *    cierre y no tiene por qué saberlo; si la espera se metiera allí,
   *    cualquier futura llamada a `escanear()` desde otro sitio volvería a
   *    tener el defecto.
   *
   * 🔴 ESTE NÚMERO NO ESTÁ MEDIDO Y HAY QUE DECIRLO: no hay macOS ni iPhone en
   *    el entorno donde se escribió esto, así que la duración real de la
   *    animación de Apple NO SE HA CRONOMETRADO. 400 ms es la duración típica
   *    de una transición modal de iOS con margen. Si el recuadro todavía
   *    asoma, SUBA este número (500, 600). Si se nota una pausa molesta entre
   *    leer y ver el producto, BÁJELO (300, 250). Es la única línea que hay
   *    que tocar, y por eso está sola y con nombre propio.
   */
  var ESPERA_CIERRE_ESCANER_MS = 400;

  function _esperar(ms) {
    return new Promise(function (resolver) { global.setTimeout(resolver, ms); });
  }

  /** ¿Hay escáner nativo utilizable aquí y ahora? */
  function escanerDisponible() {
    if (!esNativo()) return false;
    var p = _plugin(NOMBRE_ESCANER);
    return !!(p && typeof p.scan === 'function');
  }

  /**
   * Pide permiso de cámara. Devuelve true si quedó concedido.
   *
   * 🔴 Se comprueba ANTES de pedir: volver a pedir un permiso ya denegado
   *    no muestra ningún diálogo en iOS, así que sin esta comprobación el
   *    usuario vería «no se pudo abrir la cámara» sin explicación y sin
   *    forma de arreglarlo. Con ella podemos mandarle a Ajustes.
   */
  async function _permisoCamara() {
    var p = _plugin(NOMBRE_ESCANER);
    if (!p) return false;

    try {
      if (typeof p.checkPermissions === 'function') {
        var estado = await p.checkPermissions();
        if (estado && estado.camera === 'granted') { log('permiso cámara: ya concedido'); return true; }
        if (estado && estado.camera === 'denied') {
          log('permiso cámara: DENEGADO de antes — hay que ir a Ajustes');
          return false;
        }
      }
      if (typeof p.requestPermissions === 'function') {
        var pedido = await p.requestPermissions();
        var ok = !!(pedido && (pedido.camera === 'granted' || pedido.camera === 'limited'));
        log('permiso cámara solicitado', pedido);
        return ok;
      }
      // Si el plugin no expone permisos, dejamos que scan() falle y lo diga.
      return true;
    } catch (e) {
      log('error comprobando permiso de cámara: ' + e.message);
      return false;
    }
  }

  /**
   * En Android el motor de Google Barcode se descarga aparte la primera vez.
   * En iOS esto no existe, así que la función sale sin hacer nada.
   * Sin esto, el primer escaneo en un Android recién instalado falla.
   */
  async function _asegurarMotorAndroid() {
    if (plataforma() !== 'android') return true;
    var p = _plugin(NOMBRE_ESCANER);
    if (!p || typeof p.isGoogleBarcodeScannerModuleAvailable !== 'function') return true;
    try {
      var r = await p.isGoogleBarcodeScannerModuleAvailable();
      if (r && r.available) return true;
      log('Android: descargando el motor de reconocimiento…');
      if (typeof p.installGoogleBarcodeScannerModule === 'function') {
        await p.installGoogleBarcodeScannerModule();
      }
      return true;
    } catch (e) {
      log('no se pudo preparar el motor de Android: ' + e.message);
      return true;   // se intenta escanear igualmente
    }
  }

  /**
   * Abre el escáner nativo y devuelve el código leído, o null.
   *
   * Formatos: los mismos que ya usa el camino web de js/app.js:1789, para que
   * un código que se lee en la web se lea también en la app. Cambiar esta
   * lista sin cambiar la otra crearía dos escáneres con criterios distintos.
   */
  async function escanear() {
    if (!escanerDisponible()) { log('escanear(): no hay escáner nativo'); return null; }

    var permitido = await _permisoCamara();
    if (!permitido) {
      return { error: 'SIN_PERMISO_CAMARA' };
    }

    await _asegurarMotorAndroid();

    var p = _plugin(NOMBRE_ESCANER);
    try {
      var res = await p.scan({
        formats: ['Ean13', 'Ean8', 'UpcA', 'UpcE', 'Code128', 'Code39', 'QrCode']
      });
      var lista = (res && res.barcodes) || [];
      if (!lista.length) { log('escaneo cancelado o sin resultado'); return null; }
      var valor = lista[0].rawValue || lista[0].displayValue || '';
      log('código leído por el escáner nativo', valor);

      // BUILD 438: se deja terminar la animación de cierre ANTES de devolver
      // el código. Quien llama abre el modal del producto justo al recibirlo,
      // así que sin esta pausa el modal aparece bajo un escáner que aún no se
      // ha ido. Ver el comentario de ESPERA_CIERRE_ESCANER_MS arriba.
      await _esperar(ESPERA_CIERRE_ESCANER_MS);
      log('vista del escáner retirada; se entrega el código');

      return { codigo: String(valor) };
    } catch (e) {
      // Cancelar con el botón del sistema llega aquí; no es un fallo.
      log('scan() terminó sin código: ' + e.message);
      return null;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  NOTIFICACIONES PUSH NATIVAS
  // ═════════════════════════════════════════════════════════════════════════

  var NOMBRE_PUSH = 'PushNotifications';   // @capacitor/push-notifications
  var _tokenPush = null;
  var _pushIniciado = false;

  function pushDisponible() {
    if (!esNativo()) return false;
    var p = _plugin(NOMBRE_PUSH);
    return !!(p && typeof p.register === 'function');
  }

  function tokenPush() { return _tokenPush; }

  /**
   * Pide permiso, registra el dispositivo y engancha los tres sucesos.
   *
   * 🔴 LÍMITE HONESTO, y debe quedar escrito: esto REGISTRA el dispositivo y
   *    obtiene su token. ENVIAR una notificación necesita una clave APNs de
   *    Apple y un servidor que la firme — un sitio estático no puede hacerlo.
   *    Lo que aporta este código es (a) la capacidad nativa real que la
   *    directriz 4.2 exige ver, y (b) el token, que es la pieza sin la cual
   *    ningún envío futuro es posible.
   *
   * 🔴 EL PLUGIN YA ESTABA DECLARADO EN capacitor.config.json:37 Y NUNCA SE
   *    LLAMABA. Verificado con Grep: cero apariciones de `PushNotifications`
   *    en todo el JavaScript del proyecto. Estaba configurado y muerto.
   */
  async function iniciarPush() {
    if (!pushDisponible()) { log('iniciarPush(): no hay push nativo'); return false; }
    if (_pushIniciado) { log('push ya estaba iniciado'); return true; }

    var p = _plugin(NOMBRE_PUSH);

    try {
      var estado = await p.checkPermissions();
      if (estado && estado.receive === 'denied') {
        log('push DENEGADO de antes — hay que ir a Ajustes');
        return false;
      }
      if (!estado || estado.receive !== 'granted') {
        var pedido = await p.requestPermissions();
        if (!pedido || pedido.receive !== 'granted') {
          log('el usuario no concedió permiso de notificaciones', pedido);
          return false;
        }
      }
    } catch (e) {
      log('error pidiendo permiso de push: ' + e.message);
      return false;
    }

    // Los oyentes se enganchan ANTES de register(): el suceso 'registration'
    // puede llegar de inmediato y sin oyente se perdería el token.
    try {
      p.addListener('registration', function (t) {
        _tokenPush = (t && t.value) || null;
        log('token de push recibido', _tokenPush ? (_tokenPush.slice(0, 12) + '…') : null);
        _guardarToken(_tokenPush);
      });

      p.addListener('registrationError', function (err) {
        log('ERROR de registro de push', err);
      });

      // Notificación con la app abierta: iOS no la muestra sola.
      p.addListener('pushNotificationReceived', function (n) {
        log('push recibido con la app abierta', n);
        _mostrarAviso(n);
      });

      // El usuario tocó la notificación.
      p.addListener('pushNotificationActionPerformed', function (accion) {
        log('push pulsado', accion);
        var datos = (accion && accion.notification && accion.notification.data) || {};
        if (datos.url) {
          try { global.location.href = datos.url; } catch (e) { /* nada */ }
        }
      });

      await p.register();
      _pushIniciado = true;
      log('push nativo registrado');
      return true;
    } catch (e) {
      log('fallo registrando push: ' + e.message);
      return false;
    }
  }

  /**
   * Guarda el token donde el panel pueda usarlo más adelante.
   * Si la base todavía no tiene sitio para él, NO se considera un fallo:
   * el token queda en memoria y en consola. Un error aquí no debe impedir
   * que el cliente use la tienda.
   */
  function _guardarToken(token) {
    if (!token) return;
    try { global.sessionStorage.setItem('cm_push_token', token); } catch (e) { /* nada */ }
    if (global.DB && typeof global.DB.guardarTokenPush === 'function') {
      global.DB.guardarTokenPush(token).catch(function (e) {
        log('no se pudo guardar el token en la base (no es crítico): ' + e.message);
      });
    } else {
      log('DB.guardarTokenPush no existe todavía — el token queda solo en memoria');
    }
  }

  /** Aviso en pantalla cuando llega un push estando la app abierta. */
  function _mostrarAviso(n) {
    var titulo = (n && n.title) || 'Casa Mota';
    var cuerpo = (n && n.body) || '';
    if (typeof global.showToast === 'function') {
      global.showToast(titulo + (cuerpo ? ' · ' + cuerpo : ''), 'info');
      return;
    }
    if (typeof global.mostrarToast === 'function') {
      global.mostrarToast(titulo + (cuerpo ? ' · ' + cuerpo : ''));
      return;
    }
    log('aviso sin toast disponible: ' + titulo + ' ' + cuerpo);
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ARRANQUE
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * El push se pide con RETRASO a propósito.
   *
   * 🔴 Apple penaliza pedir permiso de notificaciones en el primer segundo,
   *    antes de que el usuario entienda para qué sirven. Y un usuario que
   *    deniega no vuelve a ver el diálogo nunca. Esperar a que haya sesión
   *    y unos segundos de uso sube muchísimo la probabilidad de un «sí».
   */
  /* 🔴 BUILD 438 · MARCA PARA QUE EL CSS SEPA QUE ESTAMOS DENTRO DE LA APP.
   *
   *    DEFECTO MEDIDO: la cabecera de la tienda se metía DEBAJO de la isla
   *    dinámica del iPhone 14 Pro Max. El logo, «Hola Apple», Favoritos y
   *    Carrito quedaban pisados por la hora y la píldora negra del sistema.
   *
   *    CAUSA EXACTA: css/style.css tenía el relleno superior dentro de
   *        @media (display-mode: standalone) { .header { padding-top: … } }
   *    y una app de Capacitor NO ESTÁ en `display-mode: standalone` — es un
   *    WKWebView. Esa consulta de medios NUNCA se cumplía, así que el relleno
   *    jamás se aplicaba, y `.header` es `position:fixed; top:0`
   *    (css/style.css:316). El mismo error estaba en `_calcSafeTop()` de
   *    js/app.js, que preguntaba por `navigator.standalone`.
   *
   *    Se resuelve con una clase en <html> en lugar de intentar adivinar el
   *    entorno desde el CSS: el CSS no puede saber si corre en Capacitor, pero
   *    esta capa SÍ lo sabe con certeza (`Capacitor.isNativePlatform()`).
   *
   *    Por qué en <html> y no en <body>: `documentElement` existe desde que el
   *    analizador lee la etiqueta <html>, mucho antes de que <body> esté
   *    completo. Este fichero se carga dentro del cuerpo, así que la marca
   *    queda puesta antes del primer pintado y no hay salto visible.
   */
  function _marcarAppNativa() {
    try {
      var raiz = global.document && global.document.documentElement;
      if (!raiz) { log('no hay documentElement: no se pudo marcar la app'); return; }
      raiz.classList.add('es-app-nativa');
      raiz.classList.add('es-app-' + plataforma());   // es-app-ios | es-app-android
      log('marcado <html class="es-app-nativa es-app-' + plataforma() + '">');
    } catch (e) {
      log('fallo al marcar la app nativa: ' + e.message);
    }
  }

  /** ¿Estamos dentro de la app instalada? Para que app.js no repita la lógica. */
  function enApp() { return esNativo(); }

  function arrancar() {
    if (!esNativo()) {
      log('entorno web: la capa nativa queda inactiva (esto es lo correcto)');
      return;
    }
    log('entorno nativo detectado: ' + plataforma());
    _marcarAppNativa();
    log('escáner nativo disponible: ' + escanerDisponible());
    log('push nativo disponible: ' + pushDisponible());

    global.setTimeout(function () {
      var haySesion = false;
      try {
        haySesion = !!global.sessionStorage.getItem('cm_client_session');
      } catch (e) { /* nada */ }
      if (haySesion) { iniciarPush(); }
      else { log('sin sesión de cliente: el push se pedirá más adelante'); }
    }, 8000);
  }

  /* 🔴 SE ARRANCA DE INMEDIATO, NO EN DOMContentLoaded — Y ESTO ES UN
   *    DEFECTO CORREGIDO, NO UNA PREFERENCIA.
   *
   *    La primera versión hacía:
   *        if (document.readyState === 'loading')
   *            document.addEventListener('DOMContentLoaded', arrancar);
   *
   *    Consecuencia medida en una prueba en navegador real: `traza()` volvía
   *    VACÍA y `esNativo()` ya respondía. O sea que existía una ventana en la
   *    que la capa contestaba preguntas pero AÚN NO HABÍA ARRANCADO, y
   *    cualquier código que se cargue después de este fichero y pregunte
   *    enseguida cae justo en esa ventana.
   *
   *    `arrancar()` solo lee `window.Capacitor` y `sessionStorage`. Esperar al
   *    DOM no aportaba nada y creaba la incoherencia. Lo único que debe
   *    esperar es la petición de permiso de push, y ésa ya tiene su propio
   *    retraso de 8 segundos dentro.
   *
   * 🔴 ACTUALIZADO EN BUILD 438, y se deja escrito porque este comentario
   *    habría quedado MINTIENDO: ahora `arrancar()` SÍ toca el DOM, en
   *    `_marcarAppNativa()`, para añadir la clase a <html>. Sigue siendo
   *    correcto ejecutarlo de inmediato: `document.documentElement` existe
   *    desde que se lee la etiqueta <html>, así que no necesita esperar a
   *    DOMContentLoaded — y de hecho DEBE ir antes del primer pintado, o la
   *    cabecera daría un salto al aplicarse el relleno. Un comentario que
   *    describe un código que ya cambió es peor que no tener comentario.
   *
   * 🔴 POR QUÉ EL ARNÉS NO LO VIO, y es la lección del 426d por segunda vez:
   *    el arnés cargaba este fichero con `new Function(src)` cuando el
   *    documento ESTABA YA COMPLETO, así que `readyState` nunca valía
   *    'loading' y la rama defectuosa jamás se ejecutó. Pasó 57/57 con el
   *    defecto dentro. Lo destapó cargar el fichero con un `<script src>`
   *    de verdad, en una página de verdad — o sea la condición REAL, no la
   *    cómoda. Un arnés que monta el código en el escenario fácil no prueba
   *    el escenario en el que ese código va a vivir. */
  arrancar();

  // ─── API PÚBLICA ─────────────────────────────────────────────────────────
  global.CasaMotaNativo = {
    esNativo: esNativo,
    enApp: enApp,                 // BUILD 438 · alias legible para quien pregunta
    plataforma: plataforma,
    escanerDisponible: escanerDisponible,
    escanear: escanear,
    pushDisponible: pushDisponible,
    iniciarPush: iniciarPush,
    tokenPush: tokenPush,
    traza: traza
  };

})(window);
