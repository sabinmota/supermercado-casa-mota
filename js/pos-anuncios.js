/* ════════════════════════════════════════════════════════════════════════════
 * ANUNCIO DE LA APP EN LA FRANJA DEL POS · Casa Mota · POS-3 (2026-09-23)
 *
 * Es el ÚNICO anuncio diseñado (decisión del dueño: «ya no me hagas ningún
 * diseño de publicidad excepto el de la app»). La franja de abajo del POS lo
 * alterna con las OFERTAS DEL CATÁLOGO, que salen solas de los productos con
 * precio anterior mayor que el actual.
 *
 * Para quitarlo, BORRE el bloque (no se oculta: se elimina) y la franja
 * mostrará solo las ofertas.
 * ════════════════════════════════════════════════════════════════════════════ */
window.CASAMOTA_ANUNCIOS_POS = [
  {
    tipo:    'app',
    id:      'app-casamota',
    imagen:  'images/promo/app-captura.jpg',
    titulo:  'Haz tu compra desde el celular',
    texto:   'Pide en la app Casa Mota y te lo llevamos a tu casa',
    web:     'supermercadocasamota.com',
    /* ⚠️ La app está EN REVISIÓN en Apple. Cuando esté publicada, cambie
     *    esta línea por 'Disponible en App Store'. */
    sello:   'Muy pronto en App Store'
  }
];
