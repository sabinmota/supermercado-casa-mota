/* ════════════════════════════════════════════════════════════════════════════
 * POS · PUNTO DE VENTA AUXILIAR · Casa Mota
 * Creado: 2026-09-20 · build POS-1 · POS-2 y POS-3 el 2026-09-23
 *
 * 🔴 FICHERO NUEVO. No modifica ni `app.js` ni `admin.v33.js`. Si este módulo
 *    se borrara, el resto del proyecto seguiría igual. Es deliberado: el POS
 *    va a manejar NCF fiscales y no puede arriesgar la tienda ni el panel.
 *
 * 🔴 VA EN UN .js EXTERNO Y NO EN UN <script> DE pos.html A PROPÓSITO.
 *    Este código construye HTML en cadenas de texto; dentro de un script
 *    embebido, una secuencia de cierre de etiqueta rompe el parseo y el resto
 *    de la página se pinta como texto visible SIN dar un solo error de
 *    consola. Ya ocurrió en este proyecto.
 *
 * 🔴 SOLO CARACTERES NORMALES. En POS-3 se coló un carácter de uso privado
 *    (el logo de Apple escrito como texto): en Windows sale como un cuadrado
 *    y las herramientas de edición no podían localizar la línea. Hubo que
 *    reescribir el fichero entero para sacarlo.
 *
 * DEPENDE DE (cargados antes en pos.html):
 *   · js/api.js          → const DB, _SB_URL, _SB_HEADERS, _valeAdmin
 *   · js/auth.v33.js     → login(correo, clave) vía RPC verify_staff_password
 *   · js/pos-anuncios.js → window.CASAMOTA_ANUNCIOS_POS (opcional)
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Estado ─────────────────────────────────────────────────────────────── */
  var _cajera     = null;   // ficha de staff de la sesión
  var _productos  = [];     // catálogo en memoria
  var _porBarcode = {};     // índice barcode → producto
  var _lineas     = [];     // líneas de la venta en curso
  var _caja       = '01';
  var _ultimoPeso = null;   // { peso, nombre } de la última etiqueta de báscula

  /* POS-2 · LÍMITE DE ITBIS (pedido del dueño, 2026-09-23)
   *   estado 'libre'    → factura con normalidad
   *   estado 'ultima'   → se alcanzó el límite CON una factura abierta: se
   *                       puede COBRAR esa factura, pero no añadirle nada
   *   estado 'cerrada'  → la caja no registra ni cobra ventas nuevas
   *   estado 'sin_dato' → no se pudo consultar el estado: se bloquea */
  var _limite = { valor: null, acumulado: 0, estado: 'libre' };

  /* ════════════════════════════════════════════════════════════════════════
   * DESCIFRADO DEL CÓDIGO DE BÁSCULA
   *
   * 🔴 FÓRMULA VERIFICADA CONTRA TRES ETIQUETAS REALES (2026-09-21).
   *    NO está deducida: se comprobó que el peso extraído × el precio por
   *    libra del catálogo da EXACTAMENTE el total impreso por la báscula.
   *
   *      0 001006 00025 4   → 0,25 lb × 220,00 =  55,00  ✅ etiqueta:  55,00
   *      0 001081 00166 5   → 1,66 lb × 335,00 = 556,10  ✅ etiqueta: 556,10
   *      0 008110 00152 8   → 1,52 lb × 260,00 = 395,20  ✅ etiqueta: 395,20
   *
   *    La tercera etiqueta fue la decisiva: con solo la primera (0,25) no se
   *    podía distinguir entre centésimas y milésimas de libra. El 1,66
   *    descarta las milésimas. UNA sola muestra no habría demostrado nada.
   *
   * ESTRUCTURA (13 dígitos):
   *      0        001006        00025      4
   *      prefijo  barcode(6)    peso×100   control EAN-13 (se DESCARTA)
   *
   * 🔴 EL ÚLTIMO DÍGITO NO ES DATO. Si se incluyera en el peso, 00025+4
   *    daría 2,54 lb en vez de 0,25 → el queso se cobraría diez veces de más.
   * ════════════════════════════════════════════════════════════════════════ */
  var LARGO_BASCULA   = 13;
  var PREFIJO_BASCULA = '0';
  var PESO_MAXIMO_LB  = 200;   // nada que se venda al peso llega a 200 lb

  /* Dígito de control EAN-13 de las 12 primeras cifras. */
  function controlEan13(d12) {
    var suma = 0;
    for (var i = 0; i < 12; i++) { suma += Number(d12.charAt(i)) * (i % 2 ? 3 : 1); }
    return (10 - (suma % 10)) % 10;
  }

  function descifrarBascula(codigo) {
    var s = String(codigo || '').replace(/\D/g, '');

    /* 🔴 POS-4 (2026-09-23) · LA PISTOLA MANDA 12 CIFRAS, NO 13.
     *    Etiqueta del bacalao: impresa `0 001040 00079 1` (13). La pistola
     *    envió `001040000791` (12): un EAN-13 que empieza por 0 lo lee como
     *    UPC-A y QUITA ESE 0. El POS solo aceptaba 13 cifras, así que la
     *    etiqueta no se reconocía como pesada y se buscaba entera en el
     *    catálogo → «no está en el catálogo». Visto por el dueño en caja.
     *    Las TRES etiquetas probadas antes eran de 13 porque se TECLEARON
     *    copiándolas del papel, no se escanearon: la prueba no reproducía
     *    lo que hace la pistola.
     *    Arreglo: con 12 cifras se repone el 0 delante y sigue igual. */
    if (s.length === LARGO_BASCULA - 1) { s = PREFIJO_BASCULA + s; }
    if (s.length !== LARGO_BASCULA) { return null; }

    /* 🔴 Y SE EXIGE EL DÍGITO DE CONTROL. Aceptar 12 cifras amplía qué
     *    códigos pueden confundirse con una pesada (cualquier UPC-A de
     *    fábrica que empiece por 0). La báscula imprime un control EAN-13
     *    válido (verificado en las cinco etiquetas reales: 0001006000254,
     *    0001081001665, 0008110001528, 0001040000791, 0001036001122);
     *    un código ajeno que casualmente encaje tiene 9 de 10 papeletas de
     *    fallar aquí. Además `procesar()` mira el catálogo ANTES. */
    if (controlEan13(s) !== Number(s.charAt(12))) { return null; }

    /* 🔴 EL PREFIJO SE COMPRUEBA, Y ES LA CORRECCIÓN MÁS IMPORTANTE.
     *
     *    PRIMERA VERSIÓN: descifraba CUALQUIER código de 13 cifras como si
     *    fuera una pesada, sin mirar el primer dígito. El dueño escaneó unos
     *    vasos desechables con código `7460234530057` y el POS lo troceó así:
     *
     *        7 · 460234 · 53005 · 7   →  «producto 460234», 530,05 lb
     *
     *    De ahí el mensaje absurdo que vio. Y el «no encontrado» fue el caso
     *    CON SUERTE: si `460234` hubiera existido en el catálogo, habría
     *    cobrado ese otro producto con 530 libras de peso, **sin dar ningún
     *    error y con la factura cuadrada**.
     *
     *    Las tres etiquetas reales de la báscula empiezan TODAS por 0:
     *        0001006000254 · 0001081001665 · 0008110001528
     *    Ese 0 es el marcador de producto pesado. Un EAN-13 de fábrica
     *    empieza por el prefijo de país (7 en R. Dominicana, 8 en España…),
     *    nunca por 0 salvo los UPC-A estadounidenses — y a esos los protege
     *    el orden de `procesar()`, que mira el catálogo ANTES de llegar aquí.
     *
     *    ⚠️ Yo diagnostiqué al dueño que la causa era «los EAN que empiezan
     *    por 0». Era FALSO: el suyo empieza por 7. La causa real era no
     *    comprobar el prefijo en absoluto. Se corrigió al IMPRIMIR el troceo
     *    del código real, no razonando sobre él. */
    if (s.charAt(0) !== PREFIJO_BASCULA) { return null; }

    var barcode = s.substring(1, 7);           // 6 cifras del producto
    var crudo   = s.substring(7, 12);          // 5 cifras de peso
    // El dígito 13 (s[12]) es el control EAN-13 y NO se usa.

    var peso = parseInt(crudo, 10) / 100;      // centésimas de libra
    if (!isFinite(peso) || peso <= 0) { return null; }

    /* Tope de cordura: un peso disparatado significa que el código NO era
     * una pesada aunque empiece por 0. Más vale «no reconocido» que cobrar
     * 500 libras de queso. */
    if (peso > PESO_MAXIMO_LB) { return null; }

    return { barcode: barcode, peso: peso };
  }

  /* ── Utilidades ─────────────────────────────────────────────────────────── */
  function dosDig(n) { return String(n).padStart(2, '0'); }

  function dinero(n) {
    return (Math.round(Number(n) * 100) / 100)
      .toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(id) { return document.getElementById(id); }

  /* ════════════════════════════════════════════════════════════════════════
   * ITBIS · EXTRACCIÓN, no suma
   *
   * ⚠️ LOS PRECIOS DEL CATÁLOGO YA INCLUYEN EL IMPUESTO (confirmado por el
   *    dueño). Así que el ITBIS se SACA de dentro del precio:
   *
   *      base  = precio / (1 + tasa/100)
   *      itbis = precio - base
   *
   *    Verificado contra el recibo del programa viejo:
   *      50,00 / 1,18 = 42,37  ·  itbis 7,63  ·  suma 50,00  ✅
   *
   * 🔴 SI SE SUMARA en vez de extraer, el cliente pagaría el impuesto DOS
   *    VECES y el total no cuadraría con el precio de la estantería.
   * ════════════════════════════════════════════════════════════════════════ */
  function desglosar(importe, tasa) {
    var t    = Number(tasa);
    var base = importe / (1 + t / 100);
    return {
      base:  Math.round(base * 100) / 100,
      itbis: Math.round((importe - base) * 100) / 100
    };
  }

  /* ── Aviso en pantalla ──────────────────────────────────────────────────── */
  var _tAviso = null;
  function avisar(texto, tipo) {
    var el = $('pos-aviso');
    if (!el) { return; }
    el.textContent = texto;
    el.className = 'pos-aviso pos-aviso--' + (tipo || 'info');
    el.hidden = false;
    if (_tAviso) { clearTimeout(_tAviso); }
    // Los errores se quedan más tiempo: son los que hay que leer.
    _tAviso = setTimeout(function () { el.hidden = true; },
                         tipo === 'error' ? 6000 : 3000);
  }

  function pitar(malo) {
    /* Sonido generado, sin fichero externo: un .mp3 obligaría a subir un
     * binario y a que el navegador lo cachee. Y sobre todo, la cajera NO
     * mira la pantalla mientras escanea: el oído es el canal real. */
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.frequency.value = malo ? 220 : 880;   // grave = error, agudo = OK
      g.gain.value = 0.15;
      osc.start();
      setTimeout(function () { osc.stop(); ctx.close(); }, malo ? 260 : 90);
    } catch (e) { /* sin audio: el aviso visual sigue estando */ }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * LOGIN DE CAJERA
   * Reutiliza `login()` de js/auth.v33.js → RPC `verify_staff_password`.
   * 🔴 NO se compara ninguna contraseña en el navegador. Desde el build 395
   *    la clave no sale de la base: antes el navegador se descargaba la
   *    columna `password` de TODO el personal y cualquiera podía leerla.
   * ════════════════════════════════════════════════════════════════════════ */
  function montarLogin() {
    var form = $('pos-login-form');
    if (!form) { return; }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      entrar();
    });
  }

  async function entrar() {
    var correo = ($('pos-correo').value || '').trim();
    var clave  = ($('pos-clave').value  || '').trim();
    var err    = $('pos-login-error');
    var btn    = $('pos-entrar');

    if (!correo || !clave) {
      err.textContent = 'Escriba su usuario y su contraseña.';
      err.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Comprobando…';
    err.hidden = true;

    /* 🔴 EL MENSAJE DICE QUÉ FALLÓ, NO «no se pudo entrar».
     *    Primera versión: cualquier problema mostraba «Usuario o contraseña
     *    incorrectos», así que una función SQL ausente, un fallo de red y una
     *    clave mal escrita se veían IGUAL. El dueño no pudo entrar y no había
     *    forma de saber por qué.
     *    Regla del build 421c: cuando un fallo no da información, el trabajo
     *    no es adivinar la causa sino conseguir información. */
    try {
      if (typeof login !== 'function') {
        err.innerHTML = '<b>Falta js/auth.v33.js.</b> La función de acceso no ' +
                        'está cargada. Es un fallo de la página, no de su clave.';
        err.hidden = false;
        return;
      }
      if (typeof DB === 'undefined') {
        err.innerHTML = '<b>Falta js/api.js.</b> No hay conexión con la base. ' +
                        'Es un fallo de la página, no de su clave.';
        err.hidden = false;
        return;
      }

      var r = await login(correo, clave);

      if (!r) {
        err.innerHTML = '<b>La verificación no devolvió respuesta.</b> ' +
                        'Puede ser un problema de red.';
        err.hidden = false;
        return;
      }
      if (!r.ok) {
        err.textContent = r.msg || 'Usuario o contraseña incorrectos.';
        err.hidden = false;
        console.warn('[POS] acceso denegado:', r.msg);
        return;
      }
      if (!r.user || !r.user.id) {
        err.innerHTML = '<b>Entró, pero la ficha llegó incompleta.</b> ' +
                        'Avise al administrador.';
        err.hidden = false;
        return;
      }

      _cajera = r.user;
      await arrancarCaja();

    } catch (e) {
      /* El motivo real va a la consola; en pantalla, algo entendible pero
       * que NO culpe a la contraseña si el problema es otro. */
      console.error('[POS] error al entrar:', e);
      err.innerHTML = '<b>No se pudo completar el acceso.</b><br>' +
                      '<span style="font-size:.82rem">' + esc(e && e.message ? e.message : e) +
                      '</span>';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  }

  /* ── Arranque de la caja ────────────────────────────────────────────────── */
  async function arrancarCaja() {
    $('pos-login').hidden = true;
    $('pos-caja').hidden  = false;

    var nombre = [_cajera.firstName, _cajera.lastName].filter(Boolean).join(' ');
    $('pos-cajera').textContent = nombre || _cajera.email || '—';

    $('pos-cargando').hidden = false;
    try {
      /* full:true → hacen falta `barcode`, `itbis_tasa` y `es_pesado`, que no
       * están en el select ligero de la tienda. */
      _productos = await DB.getProducts({ full: true });
      indexar();
      montarPromo();
      $('pos-cargando').hidden = true;
      $('pos-total-articulos').textContent = _productos.length;
      avisar('Catálogo cargado: ' + _productos.length + ' productos', 'ok');
      $('pos-entrada').focus();
    } catch (e) {
      $('pos-cargando').textContent =
        'No se pudo cargar el catálogo. Revise la conexión y recargue.';
      avisar('Error al cargar el catálogo', 'error');
    }
    pintar();
    relojArranca();
    await cargarLimite();
  }

  function indexar() {
    _porBarcode = {};
    for (var i = 0; i < _productos.length; i++) {
      var p = _productos[i];
      if (p.deleted === true) { continue; }
      var b = String(p.barcode || '').trim();
      if (b) { _porBarcode[b] = p; }
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * ENTRADA DE CÓDIGOS
   * La pistola Motorola es TECLADO-EMULADO: escribe el código en el campo
   * con el foco y manda Enter. No hace falta driver ni permiso.
   * ════════════════════════════════════════════════════════════════════════ */
  function montarEntrada() {
    var inp = $('pos-entrada');
    if (!inp) { return; }

    inp.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') { return; }
      ev.preventDefault();
      var v = (inp.value || '').trim();
      inp.value = '';
      if (v) { procesar(v); }
    });

    /* El foco vuelve siempre al campo: si la cajera toca un botón y luego
     * escanea, el código se perdería en la nada. */
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' ||
                t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) { return; }
      if (!$('pos-caja').hidden && !$('pos-modal-pago').hidden === false) {
        inp.focus();
      }
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 🔴🔴 EL ORDEN DE ESTAS COMPROBACIONES ES UN FALLO YA COMETIDO.
   *
   * PRIMERA VERSIÓN: probaba la báscula ANTES que el código normal, «porque
   * un código de 13 cifras que empieza por 0 podría confundirse con un EAN».
   * Estaba exactamente al revés, y el dueño lo encontró en un minuto:
   *
   *   Escaneó un paquete de vasos desechables. Su código EAN-13 real empieza
   *   por 0 y tiene 13 cifras — como CUALQUIER producto de origen
   *   estadounidense (los UPC-A de 12 dígitos se representan con un 0
   *   delante). Mi función lo troceó como si fuera una pesada, sacó un
   *   «producto 460234» inventado de la mitad del código y dijo que NO
   *   ESTABA EN EL CATÁLOGO.
   *
   *   El producto SÍ estaba. El error era mío, y el mensaje culpaba al
   *   catálogo — mandando al dueño a registrar un artículo ya registrado.
   *
   * ARREGLO, y el criterio es el correcto: **el catálogo manda.** Si el
   * código escaneado existe tal cual en `barcode`, ES ese producto y no hay
   * nada que interpretar. Solo cuando NO existe tiene sentido preguntarse si
   * será una etiqueta de báscula.
   *
   * Esto vale para cualquier EAN que empiece por 0 — que son miles.
   * ════════════════════════════════════════════════════════════════════════ */
  function procesar(codigo) {
    var s = String(codigo).replace(/\s/g, '');

    /* 1 · ¿El código existe TAL CUAL en el catálogo? Entonces es ese producto.
     *     Va primero a propósito: un dato real gana a cualquier heurística. */
    var p = _porBarcode[s];
    if (p) { anadir(p, 1, false); return; }

    /* 1b · Mismo código sin ceros a la izquierda. Las bases de datos suelen
     *      guardar «7501234567890» mientras el lector manda
     *      «07501234567890», o al revés. */
    var sinCeros = s.replace(/^0+/, '');
    if (sinCeros && sinCeros !== s && _porBarcode[sinCeros]) {
      anadir(_porBarcode[sinCeros], 1, false);
      return;
    }

    /* 2 · No está en el catálogo → ¿será una etiqueta de báscula? */
    var bas = descifrarBascula(s);
    if (bas) {
      var pPesado = _porBarcode[bas.barcode];
      if (pPesado) { anadir(pPesado, bas.peso, true); return; }

      /* Ni como código entero ni como báscula. El mensaje dice LAS DOS cosas
       * que se intentaron, para no mandar a registrar algo que ya existe. */
      pitar(true);
      avisar('El código ' + s + ' no está en el catálogo. Se probó también ' +
             'como etiqueta de báscula (producto ' + bas.barcode +
             ') y tampoco. Búsquelo por nombre.', 'error');
      buscarPorTexto('');
      return;
    }

    /* 3 · Ni código conocido ni báscula → buscar por nombre */
    pitar(true);
    avisar('El código ' + s + ' no está en el catálogo.', 'error');
  }

  /* ════════════════════════════════════════════════════════════════════════
   * AÑADIR LÍNEA
   * 🔴 SE NIEGA A FACTURAR UN PRODUCTO SIN TASA DE ITBIS.
   *    Es deliberado y es la decisión más importante de este fichero. Si se
   *    asumiera una tasa por omisión:
   *      · 0  → se deja de cobrar un impuesto que sí corresponde
   *      · 18 → se cobra impuesto sobre un producto exento
   *    Las dos salidas son un error FISCAL que no da ningún síntoma: la
   *    factura sale cuadrada y el descuadre aparece en la declaración.
   *    Quedan 524 productos sin tasa decidida; el POS los señala en caja.
   * ════════════════════════════════════════════════════════════════════════ */
  function anadir(p, cantidad, esPeso) {
    /* POS-2 · Con el límite alcanzado no entra NADA más, ni en la factura
     * abierta («hasta donde llegue») ni en una nueva. */
    if (_limite.estado !== 'libre') {
      pitar(true);
      mostrarLimite();
      return;
    }

    if (p.itbis_tasa === null || p.itbis_tasa === undefined || p.itbis_tasa === '') {
      pitar(true);
      avisar('«' + p.name + '» no tiene ITBIS asignado. No se puede facturar ' +
             'hasta que se le ponga la tasa en el panel.', 'error');
      return;
    }

    var precio = Number(p.price) || 0;

    /* Un producto pesado con precio 0 daría una línea a cero sin avisar. */
    if (precio <= 0) {
      pitar(true);
      avisar('«' + p.name + '» no tiene precio. Revise su ficha.', 'error');
      return;
    }

    /* Los pesados NO se agrupan: cada etiqueta es una pesada distinta y
     * sumarlas escondería de qué pesada viene cada importe. */
    if (!esPeso) {
      for (var i = 0; i < _lineas.length; i++) {
        if (_lineas[i].id === p.id && !_lineas[i].esPeso) {
          _lineas[i].cantidad += cantidad;
          pitar(false); pintar(); ultimoProducto(p);
          comprobarLimite();
          return;
        }
      }
    }

    _lineas.push({
      id:       p.id,
      nombre:   p.name,
      barcode:  p.barcode || '',
      precio:   precio,
      cantidad: cantidad,
      tasa:     Number(p.itbis_tasa),
      esPeso:   !!esPeso,
      unidad:   p.unit || '',
      image:    p.image || ''
    });

    if (esPeso) { _ultimoPeso = { peso: cantidad, nombre: p.name }; }

    pitar(false);
    pintar();
    ultimoProducto(p);
    comprobarLimite();
  }

  /* Foto del último producto escaneado · pedido por el dueño.
   * Confirma de un vistazo que se leyó el artículo correcto sin tener que
   * buscar la línea en la lista. */
  function ultimoProducto(p) {
    var caja = $('pos-ultimo');
    if (!caja) { return; }
    var img = p.image
      ? '<img src="' + esc(p.image) + '" alt="" class="pos-ultimo__img">'
      : '<div class="pos-ultimo__sinfoto">' + esc((p.name || '?').charAt(0)) + '</div>';
    caja.innerHTML =
      img +
      '<div class="pos-ultimo__txt">' +
        '<b>' + esc(p.name) + '</b>' +
        '<span>RD$ ' + dinero(p.price) + (p.unit ? ' / ' + esc(p.unit) : '') + '</span>' +
      '</div>';
    caja.hidden = false;
  }

  /* ── Búsqueda por texto ─────────────────────────────────────────────────── */
  function buscarPorTexto(texto) {
    var q = String(texto).toLowerCase().trim();
    if (q.length < 2) { return; }

    var hits = [];
    for (var i = 0; i < _productos.length && hits.length < 24; i++) {
      var p = _productos[i];
      if (p.deleted === true) { continue; }
      if (String(p.name || '').toLowerCase().indexOf(q) >= 0) { hits.push(p); }
    }

    var cont = $('pos-resultados');
    if (!hits.length) {
      cont.innerHTML = '<p class="pos-vacio">Sin resultados para «' + esc(texto) + '»</p>';
      avisar('No se encontró «' + texto + '»', 'error');
      return;
    }

    var h = '';
    for (var k = 0; k < hits.length; k++) {
      var x = hits[k];
      var sinTasa = (x.itbis_tasa === null || x.itbis_tasa === undefined);
      h += '<button type="button" class="pos-hit' + (sinTasa ? ' pos-hit--sintasa' : '') +
           '" data-id="' + esc(x.id) + '">' +
             '<span class="pos-hit__n">' + esc(x.name) + '</span>' +
             '<span class="pos-hit__p">RD$ ' + dinero(x.price) + '</span>' +
             (sinTasa ? '<span class="pos-hit__av">sin ITBIS</span>' : '') +
           '</button>';
    }
    cont.innerHTML = h;

    var btns = cont.querySelectorAll('button[data-id]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function (ev) {
        var id = ev.currentTarget.getAttribute('data-id');
        for (var m = 0; m < _productos.length; m++) {
          if (_productos[m].id === id) { anadir(_productos[m], 1, false); break; }
        }
        $('pos-entrada').focus();
      });
    }
  }

  /* ── Pintar la venta ────────────────────────────────────────────────────── */
  function totales() {
    var neto = 0, itbis = 0, arts = 0;
    for (var i = 0; i < _lineas.length; i++) {
      var l   = _lineas[i];
      var imp = l.precio * l.cantidad;
      var d   = desglosar(imp, l.tasa);
      neto  += imp;
      itbis += d.itbis;
      arts  += l.esPeso ? 1 : l.cantidad;
    }
    return {
      neto:  Math.round(neto * 100) / 100,
      itbis: Math.round(itbis * 100) / 100,
      base:  Math.round((neto - itbis) * 100) / 100,
      arts:  arts
    };
  }

  function pintar() {
    var cont = $('pos-lineas');
    if (!_lineas.length) {
      cont.innerHTML = '<p class="pos-vacio">Escanee el primer producto</p>';
    } else {
      var h = '<table class="pos-tabla"><thead><tr>' +
              '<th>Artículo</th><th class="n">Cant</th>' +
              '<th class="n">Precio</th><th class="n">Valor</th><th></th>' +
              '</tr></thead><tbody>';
      for (var i = 0; i < _lineas.length; i++) {
        var l = _lineas[i];
        var imp = l.precio * l.cantidad;
        h += '<tr>' +
               '<td>' + esc(l.nombre) +
                 (l.esPeso ? '<span class="pos-peso">' + l.cantidad.toFixed(2) +
                             ' lb pesado</span>' : '') +
               '</td>' +
               '<td class="n">' + (l.esPeso ? l.cantidad.toFixed(2) : l.cantidad) + '</td>' +
               '<td class="n">' + dinero(l.precio) + '</td>' +
               '<td class="n"><b>' + dinero(imp) + '</b></td>' +
               '<td class="n"><button type="button" class="pos-quitar" ' +
                 'data-i="' + i + '" aria-label="Quitar">✕</button></td>' +
             '</tr>';
      }
      h += '</tbody></table>';
      cont.innerHTML = h;

      var qs = cont.querySelectorAll('.pos-quitar');
      for (var j = 0; j < qs.length; j++) {
        qs[j].addEventListener('click', function (ev) {
          var idx = parseInt(ev.currentTarget.getAttribute('data-i'), 10);
          _lineas.splice(idx, 1);
          pintar();
          $('pos-entrada').focus();
        });
      }
    }

    var t = totales();
    pintarIndicadores(t);
    $('pos-arts').textContent  = t.arts;
    $('pos-base').textContent  = dinero(t.base);
    $('pos-itbis').textContent = dinero(t.itbis);
    $('pos-neto').textContent  = dinero(t.neto);
    $('pos-cobrar').disabled   = !_lineas.length ||
                                 _limite.estado === 'cerrada' || _limite.estado === 'sin_dato';
  }

  /* ── Reloj ──────────────────────────────────────────────────────────────── */
  function relojArranca() {
    function tic() {
      var n = new Date();
      var el = $('pos-reloj');
      if (el) {
        el.textContent = dosDig(n.getDate()) + '/' + dosDig(n.getMonth() + 1) + '/' +
                         n.getFullYear() + '  ' + dosDig(n.getHours()) + ':' +
                         dosDig(n.getMinutes()) + ':' + dosDig(n.getSeconds());
      }
    }
    tic();
    setInterval(tic, 1000);
  }

  /* ── Cobro ──────────────────────────────────────────────────────────────── */
  /* 🔴 CADA `addEventListener` COMPROBADO ANTES DE ENGANCHARLO.
   *    El arnés destapó `Cannot read properties of null (reading
   *    'addEventListener')`: al ejecutar este fichero sin el HTML del POS,
   *    `$('pos-cobrar')` devuelve null y el error ABORTA el resto de `init()`.
   *
   *    En `pos.html` los ids existen, así que «funcionaba». Pero el riesgo
   *    real es otro: si alguien renombra un id en el HTML, el POS se
   *    quedaría a medio montar —por ejemplo sin el listener del escáner— y
   *    el mensaje de consola no diría qué id falta. `on()` lo dice. */
  function on(id, evento, fn) {
    var el = $(id);
    if (!el) {
      console.warn('[POS] falta el elemento #' + id + ': su acción queda sin montar');
      return false;
    }
    el.addEventListener(evento, fn);
    return true;
  }

  function montarCobro() {
    on('pos-cobrar', 'click', abrirPago);
    on('pos-pago-cancelar', 'click', cerrarPago);
    on('pos-recibido', 'input', calcularCambio);
    on('pos-vaciar', 'click', function () {
      if (!_lineas.length) { return; }
      if (window.confirm('¿Vaciar la venta en curso? Se perderán ' +
                          _lineas.length + ' líneas.')) {
        _lineas = [];
        _ultimoPeso = null;
        var u = $('pos-ultimo');
        if (u) { u.hidden = true; }
        /* Si se vacía la factura que quedaba abierta tras el límite, ya no
         * hay nada que cobrar: la caja se cierra. */
        if (_limite.estado === 'ultima') { _limite.estado = 'cerrada'; mostrarLimite(); }
        pintar();
        var e = $('pos-entrada');
        if (e) { e.focus(); }
      }
    });
  }

  function abrirPago() {
    if (!_lineas.length) { return; }
    /* 'ultima' SÍ deja cobrar (la factura abierta al llegar al límite).
     * 'cerrada' y 'sin_dato' no. */
    if (_limite.estado === 'cerrada' || _limite.estado === 'sin_dato') {
      pitar(true); mostrarLimite(); return;
    }
    var t = totales();
    $('pos-pago-total').textContent = dinero(t.neto);
    $('pos-recibido').value = '';
    $('pos-cambio').textContent = '0.00';
    $('pos-modal-pago').hidden = false;
    $('pos-recibido').focus();
  }

  function cerrarPago() {
    $('pos-modal-pago').hidden = true;
    $('pos-entrada').focus();
  }

  function calcularCambio() {
    var t   = totales();
    var rec = parseFloat($('pos-recibido').value) || 0;
    var cam = rec - t.neto;
    var el  = $('pos-cambio');
    el.textContent = dinero(cam > 0 ? cam : 0);
    /* Si falta dinero se dice, en vez de dejar un cambio en 0 que parece
     * correcto. */
    var falta = $('pos-falta');
    if (cam < 0) {
      falta.textContent = 'Faltan RD$ ' + dinero(Math.abs(cam));
      falta.hidden = false;
    } else {
      falta.hidden = true;
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * POS-2 · INDICADORES LATERALES (peso y artículos)
   * Idea tomada de la caja de la competencia. PESO es el de la ÚLTIMA
   * etiqueta de báscula escaneada: este POS no está conectado a la balanza,
   * lee el peso impreso en la etiqueta.
   * ════════════════════════════════════════════════════════════════════════ */
  function pintarIndicadores(t) {
    var el = $('pos-ind-peso');
    if (!el) { return; }
    el.textContent = _ultimoPeso ? _ultimoPeso.peso.toFixed(2) : '0.00';
    $('pos-ind-peso-sub').textContent = _ultimoPeso ? _ultimoPeso.nombre : 'Sin pesados';
    $('pos-ind-arts').textContent = t.arts;
    $('pos-ind-lineas').textContent = _lineas.length + (_lineas.length === 1 ? ' línea' : ' líneas');
  }

  /* ════════════════════════════════════════════════════════════════════════
   * POS-2/3 · FRANJA DE ABAJO
   *
   * Alterna, cada 7 s:
   *   · el ANUNCIO DE LA APP (js/pos-anuncios.js) — el único diseñado, por
   *     decisión del dueño (23-sep: «ya no me hagas ningún diseño de
   *     publicidad excepto el de la app»);
   *   · las OFERTAS DEL CATÁLOGO: productos con `originalPrice` > `price`,
   *     los mismos que la tienda online muestra como oferta. Cambiar una
   *     oferta en el panel la cambia aquí sin mantener dos listas.
   * ════════════════════════════════════════════════════════════════════════ */
  var _ofertas = [], _iOferta = 0, _tOferta = null;
  var ROTACION_MS = 7000;
  /* POS-6 · logo de la tienda a la izquierda del lema, alto de la franja. */
  var LEMA = '<div class="pos-promo__lema">' +
      /* POS-9 · el marco recorta el margen blanco que trae el PNG, para que
         el dibujo del logo se vea más grande dentro del mismo alto. */
      '<span class="pos-promo__logo-marco"><img class="pos-promo__logo" src="images/logo-casamota.png?v=433" ' +
        'alt="Supermercado Casa Mota" onerror="this.parentNode.style.display=\'none\'"></span>' +
      /* POS-8 · lema debajo del logo, letra Playfair Display itálica, marrón,
         sin caja de fondo (el fondo es el de la franja). */
      '<div class="pos-promo__lema-txt">Lo Nuestro<span class="pos-promo__puntos">..!</span></div>' +
    '</div>';

  function listarOfertas(productos) {
    var r = [];
    for (var i = 0; i < productos.length; i++) {
      var p = productos[i];
      var ahora = Number(p.price), antes = Number(p.originalPrice);
      if (p.deleted === true || !(ahora > 0) || !(antes > ahora)) { continue; }
      r.push(p);
    }
    r.sort(function (a, b) {
      return (1 - a.price / a.originalPrice) < (1 - b.price / b.originalPrice) ? 1 : -1;
    });
    return r.slice(0, 30);
  }

  /* Anuncio, oferta, anuncio, oferta… */
  function intercalar(anuncios, ofertas) {
    var r = [], i = 0, j = 0;
    while (i < anuncios.length || j < ofertas.length) {
      if (i < anuncios.length) { r.push({ anuncio: anuncios[i++] }); }
      if (j < ofertas.length)  { r.push({ oferta:  ofertas[j++] }); }
    }
    return r;
  }

  function montarPromo() {
    var caja = $('pos-promo');
    if (!caja) { return; }
    var anuncios = Array.isArray(window.CASAMOTA_ANUNCIOS_POS) ? window.CASAMOTA_ANUNCIOS_POS : [];
    _ofertas = intercalar(anuncios, listarOfertas(_productos));
    if (_tOferta) { clearInterval(_tOferta); _tOferta = null; }
    _iOferta = 0;
    pintarOferta();
    if (_ofertas.length > 1) { _tOferta = setInterval(pintarOferta, ROTACION_MS); }
  }

  function htmlAnuncioApp(a) {
    return '<div class="pos-anuncio pos-anuncio--app">' +
        '<div class="pos-anuncio__movil"><img src="' + esc(a.imagen) + '" alt="" ' +
          'onerror="this.parentNode.style.display=\'none\'"></div>' +
        '<div class="pos-anuncio__txt">' +
          '<b class="pos-anuncio__titulo">' + esc(a.titulo) + '</b>' +
          '<span class="pos-anuncio__linea">' + esc(a.texto) + '</span>' +
        '</div>' +
        '<div class="pos-anuncio__app-der">' +
          '<span class="pos-anuncio__sello">' + esc(a.sello) + '</span>' +
          '<span class="pos-anuncio__web">' + esc(a.web) + '</span>' +
        '</div>' +
      '</div>';
  }

  function htmlOferta(p) {
    var pct = Math.round((1 - p.price / p.originalPrice) * 100);
    var img = p.image
      ? '<img class="pos-promo__img" src="' + esc(p.image) + '" alt="">'
      : '<div class="pos-promo__img pos-promo__img--letra">' + esc((p.name || '?').charAt(0)) + '</div>';
    return '<div class="pos-promo__oferta">' + img +
        '<div class="pos-promo__txt">' +
          '<span class="pos-promo__sello">OFERTA · -' + pct + '%</span>' +
          '<b class="pos-promo__nombre">' + esc(p.name) + '</b>' +
          '<span class="pos-promo__precios"><s>RD$ ' + dinero(p.originalPrice) + '</s> ' +
            '<b>RD$ ' + dinero(p.price) + '</b>' + (p.unit ? ' / ' + esc(p.unit) : '') + '</span>' +
        '</div>' +
      '</div>' + LEMA;
  }

  function pintarOferta() {
    var caja = $('pos-promo');
    if (!caja) { return; }
    caja.className = 'pos-promo';
    if (!_ofertas.length) {
      caja.innerHTML = '<div class="pos-promo__vacia">Pregunte por nuestras ofertas de la semana</div>' + LEMA;
      return;
    }
    var pieza = _ofertas[_iOferta % _ofertas.length];
    _iOferta++;
    if (pieza.anuncio) {
      caja.className = 'pos-promo pos-promo--app';
      caja.innerHTML = htmlAnuncioApp(pieza.anuncio);
      return;
    }
    caja.innerHTML = htmlOferta(pieza.oferta);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * POS-2 · LÍMITE DE ITBIS FACTURADO
   *
   * Regla del dueño, literal: al llegar a la suma de ITBIS fijada en el
   * panel, la caja deja de facturar y lo dice con una ventana desde abajo.
   * Si ocurre CON UNA FACTURA ABIERTA, esa factura se puede cobrar tal como
   * quedó; después no se registra ni se cobra ninguna más.
   *
   * DECISIONES DEL DUEÑO (23-sep): el límite es POR DÍA (día de RD), suma
   * TODAS LAS CAJAS, y lo desbloquea él SUBIENDO EL LÍMITE en el panel.
   *
   * 🔴 LÍMITE Y ACUMULADO SALEN DE LA BASE, en UNA llamada (RPC
   *    `pos_estado_limite`, seguridad/69). Un contador en el navegador se
   *    pondría a cero al recargar y no vería las otras cajas. Y el límite
   *    NO se guarda en `settings`: esa tabla se escribe con la clave pública
   *    y cualquiera podría subirlo.
   *
   * 🔴 SI NO SE PUEDE CONSULTAR EL ESTADO, LA CAJA SE BLOQUEA ('sin_dato').
   *    Seguir facturando «por si acaso» es justo lo que el límite existe
   *    para impedir. Excepción única: si la función AÚN NO EXISTE en la base
   *    (respuesta 404/PGRST202), no hay límite posible y la caja funciona
   *    como antes.
   *
   * Se vuelve a consultar cada 60 s: así cambia de día sola a medianoche,
   * ve lo que cobran las demás cajas y se desbloquea sin recargar cuando el
   * dueño sube el límite.
   * ════════════════════════════════════════════════════════════════════════ */
  var _tLimite = null;
  var REVISAR_LIMITE_MS = 60000;

  async function cargarLimite() {
    var r = await leerEstadoLimite();
    aplicarEstado(r);
    if (!_tLimite) {
      _tLimite = setInterval(async function () {
        aplicarEstado(await leerEstadoLimite());
      }, REVISAR_LIMITE_MS);
    }
  }

  /* Devuelve { limite, acumulado } · 'NO_INSTALADO' · null (error). */
  async function leerEstadoLimite() {
    try {
      var vale = (typeof _valeAdmin === 'function') ? _valeAdmin() : '';
      var res = await fetch(_SB_URL + '/rpc/pos_estado_limite', {
        method: 'POST', headers: _SB_HEADERS, body: JSON.stringify({ p_vale: vale })
      });
      var txt = await res.text();
      if (res.status === 404 || txt.indexOf('PGRST202') >= 0) { return 'NO_INSTALADO'; }
      if (!res.ok) { console.error('[POS] estado del límite · HTTP ' + res.status + ' · ' + txt); return null; }
      var j = JSON.parse(txt);
      if (Array.isArray(j)) { j = j[0]; }
      var lim  = j && j.limite !== null && j.limite !== undefined ? Number(j.limite) : null;
      var acum = j ? Number(j.acumulado) : NaN;
      if (!isFinite(acum) || acum < 0) { return null; }
      return { limite: (isFinite(lim) && lim > 0) ? lim : null, acumulado: acum };
    } catch (e) {
      console.error('[POS] estado del límite ·', e);
      return null;
    }
  }

  /* Aplica lo que dice la base.
   *  · Sin límite, o límite subido por encima de lo facturado → se
   *    desbloquea (así «la desbloqueo subiendo el límite» funciona sin
   *    recargar). Si había factura abierta en 'ultima', vuelve a admitir artículos.
   *  · Nunca se desbloquea por un fallo de red: null mantiene/pone 'sin_dato'. */
  function aplicarEstado(r) {
    if (r === 'NO_INSTALADO') {
      _limite.valor = null; _limite.estado = 'libre';
      pintarTopLimite(); return;
    }
    if (r === null) {
      if (_limite.estado !== 'ultima') { _limite.estado = 'sin_dato'; mostrarLimite(); }
      pintarTopLimite(); pintar(); return;
    }
    _limite.valor = r.limite;
    _limite.acumulado = r.acumulado;

    var abierta = totales().itbis;
    var bajo = !r.limite || (r.acumulado + abierta) < r.limite;

    if (bajo) {
      if (_limite.estado !== 'libre') {
        _limite.estado = 'libre';
        var hoja = $('pos-limite'); if (hoja) { hoja.hidden = true; }
        var ent = $('pos-entrada');
        if (ent) { ent.classList.remove('pos-entrada--bloqueada');
                   ent.placeholder = 'Apunte la pistola y dispare…'; }
        avisar('Límite actualizado: la caja vuelve a facturar', 'ok');
      }
    } else if (_limite.estado === 'libre' || _limite.estado === 'sin_dato') {
      _limite.estado = _lineas.length ? 'ultima' : 'cerrada';
      mostrarLimite();
    }
    pintarTopLimite();
    pintar();
  }

  /* Se llama tras cada artículo añadido. Si lo cobrado hoy más la factura
   * abierta llega al límite, esa factura es la última. */
  function comprobarLimite() {
    if (!_limite.valor || _limite.estado !== 'libre') { pintarTopLimite(); return; }
    var total = _limite.acumulado + totales().itbis;
    if (total >= _limite.valor) {
      _limite.estado = _lineas.length ? 'ultima' : 'cerrada';
      mostrarLimite();
    }
    pintarTopLimite();
  }

  /* Para cuando exista el cobro real (paso B4): suma lo cobrado y, si la
   * factura cobrada era la última, cierra la caja. */
  function trasCobrar(itbisCobrado) {
    _limite.acumulado += Number(itbisCobrado) || 0;
    if (_limite.estado === 'ultima' ||
        (_limite.valor && _limite.acumulado >= _limite.valor)) {
      _limite.estado = 'cerrada';
      mostrarLimite();
    }
    pintarTopLimite();
  }

  function mostrarLimite() {
    var hoja = $('pos-limite');
    if (!hoja) { return; }
    var txt = $('pos-limite-txt');
    if (_limite.estado === 'ultima') {
      txt.textContent = 'Puede cobrar esta factura tal como está. No se pueden añadir ' +
                        'más artículos, y después de cobrarla la caja no registrará ventas nuevas.';
    } else if (_limite.estado === 'sin_dato') {
      txt.textContent = 'No se pudo comprobar el límite de facturación de hoy. Por ' +
                        'seguridad esta caja no factura. Revise la conexión; si sigue, avise al administrador.';
    } else {
      txt.textContent = 'Se alcanzó el límite de ITBIS de hoy (todas las cajas). Esta caja no ' +
                        'puede registrar ni cobrar más ventas hasta que el administrador suba el límite.';
    }
    $('pos-limite-cifras').textContent = _limite.valor
      ? 'ITBIS facturado hoy: RD$ ' + dinero(_limite.acumulado + totales().itbis) +
        '  ·  Límite diario: RD$ ' + dinero(_limite.valor)
      : '';
    hoja.hidden = false;
    var ent = $('pos-entrada');
    if (ent) { ent.classList.add('pos-entrada--bloqueada');
               ent.placeholder = 'Límite de facturación alcanzado'; }
  }

  function pintarTopLimite() {
    var top = document.querySelector('.pos-top');
    if (!top) { return; }
    var el = $('pos-top-limite');
    if (!_limite.valor) { if (el) { el.remove(); } return; }
    if (!el) {
      el = document.createElement('span');
      el.id = 'pos-top-limite';
      top.insertBefore(el, $('pos-reloj'));
    }
    var usado = _limite.acumulado + totales().itbis;
    el.className = 'pos-top__limite' + (_limite.estado === 'libre' ? '' : ' pos-top__limite--rojo');
    el.textContent = 'ITBIS hoy RD$ ' + dinero(usado) + ' / ' + dinero(_limite.valor);
  }

  /* ── Arranque ───────────────────────────────────────────────────────────── */
  function init() {
    /* Si este fichero se carga fuera de `pos.html` —por ejemplo en un arnés—
     * no hay nada que montar y no debe dar error: las funciones puras
     * (descifrarBascula, desglosar) tienen que seguir siendo verificables. */
    if (!$('pos-caja')) { return; }

    montarLogin();
    montarEntrada();
    montarCobro();
    on('pos-limite-ok', 'click', function () {
      $('pos-limite').hidden = true;
      var e = $('pos-entrada');
      if (e) { e.focus(); }
    });

    var bq = $('pos-buscar');
    if (bq) {
      bq.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          buscarPorTexto(bq.value);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Se expone solo lo que hace falta verificar desde un arnés. */
  window.CasaMotaPOS = {
    descifrarBascula: descifrarBascula,
    _procesar:        function (c) { procesar(c); },
    desglosar:        desglosar,
    _totales:         totales,
    _lineas:          function () { return _lineas; },
    _ofertas:         listarOfertas,
    _intercalar:      intercalar,
    _mostrarPieza:    function (n) { _iOferta = n; pintarOferta(); },
    _limite:          {
      estado:     function () { return _limite.estado; },
      fijar:      function (valor, acumulado) {
                    _limite.valor = valor; _limite.acumulado = acumulado || 0;
                    _limite.estado = 'libre'; comprobarLimite();
                  },
      trasCobrar: trasCobrar,
      aplicar:    aplicarEstado
    }
  };
})();
