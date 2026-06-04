/**
 * SUPERMERCADO CASA MOTA — SERVICE WORKER v170
 * Estrategia: NETWORK ONLY para HTML/JS/CSS (nunca cachear código)
 * Cache SOLO para imágenes como fallback offline
 * IMPORTANTE: Supabase y APIs externas → NUNCA interceptar (causa CORS)
 */

const CACHE_NAME = 'casamota-v290';

// ─── INSTALL: activar inmediatamente sin cachear nada ────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: limpiar todo y tomar control ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH: manejo inteligente de requests ────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ⚠️ NUNCA interceptar requests a Supabase ni APIs externas
  // Si el SW intercepta estas requests, puede romper los headers CORS
  const isExternal = url.origin !== self.location.origin;
  if (isExternal) return; // dejar pasar sin interceptar

  const ext = url.pathname.split('.').pop().toLowerCase();

  // HTML, JS, CSS → SIEMPRE desde la red, sin caché
  if (['html', 'js', 'css'].includes(ext) || request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        new Response('<h1>Sin conexión</h1><p>Verifica tu internet.</p>',
          { headers: { 'Content-Type': 'text/html' } })
      )
    );
    return;
  }

  // API tables internas → siempre red, fallback JSON vacío
  if (url.pathname.includes('/tables/')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión', data: [], total: 0 }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Imágenes locales → Cache First (más rápido en segunda carga)
  if (['jpg','jpeg','png','webp','gif','svg'].includes(ext)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached || new Response('', { status: 404 }));
        })
      )
    );
    return;
  }

  // Todo lo demás → red normal sin caché
  event.respondWith(fetch(request, { cache: 'no-store' }));
});

// ─── MENSAJE: skipWaiting manual ─────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ─── PUSH: notificaciones ─────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Casa Mota', {
    body:  data.body  || 'Tienes una notificación nueva',
    icon:  '/images/icons/icon-192.png',
    badge: '/images/icons/icon-72.png',
    data:  { url: data.url || '/index.html' },
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/index.html'));
});
