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
  var catalogo = [];             // [{ id, name, category, unidad, precio }]
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
    TOTAL_CAMBIO:           'El total cambió (envío o precios). Revísalo y confirma de nuevo.'
  };

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
    guardarVale(''); yo = null;
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
    $('nombreMayorista').textContent = yo.nombre;
    $('avisoPendiente').hidden = aprobado();
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
      var peticiones = [rpcPaginado('mayor_catalogo', { p_vale: v }, 'id'), cargarCategorias()];
      if (aprobado()) peticiones.push(rpc('mayor_envio', { p_vale: v }));
      var res = await Promise.all(peticiones);
      catalogo = (res[0] || []).map(function (p) {
        return { id: String(p.id), name: p.name || '', category: p.category || '',
                 unidad: p.unidad || '', precio: p.precio == null ? null : Number(p.precio) };
      }).sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
      porId = {};
      catalogo.forEach(function (p) { porId[p.id] = p; });
      if (aprobado()) envioCfg = fila(res[2]);

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
      var t = norm(p.name + ' ' + p.unidad);
      return palabras.every(function (w) { return t.indexOf(w) !== -1; });
    });
  }

  function tarjeta(p) {
    var cant = carrito[p.id] || 0;
    var img = imagenes[p.id] || 'images/placeholder-product.png';
    var precio = (aprobado() && p.precio != null)
      ? '<span class="price-current">' + rd(p.precio) + ' <span class="price-unit">/ ' + esc(p.unidad) + '</span></span>'
      : '<span class="mz-sinprecio"><i class="fas fa-lock"></i> Precio al aprobar tu cuenta</span>';
    var boton;
    if (!aprobado()) {
      boton = '<button type="button" class="add-cart-btn" disabled><i class="fas fa-lock"></i> Pendiente</button>';
    } else if (cant > 0) {
      boton = '<div class="card-stepper">' +
        '<button type="button" class="card-stepper__btn" data-menos="' + esc(p.id) + '" aria-label="Quitar uno"><i class="fas fa-minus"></i></button>' +
        '<span class="card-stepper__qty">' + cant + '</span>' +
        '<button type="button" class="card-stepper__btn" data-mas="' + esc(p.id) + '" aria-label="Añadir uno"><i class="fas fa-plus"></i></button></div>';
    } else {
      boton = '<button type="button" class="add-cart-btn" data-mas="' + esc(p.id) + '"><i class="fas fa-cart-plus"></i> Añadir</button>';
    }
    return '<div class="product-card" data-id="' + esc(p.id) + '">' +
      '<div class="product-img-wrap"><img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy" ' +
      'onerror="this.onerror=null;this.src=\'images/placeholder-product.png\'"></div>' +
      '<div class="product-info">' +
        '<div class="product-cat-tag">' + esc(nombreCategoria(p.category)) + '</div>' +
        '<div class="product-name">' + esc(p.name) + '</div>' +
        '<span class="mz-unidad"><i class="fas fa-box"></i> ' + esc(p.unidad) + '</span>' +
        '<div class="product-price-row"><div class="price-group">' + precio + '</div></div>' +
      '</div>' + boton + '</div>';
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

  function repintarTarjeta(id) {
    var el = document.querySelector('.product-card[data-id="' + String(id).replace(/"/g, '') + '"]');
    if (el && porId[id]) el.outerHTML = tarjeta(porId[id]);
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
    if (t.domicilio && dir.length < 5) { mostrarError('cError', MENSAJES.FALTA_DIRECCION); $('cDireccion').focus(); return; }

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

  async function verPedidos() {
    abrirPanel('panelPedidos');
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

  // ─── Paneles ───────────────────────────────────────────────────────────────
  function abrirPanel(id) {
    cerrarPaneles();
    $(id).hidden = false; $('fondoPanel').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function cerrarPaneles() {
    ['panelCarrito', 'panelPedidos'].forEach(function (id) { $(id).hidden = true; });
    $('fondoPanel').hidden = true;
    document.body.style.overflow = '';
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
    $('btnPedidos').addEventListener('click', verPedidos);
    $('btnCarrito').addEventListener('click', function () { pintarCarrito(); abrirPanel('panelCarrito'); });
    $('fondoPanel').addEventListener('click', cerrarPaneles);
    document.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrarPaneles); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarPaneles(); });

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

    // Al volver a la pestaña, si estaba pendiente se comprueba solo.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && yo && !aprobado()) comprobarEstado(true);
    });
  }

  // ─── Arranque ──────────────────────────────────────────────────────────────
  async function iniciar() {
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
  window.MayorCM = { calcular: calcular, cambiar: cambiar, estado: function () { return { yo: yo, carrito: carrito, catalogo: catalogo }; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
