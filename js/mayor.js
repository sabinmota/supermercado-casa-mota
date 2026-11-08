/* ═══════════════════════════════════════════════════════════════════════════
   MAYORISTAS · mayor.html  (seguridad/99)
   ───────────────────────────────────────────────────────────────────────────
   · Entra con teléfono + contraseña. El vale (7 días) se guarda en este
     navegador para no pedir la contraseña cada vez.
   · Pendiente de aprobación: ve el catálogo SIN precios y no puede pedir.
   · Precios, envío y total los decide la BASE; aquí solo se muestran. Si no
     coinciden (precio cambiado, total distinto), la base rechaza el pedido y
     esta página lo explica y se actualiza sola.
   · No descuenta stock (lo hace la base: líneas con "sinStock").
   Usa de js/api.js solo `_SB_URL` y `_SB_HEADERS` (la clave pública).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var K_VALE = 'cm_mayor_vale';
  var K_CARRITO = 'cm_mayor_carrito';
  var POR_PAGINA = 40;

  var yo = null;                 // { id, nombre, telefono, estado }
  var catalogo = [];             // [{ id, name, category, unidad, precio, desc }]
  var porId = {};
  var imagenes = {};             // id → src
  var categorias = {};           // slug → nombre
  var envioCfg = null;           // { tarifa, minimo_gratis }
  var carrito = {};              // id → cantidad
  var mostrados = POR_PAGINA;
  var enviando = false;

  // ─── Utilidades ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rd(n) {
    var v = Math.abs(Number(n) || 0).toFixed(2).split('.');
    return (Number(n) < 0 ? '-' : '') + 'RD$ ' + v[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + v[1];
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  // Céntimos enteros: así el total coincide con el de la base, sin errores de coma.
  function cents(n) { return Math.round((Number(n) || 0) * 100); }

  var tToast = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function mostrarError(id, msg) { var e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

  function leerVale() { try { return localStorage.getItem(K_VALE) || ''; } catch (e) { return ''; } }
  function guardarVale(v) { try { v ? localStorage.setItem(K_VALE, v) : localStorage.removeItem(K_VALE); } catch (e) {} }
  function leerCarrito() {
    try { var c = JSON.parse(localStorage.getItem(K_CARRITO) || '{}'); return (c && typeof c === 'object') ? c : {}; }
    catch (e) { return {}; }
  }
  function guardarCarrito() { try { localStorage.setItem(K_CARRITO, JSON.stringify(carrito)); } catch (e) {} }

  // ─── Mensajes de la base ───────────────────────────────────────────────────
  var MENSAJES = {
    NOMBRE_INVALIDO:        'Escribe tu nombre o el de tu negocio (2 a 80 letras).',
    TELEFONO_INVALIDO:      'El teléfono debe tener 10 números, por ejemplo 809-555-1234.',
    CLAVE_CORTA:            'La contraseña debe tener al menos 6 caracteres.',
    TELEFONO_YA_REGISTRADO: 'Ese teléfono ya tiene una cuenta. Pulsa «Entrar».',
    // 529 · seguridad/104: como mucho 5 cuentas nuevas por hora y 20 por día.
    REGISTRO_SATURADO:      'Ahora mismo no se pueden crear más cuentas. Inténtalo más tarde o contacta al supermercado y te damos de alta.',
    DATOS_INCORRECTOS:      'Teléfono o contraseña incorrectos.',
    CUENTA_RECHAZADA:       'Esta cuenta no está habilitada para compras al por mayor. Contáctanos.',
    SESION_INVALIDA:        'Tu sesión terminó. Vuelve a entrar.',
    SESION_CADUCADA:        'Tu sesión terminó. Vuelve a entrar.',
    CUENTA_PENDIENTE:       'Tu cuenta aún está pendiente de aprobación.',
    ENTREGA_INVALIDA:       'Elige entrega a domicilio o recogida en el almacén.',
    FALTA_DIRECCION:        'Escribe la dirección de entrega.',
    CARRITO_VACIO:          'Tu pedido está vacío.',
    DATOS_INVALIDOS:        'Revisa las cantidades: deben ser números enteros.',
    PRODUCTO_NO_DISPONIBLE: 'Algún producto ya no se vende al por mayor. Lo quitamos de tu pedido.',
    PRECIO_CAMBIO:          'Algún precio cambió. Actualizamos tu pedido: revísalo y confirma de nuevo.',
    TOTAL_CAMBIO:           'El total cambió (envío o precios). Revísalo y confirma de nuevo.',
    // 538 · seguridad/108 (Mi cuenta)
    RNC_INVALIDO:           'El RNC debe tener 9 números (empresa) u 11 (cédula). Puedes dejarlo vacío.',
    CLAVE_ACTUAL_MAL:       'La contraseña actual no es correcta.',
    CLAVE_IGUAL:            'La nueva contraseña debe ser distinta de la actual.',
    CLAVE_LARGA:            'La contraseña admite como máximo 72 caracteres.',
    DEMASIADOS_INTENTOS:    'Demasiados intentos con la contraseña actual. Espera 15 minutos o llámanos.',
    DIRECCION_CORTA:        'Escribe la dirección de entrega (al menos 5 letras).',
    UBICACION_INVALIDA:     'El punto del mapa no es válido. Vuelve a detectarlo o quítalo.'
  };
  // 538 · Si el SQL 108 aún no está, estas opciones lo dicen sin romper nada.
  var MSG_SIN_ACTIVAR = 'Esta opción todavía no está activada. Inténtalo más tarde.';

  function ErrorBase(codigo, detalle) {
    var e = new Error(MENSAJES[codigo] || codigo);
    e.codigo = codigo; e.detalle = detalle;
    return e;
  }

  async function rpc(fn, params) {
    var res;
    try {
      res = await fetch(_SB_URL + '/rpc/' + fn, {
        method: 'POST', headers: _SB_HEADERS, body: JSON.stringify(params || {})
      });
    } catch (e) {
      throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
    }
    var texto = await res.text();
    if (!res.ok) {
      var j = null;
      try { j = JSON.parse(texto); } catch (e) {}
      var codigo = j && j.message ? String(j.message) : '';
      if (MENSAJES[codigo]) throw ErrorBase(codigo, j.details);
      console.error('[mayor] ' + fn + ' HTTP ' + res.status, texto);
      throw new Error('No se pudo completar (' + res.status + '). Inténtalo de nuevo.');
    }
    if (!texto || texto === 'null') return null;
    return JSON.parse(texto);
  }
  function fila(datos) { return Array.isArray(datos) ? (datos[0] || null) : datos; }

  // 🔴 Supabase devuelve como MÁXIMO 1.000 filas por petición, también en las
  // funciones (lección del 518b). El catálogo se pide por páginas, en orden fijo.
  async function rpcPaginado(fn, params, orden) {
    var todo = [];
    for (var desde = 0, vuelta = 0; vuelta < 50; vuelta++) {
      var res;
      try {
        res = await fetch(_SB_URL + '/rpc/' + fn + '?order=' + orden + '.asc&limit=1000&offset=' + desde, {
          method: 'POST', headers: _SB_HEADERS, body: JSON.stringify(params || {})
        });
      } catch (e) {
        throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
      }
      var texto = await res.text();
      if (!res.ok) {
        var j = null;
        try { j = JSON.parse(texto); } catch (e) {}
        var codigo = j && j.message ? String(j.message) : '';
        if (MENSAJES[codigo]) throw ErrorBase(codigo, j.details);
        console.error('[mayor] ' + fn + ' HTTP ' + res.status, texto);
        throw new Error('No se pudo cargar (' + res.status + '). Inténtalo de nuevo.');
      }
      var filas = texto ? JSON.parse(texto) : [];
      if (!Array.isArray(filas)) break;
      todo = todo.concat(filas);
      if (filas.length < 1000) break;
      desde += filas.length;
    }
    return todo;
  }

  // Sesión perdida o cuenta rechazada → vuelve a la pantalla de entrar.
  function esFinDeSesion(e) {
    return e && (e.codigo === 'SESION_INVALIDA' || e.codigo === 'SESION_CADUCADA' || e.codigo === 'CUENTA_RECHAZADA');
  }
  function cerrarLocal(msg) {
    cerrarDetalle(); cerrarCuenta(); cerrarSoporte();
    guardarVale(''); yo = null;
    favoritos = []; avisos = []; fichaLista = false;
    ficha = { rnc: '', direccion: '', ciudad: '', lat: null, lng: null };
    $('mzAcciones').hidden = true;
    cerrarPaneles();
    mostrarAuth('entrar');
    if (msg) mostrarError('eError', msg);
  }

  // ─── Pantallas ─────────────────────────────────────────────────────────────
  function mostrarAuth(cual) {
    $('vTienda').hidden = true;
    $('vAuth').hidden = false;
    var reg = cual === 'registro';
    $('fEntrar').hidden = reg; $('fRegistro').hidden = !reg;
    $('tabEntrar').classList.toggle('activo', !reg); $('tabEntrar').setAttribute('aria-selected', String(!reg));
    $('tabRegistro').classList.toggle('activo', reg); $('tabRegistro').setAttribute('aria-selected', String(reg));
    mostrarError('eError', ''); mostrarError('rError', '');
  }

  function aprobado() { return !!(yo && yo.estado === 'aprobado'); }

  async function mostrarTienda() {
    $('vAuth').hidden = true;
    $('vTienda').hidden = false;
    $('mzAcciones').hidden = false;
    $('btnCarrito').hidden = !aprobado();
    leerFavoritos();
    pintarCabecera();
    $('avisoPendiente').hidden = aprobado();
    cargarFicha();      // 538 · RNC y dirección (no frena el catálogo)
    cargarAvisos();     // 538 · campana
    await cargarCatalogo();
  }

  // ─── Entrar / registrarse ──────────────────────────────────────────────────
  async function entrar(ev) {
    ev.preventDefault();
    var tel = $('eTel').value.trim(), clave = $('eClave').value;
    if (!tel || !clave) { mostrarError('eError', 'Escribe tu teléfono y tu contraseña.'); return; }
    var btn = $('eBtn'); btn.disabled = true; btn.textContent = 'Entrando…';
    mostrarError('eError', '');
    try {
      var r = fila(await rpc('mayor_entrar', { p_telefono: tel, p_clave: clave }));
      if (!r || !r.ok) {
        var msg = r && r.error === 'DEMASIADOS_INTENTOS'
          ? 'Demasiados intentos. Espera ' + (r.minutos || 15) + ' minutos o llámanos.'
          : (MENSAJES[r && r.error] || MENSAJES.DATOS_INCORRECTOS);
        mostrarError('eError', msg);
        return;
      }
      guardarVale(r.vale);
      yo = { id: r.id, nombre: r.nombre, telefono: r.telefono, estado: r.estado };
      $('eClave').value = '';
      await mostrarTienda();
    } catch (e) {
      mostrarError('eError', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  }

  async function registrar(ev) {
    ev.preventDefault();
    var nom = $('rNombre').value.trim(), tel = $('rTel').value.trim();
    var c1 = $('rClave').value, c2 = $('rClave2').value;
    if (nom.length < 2) { mostrarError('rError', MENSAJES.NOMBRE_INVALIDO); return; }
    var dig = tel.replace(/\D/g, '');
    if (!/^1?\d{10}$/.test(dig)) { mostrarError('rError', MENSAJES.TELEFONO_INVALIDO); return; }
    if (c1.length < 6) { mostrarError('rError', MENSAJES.CLAVE_CORTA); return; }
    if (c1 !== c2) { mostrarError('rError', 'Las dos contraseñas no coinciden.'); return; }
    var btn = $('rBtn'); btn.disabled = true; btn.textContent = 'Creando cuenta…';
    mostrarError('rError', '');
    try {
      var r = fila(await rpc('mayor_registrar', { p_nombre: nom, p_telefono: tel, p_clave: c1 }));
      guardarVale(r.vale);
      yo = { id: r.id, nombre: r.nombre, telefono: r.telefono, estado: r.estado };
      $('rClave').value = ''; $('rClave2').value = '';
      await mostrarTienda();
      toast('✅ Cuenta creada. Te avisaremos cuando esté aprobada.');
    } catch (e) {
      mostrarError('rError', e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Crear cuenta';
    }
  }

  async function salir() {
    var v = leerVale();
    cerrarLocal('');
    if (v) { try { await rpc('mayor_salir', { p_vale: v }); } catch (e) {} }
  }

  // Refresca el estado (pendiente → aprobado) sin volver a entrar.
  async function comprobarEstado(silencioso) {
    var v = leerVale();
    if (!v) return;
    try {
      var r = fila(await rpc('mayor_yo', { p_vale: v }));
      if (!r) return;
      var antes = yo && yo.estado;
      yo = { id: r.id, nombre: r.nombre, telefono: r.telefono, estado: r.estado };
      if (antes !== yo.estado) {
        await mostrarTienda();
        if (aprobado()) toast('🎉 ¡Tu cuenta fue aprobada! Ya puedes ver precios y hacer pedidos.');
      } else if (!silencioso) {
        toast(aprobado() ? 'Tu cuenta está aprobada.' : 'Tu cuenta sigue pendiente de aprobación.');
      }
    } catch (e) {
      if (esFinDeSesion(e)) cerrarLocal(e.message);
      else if (!silencioso) toast(e.message);
    }
  }

  // ─── Catálogo ──────────────────────────────────────────────────────────────
  async function cargarCatalogo() {
    $('estadoCatalogo').textContent = 'Cargando catálogo…';
    $('grid').innerHTML = '';
    try {
      var v = leerVale();
      /* 536 · Descripciones (seguridad/107): la propia al por mayor o, si no
       * hay, la normal. Si falla (SQL 107 sin ejecutar…) el catálogo sale igual,
       * sin descripciones; el fin de sesión ya lo detecta mayor_catalogo. */
      var descs = rpcPaginado('mayor_catalogo_desc', { p_vale: v }, 'id').catch(function (e) {
        console.warn('[mayor] sin descripciones:', e && e.message); return [];
      });
      var peticiones = [rpcPaginado('mayor_catalogo', { p_vale: v }, 'id'), cargarCategorias(), descs];
      if (aprobado()) peticiones.push(rpc('mayor_envio', { p_vale: v }));
      var res = await Promise.all(peticiones);
      var descPorId = {};
      (res[2] || []).forEach(function (d) { if (d && d.id != null && d.descripcion) descPorId[String(d.id)] = String(d.descripcion); });
      catalogo = (res[0] || []).map(function (p) {
        return { id: String(p.id), name: p.name || '', category: p.category || '',
                 unidad: p.unidad || '', precio: p.precio == null ? null : Number(p.precio),
                 desc: descPorId[String(p.id)] || '' };
      }).sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
      porId = {};
      catalogo.forEach(function (p) { porId[p.id] = p; });
      pintarContadorFav();   // 538 · solo cuenta los favoritos que siguen al por mayor
      if (aprobado()) envioCfg = fila(res[3]);

      // Lo que ya no se vende al por mayor sale del carrito.
      var quitados = 0;
      Object.keys(carrito).forEach(function (id) { if (!porId[id] || !aprobado()) { delete carrito[id]; quitados++; } });
      if (quitados && aprobado()) guardarCarrito();

      pintarFiltroCategorias();
      mostrados = POR_PAGINA;
      pintarCatalogo();
      pintarCarrito();
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      $('estadoCatalogo').textContent = '⚠️ ' + e.message;
    }
  }

  async function cargarCategorias() {
    if (Object.keys(categorias).length) return;
    try {
      var res = await fetch(_SB_URL + '/categories?select=slug,name,deleted&limit=500', { headers: _SB_HEADERS });
      var lista = res.ok ? await res.json() : [];
      (lista || []).forEach(function (c) { if (c && !c.deleted && c.slug) categorias[c.slug] = c.name || c.slug; });
    } catch (e) { /* sin nombres: se usa el código de la categoría */ }
  }
  function nombreCategoria(slug) {
    return categorias[slug] || String(slug || '').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function pintarFiltroCategorias() {
    var sel = $('fCategoria'), actual = sel.value;
    var usadas = {};
    catalogo.forEach(function (p) { if (p.category) usadas[p.category] = true; });
    var slugs = Object.keys(usadas).sort(function (a, b) { return nombreCategoria(a).localeCompare(nombreCategoria(b), 'es'); });
    sel.innerHTML = '<option value="">Todas las categorías</option>' + slugs.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(nombreCategoria(s)) + '</option>';
    }).join('');
    sel.value = usadas[actual] ? actual : '';
  }

  function filtrados() {
    var q = norm($('fBuscar').value.trim()), cat = $('fCategoria').value;
    var palabras = q ? q.split(/\s+/) : [];
    return catalogo.filter(function (p) {
      if (cat && p.category !== cat) return false;
      if (!palabras.length) return true;
      var t = norm(p.name + ' ' + p.unidad + ' ' + p.desc);   // 536 · también la descripción
      return palabras.every(function (w) { return t.indexOf(w) !== -1; });
    });
  }

  /* Botón de la tarjeta. `entra` = el mayorista acaba de añadirlo: solo
   * entonces lleva la animación de entrada (`.card-stepper--entra`). */
  function botonTarjeta(p, entra) {
    var cant = carrito[p.id] || 0;
    if (!aprobado()) {
      return '<button type="button" class="add-cart-btn" disabled><i class="fas fa-lock"></i> Pendiente</button>';
    }
    if (cant > 0) {
      return '<div class="card-stepper' + (entra ? ' card-stepper--entra' : '') + '">' +
        '<button type="button" class="card-stepper__btn" data-menos="' + esc(p.id) + '" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
        '<span class="card-stepper__qty">' + cant + '</span>' +
        '<button type="button" class="card-stepper__btn" data-mas="' + esc(p.id) + '" aria-label="Añadir uno"><i class="fas fa-plus"></i></button></div>';
    }
    return '<button type="button" class="add-cart-btn" data-mas="' + esc(p.id) + '"><i class="fas fa-cart-plus"></i> Añadir</button>';
  }

  function tarjeta(p) {
    var img = imagenes[p.id] || 'images/placeholder-product.png';
    var precio = (aprobado() && p.precio != null)
      ? '<span class="price-current">' + rd(p.precio) + ' <span class="price-unit">/ ' + esc(p.unidad) + '</span></span>'
      : '<span class="mz-sinprecio"><i class="fas fa-lock"></i> Precio al aprobar tu cuenta</span>';
    return '<div class="product-card" data-id="' + esc(p.id) + '" tabindex="0">' +
      '<div class="product-img-wrap"><img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy" ' +
      'onerror="this.onerror=null;this.src=\'images/placeholder-product.png\'"></div>' +
      '<div class="product-info">' +
        '<div class="product-cat-tag">' + esc(nombreCategoria(p.category)) + '</div>' +
        '<div class="product-name">' + esc(p.name) + '</div>' +
        (p.desc ? '<div class="mz-desc" title="' + esc(p.desc) + '">' + esc(p.desc) + '</div>' : '') +   // 536
        '<span class="mz-unidad"><i class="fas fa-box"></i> ' + esc(p.unidad) + '</span>' +
        '<div class="product-price-row"><div class="price-group">' + precio + '</div></div>' +
      '</div><div class="mz-ctl">' + botonTarjeta(p, false) + '</div></div>';
  }

  function pintarCatalogo() {
    var lista = filtrados();
    var vis = lista.slice(0, mostrados);
    $('grid').innerHTML = vis.map(tarjeta).join('');
    $('masWrap').hidden = lista.length <= mostrados;
    $('estadoCatalogo').textContent = !catalogo.length
      ? 'Todavía no hay productos al por mayor. Vuelve pronto.'
      : (!lista.length ? 'No hay productos que coincidan con tu búsqueda.' : '');
    cargarImagenes(vis.map(function (p) { return p.id; }));
  }

  // Imágenes aparte y por lotes (algunas son grandes): solo las que se ven.
  async function cargarImagenes(ids) {
    var faltan = ids.filter(function (id) { return !(id in imagenes); });
    for (var i = 0; i < faltan.length; i += 30) {
      var lote = faltan.slice(i, i + 30);
      lote.forEach(function (id) { imagenes[id] = imagenes[id] || ''; });
      try {
        var res = await fetch(_SB_URL + '/products?select=id,image&id=in.(' + lote.map(encodeURIComponent).join(',') + ')',
                              { headers: _SB_HEADERS });
        var filas = res.ok ? await res.json() : [];
        (filas || []).forEach(function (f) {
          if (!f || !f.image) return;
          imagenes[String(f.id)] = f.image;
          var el = document.querySelector('.product-card[data-id="' + String(f.id).replace(/"/g, '') + '"] img');
          if (el) el.src = f.image;
        });
      } catch (e) { /* sin imagen: queda la de reserva */ }
    }
  }

  /* 525 · Antes se reemplazaba la TARJETA entera (foto incluida) en cada
   * pulsación. Ahora solo el botón, y solo lo que cambió: si ya era contador,
   * el número; si entra o sale del carrito, el botón (con animación al entrar). */
  function repintarTarjeta(id) {
    var ctl = document.querySelector('.product-card[data-id="' + String(id).replace(/"/g, '') + '"] .mz-ctl');
    if (!ctl || !porId[id]) return;
    var cant = carrito[id] || 0;
    var qty = ctl.querySelector('.card-stepper__qty');
    if (cant > 0 && qty) {
      if (qty.textContent !== String(cant)) qty.textContent = cant;
      return;
    }
    ctl.innerHTML = botonTarjeta(porId[id], cant > 0);
  }

  // ─── Carrito ───────────────────────────────────────────────────────────────
  function cambiar(id, delta, fijo) {
    if (!aprobado() || !porId[id]) return;
    var n = fijo != null ? fijo : (carrito[id] || 0) + delta;
    n = Math.max(0, Math.min(100000, Math.floor(Number(n) || 0)));
    if (n) carrito[id] = n; else delete carrito[id];
    guardarCarrito();
    repintarTarjeta(id);
    pintarCarrito();
  }

  function calcular() {
    var sub = 0, items = 0;
    Object.keys(carrito).forEach(function (id) {
      var p = porId[id]; if (!p || p.precio == null) return;
      sub += cents(p.precio) * carrito[id];
      items += carrito[id];
    });
    var dom = (document.querySelector('input[name="entrega"]:checked') || {}).value !== 'recogida';
    var env = 0;
    if (dom && sub > 0 && envioCfg) {
      env = (sub >= cents(envioCfg.minimo_gratis)) ? 0 : cents(envioCfg.tarifa);
    }
    return { sub: sub / 100, env: env / 100, tot: (sub + env) / 100, items: items, domicilio: dom };
  }

  function pintarCarrito() {
    var ids = Object.keys(carrito).filter(function (id) { return porId[id]; });
    var n = ids.reduce(function (s, id) { return s + carrito[id]; }, 0);
    var b = $('cuentaCarrito'); b.textContent = n > 99 ? '99+' : n; b.hidden = !n;

    if (!ids.length) {
      $('lineasCarrito').innerHTML = '<div class="mz-vacio"><i class="fas fa-cart-shopping"></i>Tu pedido está vacío.<br>Añade productos del catálogo.</div>';
      $('checkout').hidden = true; $('pieCarrito').hidden = true;
      return;
    }
    $('lineasCarrito').innerHTML = ids.map(function (id) {
      var p = porId[id], c = carrito[id];
      return '<div class="mz-linea">' +
        '<img src="' + esc(imagenes[id] || 'images/placeholder-product.png') + '" alt="">' +
        '<div><div class="mz-linea__nom">' + esc(p.name) + '</div>' +
        '<div class="mz-linea__det">' + esc(p.unidad) + ' · ' + rd(p.precio) + '</div></div>' +
        '<div class="mz-linea__der"><span class="mz-linea__sub">' + rd(cents(p.precio) * c / 100) + '</span>' +
        '<span class="mz-paso"><button type="button" data-menos="' + esc(id) + '" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
        '<input type="number" min="0" step="1" inputmode="numeric" value="' + c + '" data-cant="' + esc(id) + '" aria-label="Cantidad">' +
        '<button type="button" data-mas="' + esc(id) + '" aria-label="Añadir uno"><i class="fas fa-plus"></i></button></span></div></div>';
    }).join('');
    $('checkout').hidden = false; $('pieCarrito').hidden = false;
    // 538 · La dirección guardada en «Mi ubicación» sale rellena (se puede cambiar).
    if (!$('cDireccion').value.trim() && ficha.direccion) {
      $('cDireccion').value = ficha.direccion;
      if (ficha.ciudad) $('cCiudad').value = ficha.ciudad;
    }
    pintarTotales();
  }

  function pintarTotales() {
    var t = calcular();
    $('campoDireccion').hidden = !t.domicilio;
    $('tSub').textContent = rd(t.sub);
    $('tEnv').textContent = t.domicilio ? (t.env ? rd(t.env) : 'Gratis') : 'No aplica';
    $('tTot').textContent = rd(t.tot);
  }

  // ─── Confirmar pedido ──────────────────────────────────────────────────────
  async function confirmar() {
    if (enviando) return;
    mostrarError('cError', '');
    var t = calcular();
    if (!t.items) { mostrarError('cError', MENSAJES.CARRITO_VACIO); return; }
    var dir = $('cDireccion').value.trim();
    if (t.domicilio && dir.length < 5) {
      // 540 · Recuerda que puede rellenarla con el GPS o el mapa
      mostrarError('cError', MENSAJES.FALTA_DIRECCION + ' Puedes usar «Usar mi ubicación actual» o marcar el punto en el mapa.');
      $('cDireccion').focus(); return;
    }

    var lineas = Object.keys(carrito).filter(function (id) { return porId[id]; }).map(function (id) {
      return { productId: id, cantidad: carrito[id], price: porId[id].precio };
    });
    enviando = true;
    var btn = $('btnConfirmar'); btn.disabled = true; btn.innerHTML = 'Enviando pedido…';
    try {
      var ped = fila(await rpc('mayor_crear_pedido', { p_vale: leerVale(), p_datos: {
        entrega: t.domicilio ? 'domicilio' : 'recogida',
        address: t.domicilio ? dir : '',
        city: t.domicilio ? $('cCiudad').value.trim() : '',
        notes: $('cNotas').value.trim(),
        total: t.tot,
        productLines: lineas
      } }));
      carrito = {}; guardarCarrito();
      $('cNotas').value = '';
      // 540 · Si aún no tenía dirección guardada, la de este pedido (con su punto)
      // pasa a «Mi ubicación» para que el próximo pedido salga relleno.
      if (t.domicilio && !ficha.direccion && fichaLista) {
        var pto = ubicPedido.punto(), ciu = $('cCiudad').value.trim();
        rpc('mayor_guardar_ubicacion', { p_vale: leerVale(), p_direccion: dir, p_ciudad: ciu, p_lat: pto.lat, p_lng: pto.lng })
          .then(function () { ficha.direccion = dir; ficha.ciudad = ciu; ficha.lat = pto.lat; ficha.lng = pto.lng; })
          .catch(function () { /* no importa: el pedido ya está hecho */ });
      }
      ubicPedido.reiniciar();
      pintarCatalogo(); pintarCarrito();
      cerrarPaneles();
      toast('✅ Pedido #' + (ped && (ped.order_number || '').toString() || '') + ' recibido. Te contactaremos para coordinar.');
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      mostrarError('cError', e.message);
      // Precio, total o producto cambiados: se recarga el catálogo con los datos buenos.
      if (e.codigo === 'PRECIO_CAMBIO' || e.codigo === 'TOTAL_CAMBIO' || e.codigo === 'PRODUCTO_NO_DISPONIBLE') {
        await cargarCatalogo();
        mostrarError('cError', e.message);
      }
      if (e.codigo === 'CUENTA_PENDIENTE') { await comprobarEstado(true); }
    } finally {
      enviando = false;
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar pedido';
    }
  }

  // ─── Mis pedidos ───────────────────────────────────────────────────────────
  var ESTADOS = { pendiente: 'Pendiente', procesando: 'Preparando', enviado: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado' };

  // 538 · Se pinta dentro de «Mi cuenta → Mis pedidos».
  async function verPedidos() {
    var caja = $('listaPedidos');
    caja.innerHTML = '<p class="mz-estado">Cargando…</p>';
    try {
      var lista = await rpc('mayor_mis_pedidos', { p_vale: leerVale() }) || [];
      if (!lista.length) {
        caja.innerHTML = '<div class="mz-vacio"><i class="fas fa-receipt"></i>Todavía no has hecho pedidos.</div>';
        return;
      }
      caja.innerHTML = lista.map(function (o) {
        var est = String(o.estado || '').toLowerCase();
        var lin = Array.isArray(o.lineas) ? o.lineas : [];
        var resumen = lin.slice(0, 3).map(function (l) { return l.cantidad + ' × ' + esc(l.name); }).join(' · ') +
                      (lin.length > 3 ? ' · y ' + (lin.length - 3) + ' más' : '');
        return '<div class="mz-ped"><div class="mz-ped__cab"><div><div class="mz-ped__num">Pedido #' + esc(o.numero) + '</div>' +
          '<div class="mz-ped__fecha">' + esc(o.fecha) + ' · ' + (o.entrega === 'recogida' ? 'Recogida en almacén' : 'A domicilio') + '</div></div>' +
          '<span class="mz-est mz-est--' + esc(est) + '">' + esc(ESTADOS[est] || est) + '</span></div>' +
          '<div class="mz-ped__det">' + resumen + '</div>' +
          '<div class="mz-ped__tot">' + rd(o.total) + '</div></div>';
      }).join('');
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      caja.innerHTML = '<p class="mz-error">' + esc(e.message) + '</p>';
    }
  }

  // ─── 537 · Detalle del producto (como en la tienda, con carrusel) ─────────
  // Usa las clases del detalle de la tienda (css/style.css) pero con los datos
  // de mayoristas: descripción al por mayor (o la normal), precio por unidad al
  // por mayor y el mismo carrito. Sin estrellas, favoritos ni compartir.
  var det = { id: null, cant: 1, imgs: [], idx: 0, token: 0 };

  function detImagenHTML(nombre) {
    var imgs = det.imgs.length ? det.imgs : ['images/placeholder-product.png'];
    var err = ' onerror="this.onerror=null;this.src=\'images/placeholder-product.png\'"';
    if (imgs.length < 2) {
      return '<div class="modal-img" id="mzDetImg"><img src="' + esc(imgs[0]) + '" alt="' + esc(nombre) + '"' + err + ' style="cursor:default"></div>';
    }
    var slides = imgs.map(function (src, i) {
      return '<div class="car-slide"><img src="' + esc(src) + '" alt="' + esc(nombre) + ' imagen ' + (i + 1) + '" draggable="false"' + err + '></div>';
    }).join('');
    var dots = imgs.map(function (_, i) {
      return '<button type="button" class="car-dot' + (i === det.idx ? ' active' : '') + '" data-car="' + i + '" aria-label="Imagen ' + (i + 1) + '"></button>';
    }).join('');
    return '<div class="modal-img modal-img--carousel" id="mzDetImg">' +
      '<div class="car-viewport" id="mzCarVp"><div class="car-strip" id="mzCarTira">' + slides + '</div></div>' +
      '<button type="button" class="car-arrow car-arrow--prev" data-car="prev" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>' +
      '<button type="button" class="car-arrow car-arrow--next" data-car="next" aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>' +
      '<div class="car-dots">' + dots + '</div>' +
      '<div class="car-counter" id="mzCarNum">' + (det.idx + 1) + ' / ' + imgs.length + '</div></div>';
  }

  // La tira se mueve en % del ancho: no hace falta medir ni recalcular al girar el móvil.
  function carMover(dx, animar) {
    var t = $('mzCarTira'); if (!t) return;
    t.style.transition = animar ? 'transform .35s cubic-bezier(.25,.46,.45,.94)' : 'none';
    t.style.transform = 'translateX(calc(' + (-det.idx * 100) + '% + ' + dx + 'px))';
  }
  function carIr(n) {
    var total = det.imgs.length; if (total < 2) return;
    det.idx = ((n % total) + total) % total;
    carMover(0, true);
    document.querySelectorAll('#mzDetImg .car-dot').forEach(function (d, i) { d.classList.toggle('active', i === det.idx); });
    var c = $('mzCarNum'); if (c) c.textContent = (det.idx + 1) + ' / ' + total;
  }
  // Deslizar con el dedo o arrastrar con el ratón. Un gesto vertical se deja
  // para desplazar la ventana (touch-action: pan-y en css/mayor.css).
  function carEnlazar() {
    var vp = $('mzCarVp'); if (!vp) return;
    var x0 = null, y0 = 0, dx = 0, horiz = null;
    vp.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') e.preventDefault();
      x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null;
    });
    vp.addEventListener('pointermove', function (e) {
      if (x0 === null) return;
      var mx = e.clientX - x0, my = e.clientY - y0;
      if (horiz === null && (Math.abs(mx) > 6 || Math.abs(my) > 6)) {
        horiz = Math.abs(mx) > Math.abs(my);
        if (horiz) { try { vp.setPointerCapture(e.pointerId); } catch (er) {} }
      }
      if (!horiz) return;
      dx = mx; carMover(dx, false);
    });
    function fin() {
      if (x0 === null) return;
      x0 = null;
      if (!horiz) return;
      var w = vp.offsetWidth || 1, n = det.idx + (dx < 0 ? 1 : -1);
      if (Math.abs(dx) > w * 0.15 && n >= 0 && n < det.imgs.length) carIr(n); else carMover(0, true);
    }
    vp.addEventListener('pointerup', fin);
    vp.addEventListener('pointercancel', fin);
  }

  function detCuerpoHTML(p) {
    var ok = aprobado() && p.precio != null;
    var tiene = carrito[p.id] || 0;
    var precio = ok
      ? '<div class="price-current">' + rd(p.precio) + ' <span class="price-unit">/ ' + esc(p.unidad) + '</span></div>'
      : '<span class="mz-sinprecio"><i class="fas fa-lock"></i> Precio al aprobar tu cuenta</span>';
    // 538 · corazón de favoritos, como en la tienda
    var fav = '<div class="modal-actions mz-det-fav"><button type="button" class="modal-favorite-btn' + (esFav(p.id) ? ' active' : '') +
      '" data-det="fav" aria-label="Favorito" title="Favorito"><i class="fas fa-heart"></i></button></div>';
    var acciones = ok
      ? (tiene ? '<p class="mz-det-nota"><i class="fas fa-check"></i> Ya tienes ' + tiene + ' en tu pedido</p>' : '') +
        '<div class="modal-actions-row"><div class="modal-qty">' +
          '<button type="button" class="modal-qty-btn" data-det="menos" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
          '<span class="modal-qty-num" id="mzDetCant">' + det.cant + '</span>' +
          '<button type="button" class="modal-qty-btn" data-det="mas" aria-label="Añadir uno"><i class="fas fa-plus"></i></button>' +
        '</div>' + fav + '</div>' +
        '<button type="button" class="modal-add-btn" id="mzDetAdd" data-det="add"></button>'
      : '<div class="modal-actions-row">' + fav + '</div>' +
        '<button type="button" class="modal-add-btn" disabled style="opacity:.5;cursor:not-allowed"><i class="fas fa-lock"></i> Pendiente de aprobación</button>';
    return '<div class="modal-details">' +
      '<div class="modal-cat">' + esc(nombreCategoria(p.category)) + '</div>' +
      '<div class="modal-name">' + esc(p.name) + '</div>' +
      '<span class="mz-unidad"><i class="fas fa-box"></i> ' + esc(p.unidad) + '</span>' +
      (p.desc ? '<p class="modal-desc">' + esc(p.desc) + '</p>' : '<div style="flex:1"></div>') +
      '<div class="modal-price">' + precio + '</div>' + acciones + '</div>';
  }

  function detPintarCant() {
    var p = porId[det.id]; if (!p) return;
    var c = $('mzDetCant'); if (c) c.textContent = det.cant;
    var b = $('mzDetAdd');
    if (b) b.innerHTML = '<i class="fas fa-cart-plus"></i> ' + (carrito[p.id] ? 'Actualizar pedido' : 'Añadir al pedido') +
                         ' · ' + rd(cents(p.precio) * det.cant / 100);
  }

  function abrirDetalle(id) {
    var p = porId[id]; if (!p) return;
    det.id = id; det.idx = 0; det.cant = carrito[id] || 1;
    det.imgs = imagenes[id] ? [imagenes[id]] : [];
    var tk = ++det.token;
    $('mzDetalleCont').innerHTML = detImagenHTML(p.name) + detCuerpoHTML(p);
    carEnlazar(); detPintarCant();
    $('mzDetalle').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    // Foto principal + fotos extra, bajo demanda (igual que la tienda). Si
    // llega tarde y ya se cerró o se abrió otro producto, no se toca nada.
    fetch(_SB_URL + '/products?select=image,images&id=eq.' + encodeURIComponent(id), { headers: _SB_HEADERS })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (filas) {
        if (tk !== det.token) return;
        var f = (filas && filas[0]) || {};
        var extra = f.images;
        if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch (e) { extra = []; } }
        if (!Array.isArray(extra)) extra = [];
        if (f.image) imagenes[id] = f.image;
        var todas = [f.image || imagenes[id]].concat(extra).filter(Boolean)
          .filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (todas.length === det.imgs.length && todas[0] === det.imgs[0]) return;
        det.imgs = todas; det.idx = 0;
        var b = $('mzDetImg');
        if (b) { b.outerHTML = detImagenHTML(p.name); carEnlazar(); }
      })
      .catch(function () { /* sin fotos extra: queda la principal */ });
  }

  function cerrarDetalle() {
    var d = $('mzDetalle');
    if (!d || d.classList.contains('hidden')) return false;
    d.classList.add('hidden'); det.token++; det.id = null;
    document.body.style.overflow = '';
    return true;
  }

  // ─── Paneles ───────────────────────────────────────────────────────────────
  function abrirPanel(id) {
    cerrarPaneles(); cerrarCuenta();
    $(id).hidden = false; $('fondoPanel').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function cerrarPaneles() {
    ['panelCarrito', 'panelFavoritos'].forEach(function (id) { $(id).hidden = true; });
    $('fondoPanel').hidden = true;
    document.body.style.overflow = '';
  }

  /* ═════════════════════════════════════════════════════════════════════════
   * 538 · MI CUENTA (pedido del dueño: «como en la tienda»)
   *   Barra: saludo «Hola, <negocio>», Mi cuenta, Favoritos, Avisos, Carrito.
   *   Mi cuenta: Mis pedidos, Mi perfil (nombre, RNC, contraseña), Mi
   *   ubicación (a mano o con el mapa), Notificaciones, Soporte, Términos.
   *   Perfil, ubicación y avisos usan seguridad/108; si aún no está, cada
   *   opción lo dice y el resto de la página sigue funcionando.
   * ═════════════════════════════════════════════════════════════════════════ */
  var ficha = { rnc: '', direccion: '', ciudad: '', lat: null, lng: null };
  var fichaLista = false;
  var avisos = [];
  var favoritos = [];

  function iniciales(n) {
    var p = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function fmtTel(t) {
    var d = String(t || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : String(t || '');
  }
  // Función de la base que aún no existe (SQL sin ejecutar): PostgREST da 404.
  function sinActivar(e) { return !!(e && / \(404\)/.test(e.message || '')); }

  function pintarCabecera() {
    if (!yo) return;
    var ini = iniciales(yo.nombre);
    $('nombreMayorista').textContent = yo.nombre;
    $('mzAvatar').textContent = ini;
    $('mzCuentaAvatar').textContent = ini;
    $('mzCuentaNombre').textContent = yo.nombre;
    $('mzCuentaTel').textContent = fmtTel(yo.telefono) + (aprobado() ? '' : ' · pendiente de aprobación');
  }

  function abrirCuenta(vista) {
    cerrarPaneles(); cerrarDetalle();
    $('mzCuenta').classList.add('open');
    $('mzCuentaFondo').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    verVista(vista || 'inicio');
  }
  function cerrarCuenta() {
    var c = $('mzCuenta');
    if (!c || !c.classList.contains('open')) return false;
    c.classList.remove('open');
    $('mzCuentaFondo').classList.add('hidden');
    document.body.style.overflow = '';
    return true;
  }
  function verVista(v) {
    document.querySelectorAll('#mzCuenta .acc-view').forEach(function (el) {
      el.classList.toggle('active', el.id === 'mz-v-' + v);
    });
    if (v === 'pedidos') verPedidos();
    else if (v === 'perfil') llenarPerfil();
    else if (v === 'ubicacion') llenarUbicacion();
    else if (v === 'avisos') {
      pintarAvisos();
      cargarAvisos().then(function () { pintarAvisos(); marcarAvisosLeidos(); });
    }
  }

  // ── Ficha: RNC y dirección ──
  async function cargarFicha() {
    try {
      var r = fila(await rpc('mayor_mi_ficha', { p_vale: leerVale() }));
      if (r) {
        ficha = { rnc: r.rnc || '', direccion: r.direccion || '', ciudad: r.ciudad || '',
                  lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng) };
      }
      fichaLista = true;
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      fichaLista = false;
    }
  }

  // ── Mi perfil ──
  function llenarPerfil() {
    $('pfNombre').value = yo ? yo.nombre : '';
    $('pfRnc').value = ficha.rnc || '';
    $('pfTel').value = yo ? fmtTel(yo.telefono) : '';
    mostrarError('pfError', ''); mostrarError('ckError', '');
  }
  async function guardarPerfil(ev) {
    ev.preventDefault();
    var nom = $('pfNombre').value.trim();
    var rnc = $('pfRnc').value.replace(/\D/g, '');
    if (nom.length < 2 || nom.length > 80) { mostrarError('pfError', MENSAJES.NOMBRE_INVALIDO); return; }
    if (rnc && rnc.length !== 9 && rnc.length !== 11) { mostrarError('pfError', MENSAJES.RNC_INVALIDO); return; }
    var btn = $('pfBtn'); btn.disabled = true;
    mostrarError('pfError', '');
    try {
      var r = fila(await rpc('mayor_guardar_perfil', { p_vale: leerVale(), p_nombre: nom, p_rnc: rnc }));
      yo.nombre = (r && r.nombre) || nom;
      ficha.rnc = (r && r.rnc != null) ? r.rnc : rnc;
      $('pfRnc').value = ficha.rnc;
      pintarCabecera();
      toast('✅ Datos guardados.');
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      mostrarError('pfError', sinActivar(e) ? MSG_SIN_ACTIVAR : e.message);
    } finally { btn.disabled = false; }
  }
  async function cambiarClave(ev) {
    ev.preventDefault();
    var act = $('ckActual').value, n1 = $('ckNueva').value, n2 = $('ckNueva2').value;
    if (!act) { mostrarError('ckError', 'Escribe tu contraseña actual.'); return; }
    if (n1.length < 6) { mostrarError('ckError', MENSAJES.CLAVE_CORTA); return; }
    if (n1 !== n2) { mostrarError('ckError', 'Las dos contraseñas nuevas no coinciden.'); return; }
    if (n1 === act) { mostrarError('ckError', MENSAJES.CLAVE_IGUAL); return; }
    var btn = $('ckBtn'); btn.disabled = true;
    mostrarError('ckError', '');
    try {
      // La base DEVUELVE el resultado (no lo lanza) para que el intento fallido
      // quede contado: 5 fallos bloquean 15 minutos, igual que al entrar.
      var res = await rpc('mayor_cambiar_clave', { p_vale: leerVale(), p_actual: act, p_nueva: n1 });
      if (res !== 'OK') {
        mostrarError('ckError', MENSAJES[res] || 'No se pudo cambiar la contraseña. Inténtalo de nuevo.');
        $('ckActual').focus();
        return;
      }
      $('ckActual').value = ''; $('ckNueva').value = ''; $('ckNueva2').value = '';
      toast('✅ Contraseña cambiada. Las demás sesiones abiertas se cerraron.');
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      mostrarError('ckError', sinActivar(e) ? MSG_SIN_ACTIVAR : e.message);
    } finally { btn.disabled = false; }
  }

  // ── Ubicación: a mano, con el GPS, o moviendo el punto en el mapa ──
  // El mapa es Leaflet (vendor/leaflet-1.9.4) con calles de OpenStreetMap. Se
  // carga SOLO al usarlo: el resto de /mayor no paga sus 150 KB.
  // 540 · Lo usan DOS sitios con el mismo código: «Mi ubicación» y el carrito
  // (crearUbicador más abajo). Cada uno tiene su propio mapa y su propio punto.
  var leafletProm = null;
  var CENTRO_HATO_MAYOR = [18.7629, -69.2569];   // si aún no hay punto

  function cargarLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletProm) return leafletProm;
    leafletProm = new Promise(function (ok, mal) {
      var css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'vendor/leaflet-1.9.4/leaflet.css';
      document.head.appendChild(css);
      var s = document.createElement('script');
      s.src = 'vendor/leaflet-1.9.4/leaflet.js';
      s.onload = function () { window.L ? ok(window.L) : mal(new Error('sin Leaflet')); };
      s.onerror = function () { leafletProm = null; mal(new Error('no cargó Leaflet')); };
      document.head.appendChild(s);
    });
    return leafletProm;
  }
  function redondear(n) { return Math.round(Number(n) * 1e6) / 1e6; }

  /* 540 · UBICADOR: botón GPS + «marcar el punto yo mismo» + mapa con el punto
   * que se arrastra + «Usar la dirección de este punto» + «Quitar punto». Rellena
   * los campos de dirección y ciudad que se le indiquen. El mismo código sirve a
   * «Mi ubicación» (prefijo ub) y al carrito (prefijo cu); cada uno con su mapa.
   *   cfg.prefijo + Gps, Elegir, Estado, Mapa, MapaLienzo, UsarDir, Quitar
   *   cfg.error, cfg.dir, cfg.ciudad  → ids de los campos
   *   cfg.inicio()                    → [lat, lng] donde empieza «marcar yo mismo» */
  function crearUbicador(cfg) {
    var id = function (s) { return $(cfg.prefijo + s); };
    var punto = { lat: null, lng: null }, mapa = null, marca = null;

    function hay() { return punto.lat != null && punto.lng != null && isFinite(punto.lat) && isFinite(punto.lng); }
    function estado(t) { var e = id('Estado'); e.textContent = t || ''; e.hidden = !t; }
    function error(t) { mostrarError(cfg.error, t || ''); }
    // `desdeMapa` = lo movió el mayorista con el dedo.
    function fijar(lat, lng, desdeMapa) {
      punto = { lat: redondear(lat), lng: redondear(lng) };
      if (desdeMapa) {
        id('UsarDir').hidden = false;
        estado('✓ Punto movido. Si quieres, pulsa «Usar la dirección de este punto».');
      }
    }
    async function mostrar(centrar) {
      var caja = id('Mapa');
      if (!hay()) { caja.hidden = true; return; }
      caja.hidden = false;
      var L;
      try { L = await cargarLeaflet(); }
      catch (e) {
        caja.hidden = true;
        error('No se pudo cargar el mapa (¿sin internet?). Escribe la dirección a mano.');
        return;
      }
      var pos = [punto.lat, punto.lng];
      if (!mapa) {
        L.Icon.Default.imagePath = 'vendor/leaflet-1.9.4/images/';
        mapa = L.map(cfg.prefijo + 'MapaLienzo', { zoomControl: true, attributionControl: true }).setView(pos, 17);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap'
        }).addTo(mapa);
        marca = L.marker(pos, { draggable: true, autoPan: true, title: 'Tu negocio' }).addTo(mapa);
        marca.on('dragend', function () { var p = marca.getLatLng(); fijar(p.lat, p.lng, true); });
        mapa.on('click', function (ev) { marca.setLatLng(ev.latlng); fijar(ev.latlng.lat, ev.latlng.lng, true); });
      } else {
        marca.setLatLng(pos);
      }
      // Estaba oculto: Leaflet tiene que volver a medir el hueco antes de centrar.
      setTimeout(function () {
        if (!mapa) return;
        mapa.invalidateSize();
        if (centrar !== false) mapa.setView(pos, Math.max(mapa.getZoom(), 16));
      }, 60);
    }
    function quitar() {
      punto = { lat: null, lng: null };
      id('Mapa').hidden = true; id('UsarDir').hidden = true;
      estado('Punto quitado. La dirección escrita se mantiene.');
    }
    function elegir() {
      error('');
      if (!hay()) {
        var c = (cfg.inicio && cfg.inicio()) || CENTRO_HATO_MAYOR;
        fijar(c[0], c[1], false);
        estado('Mueve el punto hasta tu negocio (o toca el mapa donde está).');
      }
      mostrar(true);
    }
    // Rellena dirección y ciudad con lo que hay en ese punto (OpenStreetMap).
    async function direccionDe(lat, lng) {
      var res = await fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&addressdetails=1',
                            { headers: { 'Accept-Language': 'es' } });
      var d = await res.json(), a = (d && d.address) || {};
      var calle = a.road || a.pedestrian || a.street || '';
      var partes = [];
      if (calle) partes.push(calle + (a.house_number ? ' #' + a.house_number : ''));
      var sector = a.suburb || a.neighbourhood || a.quarter || '';
      if (sector) partes.push(sector);
      var dir = partes.join(', ') || String(d.display_name || '').split(',').slice(0, 2).join(',').trim();
      if (dir) $(cfg.dir).value = dir;
      var ciudad = a.city || a.town || a.village || a.municipality || a.county || a.state || '';
      if (ciudad) $(cfg.ciudad).value = ciudad;
      return !!dir;
    }
    async function usarDir() {
      if (!hay()) return;
      var b = id('UsarDir'); b.disabled = true;
      estado('Buscando la dirección de ese punto…');
      try {
        var ok = await direccionDe(punto.lat, punto.lng);
        estado(ok ? '✓ Dirección actualizada. Revísala y corrígela si hace falta.' : 'Ese punto no tiene calle conocida. Escribe la dirección a mano.');
        b.hidden = true;
      } catch (e) {
        estado('No se pudo leer la dirección de ese punto. Escríbela a mano.');
      } finally { b.disabled = false; }
    }
    function gps() {
      error('');
      if (!navigator.geolocation) {
        error('Este teléfono no permite detectar la ubicación. Escribe la dirección a mano.');
        return;
      }
      var btn = id('Gps'); btn.disabled = true;
      estado('Buscando tu ubicación…');
      navigator.geolocation.getCurrentPosition(async function (pos) {
        fijar(pos.coords.latitude, pos.coords.longitude, false);
        id('UsarDir').hidden = true;
        mostrar(true);
        estado('Ubicación encontrada. Buscando la dirección…');
        try {
          await direccionDe(punto.lat, punto.lng);
          estado('✓ Punto marcado. Si no es exacto, arrastra el punto hasta tu negocio.');
        } catch (e) {
          estado('✓ Punto marcado. Escribe la dirección a mano; puedes arrastrar el punto.');
        } finally { btn.disabled = false; }
      }, function (err) {
        btn.disabled = false; estado('');
        var m = { 1: 'No diste permiso de ubicación. Escribe la dirección a mano o actívalo en Ajustes.',
                  2: 'No se pudo obtener tu ubicación. Escribe la dirección a mano.',
                  3: 'La ubicación tardó demasiado. Inténtalo de nuevo o escríbela a mano.' };
        error(m[err && err.code] || m[2]);
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    }

    id('Gps').addEventListener('click', gps);
    id('Elegir').addEventListener('click', elegir);
    id('Quitar').addEventListener('click', quitar);
    id('UsarDir').addEventListener('click', usarDir);

    return {
      // Pone un punto ya conocido (o ninguno) y deja el resto limpio.
      poner: function (lat, lng) {
        punto = { lat: lat == null ? null : Number(lat), lng: lng == null ? null : Number(lng) };
        id('UsarDir').hidden = true; estado(''); error('');
        return mostrar(true);
      },
      punto: function () { return hay() ? { lat: punto.lat, lng: punto.lng } : { lat: null, lng: null }; },
      reiniciar: function () {
        punto = { lat: null, lng: null };
        id('Mapa').hidden = true; id('UsarDir').hidden = true; estado(''); error('');
      }
    };
  }
  var ubicMia = null;      // «Mi ubicación»
  var ubicPedido = null;   // carrito (se crean en enlazar())

  function llenarUbicacion() {
    $('ubDir').value = ficha.direccion || '';
    $('ubCiudad').value = ficha.ciudad || '';
    ubicMia.poner(ficha.lat, ficha.lng);
  }
  async function guardarUbicacion(ev) {
    ev.preventDefault();
    var dir = $('ubDir').value.trim(), ciudad = $('ubCiudad').value.trim();
    if (dir.length < 5) { mostrarError('ubError', MENSAJES.DIRECCION_CORTA); $('ubDir').focus(); return; }
    var btn = $('ubBtn'); btn.disabled = true;
    mostrarError('ubError', '');
    var pto = ubicMia.punto();
    try {
      await rpc('mayor_guardar_ubicacion', { p_vale: leerVale(), p_direccion: dir, p_ciudad: ciudad,
                                             p_lat: pto.lat, p_lng: pto.lng });
      ficha.direccion = dir; ficha.ciudad = ciudad; ficha.lat = pto.lat; ficha.lng = pto.lng;
      $('cDireccion').value = dir; if (ciudad) $('cCiudad').value = ciudad;   // el pedido la usa ya
      toast('📍 Dirección guardada. Saldrá rellena en tus pedidos.');
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      mostrarError('ubError', sinActivar(e) ? MSG_SIN_ACTIVAR : e.message);
    } finally { btn.disabled = false; }
  }

  // ── Notificaciones (las crea la base: cuenta aprobada, pedido cambia de estado) ──
  async function cargarAvisos() {
    try {
      var l = await rpc('mayor_avisos', { p_vale: leerVale() });
      avisos = Array.isArray(l) ? l : [];
    } catch (e) {
      if (esFinDeSesion(e)) { cerrarLocal(e.message); return; }
      avisos = [];
    }
    pintarContadorAvisos();
  }
  function pintarContadorAvisos() {
    var n = avisos.filter(function (a) { return !a.leido; }).length;
    var b = $('cuentaAvisos'); b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  }
  var ICONO_AVISO = { aprobada: 'circle-check', pedido: 'truck-fast', cancelado: 'circle-xmark', entregado: 'box-open' };
  function pintarAvisos() {
    var caja = $('listaAvisos');
    if (!avisos.length) {
      caja.innerHTML = '<div class="mz-vacio"><i class="fas fa-bell"></i>No tienes notificaciones.<br>' +
        'Te avisaremos aquí cuando aprueben tu cuenta o cambie el estado de un pedido.</div>';
      return;
    }
    caja.innerHTML = avisos.map(function (a) {
      var t = String(a.tipo || 'pedido');
      return '<div class="mz-noti mz-noti--' + esc(t) + (a.leido ? '' : ' mz-noti--nueva') + '">' +
        '<div class="mz-noti__ico"><i class="fas fa-' + (ICONO_AVISO[t] || 'bell') + '"></i></div>' +
        '<div class="mz-noti__txt"><div class="mz-noti__tit">' + esc(a.titulo) + '</div>' +
        '<div class="mz-noti__msg">' + esc(a.mensaje) + '</div>' +
        '<div class="mz-noti__fecha">' + esc(a.fecha) + '</div></div></div>';
    }).join('');
  }
  async function marcarAvisosLeidos() {
    if (!avisos.some(function (a) { return !a.leido; })) return;
    try {
      await rpc('mayor_avisos_leidos', { p_vale: leerVale() });
      avisos.forEach(function (a) { a.leido = true; });
      pintarContadorAvisos();
    } catch (e) { /* se volverá a intentar al abrirlas otra vez */ }
  }

  // ── Favoritos: en este teléfono, uno por mayorista (como la tienda) ──
  function claveFav() { return 'cm_mayor_fav:' + (yo && yo.id ? yo.id : ''); }
  function leerFavoritos() {
    try {
      var a = JSON.parse(localStorage.getItem(claveFav()) || '[]');
      favoritos = Array.isArray(a) ? a.map(String) : [];
    } catch (e) { favoritos = []; }
  }
  function guardarFavoritos() { try { localStorage.setItem(claveFav(), JSON.stringify(favoritos)); } catch (e) {} }
  function esFav(id) { return favoritos.indexOf(String(id)) !== -1; }
  function alternarFav(id) {
    id = String(id);
    var i = favoritos.indexOf(id);
    if (i >= 0) favoritos.splice(i, 1); else favoritos.unshift(id);
    guardarFavoritos(); pintarContadorFav();
    return i < 0;
  }
  // Solo se ven los que siguen al por mayor; los demás se guardan por si vuelven.
  function favVisibles() { return favoritos.filter(function (id) { return porId[id]; }); }
  function pintarContadorFav() {
    var n = favVisibles().length;
    var b = $('cuentaFavoritos'); b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
  }
  function verFavoritos() { abrirPanel('panelFavoritos'); pintarListaFav(); }
  function pintarListaFav() {
    var ids = favVisibles(), caja = $('listaFavoritos');
    if (!ids.length) {
      caja.innerHTML = '<div class="mz-vacio"><i class="fas fa-heart"></i>Todavía no tienes favoritos.<br>' +
        'Toca un producto y pulsa el corazón.</div>';
      return;
    }
    caja.innerHTML = ids.map(function (id) {
      var p = porId[id];
      var precio = (aprobado() && p.precio != null) ? ' · ' + rd(p.precio) : '';
      return '<div class="mz-linea mz-fav" data-fav-abrir="' + esc(id) + '">' +
        '<img src="' + esc(imagenes[id] || 'images/placeholder-product.png') + '" alt="">' +
        '<div><div class="mz-linea__nom">' + esc(p.name) + '</div>' +
        '<div class="mz-linea__det">' + esc(p.unidad) + precio + '</div></div>' +
        '<button type="button" class="mz-fav__quitar" data-fav-quitar="' + esc(id) + '" aria-label="Quitar de favoritos" title="Quitar">' +
        '<i class="fas fa-heart"></i></button></div>';
    }).join('');
    cargarImagenes(ids);
  }

  // ── Soporte: mismo WhatsApp y correo que la tienda ──
  var soporteCfg = null;
  async function abrirSoporte() {
    var fondo = $('mzSoporteFondo'), hoja = $('mzSoporte'), opc = $('mzSoporteOpc');
    opc.innerHTML = '<div style="text-align:center;padding:16px;color:#aaa"><i class="fas fa-spinner fa-spin"></i></div>';
    fondo.classList.remove('hidden'); hoja.classList.remove('hidden');
    requestAnimationFrame(function () { fondo.classList.add('open'); hoja.classList.add('open'); });
    if (!soporteCfg) {
      try { soporteCfg = (typeof DB !== 'undefined' && DB.getSettings) ? await DB.getSettings() : {}; } catch (e) { soporteCfg = {}; }
    }
    var wa = String(soporteCfg.storeWhatsapp || ''), mail = String(soporteCfg.storeEmail || '');
    var num = wa.replace(/\D/g, ''); if (num.length === 10) num = '1' + num;
    var html = '';
    if (num) html += '<a class="support-sheet-option" style="--oc:#25d366" target="_blank" rel="noopener" href="https://wa.me/' + num +
      '?text=' + encodeURIComponent('Hola, soy ' + (yo ? yo.nombre : '') + ' (mayorista). Tengo una consulta.') + '">' +
      '<i class="fab fa-whatsapp"></i><span>WhatsApp<small>' + esc(wa) + '</small></span></a>';
    if (mail) html += '<a class="support-sheet-option" style="--oc:#e65100" href="mailto:' + esc(mail) + '">' +
      '<i class="fas fa-envelope"></i><span>Email<small>' + esc(mail) + '</small></span></a>';
    opc.innerHTML = html || '<p style="text-align:center;color:#aaa;padding:12px 0">No hay datos de contacto configurados.</p>';
  }
  function cerrarSoporte() {
    var fondo = $('mzSoporteFondo'), hoja = $('mzSoporte');
    if (!hoja || hoja.classList.contains('hidden')) return false;
    fondo.classList.remove('open'); hoja.classList.remove('open');
    setTimeout(function () { fondo.classList.add('hidden'); hoja.classList.add('hidden'); }, 300);
    return true;
  }

  // ── Código de barras: escáner de la app o código escrito en el buscador ──
  async function escanear() {
    var nat = window.CasaMotaNativo;
    if (!nat || !nat.escanerDisponible || !nat.escanerDisponible()) {
      toast('El escáner funciona dentro de la app de Casa Mota.'); return;
    }
    var r = await nat.escanear();
    if (!r) return;                                   // cancelado
    if (r.error === 'SIN_PERMISO_CAMARA') { toast('Permite la cámara para Casa Mota en los Ajustes del teléfono.'); return; }
    if (r.codigo) buscarCodigo(r.codigo);
  }
  // El catálogo al por mayor no trae códigos: se pregunta a `products` (lectura
  // pública, la misma de la tienda) y se abre el producto si se vende al por mayor.
  async function buscarCodigo(cod) {
    var c = String(cod || '').replace(/\s/g, '');
    if (!c) return;
    var lista = [c], sin = c.replace(/^0+/, '');
    if (sin && sin !== c) lista.push(sin);
    if (/^\d{12}$/.test(c)) lista.push('0' + c);
    lista.push(c.toUpperCase());
    lista = lista.filter(function (v, i, a) { return a.indexOf(v) === i; });
    var inl = lista.map(encodeURIComponent).join(',');
    try {
      var res = await fetch(_SB_URL + '/products?select=id&or=(barcode.in.(' + inl + '),barcode_alt.in.(' + inl + '))&limit=10',
                            { headers: _SB_HEADERS });
      var filas = res.ok ? await res.json() : [];
      var hit = (filas || []).map(function (f) { return String(f.id); }).filter(function (id) { return porId[id]; })[0];
      if (hit) { $('fBuscar').value = ''; mostrados = POR_PAGINA; pintarCatalogo(); abrirDetalle(hit); return; }
      toast((filas && filas.length) ? 'Ese producto no se vende al por mayor.' : 'El código ' + c + ' no está en el catálogo.');
    } catch (e) {
      toast('Sin conexión. Inténtalo de nuevo.');
    }
  }

  // ─── Eventos ───────────────────────────────────────────────────────────────
  function enlazar() {
    $('tabEntrar').addEventListener('click', function () { mostrarAuth('entrar'); });
    $('tabRegistro').addEventListener('click', function () { mostrarAuth('registro'); });
    $('fEntrar').addEventListener('submit', entrar);
    $('fRegistro').addEventListener('submit', registrar);
    document.querySelectorAll('.mz-ver').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = $(b.dataset.para); var ver = i.type === 'password';
        i.type = ver ? 'text' : 'password';
        b.innerHTML = '<i class="fas fa-eye' + (ver ? '-slash' : '') + '"></i>';
      });
    });

    $('btnSalir').addEventListener('click', salir);
    $('btnComprobar').addEventListener('click', function () { comprobarEstado(false); });
    $('btnCarrito').addEventListener('click', function () { pintarCarrito(); abrirPanel('panelCarrito'); });
    $('fondoPanel').addEventListener('click', cerrarPaneles);
    document.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrarPaneles); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!cerrarSoporte() && !cerrarDetalle() && !cerrarCuenta()) cerrarPaneles();
    });

    // 538 · Mi cuenta, favoritos, avisos, soporte, escáner
    $('btnCuenta').addEventListener('click', function () { abrirCuenta('inicio'); });
    $('btnAvisos').addEventListener('click', function () { abrirCuenta('avisos'); });
    $('btnFavoritos').addEventListener('click', verFavoritos);
    $('btnSalir2').addEventListener('click', salir);
    // 539 · «Ir a la tienda normal»: marca esta pestaña para que la pantalla de
    // bienvenida NO lo devuelva a /mayor (la app recuerda al mayorista).
    document.querySelectorAll('[data-ir-detal]').forEach(function (a) {
      a.addEventListener('click', function () {
        try { sessionStorage.setItem('cm_ir_detal', '1'); } catch (e) {}
      });
    });
    $('mzCuentaFondo').addEventListener('click', cerrarCuenta);
    $('mzCuenta').addEventListener('click', function (e) {
      if (e.target.closest('[data-cerrar-cuenta]')) { cerrarCuenta(); return; }
      if (e.target.closest('[data-atras]')) { verVista('inicio'); return; }
      var v = e.target.closest('[data-vista]');
      if (v) { verVista(v.dataset.vista); return; }
      if (e.target.closest('[data-accion="soporte"]')) abrirSoporte();
    });
    $('fPerfil').addEventListener('submit', guardarPerfil);
    $('fClave').addEventListener('submit', cambiarClave);
    $('fUbicacion').addEventListener('submit', guardarUbicacion);
    // 540 · El mismo mapa en «Mi ubicación» y en el carrito (cada uno el suyo).
    ubicMia = crearUbicador({ prefijo: 'ub', error: 'ubError', dir: 'ubDir', ciudad: 'ubCiudad' });
    ubicPedido = crearUbicador({
      prefijo: 'cu', error: 'cuError', dir: 'cDireccion', ciudad: 'cCiudad',
      // «marcar yo mismo» empieza en su punto guardado, si lo tiene
      inicio: function () { return (ficha.lat != null && ficha.lng != null) ? [Number(ficha.lat), Number(ficha.lng)] : null; }
    });
    $('mzSoporteFondo').addEventListener('click', cerrarSoporte);
    $('mzSoporteCancelar').addEventListener('click', cerrarSoporte);
    $('mzSoporteOpc').addEventListener('click', function (e) { if (e.target.closest('a')) cerrarSoporte(); });
    $('listaFavoritos').addEventListener('click', function (e) {
      var q = e.target.closest('[data-fav-quitar]');
      if (q) { alternarFav(q.dataset.favQuitar); pintarListaFav(); toast('Quitado de favoritos.'); return; }
      var a = e.target.closest('[data-fav-abrir]');
      if (a) { cerrarPaneles(); abrirDetalle(a.dataset.favAbrir); }
    });
    $('btnEscanear').addEventListener('click', function (e) { e.preventDefault(); escanear(); });
    // Un código escrito en el buscador (solo números, 6 o más) + Enter también lo busca.
    $('fBuscar').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var v = $('fBuscar').value.trim();
      if (/^\d{6,}$/.test(v)) { e.preventDefault(); buscarCodigo(v); }
    });

    // 537 · Tocar la tarjeta (menos sus botones) abre el detalle.
    $('grid').addEventListener('click', function (e) {
      if (e.target.closest('.mz-ctl')) return;
      var card = e.target.closest('.product-card');
      if (card) abrirDetalle(card.dataset.id);
    });
    $('grid').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('product-card')) abrirDetalle(e.target.dataset.id);
    });
    $('mzDetalle').addEventListener('click', function (e) {
      if (e.target === $('mzDetalle') || e.target.closest('[data-cerrar-det]')) { cerrarDetalle(); return; }
      var c = e.target.closest('[data-car]');
      if (c) { var v = c.dataset.car; carIr(v === 'prev' ? det.idx - 1 : v === 'next' ? det.idx + 1 : Number(v)); return; }
      var d = e.target.closest('[data-det]');
      if (!d) return;
      if (d.dataset.det === 'mas') { det.cant = Math.min(100000, det.cant + 1); detPintarCant(); }
      else if (d.dataset.det === 'menos') { det.cant = Math.max(1, det.cant - 1); detPintarCant(); }
      else if (d.dataset.det === 'fav') {
        var on = alternarFav(det.id);
        d.classList.toggle('active', on);
        toast(on ? '❤️ Añadido a favoritos.' : 'Quitado de favoritos.');
      }
      else if (d.dataset.det === 'add') {
        var p = porId[det.id]; if (!p) return;
        var n = det.cant;
        cambiar(p.id, 0, n);
        cerrarDetalle();
        toast('✅ ' + n + ' × ' + p.name + ' en tu pedido.');
      }
    });

    var tBus = null;
    $('fBuscar').addEventListener('input', function () {
      clearTimeout(tBus);
      tBus = setTimeout(function () { mostrados = POR_PAGINA; pintarCatalogo(); }, 180);
    });
    $('fCategoria').addEventListener('change', function () { mostrados = POR_PAGINA; pintarCatalogo(); });
    $('btnMas').addEventListener('click', function () { mostrados += POR_PAGINA; pintarCatalogo(); });

    // + / − en tarjetas y en el carrito (un solo escuchador para todo)
    document.addEventListener('click', function (e) {
      var mas = e.target.closest('[data-mas]'), menos = e.target.closest('[data-menos]');
      if (mas) cambiar(mas.dataset.mas, 1);
      else if (menos) cambiar(menos.dataset.menos, -1);
    });
    $('lineasCarrito').addEventListener('change', function (e) {
      var inp = e.target.closest('[data-cant]');
      if (inp) cambiar(inp.dataset.cant, 0, inp.value);
    });
    document.querySelectorAll('input[name="entrega"]').forEach(function (r) { r.addEventListener('change', pintarTotales); });
    $('btnConfirmar').addEventListener('click', confirmar);

    // Al volver a la pestaña, si estaba pendiente se comprueba solo; y la campana se actualiza.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !yo) return;
      if (!aprobado()) comprobarEstado(true);
      cargarAvisos();
    });
  }

  // ─── Arranque ──────────────────────────────────────────────────────────────
  async function iniciar() {
    // 539 · Si llegó aquí, quiere /mayor: se quita la marca de «tienda normal».
    try { sessionStorage.removeItem('cm_ir_detal'); } catch (e) {}
    enlazar();
    carrito = leerCarrito();
    var v = leerVale();
    if (!v) { mostrarAuth('entrar'); return; }
    try {
      var r = fila(await rpc('mayor_yo', { p_vale: v }));
      if (!r) throw ErrorBase('SESION_CADUCADA');
      yo = { id: r.id, nombre: r.nombre, telefono: r.telefono, estado: r.estado };
      await mostrarTienda();
    } catch (e) {
      cerrarLocal(esFinDeSesion(e) ? '' : e.message);
    }
  }

  // Para las pruebas automáticas.
  window.MayorCM = { calcular: calcular, cambiar: cambiar, abrirDetalle: abrirDetalle, cerrarDetalle: cerrarDetalle,
                     abrirCuenta: abrirCuenta, verVista: verVista, buscarCodigo: buscarCodigo,
                     estado: function () { return { yo: yo, carrito: carrito, catalogo: catalogo, det: det,
                                                    ficha: ficha, avisos: avisos, favoritos: favoritos }; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
