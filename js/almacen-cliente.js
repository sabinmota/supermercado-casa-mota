/**
 * SUPERMERCADO CASA MOTA — ALMACÉN POR CLIENTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * BUILD 422c · Único dueño de las claves de `localStorage` que guardan datos
 * que PERTENECEN A UN CLIENTE CONCRETO: el carrito y los favoritos.
 *
 * ─── EL FALLO QUE ESTE FICHERO EXISTE PARA IMPEDIR ─────────────────────────
 *
 * Las claves eran FIJAS: `casamota_cart` y `casamota_favorites`, sin el
 * identificador de nadie. `localStorage` pertenece al NAVEGADOR, no a la
 * persona, así que había UN SOLO CAJÓN para todas las cuentas que usaran ese
 * equipo. El dueño lo detectó probando: entraba con Carlos, llenaba el
 * carrito, salía, entraba con Sabin Mota — y aparecían los mismos artículos y
 * los mismos favoritos.
 *
 * Y `clearClientSession()` (`auth.js` y `auth.v33.js`) borra la sesión y el
 * vale, pero NO estas claves: el carrito del anterior sobrevivía a la salida.
 *
 * 🔴 NO ERA UNA MOLESTIA, ERA UN PROBLEMA DE DINERO: el carrito alimenta el
 * checkout. Un cliente podía comprar —y pagar— artículos que metió otra
 * persona en ese equipo. Y los favoritos revelaban a un cliente lo que otro
 * había estado mirando.
 *
 * ─── POR QUÉ ESTO ES UN FICHERO Y NO UNAS FUNCIONES EN `app.js` ────────────
 *
 * Porque las claves se tocaban en CUATRO ficheros distintos (`app.js`,
 * `favorites.js`, `chat.js`, y la lectura inicial del estado global), y
 * mientras cada uno construyera su propia clave el fallo podía volver por
 * cualquiera de ellos: bastaba que uno se olvidara del identificador.
 *
 * Con esta pieza **ya no existe la posibilidad de escribir la clave a mano**.
 * Nadie más que este fichero conoce el formato. Si mañana hay que cambiarlo
 * —por ejemplo para que el carrito viva en la base y no en el navegador— se
 * cambia aquí y en ningún otro sitio.
 *
 * Es lo contrario de un remiendo: no se tapa el síntoma en cada sitio donde
 * asoma, se elimina la causa —la clave repetida— de una vez.
 *
 * ─── POR QUÉ NO SE ARREGLÓ «BORRANDO AL SALIR» ────────────────────────────
 *
 * Fue lo primero que se pensó, y es un arreglo falso por dos motivos:
 *   (a) solo actúa si el cliente PULSA salir. Si cierra la pestaña, o si el
 *       guard sin vale lo expulsa, el carrito ajeno sigue ahí;
 *   (b) DESTRUIRÍA el carrito del cliente legítimo, que al volver a entrar
 *       debe encontrar lo suyo.
 * Separar por dueño resuelve las dos cosas a la vez y no depende de que nadie
 * se acuerde de limpiar nada.
 */

/* global sessionStorage */
const CasaMotaAlmacen = (function () {
  'use strict';

  const CLAVE_SESION = 'cm_client_session';

  /* Claves compartidas de antes del 422c. Se conservan SOLO para migrarlas y
   * borrarlas; nada del código nuevo debe volver a escribir en ellas. */
  const HEREDADAS = {
    carrito:   'casamota_cart',
    favoritos: 'casamota_favorites',
  };

  const PREFIJOS = {
    carrito:   'casamota_cart_',
    favoritos: 'casamota_favorites_',
  };

  /* Quien no ha entrado también necesita un sitio donde poner su carrito: se
   * le da uno propio en vez de dejarlo escribir en el de nadie. */
  const INVITADO = 'invitado';

  function _leerCrudo(clave) {
    try { return localStorage.getItem(clave); }
    catch { return null; }   // modo privado sin almacenamiento
  }

  function _escribirCrudo(clave, valor) {
    try { localStorage.setItem(clave, valor); return true; }
    catch { return false; }
  }

  function _borrarCrudo(clave) {
    try { localStorage.removeItem(clave); } catch { /* nada que borrar */ }
  }

  /** Identificador del cliente que está dentro AHORA MISMO.
   *
   * Se lee de la sesión en cada llamada, nunca se guarda en una constante: si
   * se fijara al cargar la página, un cambio de sesión en la misma pestaña
   * seguiría escribiendo en el cajón del cliente anterior. */
  function idClienteActivo() {
    let bruto = _leerCrudo(CLAVE_SESION);
    if (!bruto) {
      try { bruto = sessionStorage.getItem(CLAVE_SESION); } catch { bruto = null; }
    }
    if (!bruto) return INVITADO;
    try {
      const s = JSON.parse(bruto);
      const id = s && (s.id || s.email);
      return id ? String(id) : INVITADO;
    } catch {
      return INVITADO;   // sesión corrupta: no se hereda el cajón de nadie
    }
  }

  function claveCarrito()   { return PREFIJOS.carrito   + idClienteActivo(); }
  function claveFavoritos() { return PREFIJOS.favoritos + idClienteActivo(); }

  /** Lee una lista y garantiza que SIEMPRE devuelve un arreglo.
   *
   * Devolver `null` u objeto rompería `cart.reduce(...)` en el checkout, y el
   * fallo aparecería lejos de su causa. */
  function _leerLista(clave) {
    const bruto = _leerCrudo(clave);
    if (!bruto) return [];
    try {
      const v = JSON.parse(bruto);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function leerCarrito()   { return _leerLista(claveCarrito()); }
  function leerFavoritos() { return _leerLista(claveFavoritos()); }

  function guardarCarrito(lista) {
    _escribirCrudo(claveCarrito(), JSON.stringify(Array.isArray(lista) ? lista : []));
  }

  function guardarFavoritos(lista) {
    _escribirCrudo(claveFavoritos(), JSON.stringify(Array.isArray(lista) ? lista : []));
  }

  /** Traspasa el contenido de una clave compartida antigua al cajón del
   * cliente activo y BORRA la clave vieja.
   *
   * No sobrescribe un cajón que ya tenga contenido: lo que el cliente guardó
   * con su cuenta manda sobre lo que quedara en la clave común. */
  function _migrarUna(claveVieja, claveNueva) {
    const viejo = _leerCrudo(claveVieja);
    if (viejo === null) return false;

    let traspasado = false;
    if (!_leerCrudo(claveNueva) && viejo !== '[]' && viejo !== '') {
      traspasado = _escribirCrudo(claveNueva, viejo);
    }
    _borrarCrudo(claveVieja);
    return traspasado;
  }

  /** Se llama UNA VEZ al arrancar la tienda. Deja el navegador sin claves
   * compartidas, que es lo que cierra el agujero de raíz. */
  function migrarClavesCompartidas() {
    const c = _migrarUna(HEREDADAS.carrito,   claveCarrito());
    const f = _migrarUna(HEREDADAS.favoritos, claveFavoritos());
    if (c || f) {
      console.info('[almacen] contenido de las claves compartidas antiguas '
        + 'traspasado al cliente activo; las claves compartidas se han borrado.');
    }
  }

  return {
    idClienteActivo,
    claveCarrito,
    claveFavoritos,
    leerCarrito,
    leerFavoritos,
    guardarCarrito,
    guardarFavoritos,
    migrarClavesCompartidas,
    _PREFIJOS:  PREFIJOS,
    _HEREDADAS: HEREDADAS,
    _INVITADO:  INVITADO,
  };
})();
