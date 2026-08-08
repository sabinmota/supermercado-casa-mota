/**
 * Verificar imágenes del catálogo — Supermercado Casa Mota
 *
 * SOLO LECTURA. No escribe nada, ni en R2 ni en Supabase.
 *
 * Por qué existe: la migración sustituyó el base64 por la URL del CDN, así que
 * ya no hay copia de seguridad en la base de datos. Si alguna imagen no llegó
 * bien a R2, esa foto está perdida y hay que volver a subirla. Esta herramienta
 * localiza exactamente cuáles.
 *
 * Cómo comprueba cada imagen: con `new Image()`, no con fetch.
 * El dominio img.supermercadocasamota.com no envía cabeceras CORS, de modo que
 * un fetch desde esta página no podría leer ni el estado ni el tamaño (y en
 * modo no-cors la respuesta es opaca: un 404 parecería correcto). Cargar la
 * imagen no necesita CORS y además comprueba algo mejor que el código 200:
 * que el navegador consiga descodificar el fichero. Un objeto de 0 bytes o un
 * JPEG truncado dispara `onerror`, que es justo el caso que buscamos.
 *
 * Se puede parar en cualquier momento. Si se para a mitad, la siguiente pasada
 * continúa donde iba. Si la pasada TERMINA, la caché se borra para que la
 * próxima vez se compruebe todo de nuevo desde cero.
 *
 * Ese matiz importa: la primera versión guardaba la caché siempre, así que al
 * relanzar una comprobación ya completada no quedaba nada por revisar y la
 * pantalla mostraba «0 de 0» con las tarjetas vacías. Parecía roto y, peor aún,
 * ocultaba el resultado. La caché sirve para reanudar, no para saltarse trabajo.
 */

// ─── Configuración (mismos valores que js/api.js) ────────────────────────────
var SB_URL = 'https://lpnkdlfejsesxozowlda.supabase.co/rest/v1';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo';

var CDN = 'https://img.supermercadocasamota.com';

var HDR_LEER = {
  'Content-Type':  'application/json',
  'apikey':        SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
};

var PAGINA      = 1000;   // filas por página al leer Supabase
var SIMULTANEAS = 6;      // imágenes comprobadas a la vez
var ESPERA_MS   = 20000;  // si no carga en 20 s, se da por rota
var CLAVE_CACHE  = 'cm_verificadas_ok';
var CLAVE_ESTADO = 'cm_verificadas_estado';   // 'parcial' | 'completa'

var parar   = false;
var enCurso = false;

// ─── Registro en pantalla ────────────────────────────────────────────────────
function log(texto, clase) {
  var caja = document.getElementById('log');
  var linea = document.createElement('div');
  if (clase) linea.className = clase;
  linea.textContent = '[' + new Date().toLocaleTimeString('es-ES') + '] ' + texto;
  caja.appendChild(linea);
  caja.scrollTop = caja.scrollHeight;
}
function logOk(t)   { log('✔ ' + t, 'l-ok'); }
function logErr(t)  { log('✖ ' + t, 'l-err'); }
function logWarn(t) { log('⚠ ' + t, 'l-warn'); }
function logHd(t)   { log(t, 'l-hd'); }

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** El campo `images` puede llegar como array, como texto JSON o como null. */
function normalizarArray(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.filter(Boolean);
  if (typeof valor === 'string') {
    try {
      var p = JSON.parse(valor);
      return Array.isArray(p) ? p.filter(Boolean) : [];
    } catch (e) { return []; }
  }
  return [];
}

function esCDN(url)  { return typeof url === 'string' && url.indexOf(CDN) === 0; }
function esHTTP(url) { return typeof url === 'string' && /^https?:\/\//.test(url); }

/**
 * Caché de URLs ya verificadas, SOLO para reanudar una pasada interrumpida.
 * Si la última pasada llegó al final, se ignora y se borra: una comprobación
 * nueva debe comprobar de verdad, no dar por bueno lo de ayer.
 */
function leerCache() {
  try {
    if (localStorage.getItem(CLAVE_ESTADO) !== 'parcial') {
      localStorage.removeItem(CLAVE_CACHE);
      return new Set();
    }
    var bruto = localStorage.getItem(CLAVE_CACHE);
    var arr = bruto ? JSON.parse(bruto) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) { return new Set(); }
}
function guardarCache(conjunto, estado) {
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(Array.from(conjunto)));
    localStorage.setItem(CLAVE_ESTADO, estado);
  } catch (e) {
    // Si no hay hueco, seguimos sin caché: es una comodidad, no un requisito.
  }
}
function limpiarCache() {
  try {
    localStorage.removeItem(CLAVE_CACHE);
    localStorage.removeItem(CLAVE_ESTADO);
  } catch (e) { /* nada que hacer */ }
}

/**
 * Comprueba una URL cargándola como imagen.
 * Devuelve { ok, ancho, alto, motivo } y nunca lanza.
 */
function comprobarImagen(url) {
  return new Promise(function (resolve) {
    var img = new Image();
    var listo = false;
    var timer = setTimeout(function () {
      if (listo) return;
      listo = true;
      img.src = '';                       // corta la descarga pendiente
      resolve({ ok: false, motivo: 'no respondió en ' + (ESPERA_MS / 1000) + ' s' });
    }, ESPERA_MS);

    img.onload = function () {
      if (listo) return;
      listo = true;
      clearTimeout(timer);
      if (!img.naturalWidth || !img.naturalHeight) {
        resolve({ ok: false, motivo: 'fichero vacío o ilegible' });
      } else {
        resolve({ ok: true, ancho: img.naturalWidth, alto: img.naturalHeight });
      }
    };
    img.onerror = function () {
      if (listo) return;
      listo = true;
      clearTimeout(timer);
      resolve({ ok: false, motivo: 'no existe o está corrupta (404 / 0 bytes)' });
    };

    // Sin cache-buster a propósito: queremos ver lo mismo que ve un cliente,
    // incluida la caché del CDN.
    img.src = url;
  });
}

// ─── Lectura del catálogo ────────────────────────────────────────────────────

/** Trae todos los productos por páginas. Devuelve el array completo. */
async function traerProductos() {
  var todos  = [];
  var desde  = 0;
  var seguir = true;

  while (seguir && !parar) {
    var url = SB_URL + '/products?select=id,name,image,images,deleted'
            + '&order=name.asc&limit=' + PAGINA + '&offset=' + desde;
    var res = await fetch(url, { headers: HDR_LEER });
    if (!res.ok) throw new Error('Supabase respondió ' + res.status);
    var filas = await res.json();
    if (!filas || !filas.length) break;
    todos = todos.concat(filas);
    log('Leídos ' + todos.length + ' productos…');
    seguir = filas.length === PAGINA;
    desde += PAGINA;
  }
  return todos;
}

/**
 * Convierte los productos en una lista plana de tareas de comprobación.
 * Cada URL distinta se comprueba una sola vez aunque la compartan productos.
 */
function construirTareas(productos, cacheOk) {
  var tareas = [];
  var vistas = new Set();
  var resumen = {
    sinImagen: 0, base64: 0, relativas: 0, otroHost: 0, cacheadas: 0,
    problemas: [],   // filas para el informe que NO se pueden pedir al CDN
  };

  productos.forEach(function (p) {
    var lista = [{ url: p.image, tipo: 'principal' }];
    normalizarArray(p.images).forEach(function (u) {
      lista.push({ url: u, tipo: 'carrusel' });
    });

    lista.forEach(function (item) {
      var u = item.url;

      if (!u) {
        if (item.tipo === 'principal') {
          resumen.sinImagen++;
          resumen.problemas.push({
            nombre: p.name || '(sin nombre)', tipo: 'principal', url: '',
            borrado: p.deleted === true,
            motivo: 'el producto no tiene imagen asignada',
          });
        }
        return;
      }
      if (u.indexOf('data:') === 0) {
        resumen.base64++;
        resumen.problemas.push({
          nombre: p.name || '(sin nombre)', tipo: item.tipo, url: '(base64)',
          borrado: p.deleted === true,
          motivo: 'sigue en base64, no se migró a R2',
        });
        logWarn('Todavía en base64: ' + p.name + ' (' + item.tipo + ')');
        return;
      }
      if (!esHTTP(u)) {
        resumen.relativas++;
        resumen.problemas.push({
          nombre: p.name || '(sin nombre)', tipo: item.tipo, url: u,
          borrado: p.deleted === true,
          motivo: 'ruta relativa: el fichero no existe (' + u + ')',
        });
        logWarn('Ruta relativa (no es una URL): ' + p.name + ' → ' + u);
        return;
      }
      if (!esCDN(u)) resumen.otroHost++;

      if (cacheOk.has(u)) { resumen.cacheadas++; return; }
      if (vistas.has(u))  { return; }
      vistas.add(u);

      tareas.push({
        url:      u,
        tipo:     item.tipo,
        nombre:   p.name || '(sin nombre)',
        id:       p.id,
        borrado:  p.deleted === true,
        enCDN:    esCDN(u),
      });
    });
  });

  return { tareas: tareas, resumen: resumen };
}

// ─── Barra de progreso ───────────────────────────────────────────────────────
// El total se fija UNA vez al empezar. En la herramienta anterior lo calculaba
// contra un contador que iba bajando y la barra nunca llegaba al 100 %.
var totalTareas = 0;
function actualizarBarra(hechas) {
  var pct = totalTareas ? Math.round(hechas / totalTareas * 100) : 0;
  var barra = document.getElementById('barra');
  barra.style.width = pct + '%';
  barra.textContent = pct + '%';
  document.getElementById('progreso').textContent =
    hechas + ' de ' + totalTareas + ' imágenes comprobadas.';
}

// ─── Informe de las rotas ────────────────────────────────────────────────────
function mostrarInforme(rotas) {
  var previo = document.getElementById('informe');
  if (previo) previo.remove();
  if (!rotas.length) return;

  var sec = document.createElement('section');
  sec.id = 'informe';

  var h = document.createElement('h2');
  h.textContent = 'Imágenes que hay que revisar (' + rotas.length + ')';
  sec.appendChild(h);

  var p = document.createElement('p');
  p.className = 'sub';
  p.textContent = 'Edita cada producto en el panel de administración y sube la '
                + 'foto de nuevo, comprimida con Squoosh.';
  sec.appendChild(p);

  var tabla = document.createElement('table');
  var cab = document.createElement('tr');
  ['Producto', 'Tipo', 'Motivo'].forEach(function (t) {
    var th = document.createElement('th');
    th.textContent = t;
    cab.appendChild(th);
  });
  tabla.appendChild(cab);

  rotas.forEach(function (r) {
    var tr = document.createElement('tr');
    [r.nombre + (r.borrado ? ' (borrado)' : ''), r.tipo, r.motivo].forEach(function (t) {
      var td = document.createElement('td');
      td.textContent = t;
      tr.appendChild(td);
    });
    tabla.appendChild(tr);
  });
  sec.appendChild(tabla);

  var btn = document.createElement('button');
  btn.className = 'sec';
  btn.style.marginTop = '14px';
  btn.textContent = 'Copiar la lista';
  btn.addEventListener('click', function () {
    var texto = rotas.map(function (r) {
      return r.nombre + ' · ' + r.tipo + ' · ' + r.motivo + ' · ' + r.url;
    }).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        btn.textContent = 'Copiada ✓';
      }, function () {
        btn.textContent = 'No se pudo copiar';
      });
    }
  });
  sec.appendChild(btn);

  document.querySelector('.wrap').appendChild(sec);
}

// ─── Proceso principal ───────────────────────────────────────────────────────
async function verificar() {
  if (enCurso) return;
  enCurso = true;
  parar   = false;

  var btnIr    = document.getElementById('btn-ir');
  var btnParar = document.getElementById('btn-parar');
  btnIr.disabled = true;
  btnParar.disabled = false;

  var revisadas = 0, correctas = 0, rotasN = 0, noCDN = 0;
  var rotas = [];
  var cacheOk = leerCache();

  // Las que se omiten por estar ya verificadas siguen contando como revisadas y
  // correctas: son parte del catálogo y el usuario espera verlas en el total.
  var baseRevisadas = 0, baseCorrectas = 0, baseNoCDN = 0;

  function pintar() {
    document.getElementById('s-tot').textContent   = baseRevisadas + revisadas;
    document.getElementById('s-ok').textContent    = baseCorrectas + correctas;
    document.getElementById('s-mal').textContent   = rotasN;
    document.getElementById('s-otras').textContent = baseNoCDN + noCDN;
  }

  try {
    logHd('=== VERIFICANDO EL CATÁLOGO ===');
    if (cacheOk.size) {
      log('Hay ' + cacheOk.size + ' imágenes ya verificadas en pasadas anteriores; se omiten.');
    }

    var productos = await traerProductos();
    if (parar) { logWarn('Parado durante la lectura del catálogo.'); return; }
    logOk('Productos leídos: ' + productos.length);

    var plan    = construirTareas(productos, cacheOk);
    var tareas  = plan.tareas;
    var resumen = plan.resumen;

    logOk('URLs distintas por comprobar: ' + tareas.length);
    if (resumen.cacheadas) logOk('Omitidas por estar ya verificadas: ' + resumen.cacheadas);
    if (resumen.sinImagen) logWarn('Productos sin imagen principal: ' + resumen.sinImagen);
    if (resumen.base64)    logErr('Valores todavía en base64: ' + resumen.base64);
    if (resumen.relativas) logErr('Rutas relativas (imágenes que no existen): ' + resumen.relativas);
    if (resumen.otroHost)  logWarn('URLs fuera del CDN: ' + resumen.otroHost);

    // Lo cacheado se da por correcto y se refleja ya en las tarjetas.
    // Los problemas detectados al leer (sin imagen, base64, rutas relativas)
    // cuentan como revisados aunque no se pidan al CDN: si no, las tarjetas no
    // suman —salía «2065 revisadas, 2065 correctas, 2 rotas»— y en una
    // herramienta de verificación los números deben sostenerse solos.
    baseRevisadas = resumen.cacheadas + resumen.problemas.length;
    baseCorrectas = resumen.cacheadas;
    // El base64 y las rutas relativas son problemas reales: no se pueden
    // comprobar contra el CDN, pero deben aparecer en el informe igualmente.
    resumen.problemas.forEach(function (pr) { rotas.push(pr); rotasN++; });
    pintar();

    totalTareas = tareas.length;
    actualizarBarra(0);

    if (!totalTareas) {
      if (rotasN) {
        logErr('No hay URLs nuevas que comprobar, pero hay ' + rotasN + ' problemas en la base de datos (ver abajo).');
      } else {
        logOk('No hay nada nuevo que comprobar.');
      }
      mostrarInforme(rotas);
      return;
    }

    // Cola con varias comprobaciones en paralelo. Cada trabajador coge la
    // siguiente tarea libre, así una imagen lenta no bloquea a las demás.
    var siguiente = 0;
    async function trabajador() {
      while (!parar) {
        var i = siguiente++;
        if (i >= tareas.length) return;
        var t = tareas[i];

        var r = await comprobarImagen(t.url);
        revisadas++;
        if (!t.enCDN) noCDN++;

        if (r.ok) {
          correctas++;
          cacheOk.add(t.url);
        } else {
          rotasN++;
          t.motivo = r.motivo;
          rotas.push(t);
          logErr(t.nombre + ' → ' + t.tipo + ' ROTA: ' + r.motivo);
        }

        pintar();
        actualizarBarra(revisadas);
        // Guardado periódico: si se cierra la pestaña, no se pierde la pasada.
        // Se marca 'parcial' porque aún no hemos llegado al final.
        if (revisadas % 50 === 0) guardarCache(cacheOk, 'parcial');
      }
    }

    var equipo = [];
    for (var k = 0; k < Math.min(SIMULTANEAS, tareas.length); k++) equipo.push(trabajador());
    await Promise.all(equipo);

    // Solo se guarda la caché si la pasada quedó a medias. Si terminó, se borra:
    // así la próxima comprobación vuelve a mirarlo todo de verdad.
    if (parar) guardarCache(cacheOk, 'parcial');
    else       limpiarCache();

    logHd('=== FIN ===');
    logOk('Revisadas: ' + (baseRevisadas + revisadas) + ' · Correctas: ' +
          (baseCorrectas + correctas) + ' · Rotas: ' + rotasN);
    if (parar) logWarn('Parado antes de terminar: quedaban ' + (totalTareas - revisadas) + '.');

    if (rotasN) {
      logErr('Hay ' + rotasN + ' imágenes perdidas. Abajo tienes la lista con los nombres.');
    } else if (!parar) {
      logOk('Todas las imágenes del catálogo se cargan correctamente. Nada perdido.');
    }
    mostrarInforme(rotas);

  } catch (e) {
    logErr('Error: ' + (e && e.message ? e.message : e));
  } finally {
    enCurso = false;
    btnIr.disabled = false;
    btnParar.disabled = true;
  }
}

// ─── Enganches ───────────────────────────────────────────────────────────────
document.getElementById('btn-ir').addEventListener('click', verificar);

document.getElementById('btn-parar').addEventListener('click', function () {
  parar = true;
  logWarn('Parando… se termina lo que ya está en vuelo.');
});

var btnCero = document.getElementById('btn-cero');
if (btnCero) {
  btnCero.addEventListener('click', function () {
    limpiarCache();
    logOk('Memoria borrada. La próxima comprobación revisará todo el catálogo.');
  });
}

log('Herramienta lista. Es solo lectura: no cambia nada.');

// Si quedó una pasada a medias, decirlo antes de que el usuario pulse.
(function avisarPendiente() {
  try {
    if (localStorage.getItem(CLAVE_ESTADO) === 'parcial') {
      var bruto = localStorage.getItem(CLAVE_CACHE);
      var arr = bruto ? JSON.parse(bruto) : [];
      if (arr && arr.length) {
        logWarn('La última comprobación quedó a medias (' + arr.length +
                ' ya verificadas). Al pulsar «Verificar todas» continuará donde iba. ' +
                'Si prefieres revisarlo todo otra vez, pulsa «Empezar de cero».');
      }
    }
  } catch (e) { /* sin aviso */ }
})();
