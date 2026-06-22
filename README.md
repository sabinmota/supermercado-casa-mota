# 🛒 Supermercado Casa Mota — Estado del Proyecto

## ✅ Estado actual (v33.5 — 2026-06-22)

| Componente | Estado |
|---|---|
| **Auto-recarga de Productos** | ✅ Card en Admin→Configuración con toggle ON/OFF, selector de intervalo (1-30 min), badge countdown animado, botón "Recargar ahora", y timestamp de última recarga |
| **Persistencia auto-reload** | ✅ Estado (enabled/interval/nextTs) guardado en `localStorage` key `cm_autoreload` — sobrevive recargas de página |
| **Campo WhatsApp en Settings** | ✅ Agregado `settingWhatsapp` (phone-widget) en `admin.html` |
| **`storeWhatsapp` en admin.v33.js** | ✅ `saveSettings()` + `loadSettings()` incluyen `storeWhatsapp` |
| **WhatsApp footer tienda** | ✅ `li#storeWhatsappFooterLi` con `fab fa-whatsapp` verde — visible solo si configurado |
| **`applyStoreInfo()` en app.js** | ✅ Lee `s.storeWhatsapp`, genera link `wa.me/` E.164, muestra/oculta dinámicamente |
| **PDFs pedidos (extras.v33.js)** | ✅ `_storeWhatsapp` en línea Tel: del PDF de pedidos |
| **PDFs reportes (extras.v33.js)** | ✅ `_storeWhatsapp` en línea Tel: del PDF de reportes |
| **Email en PDFs en línea separada** | ✅ Email queda debajo de Tel/WA, no en la misma línea |
| **`saveSettings` en api.js** | ✅ Reescrito con fetch directo (sin `_apiPatch`), payload limpio |
| **Columna `storeWhatsapp` Supabase** | ✅ `ALTER TABLE settings ADD COLUMN storeWhatsapp TEXT` ejecutado |
| **Versiones activas** | `app.js?v=320` · `api.js?v=304` · `admin.v33.js?v=329` · `extras.v33.js?v=305` |

### 🔄 Auto-recarga de Productos — Detalles técnicos

```
Admin → Configuración → Card "Auto-recarga de Productos"
```

| Elemento | ID/Key | Descripción |
|---|---|---|
| Toggle ON/OFF | `#arToggle` | Activa/desactiva el ciclo de recarga |
| Track/Thumb | `#arToggleTrack`, `#arToggleThumb` | CSS del switch animado |
| Label | `#arToggleLabel` | "Activado" / "Desactivado" en azul/gris |
| Selector intervalo | `#arInterval` | 1/2/3/5/10/15/30 min (default: 5) |
| Badge countdown | `#arCountdownBadge` / `#arCountdownText` | Muestra `MM:SS` restante |
| Botón forzar | `#arForceBtn` | Recarga inmediata + reinicia countdown |
| Última recarga | `#arLastReload` / `#arLastReloadTime` | Timestamp de la última recarga exitosa |
| localStorage | `cm_autoreload` | `{enabled, interval, nextTs, lastReload}` |

**Funciones JS en `admin.v33.js`:**
- `initAutoReload()` — restaura estado desde localStorage al entrar a Settings
- `onArToggleChange()` — activa/desactiva desde el toggle
- `onArIntervalChange()` — cambia intervalo y reinicia countdown si activo
- `arForceReload()` — recarga inmediata desde botón
- `_arStartTick()` — arranca `setInterval` de 1s
- `_arStopTick()` — detiene el timer y oculta badge
- `_arDoReload()` — llama `DB.getProducts({full:true})`, actualiza `adminProducts`, re-renderiza tabla si está visible
- `_arUpdateBadge()` — actualiza el texto MM:SS del countdown
- `_arShowBadge(v)` — muestra/oculta badge + botón + última recarga
- `_arApplyToggleStyle(v)` — anima el toggle CSS



| Componente | Estado |
|---|---|
| **Campo WhatsApp en Settings** | ✅ Agregado `settingWhatsapp` (phone-widget) en `admin.html` |
| **`storeWhatsapp` en admin.v33.js** | ✅ `saveSettings()` + `loadSettings()` incluyen `storeWhatsapp` |
| **WhatsApp footer tienda** | ✅ `li#storeWhatsappFooterLi` con `fab fa-whatsapp` verde — visible solo si configurado |
| **`applyStoreInfo()` en app.js** | ✅ Lee `s.storeWhatsapp`, genera link `wa.me/`, muestra/oculta dinámicamente |
| **PDFs pedidos (extras.v33.js)** | ✅ `_storeWhatsapp` en línea Tel: del PDF de pedidos |
| **PDFs reportes (extras.v33.js)** | ✅ `_storeWhatsapp` en línea Tel: del PDF de reportes |
| **Versiones activas** | `app.js?v=319` · `admin.v33.js?v=320` · `extras.v33.js?v=304` |

| Componente | Estado |
|---|---|
| **Imágenes carrusel `images[]`** | ✅ Migradas Virginia → São Paulo (47 productos) |
| **Columnas `rating` + `reviews`** | ✅ Creadas en São Paulo + 1,665 valores migrados |
| **Favoritos `object-fit`** | ✅ CSS corregido (`contain` + fondo blanco) |
| **Carga 2 fases (velocidad)** | ✅ `api.js` + `app.js` reescritos — fase1 sin image/description |
| **Admin usa `{full:true}`** | ✅ 6 ocurrencias corregidas en `admin.v33.js` |
| **Herramienta migración R2** | ✅ `migration/migrar-imagenes-r2.html` creada |
| **Migración base64 → R2** | 🔄 Pendiente — esperando Account ID + API Token Cloudflare |

### 🚀 Próximo paso crítico: Migrar 1,659 imágenes base64 a Cloudflare R2
- Supabase tiene 132MB de base64 en columna `image` → queries de minutos
- Solución: mover a **R2** + URL CDN `https://img.supermercadocasamota.com`
- Herramienta lista: `migration/migrar-imagenes-r2.html`
- Necesario: Account ID Cloudflare + API Token R2:Edit + bucket `casamota-imagenes` creado

---

## ✅ Estado histórico (v33.1 — 2026-06-07)

| Componente | Estado |
|---|---|
| Supabase importación | ✅ 1,712 registros importados |
| Dominio personalizado | ✅ supermercadocasamota.com activo (Cloudflare Pages) |
| GitHub + Cloudflare Pages | ✅ Deploy automático en cada push |
| admin.html carga correcta | ✅ Corregido (timeouts + select optimizados) |
| NaN en Total Unidades | ✅ Corregido (stock/total como strings → Number()) |
| Email/Phone en pedidos | ✅ Corregido (`_orderFromSupa` con `??`) |
| Ciudad en PDF | ✅ Corregido (columna `city` en Supabase + fallback) |
| Número de pedido | ✅ Correlativo corto (`order_number` INTEGER) |
| Error 400 ceroCentavos | ✅ Corregido (BOOLEAN → NUMERIC en Supabase) |
| Cupones en producción | ✅ Corregido (Supabase directo en `cupones.js`) |
| Precios desalineados PDF | ✅ Corregido (`inline-flex` + `tabular-nums`) |
| **Comprobante fiscal NCF** | ✅ **Visible en admin (detalle) y PDF imprimible** |
| **Bug PDF fiscal (v33.1 → v33.2)** | ✅ **`hasFiscal` normaliza boolean/string de Supabase; vars extraídas antes del template** |

---

## 🐛 Bugs corregidos en v28.0

### 1. Admin colgado en spinner (Supabase HTTP 500 — code 57014)
**Causa:** `_apiGetAll` pedía `select=*` de todas las tablas en paralelo sin timeout → Supabase cancelaba la query por exceso de CPU (`canceling statement due to statement timeout`).

**Fix en `js/api.js`:**
- Cada método (`getProducts`, `getOrders`, etc.) ahora usa **fetch directo** con `select` de solo los campos necesarios
- **AbortController de 12s** en cada fetch — si Supabase no responde, falla rápido
- Página de 200 registros (era 500) en `_apiGetAll` para las tablas secundarias
- `getSettings` y `getCategories` también con fetch directo y timeout de 8-10s

**Fix en `js/admin.v33.js`:**
- `initAdminData` ahora usa `withTimeout()` de 18s por intento
- Espera entre reintentos: **1.5s fija** (antes era 2s×intento = hasta 4s)
- El spinner **siempre se oculta** aunque fallen los 3 intentos
- Si la carga falla → usa `PRODUCTS` locales en lugar de mostrar todo en cero

### 2. NaN en "Total Unidades" del Inventario
**Causa:** `p.stock` llega como string de Supabase. `reduce(s + p.stock)` concatenaba strings.

**Fix:** Todos los campos numéricos ahora usan `Number()`:
- `p.stock` → `Number(p.stock) || 0`
- `o.total` → `Number(o.total) || 0`
- `p.price` → `Number(p.price) || 0`

---

## 📁 Archivos que cambiar en GitHub

Solo necesitas copiar estos 2 archivos:

| Archivo | Cambios |
|---|---|
| `js/api.js` | Queries optimizadas + timeouts + select específicos |
| `js/admin.v33.js` | withTimeout() + NaN fixes + spinner garantizado |

---

## 🌐 URLs del proyecto

| Entorno | URL |
|---|---|
| Producción | https://supermercadocasamota.com |
| Admin | https://supermercadocasamota.com/admin |
| GitHub repo | https://github.com/TU_USUARIO/supermercado-casa-mota |
| Supabase | https://hmloadberrekcxdgdcdn.supabase.co |

---

## ⚠️ Pendiente recomendado en Supabase

Para prevenir futuros timeouts, ejecutar en el **SQL Editor de Supabase**:

```sql
-- Índices para acelerar las queries más comunes
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_email     ON customers(email);
CREATE INDEX IF NOT EXISTS idx_categories_sort     ON categories(sort_order);
```

---

---

## 🐛 Bugs corregidos en v33.1 (sesión actual)

| Bug | Causa Raíz | Archivos modificados |
|---|---|---|
| `email: undefined`, `phone: null` en admin → pedidos | Rama Genspark no llamaba `_orderFromSupa` + columnas duales | `js/api.js` |
| Ciudad no aparecía en dirección de entrega del recibo PDF | `orders` no tenía columna `city` en Supabase | `supabase_alter.sql` + `js/app.js` + `js/extras.v33.js` |
| Número de pedido mostraba UUID en lugar de correlativo | `_apiCreate` elimina `id`; Supabase genera UUID | `js/api.js` + `js/app.js` + `js/admin.v33.js` + `js/extras.v33.js` |
| Error 400 `mapLink`/`source` columnas inexistentes | Columnas enviadas a Supabase que no existen en la tabla | `js/api.js` (`_orderToSupa`) |
| Cupones "Error al verificar" en producción | `cupones.js` usaba `tables/cupones` (solo dev) | `js/cupones.js` + `index.html` |
| Error 400 `ceroCentavos` boolean al crear pedido | Columna era BOOLEAN, código envía decimal | `supabase_alter.sql` (ALTER a NUMERIC) |
| Precios desalineados en PDF (`RD$` separado del número) | Sin ancho fijo ni `tabular-nums` | `js/extras.v33.js` |
| **Datos fiscales no visibles en admin ni PDF** | Campos `fiscalSolicitado/RNC/Nombre` guardados pero no renderizados | `js/admin.v33.js` + `js/extras.v33.js` |
| **PDF fiscal no aparecía (v33.1→v33.2)** | `order.fiscalSolicitado` evaluado directamente en template; puede llegar como boolean `true` o string `"true"` desde Supabase. Se extrae `hasFiscal` antes del template con triple comparación robusta | `js/extras.v33.js` |
| **Error 400 al confirmar pedido — `date/time field value out of range`** | `_apiCreate`, `_apiUpdate` y `_apiPatch` enviaban `Date.now()` (número entero en ms, ej: `1781051088878`) en los campos `created_at`/`updated_at`. Supabase PostgreSQL (`timestamptz`) requiere formato ISO 8601. Corregido a `new Date().toISOString()` en los 3 helpers. | `js/api.js` |

### Detalle: Comprobante Fiscal (NCF)

**`js/admin.v33.js`** — Modal de detalle del pedido:
- Se agregó bloque `<!-- COMPROBANTE FISCAL -->` entre _Método de pago_ y _Cambiar estado_
- Fondo amarillo (#fff8e1), ícono `fa-file-invoice`, muestra `fiscalNombre` y `fiscalRNC`
- Solo visible cuando `o.fiscalSolicitado === true`

**`js/extras.v33.js`** — PDF imprimible:
- Se agregó sección fiscal entre el `info-grid` (cliente/dirección) y la tabla de productos
- Borde dorado, fondo #fffde7, `page-break-inside:avoid` para impresión
- Muestra Nombre/Razón Social y RNC/Cédula en tabla compacta
- Solo visible cuando `order.fiscalSolicitado === true`

---

## 🗄️ SQL ejecutado en Supabase (v33.x)

```sql
-- Columnas nuevas en orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS city         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number INTEGER;

-- ceroCentavos: BOOLEAN → NUMERIC
ALTER TABLE public.orders ALTER COLUMN "ceroCentavos" DROP DEFAULT;
ALTER TABLE public.orders ALTER COLUMN "ceroCentavos" TYPE NUMERIC
  USING CASE WHEN "ceroCentavos" THEN 0 ELSE 0 END;
ALTER TABLE public.orders ALTER COLUMN "ceroCentavos" SET DEFAULT 0;
```

---

## ✅ Checklist de funcionalidades

- [x] Fix `email: undefined` y `phone: null` en pedidos
- [x] Fix ciudad en dirección de entrega (SQL + código)
- [x] Fix número de pedido UUID → correlativo corto (`order_number`)
- [x] Fix error 400 `mapLink`/`source` columnas inexistentes
- [x] Fix cupones no validaban en producción (Supabase directo)
- [x] Fix error 400 `ceroCentavos` BOOLEAN → NUMERIC (SQL ejecutado)
- [x] Fix precios desalineados en PDF (`inline-flex` + `tabular-nums`)
- [x] **Datos fiscales (NCF) visibles en admin → detalle del pedido**
- [x] **Datos fiscales (NCF) visibles en PDF imprimible**

---

## 📁 Archivos a subir a GitHub (v33.1)

| Archivo | Cambios |
|---|---|
| `js/api.js` | `_orderFromSupa` con `??`, rama Genspark mapea, `createOrder` guarda `order_number`, `_orderToSupa` elimina `mapLink`/`source` |
| `js/app.js` | `city` en newOrder, `nextNum` usa `order_number`, `descuentoPct/Monto` guardados |
| `js/admin.v33.js` | Ciudad con fallback cliente, `order_number` en tabla/modal/toasts, **sección fiscal** en modal de detalle |
| `js/extras.v33.js` | PDF con ciudad/order_number/descuento detallado/precios alineados, **sección fiscal** en PDF |
| `js/cupones.js` | Usa `_SB_URL/_SB_HEADERS`, `incrementCuponUso` corregido |
| `index.html` | `cupones.js?v=301` para forzar recarga de caché |
| `supabase_alter.sql` | Columnas `city`, `order_number`, cambio `ceroCentavos` BOOLEAN→NUMERIC |

---

## 🌐 URLs del proyecto

| Entorno | URL |
|---|---|
| Producción | https://supermercadocasamota.com |
| Admin | https://supermercadocasamota.com/admin |
| GitHub repo | https://github.com/TU_USUARIO/supermercado-casa-mota |
| Supabase | https://hmloadberrekcxdgdcdn.supabase.co |

---

## ⚠️ Índices recomendados en Supabase

```sql
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_email     ON customers(email);
CREATE INDEX IF NOT EXISTS idx_categories_sort     ON categories(sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
```

---

*Actualizado: 2026-06-07 · v33.1*
