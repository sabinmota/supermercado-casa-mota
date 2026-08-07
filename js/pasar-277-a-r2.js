/**
 * Pasar imágenes base64 a R2 — Supermercado Casa Mota
 *
 * Recorre los productos cuya foto está guardada como base64 en la columna
 * `image` (o dentro del array `images`), la sube a R2 mediante el Worker y
 * sustituye el valor por la URL del CDN.
 *
 * Diseño a prueba de interrupciones: cada producto se procesa y se guarda de
 * forma independiente. No hay estado acumulado que se pueda perder, así que
 * cerrar la pestaña a mitad no deja nada a medias — el producto en curso, como
 * mucho, se reintenta en la siguiente pasada.
 */

// ─── Configuración ───────────────────────────────────────────────────────────
// Mismos valores que js/api.js (clave anon: sin permisos más allá de las RLS)
var SB_URL = 'https://lpnkdlfejsesxozowlda.supabase.co/rest/v1';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbmtkbGZlanNlc3hvem93bGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MTk2MTQsImV4cCI6MjA5NjQ5NTYxNH0.Q_n9DA1RaruL5oSVPJjbu4GX-wm_8s4UZM1HMw8IaBo';
var ADMIN_KEY = 'CM-Admin-X9k3mP19zJ';

var WORKER = 'https://r2-proxy-casamota.supermercadocasamota.workers.dev';
var CDN    = 'https://img.supermercadocasamota.com';

var HDR_LEER = {
  'Content-Type':  'application/json',
  'apikey':        SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
};
var HDR_ESCRIBIR = Object.assign({}, HDR_LEER, { 'x-admin-key': ADMIN_KEY });

var parar   = false;
var enCurso = false;

// ─── Registro en pantalla ────────────────────────────────────────────────────
function log(texto, clase) {
  var caja = document.getElementById('log');
  var linea = document.createElement('div');
  if (clase) linea.className = clase;
  var hora = new Date().toLocaleTimeString('es-ES');
  linea.textContent = '[' + hora + '] ' + texto;
  caja.appendChild(linea);
  caja.scrollTop = caja.scrollHeight;
}
function logOk(t)   { log('✔ ' + t, 'l-ok'); }
function logErr(t)  { log('✖ ' + t, 'l-err'); }
function logWarn(t) { log('⚠ ' + t, 'l-warn'); }
function logHd(t)   { log(t, 'l-hd'); }

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Convierte un dataURL base64 en binario, listo para el PUT. */
function dataUrlABinario(dataUrl) {
  if (!dataUrl || dataUrl.indexOf('data:') !== 0) return null;
  var partes = dataUrl.split(',');
  if (partes.length < 2 || !partes[1]) return null;
  var tipo = partes[0].replace('data:', '').replace(';base64', '') || 'image/jpeg';
  try {
    var bin = atob(partes[1]);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return { buffer: buf, tipo: tipo };
  } catch (e) {
    return null;
  }
}

function extension(tipo) {
  if (tipo.indexOf('png')  !== -1) return 'png';
  if (tipo.indexOf('webp') !== -1) return 'webp';
  if (tipo.indexOf('gif')  !== -1) return 'gif';
  return 'jpg';
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

/** Sube un binario a R2 y devuelve la URL pública. Lanza si algo falla. */
async function subirAR2(binario) {
  var clave = 'productos/' + uuid() + '.' + extension(binario.tipo);
  var ctrl  = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 30000);
  var res;
  try {
    res = await fetch(WORKER + '/put/' + clave, {
      method:  'PUT',
      headers: { 'Content-Type': binario.tipo },
      body:    binario.buffer,
      signal:  ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('Worker respondió ' + res.status);
  var datos = await res.json();
  if (!datos.ok) throw new Error(datos.error || 'el Worker rechazó la subida');
  // El Worker puede responder ok:true con size:0 si el cuerpo llegó vacío.
  // Guardar una URL apuntando a un objeto vacío sería peor que fallar aquí.
  if (!datos.size) throw new Error('R2 guardó un objeto vacío');
  return CDN + '/' + clave;
}

/** Cuenta filas con PostgREST usando Prefer: count=exact. */
async function contar(filtro) {
  var res = await fetch(SB_URL + '/products?select=id&' + filtro, {
    headers: Object.assign({}, HDR_LEER, { 'Prefer': 'count=exact', 'Range': '0-0' }),
  });
  var rango = res.headers.get('content-range') || '';
  var total = rango.split('/')[1];
  return total ? parseInt(total, 10) : 0;
}

// ─── Paso 1: comprobar estado ────────────────────────────────────────────────
async function comprobar() {
  logHd('=== COMPROBANDO ESTADO ===');
  var btn = document.getElementById('btn-comprobar');
  btn.disabled = true;

  try {
    var b64 = await contar('image=like.data:*');
    var cdn = await contar('image=like.http*');
    document.getElementById('s-b64').textContent = b64;
    document.getElementById('s-cdn').textContent = cdn;
    logOk('Productos en base64: ' + b64);
    logOk('Productos ya en CDN: ' + cdn);

    // Peso estimado a partir de una muestra REAL de 20 imágenes.
    // La primera versión multiplicaba por 5,9 KB, que era la media de la serie 15
    // calculada sobre las 1917 filas: al incluir las 1639 URLs cortas, esa media
    // quedaba diluida y no representaba a las imágenes base64. Medir una muestra
    // da una cifra fiable sin traerse los 278 registros completos.
    try {
      var resM = await fetch(SB_URL + '/products?select=image&image=like.data:*&limit=20', {
        headers: HDR_LEER,
      });
      var muestra = await resM.json();
      if (muestra && muestra.length) {
        var suma = 0;
        muestra.forEach(function (m) { suma += (m.image || '').length; });
        var mediaKB = suma / muestra.length / 1024;
        var totalMB = b64 * mediaKB / 1024;
        document.getElementById('s-peso').textContent = (Math.round(totalMB * 10) / 10) + ' MB';
        logOk('Media real por imagen: ' + Math.round(mediaKB) + ' KB (muestra de ' + muestra.length + ')');
      }
    } catch (e) {
      document.getElementById('s-peso').textContent = '—';
      logWarn('No se pudo estimar el peso: ' + e.message);
    }

    // Carrusel: hay que traerlo y mirarlo, no se puede filtrar por LIKE en JSONB
    var resEx = await fetch(SB_URL + '/products?select=id,images&images=not.is.null&limit=2000', {
      headers: HDR_LEER,
    });
    var filas = await resEx.json();
    var conB64 = 0;
    (filas || []).forEach(function (f) {
      var arr = normalizarArray(f.images);
      if (arr.some(function (v) { return typeof v === 'string' && v.indexOf('data:') === 0; })) conB64++;
    });
    document.getElementById('s-extra').textContent = conB64;
    logOk('Productos con carrusel en base64: ' + conB64);

    if (b64 === 0 && conB64 === 0) {
      logOk('No queda nada por migrar. Todo el catálogo está en R2.');
      document.getElementById('progreso-txt').textContent = 'Nada que migrar.';
    } else {
      document.getElementById('btn-migrar').disabled = false;
      log('Listo para migrar ' + (b64 + conB64) + ' productos.');
    }

    // Prueba del Worker: si no responde, mejor saberlo antes de empezar
    var ping = new TextEncoder().encode('ping-' + Date.now());
    var rp = await fetch(WORKER + '/put/test/ping.txt', {
      method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: ping,
    });
    var dp = await rp.json();
    if (dp.ok) logOk('Worker responde correctamente (' + dp.size + ' bytes escritos).');
    else { logErr('El Worker falló: ' + dp.error); document.getElementById('btn-migrar').disabled = true; }

  } catch (e) {
    logErr('Error al comprobar: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

/** `images` puede llegar como array, como string JSON, o como null. */
function normalizarArray(bruto) {
  if (!bruto) return [];
  if (Array.isArray(bruto)) return bruto;
  if (typeof bruto === 'string') {
    try { var p = JSON.parse(bruto); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
}

// ─── Paso 2: migrar ──────────────────────────────────────────────────────────
async function migrar() {
  if (enCurso) return;
  enCurso = true;
  parar   = false;
  document.getElementById('btn-migrar').disabled = true;
  document.getElementById('btn-parar').disabled  = false;
  logHd('=== MIGRACIÓN INICIADA ===');

  var hechos = 0, fallos = 0, saltados = 0, ahorro = 0;
  // Total de partida, fijado UNA vez. La barra no puede dividir entre el
  // contador de pendientes porque ese baja a medida que migramos: el
  // porcentaje se quedaría clavado y nunca llegaría al 100 %.
  var totalInicial = parseInt(document.getElementById('s-b64').textContent, 10) || 0;
  if (!totalInicial) { logWarn('Comprueba el estado antes de migrar.'); }

  try {
    while (!parar) {
      // Se pide un lote pequeño cada vez, en lugar de la lista completa al
      // principio: así el progreso real se refleja aunque otro proceso escriba.
      var res = await fetch(
        SB_URL + '/products?select=id,name,image,images&image=like.data:*&limit=5',
        { headers: HDR_LEER }
      );
      if (!res.ok) throw new Error('Supabase respondió ' + res.status);
      var lote = await res.json();

      if (!lote.length) { log('No quedan productos con image en base64.'); break; }

      for (var i = 0; i < lote.length; i++) {
        if (parar) break;
        var p = lote[i];
        var nombre = (p.name || p.id).slice(0, 42);

        var binario = dataUrlABinario(p.image);
        if (!binario) {
          logWarn('Saltado (base64 ilegible): ' + nombre);
          saltados++;
          // Marcarlo a NULL evitaría un bucle infinito con este producto,
          // pero es destructivo. Preferimos avisar y parar.
          logErr('Para evitar un bucle infinito, se detiene aquí. Revisa este producto a mano.');
          parar = true;
          break;
        }

        var pesoAntes = p.image.length;

        try {
          var url = await subirAR2(binario);
          var cambios = { image: url };

          // Si el carrusel de este producto también tiene base64, se migra
          // en la misma pasada: así no hay que recorrer la tabla dos veces.
          var extras = normalizarArray(p.images);
          if (extras.length) {
            var nuevos = [];
            for (var j = 0; j < extras.length; j++) {
              var v = extras[j];
              if (typeof v === 'string' && v.indexOf('data:') === 0) {
                var bx = dataUrlABinario(v);
                if (bx) {
                  try { nuevos.push(await subirAR2(bx)); }
                  catch (ex) { logWarn('  extra no subida, se conserva base64: ' + ex.message); nuevos.push(v); }
                } else { nuevos.push(v); }
              } else {
                nuevos.push(v);
              }
            }
            cambios.images = nuevos;
          }

          var up = await fetch(SB_URL + '/products?id=eq.' + encodeURIComponent(p.id), {
            method:  'PATCH',
            headers: HDR_ESCRIBIR,
            body:    JSON.stringify(cambios),
          });
          if (!up.ok) {
            var txt = await up.text();
            throw new Error('PATCH ' + up.status + ': ' + txt.slice(0, 120));
          }

          hechos++;
          ahorro += pesoAntes;
          logOk(nombre + ' → ' + Math.round(pesoAntes / 1024) + ' KB migrados');
        } catch (e) {
          fallos++;
          logErr(nombre + ': ' + e.message);
          if (fallos >= 5) {
            logErr('5 fallos seguidos. Se detiene para no insistir en vano.');
            parar = true;
            break;
          }
        }

        actualizarBarra(hechos, fallos, saltados, totalInicial);
      }
    }
  } catch (e) {
    logErr('Migración detenida: ' + e.message);
  }

  // ── Fase 2: carruseles huérfanos ─────────────────────────────────────────
  // La fase 1 solo alcanza los productos cuya `image` está en base64, y de paso
  // les migra el carrusel. Pero un producto puede tener la imagen principal ya
  // en el CDN y aún así conservar base64 en `images` (48 casos detectados).
  // Sin esta fase quedarían fuera y el catálogo no estaría unificado.
  if (!parar) {
    logHd('=== FASE 2: CARRUSELES RESTANTES ===');
    try {
      var resC = await fetch(
        SB_URL + '/products?select=id,name,images&images=not.is.null&image=like.http*&limit=2000',
        { headers: HDR_LEER }
      );
      var filasC = await resC.json();
      var pendientes = (filasC || []).filter(function (f) {
        return normalizarArray(f.images).some(function (v) {
          return typeof v === 'string' && v.indexOf('data:') === 0;
        });
      });

      if (!pendientes.length) {
        logOk('No hay carruseles en base64. Nada que hacer.');
      } else {
        log('Carruseles por migrar: ' + pendientes.length);
        for (var k = 0; k < pendientes.length && !parar; k++) {
          var pc  = pendientes[k];
          var nom = (pc.name || pc.id).slice(0, 42);
          var arr = normalizarArray(pc.images);
          var res2 = [];
          var pesoC = 0;
          var fallo = false;

          for (var m = 0; m < arr.length; m++) {
            var vv = arr[m];
            if (typeof vv === 'string' && vv.indexOf('data:') === 0) {
              var bb = dataUrlABinario(vv);
              if (!bb) { res2.push(vv); continue; }
              try {
                pesoC += vv.length;
                res2.push(await subirAR2(bb));
              } catch (ec) {
                logWarn('  ' + nom + ': una extra no subió (' + ec.message + '), se conserva');
                res2.push(vv);
                fallo = true;
              }
            } else {
              res2.push(vv);
            }
          }

          try {
            var upc = await fetch(SB_URL + '/products?id=eq.' + encodeURIComponent(pc.id), {
              method: 'PATCH', headers: HDR_ESCRIBIR, body: JSON.stringify({ images: res2 }),
            });
            if (!upc.ok) throw new Error('PATCH ' + upc.status);
            ahorro += pesoC;
            if (fallo) { logWarn(nom + ' → carrusel parcialmente migrado'); }
            else       { logOk(nom + ' → carrusel migrado (' + Math.round(pesoC / 1024) + ' KB)'); }
          } catch (ec2) {
            fallos++;
            logErr(nom + ' (carrusel): ' + ec2.message);
          }
        }
      }
    } catch (e) {
      logErr('Fase 2 detenida: ' + e.message);
    }
  }

  logHd('=== FIN ===');
  logOk('Migrados: ' + hechos + ' · Fallos: ' + fallos + ' · Saltados: ' + saltados);
  if (ahorro) logOk('Retirados de la base de datos: ' + (Math.round(ahorro / 1024 / 1024 * 100) / 100) + ' MB');
  if (parar) logWarn('Parada anticipada. Pulsa «Migrar» de nuevo para continuar donde iba.');

  enCurso = false;
  document.getElementById('btn-migrar').disabled = false;
  document.getElementById('btn-parar').disabled  = true;
  comprobar();
}

function actualizarBarra(hechos, fallos, saltados, totalInicial) {
  var total = totalInicial || 1;
  var pct   = Math.min(100, Math.round((hechos + fallos + saltados) / total * 100));
  var barra = document.getElementById('barra');
  barra.style.width = pct + '%';
  barra.textContent = pct + '%';
  document.getElementById('progreso-txt').textContent =
    hechos + ' migrados · ' + fallos + ' fallos · ' + saltados + ' saltados' +
    ' · ' + (total - hechos - fallos - saltados) + ' restantes';
}

// ─── Arranque ────────────────────────────────────────────────────────────────
document.getElementById('btn-comprobar').addEventListener('click', comprobar);
document.getElementById('btn-migrar').addEventListener('click', migrar);
document.getElementById('btn-parar').addEventListener('click', function () {
  parar = true;
  logWarn('Parando tras el producto en curso…');
});

log('Herramienta lista. Pulsa «Comprobar estado» para empezar.');
