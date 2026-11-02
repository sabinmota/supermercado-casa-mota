/**
 * SUPERMERCADO CASA MOTA — RUTAS QUE NO SE PUBLICAN (Cloudflare Pages)
 * --------------------------------------------------------------------
 * 524 · Auditoría de seguridad (2026-11-02). Cloudflare Pages publica TODO lo
 * que hay en el repositorio. Aquí se devuelve 404 a lo que es de uso interno:
 * respaldos viejos del código, notas, SQL, scripts de la tienda y páginas de
 * diagnóstico o migración. Siguen en GitHub y en el ordenador; solo dejan de
 * verse desde Internet.
 *
 * Esta función SOLO se ejecuta en las rutas que lista `_routes.json` (raíz del
 * proyecto). Si algún día se bloquea una ruta nueva, hay que añadirla en los
 * DOS sitios: aquí (la regla) y en `_routes.json` (para que se ejecute).
 * Las 27.000 imágenes y el resto de la tienda NO pasan por aquí.
 */

const BLOQUEADAS = [
  /^\/(backup|migration|documentos|seguridad|sync|claude-skills)(\/|$)/,
  /^\/supabase_[^/]*$/,
  /\.(sql|md|py|bat)$/,
  /^\/(importar-backup|diagnostico-categorias|diag2|migracion-codimentos|capturas-ipad-temp|preview-slogans|app-store-assets)(\.html)?$/,
];

export async function onRequest(context) {
  let ruta;
  try {
    ruta = decodeURIComponent(new URL(context.request.url).pathname);
  } catch {
    return new Response('Petición no válida', { status: 400 });
  }
  ruta = ruta.replace(/\/{2,}/g, '/').toLowerCase();

  if (BLOQUEADAS.some(r => r.test(ruta))) {
    return new Response('No encontrado', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
  return context.next();
}
