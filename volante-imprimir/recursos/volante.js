/* Volante de la app · genera los códigos QR que llevan al App Store.
 * El QR se dibuja como SVG (vectorial): se imprime nítido a cualquier tamaño. */
(function () {
  'use strict';
  var URL_APP = 'https://apps.apple.com/app/casa-mota/id6811365677';

  function pintarQR(id) {
    var caja = document.getElementById(id);
    if (!caja) return;
    if (typeof qrcode !== 'function') {
      caja.textContent = 'QR no disponible (sin conexión)';
      return;
    }
    var qr = qrcode(0, 'M');           // corrección de errores media: aguanta papel doblado o manchado
    qr.addData(URL_APP);
    qr.make();
    caja.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  pintarQR('qr-frente');
  pintarQR('qr-dorso');
})();
