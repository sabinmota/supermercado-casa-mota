/**
 * SUPERMERCADO CASA MOTA — LOCATION.JS
 * Modal "¿Dónde llevamos tu pedido?" — GPS + Nominatim reverse geocoding
 * Guard de checkout — bloquea confirmación si no hay dirección
 *
 * Depende de: api.js (DB, _SB_URL, _SB_HEADERS), auth.v33.js (getClientSession, setClientSession)
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  ESTADO
// ═══════════════════════════════════════════════════════════════════════════════

let _gpsModalCallback   = null;   // función a llamar cuando el usuario confirme
let _gpsDetectedLat     = null;
let _gpsDetectedLng     = null;
let _gpsDetectedAddress = '';
let _gpsDetectedCity    = '';

// ═══════════════════════════════════════════════════════════════════════════════
//  TELÉFONO — máscara 809-696-1013
// ═══════════════════════════════════════════════════════════════════════════════
// El formateo real vive en api.js (fmtPhoneDO) para que la tienda y el panel
// usen exactamente la misma regla. Aquí solo se envuelve por si api.js aún no
// ha cargado, y se engancha la máscara al <input type="tel"> del modal.

const _locFmtTel = v =>
  (typeof fmtPhoneDO === 'function') ? fmtPhoneDO(v) : String(v || '').trim();

const _locFmtTelParcial = v =>
  (typeof fmtPhoneDOPartial === 'function') ? fmtPhoneDOPartial(v) : String(v || '');

/** Inserta los guiones mientras el cliente escribe. Solo reformatea cuando el
 *  cursor está al final, para no hacerlo saltar si edita en medio del número. */
function _locBindPhoneMask(input) {
  if (!input || input._telMaskBound) return;
  input._telMaskBound = true;
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('maxlength', '12');          // 809-696-1013
  input.addEventListener('input', () => {
    const alFinal = input.selectionStart === input.value.length;
    const nuevo   = _locFmtTelParcial(input.value);
    if (nuevo !== input.value && alFinal) {
      input.value = nuevo;
      try { input.setSelectionRange(nuevo.length, nuevo.length); } catch (e) {}
    }
  });
  input.addEventListener('blur', () => { input.value = _locFmtTelParcial(input.value); });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Muestra el modal de dirección.
 * @param {function} onConfirm — llamada cuando el usuario guarda la dirección
 * @param {boolean}  forceOpen — si true, no comprueba si ya tiene dirección
 */
function openLocationModal(onConfirm, forceOpen = false) {
  _gpsModalCallback = onConfirm || null;
  _gpsDetectedLat   = null;
  _gpsDetectedLng   = null;

  // Pre-rellenar con dirección actual si existe
  const client = (typeof getClientSession === 'function') ? getClientSession() : null;
  const existingAddress = (client && client.address) ? client.address : '';
  const existingCity    = (client && client.city)    ? client.city    : '';
  const existingPhone   = (client && client.phone)   ? client.phone   : '';

  const modal = document.getElementById('locationModal');
  if (!modal) { console.warn('[location.js] #locationModal no encontrado'); return; }

  // Resetear estado del modal
  _locSetStep('idle');

  // Pre-rellenar campos
  const addrInput  = document.getElementById('locAddressInput');
  const cityInput  = document.getElementById('locCityInput');
  const phoneInput = document.getElementById('locPhoneInput');
  if (addrInput)  addrInput.value  = existingAddress;
  if (cityInput)  cityInput.value  = existingCity;
  // El teléfono se muestra SIEMPRE con guiones, aunque en la BD esté sin ellos
  if (phoneInput) {
    phoneInput.value = _locFmtTel(existingPhone);
    _locBindPhoneMask(phoneInput);
  }

  // Mostrar el mapa si ya tiene coordenadas guardadas
  if (client && client.locLat && client.locLng) {
    _gpsDetectedLat = client.locLat;
    _gpsDetectedLng = client.locLng;
    _locShowMap(client.locLat, client.locLng);
  } else {
    _locHideMap();
  }

  // Mostrar modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/** Cierra el modal sin guardar */
function closeLocationModal() {
  const modal = document.getElementById('locationModal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
  _gpsModalCallback = null;
}

/**
 * Guard de checkout: si el cliente no tiene dirección, abre el modal primero.
 * Si ya tiene dirección, ejecuta onProceed directamente.
 * @param {function} onProceed — función a ejecutar cuando la dirección esté lista
 */
function requireAddressBeforeCheckout(onProceed) {
  const client = (typeof getClientSession === 'function') ? getClientSession() : null;
  const hasAddress = client && client.address && client.address.trim().length > 2;

  if (hasAddress) {
    // Ya tiene dirección — proceder directamente
    if (typeof onProceed === 'function') onProceed();
  } else {
    // Sin dirección — mostrar modal GPS primero
    openLocationModal(() => {
      // Después de guardar la dirección, proceder
      if (typeof onProceed === 'function') onProceed();
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PASO 1 — DETECTAR GPS
// ═══════════════════════════════════════════════════════════════════════════════

function locRequestGPS() {
  if (!navigator.geolocation) {
    _locSetStep('manual');
    _locShowError('Tu navegador no soporta GPS. Ingresa tu dirección manualmente.');
    return;
  }

  _locSetStep('loading');
  document.getElementById('locStatusText').textContent = 'Obteniendo tu ubicación…';

  navigator.geolocation.getCurrentPosition(
    _onGPSSuccess,
    _onGPSError,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

async function _onGPSSuccess(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  _gpsDetectedLat = lat;
  _gpsDetectedLng = lng;

  document.getElementById('locStatusText').textContent = 'Ubicación detectada. Obteniendo dirección…';

  // Reverse geocoding con Nominatim (gratuito, sin API key)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'es', 'User-Agent': 'CasaMota/1.0' } }
    );
    const data = await res.json();

    const a = data.address || {};
    // Construir dirección legible
    const road   = a.road || a.pedestrian || a.footway || a.street || '';
    const num    = a.house_number || '';
    const barrio = a.suburb || a.neighbourhood || a.quarter || '';
    const city   = a.city || a.town || a.village || a.municipality || a.county || '';
    const state  = a.state || '';

    // Dirección: "Calle Principal #10, Barrio Norte" o lo que Nominatim devuelva
    let addressParts = [];
    if (road)   addressParts.push(road + (num ? ' #' + num : ''));
    if (barrio) addressParts.push(barrio);
    const fullAddress = addressParts.join(', ') || data.display_name.split(',').slice(0,2).join(',').trim();

    _gpsDetectedAddress = fullAddress;
    _gpsDetectedCity    = city || state;

    // Rellenar campos
    const addrInput = document.getElementById('locAddressInput');
    const cityInput = document.getElementById('locCityInput');
    if (addrInput) addrInput.value = fullAddress;
    if (cityInput) cityInput.value = _gpsDetectedCity;

    // Mostrar mapa
    _locShowMap(lat, lng);
    _locSetStep('detected');
    _locHideError();

  } catch(e) {
    // Nominatim falló — rellenar con coordenadas y dejar que edite
    _gpsDetectedAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    _gpsDetectedCity    = '';
    const addrInput = document.getElementById('locAddressInput');
    if (addrInput) addrInput.value = _gpsDetectedAddress;
    _locShowMap(lat, lng);
    _locSetStep('detected');
    _locShowError('No se pudo obtener la dirección exacta. Por favor edítala manualmente.');
  }
}

function _onGPSError(err) {
  _locSetStep('manual');
  const msgs = {
    1: 'Permiso de ubicación denegado. Por favor ingresa tu dirección manualmente.',
    2: 'No se pudo obtener tu ubicación. Ingresa tu dirección manualmente.',
    3: 'La solicitud de ubicación tardó demasiado. Ingresa tu dirección manualmente.',
  };
  _locShowError(msgs[err.code] || 'Error de GPS. Ingresa tu dirección manualmente.');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PASO 2 — GUARDAR DIRECCIÓN
// ═══════════════════════════════════════════════════════════════════════════════

async function locConfirmAddress() {
  const addrInput  = document.getElementById('locAddressInput');
  const cityInput  = document.getElementById('locCityInput');
  const phoneInput = document.getElementById('locPhoneInput');
  const address    = (addrInput?.value  || '').trim();
  const city       = (cityInput?.value  || '').trim();
  // Normalizado a 809-696-1013 ANTES de guardar: así el panel nunca recibe
  // números pegados como "8096961013" (era el caso hasta el build 367).
  const phone      = _locFmtTel(phoneInput?.value || '');

  if (!address || address.length < 4) {
    _locShowError('Por favor ingresa una dirección válida (mínimo 4 caracteres).');
    addrInput?.focus();
    return;
  }

  // El teléfono sigue siendo opcional, pero si lo escriben debe estar completo:
  // un número a medias no sirve para coordinar la entrega.
  if (phone && phone.replace(/\D/g, '').length !== 10) {
    _locShowError('El teléfono debe tener 10 dígitos. Ejemplo: 809-696-1013');
    if (phoneInput) { phoneInput.value = _locFmtTelParcial(phoneInput.value); phoneInput.focus(); }
    return;
  }

  // Botón de confirmar: loading state
  const btn = document.getElementById('locConfirmBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…'; }

  try {
    const client = (typeof getClientSession === 'function') ? getClientSession() : null;
    if (!client) throw new Error('Sesión no encontrada');

    // Campos a actualizar
    const patch = {
      address,
      city:    city  || client.city  || '',
      locLat:  _gpsDetectedLat  || client.locLat  || null,
      locLng:  _gpsDetectedLng  || client.locLng  || null,
    };
    // Guardar teléfono solo si el usuario escribió algo
    if (phone) patch.phone = phone;

    // Guardar en Supabase
    await DB.patchCustomer(client.id, patch);

    // Actualizar sesión local
    const updated = { ...client, ...patch };
    if (typeof setClientSession === 'function') setClientSession(updated);

    // Actualizar currentClient si existe en el scope global
    if (typeof currentClient !== 'undefined') {
      Object.assign(currentClient, patch);
    }

    // Cerrar modal
    closeLocationModal();

    // Mostrar toast de éxito
    if (typeof showToast === 'function') {
      showToast('<i class="fas fa-location-dot"></i> Dirección guardada correctamente', 'success');
    }

    // Ejecutar callback (continuar con el checkout, etc.)
    if (typeof _gpsModalCallback === 'function') {
      _gpsModalCallback();
      _gpsModalCallback = null;
    }

    // Refrescar vista Mi Ubicación si está abierta
    if (typeof renderLocationSection === 'function') {
      renderLocationSection();
    }

  } catch(e) {
    _locShowError('Error al guardar la dirección. Intenta de nuevo.');
    console.error('[location.js] locConfirmAddress error:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Confirmar dirección y teléfono'; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS UI
// ═══════════════════════════════════════════════════════════════════════════════

/** Pasos: 'idle' | 'loading' | 'detected' | 'manual' */
function _locSetStep(step) {
  const gpsBtn   = document.getElementById('locGpsBtn');
  const spinner  = document.getElementById('locSpinner');
  const detected = document.getElementById('locDetectedBadge');
  const statusEl = document.getElementById('locStatusText');

  if (gpsBtn)   gpsBtn.style.display   = (step === 'loading') ? 'none' : 'flex';
  if (spinner)  spinner.style.display  = (step === 'loading') ? 'flex' : 'none';
  if (detected) detected.style.display = (step === 'detected') ? 'flex' : 'none';
  if (statusEl) {
    statusEl.style.display = (step === 'loading') ? 'block' : 'none';
  }
}

function _locShowMap(lat, lng) {
  const wrap = document.getElementById('locMapWrap');
  const iframe = document.getElementById('locMapIframe');
  if (!wrap || !iframe) return;
  // Google Maps embed sin API key — zoom 17 para vista de calle
  const src = `https://maps.google.com/maps?q=${lat},${lng}&z=17&output=embed`;
  iframe.src = src;
  wrap.style.display = 'block';
}

function _locHideMap() {
  const wrap = document.getElementById('locMapWrap');
  if (wrap) wrap.style.display = 'none';
}

function _locShowError(msg) {
  const el = document.getElementById('locError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'flex';
}

function _locHideError() {
  const el = document.getElementById('locError');
  if (el) el.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GUARD DE CHECKOUT — intercepta el botón "Confirmar pedido"
//  Se busca el botón por su onclick inline (confirmOrder) y se envuelve
//  para que primero compruebe la dirección del cliente.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reemplaza la función global confirmOrder con una versión que verifica
 * dirección primero. Se llama desde DOMContentLoaded cuando app.js ya cargó.
 */
function _installCheckoutGuard() {
  // confirmOrder puede no existir aún si app.js tarda — reintentamos
  if (typeof window._origConfirmOrder !== 'undefined') return; // ya instalado

  const orig = window.confirmOrder;
  if (typeof orig !== 'function') {
    // app.js aún no cargó — reintentar en 500ms
    setTimeout(_installCheckoutGuard, 500);
    return;
  }

  // Guardar original
  window._origConfirmOrder = orig;

  // Reemplazar con versión con guard
  window.confirmOrder = function(btnEl) {
    const client = (typeof getClientSession === 'function') ? getClientSession() : null;
    const hasAddress = client && client.address && client.address.trim().length > 2;

    if (!hasAddress) {
      // Sin dirección → abrir modal GPS primero
      openLocationModal(() => {
        // Una vez guardada la dirección, continuar con el pedido
        window._origConfirmOrder(btnEl);
      });
    } else {
      // Ya tiene dirección → proceder directamente
      window._origConfirmOrder(btnEl);
    }
  };

  console.log('[location.js] Guard de checkout instalado ✅');
}

// Instalar el guard cuando todo haya cargado
document.addEventListener('DOMContentLoaded', () => {
  // Esperar a que app.js defina confirmOrder (puede tardar si hay módulos async)
  setTimeout(_installCheckoutGuard, 800);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  VISTA "MI UBICACIÓN" — renderLocationSection reemplazada/mejorada
//  Si app.js ya define renderLocationSection, la extendemos.
//  Si no, la definimos aquí completa.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renderiza la sección "Mi Ubicación" en el panel de cuenta.
 * Muestra la dirección guardada, el mapa, y un botón para actualizar.
 */
function renderLocationSection() {
  const container = document.getElementById('locationViewContent');
  if (!container) return;

  const client = (typeof getClientSession === 'function') ? getClientSession() : null;
  if (!currentClient && !client) {
    container.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px">Cargando…</p>';
    return;
  }

  const c = currentClient || client;
  const address = c.address || '';
  const city    = c.city    || '';
  const lat     = c.locLat  || null;
  const lng     = c.locLng  || null;

  const phone      = c.phone   || '';
  const hasAddress = address && address.trim().length > 2;

  // Mapa embed
  const mapHTML = (hasAddress && lat && lng)
    ? `<div style="border-radius:14px;overflow:hidden;border:1.5px solid #e2e8f0;margin-bottom:16px">
         <iframe src="https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed"
                 style="width:100%;height:200px;border:none;display:block"
                 loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                 title="Tu ubicación de entrega"></iframe>
       </div>`
    : hasAddress
      ? `<div style="border-radius:14px;overflow:hidden;border:1.5px solid #e2e8f0;margin-bottom:16px">
           <iframe src="https://maps.google.com/maps?q=${encodeURIComponent(address+' '+city)}&output=embed"
                   style="width:100%;height:200px;border:none;display:block"
                   loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                   title="Tu ubicación de entrega"></iframe>
         </div>`
      : '';

  // Estado: sin dirección
  const noAddrHTML = !hasAddress
    ? `<div style="text-align:center;padding:20px 16px;background:#fff8e1;border-radius:14px;border:1.5px dashed #f59e0b;margin-bottom:16px">
         <i class="fas fa-location-dot" style="font-size:2rem;color:#f59e0b;margin-bottom:10px;display:block"></i>
         <p style="font-weight:700;color:#92400e;margin:0 0 6px">Sin dirección de entrega</p>
         <p style="font-size:.83rem;color:#78350f;margin:0">Agrega tu dirección para que podamos entregarte</p>
       </div>`
    : '';

  // Datos guardados
  const dataHTML = hasAddress
    ? `<div style="background:#f9fbf9;border-radius:12px;border:1px solid #e8f5ee;padding:14px 16px;margin-bottom:16px">
         <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
           <i class="fas fa-location-dot" style="color:#e07b00;margin-top:2px;flex-shrink:0"></i>
           <div>
             <div style="font-size:.78rem;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Dirección</div>
             <div style="font-weight:600;color:#1a1a2e;font-size:.92rem">${_escLocHtml(address)}</div>
           </div>
         </div>
         ${city ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
           <i class="fas fa-city" style="color:#0e7fc2;flex-shrink:0"></i>
           <div>
             <div style="font-size:.78rem;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Ciudad</div>
             <div style="font-weight:600;color:#1a1a2e;font-size:.92rem">${_escLocHtml(city)}</div>
           </div>
         </div>` : ''}
         ${phone ? `<div style="display:flex;align-items:center;gap:10px">
           <i class="fas fa-phone" style="color:#1a7c3e;flex-shrink:0"></i>
           <div>
             <div style="font-size:.78rem;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Teléfono</div>
             <div style="font-weight:600;color:#1a1a2e;font-size:.92rem">${_escLocHtml(phone)}</div>
           </div>
         </div>` : `<div style="display:flex;align-items:center;gap:10px">
           <i class="fas fa-phone" style="color:#ccc;flex-shrink:0"></i>
           <div>
             <div style="font-size:.78rem;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Teléfono</div>
             <div style="font-size:.82rem;color:#bbb">No registrado — actualiza para añadir</div>
           </div>
         </div>`}
       </div>`
    : '';

  container.innerHTML = `
    <div style="padding:16px">
      ${noAddrHTML}
      ${mapHTML}
      ${dataHTML}
      <button onclick="openLocationModal(null, true)"
              style="width:100%;padding:14px;background:linear-gradient(135deg,#e07b00,#f59e0b);color:#fff;border:none;border-radius:50px;font-size:.95rem;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 4px 14px rgba(224,123,0,.3)">
        <i class="fas fa-${hasAddress ? 'pen-to-square' : 'location-dot'}"></i>
        ${hasAddress ? 'Actualizar dirección y teléfono' : 'Agregar dirección de entrega'}
      </button>
      <p style="text-align:center;font-size:.75rem;color:#aaa;margin-top:12px">
        <i class="fas fa-lock" style="margin-right:4px"></i>Tu ubicación solo se usa para coordinar tu entrega
      </p>
    </div>`;
}

/** Escapa HTML para insertar texto en innerHTML de forma segura */
function _escLocHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
