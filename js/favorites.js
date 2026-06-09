/**
 * SUPERMERCADO CASA MOTA — FAVORITES.JS
 * Sistema de lista de favoritos/wishlist
 */

// Usar fmt$ global (definida en app.js); si no está disponible, fallback manual
function _fmtPrice(n) {
  if (typeof fmt$ === 'function') return fmt$(n);
  const num = Math.abs(parseFloat(n) || 0);
  const sign = (parseFloat(n) || 0) < 0 ? '-' : '';
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const intWithCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${intWithCommas}.${decPart}`;
}

// ════════════════════════════════════════════════════════════════════════════
// FUNCIONES DE FAVORITOS
// ════════════════════════════════════════════════════════════════════════════

// Verificar si un producto está en favoritos
function isFavorite(productId) {
  return favorites.some(fav => String(fav.id) === String(productId));
}

// Agregar producto a favoritos
function addToFavorites(product) {
  if (isFavorite(product.id)) {
    showToast('Este producto ya está en favoritos', 'info');
    return;
  }
  
  favorites.push({
    id: product.id,
    name: product.name,
    price: product.price,
    image: product.image,
    category: product.category,
    unit: product.unit || '',
    addedAt: Date.now()
  });
  
  saveFavorites();
  updateFavoritesUI();
  showToast(`${product.name} agregado a favoritos`, 'success');
}

// Remover producto de favoritos
function removeFromFavorites(productId) {
  const index = favorites.findIndex(fav => String(fav.id) === String(productId));
  if (index === -1) return;
  
  const productName = favorites[index].name;
  favorites.splice(index, 1);
  
  saveFavorites();
  updateFavoritesUI();
  renderFavorites();
  showToast(`${productName} eliminado de favoritos`, 'info');
}

// Guardar favoritos en localStorage
function saveFavorites() {
  localStorage.setItem('casamota_favorites', JSON.stringify(favorites));
}

// Actualizar badge de favoritos en el header
function updateFavoritesUI() {
  const badge = document.getElementById('favoritesBadge');
  if (!badge) return;
  
  if (favorites.length > 0) {
    badge.textContent = favorites.length;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// Toggle panel de favoritos
function toggleFavorites() {
  const panel = document.getElementById('favoritesPanel');
  const overlay = document.getElementById('favoritesOverlay');
  
  if (!panel || !overlay) return;
  
  // Si está abierto, cerrar
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    // Si está cerrado, abrir
    _applyPanelTop(); // Recalcular posición
    panel.classList.add('open');
    overlay.classList.add('open');
    renderFavorites();
  }
}

// Renderizar lista de favoritos
function renderFavorites() {
  const container = document.getElementById('favoritesItems');
  if (!container) return;
  
  if (favorites.length === 0) {
    container.innerHTML = `
      <div class="favorites-empty">
        <i class="fas fa-heart"></i>
        <span>No tienes favoritos aún<br>Agrega productos que te gusten</span>
      </div>`;
    return;
  }
  
  // Ordenar por más reciente primero
  const sortedFavorites = [...favorites].sort((a, b) => b.addedAt - a.addedAt);

  // Enriquecer con datos actuales de _liveProducts (por si unit no estaba guardado)
  const liveProds = typeof getLiveProducts === 'function' ? getLiveProducts() : [];

  container.innerHTML = sortedFavorites.map(fav => {
    // Buscar el producto en vivo para obtener datos actualizados (imagen, unit, precio)
    const live  = liveProds.find(p => String(p.id) === String(fav.id));
    const unit  = (live && live.unit)  || fav.unit  || '';
    // Priorizar imagen del producto en vivo (puede haberse actualizado tras migraciones)
    const image = (live && live.image) || fav.image || 'images/placeholder.jpg';
    // Actualizar silenciosamente el localStorage si la imagen cambió
    if (live && live.image && live.image !== fav.image) {
      fav.image = live.image;
      saveFavorites();
    }
    return `
    <div class="favorite-item">
      <div class="favorite-item-img">
        <img src="${image}" 
             alt="${fav.name}"
             onerror="this.src='images/placeholder.jpg'">
      </div>
      <div class="favorite-item-info">
        <div class="favorite-item-name">${fav.name}</div>
        <div class="favorite-item-price">RD$ ${_fmtPrice(fav.price)}${unit ? ` <span class="favorite-item-unit">/ ${unit}</span>` : ''}</div>
        <div class="favorite-item-actions">
          <button class="favorite-add-btn" onclick="addToCartFromFavorites('${fav.id}')">
            <i class="fas fa-cart-plus"></i> Agregar
          </button>
          <button class="favorite-remove-btn" onclick="removeFromFavorites('${fav.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Agregar al carrito desde favoritos
async function addToCartFromFavorites(productId) {
  const product = (typeof getLiveProducts === 'function' ? getLiveProducts() : PRODUCTS).find(p => String(p.id) === String(productId));
  if (!product) {
    showToast('Producto no encontrado', 'error');
    return;
  }
  
  if (product.stock <= 0) {
    showToast('Producto sin stock', 'warning');
    return;
  }
  
  addToCart(product.id);
}

// Toggle favorito desde card de producto
function toggleFavoriteFromCard(event, productId) {
  event.stopPropagation(); // Evitar abrir modal

  const product = (typeof getLiveProducts === 'function' ? getLiveProducts() : PRODUCTS).find(p => String(p.id) === String(productId));
  if (!product) return;

  const nowFav = isFavorite(productId);

  // Guardar/quitar del array SIN llamar renderProducts
  if (nowFav) {
    // Quitar de favoritos silenciosamente
    const index = favorites.findIndex(fav => String(fav.id) === String(productId));
    if (index !== -1) {
      const name = favorites[index].name;
      favorites.splice(index, 1);
      saveFavorites();
      updateFavoritesUI();
      renderFavorites();
      showToast(`${name} eliminado de favoritos`, 'info');
    }
  } else {
    // Agregar a favoritos silenciosamente
    favorites.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      category: product.category,
      addedAt: Date.now()
    });
    saveFavorites();
    updateFavoritesUI();
    showToast(`${product.name} agregado a favoritos`, 'success');
  }

  // Actualizar SOLO el botón pulsado — sin re-renderizar el grid
  const btn = event.currentTarget;
  btn.classList.toggle('active', !nowFav);

  // Actualizar también TODOS los botones de ese mismo producto
  // (puede haber duplicados en la grilla o en vista lista)
  document.querySelectorAll(`.product-favorite-btn[onclick*="'${productId}'"]`).forEach(b => {
    b.classList.toggle('active', !nowFav);
  });
}

// Toggle favorito desde modal de producto
function toggleFavoriteFromModal(productId, buttonElement) {
  const product = (typeof getLiveProducts === 'function' ? getLiveProducts() : PRODUCTS).find(p => String(p.id) === String(productId));
  if (!product) return;

  const nowFav = isFavorite(productId);

  if (nowFav) {
    removeFromFavorites(productId);
    buttonElement.classList.remove('active');
    buttonElement.innerHTML = '<i class="fas fa-heart"></i>';
    buttonElement.setAttribute('aria-label', 'Agregar a Favoritos');
  } else {
    addToFavorites(product);
    buttonElement.classList.add('active');
    buttonElement.innerHTML = '<i class="fas fa-heart"></i>';
    buttonElement.setAttribute('aria-label', 'En Favoritos');
  }

  // Actualizar el botón de la card en el grid sin re-renderizar todo
  document.querySelectorAll(`.product-favorite-btn[onclick*="'${productId}'"]`).forEach(b => {
    b.classList.toggle('active', !nowFav);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// COMPARTIR POR WHATSAPP
// ════════════════════════════════════════════════════════════════════════════

function shareProductWhatsApp(product) {
  const url = window.location.origin + window.location.pathname;
  const text = `¡Mira este producto en Casa Mota! 🛒

📦 ${product.name}
💰 RD$ ${_fmtPrice(product.price)}
${product.description ? '\n' + product.description : ''}

Ver más: ${url}?product=${product.id}`;
  
  const whatsappURL = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(whatsappURL, '_blank');
  
  showToast('Compartiendo por WhatsApp...', 'success');
}

// ════════════════════════════════════════════════════════════════════════════
// BÚSQUEDA CON AUTOCOMPLETADO
// Sistema unificado — delega en barcodeLiveSearch() de app.js
// (El sistema anterior fue eliminado para evitar conflicto de listeners duplicados)
// ════════════════════════════════════════════════════════════════════════════

// Alias para compatibilidad con código antiguo
function hideAutocomplete() {
  if (typeof _hideLiveResults === 'function') _hideLiveResults();
}

function selectAutocompleteProduct(productId) {
  hideAutocomplete();
  openModal(productId);
}

// Alias para compatibilidad
function openProductModal(product) {
  openModal(product.id);
}

// Resaltar coincidencias en el texto (usado por código externo)
function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<strong style="color: var(--green-primary);">$1</strong>');
}

// initAutocomplete: ya no registra listener — app.js lo maneja
function initAutocomplete() {
  // NO-OP: el listener de búsqueda en vivo está en app.js (barcodeLiveSearch)
  // Esta función se mantiene para no romper llamadas existentes
}

document.addEventListener('DOMContentLoaded', () => {
  // NO re-registrar listener aquí — app.js ya lo hace
});
