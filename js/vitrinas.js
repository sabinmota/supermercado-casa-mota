/* ═══ BUILD 483 · VITRINAS «NOVEDADES» Y «OFERTAS» ══════════════════════════
 *
 * Dos filas deslizables en la página de inicio de la tienda, arriba de
 * «Todos los Productos»:
 *   · Novedades → artículos con badge «Nuevo»  (p.badge === 'new')
 *   · Ofertas   → artículos con badge «Oferta» (p.badge === 'offer')
 * Lo decide SOLO el badge que pone el dueño en el panel. Si ninguna tiene
 * artículos, la fila no aparece.
 *
 * «Ver todo ›» muestra la lista completa en la sección de productos. Cualquier
 * otro filtro (categoría, búsqueda, «Ver todos») sale de ese modo.
 *
 * Este módulo envuelve funciones globales de app.js sin tocarlo:
 *   getFilteredProducts, renderProducts, updateActiveFilters,
 *   _loadImagesBackground, _refreshProductsSilent, filterCategory,
 *   handleSearch, onSearchCategoryChange, resetFilters, clearSearch.
 * Debe cargarse DESPUÉS de app.js.
 * ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const VITRINAS = [
    { badge: 'new',   id: 'vitNovedades', titulo: 'Novedades', sub: 'Productos recién añadidos' },
    { badge: 'offer', id: 'vitOfertas',   titulo: 'Ofertas',   sub: 'Precios rebajados' }
  ];
  const MAX_EN_FILA = 20;

  let _modo = null;      // null | 'new' | 'offer' → la sección de productos filtra por badge
  let _firma = '';       // evita repintar (y perder el desplazamiento) si nada cambió

  const vitrina = b => VITRINAS.find(v => v.badge === b);
  const deBadge = b => (typeof getLiveProducts === 'function' ? getLiveProducts() : [])
    .filter(p => p && !p.deleted && p.badge === b);

  /* Las tarjetas se generan con la MISMA función de la tienda (productCardHTML),
   * pero cambiando data-product-id por data-vit-id: así las búsquedas de
   * app.js (querySelector por data-product-id) siguen encontrando la tarjeta
   * de la cuadrícula y no la de la vitrina. */
  function tarjeta(p) {
    return productCardHTML(p).replace('data-product-id=', 'data-vit-id=');
  }

  function pintarVitrinas(forzar) {
    const cont = document.getElementById('vitrinasSection');
    if (!cont || typeof _liveProducts === 'undefined' || _liveProducts === null) return;

    const listas = VITRINAS.map(v => ({ v, items: deBadge(v.badge) }));
    const firma = JSON.stringify(listas.map(({ items }) => items.slice(0, MAX_EN_FILA)
      .map(p => `${p.id}|${p.name}|${p.price}|${p.originalPrice}|${p.unit}|${p.badge}|${p.image ? 1 : 0}`)));
    if (!forzar && firma === _firma) return;
    _firma = firma;

    const html = listas.filter(l => l.items.length).map(({ v, items }) => `
      <div class="vitrina" id="${v.id}">
        <div class="vitrina-cab">
          <button type="button" class="vitrina-titulo" onclick="verVitrina('${v.badge}')">
            <h2>${v.titulo}</h2><i class="fas fa-chevron-right" aria-hidden="true"></i>
          </button>
          <p class="vitrina-sub">${v.sub}</p>
          <div class="vitrina-flechas">
            <button type="button" class="vitrina-flecha" aria-label="Anterior" onclick="moverVitrina('${v.id}',-1)"><i class="fas fa-chevron-left"></i></button>
            <button type="button" class="vitrina-flecha" aria-label="Siguiente" onclick="moverVitrina('${v.id}',1)"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
        <div class="vitrina-fila">
          ${items.slice(0, MAX_EN_FILA).map(tarjeta).join('')}
          ${items.length > MAX_EN_FILA ? `<button type="button" class="vitrina-vermas" onclick="verVitrina('${v.badge}')">Ver los ${items.length}<i class="fas fa-arrow-right"></i></button>` : ''}
        </div>
      </div>`).join('');

    cont.innerHTML = html;
    cont.classList.toggle('hidden', !html);
    if (html && typeof initLazyImages === 'function') initLazyImages();
  }

  /* ── Acciones públicas (onclick) ─────────────────────────────────────────── */
  window.verVitrina = function (badge) {
    if (!vitrina(badge)) return;
    _modo = badge;
    currentCategory = 'all';
    currentSearch = '';
    currentPage = 1;
    const inp = document.getElementById('searchInput');
    if (inp) inp.value = '';
    if (typeof _syncActiveCat === 'function') _syncActiveCat('all');
    updateActiveFilters();
    renderProducts(true);
  };

  window.salirVitrina = function () {
    _modo = null;
    currentPage = 1;
    updateActiveFilters();
    renderProducts(true);
  };

  window.moverVitrina = function (id, dir) {
    const fila = document.querySelector(`#${id} .vitrina-fila`);
    if (fila) fila.scrollBy({ left: dir * fila.clientWidth * 0.8, behavior: 'smooth' });
  };

  /* ── Envolturas de app.js ────────────────────────────────────────────────── */
  const envolver = (nombre, fn) => {
    const orig = window[nombre];
    if (typeof orig === 'function') window[nombre] = fn(orig);
  };

  // La sección de productos filtra por badge mientras se está en una vitrina
  envolver('getFilteredProducts', orig => function () {
    const lista = orig.apply(this, arguments);
    return _modo ? lista.filter(p => p.badge === _modo) : lista;
  });

  envolver('renderProducts', orig => function () {
    const r = orig.apply(this, arguments);
    if (_modo && _liveProducts !== null) {
      const v = vitrina(_modo);
      const t = document.getElementById('sectionTitle');
      if (t && v) t.textContent = v.titulo;
    }
    pintarVitrinas();
    return r;
  });

  envolver('updateActiveFilters', orig => function () {
    const r = orig.apply(this, arguments);
    const el = document.getElementById('activeFilters');
    const v = vitrina(_modo);
    if (el && v) {
      el.insertAdjacentHTML('afterbegin', `<span class="filter-tag">
        <i class="fas fa-${_modo === 'new' ? 'star' : 'tag'}"></i> ${v.titulo}
        <button onclick="salirVitrina()">×</button>
      </span>`);
    }
    return r;
  });

  // Cuando llegan las fotos (fase 2) o cambian datos en silencio, repintar
  ['_loadImagesBackground', '_refreshProductsSilent'].forEach(n =>
    envolver(n, orig => async function () {
      const r = await orig.apply(this, arguments);
      pintarVitrinas();
      return r;
    }));

  // Cualquier otro filtro sale del modo vitrina
  ['filterCategory', 'handleSearch', 'onSearchCategoryChange', 'resetFilters', 'clearSearch'].forEach(n =>
    envolver(n, orig => function () {
      _modo = null;
      return orig.apply(this, arguments);
    }));

  // Por si los productos ya estaban cargados al llegar aquí
  pintarVitrinas(true);

  // Solo para pruebas
  window._vitrinas = { pintar: pintarVitrinas, modo: () => _modo };
})();
