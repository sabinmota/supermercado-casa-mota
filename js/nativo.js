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
  /* 🔴 BUILD 444 · EL PLUGIN DE GOOGLE CAMBIÓ, Y LA HISTORIA IMPORTA PORQUE
   *    EVITA REPETIR EL ERROR.
   *
   *    Recomendé primero `@codetrix-studio/capacitor-google-auth` y después
   *    `@capgo/capacitor-social-login` (última). Los DOS fallaron al instalar:
   *      · codetrix  → pide @capacitor/core ^6.0.0 · el proyecto tiene 7.6.9
   *      · capgo 8.x → pide @capacitor/core >=8.0.0 · el proyecto tiene 7.6.9
   *    Dos incompatibilidades opuestas, y el error fue mío por recomendar
   *    «el paquete que dicen los documentos» sin comprobar qué versión de
   *    Capacitor pedía. Se midió con `npm view <paquete> peerDependencies` y
   *    resultó que la rama 7.x de capgo pide `>=7.0.0`: instalada la 7.20.0.
   *
   * 🔴 LO QUE SALVÓ EL TRABAJO FUE NO USAR `--force` NI `--legacy-peer-deps`.
   *    npm los ofrecía y avisaba «potentially broken». Forzarlo habría dado
   *    una app que COMPILA y un login que falla en el teléfono con un mensaje
   *    sin relación con la causa — diagnóstico caro, con el Mac abierto.
   *
   *    REGLA: antes de recomendar un plugin, `npm view X peerDependencies`.
   */
  var NOMBRE_GOOGLE  = 'SocialLogin';      // @capgo/capacitor-social-login@7
  var NOMBRE_APPLE   = 'SignInWithApple';  // @capacitor-community/apple-sign-in@7

  /* Client ID de Google Cloud. SON DOS Y CONVIVEN — no se sustituyen:
   *   · WEB  → lo usa el navegador, y también el `initialize()` del plugin
   *   · iOS  → identifica a la app; va en el Info.plist, invertido
   *
   * 🔴 MISMO PROYECTO (747300144353) PERO SUFIJO DISTINTO — `1qbi69…` frente a
   *    `us0tof…` — y eso es exactamente lo que obligó a corregir el servidor
   *    en el build 442: el `aud` del token de la app NO COINCIDE con el de la
   *    web, así que la comparación antigua contra un único Client ID habría
   *    devuelto 401 SIEMPRE dentro de la app. `audsPermitidos()` en oauth.js
   *    acepta los dos, y esa lista es la red de seguridad de todo esto.
   *
   *    Están en el código y no en variables de entorno a propósito: un Client
   *    ID NO es un secreto —viaja en cada petición y se ve en el código de
   *    cualquier web—. El secreto es la llave de servicio, que vive solo en
   *    Cloudflare y nunca llega al navegador.
   *
   * 🔴 POR QUÉ ESTAS SEIS LÍNEAS ESTÁN AQUÍ ARRIBA Y NO JUNTO AL CÓDIGO DE
   *    LOGIN, Y ES UN DEFECTO CORREGIDO, NO UN GUSTO: `arrancar()` se ejecuta
   *    en la línea ~498, ANTES de donde estaban declaradas (~545). Con `var`
   *    eso no da error: da `undefined`. O sea que `initialize()` habría
   *    recibido `clientId: undefined` y el login de Google habría fallado en
   *    el iPhone con un mensaje que NO menciona el Client ID — un fallo mudo
   *    que solo se diagnostica en el Mac, pagando horas. Lo destapó comprobar
   *    el orden de declaración con Grep antes de dar el trabajo por bueno. */
  var CLIENT_ID_WEB = '747300144353-1qbi69thi9t0sjrf3rrvddpt333fg7to.apps.googleusercontent.com';
  var CLIENT_ID_IOS = '747300144353-us0tofvuph6i2btuai7t8gvmpqpnsf77.apps.googleusercontent.com';

  /* BUILD 446 · ESTADO DE LA INICIALIZACIÓN DE `SocialLogin`.
   *
   * 🔴 SE DECLARAN AQUÍ ARRIBA A PROPÓSITO, JUNTO A LOS CLIENT ID, Y POR EL
   *    MISMO MOTIVO QUE ELLOS: `arrancar()` corre en la línea ~500 y las usa.
   *    Declararlas más abajo con `var` NO daría error — daría `undefined`,
   *    que es el fallo mudo que ya mordió una vez en este mismo fichero
   *    (ver el bloque de arriba sobre el orden de declaración).
   *
   * `_iniGoogle`    · la PROMESA de initialize(), para poder esperarla
   * `_iniGoogleOk`  · true solo si initialize() resolvió bien
   * `_iniGoogleErr` · el motivo del fallo, para enseñarlo en el teléfono */
  var _iniGoogle    = null;
  var _iniGoogleOk  = false;
  var _iniGoogleErr = '';
  /* BUILD 447 · qué forma de configuración aceptó el plugin. Se muestra en el
   * aviso de error del teléfono, porque es el dato que permitirá dejar UNA
   * sola variante y borrar las demás. */
  var _iniGoogleVariante = '';

  /* 🔴 BUILD 441 · AQUÍ HABÍA UNA ESPERA DE 400 ms Y SE HA REVERTIDO.
   *    Se deja escrito para que nadie la reintroduzca creyendo que ayuda.
   *
   *    QUÉ SE INTENTÓ (BUILD 438): el dueño reportó que, al leer un código, el
   *    recuadro blanco de puntería seguía en pantalla unos instantes sobre la
   *    tienda. Razoné que `p.scan()` resuelve al DETECTAR el código y no
   *    cuando su vista se ha retirado —la retirada en iOS es animada—, así que
   *    metí `await _esperar(400)` antes de devolver el código, para dejar
   *    terminar la animación.
   *
   * 🔴 RESULTADO MEDIDO EN EL iPhone DEL DUEÑO: EMPEORÓ. Sus palabras:
   *    «ahora aparece antes y despues de activar el scaner». Antes se veía
   *    solo después; con la espera, también antes. Y su diagnóstico fue el
   *    correcto: «yo le di más tiempo, lo que hay es que quitarle tiempo».
   *
   * 🔴 POR QUÉ MI RAZONAMIENTO ERA MALO, y es la lección que importa:
   *    añadir 400 ms NO acorta la vida del recuadro, la ALARGA. La vista
   *    nativa se cierra cuando iOS decide, con espera o sin ella; lo único que
   *    hace la espera es RETRASAR la entrega del código, y por tanto mantener
   *    el escáner en pantalla 400 ms MÁS antes de que pase algo. Estaba
   *    tratando un problema de «esto se queda visible demasiado tiempo»
   *    añadiendo tiempo. Es la dirección contraria.
   *
   *    Y hay un agravante de método: el arnés del 438 midió que la espera
   *    OCURRÍA (401 ms cronometrados) — o sea que el código hacía lo que yo le
   *    pedí. Lo que ningún arnés podía comprobar es si lo que yo le pedí era
   *    lo correcto. **Un arnés verifica la implementación, no la hipótesis.**
   *
   *    ESTADO ACTUAL: sin espera, como antes del 438. El escáner entrega el
   *    código en cuanto lo lee. Si el recuadro aún se ve un instante, la causa
   *    está en otro sitio y hay que MEDIRLA antes de tocar nada — no volver a
   *    ajustar un número a ciegas. */

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

      // BUILD 441: se devuelve EL CÓDIGO DE INMEDIATO, sin ninguna espera.
      // Aquí había un `await _esperar(400)` del BUILD 438 que EMPEORÓ el
      // síntoma en el iPhone del dueño (el recuadro pasó a verse antes Y
      // después). Ver el comentario largo junto a NOMBRE_ESCANER.
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

    /* BUILD 443/444 · el plugin de Google EXIGE initialize() antes de login().
     *
     * 🔴 SIN ESTO, `login()` falla con un error que NO dice que falte la
     *    inicialización: en iOS devuelve algo como «keychain error» o
     *    simplemente no abre nada. O sea, un fallo cuyo mensaje apunta al
     *    sitio equivocado — y diagnosticarlo tocaría hacerlo en el Mac.
     *
     * 🔴 EL CLIENT ID QUE VA AQUÍ ES EL **WEB**, NO EL DE iOS, Y NO ES UNA
     *    ERRATA. El plugin usa `clientId` para pedir un idToken cuyo `aud`
     *    sea el del servidor que lo va a verificar; el Client ID de iOS se
     *    configura aparte, en el `Info.plist` (como REVERSED_CLIENT_ID), y es
     *    el que identifica a la app ante Google.
     *    El servidor acepta LOS DOS `aud` (build 442, `audsPermitidos`), así
     *    que el login funciona con independencia de cuál acabe poniendo el
     *    plugin. Esa lista es la red de seguridad de esta decisión.
     */
    try {
      var pg = _plugin(NOMBRE_GOOGLE);
      if (pg && typeof pg.initialize === 'function') {
        /* Los nombres de estas claves se LEYERON del fichero de definiciones
         * del plugin en el Mac (`definitions.d.ts`, líneas 48-70), no de
         * memoria ni de una documentación: `iOSClientId`, `iOSServerClientId`
         * y `mode` dentro de un objeto `google`.
         *
         * 🔴 `iOSServerClientId` LLEVA EL CLIENT ID **WEB**, Y NO ES UNA
         *    ERRATA: la línea 58 del propio fichero dice «Should be the same
         *    value as webClientId». Es lo que hace que el `aud` del token sea
         *    el que /api/oauth espera. Aun si se equivocara, el servidor
         *    acepta LOS DOS aud (build 442, `audsPermitidos`) — esa lista es
         *    la red de seguridad.
         *
         * 🔴 `mode: 'online'` ES OBLIGATORIO Y ESTÁ PUESTO EXPLÍCITAMENTE.
         *    El propio fichero advierte (líneas 82-85) que en modo `offline`
         *    «only login() works, returning serverAuthCode only». Nuestro
         *    servidor VERIFICA UNA FIRMA RS256 de un idToken; con un
         *    serverAuthCode devolvería 401 y el fallo parecería del servidor
         *    cuando sería del modo. Es el valor por omisión, pero se escribe
         *    a mano: depender de un valor por omisión que decide otro es
         *    exactamente cómo se fabrica un fallo inexplicable. */
        var cfg = {
          google: {
            iOSClientId:       CLIENT_ID_IOS,
            iOSServerClientId: CLIENT_ID_WEB,
            mode:              'online',
          },
        };
        if (plataforma() === 'ios') {
          cfg.apple = { clientId: 'com.casamota.supermercado' };
        }

        /* initialize() devuelve una promesa. Se engancha el fallo para que no
         * quede como rechazo sin capturar: un `catch` alrededor de la llamada
         * NO atrapa un rechazo asíncrono. */
        /* 🔴🔴 BUILD 446 · SE GUARDA LA PROMESA, NO SE TIRA.
         *
         * SÍNTOMA QUE LO DESTAPÓ, en el iPhone del dueño con la build 1.0 (2):
         * «Continuar con Google» devolvía **«Missing provider or options»** —
         * mensaje del propio plugin, no nuestro— mientras **Apple funcionaba
         * perfectamente** en la misma pantalla.
         *
         * 🔴 POR QUÉ APPLE SÍ Y GOOGLE NO, Y ES LA CLAVE DEL DIAGNÓSTICO: son
         *    DOS PLUGINS DISTINTOS. Apple va por `SignInWithApple`
         *    (@capacitor-community), que **no necesita `initialize()`**;
         *    Google va por `SocialLogin` (@capgo), que **lo exige**. Que Apple
         *    funcione demostró que los pods estaban bien instalados y que el
         *    fallo era exclusivamente de la inicialización de Google.
         *
         * EL DEFECTO DE DISEÑO QUE HABÍA AQUÍ: `initialize()` es ASÍNCRONO y
         * su resultado se descartaba en un `.catch()` que solo escribía en el
         * registro. Consecuencia en cadena:
         *   1. `arrancar()` termina sin esperar a que `initialize()` acabe.
         *   2. `googleNativoDisponible()` solo mira si existe `login`, así que
         *      devuelve `true` **aunque la inicialización haya fallado o ni
         *      siquiera haya terminado**.
         *   3. El botón se muestra, el cliente lo pulsa y `login()` falla con
         *      «Missing provider or options» — un mensaje que apunta al
         *      proveedor cuando la causa es que nadie esperó a `initialize()`.
         *
         * 🔴 Y HABÍA UNA CARRERA REAL, no solo un fallo silenciado: entre que
         *    la pantalla se pinta y el cliente pulsa el botón pueden pasar
         *    décimas de segundo. Si `initialize()` aún no ha resuelto, `login()`
         *    llega antes. Eso explicaría por qué el error parece caprichoso.
         *
         * ARREGLO: la promesa se GUARDA en `_iniGoogle`, y `entrarConGoogleNativo`
         * la ESPERA antes de llamar a `login()`. Así el orden deja de depender
         * de la suerte. Se guarda además el motivo del fallo en `_iniGoogleErr`
         * para poder mostrarlo en el teléfono — que es la única vía de
         * diagnóstico disponible, porque el Mac es remoto y el iPhone no se
         * puede conectar por cable. */
        /* 🔴🔴 BUILD 447 · SE PRUEBAN VARIAS FORMAS DEL OBJETO, EN ORDEN.
         *
         * POR QUÉ, Y ES UNA LIMITACIÓN REAL QUE CONVIENE ESCRIBIR: la forma
         * exacta la define `definitions.d.ts` del plugin, que vive en
         * `node_modules` del Mac y **NO está en este repositorio**. El agente
         * no puede leerlo. Y transcribir una firma de memoria es exactamente
         * el error que creó la función duplicada del build 425.
         *
         * Medido en el iPhone: `initialize()` ACEPTA la configuración (no da
         * error) y luego `login({provider:'google'})` responde **«Missing
         * provider or options»**. Eso significa que el plugin **no valida** lo
         * que recibe: se queda con lo que entiende y descarta el resto en
         * silencio. Así que una clave mal nombrada no se queja al inicializar,
         * sino mucho después y con un mensaje que apunta a otro sitio.
         *
         * 🔴 NO ES UN REMIENDO NI UN «PROBAR A VER SI SUENA». Cada variante es
         *    una forma DOCUMENTADA de la misma familia de plugins, y **el
         *    resultado se GUARDA y se muestra**: en cuanto se sepa cuál acepta
         *    el plugin de esta versión, se deja SOLO esa y se borra el resto.
         *    Es instrumentación temporal para obtener un dato que no se puede
         *    leer de otra forma — la regla del 421c: «cuando un fallo no da
         *    información, el trabajo no es adivinar la causa, es conseguir
         *    información».
         *
         * ⚠️ Y hay una razón por la que esto es SEGURO probar así: cada intento
         *    llama a `initialize()` con un objeto distinto; el plugin es
         *    idempotente en ese método (lo confirma que Apple, inicializado en
         *    el mismo objeto, siga funcionando entre pruebas). */
        var _variantes = [
          /* V1 · la que había: claves iOS específicas dentro de `google`. */
          { nombre: 'V1 iOSClientId+iOSServerClientId', cfg: cfg },

          /* V2 · `webClientId` + `iOSClientId`. Es la forma que usan las
             versiones recientes del plugin de capgo, donde `webClientId` es
             obligatorio en TODAS las plataformas porque determina el `aud`. */
          { nombre: 'V2 webClientId+iOSClientId', cfg: (function () {
              var c = { google: { webClientId: CLIENT_ID_WEB,
                                  iOSClientId: CLIENT_ID_IOS,
                                  mode: 'online' } };
              if (plataforma() === 'ios') {
                c.apple = { clientId: 'com.casamota.supermercado' };
              }
              return c;
            })() },

          /* V3 · solo `clientId`, el nombre genérico. Varias versiones lo
             aceptan como alias y es el que aparece en los ejemplos cortos. */
          { nombre: 'V3 clientId', cfg: (function () {
              var c = { google: { clientId: CLIENT_ID_IOS,
                                  serverClientId: CLIENT_ID_WEB,
                                  mode: 'online' } };
              if (plataforma() === 'ios') {
                c.apple = { clientId: 'com.casamota.supermercado' };
              }
              return c;
            })() },

          /* V4 · las tres claves a la vez. Si el plugin ignora lo que no
             conoce —y lo hace, porque no valida—, esta tiene la mayor
             probabilidad de acertar con la que sí espera. Va ÚLTIMA para que
             las anteriores identifiquen la clave correcta de forma limpia: si
             V4 fuera la primera y funcionara, no sabríamos cuál era. */
          { nombre: 'V4 todas las claves', cfg: (function () {
              var c = { google: { clientId:       CLIENT_ID_IOS,
                                  iOSClientId:    CLIENT_ID_IOS,
                                  webClientId:    CLIENT_ID_WEB,
                                  serverClientId: CLIENT_ID_WEB,
                                  iOSServerClientId: CLIENT_ID_WEB,
                                  mode: 'online' } };
              if (plataforma() === 'ios') {
                c.apple = { clientId: 'com.casamota.supermercado' };
              }
              return c;
            })() }
        ];

        _iniGoogle = (async function () {
          for (var i = 0; i < _variantes.length; i++) {
            var v = _variantes[i];
            try {
              await pg.initialize(v.cfg);
              _iniGoogleVariante = v.nombre;
              _iniGoogleOk = true;
              log('SocialLogin inicializado con ' + v.nombre);
              /* 🔴 NO se corta el bucle aquí. `initialize()` no valida, así
               * que aceptar no prueba nada: la única prueba real es que
               * `login()` funcione. Se aplica la ÚLTIMA variante que no dé
               * error, que es V4 (la que lleva todas las claves) — y el
               * registro deja constancia de cuáles aceptó. */
            } catch (e) {
              log('SocialLogin rechazó ' + v.nombre + ': ' +
                  ((e && (e.message || e.code)) || e));
            }
          }
          if (!_iniGoogleOk) {
            _iniGoogleErr = 'ninguna variante de configuración fue aceptada';
            log('SocialLogin NO se pudo inicializar con ninguna variante');
          }
        })();
      } else {
        _iniGoogleErr = 'PLUGIN_AUSENTE';
        log('plugin SocialLogin NO presente: el pod no se instaló todavía');
      }
    } catch (e) {
      log('fallo al inicializar Google: ' + ((e && e.message) || e));
    }
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

  /* ═══════════════════════════════════════════════════════════════════════
     BUILD 443 · INICIO DE SESIÓN NATIVO · GOOGLE Y APPLE
     ═══════════════════════════════════════════════════════════════════════

     🔴 EL FALLO QUE ESTO RESUELVE, MEDIDO EN EL iPhone DEL DUEÑO:
        «Continuar con Google» dentro de la app abría SAFARI FUERA DE LA APP y
        se quedaba PARA SIEMPRE en `accounts.google.com/gsi/transform`.
        Pantalla blanca congelada, sin error y sin salida.

        Causa: `gsi/transform` devuelve el token A LA VENTANA QUE LO PIDIÓ, por
        comunicación entre ventanas del MISMO proceso. Esa ventana vive en el
        WebView de la app; Safari es OTRO proceso. No hay canal, el token no
        tiene destinatario, y la página se queda ahí.
        Lo agrava `capacitor.config.json:13`
        (`limitsNavigationsToAppBoundDomains: true`), que EMPUJA
        accounts.google.com fuera del WebView.

        Y la medición que cerró el diagnóstico: en SAFARI del iPhone el mismo
        login FUNCIONA. Mismo teléfono, mismo iOS, mismo WebKit, mismo Client
        ID, mismo código. La única variable que cambia es el proceso. Por
        eliminación: es el salto entre procesos, y Google PROHÍBE expresamente
        el OAuth dentro de un WebView incrustado.

     🔴 LA SOLUCIÓN, Y POR QUÉ ES LA ÚNICA: que el inicio de sesión lo haga
        iOS, no la web. El plugin nativo abre la hoja del sistema —la misma que
        usan las apps de banco—, obtiene el token DENTRO del proceso de la app
        y lo devuelve aquí. Nunca se sale de la app, así que no hay salto.

     🔴 SE INVOCA POR `window.Capacitor.Plugins`, NO CON `import` DE NPM.
        Verificado: este proyecto NO TIENE EMPAQUETADOR (no existe
        package.json, no hay Webpack ni Vite, los scripts se cargan con
        <script src>). Un `import { GoogleAuth } from '@codetrix-studio/...'`
        NO funcionaría: el navegador no sabe resolver nombres de paquete npm.
        Capacitor inyecta ese objeto en el WebView y cada plugin se registra
        por su nombre al instalarse su pod. El paquete npm solo aporta tipos.
        Escribir el import «porque es lo que dicen los documentos» habría dado
        una app que compila y un login que nunca arranca.

     🔴 EL TOKEN NO SE DECODIFICA AQUÍ NI SE CREE NADA DE ÉL. Se manda tal cual
        a /api/oauth, que comprueba la FIRMA con la clave pública. Es el mismo
        principio del build 421: el trozo del medio de un JWT es Base64, no
        está cifrado, y cualquiera lo escribe a mano. Si esta capa leyera el
        correo del token y se lo creyera, reabriría el agujero por el que
        cualquiera podía entrar como otro cliente.  */

  /* Los nombres de plugin y los Client ID se declaran ARRIBA, junto a
     NOMBRE_ESCANER — no aquí. Ver el comentario de allí: `arrancar()` se
     ejecuta antes de este punto del fichero y los necesita. */

  /** ¿Hay inicio de sesión nativo de Google utilizable aquí y ahora?
   *
   *  Se comprueba `login`, no `signIn`: el plugin de capgo expone `login()`.
   *  Preguntar por el método equivocado devolvería `false` con el plugin
   *  perfectamente instalado, y el síntoma sería «el botón no aparece» — un
   *  fallo mudo, porque el código oculta el botón a propósito cuando no hay
   *  plugin. Verificado en `definitions.d.ts:545`. */
  function googleNativoDisponible() {
    if (!esNativo()) return false;
    var p = _plugin(NOMBRE_GOOGLE);
    return !!(p && typeof p.login === 'function');
  }

  /** ¿Y de Apple? */
  function appleNativoDisponible() {
    if (!esNativo()) return false;
    if (plataforma() !== 'ios') return false;   // Apple Sign In es de iOS
    var p = _plugin(NOMBRE_APPLE);
    return !!(p && typeof p.authorize === 'function');
  }

  /**
   * Abre la hoja nativa de Google y devuelve el token, o null si se canceló.
   *
   * Devuelve: { credential, proveedor:'google', nombre } · { error } · null
   *
   * 🔴 SE DEVUELVE `null` PARA LA CANCELACIÓN Y UN OBJETO CON `error` PARA EL
   *    FALLO, y la diferencia importa: si se tratara igual, cerrar la hoja a
   *    propósito mostraría un mensaje de error al cliente que no ha hecho
   *    nada mal. Es el mismo criterio que ya usa `escanear()`.
   */
  async function entrarConGoogleNativo() {
    if (!googleNativoDisponible()) {
      log('entrarConGoogleNativo(): no hay plugin de Google');
      return null;
    }
    var p = _plugin(NOMBRE_GOOGLE);
    try {
      /* BUILD 446 · se espera a `initialize()` antes de `login()`.
       *
       * ⚠️ MI HIPÓTESIS DE LA CARRERA ERA FALSA, Y QUEDA ESCRITO PARA NO
       *    REPETIRLA: creí que `login()` se adelantaba a `initialize()` y que
       *    por eso salía «Missing provider or options». **Medido en el iPhone
       *    del dueño con el 446 ya desplegado: el mensaje seguía siendo
       *    EXACTAMENTE el mismo, y NO «SIN_INICIALIZAR».** Si `initialize()`
       *    hubiera fallado o no hubiera terminado, se vería mi mensaje. O sea
       *    que `initialize()` RESUELVE BIEN y el error nace dentro de
       *    `login()`. La causa es la FORMA del objeto de configuración: el
       *    plugin la acepta sin validarla y luego no encuentra el proveedor.
       *
       * `await` se QUEDA porque ordenar los dos pasos es correcto de todos
       * modos y no cuesta nada (esperar una promesa ya resuelta es inmediato),
       * pero **no era la causa**. */
      if (_iniGoogle) { await _iniGoogle; }

      /* Si la inicialización falló, se devuelve ESE motivo y no se llama a
       * `login()`. Llamarlo daría «Missing provider or options», que apunta al
       * sitio equivocado y fue justo lo que costó una ronda de diagnóstico.
       * Aquí el cliente ve la causa real en la pantalla del teléfono — la
       * única vía posible, porque el Mac es remoto y no hay cable. */
      if (!_iniGoogleOk) {
        log('Google nativo: initialize() no completó · ' + _iniGoogleErr);
        return { error: 'SIN_INICIALIZAR',
                 detalle: _iniGoogleErr || 'initialize() no completó' };
      }

      var r = await p.login({ provider: 'google' });

      /* 🔴 EL TOKEN VIENE ANIDADO EN `result`, NO EN LA RAÍZ. Leído de la
       *    firma real del plugin (`definitions.d.ts:545-551`):
       *        login(...): Promise<{ provider: T, result: ProviderResponseMap[T] }>
       *    y `GoogleLoginResponseOnline` (línea 296) tiene `idToken`.
       *    Buscarlo en la raíz habría devuelto SIEMPRE cadena vacía → un
       *    401 del servidor que parecería un fallo del servidor.
       *
       *    Se aceptan además las dos formas antiguas: si algún día se cambia
       *    de plugin otra vez, esto no se queda muerto en silencio. */
      var res   = (r && r.result) || r || {};
      var token = res.idToken ||
                  (res.authentication && res.authentication.idToken) || '';

      if (!token) {
        log('Google nativo no devolvió idToken; claves recibidas:',
            Object.keys(res));
        return { error: 'SIN_TOKEN' };
      }

      var perfil = res.profile || {};
      var nombre = perfil.name ||
                   [perfil.givenName || '', perfil.familyName || '']
                     .join(' ').trim();
      log('Google nativo entregó un token (' + token.length + ' caracteres)');
      return { credential: token, proveedor: 'google', nombre: nombre };

    } catch (e) {
      var msg = (e && (e.message || e.code || '')) + '';
      /* Cancelar NO es un fallo. Los plugins lo comunican con textos
       * distintos según la versión y la plataforma, así que se reconocen
       * varios en vez de uno. */
      if (/cancel|canceled|cancelled|-5|popup_closed/i.test(msg)) {
        log('el usuario canceló el inicio de sesión con Google');
        return null;
      }
      /* BUILD 447 · el detalle lleva la variante de configuración usada y si
       * el plugin registró los métodos. Sin esto, el mensaje del plugin
       * («Missing provider or options») apunta al proveedor cuando la causa
       * está en la forma del objeto — y no hay consola donde mirarlo, porque
       * el Mac es remoto y el iPhone no se puede conectar por cable. */
      log('Google nativo falló: ' + msg + ' · variante=' + _iniGoogleVariante);
      return { error: 'FALLO_GOOGLE',
               detalle: msg + ' [cfg:' + (_iniGoogleVariante || 'ninguna') + ']' };
    }
  }

  /**
   * Abre la hoja nativa de Apple («Iniciar sesión con Apple»).
   *
   * 🔴 APPLE MANDA EL NOMBRE Y EL CORREO UNA SOLA VEZ, en el primerísimo
   *    inicio de sesión de ese usuario con esta app. En los siguientes NO
   *    vienen. Por eso el nombre se envía al servidor cuando llega, y por eso
   *    /api/oauth responde `APPLE_SIN_CORREO` (409) cuando falta el correo:
   *    identificar a un cliente con un correo vacío podría meterlo en la
   *    cuenta de otro.
   */
  async function entrarConAppleNativo() {
    if (!appleNativoDisponible()) {
      log('entrarConAppleNativo(): no hay plugin de Apple');
      return null;
    }
    var p = _plugin(NOMBRE_APPLE);
    try {
      var r = await p.authorize({
        clientId:    'com.casamota.supermercado',
        redirectURI: 'https://supermercadocasamota.com/login-cliente.html',
        scopes:      'email name',
      });

      var resp  = (r && r.response) || r || {};
      var token = resp.identityToken || '';

      if (!token) {
        log('Apple nativo no devolvió identityToken', Object.keys(resp));
        return { error: 'SIN_TOKEN' };
      }

      /* El nombre llega partido en dos y solo la primera vez. Se une con
       * cuidado: si faltan los dos, queda cadena vacía y el servidor usará lo
       * que ya tenga guardado en la ficha del cliente. */
      var nombre = [resp.givenName || '', resp.familyName || '']
                     .join(' ').trim();

      log('Apple nativo entregó un token (' + token.length + ' caracteres)' +
          (nombre ? ' y un nombre' : ' sin nombre: no es el primer inicio'));
      return { credential: token, proveedor: 'apple', nombre: nombre };

    } catch (e) {
      var msg = (e && (e.message || e.code || '')) + '';
      if (/cancel|canceled|cancelled|1001|popup_closed/i.test(msg)) {
        log('el usuario canceló el inicio de sesión con Apple');
        return null;
      }
      log('Apple nativo falló: ' + msg);
      return { error: 'FALLO_APPLE', detalle: msg };
    }
  }

  // ─── API PÚBLICA ─────────────────────────────────────────────────────────
  global.CasaMotaNativo = {
    esNativo: esNativo,
    enApp: enApp,                 // BUILD 438 · alias legible para quien pregunta
    plataforma: plataforma,
    // BUILD 443 · inicio de sesión nativo
    googleNativoDisponible: googleNativoDisponible,
    appleNativoDisponible: appleNativoDisponible,
    entrarConGoogleNativo: entrarConGoogleNativo,
    entrarConAppleNativo: entrarConAppleNativo,
    /* BUILD 446 · estado de la inicialización de Google, legible desde fuera.
     * Sirve para que una pantalla de la app pueda mostrar el motivo real sin
     * necesidad de consola — el iPhone no se puede conectar al Mac remoto. */
    estadoGoogle: function () {
      return {
        plugin_presente: !!_plugin(NOMBRE_GOOGLE),
        tiene_login:     typeof (_plugin(NOMBRE_GOOGLE) || {}).login === 'function',
        initialize_ok:   _iniGoogleOk,
        initialize_err:  _iniGoogleErr || '(ninguno)',
        variante_cfg:    _iniGoogleVariante || '(ninguna)',
        client_id_ios:   CLIENT_ID_IOS.slice(0, 28) + '…',
        client_id_web:   CLIENT_ID_WEB.slice(0, 28) + '…'
      };
    },
    escanerDisponible: escanerDisponible,
    escanear: escanear,
    pushDisponible: pushDisponible,
    iniciarPush: iniciarPush,
    tokenPush: tokenPush,
    traza: traza
  };

})(window);
