/* POS-21 · diagnóstico temporal de la Star TSP100. Se BORRA al terminar. */
(function () {
  'use strict';

  var TICKET =
    '<div class="c b grande">SUPERMERCADO CASA MOTA</div>' +
    '<div class="c">RNC: 1-1301137-5</div>' +
    '<hr>' +
    '<div class="c b">PRUEBA DE IMPRESORA · VARIANTE {V}</div>' +
    '<hr>' +
    '<div class="f"><span>Leche Carnation 307g</span><span>130.00</span></div>' +
    '<div class="f"><span>Arroz 5 lb</span><span>250.00</span></div>' +
    '<hr>' +
    '<div class="f b grande"><span>TOTAL</span><span>RD$ 380.00</span></div>' +
    '<div class="barra"></div>' +
    '<div class="c">¡Gracias por preferirnos!</div>';

  var BASE = 'body{margin:0;color:#000;background:#fff}' +
    '.c{text-align:center}.b{font-weight:700}.grande{font-size:15px}' +
    '.f{display:flex;justify-content:space-between;gap:6px}' +
    'hr{border:0;border-top:1px dashed #000;margin:4px 0}' +
    '.barra{height:10mm;background:#000;margin:3mm 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}';

  var VARIANTES = {
    A: { css: 'body{margin:0;font:bold 28px Arial,sans-serif;color:#000}',
         html: '<p>PRUEBA A</p><p>CASA MOTA</p><p>1234567890</p>' },
    B: { css: '@page{margin:0}' + BASE +
              '.t{width:72mm;margin:0 auto;padding:3mm 0 8mm;font-family:"Courier New",monospace;font-size:11.5px;line-height:1.35}' },
    C: { css: '@page{margin:0}' + BASE +
              '.t{width:64mm;margin:0 auto;padding:3mm 4mm 8mm;font-family:"Courier New",monospace;font-size:12px;line-height:1.35}' },
    D: { css: '@page{size:72mm 200mm;margin:0}' + BASE +
              '.t{width:68mm;margin:0 auto;padding:3mm 2mm 8mm;font-family:"Courier New",monospace;font-size:12px;line-height:1.35}' },
    E: { css: '@page{margin:0}' + BASE +
              '.t{width:64mm;margin:0 auto;padding:3mm 4mm 8mm;font-family:Arial,sans-serif;font-weight:700;font-size:13px;line-height:1.4}' },
    /* Ronda 2 · parten de A (que SÍ imprime) y cambian UNA sola cosa cada una */
    F: { css: BASE + '.t{font-family:Arial,sans-serif;font-weight:700;font-size:14px;line-height:1.4}' },
    G: { css: '@page{margin:0}' + BASE + '.t{font-family:Arial,sans-serif;font-weight:700;font-size:14px;line-height:1.4}' },
    H: { css: BASE + '.t{font-family:"Courier New",monospace;font-size:12px;line-height:1.35}' },
    I: { css: BASE + '.t{width:72mm;font-family:Arial,sans-serif;font-weight:700;font-size:14px;line-height:1.4}' }
  };

  function imprimir(v) {
    var d = VARIANTES[v];
    var cuerpo = d.html || ('<div class="t">' + TICKET.replace('{V}', v) + '</div>');
    var w = window.open('', '_blank', 'width=420,height=700');
    if (!w) { alert('El navegador bloqueó la ventana. Permita las ventanas emergentes para este sitio.'); return; }
    w.document.open();
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prueba ' + v +
      '</title><style>' + d.css + '</style></head><body>' + cuerpo + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 300);
  }

  var bs = document.querySelectorAll('button[data-v]');
  for (var i = 0; i < bs.length; i++) {
    bs[i].addEventListener('click', function (ev) { imprimir(ev.currentTarget.getAttribute('data-v')); });
  }
})();
