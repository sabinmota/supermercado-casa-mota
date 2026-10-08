/* Arma volante-imprimir.zip EN EL NAVEGADOR con los archivos de la carpeta
 * volante-imprimir/ y lo descarga. Antes de descargar, abre el ZIP recién hecho
 * y comprueba que están todos los archivos con su tamaño: si falta alguno, NO
 * descarga y dice cuál. */
(function () {
  'use strict';
  var CARPETA = 'volante-imprimir/';
  var ARCHIVOS = [
    'VOLANTE.html',
    'LEEME.txt',
    'imagenes/logo-casamota.jpg',
    'imagenes/aguacate.jpg',
    'imagenes/queso-hoja.jpg',
    'imagenes/arroz.jpg',
    'imagenes/aceite-crisol-galon.jpg',
    'imagenes/app-captura.jpg',
    'recursos/volante.css',
    'recursos/volante.js',
    'recursos/qrcode.js',
    'recursos/fontawesome/css/all.min.css',
    'recursos/fontawesome/webfonts/fa-solid-900.woff2',
    'recursos/fontawesome/webfonts/fa-brands-400.woff2',
    'recursos/fontawesome/webfonts/fa-regular-400.woff2',
    'recursos/poppins/poppins-400.woff2',
    'recursos/poppins/poppins-500.woff2',
    'recursos/poppins/poppins-600.woff2',
    'recursos/poppins/poppins-700.woff2',
    'recursos/poppins/poppins-800.woff2',
    'recursos/poppins/poppins-900.woff2'
  ];

  var btn = document.getElementById('btn-zip');
  var estado = document.getElementById('estado');

  function decir(txt, clase) {
    estado.className = clase || '';
    estado.textContent = txt;
  }

  async function armarZip() {
    if (typeof JSZip !== 'function') throw new Error('No cargó el compresor (revise la conexión a internet).');
    var zip = new JSZip();
    var tamanos = {};
    for (var i = 0; i < ARCHIVOS.length; i++) {
      var ruta = ARCHIVOS[i];
      decir('Preparando ' + (i + 1) + ' de ' + ARCHIVOS.length + ': ' + ruta);
      var r = await fetch(CARPETA + ruta, { cache: 'no-store' });
      if (!r.ok) throw new Error('Falta el archivo ' + ruta + ' (error ' + r.status + ').');
      var datos = await r.arrayBuffer();
      if (!datos.byteLength) throw new Error('El archivo ' + ruta + ' está vacío.');
      tamanos[ruta] = datos.byteLength;
      zip.file(CARPETA + ruta, datos);
    }
    decir('Comprimiendo…');
    var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    // Comprobación: se vuelve a abrir el ZIP y se revisa archivo por archivo
    var check = await JSZip.loadAsync(blob);
    for (var j = 0; j < ARCHIVOS.length; j++) {
      var f = check.file(CARPETA + ARCHIVOS[j]);
      if (!f) throw new Error('El ZIP no contiene ' + ARCHIVOS[j] + '.');
      var contenido = await f.async('uint8array');
      if (contenido.length !== tamanos[ARCHIVOS[j]]) throw new Error('El archivo ' + ARCHIVOS[j] + ' salió dañado en el ZIP.');
    }
    return blob;
  }

  function descargar(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'volante-imprimir.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  btn.addEventListener('click', async function () {
    btn.disabled = true;
    try {
      var blob = await armarZip();
      descargar(blob);
      decir('✔ Listo: volante-imprimir.zip (' + (blob.size / 1024 / 1024).toFixed(2) + ' MB)\n' +
            'Comprobado: contiene los ' + ARCHIVOS.length + ' archivos completos.\n' +
            'Búsquelo en su carpeta de Descargas.', 'ok');
    } catch (e) {
      decir('✖ No se pudo crear el ZIP: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Solo para la prueba automática: arma el ZIP sin descargarlo
  window._probarZip = armarZip;
})();
