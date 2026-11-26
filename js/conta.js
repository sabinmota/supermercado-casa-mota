/* ═══════════════════════════════════════════════════════════════════════════
   553 · CONTABILIDAD EN EL PANEL  (seguridad/111 · ejecutado 20-nov, 34/34)
   ───────────────────────────────────────────────────────────────────────────
   Tres pestañas:
     · Cuentas por pagar: facturas de proveedores, avisos de vencidas y de
       próximas a vencer (7 días), pronto pago, pagar de una vez y anular pago.
     · Recepción de mercancía: proveedor + líneas a mano o leídas de la foto
       de la factura con IA (/api/factura-ia). Al confirmar, la BASE crea sola
       la factura por pagar. 🔴 NO toca el inventario (decisión del dueño).
     · Proveedores: alta, edición y baja.

   Decisiones del dueño (20-nov): solo Super Admin y Administrador (la base lo
   comprueba en cada función conta_*); pago de una vez; solo monto total; la
   foto se usa y se descarta (nunca se guarda); línea que no está en el
   catálogo = «No emparejado» (cuenta en el total, no toca ningún producto).

   553e · Emparejar cada línea con un producto del catálogo SOLO por su código:
     1) referencia del proveedor elegido (ficha del producto, seguridad/113),
     2) código de barras (principal o alterno).
   🔴 YA NO se empareja ni se sugiere por la descripción (decisión del dueño:
      la de la factura casi nunca coincide con la del catálogo). Lo que no
      casa queda «No emparejado» y se empareja a mano; si la línea trae
      código, al confirmar queda guardado como referencia de ese proveedor.
   Las referencias las carga y guarda js/referencias-prov.js (CasaMotaRefs).

   553f · Editar una recepción guardada (seguridad/114, conta_editar_recepcion):
     botón «Editar recepción» en el historial → se carga en el formulario.
     «Volver a emparejar» prueba otra vez las líneas «No emparejado» con las
     referencias y códigos de hoy (sin foto ni IA). Factura por pagar → se
     puede cambiar todo menos el proveedor (la factura se actualiza sola).
     Factura pagada o borrada → SOLO emparejar (la base lo vuelve a exigir).

   Fichero aparte: no toca admin.v33.js ni api.js. Usa de ellos: _SB_URL,
   _SB_HEADERS, _valeAdmin, fmt$, showAdminToast, adminProducts, DB.getProducts,
   _admBuscar/_admTokens/_admNorm, getSession/getRole.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = n => 'RD$ ' + (typeof fmt$ === 'function' ? fmt$(n) : (Number(n) || 0).toFixed(2));
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
  const toast = (m, t) => { if (typeof showAdminToast === 'function') showAdminToast(m, t); else alert(m); };
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  /* Número escrito por el empleado: admite coma decimal. '' → null. */
  function num(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  // ─── Fechas (siempre texto AAAA-MM-DD, sin Date para no correr un día) ─────
  function hoy() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }
  function sumarDias(iso, n) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + Number(n || 0))).toISOString().slice(0, 10);
  }
  function fFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  function textoDias(d) {
    d = Number(d);
    if (d < 0) return `hace ${plural(-d, 'día', 'días')}`;
    if (d === 0) return 'vence hoy';
    if (d === 1) return 'vence mañana';
    return `en ${d} días`;
  }

  // ─── Base de datos (funciones conta_* con el vale del panel) ──────────────
  const ERRORES = {
    SESION_INVALIDA:          'Tu sesión no es válida. Vuelve a entrar al panel.',
    SESION_CADUCADA:          'Tu sesión caducó. Vuelve a entrar al panel.',
    CUENTA_DESACTIVADA:       'Tu cuenta ya no está activa.',
    SIN_PERMISO_CONTABILIDAD: 'Contabilidad es solo para Super Admin y Administrador.',
    DATOS_INVALIDOS:          'Los datos no llegaron correctamente.',
    ID_INVALIDO:              'Identificador no válido. Recarga la página.',
    FALTA_NOMBRE:             'Escribe el nombre del proveedor.',
    CORREO_INVALIDO:          'El correo electrónico no es válido (ej. ventas@proveedor.com).',
    RNC_INVALIDO:             'El RNC debe tener 9 números (1-01-00369-3) o, si es una cédula, 11 (001-0000000-1).',
    TEL_INVALIDO:             'Cada teléfono debe tener 10 números (809-227-3000). Revisa el último.',
    PROVINCIA_INVALIDA:       'Elige la provincia de la lista.',
    CODIGO_POSTAL_INVALIDO:   'El código postal debe tener 5 cifras.',
    TERMINO_INVALIDO:         'El término de crédito debe ser un número entero de 0 a 365 días.',
    DESCUENTO_INVALIDO:       'El descuento invisible va de 0 a 20 % (ej. 2 o 2.5).',
    UND_CAJA_INVALIDA:        'Und/caja debe ser un número entero de 1 en adelante.',
    ITBIS_INVALIDO:           'El ITBIS de la línea debe ser 0 o más.',
    REGALO_INVALIDO:          'Una línea de regalo debe ir en 0.00 y repetir un producto cobrado de la misma factura.',
    SIN_CAMBIOS:              'Marca al menos un producto para actualizar su costo.',
    DEMASIADOS_CAMBIOS:       'Como máximo 500 productos de una vez.',
    PROVEEDOR_REPETIDO:       'Ya existe un proveedor con ese nombre.',
    PROVEEDOR_NO_EXISTE:      'Ese proveedor ya no existe. Recarga la página.',
    PROVEEDOR_CON_DEUDA:      'No se puede dar de baja: tiene facturas sin pagar.',
    FACTURA_NO_EXISTE:        'Esa factura ya no existe. Recarga la página.',
    FACTURA_YA_PAGADA:        'Esa factura ya estaba pagada.',
    FACTURA_NO_PAGADA:        'Esa factura no está pagada.',
    FACTURA_PAGADA:           'Una factura pagada no se puede cambiar ni borrar. Anula antes el pago.',
    FACTURA_REPETIDA:         'Ese número de factura ya está registrado para este proveedor.',
    FALTA_NUMERO:             'Escribe el número de la factura.',
    FALTA_FECHA:              'Indica la fecha de la factura.',
    FECHA_PAGO_FUTURA:        'La fecha de pago no puede ser posterior a hoy.',
    FECHA_PAGO_INVALIDA:      'La fecha de pago no puede ser anterior a la emisión.',
    FECHA_INVALIDA:           'Hay una fecha no válida.',
    VENCIMIENTO_INVALIDO:     'El vencimiento no puede ser anterior a la emisión.',
    MONTO_INVALIDO:           'El monto debe ser mayor que 0.',
    PRONTO_PAGO_INCOMPLETO:   'Pronto pago: indica el % y también los días (o deja los dos vacíos).',
    PRONTO_PAGO_INVALIDO:     'Pronto pago: el % va de 0 a 100 y los días de 0 a 365.',
    SIN_LINEAS:               'Añade al menos una línea.',
    DEMASIADAS_LINEAS:        'Una recepción admite como máximo 300 líneas.',
    LINEA_INVALIDA:           'Hay una línea con datos no válidos.',
    PRODUCTO_NO_EXISTE:       'Una línea apunta a un producto que ya no existe. Vuelve a emparejarla.',
    FALTA_DESCRIPCION:        'Hay una línea sin descripción.',
    CANTIDAD_INVALIDA:        'Hay una cantidad no válida (debe ser mayor que 0).',
    COSTO_INVALIDO:           'Hay un costo no válido (debe ser 0 o más).',
    TOTAL_INVALIDO:           'El total de la factura debe ser mayor que 0.',
    TOTAL_CERO:               'El total de la factura no puede ser 0.',
    RECEPCION_NO_EXISTE:      'Esa recepción ya no existe. Recarga la página.',
    PROVEEDOR_NO_SE_CAMBIA:   'El proveedor de una recepción guardada no se puede cambiar.',
    SOLO_EMPAREJAR:           'La factura está pagada o borrada: solo se pueden emparejar las líneas.',
    METODO_PAGO_INVALIDO:     'Elige el método de pago: efectivo, cheque o transferencia bancaria.',
    FALTA_NUMERO_PAGO:        'Escribe el número del cheque o de la transferencia.',
    NUMERO_PAGO_LARGO:        'El número del cheque o de la transferencia admite como máximo 30 caracteres.',
    BANCO_INVALIDO:           'Elige la entidad bancaria de la lista.',
    CREDITO_MAYOR_QUE_FACTURA: 'Lo no recibido no puede valer más que el total de la factura.',
    NCF_INVALIDO:             'El e-NCF no es válido: E + 12 cifras (ej. E310000008681) o B + 10 cifras (ej. B0100000123).',
    NCF_REPETIDO:             'Ese e-NCF ya está registrado en otra factura de este proveedor.',
    conta_facturas_ncf_ck:    'El e-NCF no es válido: E + 12 cifras o B + 10 cifras.',
    conta_facturas_credito_ck: 'El monto no puede ser menor que el crédito por mercancía no recibida.',
  };

  /* 555 · Lo que de verdad se debe de una factura: monto − crédito (mercancía
   * no recibida, seguridad/117). Si la base aún no trae a_pagar, el monto. */
  const creditoDe = f => Number(f && f.credito) || 0;

  /* 557 · e-NCF en su propio campo (seguridad/118). Misma regla que
   * _conta_ncf() en la base: sin espacios ni guiones, mayúsculas;
   * E + 12 cifras (e-CF) o B + 10 cifras (NCF de papel). '' = sin e-NCF. */
  const limpiarNcf = s => String(s || '').replace(/[\s-]/g, '').toUpperCase();
  const ncfValido  = s => !s || /^(B\d{10}|E\d{12})$/.test(s);
  const aPagarDe  = f => (f && f.a_pagar != null) ? Number(f.a_pagar) : Number(f && f.monto) || 0;

  /* 553g · Método de pago. Los MISMOS 4 bancos que _conta_bancos() en la base
   * (seguridad/115, nombres sin «Bco.» desde el 116); la base rechaza cualquier otro. */
  const BANCOS = ['Banco Popular Dominicano', 'Banreservas', 'Banco Bhd', 'Asoc. La Nacional'];
  const METODOS = { efectivo: 'Efectivo', cheque: 'Cheque', transferencia: 'Transferencia' };
  function textoMetodo(f) {
    if (!f.metodo_pago) return 'método no registrado';
    if (f.metodo_pago === 'efectivo') return 'Efectivo';
    return `${METODOS[f.metodo_pago] || f.metodo_pago} nº ${f.pago_numero || '—'} · ${f.pago_banco || '—'}`;
  }

  function traducir(texto, status) {
    let msg = String(texto || '');
    try { const j = JSON.parse(msg); msg = [j.message, j.details, j.hint].filter(Boolean).join(' · ') || msg; } catch (e) { /* texto plano */ }
    const linea = /linea (\d+)/.exec(msg);
    const extra = linea ? ` (línea ${linea[1]})` : '';
    const largo = /TEXTO_LARGO_([A-Z_]+)/.exec(msg);
    if (largo) return `El campo «${largo[1].toLowerCase().replace(/_/g, ' ')}» es demasiado largo.`;
    for (const k in ERRORES) if (msg.includes(k)) return ERRORES[k] + extra;
    if (status === 404 || msg.includes('PGRST202')) return 'Falta una función en la base: hay un SQL de Contabilidad sin ejecutar.';
    console.error('[contabilidad] respuesta de la base:', texto);
    return `No se pudo completar (${status})` + (msg ? `: ${msg.slice(0, 200)}` : '.');
  }

  function vale() {
    try { return typeof _valeAdmin === 'function' ? _valeAdmin() : ''; } catch (e) { return ''; }
  }

  /* lista=true → por páginas de 1.000 (límite de Supabase, regla del dueño). */
  async function rpc(fn, params, lista) {
    const v = vale();
    if (!v) throw new Error('Tu sesión caducó. Vuelve a entrar al panel.');
    const cuerpo = JSON.stringify(Object.assign({ p_vale: v }, params || {}));
    if (!lista) {
      const res = await fetch(`${_SB_URL}/rpc/${fn}`, { method: 'POST', headers: _SB_HEADERS, body: cuerpo });
      const t = await res.text();
      if (!res.ok) throw new Error(traducir(t, res.status));
      return (!t || t === 'null') ? null : JSON.parse(t);
    }
    let todo = [];
    let desde = 0;
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      const res = await fetch(`${_SB_URL}/rpc/${fn}?limit=1000&offset=${desde}`,
        { method: 'POST', headers: _SB_HEADERS, body: cuerpo });
      const t = await res.text();
      if (!res.ok) throw new Error(traducir(t, res.status));
      const filas = t ? JSON.parse(t) : [];
      if (!Array.isArray(filas) || !filas.length) break;
      todo = todo.concat(filas);
      if (filas.length < 1000) break;
      desde += filas.length;
    }
    return todo;
  }

  /* ─── 553c · Provincias de la República Dominicana y su código postal ──────
   * Los MISMOS 32 nombres que _conta_provincias() en la base (seguridad/112).
   * Código = el de la capital de la provincia, leído uno a uno el 20-nov en
   * do.micodigopostal.info (datos de INPOSDOM), no escrito de memoria.
   * La Altagracia: la página de Higüey trae «00000» (sin dato); se usa 23000,
   * el de San Rafael del Yuma (misma provincia, prefijo 23).
   * Distrito Nacional y Santo Domingo: NO tienen uno solo, cambia por sector
   * (DN 10101–10699, Santo Domingo 11xxx) → no se inventa: se pide escribirlo.
   * El código se puede corregir siempre a mano (5 cifras). */
  const PROVINCIAS = [
    ['Azua', '71000'], ['Baoruco', '82000'], ['Barahona', '81000'], ['Dajabón', '63000'],
    ['Distrito Nacional', ''], ['Duarte', '31000'], ['El Seibo', '24000'], ['Elías Piña', '73000'],
    ['Espaillat', '56000'], ['Hato Mayor', '25000'], ['Hermanas Mirabal', '34000'],
    ['Independencia', '83000'], ['La Altagracia', '23000'], ['La Romana', '22000'], ['La Vega', '41000'],
    ['María Trinidad Sánchez', '33000'], ['Monseñor Nouel', '42000'], ['Monte Cristi', '62000'],
    ['Monte Plata', '92000'], ['Pedernales', '84000'], ['Peravia', '94000'], ['Puerto Plata', '57000'],
    ['Samaná', '32000'], ['San Cristóbal', '91000'], ['San José de Ocoa', '93000'], ['San Juan', '72000'],
    ['San Pedro de Macorís', '21000'], ['Sánchez Ramírez', '43000'], ['Santiago', '51000'],
    ['Santiago Rodríguez', '64000'], ['Santo Domingo', ''], ['Valverde', '61000'],
  ];
  const CP_POR_SECTOR = { 'Distrito Nacional': 'empieza por 10', 'Santo Domingo': 'empieza por 11' };
  const cpDe = prov => (PROVINCIAS.find(p => p[0] === prov) || [])[1] || '';

  // ─── Estado ────────────────────────────────────────────────────────────────
  const S = {
    tab: 'pagar',
    prov: [], fac: [], rec: [],
    cargado: false, cargando: false, error: '',
    recLineas: {},        // recepcion_id → líneas (caché del historial)
    abierta: null,        // recepción desplegada en el historial
    lineas: [],           // recepción en curso
    origen: 'manual',
    paginas: [],          // 559 · [{ src, leida }] fotos de las páginas SOLO en memoria (nunca se guardan)
    iaLeyendo: false,
    iaCancelar: false,
    iaTot: null,          // 559 · { subtotal, descuento, itbis, total } leídos del pie de la factura
    guardando: false,
    provEdit: null, facEdit: null, venEditado: false, pagoId: null, empIdx: null,
    edit: null,           // 553f · recepción guardada que se está editando (null = nueva)
  };

  function permitido() {
    try {
      const s = typeof getSession === 'function' ? getSession() : null;
      return !!(s && typeof getRole === 'function' && getRole(s.role).sections.includes('contabilidad'));
    } catch (e) { return false; }
  }

  function productos() {
    const l = (typeof adminProducts !== 'undefined' && Array.isArray(adminProducts)) ? adminProducts : [];
    return l.filter(p => p && !p.deleted);
  }
  function prodPorId(id) {
    return productos().find(p => String(p.id) === String(id)) || null;
  }
  function provPorId(id) {
    return S.prov.find(p => String(p.id) === String(id)) || null;
  }

  async function cargar() {
    if (S.cargando) return;
    S.cargando = true;
    if (!S.cargado) pintarCargando();
    try {
      const tareas = [
        rpc('conta_leer_proveedores', {}, true),
        rpc('conta_leer_facturas', {}, true),
        rpc('conta_leer_recepciones', {}, true),
      ];
      if (!productos().length && typeof DB !== 'undefined' && typeof DB.getProducts === 'function') {
        tareas.push(DB.getProducts({ full: true })
          .then(l => { if (l && l.length) adminProducts = l; })
          .catch(() => { /* sin catálogo: se puede recibir igual, todo «No emparejado» */ }));
      }
      if (window.CasaMotaRefs) tareas.push(window.CasaMotaRefs.cargar(true));
      const [p, f, r] = await Promise.all(tareas);
      S.prov = p || []; S.fac = f || []; S.rec = r || [];
      S.cargado = true; S.error = '';
      S.recLineas = {};
    } catch (e) {
      S.error = e.message || 'No se pudo cargar Contabilidad.';
    } finally {
      S.cargando = false;
    }
    pintarTodo();
  }

  // ─── Pintar ────────────────────────────────────────────────────────────────
  function pintarCargando() {
    ['ctFacTbody', 'ctProvTbody', 'ctRecHist'].forEach(id => {
      const tb = $(id);
      if (tb) tb.innerHTML = `<tr><td colspan="9" class="myr-vacio">Cargando…</td></tr>`;
    });
  }

  function pintarTodo() {
    pintarSelects();
    pintarAvisos();
    pintarFacturas();
    pintarProveedores();
    pintarHist();
    pintarLineas();
    pintarTotalesRec();
  }

  function provOpciones(vacio) {
    return `<option value="">${vacio}</option>` + S.prov
      .map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}${p.rnc ? ' · RNC ' + esc(p.rnc) : ''}</option>`).join('');
  }
  function pintarSelects() {
    [['ctFacProv', 'Todos los proveedores'], ['ctRecProv', '— Elige el proveedor —'], ['ctFacModalProv', '— Elige el proveedor —']]
      .forEach(([id, vacio]) => {
        const sel = $(id);
        if (!sel) return;
        const antes = sel.value;
        sel.innerHTML = provOpciones(vacio);
        if (antes && provPorId(antes)) sel.value = antes;
      });
    asegurarProvEdit();
  }
  /* 553f · En edición el proveedor está fijo, aunque ya esté dado de baja. */
  function asegurarProvEdit() {
    const sel = $('ctRecProv');
    if (!S.edit || !sel) return;
    const id = String(S.edit.proveedor_id);
    if (!Array.from(sel.options).some(o => o.value === id)) {
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(S.edit.proveedor_nombre)} (dado de baja)</option>`);
    }
    sel.value = id;
  }

  function cuentas() {
    const sin = S.fac.filter(f => !f.pagada);
    const venc = sin.filter(f => f.estado === 'vencida');
    const prox = sin.filter(f => f.estado === 'proxima');
    const suma = l => l.reduce((a, f) => a + aPagarDe(f), 0);   // 555 · ya sin el crédito
    return { sin, venc, prox, mSin: suma(sin), mVenc: suma(venc), mProx: suma(prox) };
  }

  function badge(venc, prox) {
    const b = $('ctNavBadge');
    if (!b) return;
    const n = venc + prox;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('ct-nav-badge--ambar', !venc && prox > 0);
    b.title = `${plural(venc, 'factura vencida', 'facturas vencidas')} · ${plural(prox, 'próxima', 'próximas')} a vencer`;
  }

  function pintarAvisos() {
    const box = $('ctAvisos');
    if (!box) return;
    if (S.error) {
      box.hidden = false;
      box.innerHTML = `<div class="ct-aviso ct-aviso--rojo"><i class="fas fa-triangle-exclamation"></i><span>${esc(S.error)}</span></div>`;
      return;
    }
    const c = cuentas();
    badge(c.venc.length, c.prox.length);
    const nTab = $('ctTabNumPagar');
    if (nTab) { nTab.hidden = !(c.venc.length + c.prox.length); nTab.textContent = c.venc.length + c.prox.length; }

    const h = hoy();
    const pp = c.sin.filter(f => Number(f.pronto_pago_pct) > 0 && f.pronto_pago_hasta && f.pronto_pago_hasta >= h)
      .sort((a, b) => String(a.pronto_pago_hasta).localeCompare(String(b.pronto_pago_hasta)));
    const MAX = 6;
    const fila = (f, clase, icono, texto) => `
      <div class="ct-aviso ${clase}">
        <i class="fas ${icono}"></i>
        <span>${texto}</span>
        <button type="button" class="ct-aviso__btn" data-act="pagar" data-id="${esc(f.id)}"><i class="fas fa-money-bill-wave"></i> Pagar</button>
      </div>`;
    const mas = (l, est, txt) => l.length > MAX
      ? `<button type="button" class="ct-aviso__mas" data-act="filtrar" data-estado="${est}">y ${l.length - MAX} ${txt} más…</button>` : '';

    const html =
      c.venc.sort((a, b) => a.dias - b.dias).slice(0, MAX).map(f => fila(f, 'ct-aviso--rojo', 'fa-circle-exclamation',
        `La factura <b>${esc(f.numero)}</b> del proveedor <b>${esc(f.proveedor_nombre)}</b> está <b>vencida</b> ` +
        `(${textoDias(f.dias)}, el ${fFecha(f.fecha_vencimiento)}) · ${money(aPagarDe(f))}`)).join('') +
      mas(c.venc, 'vencida', 'vencidas') +
      c.prox.sort((a, b) => a.dias - b.dias).slice(0, MAX).map(f => fila(f, 'ct-aviso--ambar', 'fa-clock',
        `La factura <b>${esc(f.numero)}</b> del proveedor <b>${esc(f.proveedor_nombre)}</b> ` +
        `${f.dias <= 1 ? textoDias(f.dias) : 'vence ' + textoDias(f.dias)} (${fFecha(f.fecha_vencimiento)}) · ${money(aPagarDe(f))}`)).join('') +
      mas(c.prox, 'proxima', 'próximas') +
      pp.slice(0, MAX).map(f => fila(f, 'ct-aviso--verde', 'fa-piggy-bank',
        `Pronto pago: si pagas la factura <b>${esc(f.numero)}</b> de <b>${esc(f.proveedor_nombre)}</b> ` +
        `hasta el <b>${fFecha(f.pronto_pago_hasta)}</b> ahorras <b>${money(aPagarDe(f) - Number(f.monto_con_descuento))}</b> ` +
        `(${Number(f.pronto_pago_pct)} %)`)).join('');

    box.hidden = !html;
    box.innerHTML = html;
  }

  const ESTADO = {
    vencida:   ['Vencida', 'ct-est--vencida'],
    proxima:   ['Próxima a vencer', 'ct-est--proxima'],
    pendiente: ['Pendiente', 'ct-est--pendiente'],
    pagada:    ['Pagada', 'ct-est--pagada'],
  };

  function pintarFacturas() {
    const tb = $('ctFacTbody');
    if (!tb) return;
    const c = cuentas();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('ctKpiPend', money(c.mSin)); set('ctKpiPendN', plural(c.sin.length, 'factura', 'facturas'));
    set('ctKpiVenc', money(c.mVenc)); set('ctKpiVencN', plural(c.venc.length, 'factura', 'facturas'));
    set('ctKpiProx', money(c.mProx)); set('ctKpiProxN', plural(c.prox.length, 'factura', 'facturas'));
    if (S.error) { tb.innerHTML = `<tr><td colspan="8" class="myr-vacio">⚠️ ${esc(S.error)}</td></tr>`; return; }

    const q    = $('ctFacBuscar')?.value || '';
    const prov = $('ctFacProv')?.value || '';
    const est  = $('ctFacEstado')?.value ?? 'sinpagar';
    const buscar = typeof _admBuscar === 'function'
      ? (f => _admBuscar(q, f.numero, f.proveedor_nombre, f.ncf))
      : (f => !q || (f.numero + ' ' + f.proveedor_nombre).toLowerCase().includes(q.toLowerCase()));
    const lista = S.fac.filter(f =>
      (!prov || String(f.proveedor_id) === prov) &&
      (est === '' || (est === 'sinpagar' ? !f.pagada : f.estado === est)) &&
      buscar(f));

    set('ctFacCount', lista.length ? plural(lista.length, 'factura', 'facturas') : 'Sin resultados');
    if (!lista.length) {
      tb.innerHTML = `<tr><td colspan="8" class="myr-vacio">${S.fac.length
        ? 'Ninguna factura coincide con el filtro.'
        : (S.prov.length
          ? 'Todavía no hay facturas. Se crean solas al confirmar una <b>Recepción de mercancía</b>, o con «Nueva factura».'
          : 'Empieza dando de alta tus <b>Proveedores</b>; después registra sus facturas.')}</td></tr>`;
      return;
    }

    const h = hoy();
    tb.innerHTML = lista.map(f => {
      const [txtEst, claseEst] = ESTADO[f.estado] || [f.estado, ''];
      const pct = Number(f.pronto_pago_pct) || 0;
      let pp = '<span class="ct-gris">—</span>';
      if (pct > 0) {
        if (f.pagada) pp = `<span class="ct-gris">${pct} % hasta ${fFecha(f.pronto_pago_hasta)}</span>`;
        else if (f.pronto_pago_hasta >= h) {
          pp = `<span class="ct-pp"><b>${pct} %</b> hasta ${fFecha(f.pronto_pago_hasta)}<br><small>paga ${money(f.monto_con_descuento)}</small></span>`;
        } else pp = `<span class="ct-gris">${pct} % · venció el ${fFecha(f.pronto_pago_hasta)}</span>`;
      }
      const venc = f.pagada
        ? fFecha(f.fecha_vencimiento)
        : `${fFecha(f.fecha_vencimiento)}<br><small class="ct-dias ct-dias--${esc(f.estado)}">${textoDias(f.dias)}</small>`;
      const id = esc(f.id);
      const deRec = f.recepcion_id
        ? ` <button type="button" class="ct-icono" data-act="verrec" data-id="${esc(f.recepcion_id)}" title="Creada desde una recepción · ver líneas"><i class="fas fa-truck-ramp-box"></i></button>` : '';
      const acciones = f.pagada
        ? `<span class="ct-pagada">Pagada el ${fFecha(f.fecha_pago)}<br><small>${money(f.monto_pagado)}</small><br><small class="ct-metodo-txt">${esc(textoMetodo(f))}</small></span>
           <button class="action-btn" data-act="anular" data-id="${id}" title="Anular el pago"><i class="fas fa-rotate-left"></i></button>`
        : `<button class="btn-myr btn-myr--ok" data-act="pagar" data-id="${id}"><i class="fas fa-money-bill-wave"></i> Pagar</button>
           <button class="action-btn action-btn-edit" data-act="editar" data-id="${id}" title="Editar"><i class="fas fa-pen"></i></button>
           <button class="action-btn action-btn-del" data-act="borrar" data-id="${id}" title="Borrar"><i class="fas fa-trash"></i></button>`;
      return `
        <tr class="ct-fila--${esc(f.estado)}">
          <td><strong>${esc(f.numero)}</strong>${deRec}${f.ncf ? `<br><small class="ct-ncf-txt" title="Comprobante fiscal">e-NCF ${esc(f.ncf)}</small>` : ''}${f.notas ? `<br><small class="ct-gris" title="${esc(f.notas)}">${esc(f.notas.slice(0, 40))}${f.notas.length > 40 ? '…' : ''}</small>` : ''}</td>
          <td>${esc(f.proveedor_nombre)}</td>
          <td>${fFecha(f.fecha_emision)}</td>
          <td>${venc}</td>
          <td class="n"><b>${money(f.monto)}</b>${creditoDe(f) > 0
            ? `<br><small class="ct-cred-txt">crédito − ${money(creditoDe(f))}</small><br><small class="ct-cred-txt"><b>a pagar ${money(aPagarDe(f))}</b></small>` : ''}</td>
          <td>${pp}</td>
          <td><span class="ct-est ${claseEst}">${txtEst}</span></td>
          <td><div class="action-btns ct-acciones">${acciones}</div></td>
        </tr>`;
    }).join('');
  }

  function pintarProveedores() {
    const tb = $('ctProvTbody');
    if (!tb) return;
    if (S.error) { tb.innerHTML = `<tr><td colspan="8" class="myr-vacio">⚠️ ${esc(S.error)}</td></tr>`; return; }
    const q = $('ctProvBuscar')?.value || '';
    const lista = S.prov.filter(p => typeof _admBuscar === 'function'
      ? _admBuscar(q, p.nombre, p.representante, p.rnc, p.telefonos, p.correo, p.sector, p.ciudad, p.provincia)
      : (!q || (p.nombre + ' ' + p.rnc).toLowerCase().includes(q.toLowerCase())));
    const cnt = $('ctProvCount');
    if (cnt) cnt.textContent = lista.length ? plural(lista.length, 'proveedor', 'proveedores') : 'Sin resultados';
    if (!lista.length) {
      tb.innerHTML = `<tr><td colspan="8" class="myr-vacio">${S.prov.length
        ? 'Ningún proveedor coincide con la búsqueda.'
        : 'Todavía no hay proveedores. Pulsa «Nuevo proveedor».'}</td></tr>`;
      return;
    }
    tb.innerHTML = lista.map(p => {
      const id = esc(p.id);
      const deuda = Number(p.pendientes) > 0
        ? `<b>${money(p.deuda)}</b><br><small class="ct-gris">${plural(Number(p.pendientes), 'factura', 'facturas')}</small>`
        : '<span class="ct-gris">—</span>';
      const tels = String(p.telefonos || '').split(/[\/,;]+/).map(t => t.trim()).filter(Boolean)
        .map(t => `<a href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>`);
      const contacto = tels.concat(p.correo ? [`<a href="mailto:${esc(p.correo)}" class="ct-correo">${esc(p.correo)}</a>`] : []).join('<br>');
      const linea1 = [p.direccion, p.sector].filter(Boolean).map(esc).join(', ');
      const linea2 = [p.ciudad, p.provincia].filter(Boolean).map(esc).join(', ') + (p.codigo_postal ? ` · ${esc(p.codigo_postal)}` : '');
      const ubic = (linea1 || linea2.trim())
        ? `${linea1 ? `${linea1}<br>` : ''}<small class="ct-gris">${linea2}</small>` : '<span class="ct-gris">—</span>';
      return `
        <tr>
          <td><strong>${esc(p.nombre)}</strong>${p.notas ? `<br><small class="ct-gris">${esc(p.notas)}</small>` : ''}</td>
          <td>${esc(p.representante) || '<span class="ct-gris">—</span>'}</td>
          <td>${esc(p.rnc) || '<span class="ct-gris">—</span>'}</td>
          <td>${contacto || '<span class="ct-gris">—</span>'}</td>
          <td class="ct-ubic">${ubic}</td>
          <td class="n">${plural(Number(p.termino_dias), 'día', 'días')}</td>
          <td class="n">${deuda}</td>
          <td><div class="action-btns">
            <button class="action-btn action-btn-edit" data-act="editprov" data-id="${id}" title="Editar"><i class="fas fa-pen"></i></button>
            <button class="action-btn action-btn-del" data-act="bajaprov" data-id="${id}" title="Dar de baja"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`;
    }).join('');
  }

  function pintarHist() {
    const tb = $('ctRecHist');
    if (!tb) return;
    if (S.error) { tb.innerHTML = `<tr><td colspan="8" class="myr-vacio">⚠️ ${esc(S.error)}</td></tr>`; return; }
    if (!S.rec.length) {
      tb.innerHTML = `<tr><td colspan="8" class="myr-vacio">Todavía no hay recepciones.</td></tr>`;
      return;
    }
    tb.innerHTML = S.rec.map(r => {
      const abierta = String(S.abierta) === String(r.id);
      const sin = Number(r.sin_producto) || 0;
      const estFac = r.factura_id == null
        ? '<span class="ct-gris">borrada</span>'
        : (r.factura_pagada ? '<span class="ct-est ct-est--pagada">Pagada</span>' : '<span class="ct-est ct-est--pendiente">Por pagar</span>');
      let det = '';
      if (abierta) {
        const ls = S.recLineas[r.id];
        det = `<tr class="ct-det"><td colspan="8">${ls
          ? `<table class="ct-det__tabla"><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th>Producto</th><th class="n">Cant.</th><th class="n">Costo</th><th class="n">Importe</th></tr></thead><tbody>${
            ls.map(l => {
              const p = l.producto_id ? prodPorId(l.producto_id) : null;
              return `<tr${l.recibido === false ? ' class="ct-det--norec"' : ''}><td>${l.orden}</td><td>${esc(l.codigo) || '—'}</td><td>${esc(l.descripcion)}${l.recibido === false ? ' <span class="ct-norec">No recibido</span>' : ''}</td>
                <td>${l.producto_id ? esc(p ? p.name : '(producto ' + l.producto_id + ')') : '<span class="ct-noemp">No emparejado</span>'}</td>
                <td class="n">${Number(l.cantidad)}</td><td class="n">${money(l.costo_unitario)}</td><td class="n">${money(l.importe)}</td></tr>`;
            }).join('')}</tbody></table>
            <p class="ct-nota">Suma de líneas ${money(r.suma_lineas)}${r.monto_factura != null ? ` · Factura ${money(r.monto_factura)}` : ''}${(() => {
              const c = r2(ls.filter(l => l.recibido === false).reduce((a, l) => a + Number(l.importe || 0), 0));
              return c > 0 ? ` · <span class="ct-cred-txt">Créditos (no recibido) − ${money(c)}</span>` : '';
            })()}${r.ncf ? ` · <span class="ct-ncf-txt">e-NCF ${esc(r.ncf)}</span>` : ''}${r.notas ? ' · ' + esc(r.notas) : ''}</p>
            <div class="ct-det__acc">
              <button type="button" class="btn-secondary ct-btn-sm" data-act="editrec" data-id="${esc(r.id)}"><i class="fas fa-pen-to-square"></i> Editar recepción</button>
              ${ls.some(l => l.producto_id && l.costo_unidad != null && l.recibido !== false) ? `<button type="button" class="btn-secondary ct-btn-sm" data-act="costosrec" data-id="${esc(r.id)}"><i class="fas fa-tags"></i> Actualizar costos del catálogo</button>` : ''}
              ${r.factura_id == null ? '<small class="ct-gris">Factura borrada: solo se puede emparejar.</small>' : (r.factura_pagada ? '<small class="ct-gris">Factura pagada: solo se puede emparejar.</small>' : '')}
              ${r.editado_en ? `<small class="ct-editada"><i class="fas fa-clock-rotate-left"></i> Editada por ${esc(nombreEmpleado(r.editado_por))} el ${fFechaHora(r.editado_en)}</small>` : ''}
            </div>`
          : 'Cargando líneas…'}</td></tr>`;
      }
      return `
        <tr class="ct-hist-fila${abierta ? ' ct-hist-fila--abierta' : ''}" data-act="verrec" data-id="${esc(r.id)}" tabindex="0">
          <td>${fFecha(r.fecha)}</td>
          <td>${esc(r.proveedor_nombre)}</td>
          <td><strong>${esc(r.numero_factura)}</strong></td>
          <td>${r.origen === 'ia' ? '<span class="ct-ia-chip"><i class="fas fa-wand-magic-sparkles"></i> IA</span>' : 'Manual'}${r.editado_en ? '<br><small class="ct-gris">editada</small>' : ''}</td>
          <td class="n">${Number(r.lineas)}${sin ? `<br><small class="ct-noemp-txt">${sin} no emparejada${sin === 1 ? '' : 's'}</small>` : ''}</td>
          <td class="n">${r.monto_factura != null ? money(r.monto_factura) : '—'}</td>
          <td>${estFac}</td>
          <td><i class="fas fa-chevron-${abierta ? 'up' : 'down'} ct-gris"></i></td>
        </tr>${det}`;
    }).join('');
  }

  /* 553f · Quién editó (lista del Personal que ya carga el panel). */
  function nombreEmpleado(id) {
    try {
      const yo = typeof getSession === 'function' ? getSession() : null;
      if (yo && String(yo.id) === String(id)) return 'usted';
      const l = (typeof staffList !== 'undefined' && Array.isArray(staffList)) ? staffList : [];
      const s = l.find(x => String(x.id) === String(id));
      if (s) return [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email || 'un administrador';
    } catch (e) { /* sin lista de personal */ }
    return 'un administrador';
  }
  function fFechaHora(iso) {
    try {
      return new Date(iso).toLocaleString('es-DO', {
        timeZone: 'America/Santo_Domingo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return fFecha(iso); }
  }

  async function verRecepcion(id, forzarAbrir) {
    if (!forzarAbrir && String(S.abierta) === String(id)) { S.abierta = null; pintarHist(); return; }
    S.abierta = id;
    pintarHist();
    if (!S.recLineas[id]) {
      try {
        S.recLineas[id] = await rpc('conta_leer_recepcion_lineas', { p_id: id }, true);
      } catch (e) {
        toast(e.message, 'error');
        S.abierta = null;
      }
      pintarHist();
    }
  }

  // ─── 565 · Parte 4: actualizar el costo del catálogo, producto por producto ──
  /* Sale al guardar una recepción (solo si hay algo que cambiar) y con el
   * botón del historial. Usa el costo por unidad GUARDADO en la base (con el
   * ITBIS, el descuento invisible y los regalos licuados). Si un producto sale
   * en varias líneas, se promedia por unidades. Nada se marca solo: el
   * empleado elige uno por uno qué costos cambian (pedido del dueño). */
  async function abrirCostos(id, auto) {
    let ls = S.recLineas[id];
    try {
      if (!ls) ls = S.recLineas[id] = await rpc('conta_leer_recepcion_lineas', { p_id: id }, true);
    } catch (e) { if (!auto) toast(e.message, 'error'); return; }
    const grupos = {};
    (ls || []).forEach(l => {
      if (!l.producto_id || l.recibido === false) return;
      const g = grupos[l.producto_id] || (grupos[l.producto_id] = { id: l.producto_id, u: 0, s: 0, pend: false, desc: l.descripcion });
      if (l.costo_unidad == null || l.und_caja == null) { if (l.regalo_de == null) g.pend = true; return; }
      const u = Number(l.cantidad) * Number(l.und_caja);
      g.u += u; g.s += u * Number(l.costo_unidad);
    });
    const filas = Object.values(grupos).map(g => {
      const p = prodPorId(g.id);
      const actual = p && p.costo !== null && p.costo !== undefined && p.costo !== '' && !isNaN(Number(p.costo)) ? Number(p.costo) : null;
      const nuevo = (!g.pend && g.u > 0) ? r2(g.s / g.u) : null;
      return { id: g.id, nombre: p ? p.name : g.desc, actual, nuevo,
               igual: nuevo !== null && actual !== null && Math.abs(nuevo - actual) < 0.005 };
    });
    if (auto && !filas.some(f => f.nuevo !== null && !f.igual)) return;
    if (!filas.length) { toast('Esta recepción no tiene líneas emparejadas con el catálogo: emparéjalas primero con «Emparejar».', 'info'); return; }
    S.costos = filas;
    const r = S.rec.find(x => String(x.id) === String(id));
    $('ctCostoTxt').innerHTML = `Factura <b>${esc(r ? r.numero_factura : '')}</b>${r ? ` de <b>${esc(r.proveedor_nombre || '')}</b>` : ''}: marca <b>uno por uno</b> los productos cuyo costo quieres cambiar en el catálogo.`;
    pintarCostos();
    errorModal('ctCostoError', '');
    abrirModal('ctCostoModal');
  }
  function pintarCostos() {
    $('ctCostoLista').innerHTML = S.costos.map((f, i) => {
      let cambio = '<span class="ct-gris">—</span>';
      if (f.nuevo !== null && f.actual === null) cambio = '<span class="ct-gris">nuevo</span>';
      else if (f.nuevo !== null && f.actual > 0 && !f.igual) {
        const pct = (f.nuevo - f.actual) / f.actual * 100;
        cambio = `<span class="${pct > 0 ? 'ct-sube' : 'ct-baja'}">${pct > 0 ? '+' : ''}${pct.toFixed(1)} %</span>`;
      }
      const chk = f.nuevo === null
        ? '<span class="ct-pend" title="Falta und/caja o ITBIS en la recepción">Pendiente</span>'
        : (f.igual ? '<small class="ct-gris">igual</small>'
          : `<input type="checkbox" class="ct-costo-chk" data-ci="${i}" aria-label="Actualizar el costo de ${esc(f.nombre)}" />`);
      return `<tr><td class="ct-rc">${chk}</td><td>${esc(f.nombre)}</td>
        <td class="n">${f.actual === null ? '<span class="ct-gris">sin costo</span>' : money(f.actual)}</td>
        <td class="n"><b>${f.nuevo === null ? '—' : money(f.nuevo)}</b></td>
        <td class="n">${cambio}</td></tr>`;
    }).join('');
  }
  async function guardarCostos() {
    errorModal('ctCostoError', '');
    const cambios = Array.from(document.querySelectorAll('#ctCostoLista .ct-costo-chk:checked'))
      .map(c => S.costos[Number(c.getAttribute('data-ci'))])
      .filter(f => f && f.nuevo !== null)
      .map(f => ({ producto_id: String(f.id), costo: f.nuevo }));
    if (!cambios.length) { errorModal('ctCostoError', 'Marca al menos un producto (o pulsa «Ahora no»).'); return; }
    await ocupado('ctCostoGuardar', 'Actualizando…', async () => {
      try {
        const n = await rpc('conta_actualizar_costos', { p_cambios: cambios });
        cambios.forEach(c => { const p = prodPorId(c.producto_id); if (p) p.costo = c.costo; });
        cerrarModal('ctCostoModal');
        toast(`✅ ${plural(Number(n) || cambios.length, 'costo actualizado', 'costos actualizados')} en el catálogo.`, 'success');
      } catch (e) { errorModal('ctCostoError', e.message); }
    });
  }

  // ─── Pestañas ──────────────────────────────────────────────────────────────
  function irTab(tab) {
    S.tab = tab;
    document.querySelectorAll('[data-ct-tab]').forEach(b => {
      const si = b.getAttribute('data-ct-tab') === tab;
      b.classList.toggle('vp-tab--activa', si);
      b.setAttribute('aria-selected', si ? 'true' : 'false');
    });
    [['pagar', 'ctPanelPagar'], ['recepcion', 'ctPanelRecepcion'], ['proveedores', 'ctPanelProveedores']]
      .forEach(([t, id]) => { const el = $(id); if (el) el.hidden = t !== tab; });
  }

  // ─── Modales ───────────────────────────────────────────────────────────────
  function abrirModal(id) { $(id)?.classList.remove('hidden'); }
  function cerrarModal(id) { $(id)?.classList.add('hidden'); }
  function errorModal(id, msg) { const e = $(id); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }

  /* Botón ocupado mientras la base contesta (evita dobles clics). */
  async function ocupado(btnId, textoOcupado, fn) {
    const btn = $(btnId);
    const html = btn ? btn.innerHTML : '';
    if (btn) { if (btn.disabled) return; btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${textoOcupado}`; }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = html; } }
  }

  // Proveedor
  function abrirProveedor(id) {
    const p = id ? provPorId(id) : null;
    S.provEdit = p ? p.id : null;
    $('ctProvTitulo').innerHTML = p ? '<i class="fas fa-pen"></i> Editar proveedor' : '<i class="fas fa-building"></i> Nuevo proveedor';
    const v = k => (p && p[k] != null ? p[k] : '');
    $('ctProvNombre').value        = v('nombre');
    $('ctProvRepresentante').value = v('representante');
    $('ctProvRnc').value           = v('rnc');
    $('ctProvTel').value           = v('telefonos');
    $('ctProvCorreo').value        = v('correo');
    $('ctProvDireccion').value     = v('direccion');
    $('ctProvSector').value        = v('sector');
    $('ctProvCiudad').value        = v('ciudad');
    $('ctProvProvincia').value     = v('provincia');
    $('ctProvCp').value            = v('codigo_postal');
    $('ctProvTermino').value       = p ? p.termino_dias : 30;
    $('ctProvDescInv').value       = p && Number(p.descuento_invisible) > 0 ? String(Number(p.descuento_invisible)) : '';
    $('ctProvNotas').value         = v('notas');
    // 561 · lo guardado antes también se ve con sus guiones
    $('ctProvRnc').value = formatoRnc($('ctProvRnc').value) || $('ctProvRnc').value;
    $('ctProvTel').value = formatoTel($('ctProvTel').value);
    cerrarSugDir(); ayudaDir(''); nuevaSesionDir();
    ayudaCp();
    errorModal('ctProvError', '');
    abrirModal('ctProvModal');
    setTimeout(() => $('ctProvNombre')?.focus(), 50);
  }
  /* Al elegir la provincia se pone su código postal. Si el empleado ya había
   * escrito otro a mano, NO se pisa (solo se cambia si estaba vacío o era el
   * código automático de la provincia anterior). */
  let _cpAuto = '';
  function elegirProvincia() {
    const prov = $('ctProvProvincia').value;
    const cpEl = $('ctProvCp');
    const nuevo = cpDe(prov);
    const actual = cpEl.value.trim();
    if (!actual || actual === _cpAuto) cpEl.value = nuevo;
    _cpAuto = nuevo;
    ayudaCp();
    if (!nuevo && CP_POR_SECTOR[prov]) cpEl.focus();
  }
  function ayudaCp() {
    const prov = $('ctProvProvincia').value;
    _cpAuto = cpDe(prov);
    const el = $('ctProvCpAyuda');
    if (!el) return;
    el.classList.toggle('ct-ayuda--aviso', !!CP_POR_SECTOR[prov]);
    el.textContent = CP_POR_SECTOR[prov]
      ? `En ${prov} el código cambia según el sector (${CP_POR_SECTOR[prov]}): escríbelo.`
      : (prov ? `Código de ${prov}. Puedes cambiarlo si el sector tiene otro.` : '');
  }

  // ─── 561 · Guiones automáticos: se escriben solo los números ─────────────────
  const soloDig = s => String(s || '').replace(/\D/g, '');
  /* RNC de 9 cifras → 1-01-00369-3 · cédula de 11 → 001-0000000-1. Mientras se
   * escribe se va poniendo el guion que toca. */
  function formatoRnc(v) {
    const d = soloDig(v).slice(0, 11);
    if (d.length <= 9) {
      return [d.slice(0, 1), d.slice(1, 3), d.slice(3, 8), d.slice(8, 9)].filter(Boolean).join('-');
    }
    return [d.slice(0, 3), d.slice(3, 10), d.slice(10, 11)].filter(Boolean).join('-');
  }
  /* Teléfonos: cada 10 cifras es un teléfono 809-227-3000; el siguiente va
   * detrás de « / ». Si el texto trae letras (p. ej. «ext. 12») no se toca. */
  const TEL_SOLO_NUM = /^[\d\s\-\/().+]*$/;
  function formatoTel(v) {
    if (!TEL_SOLO_NUM.test(v)) return v;
    const d = soloDig(v);
    const tels = [];
    for (let i = 0; i < d.length; i += 10) {
      const t = d.slice(i, i + 10);
      tels.push([t.slice(0, 3), t.slice(3, 6), t.slice(6, 10)].filter(Boolean).join('-'));
    }
    return tels.join(' / ');
  }
  function rncValido(v) { const n = soloDig(v).length; return !v.trim() || n === 9 || n === 11; }
  function telValido(v) { return !v.trim() || !TEL_SOLO_NUM.test(v) || soloDig(v).length % 10 === 0; }

  /* Pone el formato sin que el cursor salte: se cuenta cuántas cifras había
   * antes del cursor y se deja detrás de esas mismas cifras. Borrar sobre un
   * guion borra la cifra de antes (si no, el guion volvería y parecería que
   * la tecla no hace nada). */
  function mascara(el, formatear) {
    const aplicar = () => {
      const v = el.value, pos = el.selectionStart == null ? v.length : el.selectionStart;
      const cifras = soloDig(v.slice(0, pos)).length;
      const nuevo = formatear(v);
      if (nuevo === v) return;
      el.value = nuevo;
      let p = 0, vistas = 0;
      while (p < nuevo.length && vistas < cifras) { if (/\d/.test(nuevo[p])) vistas++; p++; }
      if (document.activeElement === el) el.setSelectionRange(p, p);
    };
    el.addEventListener('keydown', ev => {
      if (ev.key !== 'Backspace' || el.selectionStart !== el.selectionEnd) return;
      const pos = el.selectionStart, v = el.value;
      if (pos > 0 && /[\s\-\/]/.test(v[pos - 1]) && TEL_SOLO_NUM.test(v)) {
        let q = pos - 1;
        while (q > 0 && /[\s\-\/]/.test(v[q - 1])) q--;
        if (q > 0) {
          ev.preventDefault();
          el.value = v.slice(0, q - 1) + v.slice(pos);
          el.setSelectionRange(q - 1, q - 1);
          aplicar();
        }
      }
    });
    el.addEventListener('input', aplicar);
    return aplicar;
  }

  // ─── 561 · Dirección con sugerencias de Google Maps (functions/api/direccion.js) ─
  const DIR = { sesion: '', timer: null, pedido: 0, lista: [], activo: -1, apagado: false };
  const nuevaSesionDir = () => {
    DIR.sesion = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'cm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  };
  function ayudaDir(msg, aviso) {
    const el = $('ctProvDirAyuda');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('ct-ayuda--aviso', !!aviso);
  }
  function cerrarSugDir() {
    const box = $('ctProvDirSug');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    $('ctProvDireccion')?.setAttribute('aria-expanded', 'false');
    DIR.lista = []; DIR.activo = -1;
  }
  async function pedirDir(cuerpo) {
    const res = await fetch('/api/direccion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CM-Vale': vale() },
      body: JSON.stringify(Object.assign({ sesion: DIR.sesion }, cuerpo)),
    });
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if ((res.status === 404 || res.status === 405) && !(j && j.error)) {
      throw Object.assign(new Error('Las sugerencias de Google Maps aún no están publicadas (falta subir functions/api/direccion.js). Escribe la dirección a mano.'), { apagar: true });
    }
    if (!res.ok || !j || !j.ok) {
      throw Object.assign(new Error((j && j.error) || `Google Maps no respondió (${res.status}).`), { apagar: !!(j && j.sinClave) });
    }
    return j;
  }
  function pintarSugDir() {
    const box = $('ctProvDirSug');
    if (!box) return;
    if (!DIR.lista.length) { cerrarSugDir(); return; }
    box.innerHTML = DIR.lista.map((s, i) => `
      <button type="button" class="ct-dir__op${i === DIR.activo ? ' ct-dir__op--activa' : ''}" role="option" aria-selected="${i === DIR.activo}" data-dir="${i}">
        <i class="fas fa-location-dot"></i>
        <span><b>${esc(s.principal)}</b>${s.secundario ? `<small>${esc(s.secundario)}</small>` : ''}</span>
      </button>`).join('') +
      '<div class="ct-dir__pie">Sugerencias de Google Maps · elige la tuya o sigue escribiendo</div>';
    box.hidden = false;
    $('ctProvDireccion').setAttribute('aria-expanded', 'true');
  }
  function buscarDir() {
    clearTimeout(DIR.timer);
    if (DIR.apagado) return;
    const q = $('ctProvDireccion').value.trim();
    if (q.length < 3) { cerrarSugDir(); return; }
    DIR.timer = setTimeout(async () => {
      const mio = ++DIR.pedido;
      if (!DIR.sesion) nuevaSesionDir();
      try {
        const j = await pedirDir({ accion: 'buscar', texto: q });
        if (mio !== DIR.pedido) return;   // llegó tarde: ya se escribió otra cosa
        DIR.lista = Array.isArray(j.sugerencias) ? j.sugerencias : [];
        DIR.activo = -1;
        pintarSugDir();
        ayudaDir(DIR.lista.length ? '' : 'Google Maps no encuentra esa dirección: puedes escribirla a mano.');
      } catch (e) {
        if (mio !== DIR.pedido) return;
        cerrarSugDir();
        if (e.apagar) DIR.apagado = true;
        ayudaDir(e.message, true);
      }
    }, 350);
  }
  /* «Provincia de Hato Mayor», «Hato Mayor Province»… → «Hato Mayor». */
  function provinciaDe(txt) {
    const n = norm(String(txt || '').replace(/^provincia\s+(de\s+)?/i, '').replace(/\s+province$/i, ''));
    if (!n) return '';
    const exacta = PROVINCIAS.find(p => norm(p[0]) === n);
    if (exacta) return exacta[0];
    const parecida = PROVINCIAS.filter(p => n.includes(norm(p[0]))).sort((a, b) => b[0].length - a[0].length)[0];
    return parecida ? parecida[0] : '';
  }
  async function elegirDir(i) {
    const s = DIR.lista[i];
    if (!s) return;
    cerrarSugDir();
    clearTimeout(DIR.timer); DIR.pedido++;
    ayudaDir('Completando la dirección con Google Maps…');
    try {
      const j = await pedirDir({ accion: 'detalle', id: s.id });
      const L = j.lugar || {};
      if (L.direccion) $('ctProvDireccion').value = String(L.direccion).slice(0, 200);
      if (L.sector) $('ctProvSector').value = String(L.sector).slice(0, 80);
      if (L.ciudad) $('ctProvCiudad').value = String(L.ciudad).slice(0, 80);
      const prov = provinciaDe(L.provincia);
      if (prov) { $('ctProvProvincia').value = prov; elegirProvincia(); }
      if (/^\d{5}$/.test(L.codigo_postal || '')) { $('ctProvCp').value = L.codigo_postal; ayudaCp(); }
      const faltan = [!$('ctProvSector').value.trim() && 'sector', !$('ctProvCiudad').value.trim() && 'ciudad',
        !$('ctProvProvincia').value && 'provincia', !$('ctProvCp').value.trim() && 'código postal'].filter(Boolean);
      ayudaDir(faltan.length
        ? `Rellenado con Google Maps. Google no trae: ${faltan.join(', ')}; complétalo a mano.`
        : 'Rellenado con Google Maps. Revísalo antes de guardar.', faltan.length > 0);
    } catch (e) {
      if (e.apagar) DIR.apagado = true;
      ayudaDir(e.message, true);
    } finally {
      nuevaSesionDir();   // cada dirección elegida cierra su sesión de Google
    }
  }
  function teclaDir(ev) {
    const box = $('ctProvDirSug');
    if (!box || box.hidden || !DIR.lista.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = DIR.lista.length;
      DIR.activo = ev.key === 'ArrowDown' ? (DIR.activo + 1) % n : (DIR.activo - 1 + n) % n;
      pintarSugDir();
    } else if (ev.key === 'Enter' && DIR.activo >= 0) {
      ev.preventDefault();
      elegirDir(DIR.activo);
    } else if (ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
      cerrarSugDir();
    }
  }

  async function guardarProveedor() {
    const nombre = $('ctProvNombre').value.trim();
    const term = num($('ctProvTermino').value);
    const correo = $('ctProvCorreo').value.trim().toLowerCase();
    const provincia = $('ctProvProvincia').value;
    const cp = $('ctProvCp').value.trim();
    if (!nombre) { errorModal('ctProvError', ERRORES.FALTA_NOMBRE); $('ctProvNombre').focus(); return; }
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { errorModal('ctProvError', ERRORES.CORREO_INVALIDO); $('ctProvCorreo').focus(); return; }
    if (!rncValido($('ctProvRnc').value)) { errorModal('ctProvError', ERRORES.RNC_INVALIDO); $('ctProvRnc').focus(); return; }
    if (!telValido($('ctProvTel').value)) { errorModal('ctProvError', ERRORES.TEL_INVALIDO); $('ctProvTel').focus(); return; }
    if (provincia && !PROVINCIAS.some(p => p[0] === provincia)) { errorModal('ctProvError', ERRORES.PROVINCIA_INVALIDA); return; }
    if (cp && !/^\d{5}$/.test(cp)) { errorModal('ctProvError', ERRORES.CODIGO_POSTAL_INVALIDO); $('ctProvCp').focus(); return; }
    if (term === null || isNaN(term) || term < 0 || term > 365 || term !== Math.trunc(term)) {
      errorModal('ctProvError', ERRORES.TERMINO_INVALIDO); return;
    }
    // 563/119 · descuento invisible: vacío = 0
    const dInv = num($('ctProvDescInv').value);
    if (dInv !== null && (isNaN(dInv) || dInv < 0 || dInv > 20)) {
      errorModal('ctProvError', ERRORES.DESCUENTO_INVALIDO); $('ctProvDescInv').focus(); return;
    }
    await ocupado('ctProvGuardar', 'Guardando…', async () => {
      try {
        await rpc('conta_guardar_proveedor', {
          p_id: S.provEdit,
          p_datos: {
            nombre, termino_dias: term,
            representante: $('ctProvRepresentante').value.trim(),
            rnc: $('ctProvRnc').value.trim(),
            telefonos: $('ctProvTel').value.trim(),
            correo,
            direccion: $('ctProvDireccion').value.trim(),
            sector: $('ctProvSector').value.trim(),
            ciudad: $('ctProvCiudad').value.trim(),
            provincia, codigo_postal: cp,
            notas: $('ctProvNotas').value.trim(),
            descuento_invisible: dInv === null ? 0 : r2(dInv),
          },
        });
        cerrarModal('ctProvModal');
        toast(S.provEdit ? `✅ Proveedor «${nombre}» actualizado.` : `✅ Proveedor «${nombre}» dado de alta.`, 'success');
        await cargar();
      } catch (e) { errorModal('ctProvError', e.message); }
    });
  }
  async function bajaProveedor(id) {
    const p = provPorId(id);
    if (!p) return;
    if (Number(p.pendientes) > 0) { toast(ERRORES.PROVEEDOR_CON_DEUDA, 'warn'); return; }
    if (!confirm(`¿Dar de baja al proveedor «${p.nombre}»?\n\nSus facturas pagadas y recepciones se conservan como historial.`)) return;
    try {
      await rpc('conta_borrar_proveedor', { p_id: p.id });
      toast(`Proveedor «${p.nombre}» dado de baja.`, 'info');
      await cargar();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Factura a mano
  function abrirFactura(id) {
    const f = id ? S.fac.find(x => String(x.id) === String(id)) : null;
    if (!S.prov.length) { toast('Primero da de alta el proveedor en la pestaña «Proveedores».', 'warn'); return; }
    S.facEdit = f ? f.id : null;
    S.venEditado = !!f;
    $('ctFacTitulo').innerHTML = f ? '<i class="fas fa-pen"></i> Editar factura' : '<i class="fas fa-file-invoice-dollar"></i> Nueva factura por pagar';
    pintarSelects();
    $('ctFacModalProv').value = f ? f.proveedor_id : ($('ctFacProv')?.value || '');
    $('ctFacNumero').value  = f ? f.numero : '';
    $('ctFacEmision').value = f ? f.fecha_emision : hoy();
    $('ctFacVence').value   = f ? f.fecha_vencimiento : '';
    $('ctFacMonto').value   = f ? f.monto : '';
    $('ctFacPct').value     = f && Number(f.pronto_pago_pct) ? f.pronto_pago_pct : '';
    $('ctFacDias').value    = f && Number(f.pronto_pago_dias) ? f.pronto_pago_dias : '';
    $('ctFacNotas').value   = f ? f.notas : '';
    $('ctFacNcf').value     = f ? (f.ncf || '') : '';
    errorModal('ctFacError', '');
    autoVencimiento();
    abrirModal('ctFacModal');
    setTimeout(() => $(f ? 'ctFacMonto' : ($('ctFacModalProv').value ? 'ctFacNumero' : 'ctFacModalProv'))?.focus(), 50);
  }
  function autoVencimiento() {
    const p = provPorId($('ctFacModalProv').value);
    const emi = $('ctFacEmision').value;
    const ayuda = $('ctFacVenceAyuda');
    if (p && emi && !S.venEditado) $('ctFacVence').value = sumarDias(emi, p.termino_dias);
    if (ayuda) ayuda.textContent = p ? `Término de ${p.nombre}: ${plural(Number(p.termino_dias), 'día', 'días')}. Se calcula solo; puedes cambiarlo.` : 'Se calcula solo: emisión + término del proveedor.';
  }
  function leerProntoPago(idPct, idDias) {
    const pct = num($(idPct).value), dias = num($(idDias).value);
    if ((pct !== null && (isNaN(pct) || pct < 0 || pct > 100)) ||
        (dias !== null && (isNaN(dias) || dias < 0 || dias > 365 || dias !== Math.trunc(dias)))) {
      throw new Error(ERRORES.PRONTO_PAGO_INVALIDO);
    }
    if (((pct || 0) > 0) !== ((dias || 0) > 0)) throw new Error(ERRORES.PRONTO_PAGO_INCOMPLETO);
    return { pct: pct || 0, dias: dias || 0 };
  }
  async function guardarFactura() {
    const prov = $('ctFacModalProv').value;
    const numero = $('ctFacNumero').value.trim();
    const emi = $('ctFacEmision').value;
    const ven = $('ctFacVence').value;
    const monto = num($('ctFacMonto').value);
    const ncf = limpiarNcf($('ctFacNcf').value);
    let pp;
    try {
      if (!ncfValido(ncf)) { $('ctFacNcf').focus(); throw new Error(ERRORES.NCF_INVALIDO); }
      if (!prov) throw new Error('Elige el proveedor.');
      if (!numero) throw new Error(ERRORES.FALTA_NUMERO);
      if (!emi) throw new Error(ERRORES.FALTA_FECHA);
      if (ven && ven < emi) throw new Error(ERRORES.VENCIMIENTO_INVALIDO);
      if (monto === null || isNaN(monto) || monto <= 0) throw new Error(ERRORES.MONTO_INVALIDO);
      pp = leerProntoPago('ctFacPct', 'ctFacDias');
    } catch (e) { errorModal('ctFacError', e.message); return; }
    await ocupado('ctFacGuardar', 'Guardando…', async () => {
      try {
        await rpc('conta_guardar_factura', {
          p_id: S.facEdit,
          p_datos: {
            proveedor_id: prov, numero, fecha_emision: emi, fecha_vencimiento: ven || '',
            monto: r2(monto), pronto_pago_pct: pp.pct, pronto_pago_dias: pp.dias,
            notas: $('ctFacNotas').value.trim(),
            ncf,
          },
        });
        cerrarModal('ctFacModal');
        toast(S.facEdit ? `✅ Factura ${numero} actualizada.` : `✅ Factura ${numero} registrada.`, 'success');
        await cargar();
      } catch (e) { errorModal('ctFacError', e.message); }
    });
  }
  async function borrarFactura(id) {
    const f = S.fac.find(x => String(x.id) === String(id));
    if (!f) return;
    const extra = f.recepcion_id ? '\n\nLa recepción de mercancía se conserva en el historial.' : '';
    if (!confirm(`¿Borrar la factura ${f.numero} de ${f.proveedor_nombre} (${money(f.monto)})?${extra}`)) return;
    try {
      await rpc('conta_borrar_factura', { p_id: f.id });
      toast(`Factura ${f.numero} borrada.`, 'info');
      await cargar();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Pago (de una vez)
  /* 555 · Se paga monto − crédito; el pronto pago se calcula sobre eso. */
  function montoAPagar(f, fecha) {
    const base = aPagarDe(f);
    const pct = Number(f.pronto_pago_pct) || 0;
    if (pct > 0 && fecha && f.pronto_pago_hasta && fecha <= f.pronto_pago_hasta) return r2(base * (1 - pct / 100));
    return r2(base);
  }
  function abrirPago(id) {
    const f = S.fac.find(x => String(x.id) === String(id));
    if (!f || f.pagada) return;
    S.pagoId = f.id;
    $('ctPagoInfo').innerHTML = `
      <div class="ct-pago__fila"><span>Factura</span><b>${esc(f.numero)}</b></div>
      <div class="ct-pago__fila"><span>Proveedor</span><b>${esc(f.proveedor_nombre)}</b></div>
      <div class="ct-pago__fila"><span>Emisión · vencimiento</span><b>${fFecha(f.fecha_emision)} · ${fFecha(f.fecha_vencimiento)}</b></div>
      <div class="ct-pago__fila"><span>Monto de la factura</span><b>${money(f.monto)}</b></div>${creditoDe(f) > 0 ? `
      <div class="ct-pago__fila ct-pago__fila--cred"><span>Crédito (mercancía no recibida)</span><b>− ${money(creditoDe(f))}</b></div>
      <div class="ct-pago__fila"><span>Lo que se debe</span><b>${money(aPagarDe(f))}</b></div>` : ''}`;
    const fe = $('ctPagoFecha');
    fe.value = hoy(); fe.max = hoy(); fe.min = f.fecha_emision;
    // 553g · el método se elige cada vez (nada marcado de antemano)
    document.querySelectorAll('input[name="ctPagoMetodo"]').forEach(r => { r.checked = false; });
    $('ctPagoNumero').value = '';
    $('ctPagoBanco').value = '';
    elegirMetodo();
    errorModal('ctPagoError', '');
    calcPago();
    abrirModal('ctPagoModal');
  }
  function metodoElegido() {
    const r = document.querySelector('input[name="ctPagoMetodo"]:checked');
    return r ? r.value : '';
  }
  /* Cheque y transferencia piden nº y banco; efectivo no. */
  function elegirMetodo() {
    const m = metodoElegido();
    const conBanco = m === 'cheque' || m === 'transferencia';
    $('ctPagoBancoBox').hidden = !conBanco;
    $('ctPagoNumeroLbl').innerHTML = (m === 'transferencia' ? 'Nº de transferencia' : 'Nº de cheque') + ' <span class="req">*</span>';
    $('ctPagoNumero').placeholder = m === 'transferencia' ? 'Ej: 0012345678' : 'Ej: 004512';
    document.querySelectorAll('.ct-metodo').forEach(l => l.classList.toggle('ct-metodo--sel', !!l.querySelector('input:checked')));
    errorModal('ctPagoError', '');
  }
  function calcPago() {
    const f = S.fac.find(x => String(x.id) === String(S.pagoId));
    if (!f) return;
    const fecha = $('ctPagoFecha').value;
    const pagar = montoAPagar(f, fecha);
    const pct = Number(f.pronto_pago_pct) || 0;
    $('ctPagoMonto').textContent = money(pagar);
    const base = aPagarDe(f);
    const conCred = creditoDe(f) > 0;
    let nota = conCred
      ? `Se paga de una vez, ya descontado el crédito de ${money(creditoDe(f))}.`
      : 'Se paga el monto completo, de una vez.';
    if (pct > 0) {
      nota = pagar < base
        ? `✅ Dentro del pronto pago (${pct} % hasta el ${fFecha(f.pronto_pago_hasta)}): ahorras ${money(base - pagar)}.`
        : `El pronto pago (${pct} %) era hasta el ${fFecha(f.pronto_pago_hasta)}: se paga ${conCred ? 'lo que se debe' : 'el monto completo'}.`;
    }
    $('ctPagoNota').textContent = nota;
  }
  async function confirmarPago() {
    const f = S.fac.find(x => String(x.id) === String(S.pagoId));
    if (!f) return;
    const fecha = $('ctPagoFecha').value;
    if (!fecha) { errorModal('ctPagoError', 'Indica la fecha del pago.'); return; }
    if (fecha > hoy()) { errorModal('ctPagoError', ERRORES.FECHA_PAGO_FUTURA); return; }
    if (fecha < f.fecha_emision) { errorModal('ctPagoError', ERRORES.FECHA_PAGO_INVALIDA); return; }
    const metodo = metodoElegido();
    const numero = $('ctPagoNumero').value.trim();
    const banco = $('ctPagoBanco').value;
    if (!metodo) { errorModal('ctPagoError', ERRORES.METODO_PAGO_INVALIDO); document.querySelector('input[name="ctPagoMetodo"]')?.focus(); return; }
    if (metodo !== 'efectivo') {
      if (!numero) { errorModal('ctPagoError', ERRORES.FALTA_NUMERO_PAGO); $('ctPagoNumero').focus(); return; }
      if (!BANCOS.includes(banco)) { errorModal('ctPagoError', ERRORES.BANCO_INVALIDO); $('ctPagoBanco').focus(); return; }
    }
    await ocupado('ctPagoConfirmar', 'Guardando…', async () => {
      try {
        const pagado = await rpc('conta_pagar_factura', {
          p_id: f.id, p_fecha: fecha, p_metodo: metodo,
          p_numero: metodo === 'efectivo' ? null : numero,
          p_banco: metodo === 'efectivo' ? null : banco,
        });
        cerrarModal('ctPagoModal');
        toast(`✅ Factura ${f.numero} pagada: ${money(pagado)} · ${esc(textoMetodo({ metodo_pago: metodo, pago_numero: numero, pago_banco: banco }))}.`, 'success');
        await cargar();
      } catch (e) { errorModal('ctPagoError', e.message); }
    });
  }
  async function anularPago(id) {
    const f = S.fac.find(x => String(x.id) === String(id));
    if (!f || !f.pagada) return;
    if (!confirm(`¿Anular el pago de la factura ${f.numero} (${money(f.monto_pagado)} el ${fFecha(f.fecha_pago)})?\n\nVolverá a quedar pendiente.`)) return;
    try {
      await rpc('conta_anular_pago', { p_id: f.id });
      toast(`Pago de la factura ${f.numero} anulado.`, 'info');
      await cargar();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Recepción de mercancía ───────────────────────────────────────────────
  const VIA = {
    referencia: 'por referencia del proveedor',
    codigo:     'por código de barras',
    elegido:    'emparejado a mano',
    catalogo:   'añadido del catálogo',
    guardado:   'guardado en la recepción',
  };

  function norm(s) {
    return typeof _admNorm === 'function' ? _admNorm(s)
      : String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function mismoCodigo(a, b) {
    a = String(a || '').trim().toUpperCase().replace(/\s/g, '');
    b = String(b || '').trim().toUpperCase().replace(/\s/g, '');
    if (!a || !b) return false;
    if (a === b) return true;
    // UPC-A de 12 impreso como EAN-13 con un 0 delante (y al revés)
    return /^\d+$/.test(a) && /^\d+$/.test(b) && a.replace(/^0+/, '') === b.replace(/^0+/, '');
  }
  function esBarcodeDe(p, cod) {
    return !!p && (mismoCodigo(p.barcode, cod) || mismoCodigo(p.barcode_alt, cod));
  }

  /* Empareja una línea que el empleado no haya decidido a mano.
   * SOLO por código: referencia del proveedor y, si no, código de barras. */
  function autoEmparejar(l) {
    if (l.manual) return;
    l.producto_id = null; l.via = '';
    const cod = String(l.codigo || '').trim();
    if (!cod) return;
    const R = window.CasaMotaRefs;
    const idRef = R ? R.productoDe($('ctRecProv')?.value || '', cod) : null;
    if (idRef && prodPorId(idRef)) { l.producto_id = idRef; l.via = 'referencia'; return; }
    const p = productos().find(x => esBarcodeDe(x, cod));
    if (p) { l.producto_id = p.id; l.via = 'codigo'; }
  }

  /* Al confirmar: la línea emparejada A MANO que trae un código que no es el
   * de barras del producto queda guardada como referencia del proveedor. */
  function guardaReferencia(l) {
    const cod = String(l.codigo || '').trim();
    return !!(l.producto_id && l.via === 'elegido' && cod && !esBarcodeDe(prodPorId(l.producto_id), cod));
  }

  function importe(l) {
    const c = num(l.cantidad), k = num(l.costo);
    if (c === null || k === null || isNaN(c) || isNaN(k)) return 0;
    return r2(r3(c) * r2(k));
  }

  /* Debajo del código: «No emparejado» si la línea no casa con el catálogo. */
  function estadoCodigo(l) {
    if (l.producto_id) {
      return guardaReferencia(l)
        ? '<small class="ct-ref-nueva" title="Al confirmar se guarda en la ficha del producto"><i class="fas fa-bookmark"></i> se guardará como referencia</small>'
        : '';
    }
    return '<span class="ct-noemp">No emparejado</span>';
  }

  function celdaProducto(l, i) {
    if (l.producto_id) {
      const p = prodPorId(l.producto_id);
      return `<div class="ct-prod">
        <span class="ct-prod__ok"><i class="fas fa-circle-check"></i> ${esc(p ? p.name : '(producto)')}</span>
        <small>${VIA[l.via] || ''}${p && p.unit ? ' · ' + esc(p.unit) : ''}</small>
        <span class="ct-prod__btns">
          <button type="button" class="ct-link" data-act="emparejar" data-i="${i}">Cambiar</button>
          <button type="button" class="ct-link ct-link--rojo" data-act="soltar" data-i="${i}">Quitar emparejamiento</button>
        </span></div>`;
    }
    return `<div class="ct-prod">
      <span class="ct-gris">—</span>
      <span class="ct-prod__btns"><button type="button" class="ct-link" data-act="emparejar" data-i="${i}">Emparejar</button></span>
    </div>`;
  }

  /* 562 · Debajo de la cantidad leída por la IA: si se corrigió con los
   * importes de la factura, o si hay que revisarla (= empaque de la caja). */
  function notaCantidad(l) {
    const caja = Number(l.empaque) > 1 ? ` (caja de ${l.empaque})` : '';
    if (l.iaNota === 'corregida') return `<small class="ct-cant-nota" title="La IA leyó otra cantidad; se corrigió con el importe impreso de la línea"><i class="fas fa-wrench"></i> corregida${caja}</small>`;
    if (l.iaNota === 'revisar') return `<small class="ct-cant-nota ct-cant-nota--aviso" title="La cantidad coincide con el empaque de la caja: puede que la IA lo haya tomado como cantidad"><i class="fas fa-triangle-exclamation"></i> revisa${caja}</small>`;
    return '';
  }

  /* 563 · Método de costeo: el entregable es el COSTO POR UNIDAD.
   * 564 · «El costo del artículo es lo que se paga por él, impuesto incluido.
   * Si la factura imprime el ITBIS aparte, se suma. Una sola vez.»
   *   unidades = cantidad × und/caja
   *   costo por unidad = (importe sin ITBIS + ITBIS impreso de la línea) ÷ unidades
   * Caso B (precio impreso CON ITBIS, p. ej. Carbec): el lector ya separa la
   * base y el ITBIS, así que la misma fórmula devuelve el precio impreso.
   * 119 · Descuento invisible del proveedor (ficha): se resta de la BASE una
   * sola vez y el ITBIS impreso queda intacto:
   *   (importe × (1 − d/100) + ITBIS) ÷ unidades  — misma fórmula que la base.
   * Se calcula con todos los decimales y se redondea solo al mostrar. Si falta
   * und/caja o el ITBIS de la línea, queda «Pendiente»: no se inventa. */
  function descInvisible() {
    const p = provPorId($('ctRecProv')?.value);
    const d = Number(p && p.descuento_invisible);
    return d > 0 && d <= 20 ? d : 0;
  }
  /* 565 · PROMOCIONES (se licúan siempre). Una línea en 0.00 que repite un
   * producto COBRADO es un regalo: sus unidades se suman a las de la línea
   * cobrada y lo pagado se reparte entre todas (salami 30 + 3 → 2,310 ÷ 33).
   * Mismo producto = mismo producto emparejado o, si no, mismo código o
   * misma descripción exacta. Nunca entre productos distintos. Una línea en
   * 0.00 que no repite nada cobrado (envases en préstamo…) NO se licúa. */
  const txtIgual = s => norm(String(s || '')).replace(/\s+/g, ' ');
  function mismoProducto(a, b) {
    if (a.producto_id && b.producto_id) return String(a.producto_id) === String(b.producto_id);
    const ca = String(a.codigo || '').trim().toUpperCase(), cb = String(b.codigo || '').trim().toUpperCase();
    if (ca && cb) return ca === cb;
    const da = txtIgual(a.descripcion), db = txtIgual(b.descripcion);
    return !!da && da === db;
  }
  const esCero = l => num(l.cantidad) > 0 && l.costo !== '' && !isNaN(num(l.costo)) && importe(l) === 0;
  function pagadaDe(l) {
    if (!esCero(l)) return -1;
    return S.lineas.findIndex(p => p !== l && importe(p) > 0 && mismoProducto(p, l));
  }
  function regalosDe(p) {
    return S.lineas.filter(g => g !== p && recibida(g) && esCero(g) && S.lineas[pagadaDe(g)] === p);
  }

  /* 565 · EXENTAS: la marca «E» (o ITBIS 0 marcado) se ACREDITA con el pie:
   * la base de esas líneas debe dar el «Total exento» de la factura. Si no
   * concilia, esas líneas quedan «Pendiente». Una casilla vacía no es exenta. */
  function estadoExentas() {
    const ex = S.lineas.filter(l => l.exenta);
    if (!ex.length) return { estado: 'ninguna' };
    const suma = r2(ex.reduce((a, l) => a + importe(l), 0));
    const pie = S.iaTot ? S.iaTot.exento : null;
    if (pie === null || pie === undefined) return { estado: 'sin_pie', suma, n: ex.length };
    return { estado: Math.abs(suma - pie) < 1 ? 'si' : 'no', suma, pie, n: ex.length };
  }

  function costoUnidad(l) {
    const c = num(l.cantidad), e = num(l.empaque), it = num(l.itbis);
    if (!(c > 0) || l.costo === '' || isNaN(num(l.costo))) return { motivo: 'falta cantidad o costo' };
    if (esCero(l)) {   // 565 · regalo: toma el costo licuado de la línea cobrada
      const j = pagadaDe(l);
      if (j < 0) return { motivo: 'sin costo: no se licúa', cero: true };
      const cp = costoUnidad(S.lineas[j]);
      if (cp.valor === undefined) return { motivo: 'regalo: falta el costo de la línea cobrada', regalo: j };
      return { valor: cp.valor, regalo: j };
    }
    if (e === null || isNaN(e) || e < 1) return { motivo: 'falta und/caja' };
    if (it === null || isNaN(it) || it < 0) return { motivo: 'falta el ITBIS de la línea' };
    if (l.exenta && estadoExentas().estado === 'no') return { motivo: 'exenta sin acreditar por el pie' };
    const unidP = r3(c) * e;
    const extra = regalosDe(l).reduce((a, g) => a + r3(num(g.cantidad)) * (num(g.empaque) >= 1 ? num(g.empaque) : e), 0);
    const d = descInvisible();
    const base = importe(l) * (1 - d / 100) + it;
    return { valor: base / (unidP + extra), unid: unidP + extra, unidP, extra, sinLicuar: extra ? base / unidP : null, d };
  }
  function celdaCostoUnidad(l) {
    const cu = costoUnidad(l);
    if (cu.cero) return `<span class="ct-gris">—</span><small class="ct-cu-nota" title="Línea en 0.00 que no repite ningún producto cobrado (envase, etc.)">${esc(cu.motivo)}</small>`;
    const reg = cu.regalo !== undefined
      ? `<small class="ct-cu-nota"><span class="ct-regalo">Regalo</span> se licúa con «${esc(String(S.lineas[cu.regalo].descripcion || S.lineas[cu.regalo].codigo || '').slice(0, 22))}»</small>` : '';
    if (cu.valor === undefined) return `<span class="ct-pend" title="${esc(cu.motivo)}">Pendiente</span><small class="ct-cu-nota">${esc(cu.motivo)}</small>${reg}`;
    if (cu.regalo !== undefined) return `<b>${money(r2(cu.valor))}</b>${reg}`;
    const unid = cu.extra
      ? `${String(r3(cu.unid))} unid. (${String(r3(cu.unidP))} + ${String(r3(cu.extra))} regalo) · sin licuar ${money(r2(cu.sinLicuar))}`
      : `${String(r3(cu.unid))} unid.`;
    return `<b>${money(r2(cu.valor))}</b><small class="ct-cu-nota">${unid}${cu.d ? ` · −${cu.d} % inv.` : ''}</small>`;
  }
  /* Un cambio en una línea puede mover el costo de otra (regalos, exentas):
   * se repintan TODAS las celdas de costo por unidad sin tocar los campos. */
  function repintarCostos() {
    document.querySelectorAll('#ctRecLineas tr[data-i]').forEach(tr => {
      const l = S.lineas[Number(tr.getAttribute('data-i'))];
      const td = tr.querySelector('.ct-l__cu');
      if (l && td) td.innerHTML = celdaCostoUnidad(l);
    });
  }

  /* 553f · Factura pagada o borrada: solo se cambia el emparejamiento. */
  function soloEmparejar() { return !!(S.edit && S.edit.modo === 'solo_emparejar'); }

  /* 555 · ¿Llegó la mercancía de esta línea? Por defecto sí (también lo que
   * lee la IA). Lo NO recibido pasa a «Créditos disponibles». */
  const recibida = l => l.recibido !== false;
  function creditoRec() { return r2(S.lineas.filter(l => !recibida(l)).reduce((a, l) => a + importe(l), 0)); }

  function pintarLineas() {
    const tb = $('ctRecLineas');
    if (!tb) return;
    const dis = soloEmparejar() ? ' disabled' : '';
    pintarCreditos();
    const vis = S.lineas.map((l, i) => ({ l, i })).filter(x => recibida(x.l));
    if (!vis.length) {
      tb.innerHTML = `<tr><td colspan="13" class="myr-vacio">${S.lineas.length
        ? 'Todas las líneas están en <b>Créditos disponibles</b> (no recibidas).'
        : 'Añade productos del catálogo, una línea manual o lee la factura con IA.'}</td></tr>`;
      return;
    }
    tb.innerHTML = vis.map(({ l, i }, n) => `
      <tr data-i="${i}" class="${l.producto_id ? '' : 'ct-l--sin'}">
        <td class="ct-l__n">${n + 1}</td>
        <td class="ct-rc"><button type="button" class="ct-chk ct-chk--si ct-chk--on" data-act="recibido" data-i="${i}" title="Recibido" aria-label="Recibido" aria-pressed="true"${dis}><i class="fas fa-check"></i></button></td>
        <td class="ct-rc"><button type="button" class="ct-chk ct-chk--no" data-act="norecibido" data-i="${i}" title="Marcar como NO recibido: pasa a Créditos disponibles" aria-label="No recibido" aria-pressed="false"${dis}><i class="fas fa-xmark"></i></button></td>
        <td><input class="ct-in ct-in--cod" data-campo="codigo" data-i="${i}" value="${esc(l.codigo)}" maxlength="40" placeholder="Referencia"${dis} />
          <div class="ct-l__codest">${estadoCodigo(l)}</div></td>
        <td><input class="ct-in ct-in--desc" data-campo="descripcion" data-i="${i}" value="${esc(l.descripcion)}" maxlength="200" placeholder="Descripción"${dis} /></td>
        <td class="ct-l__prod">${celdaProducto(l, i)}</td>
        <td class="n"><input class="ct-in ct-in--num${l.iaNota === 'revisar' ? ' ct-in--revisar' : ''}" data-campo="cantidad" data-i="${i}" value="${esc(l.cantidad)}" inputmode="decimal" placeholder="0"${dis} />${notaCantidad(l)}</td>
        <td class="n"><input class="ct-in ct-in--num" data-campo="costo" data-i="${i}" value="${esc(l.costo)}" inputmode="decimal" placeholder="0.00"${dis} /></td>
        <td class="n ct-l__imp">${money(importe(l))}</td>
        <td class="n"><input class="ct-in ct-in--itb" data-campo="itbis" data-i="${i}" value="${esc(l.itbis)}" inputmode="decimal" placeholder="—" title="ITBIS impreso de la línea (0 solo si es exenta)"${dis} />${l.exenta ? '<small class="ct-cu-nota">exenta</small>' : (l.precioIncl ? '<small class="ct-cu-nota" title="El precio impreso ya traía el ITBIS: se separó en base + ITBIS">precio con ITBIS</small>' : '')}</td>
        <td class="n"><input class="ct-in ct-in--emp" data-campo="empaque" data-i="${i}" value="${esc(l.empaque)}" inputmode="numeric" placeholder="—" title="Unidades vendibles que trae cada caja/fardo (1 si se factura por unidad)"${dis} /></td>
        <td class="n ct-l__cu">${celdaCostoUnidad(l)}</td>
        <td>${dis ? '' : `<button type="button" class="action-btn action-btn-del" data-act="quitar" data-i="${i}" title="Quitar línea"><i class="fas fa-trash"></i></button>`}</td>
      </tr>`).join('');
  }

  /* Debajo del total: lo no recibido, con su valor, para descontar al pagar. */
  function pintarCreditos() {
    const box = $('ctRecCreditos');
    if (!box) return;
    const dis = soloEmparejar() ? ' disabled' : '';
    const no = S.lineas.map((l, i) => ({ l, i })).filter(x => !recibida(x.l));
    box.hidden = !no.length;
    if (!no.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <h4 class="ct-creditos__tit"><i class="fas fa-hand-holding-dollar"></i> Créditos disponibles
        <small>Mercancía facturada que NO se recibió: se descuenta al pagar esta factura.</small></h4>
      <div class="table-wrap"><table class="data-table ct-lineas ct-creditos__tabla">
        <thead><tr><th>Código</th><th class="n">Cantidad</th><th>Descripción</th><th class="n">Valor total</th><th></th></tr></thead>
        <tbody>${no.map(({ l, i }) => `
          <tr>
            <td>${esc(l.codigo) || '—'}</td>
            <td class="n">${esc(l.cantidad)}</td>
            <td>${esc(l.descripcion) || '—'}</td>
            <td class="n"><b>${money(importe(l))}</b></td>
            <td class="n"><button type="button" class="btn-secondary ct-btn-sm" data-act="recibido" data-i="${i}"${dis}><i class="fas fa-rotate-left"></i> Volver a recibido</button></td>
          </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3"><b>Total de créditos</b></td><td class="n"><b>${money(creditoRec())}</b></td><td></td></tr></tfoot>
      </table></div>`;
  }

  /* Marca una línea como recibida o no; la no recibida se va a Créditos. */
  function marcarRecibido(i, si) {
    const l = S.lineas[i];
    if (!l || soloEmparejar() || recibida(l) === si) return;
    l.recibido = si;
    pintarLineas();
    pintarTotalesRec();
  }

  function repintarCeldaProducto(i) {
    const tr = document.querySelector(`#ctRecLineas tr[data-i="${i}"]`);
    const l = S.lineas[i];
    if (!tr || !l) return;
    tr.classList.toggle('ct-l--sin', !l.producto_id);
    const td = tr.querySelector('.ct-l__prod');
    if (td) td.innerHTML = celdaProducto(l, i);
    const est = tr.querySelector('.ct-l__codest');
    if (est) est.innerHTML = estadoCodigo(l);
  }

  function totalesRec() {
    const suma = r2(S.lineas.reduce((a, l) => a + importe(l), 0));
    const t = num($('ctRecTotal')?.value);
    const total = (t === null || isNaN(t)) ? null : r2(t);
    return { suma, total, monto: total !== null ? total : suma };
  }

  function pintarTotalesRec() {
    const box = $('ctRecTotales');
    if (!box) return;
    const { suma, total, monto } = totalesRec();
    const sin = S.lineas.filter(l => !l.producto_id).length;
    const nNo = S.lineas.filter(l => !recibida(l)).length;
    const p = provPorId($('ctRecProv')?.value);
    const fecha = $('ctRecFecha')?.value;
    const dif = total !== null ? r2(total - suma) : 0;
    box.innerHTML = `
      <div><span>Líneas</span><b>${S.lineas.length}${sin ? ` <small class="ct-noemp-txt">(${sin} no emparejada${sin === 1 ? '' : 's'})</small>` : ''}${nNo ? ` <small class="ct-cred-txt">(${nNo} no recibida${nNo === 1 ? '' : 's'})</small>` : ''}</b></div>
      <div><span>Suma de las líneas</span><b>${money(suma)}</b></div>
      ${filasImpuesto(suma, total, dif)}
      ${filasCosteo()}
      ${pieFactura(monto, p, fecha)}`;
    const btn = $('ctRecConfirmar');
    if (btn && !S.guardando) btn.disabled = !S.lineas.length;
  }

  /* 558/559 · Entre la suma y el pie: desglose leído del pie de la factura
   * (subtotal, descuento, ITBIS) y avisos si no cuadra. Sin desglose leído,
   * lo que el total pasa de la suma es el ITBIS (558). Solo se muestra. */
  function filasImpuesto(suma, total, dif) {
    const T = S.iaTot;
    const fila = (t, v) => `<div><span>${t}</span><b>${v}</b></div>`;
    const aviso = (t, v) => `<div class="ct-dif"><span><i class="fas fa-triangle-exclamation"></i> ${t}</span>${v ? `<b>${v}</b>` : ''}</div>`;
    let h = '';
    if (T && T.subtotal !== null) h += fila('Subtotal de la factura', money(T.subtotal));
    if (T && T.descuento > 0) h += fila('Descuento de la factura', '− ' + money(T.descuento));
    if (T && T.itbis !== null) h += fila('ITBIS de la factura', money(T.itbis));
    if (total !== null) h += fila('Total escrito de la factura', money(total));
    if (!T || T.itbis === null) {
      if (total !== null && dif >= 0.01) h += fila('ITBIS de la factura', money(dif));
      if (total !== null && dif <= -0.01) h += aviso('El total es menor que la suma', money(dif));
      return h;
    }
    if (T.subtotal !== null && Math.abs(T.subtotal - suma) >= 1) {
      h += aviso(`La suma de las líneas no cuadra con el subtotal de la factura: revisa si falta alguna línea o algún precio.`, money(r2(suma - T.subtotal)));
    }
    const base = T.subtotal !== null ? T.subtotal : suma;
    const esperado = r2(base - (T.descuento || 0) + T.itbis);
    if (total !== null && Math.abs(esperado - total) >= 1) {
      h += aviso(`Subtotal − descuento + ITBIS da ${money(esperado)}, no el total: revisa el ITBIS con la foto.`);
    }
    return h;
  }

  /* 563 · ITBIS de las líneas contra el ITBIS del pie (comprobación por
   * columna del método) y cuántas líneas tienen el costo por unidad pendiente.
   * Se compara con TODAS las líneas facturadas (también las no recibidas):
   * el pie del proveedor las incluye. */
  function filasCosteo() {
    if (!S.lineas.length) return '';
    const conIt = S.lineas.filter(l => l.itbis !== '' && l.itbis !== undefined && !isNaN(num(l.itbis)));
    let h = '';
    if (conIt.length) {
      const sumIt = r2(conIt.reduce((a, l) => a + (num(l.itbis) || 0), 0));
      h += `<div><span>ITBIS de las líneas${conIt.length < S.lineas.length ? ` <small class="ct-gris">(${conIt.length} de ${S.lineas.length})</small>` : ''}</span><b>${money(sumIt)}</b></div>`;
      const pie = S.iaTot && S.iaTot.itbis;
      if (conIt.length === S.lineas.length && pie !== null && pie !== undefined && Math.abs(sumIt - pie) >= 1) {
        h += `<div class="ct-dif"><span><i class="fas fa-triangle-exclamation"></i> El ITBIS de las líneas no cuadra con el del pie (${money(pie)}): puede faltar una línea o una página.</span><b>${money(r2(sumIt - pie))}</b></div>`;
      }
    }
    // 565 · exentas acreditadas (o no) con el «Total exento» del pie
    const ex = estadoExentas();
    if (ex.estado === 'si') h += `<div><span><i class="fas fa-circle-check"></i> Exentas acreditadas con el pie</span><b>${money(ex.suma)}</b></div>`;
    else if (ex.estado === 'no') h += `<div class="ct-dif"><span><i class="fas fa-triangle-exclamation"></i> Las líneas exentas suman ${money(ex.suma)} y el «Total exento» del pie dice ${money(ex.pie)}: quedan Pendiente hasta revisarlas.</span><b>${money(r2(ex.suma - ex.pie))}</b></div>`;
    else if (ex.estado === 'sin_pie') h += `<div class="ct-cred-txt"><span><i class="fas fa-circle-question"></i> Exentas sin «Total exento» en el pie para comprobarlas: revísalas con la foto</span><b>${plural(ex.n, 'línea', 'líneas')}</b></div>`;
    // 565 · promociones licuadas
    const nReg = S.lineas.filter(l => recibida(l) && pagadaDe(l) >= 0).length;
    if (nReg) h += `<div><span><i class="fas fa-gift"></i> Regalos licuados en su producto</span><b>${plural(nReg, 'línea', 'líneas')}</b></div>`;
    const pend = S.lineas.filter(l => { if (!recibida(l)) return false; const cu = costoUnidad(l); return cu.valor === undefined && !cu.cero; }).length;
    if (pend) h += `<div class="ct-cred-txt"><span><i class="fas fa-circle-question"></i> Costo por unidad pendiente</span><b>${plural(pend, 'línea', 'líneas')}</b></div>`;
    h += pruebaRenglon();
    return h;
  }

  /* 564 · «Conciliar no es lo mismo que costear.» Que el pie cuadre prueba que
   * la factura se leyó bien, NO que el costo esté bien. Por eso se muestra la
   * prueba de un renglón: la línea gravada de mayor importe, con su costo por
   * unidad SIN y CON ITBIS. El que se usa es el CON ITBIS (lo que se paga). */
  function pruebaRenglon() {
    let mejor = null;
    S.lineas.forEach(l => {
      if (!recibida(l) || !(num(l.itbis) > 0) || esCero(l)) return;
      const cu = costoUnidad(l);
      if (cu.valor === undefined) return;
      if (!mejor || importe(l) > importe(mejor.l)) mejor = { l, cu };
    });
    if (!mejor) return '';
    const d = mejor.cu.d || 0;
    const sin = importe(mejor.l) * (1 - d / 100) / mejor.cu.unid;
    const desc = String(mejor.l.descripcion || mejor.l.codigo || 'línea').slice(0, 34);
    return `<div class="ct-prueba" title="Comprobación del método: el costo por unidad incluye el ITBIS impreso de la línea">
      <span><i class="fas fa-scale-balanced"></i> Prueba de un renglón · ${esc(desc)}<small>sin ITBIS ${money(r2(sin))} → <b>con ITBIS ${money(r2(mejor.cu.valor))}</b> por unidad (se usa el que lleva el ITBIS: es lo que se paga)${d ? ` · incluye el descuento invisible del ${d} % de este proveedor, antes del ITBIS` : ''}</small></span>
    </div>`;
  }

  /* Pie de totales: lo que quedará en Cuentas por pagar. */
  function pieFactura(monto, p, fecha) {
    const E = S.edit;
    if (E && E.factura_id == null) {
      return '<div class="mp-totales__tot"><span>Factura</span><b class="ct-gris">borrada</b></div>';
    }
    if (E && E.pagada) {
      return `<div class="mp-totales__tot"><span>Factura pagada</span><b>${money(E.monto)}</b></div>`;
    }
    // 555 · la factura sigue por el total del proveedor; el crédito se resta aparte
    const cred = creditoRec();
    const credHtml = cred > 0
      ? `<div><span>Total de la factura</span><b>${money(monto)}</b></div>
         <div class="ct-cred-txt"><span>Créditos disponibles (no recibido)</span><b>− ${money(cred)}</b></div>
         <div class="mp-totales__tot"><span>A pagar</span><b>${money(r2(monto - cred))}</b></div>`
      : `<div class="mp-totales__tot"><span>Factura por pagar</span><b>${money(monto)}</b></div>`;
    let ven = '';
    if (E && fecha === E.fecha && E.vencimiento) {
      ven = `<div class="ct-vence"><span>Vence el</span><b>${fFecha(E.vencimiento)}</b></div>`;
    } else if (p && fecha) {
      ven = `<div class="ct-vence"><span>Vencerá el</span><b>${fFecha(sumarDias(fecha, p.termino_dias))} <small>(${plural(Number(p.termino_dias), 'día', 'días')})</small></b></div>`;
    }
    return `${credHtml}${ven}`;
  }

  function agregarDelCatalogo(id) {
    if (soloEmparejar()) return;
    const p = prodPorId(id);
    if (!p) return;
    const ya = S.lineas.findIndex(l => String(l.producto_id) === String(p.id));
    if (ya >= 0) {
      const c = num(S.lineas[ya].cantidad);
      S.lineas[ya].cantidad = String(r3((isNaN(c) || c === null ? 0 : c) + 1));
      toast(`«${p.name}»: cantidad ${S.lineas[ya].cantidad}.`, 'info');
    } else {
      S.lineas.push({
        codigo: String(p.barcode || '').trim(), descripcion: String(p.name || '').slice(0, 200),
        cantidad: '1', costo: (p.costo !== null && p.costo !== undefined && p.costo !== '') ? String(p.costo) : '',
        producto_id: p.id, via: 'catalogo', manual: true, recibido: true, empaque: '', itbis: '',
      });
    }
    $('ctRecBuscar').value = '';
    $('ctRecResultados').innerHTML = '';
    pintarLineas();
    pintarTotalesRec();
    $('ctRecBuscar').focus();
  }

  function buscarCatalogo() {
    const q = $('ctRecBuscar').value;
    const box = $('ctRecResultados');
    if (!q.trim()) { box.innerHTML = ''; return; }
    const prods = productos();
    box.innerHTML = listaCatalogo(q, 10,
      prods.length ? 'Ningún producto coincide. Puedes añadir una «línea manual».' : 'El catálogo aún no se ha cargado.');
  }

  /* Busca por nombre, código de barras, alterno y referencia del proveedor. */
  function listaCatalogo(q, max, vacio) {
    const prods = productos();
    const res = (typeof _admBuscar === 'function'
      ? prods.filter(p => _admBuscar(q, p.name, p.barcode, p.barcode_alt, p.refs_txt))
      : prods.filter(p => norm(p.name).includes(norm(q)))).slice(0, max);
    return res.length
      ? res.map(p => `
        <button type="button" class="mp-res" data-prod="${esc(p.id)}">
          <span><b>${esc(p.name)}</b><small>${esc(p.unit || '')}${p.barcode ? ' · ' + esc(p.barcode) : ''}${p.refs_txt ? ' · ref. ' + esc(p.refs_txt) : ''}</small></span>
          <span class="mp-res__precio">${p.costo !== null && p.costo !== undefined && p.costo !== '' ? 'costo ' + money(p.costo) : ''}</span>
        </button>`).join('')
      : `<div class="mp-res-vacio">${vacio}</div>`;
  }

  function lineaLibre() {
    if (soloEmparejar()) return;
    S.lineas.push({ codigo: '', descripcion: '', cantidad: '1', costo: '', producto_id: null, via: '', manual: false, recibido: true, empaque: '', itbis: '' });
    pintarLineas();
    pintarTotalesRec();
    document.querySelector(`#ctRecLineas input[data-campo="codigo"][data-i="${S.lineas.length - 1}"]`)?.focus();
  }

  function vaciarRecepcion(sinPreguntar) {
    if (!sinPreguntar && S.lineas.length && !confirm('¿Vaciar la recepción en curso? Se pierden las líneas que no has confirmado.')) return;
    S.lineas = []; S.origen = 'manual'; S.paginas = []; S.iaTot = null;
    ['ctRecNum', 'ctRecTotal', 'ctRecPct', 'ctRecDias', 'ctRecNcf', 'ctRecNotas', 'ctRecBuscar'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('ctRecFecha').value = hoy();
    $('ctRecResultados').innerHTML = '';
    errorModal('ctRecError', '');
    if (S.edit) { S.edit = null; pintarSelects(); }
    pintarModoEdicion();
    pintarPaginas();
    iaEstado('');
    pintarLineas();
    pintarTotalesRec();
  }

  // ─── 553f · Editar una recepción guardada ─────────────────────────────────────────
  async function editarRecepcion(id) {
    const r = S.rec.find(x => String(x.id) === String(id));
    if (!r) return;
    if (S.lineas.length && !confirm(S.edit
      ? '¿Salir de la recepción que estás editando sin guardar los cambios?'
      : 'Hay una recepción a medias en el formulario. ¿Descartarla para editar esta?')) return;
    let ls;
    try {
      ls = S.recLineas[id] || await rpc('conta_leer_recepcion_lineas', { p_id: id }, true);
    } catch (e) { toast(e.message, 'error'); return; }
    vaciarRecepcion(true);
    const pagada = r.factura_id != null && !!r.factura_pagada;
    S.edit = {
      id: r.id, proveedor_id: r.proveedor_id, proveedor_nombre: r.proveedor_nombre,
      numero: r.numero_factura, fecha: String(r.fecha).slice(0, 10), notas: r.notas || '', ncf: r.ncf || '',
      factura_id: r.factura_id, pagada, monto: r.monto_factura,
      vencimiento: r.factura_vencimiento ? String(r.factura_vencimiento).slice(0, 10) : '',
      modo: (r.factura_id != null && !pagada) ? 'completa' : 'solo_emparejar',
    };
    S.origen = r.origen || 'manual';
    asegurarProvEdit();
    $('ctRecNum').value = r.numero_factura || '';
    $('ctRecFecha').value = S.edit.fecha;
    /* Total vacío = suma de líneas (igual que al crear); solo se rellena si la
     * factura quedó por un monto distinto de la suma. */
    $('ctRecTotal').value = (r.monto_factura != null && Math.abs(Number(r.monto_factura) - Number(r.suma_lineas)) >= 0.01)
      ? String(r2(r.monto_factura)) : '';
    $('ctRecPct').value = Number(r.factura_pct) > 0 ? String(Number(r.factura_pct)) : '';
    $('ctRecDias').value = Number(r.factura_dias) > 0 ? String(Number(r.factura_dias)) : '';
    $('ctRecNotas').value = r.notas || '';
    $('ctRecNcf').value = r.ncf || '';
    S.lineas = (ls || []).map(l => ({
      codigo: String(l.codigo || ''), descripcion: String(l.descripcion || ''),
      cantidad: String(Number(l.cantidad)), costo: String(Number(l.costo_unitario)),
      producto_id: l.producto_id || null, via: l.producto_id ? 'guardado' : '',
      recibido: l.recibido !== false,   // 555 · las de antes del 117 cuentan como recibidas
      // 563/119 · und/caja e ITBIS guardados (las de antes del 119 llegan vacíos)
      empaque: l.und_caja != null ? String(Number(l.und_caja)) : '',
      itbis: l.itbis != null ? String(Number(l.itbis)) : '',
      manual: !!l.producto_id,   // lo ya emparejado no se toca al volver a emparejar
    }));
    irTab('recepcion');
    pintarModoEdicion();
    pintarLineas();
    pintarTotalesRec();
    $('ctPanelRecepcion')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function pintarModoEdicion() {
    const E = S.edit, solo = soloEmparejar();
    const ban = $('ctRecEditando');
    if (ban) {
      ban.hidden = !E;
      const txt = $('ctRecEditTxt');
      if (txt && E) {
        const motivo = E.factura_id == null
          ? 'La factura se borró: solo se pueden <b>emparejar</b> las líneas (no se vuelve a crear).'
          : (E.pagada ? 'La factura está <b>pagada</b>: solo se pueden <b>emparejar</b> las líneas.'
                      : 'Al guardar se actualiza también la factura en Cuentas por pagar.');
        txt.innerHTML = `<i class="fas fa-pen-to-square"></i> Editando la factura <b>${esc(E.numero)}</b> de <b>${esc(E.proveedor_nombre)}</b>. <span>${motivo}</span>`;
      }
    }
    ['ctRecNum', 'ctRecFecha', 'ctRecTotal', 'ctRecPct', 'ctRecDias', 'ctRecNcf', 'ctRecNotas', 'ctRecBuscar', 'ctRecAddLibre', 'ctIaFoto']
      .forEach(id => { const el = $(id); if (el) el.disabled = solo; });
    $('ctIaBtn')?.classList.toggle('ct-ia__btn--bloq', solo);
    pintarPaginas();
    const prov = $('ctRecProv');
    if (prov) prov.disabled = !!E;
    const limpiar = $('ctRecLimpiar');
    if (limpiar) limpiar.hidden = !!E;
    const btn = $('ctRecConfirmar');
    if (btn && !S.guardando) {
      btn.innerHTML = E ? '<i class="fas fa-floppy-disk"></i> Guardar cambios' : '<i class="fas fa-check-circle"></i> Confirmar recepción';
    }
  }

  /* Vuelve a probar SOLO las líneas «No emparejado» con las referencias y
   * códigos de hoy. Lo ya emparejado se respeta. Sin foto ni IA. */
  async function volverAEmparejar() {
    const btn = $('ctRecReemparejar');
    if (btn) btn.disabled = true;
    try {
      if (window.CasaMotaRefs) await window.CasaMotaRefs.cargar(true);
      const antes = S.lineas.filter(l => !l.producto_id).length;
      S.lineas.forEach(l => { if (!l.producto_id) { l.manual = false; autoEmparejar(l); } });
      const quedan = S.lineas.filter(l => !l.producto_id).length;
      const n = antes - quedan;
      pintarLineas();
      pintarTotalesRec();
      if (!antes) toast('Todas las líneas ya estaban emparejadas.', 'info');
      else toast(n
        ? `${plural(n, 'línea emparejada', 'líneas emparejadas')} por referencia o código de barras.${quedan ? ` Quedan ${quedan} «No emparejado»: emparejálas a mano.` : ''} Pulsa «Guardar cambios».`
        : `Ninguna línea casa todavía con una referencia o un código de barras. Quedan ${quedan} «No emparejado»: emparejálas a mano.`,
        n ? 'success' : 'info');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function cancelarEdicion() {
    if (!S.edit) return;
    if (!confirm('¿Salir sin guardar los cambios de esta recepción?')) return;
    vaciarRecepcion(true);
  }

  function errorRec(msg, focoId) {
    errorModal('ctRecError', msg);
    if (focoId) $(focoId)?.focus();
    return false;
  }

  async function confirmarRecepcion() {
    if (S.guardando) return;
    errorModal('ctRecError', '');
    const provId = $('ctRecProv').value;
    const numero = $('ctRecNum').value.trim();
    const fecha = $('ctRecFecha').value;
    if (!provId) return errorRec('Elige el proveedor.', 'ctRecProv');
    if (!numero) return errorRec(ERRORES.FALTA_NUMERO, 'ctRecNum');
    if (!fecha) return errorRec(ERRORES.FALTA_FECHA, 'ctRecFecha');
    const ncf = limpiarNcf($('ctRecNcf').value);
    if (!ncfValido(ncf)) return errorRec(ERRORES.NCF_INVALIDO, 'ctRecNcf');
    if (!S.lineas.length) return errorRec(ERRORES.SIN_LINEAS, 'ctRecBuscar');
    for (let i = 0; i < S.lineas.length; i++) {
      const l = S.lineas[i];
      const c = num(l.cantidad), k = num(l.costo);
      const foco = campo => `#ctRecLineas input[data-campo="${campo}"][data-i="${i}"]`;
      if (!String(l.descripcion).trim()) { errorRec(`${ERRORES.FALTA_DESCRIPCION} (línea ${i + 1})`); document.querySelector(foco('descripcion'))?.focus(); return; }
      if (c === null || isNaN(c) || c <= 0) { errorRec(`${ERRORES.CANTIDAD_INVALIDA} (línea ${i + 1})`); document.querySelector(foco('cantidad'))?.focus(); return; }
      if (k === null || isNaN(k) || k < 0) { errorRec(`${ERRORES.COSTO_INVALIDO} (línea ${i + 1})`); document.querySelector(foco('costo'))?.focus(); return; }
    }
    const tRaw = num($('ctRecTotal').value);
    if (tRaw !== null && (isNaN(tRaw) || tRaw <= 0)) return errorRec(ERRORES.TOTAL_INVALIDO, 'ctRecTotal');
    let pp;
    try { pp = leerProntoPago('ctRecPct', 'ctRecDias'); } catch (e) { return errorRec(e.message, 'ctRecPct'); }
    const { suma, total, monto } = totalesRec();
    const E = S.edit, solo = soloEmparejar();
    if (monto <= 0) return errorRec(ERRORES.TOTAL_CERO);
    const cred = creditoRec();
    if (cred > monto) return errorRec(ERRORES.CREDITO_MAYOR_QUE_FACTURA);
    if (!solo && total !== null && Math.abs(total - suma) >= 0.01 &&
        !confirm(`El total escrito (${money(total)}) no coincide con la suma de las líneas (${money(suma)}).\n\nLa factura por pagar ${E ? 'quedará' : 'se creará'} por ${money(total)}. ¿Continuar?`)) return;
    const sin = S.lineas.filter(l => !l.producto_id).length;
    if (sin && !confirm(`${plural(sin, 'línea queda', 'líneas quedan')} «No emparejado» (cuentan para el total, no tocan ningún producto). ¿Continuar?`)) return;

    S.guardando = true;
    try {
      await ocupado('ctRecConfirmar', 'Guardando…', async () => {
        const datos = {
          proveedor_id: provId, numero_factura: numero, fecha, origen: S.origen,
          pronto_pago_pct: pp.pct, pronto_pago_dias: pp.dias,
          total_factura: total, notas: $('ctRecNotas').value.trim(), ncf,
          lineas: S.lineas.map(l => ({
            producto_id: l.producto_id || null,
            codigo: String(l.codigo || '').trim(),
            descripcion: String(l.descripcion).trim(),
            cantidad: r3(num(l.cantidad)),
            costo_unitario: r2(num(l.costo)),
            guardar_referencia: guardaReferencia(l),
            recibido: recibida(l),
            // 563/119 · la base calcula y guarda el costo por unidad con el descuento invisible
            und_caja: num(l.empaque) >= 1 ? Math.trunc(num(l.empaque)) : null,
            // 565 · exenta sin acreditar por el pie → sin ITBIS (la base la deja Pendiente)
            itbis: (l.exenta && estadoExentas().estado === 'no') ? null
              : (l.itbis !== '' && l.itbis != null && !isNaN(num(l.itbis)) && num(l.itbis) >= 0 ? r2(num(l.itbis)) : null),
            // 565 · regalo → número (orden) de la línea cobrada en la que se licúa
            regalo_de: (() => { const j = pagadaDe(l); return j >= 0 ? j + 1 : null; })(),
          })),
        };
        const txtCred = r => (Number(r && r.credito) > 0)
          ? ` Crédito por lo no recibido: ${money(r.credito)} · a pagar ${money(r.a_pagar)}.` : '';
        if (E) {
          const r = await rpc('conta_editar_recepcion', { p_id: E.id, p_datos: datos });
          const nRef = Number(r && r.referencias_guardadas) || 0;
          const id = E.id;
          vaciarRecepcion(true);
          toast(`✅ Cambios guardados en la recepción ${esc(numero)}.` +
            (r && r.modo === 'completa' ? ` Factura por ${money(r.monto)} · vence el ${fFecha(r.vencimiento)}.` + txtCred(r) : '') +
            (nRef ? ` ${plural(nRef, 'referencia guardada', 'referencias guardadas')} en el catálogo.` : ''), 'success');
          await cargar();
          await verRecepcion(id, true);
          abrirCostos(id, true);   // 565 · Parte 4: preguntar producto por producto
          return;
        }
        const r = await rpc('conta_crear_recepcion', { p_datos: datos });
        const nRef = Number(r && r.referencias_guardadas) || 0;
        vaciarRecepcion(true);
        toast(`✅ Recepción guardada. Factura ${esc(numero)} por ${money(r && r.monto)} · vence el ${fFecha(r && r.vencimiento)}.` + txtCred(r) +
          (nRef ? ` ${plural(nRef, 'referencia guardada', 'referencias guardadas')} en el catálogo.` : ''), 'success');
        await cargar();
        if (r && r.recepcion_id) {
          await verRecepcion(r.recepcion_id, true);
          abrirCostos(r.recepcion_id, true);   // 565 · Parte 4: preguntar producto por producto
        }
      });
    } catch (e) {
      errorRec(e.message);
    } finally {
      S.guardando = false;
      pintarModoEdicion();   // ocupado() devuelve el texto viejo del botón
      pintarTotalesRec();
    }
  }

  // Emparejar a mano
  function abrirEmparejar(i) {
    const l = S.lineas[i];
    if (!l) return;
    S.empIdx = i;
    const prov = provPorId($('ctRecProv').value);
    $('ctEmpLinea').innerHTML = `Línea ${i + 1}: <b>${esc(l.descripcion || '(sin descripción)')}</b>${l.codigo ? ` · código ${esc(l.codigo)}` : ''}`;
    $('ctEmpNota').innerHTML = l.codigo && prov
      ? `<i class="fas fa-circle-info"></i> «<b>${esc(l.codigo)}</b>» quedará guardado como referencia de <b>${esc(prov.nombre)}</b> en el producto que elijas: la próxima factura se emparejará sola.`
      : '<i class="fas fa-circle-info"></i> Esta línea no trae código: se empareja solo en esta recepción.';
    $('ctEmpBuscar').value = '';
    listaEmparejar();
    abrirModal('ctEmpModal');
    setTimeout(() => $('ctEmpBuscar')?.focus(), 50);
  }
  function listaEmparejar() {
    const l = S.lineas[S.empIdx];
    if (!l) return;
    const q = $('ctEmpBuscar').value;
    $('ctEmpLista').innerHTML = q.trim()
      ? listaCatalogo(q, 30, 'Ningún producto coincide.')
      : '<div class="mp-res-vacio">Escribe el nombre, el código de barras o la referencia para buscar el producto.</div>';
  }
  function asignar(i, prodId, via) {
    const l = S.lineas[i];
    if (!l) return;
    l.producto_id = prodId; l.via = via; l.manual = true;
    repintarCeldaProducto(i);
    pintarTotalesRec();
  }

  // ─── IA: leer las fotos de la factura ─────────────────────────────────────
  function iaEstado(html, tipo) {
    const el = $('ctIaEstado');
    if (!el) return;
    el.hidden = !html;
    el.className = 'ct-ia__estado' + (tipo ? ' ct-ia__estado--' + tipo : '');
    el.innerHTML = html || '';
  }

  /* 559 · Una factura puede venir en varias páginas: primero se suben TODAS
   * y después se pulsa «Analizar con IA». Las fotos viven solo en memoria. */
  const MAX_PAGINAS = 10;
  const MAX_REINTENTOS = 6;

  function pintarPaginas() {
    const box = $('ctIaPaginas');
    if (!box) return;
    const n = S.paginas.length, bloq = soloEmparejar();
    box.hidden = !n;
    $('ctIaMiniaturas').innerHTML = S.paginas.map((p, i) => `
      <figure class="ct-ia__pag${p.res ? ' ct-ia__pag--leida' : ''}">
        <img src="${p.src}" alt="Página ${i + 1} de la factura (solo en esta pantalla, no se guarda)" title="Pulsa para ampliar o reducir" />
        <figcaption>Pág. ${i + 1}${p.res ? ' <i class="fas fa-circle-check" title="Ya leída"></i>' : ''}</figcaption>
        ${S.iaLeyendo || bloq ? '' : `<button type="button" class="ct-ia__quitar" data-ia-quitar="${i}" title="Quitar esta página" aria-label="Quitar la página ${i + 1}"><i class="fas fa-xmark"></i></button>`}
      </figure>`).join('');
    const an = $('ctIaAnalizar');
    if (an) {
      an.disabled = S.iaLeyendo || bloq || !n;
      an.innerHTML = S.iaLeyendo
        ? '<i class="fas fa-spinner fa-spin"></i> Analizando…'
        : `<i class="fas fa-wand-magic-sparkles"></i> Analizar con IA${n > 1 ? ` (${n} páginas)` : ''}`;
    }
    const q = $('ctIaQuitarTodas');
    if (q) {
      q.disabled = bloq;
      q.innerHTML = S.iaLeyendo ? '<i class="fas fa-stop"></i> Detener' : '<i class="fas fa-xmark"></i> Quitar fotos';
    }
    $('ctIaBtn')?.classList.toggle('ct-ia__btn--ocupado', S.iaLeyendo);
  }

  async function agregarPaginas(files) {
    const lista = Array.from(files || []);
    if (!lista.length || S.iaLeyendo || soloEmparejar()) return;
    const sitio = MAX_PAGINAS - S.paginas.length;
    if (sitio <= 0) { toast(`Máximo ${MAX_PAGINAS} páginas por factura.`, 'warn'); return; }
    if (lista.length > sitio) toast(`Solo se añaden ${sitio}: máximo ${MAX_PAGINAS} páginas por factura.`, 'warn');
    iaEstado('<i class="fas fa-spinner fa-spin"></i> Preparando las fotos…', 'info');
    let mal = '';
    for (const f of lista.slice(0, sitio)) {
      try { S.paginas.push({ src: await prepararFoto(f), res: null }); }
      catch (e) { mal = e.message || 'No se pudo abrir la foto.'; }
    }
    pintarPaginas();
    if (!S.paginas.length) { iaEstado(`<i class="fas fa-triangle-exclamation"></i> ${esc(mal || 'No se pudo abrir la foto.')}`, 'error'); return; }
    estadoListas(mal);
  }

  function estadoListas(mal) {
    const n = S.paginas.length;
    if (!n) { iaEstado(''); return; }
    iaEstado(`<i class="fas fa-images"></i> <b>${plural(n, 'página lista', 'páginas listas')}</b>. ` +
      `Si la factura tiene más páginas, súbelas también; cuando estén todas, pulsa <b>«Analizar con IA»</b>.` +
      (mal ? `<br><i class="fas fa-triangle-exclamation"></i> ${esc(mal)}` : ''), 'info');
  }

  function quitarPagina(i) {
    if (S.iaLeyendo || !S.paginas[i]) return;
    S.paginas.splice(i, 1);
    pintarPaginas();
    estadoListas();
  }

  function quitarTodas() {
    if (S.iaLeyendo) { S.iaCancelar = true; return; }   // durante la lectura el botón es «Detener»
    S.paginas = [];
    pintarPaginas();
    iaEstado('');
  }

  /* Reduce la foto en el navegador (lado mayor 1.800 px, JPEG) para que
   * viaje rápido y quepa en el límite de Groq (4 MB en base64). */
  async function prepararFoto(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('El archivo no es una imagen.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, mal) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => mal(new Error('No se pudo abrir la foto. Prueba con una foto JPG o PNG.'));
        i.src = url;
      });
      const MAX = 1800;
      const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let q = 0.85;
      let data = c.toDataURL('image/jpeg', q);
      while (data.length > 3500000 && q > 0.45) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
      if (data.length > 3800000) throw new Error('La foto es demasiado grande incluso reducida.');
      return data;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* Cuenta atrás visible antes de reintentar solo (límite por minuto de Groq). */
  async function esperarIa(seg, motivo) {
    for (let s = seg; s > 0; s--) {
      if (S.iaCancelar) throw new Error('CANCELADO');
      iaEstado(`<i class="fas fa-hourglass-half"></i> ${esc(motivo)} Se vuelve a intentar sola en <b>${s} s</b>… (no hace falta hacer nada)`, 'info');
      await new Promise(ok => setTimeout(ok, 1000));
    }
  }

  /* Lee UNA página. Si Groq está ocupado (límite por minuto) espera lo que
   * pide y reintenta sola; el límite DIARIO no se reintenta. */
  async function leerPagina(src, pagina, de) {
    const txt = de > 1 ? ` (página ${pagina} de ${de})` : '';
    for (let intento = 0; ; intento++) {
      if (S.iaCancelar) throw new Error('CANCELADO');
      iaEstado(`<i class="fas fa-spinner fa-spin"></i> La IA está leyendo la factura${txt}… (puede tardar unos segundos)`, 'info');
      let res, j = null;
      try {
        res = await fetch('/api/factura-ia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CM-Vale': vale() },
          body: JSON.stringify({ imagen: src, pagina, de }),
        });
      } catch (e) {
        if (intento < 1) { await esperarIa(5, `No se pudo contactar con el lector${txt}.`); continue; }
        throw new Error('No se pudo contactar con el lector de facturas. Revisa la conexión.');
      }
      try { j = await res.json(); } catch (e) { j = null; }
      /* 553d · 404/405 sin respuesta del lector = la Function no está publicada
       * en Cloudflare (Pages trata el POST como un fichero normal). */
      if ((res.status === 404 || res.status === 405) && !(j && j.error)) {
        throw new Error(`El lector de facturas no está publicado todavía (${res.status}): falta subir functions/api/factura-ia.js.`);
      }
      if (res.ok && j && j.ok) return j.factura || {};
      if (res.status === 429 && !(j && j.diario) && intento < MAX_REINTENTOS) {
        const seg = Math.min(120, Math.max(1, Number(j && j.espera) || Number(res.headers.get('Retry-After')) || 15));
        await esperarIa(seg, `La IA está ocupada (límite por minuto de Groq)${txt}.`);
        continue;
      }
      throw new Error((j && j.error) || `El lector de facturas no respondió (${res.status}).`);
    }
  }

  /* Junta las páginas: líneas en orden; número, fecha y e-NCF de la primera
   * que los traiga; totales del pie (la ÚLTIMA página que trae el total).
   * 562 · Cada página se compara con SU pie («Sub total Cantidad Página» y
   * subtotal de la página): si no cuadra, se avisa con el número de página.
   * Si ninguna página trae el total de la factura pero TODAS traen el de su
   * página, el total de la factura es la suma de las páginas. */
  function unirPaginas(lista) {
    const f = { numero: '', fecha: '', ncf: '', subtotal: null, descuento: null, itbis: null, total: null, exento: null, lineas: [], avisos: [] };
    const N = lista.length;
    lista.forEach((r, i) => {
      if (!r) return;
      if (!f.numero && r.numero) f.numero = r.numero;
      if (!f.fecha && r.fecha) f.fecha = r.fecha;
      if (!f.ncf && r.ncf) f.ncf = r.ncf;
      const ls = Array.isArray(r.lineas) ? r.lineas : [];
      f.lineas = f.lineas.concat(ls);
      const P = r.pagina, txt = N > 1 ? `Página ${i + 1}` : 'La factura';
      if (!P || !ls.length) return;
      const cant = r3(ls.reduce((a, l) => a + (Number(l.cantidad) || 0), 0));
      const sub = r2(ls.reduce((a, l) => a + r2((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)), 0));
      if (P.cantidad > 0 && Math.abs(cant - P.cantidad) > 0.01) {
        f.avisos.push(`${txt}: las cantidades leídas suman ${cant} y el pie dice ${P.cantidad}.`);
      }
      if (P.subtotal > 0 && Math.abs(sub - P.subtotal) >= 1) {
        f.avisos.push(`${txt}: las líneas suman ${money(sub)} sin ITBIS y el pie dice ${money(P.subtotal)}.`);
      }
    });
    const ok = lista.filter(Boolean);
    // «Página 2 de 3» impreso en la factura y se subieron menos fotos
    const deMax = Math.max(0, ...ok.map(r => (r.pagina && Number(r.pagina.de)) || 0));
    if (deMax > N) f.avisos.unshift(`La factura dice que tiene ${deMax} páginas y se ${N === 1 ? 'subió 1' : `subieron ${N}`}: falta subir alguna.`);
    const alReves = ok.slice().reverse();
    const pie = alReves.find(r => r.total > 0) || alReves.find(r => r.itbis !== null && r.itbis !== undefined);
    const sumaPag = k => r2(ok.reduce((a, r) => a + (Number(r.pagina[k]) || 0), 0));
    const todasPag = k => ok.length === N && ok.every(r => r.pagina && r.pagina[k] !== null && r.pagina[k] !== undefined);
    if (pie) {
      ['subtotal', 'descuento', 'itbis', 'total', 'exento'].forEach(k => { f[k] = pie[k] ?? null; });
    } else if (ok.length === N && ok.every(r => r.pagina && r.pagina.total > 0)) {
      f.total = sumaPag('total');
      f.itbis = todasPag('itbis') ? sumaPag('itbis') : null;
      f.subtotal = todasPag('subtotal') ? sumaPag('subtotal') : null;
    }
    // 565 · «Total exento»: el de la factura o, si no, la suma del de cada página
    if ((f.exento === null || f.exento === undefined) && todasPag('exento')) f.exento = sumaPag('exento');
    return f;
  }

  async function analizarPaginas() {
    if (S.iaLeyendo || !S.paginas.length || soloEmparejar()) return;
    if (!$('ctRecProv').value) {
      toast('Elige primero el proveedor: así se emparejan solos los productos que ya conoce.', 'warn');
      $('ctRecProv').focus();
      return;
    }
    S.iaLeyendo = true; S.iaCancelar = false;
    pintarPaginas();
    const N = S.paginas.length;
    try {
      if (window.CasaMotaRefs) await window.CasaMotaRefs.cargar();
      for (let i = 0; i < N; i++) {
        const p = S.paginas[i];
        if (!p.res) { p.res = await leerPagina(p.src, i + 1, N); pintarPaginas(); }
      }
      aplicarLectura(unirPaginas(S.paginas.map(p => p.res)), N);   // 1 página también pasa por aquí (se compara con su pie)
    } catch (e) {
      const leidas = S.paginas.filter(p => p.res).length;
      const guardadas = leidas
        ? ` ${plural(leidas, 'página ya leída se queda', 'páginas ya leídas se quedan')} en esta pantalla: al volver a pulsar «Analizar con IA» solo se leen las que faltan.`
        : '';
      if (e.message === 'CANCELADO') iaEstado(`<i class="fas fa-circle-info"></i> Lectura detenida.${guardadas}`, 'info');
      else iaEstado(`<i class="fas fa-triangle-exclamation"></i> ${esc(e.message || 'No se pudo leer la factura.')}${guardadas} También puedes meter las líneas a mano.`, 'error');
    } finally {
      S.iaLeyendo = false; S.iaCancelar = false;
      pintarPaginas();
    }
  }

  const montoONull = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? null : r2(Number(v));

  function aplicarLectura(f, nPag) {
    const lineas = Array.isArray(f.lineas) ? f.lineas : [];
    if (!lineas.length) {
      iaEstado('<i class="fas fa-triangle-exclamation"></i> La IA no encontró líneas de productos en la foto. Prueba con otra foto más clara y recta, o mételas a mano.', 'error');
      return;
    }
    if (f.numero && !$('ctRecNum').value.trim()) $('ctRecNum').value = String(f.numero).slice(0, 40);
    if (f.fecha && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) $('ctRecFecha').value = f.fecha;
    if (f.total > 0 && !$('ctRecTotal').value.trim()) $('ctRecTotal').value = r2(f.total);
    // 559 · desglose del pie de la factura (solo para mostrar y comprobar; no se guarda)
    const tot = { subtotal: montoONull(f.subtotal), descuento: montoONull(f.descuento), itbis: montoONull(f.itbis), total: montoONull(f.total), exento: montoONull(f.exento) };
    S.iaTot = Object.values(tot).some(v => v !== null) ? tot : null;
    // 557 · el e-NCF va a SU campo (antes se escribía en Notas)
    if (f.ncf && !$('ctRecNcf').value.trim()) $('ctRecNcf').value = limpiarNcf(f.ncf).slice(0, 20);

    const nuevas = lineas.map(x => ({
      codigo: String(x.codigo || '').slice(0, 40),
      descripcion: String(x.descripcion || '').slice(0, 200),
      cantidad: x.cantidad > 0 ? String(r3(x.cantidad)) : '',
      costo: x.costo_unitario >= 0 && x.costo_unitario !== null ? String(r2(x.costo_unitario)) : '',
      producto_id: null, via: '', manual: false,
      recibido: true,   // 555 · lo leído por la IA se da por recibido; se desmarca a mano
      // 562 · aviso bajo la cantidad (no se guarda; se quita al tocar la cantidad)
      iaNota: x.corregida ? 'corregida' : (x.revisar ? 'revisar' : ''),
      // 563 · und/caja y ITBIS de la línea tal como los leyó la IA (se pueden corregir)
      empaque: Number(x.empaque) >= 1 ? String(Number(x.empaque)) : '',
      itbis: x.itbis !== null && x.itbis !== undefined && x.itbis !== '' && !isNaN(Number(x.itbis)) ? String(r2(Number(x.itbis))) : '',
      exenta: !!x.exenta,
      precioIncl: !!x.precio_con_itbis_incluido,   // 564 · caso B
    }));
    nuevas.forEach(autoEmparejar);
    if (S.lineas.length && !confirm(`La IA leyó ${plural(nuevas.length, 'línea', 'líneas')}.\n\nAceptar = SUSTITUIR las ${S.lineas.length} líneas actuales.\nCancelar = AÑADIRLAS al final.`)) {
      S.lineas = S.lineas.concat(nuevas);
    } else {
      S.lineas = nuevas;
    }
    S.origen = 'ia';
    const emp = nuevas.filter(l => l.producto_id).length;
    const faltan = nuevas.filter(l => !(num(l.cantidad) > 0) || l.costo === '').length;
    const nCorr = nuevas.filter(l => l.iaNota === 'corregida').length;
    const nRev = nuevas.filter(l => l.iaNota === 'revisar').length;
    const avisos = Array.isArray(f.avisos) ? f.avisos : [];
    const pags = nPag > 1 ? ` de <b>${nPag} páginas</b>` : '';
    const pie = tot.itbis !== null
      ? ` ITBIS leído: <b>${money(tot.itbis)}</b>.`
      : (tot.total === null ? ' <b>No encontró el total de la factura: escríbelo a mano.</b>' : ' No encontró el ITBIS en el pie.');
    const extra =
      (nCorr ? `<br><i class="fas fa-wrench"></i> <b>${plural(nCorr, 'cantidad corregida', 'cantidades corregidas')}</b> con los importes impresos en la factura (la IA había leído otra cosa, p. ej. el empaque «* 12»).` : '') +
      (nRev ? `<br><i class="fas fa-triangle-exclamation"></i> <b>${plural(nRev, 'cantidad', 'cantidades')} por revisar</b>: coincide${nRev === 1 ? '' : 'n'} con el empaque de la caja.` : '') +
      avisos.map(a => `<br><i class="fas fa-triangle-exclamation"></i> <b>${esc(a)}</b>`).join('');
    iaEstado(`<i class="fas ${avisos.length || nRev ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> La IA leyó <b>${plural(nuevas.length, 'línea', 'líneas')}</b>${pags}: ` +
      `${emp} emparejada${emp === 1 ? '' : 's'} por referencia o código de barras, ${nuevas.length - emp} no emparejada${nuevas.length - emp === 1 ? '' : 's'}.` +
      `${faltan ? ` <b>${faltan} con cantidad o costo por completar.</b>` : ''}${pie}${extra} ` +
      `<br><b>Revisa cada línea con las fotos antes de confirmar</b>: la IA puede equivocarse.`, avisos.length || nRev ? 'aviso' : 'ok');
    pintarLineas();
    pintarTotalesRec();
  }

  // ─── Avisos al entrar al panel (número del menú + aviso una vez al día) ───
  async function avisosInicio() {
    if (!permitido() || !vale()) return;
    try {
      const a = await rpc('conta_avisos', {});
      if (!a) return;
      const venc = Number(a.vencidas) || 0, prox = Number(a.proximas) || 0;
      if (!S.cargado) badge(venc, prox);
      const marca = 'cm_ct_aviso_' + hoy();
      let visto = false;
      try { visto = sessionStorage.getItem(marca) === '1'; sessionStorage.setItem(marca, '1'); } catch (e) { /* sin almacenamiento */ }
      if (!visto && (venc || prox)) {
        const partes = [];
        if (venc) partes.push(`<b>${plural(venc, 'factura vencida', 'facturas vencidas')}</b> (${money(a.monto_vencido)})`);
        if (prox) partes.push(`${plural(prox, 'próxima', 'próximas')} a vencer`);
        toast(`Contabilidad: ${partes.join(' y ')}.`, venc ? 'error' : 'warn');
      }
    } catch (e) {
      console.warn('[contabilidad] avisos:', e.message);
    }
  }

  // ─── Montaje ───────────────────────────────────────────────────────────────
  function montar() {
    if (!$('sec-contabilidad')) return;

    document.querySelectorAll('[data-ct-tab]').forEach(b =>
      b.addEventListener('click', () => irTab(b.getAttribute('data-ct-tab'))));
    $('ctBtnRecargar').addEventListener('click', () => cargar());

    ['ctFacBuscar'].forEach(id => $(id).addEventListener('input', pintarFacturas));
    ['ctFacProv', 'ctFacEstado'].forEach(id => $(id).addEventListener('change', pintarFacturas));
    $('ctProvBuscar').addEventListener('input', pintarProveedores);
    $('ctBtnNuevaFac').addEventListener('click', () => abrirFactura());
    $('ctBtnNuevoProv').addEventListener('click', () => abrirProveedor());

    // Acciones de tablas y avisos (delegación)
    const sec = $('sec-contabilidad');
    sec.addEventListener('click', ev => {
      const b = ev.target.closest('[data-act]');
      if (!b || !sec.contains(b)) return;
      const act = b.getAttribute('data-act');
      const id = b.getAttribute('data-id');
      const i = Number(b.getAttribute('data-i'));
      if (act === 'pagar') abrirPago(id);
      else if (act === 'editar') abrirFactura(id);
      else if (act === 'borrar') borrarFactura(id);
      else if (act === 'anular') anularPago(id);
      else if (act === 'editprov') abrirProveedor(id);
      else if (act === 'bajaprov') bajaProveedor(id);
      else if (act === 'filtrar') { irTab('pagar'); $('ctFacEstado').value = b.getAttribute('data-estado'); pintarFacturas(); }
      else if (act === 'verrec') {
        if (b.tagName === 'BUTTON') { irTab('recepcion'); verRecepcion(id, true).then(() => $('ctRecHist').scrollIntoView({ block: 'start', behavior: 'smooth' })); }
        else verRecepcion(id);
      }
      else if (act === 'quitar') { if (!soloEmparejar()) { S.lineas.splice(i, 1); pintarLineas(); pintarTotalesRec(); } }
      else if (act === 'editrec') editarRecepcion(id);
      else if (act === 'costosrec') abrirCostos(id, false);
      else if (act === 'recibido') marcarRecibido(i, true);
      else if (act === 'norecibido') marcarRecibido(i, false);
      else if (act === 'emparejar') abrirEmparejar(i);
      else if (act === 'soltar') { const l = S.lineas[i]; if (l) { l.producto_id = null; l.via = ''; l.manual = true; repintarCeldaProducto(i); pintarTotalesRec(); } }
    });
    $('ctRecHist').addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.classList.contains('ct-hist-fila')) ev.target.click();
    });

    // Recepción
    $('ctRecFecha').value = hoy();
    $('ctRecProv').addEventListener('change', async () => {
      if (window.CasaMotaRefs) await window.CasaMotaRefs.cargar();
      S.lineas.forEach(autoEmparejar);
      pintarLineas();
      pintarTotalesRec();
    });
    ['ctRecTotal', 'ctRecFecha'].forEach(id => $(id).addEventListener('input', pintarTotalesRec));
    $('ctRecBuscar').addEventListener('input', buscarCatalogo);
    $('ctRecBuscar').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const primero = $('ctRecResultados').querySelector('[data-prod]');
        if (primero) agregarDelCatalogo(primero.getAttribute('data-prod'));
      } else if (ev.key === 'Escape') { $('ctRecResultados').innerHTML = ''; }
    });
    $('ctRecResultados').addEventListener('click', ev => {
      const b = ev.target.closest('[data-prod]');
      if (b) agregarDelCatalogo(b.getAttribute('data-prod'));
    });
    document.addEventListener('click', ev => {
      if (!ev.target.closest('.ct-buscar')) { const r = $('ctRecResultados'); if (r) r.innerHTML = ''; }
    });
    $('ctRecAddLibre').addEventListener('click', lineaLibre);
    $('ctRecLimpiar').addEventListener('click', () => vaciarRecepcion(false));
    $('ctRecReemparejar').addEventListener('click', volverAEmparejar);
    $('ctRecCancelarEdit').addEventListener('click', cancelarEdicion);
    $('ctRecConfirmar').addEventListener('click', confirmarRecepcion);

    const tbL = $('ctRecLineas');
    tbL.addEventListener('input', ev => {
      const el = ev.target;
      const campo = el.getAttribute('data-campo');
      const l = S.lineas[Number(el.getAttribute('data-i'))];
      if (!campo || !l) return;
      l[campo] = el.value;
      // 562 · si el empleado toca la cantidad, el aviso de la IA ya no aplica
      if (campo === 'cantidad' && l.iaNota) {
        l.iaNota = '';
        el.classList.remove('ct-in--revisar');
        el.parentElement.querySelector('.ct-cant-nota')?.remove();
      }
      if (campo === 'itbis') l.exenta = false;   // 565 · el ITBIS escrito a mano manda
      if (campo === 'cantidad' || campo === 'costo' || campo === 'itbis' || campo === 'empaque' || campo === 'codigo' || campo === 'descripcion') {
        const tr = el.closest('tr');
        const td = tr.querySelector('.ct-l__imp');
        if (td) td.textContent = money(importe(l));
        repintarCostos();   // 563/565 · costo por unidad al momento (también regalos y exentas)
        pintarTotalesRec();
      }
    });
    tbL.addEventListener('change', ev => {
      const el = ev.target;
      const campo = el.getAttribute('data-campo');
      const i = Number(el.getAttribute('data-i'));
      const l = S.lineas[i];
      if (!l || (campo !== 'codigo' && campo !== 'descripcion')) return;
      if (!l.manual) { autoEmparejar(l); repintarCeldaProducto(i); pintarTotalesRec(); }
    });

    // IA · 559: se suben las páginas (una o varias cada vez) y después «Analizar con IA»
    $('ctIaFoto').addEventListener('change', ev => {
      const files = ev.target.files;
      agregarPaginas(files);
      ev.target.value = '';   // se suelta; se puede volver a elegir la misma foto
    });
    $('ctIaAnalizar').addEventListener('click', analizarPaginas);
    $('ctIaQuitarTodas').addEventListener('click', quitarTodas);
    $('ctIaMiniaturas').addEventListener('click', ev => {
      const q = ev.target.closest('[data-ia-quitar]');
      if (q) { quitarPagina(Number(q.getAttribute('data-ia-quitar'))); return; }
      const fig = ev.target.closest('.ct-ia__pag');
      if (fig) fig.classList.toggle('ct-ia__pag--grande');
    });

    // Modales
    document.querySelectorAll('[data-ct-cerrar]').forEach(b =>
      b.addEventListener('click', () => cerrarModal(b.getAttribute('data-ct-cerrar'))));
    $('ctProvGuardar').addEventListener('click', guardarProveedor);
    $('ctCostoGuardar').addEventListener('click', guardarCostos);   // 565
    $('ctProvProvincia').innerHTML = '<option value="">— Elige la provincia —</option>' +
      PROVINCIAS.map(p => `<option value="${esc(p[0])}">${esc(p[0])}</option>`).join('');
    $('ctProvProvincia').addEventListener('change', elegirProvincia);
    $('ctProvCp').addEventListener('input', ev => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 5); });
    // 561 · guiones automáticos y sugerencias de Google Maps
    mascara($('ctProvRnc'), formatoRnc);
    mascara($('ctProvTel'), formatoTel);
    $('ctProvDireccion').addEventListener('input', buscarDir);
    $('ctProvDireccion').addEventListener('keydown', teclaDir);
    $('ctProvDireccion').addEventListener('blur', () => setTimeout(cerrarSugDir, 200));
    $('ctProvDirSug').addEventListener('mousedown', ev => ev.preventDefault());   // que el clic no quite el foco antes de elegir
    $('ctProvDirSug').addEventListener('click', ev => {
      const b = ev.target.closest('[data-dir]');
      if (b) elegirDir(Number(b.getAttribute('data-dir')));
    });
    $('ctFacGuardar').addEventListener('click', guardarFactura);
    $('ctFacModalProv').addEventListener('change', () => { S.venEditado = false; autoVencimiento(); });
    $('ctFacEmision').addEventListener('input', autoVencimiento);
    $('ctFacVence').addEventListener('input', () => { S.venEditado = true; });
    $('ctPagoFecha').addEventListener('input', calcPago);
    $('ctPagoBanco').innerHTML = '<option value="">— Elige la entidad bancaria —</option>' +
      BANCOS.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    $('ctPagoMetodos').addEventListener('change', elegirMetodo);
    $('ctPagoConfirmar').addEventListener('click', confirmarPago);
    $('ctEmpBuscar').addEventListener('input', listaEmparejar);
    $('ctEmpLista').addEventListener('click', ev => {
      const b = ev.target.closest('[data-prod]');
      if (!b) return;
      asignar(S.empIdx, b.getAttribute('data-prod'), 'elegido');
      cerrarModal('ctEmpModal');
    });
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      ['ctCostoModal', 'ctEmpModal', 'ctPagoModal', 'ctFacModal', 'ctProvModal'].some(id => {
        const m = $(id);
        if (m && !m.classList.contains('hidden')) { cerrarModal(id); return true; }
        return false;
      });
    });

    // No perder una recepción a medias al cerrar la pestaña
    window.addEventListener('beforeunload', ev => {
      if (S.lineas.length) { ev.preventDefault(); ev.returnValue = ''; }
    });

    // Cargar al entrar en la sección (mismo patrón que ventas-pos.js)
    if (typeof window.showSection === 'function' && !window.showSection._conConta) {
      const original = window.showSection;
      const envuelta = function (id) {
        const r = original.apply(this, arguments);
        if (id === 'contabilidad' && permitido()) cargar();
        return r;
      };
      envuelta._conConta = true;
      envuelta._conMas = original._conMas;
      envuelta._conVentas = original._conVentas;
      window.showSection = envuelta;
    }

    setTimeout(avisosInicio, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();

  // Para las pruebas
  window.CasaMotaConta = { _PROVINCIAS: PROVINCIAS, _S: S, _cargar: cargar, _montoAPagar: montoAPagar, _aplicarLectura: aplicarLectura, _unirPaginas: unirPaginas, _lineas: () => S.lineas, _abrirCostos: abrirCostos, _formatoRnc: formatoRnc, _formatoTel: formatoTel, _provinciaDe: provinciaDe, _autoEmparejar: autoEmparejar, _editarRecepcion: editarRecepcion, _hoy: hoy, _sumarDias: sumarDias };
})();
