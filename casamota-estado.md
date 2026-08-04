# Supermercado Casa Mota — Estado del Proyecto
**Última actualización:** 2026-08-04 — build 379 (secuelas de la migración a UUID: «Retiro en tienda» reparado)  
**Deploy:** Cloudflare Pages (rama main de GitHub)  
**URL producción:** https://supermercadocasamota.com  
**`VER` actual:** `379` (debe ser idéntico en `index.html` y `admin.html`)

> ✅ **DESPLEGADO Y VERIFICADO POR EL USUARIO:** builds 371 a 376. En producción vive el 376.
>
> ⏳ **PENDIENTE DE SUBIR A GITHUB — build 378.** El build 377 quedó **absorbido** por el 378:
> su único fichero era `backup-tool.html`, que ahora está eliminado. Archivos a subir:
>
> | Fichero | Estado |
> |---|---|
> | `js/admin.v33.js` | v=**364** (respaldo rediseñado + `_mismoDriver`) |
> | `admin.html` | `VER` **379** + bloque Checklist sustituido |
> | `index.html` | `VER` **379** |
> | `js/api.js` | v=**324** 🔴 saneado de `clientId`/`driverId` |
> | `js/chat.js` | v=**234** (`_mismoDriverChat` excluye `_retiro`) |
> | `login-cliente.html` · `test-scanner.html` | `js/api.js?v=324` (sincronía) |
> | `supabase_recalc_clientes_y_telefonos.sql` | 🔴 **corregido, no solo comentado** |
> | `supabase_new_project.sql` · `supabase_alter.sql` | `clientId`/`driverId` → UUID |
> | `supabase_diagnostico_huerfanos.sql` · `supabase_diagnostico_lizbeth.sql` · `supabase_limpiar_datos_prueba.sql` · `limpieza/1-preview.sql` · `limpieza/5-verificar-final.sql` | `::text` retirado |
> | `backup-tool.html` | 🗑️ **ELIMINADO** |
> | `limpieza/9,10,10-verificar,11,11-verificar,12 · LEEME.md · ORDEN-AHORA.md` | nuevos/actualizados |
>
> ✅ **EL SQL YA ESTÁ EJECUTADO.** Los scripts 1 a 11 de `limpieza/` corrieron en Supabase con
> **12/12 comprobaciones verdes** (8/8 en `10-verificar.sql`, 4/4 en `11-verificar.sql`).
> El código del build 378 **no depende** de ese SQL: se puede subir en cualquier orden.

---

## 🌐 URLs Importantes

| Página | URL |
|---|---|
| Tienda cliente | https://supermercadocasamota.com/index.html |
| Login cliente | https://supermercadocasamota.com/login-cliente |
| Panel admin | https://supermercadocasamota.com/admin.html |
| Privacidad | https://supermercadocasamota.com/privacy.html |
| Términos | https://supermercadocasamota.com/terms.html |
| Página 404 | https://supermercadocasamota.com/404.html |

---

## 📁 Archivos Principales y Versiones JS

> **Fuente de verdad:** los `?v=NNN` de esta tabla están verificados contra las etiquetas
> `<script>` / `<link>` reales de cada HTML (auditoría 2026-08-01).
> Si editas un JS, sube el número **en todos los HTML que lo carguen**.

### `index.html` — Tienda del cliente

| Archivo | Versión | Descripción |
|---|---|---|
| `js/api.js` | v=323 | API Supabase, CRUD, `fmtPhoneDO()` · borrado seguro (372) · **`exportTable`/`countTable` + numeración por secuencia (376)** |
| `js/auth.js` | v=201 | Autenticación de clientes |
| `js/products.js` | v=300 | Gestión de productos |
| `js/cupones.js` | v=301 | Sistema de cupones |
| `js/favorites.js` | v=280 | Favoritos del cliente |
| `js/app.js` | v=341 | Lógica principal de la tienda · `orderLabel()` (373) · **número de pedido desde la BD (376)** |
| `js/location.js` | v=121 | Modal GPS dirección + teléfono (máscara `809-696-1013`) |
| ~~`js/chat.js`~~ | — | ❌ **RETIRADO en build 361** · Maya ya no existe en la tienda |
| `css/style.css` | v=315 | Estilos tienda · **purgadas 488 líneas `.chat-*` muertas (build 371)** |

### `admin.html` — Panel de administración

| Archivo | Versión | Descripción |
|---|---|---|
| `js/api.js` | v=323 | Compartido con la tienda ⚠️ mantener sincronizado |
| `js/auth.v33.js` | v=295 | Autenticación de staff/admin |
| `js/products.js` | v=300 | Gestión de productos |
| `js/admin.v33.js` | v=363 | Lógica del panel · `pvNotificarSeccion()` (374) · antiparpadeo (375) · número de pedido desde la BD (376) · **respaldo vía `DB.exportTable()` + Checklist eliminado (378)** |
| `js/pedidos-vigilancia.js` | v=4 | 🆕 **build 374** · sondeo de pedidos cada 30 s + aviso sonoro, **en todo el panel** · **v4: ya no llama a `loadDashboard()`** |
| `js/extras.v33.js` | v=305 | Reportes, cupones, notificaciones, PDF |
| `js/ai.js` | v=254 | Integración IA (Groq) · usa `DB.getProducts()` (ya no `tables/products`) |
| `js/chat.js` | v=233 | Chatbot Maya en modo admin (`_CHAT_IS_ADMIN`) · **único consumidor** · maneja 429 |
| `css/admin.v33.css` | v=257 | Estilos del panel admin · **`.orders-header-actions` (build 374)** |

### `login-cliente.html` — Login / registro de clientes

| Archivo | Versión | Descripción |
|---|---|---|
| `js/api.js` | v=322 | Incluye `createClientFromOAuth()` · ⚠️ estaba en v=320, desincronizado hasta el build 372 |
| `js/auth.v33.js` | v=295 | Flujo de sesión |

### 🗃️ Código legacy retirado (2026-08-01)

Movidos de `js/` y `css/` a **`backup/legacy/`** (~550 KB). Ver `backup/legacy/README.md`.

| Fichero | Sustituido por |
|---|---|
| `admin.js` · `admin.v32.js` | `js/admin.v33.js` |
| `extras.js` · `extras.v32.js` | `js/extras.v33.js` |
| `auth.v32.js` | `js/auth.js` (tienda) · `js/auth.v33.js` (admin) |
| `darkmode.js` | Sin sustituto — funcionalidad retirada |
| `admin.css` · `admin.v32.css` | `css/admin.v33.css` |
| `preview-chat-fab.html` | Retirado en build 361 con Maya |

> Tras la limpieza, `js/` contiene **exactamente** los 12 ficheros que cargan las páginas
> activas y `css/` los 2 en uso. Si ves un fichero en `js/` que no está en las tablas de
> arriba, es que alguien lo añadió sin enlazarlo.

---

## 🗄️ Supabase — Estructura Base de Datos

### Tabla `customers`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | PK automático |
| `name` | TEXT | Nombre completo |
| `email` | TEXT | Email único |
| `phone` | TEXT | Teléfono de contacto |
| `address` | TEXT | Dirección de entrega |
| `city` | TEXT | Ciudad / municipio |
| `cedula` | TEXT | Cédula o RNC |
| `password` | TEXT | Contraseña hasheada (null si OAuth) |
| `status` | TEXT | habilitado / deshabilitado / vip |
| `ranking` | TEXT | bronce / plata / oro / vip |
| `orders` | INT | Pedidos realizados |
| `spent` | NUMERIC | Total gastado RD$ |
| `lastOrder` | TEXT | Fecha último pedido |
| `lastLogin` | TEXT | Fecha último acceso |
| `createdAt` | TEXT | Fecha de registro |
| `notes` | TEXT | Notas internas del admin |
| `mapLink` | TEXT | URL manual Google Maps |
| `authProvider` | TEXT | 'google' / 'apple' / null |
| `avatar` | TEXT | URL foto perfil OAuth |
| `locLat` | NUMERIC | Coordenada GPS latitud |
| `locLng` | NUMERIC | Coordenada GPS longitud |
| `loyaltyPoints` | INT | Puntos de fidelización |
| `loyaltyTier` | TEXT | Tier de lealtad |

### Tabla `products`
Productos del supermercado con imagen, precio, categoría, stock, etc.

### Tabla `orders`
Pedidos de clientes con productos, totales, estado, repartidor asignado.

### Tabla `staff`
Personal del supermercado (cajeros, repartidores, administradores).

### Tabla `settings`
Configuración general: nombre tienda, teléfonos, email, WhatsApp, etc.

### Tabla `coupons`
Cupones de descuento con código, tipo, valor, vencimiento.

---

## 📞 Datos de Contacto del Negocio

| Dato | Valor |
|---|---|
| Nombre tienda | Supermercado Casa Mota |
| WhatsApp | 809-751-5617 (número real en Supabase) |
| Teléfono contacto | 809-553-2226 |
| Email soporte | soporte@supermercadocasamota.com |
| Dominio | supermercadocasamota.com |

---

## 🔐 Sistema de Autenticación

### Clientes con contraseña (tradicional)
- Login con email + contraseña
- Admin puede asignar/cambiar contraseña

### Clientes OAuth (Google / Apple)
- Login con Google Identity Services (GIS) — One Tap, sin popup
- `authProvider = 'google'` o `'apple'` en tabla customers
- **NO tienen contraseña** — el admin muestra badge azul "Acceso vía Google/Apple"
- El admin NO debe mostrar alerta de "sin contraseña" para estos clientes

### Flujo `createClientFromOAuth()` — 3 niveles de fallback
1. **Nivel A** — crea con todos los campos (incluyendo authProvider, avatar)
2. **Nivel B** — sin authProvider/avatar (si schema cache falla)
3. **Nivel C** — solo name, email, status (mínimo absoluto)
4. **Post-patch** — si cayó a B o C, parchea authProvider inmediatamente después

### Cliente existente que hace login con Google
- Intenta PATCH `{authProvider: 'google'}` en Supabase
- Si el patch falla → sesión local SIEMPRE tiene authProvider correcto

---

## 🗺️ Sistema GPS / Ubicación

### `js/location.js`
- Modal `#locationModal` en `index.html`
- Campos: Dirección, Ciudad, **Teléfono** (añadido 2026-08-01)
- GPS automático via `navigator.geolocation` + Nominatim reverse geocoding
- Guarda en Supabase: `address`, `city`, `locLat`, `locLng`, `phone`
- Guard de checkout: si no tiene dirección, abre modal antes de confirmar pedido

### Admin — Vista perfil cliente
- Muestra iframe Google Maps embed con coordenadas GPS si `locLat`/`locLng` existen
- Fallback a `mapLink` manual si no hay GPS
- Función: `_renderCustGpsPreview(lat, lng)` en `admin.v33.js`

### Admin — Modal editar cliente
- Bloque `#cGpsPreview` muestra el mapa GPS (solo lectura, informativo)
- Bloque "Ubicación en Google Maps" permite pegar enlace manual

---

## 🏗️ Arquitectura del Sistema

### Stack técnico
- **Frontend:** HTML5 + CSS3 + JavaScript vanilla (sin frameworks)
- **Backend/DB:** Supabase (PostgreSQL + PostgREST)
- **Deploy:** Cloudflare Pages (auto-deploy desde GitHub)
- **CDN:** jsDelivr para librerías (Font Awesome, etc.)
- **Mapas:** Google Maps embed sin API key + Nominatim/OSM

### Cache busting — tiene DOS capas

**Capa 1 — parámetro `?v=NNN` por archivo**
- Todos los JS y CSS lo llevan. Al modificar un archivo → incrementar su número.
- `api.js` lo comparten `index.html`, `admin.html` y `login-cliente.html`:
  **hay que subirlo en los tres a la vez** (fue la causa del bug de 2026-08-01).

**Capa 2 — constante `VER` + sessionStorage** *(fácil de olvidar)*
- `index.html:31` → `var VER = '370'`, clave `cm_app_ver`
- `admin.html:13` → `const VER = '370'`, clave `cm_admin_ver`
- Si el valor guardado en sesión no coincide con `VER`, dispara
  `window.location.reload(true)` una sola vez → recarga saltando la caché HTTP.
  (No recarga en la primera visita: sólo si `stored !== null`.)
- ✅ **Sincronizadas el 2026-08-01** con un **número de compilación global único**:
  antes eran dos contadores independientes (`312` y `286`) que llevaban meses a la
  deriva respecto a los `?v=` reales.

> ### 🔁 Regla de oro al publicar cambios
> 1. Sube el `?v=` del archivo que tocaste (y en **todos** los HTML que lo carguen).
> 2. Sube `VER` **al mismo número en las dos páginas**, por encima del `?v=` más alto.
>
> Ejemplo: si dejas `admin.v33.js?v=360`, pon `VER = '360'` en `index.html` **y** en
> `admin.html`. Un solo número global para todo el proyecto.
>
> 3. ⚠️ **Comprueba que el `.js` está en el commit, no solo el HTML.** El `?v=` es
>    una simple cadena para invalidar caché: **no verifica nada**. Si el HTML pide
>    `chat.js?v=231` y el JS no se subió, el servidor entrega feliz el contenido
>    viejo bajo la URL nueva y el cambio "no aplica" sin ningún error.
>    Pasó el 2026-08-02 con `js/chat.js` (repartidores de Maya).

### Flujo de deploy
1. Editar archivos en el editor (Genspark)
2. GitHub Desktop → Commit + Push a rama `main`
3. Cloudflare Pages auto-deploya en ~1 minuto
4. Verificar en modo incógnito del navegador

---

## 🐛 Problemas Conocidos y Soluciones

### ✅ VERIFICADO EN PRODUCCIÓN — secuencia de `order_number` (2026-08-03)

El usuario ejecutó `limpieza/8-secuencia-order-number.sql`. **6 de 6 comprobaciones en
verde:**

| Comprobación | Resultado |
|---|---|
| `DEFAULT` de la columna | `nextval('orders_order_number_seq'::regclass)` ✅ |
| Índice anti-duplicados | ✅ creado |
| Números duplicados existentes | 0 ✅ |
| Próximo número a asignar | 2 (hay 1 pedido, máximo en uso = 1) ✅ |

El `::regclass` añadido por Postgres es normal (resuelve el nombre a una referencia
interna). **Y todo el build 376/377 quedó comprobado y funcional en producción** según el
usuario, incluido el respaldo real de 20,28 MB con 1.969 registros.

> **Comportamiento nuevo a recordar:** la secuencia **no retrocede**. Borrar el pedido más
> alto ya NO hace que el siguiente reutilice su número — que es exactamente lo que se vino
> a arreglar. Para reiniciar a 1 (solo con la tabla de pedidos vacía):
> `SELECT setval('public.orders_order_number_seq', 1, false);`
> Con datos dentro daría error de duplicado, que es la protección funcionando.

---

### 🔴 Secuelas de la migración a UUID — build 379 (`VER = '379'`)

**Cómo se encontró:** el usuario preguntó *«`supabase_recalc_clientes_y_telefonos.sql` — solo
comentario?»*. **No era solo un comentario. Yo lo había clasificado mal**, y al verificarlo
apareció una cadena de fallos reales que la migración a UUID del build 378 había dejado atrás.
La pregunta evitó desplegar código roto.

#### Fallo 1 — `_retiro` en una columna con clave ajena 🔴 EL GRAVE

El modal de pedidos tiene la opción **«🏬 Retiro en tienda (sin repartidor)»**, cuyo valor
centinela es la cadena `'_retiro'`, que se guardaba **dentro de `orders."driverId"`**.

Al convertir esa columna a `UUID` con clave ajena hacia `drivers.id`, ese valor pasó a ser
**imposible de guardar**: no es un UUID y no existe tal repartidor. Postgres habría devuelto
**400** al guardar el pedido.

> **Lo peor no es el error, es cuándo ocurre:** al pulsar «Guardar» en un pedido real, con el
> cliente esperando. Y ese guardado también aplica los **puntos de fidelización** y el
> **descuento de stock**. Un fallo ahí no es cosmético.

**Corregido en la capa de datos** (`_orderToSupa` de `js/api.js`), que es el único punto por
el que pasan **todos** los guardados de pedidos — así ninguna pantalla futura puede
saltárselo por olvido:
- Todo valor de `clientId`/`driverId` que no sea un UUID válido (incluida `''`) → `NULL`.
- El retiro en tienda se guarda en **`deliveryType = 'retiro'`**, que es texto libre. La
  información **no se pierde**, solo deja de ocupar una columna con clave ajena.
- `_orderFromSupa` **reconstruye** `driverId = '_retiro'` al leer, así que el panel y Maya
  siguen funcionando **sin cambiar su lógica**.

#### Fallo 2 — el retiro se contaba como un repartidor

`_mismoDriver()` (`js/admin.v33.js`) y `_mismoDriverChat()` (`js/chat.js`) comparaban con
`String(o.driverId)` sin excluir el centinela. Si algún día existiera un repartidor con id
`'_retiro'`, se le habrían atribuido **todos** los pedidos retirados en tienda. Ambos lo
excluyen ya de forma explícita, y con el mismo criterio en los dos ficheros.

#### Fallo 3 — la vista se recrearía mal

`supabase_recalc_clientes_y_telefonos.sql` es **uno de los dos únicos sitios que crean
`v_pedidos_por_cliente`**, y seguía con la regla vieja
`ped.client_id = cli.id::text` más una comparación con `''`. Ejecutar su tanda 1 sobre la base
de hoy fallaría con `operator does not exist: uuid = text`, dejando **sin vista** a las tandas
2 y 3, que la necesitan para recalcular los contadores de clientes.

Corregido, con una advertencia en la cabecera y una nota de que **las dos definiciones de la
vista deben mantenerse idénticas** (si divergen, gana la última que se ejecute y nadie se
entera).

#### Fallo 4 — seis ficheros SQL con `c.id::text = o."clientId"`

`supabase_diagnostico_huerfanos.sql`, `supabase_diagnostico_lizbeth.sql`,
`supabase_limpiar_datos_prueba.sql`, `limpieza/1-preview.sql` y `limpieza/5-verificar-final.sql`
comparaban `text` con `uuid`. Son de diagnóstico —no destruyen nada— pero habrían fallado
justo cuando se recurre a ellos: **investigando un problema**.

#### Fallo 5 — las plantillas de proyecto nuevo declaraban `TEXT`

`supabase_new_project.sql` y `supabase_alter.sql` creaban `clientId`/`driverId` como `TEXT`.
Levantar el proyecto de cero con ellos daría una base **sin posibilidad de crear las claves
ajenas**: la deuda estructural 3 volvería a existir en silencio. Ambos declaran ya `UUID`.
`migration/insert_orders.sql` se deja intacto (histórico ya consumido) con un aviso de que
**no sirve como plantilla**.

> **La lección:** cambiar el tipo de una columna no termina en la base de datos. Hay que
> buscar **cada** sitio que la lee o escribe, incluido el que guarda valores inventados como
> `'_retiro'`. Yo di el build 378 por cerrado sin hacer esa búsqueda completa.

**Verificado aquí:** `admin.html` 7 mensajes / 0 errores, `index.html` 0 mensajes.
⚠️ **Sin verificar:** guardar un pedido real marcándolo «Retiro en tienda» requiere producción.

---

### 💾 Un solo respaldo, el de `admin > Respaldo` — build 378 (`VER = '378'`)

**Decisión del usuario:** había **dos** herramientas de respaldo (`backup-tool.html` suelta y
la sección `admin > Respaldo`). Dos herramientas que hacen lo mismo es peor que una: se
arregla una y se olvida la otra. Se consolidó todo en la del panel y se borró la suelta.

#### Lo que la auditoría encontró (dicho con honestidad)

✅ **La exportación del panel ya funcionaba.** No tenía el bug `tables/…`: usaba `DB.*` a
través de un mapa `BK_DB_MAP`. Tampoco tuvo nunca la tabla fantasma `productos`.

🔴 **Pero se diferenciaba de la herramienta buena en tres cosas peligrosas:**

| Defecto | Consecuencia real |
|---|---|
| **Límites fijos** `cupones?limit=500`, `notificaciones?limit=1000`, `settings?limit=50` | El día que hubiera 501 cupones el respaldo **se corta en silencio**. Misma clase de error que el `?page=` ya corregido |
| **Datos transformados** — `DB.getOrders()` aplica `_orderFromSupa()` a cada fila | Un respaldo debe ser **fiel a la base de datos**, no una vista de la tienda |
| **Filas borradas fuera** — algunas funciones `DB` filtran `deleted` | Restaurar dejaría huecos que no se ven hasta que se buscan |

🔴 **Bug de rendimiento grave.** `_bkLoadStats()` y `_bkRenderTableList()` llamaban **cada
una** a las 9 funciones `DB`, es decir **descargaban las tablas enteras dos veces** —los
1.913 productos con sus imágenes base64, ~19 MB por pasada— **solo para mostrar un número**.
Abrir la pestaña Respaldo costaba ~38 MB de tráfico inútil.

🔴 **El Checklist mentía.** Decía «Backup 100% Completo» mientras **faltaban**
`js/location.js` (23 KB) y `js/pedidos-vigilancia.js`, y sus enlaces descargaban de
producción, no del código local. Es el mismo patrón que el `❌` rojo permanente del build
377: un indicador que siempre dice lo mismo enseña a ignorarlo.

#### Lo corregido

1. **Un único camino de código.** Eliminado `BK_DB_MAP`; `_bkFetchAll()` llama ahora a
   `DB.exportTable(tabla, {pageSize:1000, onProgress})` — paginación por cabecera `Range`,
   sin límites fijos, sin transformar, **incluyendo las filas `deleted`**. Ruta ya verificada
   en producción: **1.969 registros, 20,28 MB**.
2. **Conteos sin descargar nada.** Nuevo `_bkLoadCounts()` que usa `DB.countTable()`
   (`Range: 0-0` + `Prefer: count=exact`). Se pide el número, no la tabla.
3. **Checklist eliminado por completo** — bloque HTML (~70 líneas), `_bkInitChecklist()`,
   `_bkUpdateChecklist()` y la clave `casamota_bk_checklist` de localStorage. **El código no
   se respalda ahí: está en GitHub**, que es un respaldo de verdad y con historial.
4. **Referencia huérfana atrapada a tiempo:** `migDownloadZip()` llamaba a
   `_bkUpdateChecklist()`. Habría lanzado un `ReferenceError` **justo después de generar el
   ZIP correctamente** — el peor momento posible. Retirada.
5. **Cuatro barreras contra el fallo silencioso:** guarda de `DB.exportTable` ausente
   (mensaje rojo + botón deshabilitado), clasificación `ausente` para `PGRST205`/404 con
   distintivo `⏭️ No existe`, recuento `okCount/esperadas` que excluye las ausentes, y la
   barrera de respaldo vacío (`⛔ EL RESPALDO ESTÁ VACÍO` + descarga bloqueada).
6. **Nuevo `<aside id="bkInfoRespaldo">`** en lugar del Checklist: qué contiene el JSON,
   por qué pesa ~20 MB (imágenes base64) y por qué el código no va ahí.

✅ **Conservada la «Migración de Imágenes»** (descargar fotos en ZIP) por decisión expresa
del usuario: `migScanImages`, `migDownloadZip`, `migExportTxt`, `migExportJsonUpdated`.

🗑️ **`backup-tool.html` eliminado.** Sus dos referencias restantes actualizadas
(`js/api.js`, `supabase_recalc_clientes_y_telefonos.sql:43`). El build 377 queda absorbido
por el 378, porque su único fichero ya no existe.

**Verificado aquí:** consola limpia (7 mensajes, 0 errores) y la pantalla de login renderiza
con CSS. La sección Respaldo está detrás del login, así que **su interfaz no se pudo
comprobar visualmente desde aquí** — hay que abrirla en producción tras desplegar.

---

### 🔗 Deuda estructural 3 SALDADA — las claves ajenas ya existen (2026-08-04)

Era la última de las tres deudas estructurales. **12/12 comprobaciones verdes**, ejecutado y
verificado por el usuario en Supabase.

#### Lo que había: cero foreign keys

El borrado seguro de clientes (build 372) vivía **solo en JavaScript**
(`_desvincularPedidosDeCliente()` en `js/api.js`). Protegía desde el panel, pero un `DELETE`
desde el SQL Editor dejaba pedidos apuntando a un cliente inexistente.

#### Dos correcciones a mi propio trabajo, antes de tocar nada

⚠️ **Llamé a esta deuda «la más corta de las tres» y me equivoqué.** Al verificar los tipos
reales encontré que las columnas hijas eran `TEXT` y las padre `UUID`, y **PostgreSQL prohíbe
una FK entre tipos incompatibles**. Hacía falta un `ALTER COLUMN ... TYPE UUID`, que **aborta
por completo si una sola fila tiene un valor que no es UUID**. Por eso se escribió primero un
diagnóstico de solo lectura (`9-diagnostico-claves-ajenas.sql`), que dio **escenario limpio**:
cero formatos inválidos, cero huérfanos, cero cadenas vacías.

⚠️ **Mi primer script 10 habría FALLADO.** La vista `v_pedidos_por_cliente` lee
`orders."clientId"`, y PostgreSQL se niega a cambiar el tipo de una columna de la que depende
una vista: `cannot alter type of a column used by a view or rule`. Lo encontré solo porque
busqué en **todo** el proyecto y no solo en `js/`. Solución: `DROP VIEW` en el PASO 0 y
recrearla en el PASO 5, **dentro de la misma transacción** (una vista no guarda datos: es una
consulta con nombre).

#### Lo aplicado

| Paso | Qué hace |
|---|---|
| 0 | `DROP VIEW v_pedidos_por_cliente` (bloquea el cambio de tipo) |
| 1 | Cadenas vacías `''` → `NULL` |
| 2 | `ALTER COLUMN "clientId"/"driverId" TYPE UUID USING NULLIF(col,'')::uuid` |
| 3 | Dos FK `ON DELETE SET NULL ON UPDATE CASCADE`, idempotentes vía `DO $$ ... pg_constraint` |
| 4 | Dos índices en el **lado hijo** (Postgres indexa la PK, no el hijo) |
| 5 | Recrear la vista, idéntica salvo `ped.client_id = cli.id` (ya sin `::text`) |

> **Por qué `SET NULL` y nunca `CASCADE`:** `CASCADE` borraría el pedido al borrar el
> cliente, es decir **destruiría historial real de ventas**. `SET NULL` conserva el pedido
> —importe, fecha, líneas— y solo olvida de quién era.

**Verificado 8/8:** `clientId` = `uuid`, `driverId` = `uuid`, ambas FK existen, ambas con
`confdeltype = 'n'` (= SET NULL), 2 de 2 índices, la vista existe y **sigue devolviendo los
2 cruces pedido↔cliente**. No hizo falta desplegar nada de JavaScript.

#### Dos columnas muertas borradas (`11-borrar-columnas-muertas.sql`)

El diagnóstico reveló algo que el plan original no preveía: **2 de las 4 columnas no las usa
nadie**. `products."categoryId"` tenía **0 valores en 1.913 productos** y
`notificaciones.customer_id` estaba igualmente vacía. El vínculo real de producto→categoría
es `products.category` (slug) contra `categories.slug`.

> **Si hubiera seguido el plan a ciegas**, habría puesto claves ajenas en columnas que nadie
> lee y mostrado 6 comprobaciones verdes, dejando al usuario creyendo que producto→categoría
> estaba protegido cuando no lo estaba. Verificar antes de ejecutar no es burocracia.

Descartado un **falso positivo**: `customer_id` aparece en 4 ficheros `.sql` más, pero siempre
como el **alias** `cli.id AS customer_id` de la vista, que nunca toca `notificaciones`.

El script recuenta con `RAISE EXCEPTION` antes de borrar, y hace `DROP COLUMN` **sin
`CASCADE` a propósito**: con `CASCADE`, una vista o índice dependiente se borraría en
silencio; sin él, el script falla nombrando al dependiente. Un error informativo es mejor que
un borrado en cascada invisible. **Verificado 4/4.**

#### Hallazgo abierto: 1.912 de 1.913 productos tienen categoría

**Un producto no tiene categoría.** No lo causaron los scripts 10 ni 11 (ninguno toca
`products.category`). Importa porque un producto así es **invisible en la tienda**:
`js/app.js:661` (filtro), `js/app.js:1013` (lista de categorías) y `js/admin.v33.js:919`
(gráfico) lo descartan. Creado `limpieza/12-producto-sin-categoria.sql` (solo lectura) para
localizarlo; lo más probable es que ya esté `deleted`.

#### Lo que sigue sin proteger, a conciencia

**Producto→categoría no tiene FK.** Exigiría un `UNIQUE` en `categories.slug`, y un
`ON DELETE SET NULL` ahí **haría desaparecer los productos del catálogo** al borrar una
categoría. Es una decisión de negocio, no técnica: sería el script 13 con su propio
diagnóstico.

---

### 🗄️ La tabla fantasma `productos` ensuciaba el log del respaldo — build 377

**Síntoma.** El respaldo terminaba con `❌ Error en "productos": HTTP 404` y el marcador
`9/10 tablas`, dando la impresión de que algo había fallado.

**No era un fallo.** `productos` es una tabla del esquema **anterior a la migración a
Supabase**; no existe en la base de datos actual. Supabase incluso lo dijo con claridad:

```
PGRST205 · hint: "Perhaps you meant the table 'public.products'"
```

Los productos reales están en **`products`**, y se respaldaron correctamente: **1.913
registros, 19,23 MB**. No faltaba nada en el backup.

**Corregido:**
1. Retirada la décima entrada `productos` de `TABLES` en `backup-tool.html` *(fichero
   eliminado después, en el build 378; la lógica de «tabla ausente» sobrevivió y hoy vive en
   `bkStartExport()` de `js/admin.v33.js`)*.
2. **Se distingue «tabla ausente» de «error real».** Un `PGRST205`/404 se registra como
   `⏭️ no existe — se omite (no es un fallo)` en azul, no como error rojo. Un timeout o un
   500 siguen siendo error. El recuento final excluye las ausentes, así que ya no aparece
   ese `9/10` engañoso.
3. La tabla de resultados muestra `⏭️ No existe` en vez de `❌ Error`.

> **Por qué importa la distinción:** el valor de esta herramienta está en que un problema
> real *se vea*. Si todo sale en rojo por igual, se aprende a ignorar el rojo — y entonces
> un fallo de verdad pasa desapercibido. Era justo el modo de fallo que tenía antes.

**Aclarado también el tamaño:** los 20 MB son normales porque las imágenes de producto se
guardan en base64 dentro de la propia base de datos (`js/api.js:87` ya las excluye de la
carga de la tienda por ese peso). Añadida una nota en la interfaz: un respaldo de ~20 MB
es lo esperado y significa que también recuperarías las fotos.

**Verificado aquí:** 9 fichas en pantalla, sin la fantasma, consola limpia.
Captura: https://www.genspark.ai/api/files/s/wTmnh3xe

---

### 🧱 Deuda estructural saldada — build 376 (`VER = '376'`)

Dos arreglos **de raíz**, elegidos por el usuario tras preguntar si todo lo hecho
últimamente era definitivo «hardcore» o había parches. La respuesta honesta fue que
quedaban tres deudas; estas son las dos primeras.

#### 1. `backup-tool.html` producía respaldos VACÍOS ⚠️ (era el riesgo más grave)

**Causa raíz:** la herramienta **no cargaba `js/api.js` en absoluto**. Hablaba directamente
con `fetch('tables/<tabla>')`, la API interna de desarrollo, que **no existe en producción**.
Cada tabla fallaba y el archivo salía sin datos — con la falsa sensación de tener copia.

**Solución, en la capa correcta:**
- Añadidas a `js/api.js` (v=323) dos funciones: **`DB.exportTable(tabla, opts)`** y
  **`DB.countTable(tabla)`**. Viven en la capa de datos, así que heredan la detección de
  entorno, cabeceras, timeouts y reintentos que ya usa todo lo demás.
- `exportTable` pagina con la **cabecera `Range` de PostgREST**, no con `?page=` (que
  habría devuelto siempre la primera página → respaldo truncado). Lee el total real de
  `Content-Range` y trata el **416** como «fin de datos».
- Exporta **también los registros `deleted`**: un respaldo debe ser fiel a la base de
  datos, no una vista filtrada de la tienda.
- `backup-tool.html` ahora carga `js/api.js?v=323` y delega en `DB.*`.

**Tres barreras nuevas contra el fallo silencioso** (lo peligroso no era el fallo, era que
no se notara):
1. Si `DB.exportTable` no existe al cargar → **mensaje rojo** y botón deshabilitado.
2. Si el respaldo termina con **0 registros** → aviso `⛔ EL RESPALDO ESTÁ VACÍO` en el log
   y el botón de descarga se bloquea.
3. `downloadAll()` **se niega a generar el archivo** si no hay filas.

**Verificado aquí:** contadores reales en pantalla (1640 productos, 42 categorías, 3
pedidos…), sin errores. Captura: https://www.genspark.ai/api/files/s/jOYDpQI5

#### 2. `order_number` era un `INTEGER` calculado en JavaScript

**Tres fallos reales, no teóricos:**

| # | Fallo |
|---|---|
| 1 | **Reutilizaba números.** Borrar el pedido más alto hacía que el siguiente repitiera ese número |
| 2 | **Carrera entre clientes.** Dos pedidos simultáneos leían el mismo `max()` → mismo número. Más probable cuanto mejor vaya la tienda |
| 3 | **Número basura.** `js/app.js:2934` tenía `catch(e) { nextNum = Date.now() % 100000; }` → un número aleatorio de 5 cifras que además envenenaba la numeración siguiente. **Esto sí era un hack** |

**Solución — `limpieza/8-secuencia-order-number.sql`:**
- `CREATE SEQUENCE orders_order_number_seq`, colocada con `setval` por encima del máximo
  actual (con la tabla vacía → arranca en **1**).
- `ALTER COLUMN order_number SET DEFAULT nextval(...)` → **la base de datos asigna el
  número**, de forma atómica.
- **`CREATE UNIQUE INDEX` parcial** — la garantía de verdad: aunque un bug futuro intente
  escribir un número repetido, Postgres lo rechaza. Esto es lo que lo convierte en
  estructural y no en otra corrección de aplicación.
- `GRANT USAGE ON SEQUENCE` a `anon` y `authenticated` (sin esto los INSERT desde la web
  fallarían con «permission denied for sequence»).
- Idempotente, transaccional, y no modifica ningún pedido existente.

**Cambios en el código (deja de calcular el número):**
- `js/api.js` → `createOrder()` hace `delete payload.order_number` y **devuelve la fila
  creada** con el número real. Incluye red de seguridad: si la columna llega `NULL`
  (secuencia no ejecutada aún), avisa en consola y asigna con el método antiguo.
- `js/app.js` (v=341) → eliminado el bloque `max()+1` **y el `Date.now() % 100000`**. El
  mensaje de confirmación usa el número devuelto por la base de datos.
- `js/admin.v33.js` (v=362) → eliminado el `maxId+1`; el toast lee `saved.order_number`.
  Además registra el pedido en la vigilancia para no anunciarlo como «nuevo» 30 s después.
- `js/api.js` → **eliminada la línea que falsificaba el número**:
  `if (!r.order_number && r.id) r.order_number = r.id;` copiaba el UUID dentro del número
  (origen del bug 373) y, peor, **hacía indistinguible un número ausente de uno legítimo**.
  Todos los puntos de visualización ya resuelven el caso vacío por su cuenta.

> ⚠️ **ORDEN OBLIGATORIO:** ejecutar `8-secuencia-order-number.sql` **ANTES** de subir el
> código del build 376. La red de seguridad existe, pero no conviene depender de ella.

**Verificado aquí:** consola limpia en tienda y panel; ninguna referencia huérfana a
`newId` (re-comprobado con grep tras cada edición).
**NO verificable aquí:** que un pedido real reciba el número correcto (necesita la
secuencia creada en Supabase).

#### Deuda que queda de las tres

- [ ] **Foreign keys con `ON DELETE SET NULL`.** La base de datos **no tiene ni una sola
      FK** (verificado: `grep "FOREIGN KEY|REFERENCES" *.sql` → 0 resultados). El arreglo
      del borrado de clientes (build 372) vive en JavaScript: protege desde el panel, pero
      no si alguien borra un cliente desde el SQL Editor. Convertirlo en garantía de datos
      sigue pendiente.

### ✨ El dashboard «pestañeaba» varias veces al entrar — build 375 (`VER = '375'`)

**Síntoma (reportado con captura).** Tras el login, el dashboard tarda unos segundos en
cargar (normal y esperado), pero **después de terminar seguía recargándose varias veces en
menos de 2 segundos**.

Había **dos causas independientes**, y una la introduje yo en el build 374.

#### Causa A — regresión mía del build 374 ⚠️

`js/pedidos-vigilancia.js` llamaba a **`loadDashboard()`** en cada sondeo. Eso:

1. **Volvía a descargar los 1.913 productos** (`loadDashboard` hace
   `DB.getProducts({full:true})`, `admin.v33.js:778`) — totalmente redundante, porque el
   sondeo ya trae los pedidos y los productos no cambian solos.
2. Repintaba el gráfico **dos veces más**.

Y el módulo arrancaba a los **1,5 s**, justo cuando la carga inicial acababa. Encajaba
exactamente con el síntoma descrito.

**Mi error de diseño:** al quitar el `return` temprano de la primera pasada para que la tabla
se repintara, no vi que en el dashboard eso disparaba un `loadDashboard()` completo. Para un
sondeo cada 30 s, recargar el catálogo entero es absurdo.

**Corregido en `pedidos-vigilancia.js` v=4:**
- **Nunca** llama a `loadDashboard()`. Usa `renderDashboardKpis()` + `renderRecentOrders()`,
  que son las únicas que dependen de los pedidos.
- **Si no hay pedidos nuevos, no toca la interfaz** (`const hayCambios = nuevos.length > 0`).
  Antes repintaba en cada sondeo aunque no hubiera cambiado nada.
- `DBCached.invalidateOrders()` solo cuando hay cambios reales.
- El arranque **ya no lanza una consulta**: siembra los ids desde la variable global `orders`
  que `initAdminData()` acaba de rellenar.
- Retardo de arranque **1,5 s → 4 s**, para no solaparse con la carga inicial.

#### Causa B — ya existía desde antes (no venía del 374)

`renderSalesChart()` **destruía y recreaba** el chart en cada dibujado
(`admin.v33.js:917-926`), y el chart tiene una **animación de 1,1 s** (`duration: 1100`).
Cada reconstrucción relanzaba esa animación desde cero → parpadeo.

Además `initAdminData()` lo dibuja **dos veces** por diseño: en la fase 1a (L551, cuando
`adminProducts` aún está vacío → **gráfico en blanco**) y en la fase 1b (L568, con los 1.913
productos → gráfico real).

**Tres arreglos en `renderSalesChart()`:**

| # | Arreglo |
|---|---|
| 1 | **No dibujar el gráfico vacío.** Si no hay categorías y los productos aún no llegaron, se mantiene el skeleton y se sale. Elimina una reconstrucción completa |
| 2 | **Actualizar en vez de recrear.** Si las etiquetas son las mismas, `data = …` + `update('none')` (sin animación). Solo se reconstruye si cambian las categorías |
| 3 | **Cifras estables.** El multiplicador era `Math.random()` (L921): el mismo gráfico mostraba **importes distintos** en cada repintado. Sustituido por un peso derivado del `id`/`name` del producto |

Se extrajo `_ocultarSkeletonGrafico()` porque la ruta `update('none')` **no dispara**
`animation.onComplete`, que era donde vivía el código de retirar el placeholder.

> **Trampa evitada:** con el arreglo 1, si la fase 1b falla, el skeleton se quedaría girando
> **para siempre**. Por eso solo se aplaza mientras `adminProducts` está vacío; si ya se
> cargó y aun así no hay categorías válidas, se retira el placeholder igualmente.

> ⚠️ **Nota sobre este gráfico:** «Ventas por categoría» **NO son ventas reales** — es una
> estimación a partir del precio de catálogo, porque no hay datos de ventas por categoría.
> Antes era además aleatoria. Ahora es estable, pero **sigue siendo una estimación**. Si se
> quiere que sea real, hay que calcularla desde los `items` de `orders`.

**Verificado aquí:** consola sin errores de código, CSS aplicado.
**NO verificable aquí:** la ausencia de parpadeo tras el login (requiere sesión real y los
1.913 productos). **Esa es la prueba que queda pendiente.**

---

### 🔔 Los pedidos no se refrescaban solos — build 374 (`VER = '374'`)

**Síntoma.** Con el panel abierto en la lista de Pedidos, un pedido nuevo **no aparecía
nunca**. Había que salir de la sección y volver a entrar, o pulsar F5. En un mostrador eso
significa perder pedidos.

**Causa.** Los pedidos solo se cargaban al **entrar** en la sección (`admin.v33.js:660`).
No existía ningún refresco periódico. El `setInterval` que ya había en el panel
(`_arTimer`, `admin.v33.js` ~L6940, clave `cm_autoreload`) es **exclusivo de productos** —
no toca `orders`. Y `updatePendingBadge()` (~L3220) es un **stub vacío**: los badges del
sidebar están desactivados, así que tampoco avisaban por ahí.

**Solución — `js/pedidos-vigilancia.js` (fichero nuevo, IIFE de ~11 KB).**
Se hizo aparte a propósito: `admin.v33.js` ya pesa 324 KB y este bloque es autónomo.

| Pieza | Comportamiento |
|---|---|
| Sondeo | `DB.getOrders()` cada **30 s**, en **cualquier sección** y también con la **pestaña en segundo plano** |
| Cuándo NO sondea | Solo si no hay sesión de staff (pantalla de login) o `DB` aún no está cargada. Si la sesión caduca, `_pvParar()` |
| Detección | `Set` de ids conocidos. Los que no estén → nuevos |
| Primera pasada | **Solo memoriza, no avisa** (si no, anunciaría todos los pedidos viejos de golpe) |
| Sin peticiones duplicadas | `showSection()` siembra los ids con `pvRegistrarLista(list)` reutilizando **su propio** `DB.getOrders()` |
| Aviso sonoro | Web Audio API, 4 notas do5/sol5 (523,25 / 783,99 Hz) con rampas exponenciales para que no chasquee |
| Aviso visual | Toast + **parpadeo del título** de la pestaña (se restaura al volver a ella) |
| Preferencia | `localStorage['cm_pedidos_sonido']`, **por defecto activado** |
| Refresco manual | Botón «Refrescar» → `pvSondearAhora()` |
| Respeta modales | `_pvHayModalAbierto()` evita repintar el `<tbody>` mientras hay un modal encima |
| `orders` siempre fresco | Se actualiza la variable global aunque estés en otra sección |

**API pública:** `pvToggleSonido()`, `pvNotificarSeccion()`, `pvRegistrarLista(lista)`,
`pvSondearAhora()`, `pvEstado()` (diagnóstico desde la consola del navegador).

#### ⚠️ Corrección de diseño dentro del propio build 374

La **primera** versión solo vigilaba en Pedidos/Dashboard y con la pestaña visible, para
ahorrar cuota de Supabase. **Era la prioridad equivocada** y lo detectó el usuario al
preguntar simplemente «pero cuando llegue un pedido escucharé un sonido?»: avisaba justo
cuando MENOS falta hace (ya estás mirando la lista) y se callaba cuando MÁS falta hace
(estás en Inventario, o en otra pestaña). El coste real de vigilar siempre son ~960
consultas/día con el panel 8 h abierto — nada frente al plan gratuito (500.000/mes).
La precaución inicial era exagerada.

**Dos fallos reales encontrados al hacer el cambio:**

1. **El arranque no podía colgar de `showSection()`.** Al cargar el panel, el Dashboard ya
   viene con `class="active"` puesta en el HTML (`admin.html:249`) y **`showSection()` no se
   llama hasta que el usuario pulsa algo en el menú**. Con el arranque ahí, la vigilancia no
   habría empezado hasta el primer clic. Ahora auto-arranca con `_pvIniciar()` (reintenta
   cada 3 s mientras no haya sesión).
2. **El detector de modales estaba mal escrito:** buscaba `.modal-backdrop.show/.active`,
   pero en este panel los modales se ocultan con la clase **`.hidden`** y algunos con
   `style.display`. Se cambió por una comprobación de visibilidad real (`offsetParent`),
   que no depende de la convención usada.

**Cableado (4 puntos):**
1. `admin.html` → `<script src="js/pedidos-vigilancia.js?v=3">` tras `admin.v33.js?v=360`
2. `admin.html` → botones `#pvBtnSonido` y `#pvBtnRefrescar` en el `.page-header` de Pedidos,
   dentro de un `.orders-header-actions`
3. `js/admin.v33.js` → `pvNotificarSeccion(id)` al final de `showSection()`, con guarda
   `typeof … === 'function'` (el módulo es opcional: si falta, el panel sigue igual)
4. `css/admin.v33.css` → `.orders-header-actions` (flex + wrap en móvil)

### 🔊 ¿Cuándo suena de verdad? (respuesta honesta)

**SÍ suena si:** el panel está abierto (cualquier sección, incluso en pestaña de fondo) +
hay sesión + se ha hecho al menos un clic en la página + volumen subido. Tarda **hasta
30 s**, no es instantáneo.

**NO suena si:** el panel está **cerrado**, o —en móvil— la pantalla está bloqueada o el
navegador minimizado (el sistema congela la pestaña).

> ⚠️ **LIMITACIÓN REAL DEL SONIDO, no un bug.** Los navegadores **bloquean el audio** hasta
> que el usuario interactúa con la página (política de autoplay). El primer aviso tras
> cargar el panel **puede no sonar** si no se ha hecho ni un clic. Mitigación: el
> `AudioContext` se desbloquea en el primer `click`/`keydown`/`touchstart`, y al pulsar el
> botón de aviso suena una confirmación. **El toast y el parpadeo del título sí funcionan
> siempre.** Como para entrar al panel hay que hacer login (con clics), en uso normal suena.

> 📴 **Para avisar con el panel CERRADO harían falta notificaciones push:** Service Worker
> con evento `push`, claves VAPID y un disparador en servidor cuando entra un pedido en
> Supabase. Son varias horas de trabajo y en iPhone exige instalar la web como app en la
> pantalla de inicio. **Se descartó por ahora**: primero probar si con el panel siempre
> abierto en el mostrador ya basta.

> **Por qué NO Supabase Realtime.** Sería instantáneo y más elegante, pero exige habilitar
> la replicación de la tabla en el panel de Supabase y su propia ronda de pruebas. El sondeo
> reutiliza `DB.getOrders()`, que ya está probado en producción. Si algún día se migra, el
> **único** punto a cambiar es `_pvSondear()`.

**Verificado aquí:** consola limpia; en la pantalla de login aparece `módulo cargado` pero
**NO** `vigilancia activa` — confirma que `_pvDebeVigilar()` bloquea el sondeo sin sesión,
que es el comportamiento correcto.

**NO verificable aquí:** que suene de verdad (necesita navegador real con interacción y
altavoces), ni que detecte un pedido entrante (necesita un pedido real en producción), ni
el comportamiento en pestaña de fondo. **Para diagnosticar en producción:** abrir la consola
del navegador y ejecutar `pvEstado()`.

---

### 🔢 La tienda mostraba el UUID en vez del nº de pedido — build 373 (`VER = '373'`)

**Síntoma.** El mismo pedido se veía distinto en cada lado:

| Dónde | Mostraba |
|---|---|
| Panel admin | `#1` ✅ |
| Tienda → Mis pedidos | `#3735c83a-d24a-400f-a8e1-51123f133146` ❌ |

**Causa.** `js/app.js` pintaba `#${o.id}` y **desde la migración a Supabase `id` es un
UUID**, no el número corto. El panel ya usaba `o.order_number || o.id` (`admin.v33.js:870`
y `:2032`) y la factura PDF también (`extras.v33.js:534`), pero **la tienda se quedó sin
actualizar** — un resto de cuando `id` era un entero correlativo.

**Solución.** Helper `orderLabel(o)` en `js/app.js` (justo antes de `renderMyOrders`):
devuelve `order_number` y, para pedidos antiguos sin él, recorta el UUID a los 6 últimos
caracteres en mayúsculas en vez de escupir 36 caracteres.

Aplicado en los **3 sitios visibles al cliente**:

| Sitio | Antes | Ahora |
|---|---|---|
| Tarjeta de «Mis pedidos» | `#${o.id}` | `#${orderLabel(o)}` |
| Enlace del historial de cupones | `#${o.id}` | `#${orderLabel(o)}` |
| Toast al cancelar | `#${orderId}` | `#${orderLabel(order)}` |

⚠️ **Lo que NO se tocó, a propósito:** los `o.id` de los `onclick`
(`repeatOrder`, `cancelClientOrder`, `deleteClientOrder`, `scrollToOrder`), los
`id="order-card-${o.id}"` del DOM y las consultas `?id=eq.${orderId}`. **El UUID sigue
siendo la clave real** para buscar y modificar el pedido; solo cambia lo que se muestra.
Confundir las dos cosas rompería cancelar y repetir pedidos.

📌 **Falsa alarma descartada:** `js/app.js:3916` y `:4022` usan `tables/orders/${orderId}`,
pero están dentro de `if (_IS_GENSPARK)` → no se ejecutan en producción. **No** son
ocurrencias del bug `tables/…`.

### 💥 Borrar un cliente dejaba sus pedidos huérfanos — build 372 (`VER = '372'`)

**El bug.** `_apiDelete()` (`js/api.js`) hace un **`DELETE` real**, no un `deleted = true`.
Durante meses se creyó que era borrado suave — no lo es. Al eliminar una ficha de
cliente desde el panel, la fila desaparecía de `customers` pero sus pedidos seguían
en `orders` con un `clientId` apuntando a un id **que ya no existía**.

Consecuencia: **pedidos huérfanos**. No se atribuían a nadie, no aparecían en las
estadísticas de ningún cliente y su importe se esfumaba de los totales.
En producción se encontraron **4 pedidos así, RD$1.898** (datos de prueba, confirmado).

**Por qué no se detectó antes.** El panel cruza pedido↔cliente por
`c.id === o.clientId || c.email === o.email` (`admin.v33.js:2587`). Si el email coincide,
el pedido se rescata por ahí y el vínculo roto pasa desapercibido. Los 4 huérfanos
solo salieron a la luz porque el nombre difería: *«Sabin Mota Ramírez»* vs *«Sabin Mota»*.

**⚠️ Magnitud real: 8 de 10 pedidos tenían el `clientId` roto**, no 4. Conviene no
confundir las dos métricas — cuesta un informe erróneo:

| Métrica | Definición | En producción |
|---|---|---|
| `clientId` roto | El `clientId` apunta a una fila que ya no existe | **8 de 10** |
| Huérfano de verdad | No cruza por `clientId` **ni** email **ni** nombre | **4** (RD$1.898) |

Los 4 restantes (#5–#8, «Sabin Mota») tenían el `clientId` roto pero **se rescataban por
email**, así que seguían contando en las estadísticas — de ahí que el recalc diera
RD$2.186 correctos para esa ficha. El fallback por email estaba tapando el problema.
La lección: **un `clientId` roto es un bug aunque las cifras salgan bien**, porque
depende de que el email coincida para no perder el pedido.

**La solución (`DB.deleteCustomer`).** Antes de borrar la ficha, los pedidos se vuelven
autosuficientes:

1. Se les **estampa la identidad** del cliente (`customer` / `customer_email` /
   `customer_phone`) en sus propias columnas, solo donde falte.
2. Se pone **`clientId = null`** con un único `PATCH` masivo (`_apiPatchWhere`) → deja de
   ser una referencia rota y pasa a ser un pedido explícitamente sin ficha.
3. Solo entonces se borra el cliente.

Si el paso 2 falla, **el cliente no se borra** y el error sube a la interfaz. Antes un
botón que da error que una base de datos con punteros muertos.

**Decisiones descartadas y por qué:**

| Alternativa | Por qué no |
|---|---|
| Borrar los pedidos con el cliente | Son registros contables: la venta ocurrió aunque la ficha se elimine |
| Borrado suave (`deleted = true`) en `customers` | Habría que filtrar `deleted` en `getCustomers()`, el login de la tienda y cada pantalla del panel. Demasiada superficie |

**`deleteDriver` tenía el mismo problema** (`orders.driverId` colgando) y se arregló
igual, con una diferencia: ahí el fallo **no** bloquea el borrado, porque un `driverId`
suelto solo afecta a la etiqueta del repartidor, no al importe de la venta.

**En la interfaz:** el modal de `admin.html` ahora avisa de que *«sus pedidos no se
borran»*, el botón se deshabilita con spinner mientras trabaja (el borrado ya no es
instantáneo: son varias peticiones), y el toast informa de cuántos pedidos se
conservaron. También se invalida `DBCached.invalidateOrders()`, que faltaba —
los pedidos cambian de `clientId`, así que el caché quedaba mentiroso.

⚠️ **`login-cliente.html` cargaba `js/api.js?v=320`** mientras los otros dos HTML iban
por v=321: llevaba un build desincronizado. Corregido a v=322 en los cuatro HTML
(`index`, `admin`, `login-cliente`, `test-scanner`).

### 🧼 Limpieza de datos de prueba — carpeta `limpieza/`

Los 5 clientes y 10 pedidos de la BD eran todos de prueba. Limpieza quirúrgica en
**7 tandas** (preview → snapshot → verificar copia → borrado en transacción →
verificación → deshacer comentado → borrar respaldo).

**Un fichero por tanda**, no un fichero con rangos de líneas:

```
limpieza/LEEME.md                        ← instrucciones
limpieza/1-preview.sql                   ← Ctrl+A, copiar, pegar, RUN
limpieza/2-snapshot.sql
limpieza/3-verificar-snapshot.sql
limpieza/4-BORRAR.sql                    ← la única que escribe datos
limpieza/5-verificar-final.sql
limpieza/6-DESHACER-solo-si-algo-fallo.sql
limpieza/7-borrar-respaldo.sql
```

**Progreso de ejecución (2026-08-03):**

| Tanda | Estado | Resultado |
|---|---|---|
| 1 · preview | ✅ | 5 clientes · 10 pedidos · RD$5.699 · **8 de 10 con `clientId` roto** |
| 2 · snapshot | ✅ | `snapshot creado` |
| 3 · verificar copia | ✅ | customers 5=5 · orders 10=10 |
| 4 · BORRAR | ✅ | `Success. No rows returned` — COMMIT sin error |
| 5 · verificar final | ✅ | **8/8 en ✅** — customers 0 · orders 0 · clientId roto 0 · products **1913** · categories 35 · drivers 4 · staff 8 · settings 1 |
| 6 · deshacer | — | no se necesitó |
| 7 · borrar respaldo | ⏳ | **sin prisa** — dejar hasta hacer un pedido real de prueba |

✅ **LIMPIEZA COMPLETADA (2026-08-03).** Base de datos en cero de clientes y pedidos,
catálogo de 1.913 productos intacto. El esquema `respaldo` **sigue existiendo** con las
5 fichas y 10 pedidos originales: no borrarlo hasta validar en producción.

Cifras del preview a conservar para comparar después:
**products 1913 · categories 35 · drivers 4 · staff 8 · settings 1.**

Decisión del usuario: **la numeración arranca de nuevo en #1**, no se mantiene numeración alta.

**Numeración de pedidos tras la limpieza: vuelve a #1 sin tocar nada.**
`orders.order_number` es una columna `INTEGER` (`supabase_alter.sql:231`), **no un
`SERIAL`**. El número se calcula en el cliente como `max(order_number) + 1`:

| Dónde | Código | Con tabla vacía |
|---|---|---|
| Tienda | `js/app.js:2924-2932` — `let nextNum = 1;` y solo entra al `if` si hay pedidos | 1 |
| Panel | `js/admin.v33.js:3132` — `reduce(…, 0)` + 1 | 1 |

⚠️ **Riesgo latente de este diseño:** el número no se persiste en un contador, se
recalcula leyendo la tabla. Si se borra el pedido con el número más alto, el
siguiente **reutiliza ese número** → dos pedidos distintos con el mismo `#` en el
historial. No afecta a la limpieza (se vacía todo), pero es un problema real si se
borran pedidos sueltos en producción. Arreglo futuro: usar una secuencia de Postgres
o guardar el último número en `settings`.

📌 **Lección de usabilidad:** la primera versión fue un único fichero con la tabla
«tanda / líneas 57–93 / …». **El SQL Editor de Supabase no muestra números de línea**,
así que era inservible en la práctica. Para scripts por tandas: **un fichero por
tanda, siempre**. `supabase_limpiar_datos_prueba.sql` (raíz) se conserva solo como
referencia y lleva un aviso en la cabecera redirigiendo a `limpieza/`.

Borra **solo** `customers`, `orders`, `notificaciones` y vacía `cupones.usedBy`.
Conserva `products`, `categories`, `drivers`, `staff`, `settings` y los cupones.

🛑 **`supabase_truncate.sql` NO sirve para esto.** Hace `TRUNCATE` de las **9 tablas**,
incluidas `products`, `categories`, `drivers`, `staff` y `settings`: dejaría la tienda
vacía y habría que reconstruir el catálogo a mano. Se llegó a considerar recomendarlo
antes de leerlo — no cometer ese error otra vez.

El borrado va dentro de `BEGIN; … COMMIT;` para que un fallo a mitad no deje la BD
a medias. `cupones` y `notificaciones` se tratan con `to_regclass(...) IS NOT NULL`
por si no existen en el proyecto.

### 🧹 Lote de limpieza — build 371 (`VER = '371'`)

Seis puntos de deuda técnica cerrados de golpe.

| # | Deuda | Cómo se resolvió | Estado |
|---|---|---|---|
| 0 | Sin red de seguridad para revertir el recalc | `supabase_snapshot_antes_de_recalc.sql` — copia las 4 tablas al esquema `respaldo` | ✅ ejecutado |
| 1 | `customers.orders/spent/lastOrder` desfasadas en la BD | `supabase_recalc_clientes_y_telefonos.sql` PASO 1 (vista previa) + PASO 2 (`UPDATE … FROM orders`) | ✅ ejecutado y verificado — 5/5 clientes con `estado='='` |
| 2 | Teléfonos guardados sin guiones | Mismo SQL, PASO 3 (`casamota_fmt_phone()`) + PASO 4 (bucle sobre 7 columnas) | ⚠️ parcial — ver nota abajo |
| 3 | `.catch(() => {})` silenciosos | `logFail(contexto)` en `js/api.js`; 10 usos en `app.js`, 7 en `admin.v33.js`, 1 en `chat.js` | ✅ |
| 4 | ~490 líneas de CSS muerto `.chat-*` | Purgadas: `css/style.css` pasó de **3.816 → 3.328 líneas** (−488) | ✅ |
| 5 | `test-scanner.html` usaba `tables/settings` | Ahora carga `js/api.js` y usa `DB.getSettings()` / `DB.saveSettings()` | ✅ |
| 6 | `/api/chat` sin rate-limiting | Ventana deslizante en `functions/api/chat.js` + respuesta 429 | ✅ |

**Punto 2 — teléfonos: hecho a medias.** Se ejecutaron las tandas 1, 2, 3, 4, 6a y 6b.
La función `casamota_fmt_phone()` **existe** en la BD y la verificación dio `tel_ok=true`
en las 5 fichas (809-000-0000, 849-205-1240, 829-975-4648, 809-748-4590, 809-696-1013).

⏳ **La tanda 5 (`DO $$` con el bucle) NO se ejecutó.** Solo se comprobaron 3 columnas
(`customers.phone`, `drivers.phone`, `orders.customer_phone`). Siguen sin revisar:
`customers.whatsapp`, `drivers.whatsapp`, `staff.phone` y `orders.phone`.

📌 Con la limpieza de datos de prueba (build 372) esto **pierde casi toda su urgencia**:
`customers` y `orders` quedan vacías, así que solo quedarían por normalizar
`drivers.whatsapp` y `staff.phone`. Los teléfonos nuevos ya entran con máscara
gracias a `js/location.js` v=121.

**Purga de CSS (punto 4).** El bloque iba de la línea 3314 al final del fichero.
Auditado antes de borrar: **todas** las reglas eran `.chat-*`, más `@keyframes chatDotBounce`
(usado solo dentro del bloque) y dos `@media` que solo contenían `.chat-*`.
`chatFadeIn` se usaba en la línea 3687 pero **nunca estuvo definido en `style.css`** —
era ya una referencia rota. En su lugar queda un comentario de 12 líneas.
⚠️ Los `.chat-*` de `css/admin.v33.css` **siguen en uso** (Maya en el panel) y no se tocaron.

**Bug `tables/…` — séptima y octava ocurrencia encontradas.** Además de
`test-scanner.html`, apareció `js/ai.js` (líneas 466 y 704): las dos funciones de
descripciones masivas por IA cargaban productos con `fetch('tables/products?…')`,
lo que en producción daba `Error al cargar productos (HTTP 404)`. Sustituido por
`DB.getProducts({ full: true })`, que ya pagina sola. **Esta función estaba rota en
producción y nadie lo había reportado.**
✅ **Verificado en producción (2026-08-03): funciona.** Primera vez que se ejecuta con
éxito desde la migración a Supabase.

**Rate-limiting (punto 6).** En `functions/api/chat.js`, antes del `fetch` a Groq:

| Tope | Valor |
|---|---|
| Chat por IP y minuto | 15 |
| Visión (escáner) por IP y minuto | 5 |
| Global del sitio por minuto | 150 |
| Bloqueo tras 5 rechazos seguidos | 5 minutos |

Responde `429` con `Retry-After` y un mensaje en español; `js/chat.js` lo muestra
tal cual en la burbuja en vez de "Sin conexión a la IA".

> ⚠️ **Honestidad técnica:** el contador vive en la memoria del *isolate* de Cloudflare.
> Los isolates se reciclan y hay varios por región, así que esto frena ráfagas y bots
> simples, pero **no es un límite duro global**. Para garantía real hay que añadir en el
> panel: *Security → WAF → Rate limiting rules* con
> `(http.request.uri.path eq "/api/chat")`, 20 req/min por IP, bloqueo 10 min
> (la cuota gratuita de Cloudflare incluye 1 regla). Está documentado en la cabecera
> del propio fichero.

**No verificable desde aquí:** el rate-limiting solo corre en el runtime de Cloudflare;
no hay forma de probarlo en el editor. Hay que comprobarlo en producción mandando
16 mensajes seguidos a Maya y viendo que el nº 16 responde el aviso de espera.

### ✅ RESUELTO · Lizbeth S. Mota Hazim — los 12 pedidos / RD$48.397 eran ficticios

> **Veredicto (2026-08-03):** contadores de demo, no facturación real. Se pusieron
> a 0 y fue lo correcto. Ficha eliminada después en la limpieza de datos de prueba.
> Se conserva el análisis porque el método de diagnóstico es reutilizable.

**Cadena de prueba que lo demostró:**

1. `orders=12` con `lastOrder=NULL` es **imposible** para el código de la app: los dos
   únicos sitios que escriben esos contadores (`app.js:2990` y `admin.v33.js:3180-3184`)
   escriben las tres columnas juntas. Un contador alto sin fecha no lo pudo poner la app.
2. La ficha se creó el **25/04/2026**, pero el pedido más antiguo de toda la tabla
   `orders` es del **29/07/2026** (resultado de D3).
3. `borrados=0` — no había pedidos con `deleted=true` que explicaran el desfase.
4. `generateDemoCustomers()` (`admin.v33.js:5955`) contiene literalmente
   `orders:12, spent:52000` en sus filas hardcodeadas.

**Lección aplicable a futuro:** un contador desnormalizado que no cuadra con los datos
crudos **no es prueba de nada**. Antes de decidir, cruzar con las fechas de creación y
con el código que escribe esos contadores.

---

Resultado original del PASO 1 del recálculo, para referencia:

| Cliente | Guardado | Real | Lectura |
|---|---|---|---|
| **Lizbeth S. Mota Hazim** | 12 ped · RD$48.397 | **0 · RD$0** | ⚠️ Contadores sin pedidos |
| Sabin Mota | 0 · RD$0 | 4 · RD$2.186 | Contador nunca escrito |
| Saury Mota | 0 · RD$0 | 1 · RD$300 | Contador nunca escrito |
| Apple Revisor | 0 | 0 | correcto |
| Liz mara Hazim Amparo | 0 | 0 | correcto |

**El cruce pedido↔cliente FUNCIONA** — Sabin y Saury encajan con 4 y 1 pedidos.

**Estado final tras ejecutar el recálculo** (verificado, 5/5 con `estado='='`):
Apple Revisor 0/0 · Liz mara 0/0 · Lizbeth 0/0/NULL · Sabin 4/RD$2.186/01-08 08:10 ·
Saury 1/RD$300/01-08 14:43.

**Ficheros de diagnóstico (se conservan como plantilla):**
- `supabase_diagnostico_lizbeth.sql` — D1-D5 de solo lectura. **D3 fue la consulta
  decisiva**: comparar la fecha del pedido más antiguo con el `lastOrder` del cliente.
- `supabase_diagnostico_huerfanos.sql` — H1-H4. **No se ejecutó**; H3 sigue siendo útil
  como plantilla (distingue `clientId` inexistente de ficha con `deleted=true`).
- `supabase_recalc_conservador.sql` — variante del PASO 2 que **nunca baja un contador
  a cero** (`HAVING count(*) > 0`, sin el segundo UPDATE). **No se necesitó**, pero vale
  para el próximo caso ambiguo.

⚠️ **Error de razonamiento cometido y corregido en este análisis:** interpreté
`sin_clientid=0` (de D3) como *«todos los pedidos cruzan con un cliente»*. Es falso:
confunde **«el campo está rellenado»** con **«el campo apunta a una fila que existe»**.
De hecho 8 de 10 pedidos tenían el `clientId` roto. No repetir.

### 🗑️ `backup-tool.html` — ELIMINADO en el build 378

> **Histórico:** usaba `fetch('tables/<tabla>')` (líneas 353 y 404) y **no cargaba
> `js/api.js`**, así que en producción devolvía 404 y generaba un respaldo **vacío** — el
> peor fallo posible en una herramienta de backup, porque parecía funcionar. Reparada en el
> build 376 (migrada a `DB.exportTable()`), y **borrada en el 378** al consolidar el respaldo
> en `admin > Respaldo`.

**Dónde se respalda hoy:** `admin.html → Respaldo`. Mismo motor (`DB.exportTable()`,
paginación por cabecera `Range`, incluye filas `deleted`) y las mismas barreras contra el
archivo vacío. **Una sola herramienta, un solo camino de código.** Detalle en la sección del
build 378.

### 🧯 Cómo respaldar antes de un script destructivo

El plan de Supabase es **PRO** → hay backup diario automático + *Point in time*.
En `Database → Backups` **no existe** botón de backup manual; solo `Restore`.

⚠️ `Restore` devuelve **toda** la base de datos a la medianoche → se perderían los
pedidos y clientes creados desde entonces. Desproporcionado para deshacer unos
contadores.

**Procedimiento correcto:** `supabase_snapshot_antes_de_recalc.sql`

| Paso | Qué hace |
|---|---|
| A | Copia `customers`, `orders`, `drivers`, `staff` al esquema `respaldo` |
| B | Comprueba que el número de filas coincide (solo lectura) |
| C | Deshace **solo** las columnas afectadas (comentado; descomentar si hace falta) |
| D | `DROP SCHEMA respaldo CASCADE` cuando todo esté verificado |

Ventaja sobre el Restore: las filas creadas después del PASO A **no se tocan**,
porque el `UPDATE … FROM respaldo… WHERE c.id = b.id` no las encuentra en la copia.

### PGRST204 — Schema Cache de PostgREST
- **Causa:** PostgREST no reconoce columnas nuevas hasta refresh
- **Solución:** Ejecutar en Supabase SQL Editor:
  ```sql
  NOTIFY pgrst, 'reload schema';
  ```
- **Prevención:** Fallback de 3 niveles en `createClientFromOAuth()`

### PWA instalada mostraba layout desktop (2 columnas)
- **Causa:** `@media (min-width: 769px)` se disparaba en PWA standalone
- **Solución:** Cambiado a `@media (min-width: 769px) and (display-mode: browser)`
- **Añadido:** `@media (display-mode: standalone)` fuerza slider móvil siempre

### ⚠️ `tables/...` NO EXISTE EN PRODUCCIÓN — causa recurrente de bugs

Es el fallo que más veces ha reaparecido en este proyecto. `tables/<tabla>` es la
API del **entorno de desarrollo** (Genspark). En `supermercadocasamota.com` esa ruta
devuelve **404**, el `catch` se lo traga y la función sigue como si no hubiera datos.

**Regla:** en código de la app usar siempre `DB.getSettings()`, `DB.saveSettings()`,
`DB.getProducts()`… que resuelven el entorno internamente con el flag `_IS_GENSPARK`.
El único sitio donde `tables/...` es legítimo es dentro de `api.js`, en las ramas
`if (_IS_GENSPARK)`.

Casos ya corregidos: `_chatLoadStoreInfo()` (chat), `showRegisterInfo()` (login) y
el bloque de la clave Groq (2026-08-01, ver abajo).

### Maya (IA) no respondía en la tienda (resuelto 2026-08-01)
- **Síntoma:** el chat contestaba *"😕 Servicio de IA temporalmente no disponible"*
  a cualquier pregunta. Funcionaba en el navegador del admin pero no para clientes.
- **Causa:** la clave de Groq se leía y se escribía contra `tables/settings`, que en
  producción da 404. Estaba repetido en **5 sitios**:
  | Archivo | Función | Tipo |
  |---|---|---|
  | `chat.js:43` | `_chatGroqKey()` | lectura |
  | `chat.js:65` | `_preloadChatGroqKey()` | lectura |
  | `index.html:1462` | `_preloadGroqKey()` (escáner) | lectura |
  | `index.html:1584` | `_getScanGroqKey()` (escáner) | lectura |
  | `ai.js:148` | `saveGroqKey()` | **escritura** |
- **Lo importante era la escritura:** al guardar la clave desde Admin → Configuración,
  el PATCH iba a `tables/settings` → 404 → `catch` → el toast decía *"guardada
  localmente (sin sincronizar)"*. La clave se quedaba en el `localStorage` del admin
  y **nunca llegó a Supabase**, así que ningún cliente podía obtenerla.
- **Solución:** lecturas vía `DB.getSettings()` y escritura vía
  `DB.saveSettings({ groqApiKey })` + `DBCached.invalidateSettings()`.
  `chat.js` v=226 · `ai.js` v=252 · `index.html` (2 bloques inline).
- ⚠️ **Requiere acción manual:** hay que volver a guardar la clave en
  Admin → Configuración → IA para que esta vez sí se escriba en Supabase.

### 🗄️ `drivers.vehicle` no existía en Supabase (resuelto 2026-08-02, SQL)

**Síntoma:** guardar cualquier repartidor → `400 PGRST204 "Could not find the
'vehicle' column of 'drivers' in the schema cache"`. Además el vehículo se veía como
**"🛵 undefined"** en la tabla de Repartidores.

**Causa — migración a medias, no un bug del código.** `migration/insert_drivers.sql`
creó la columna como **`vehicle_type`** y lo documenta en su línea 35
(*«vehicle (columna vieja) → vehicle_type (columna nueva)»*), pero **el código nunca
se adaptó**: `js/admin.v33.js` sigue leyendo y escribiendo `vehicle`. Verificado que
ningún `.js` usa `vehicle_type`.

**Solución:** `supabase_fix_drivers_vehicle.sql` — renombra la columna en la BD para
que coincida con el código (`RENAME` conserva los datos), añade como red de seguridad
el resto de campos que escribe `saveDriver()` con `IF NOT EXISTS`, y ejecuta
`NOTIFY pgrst, 'reload schema'`. Es idempotente.

**✅ EJECUTADO EN PRODUCCIÓN (2026-08-02).** Verificación devuelta por el SQL Editor:

| name | vehicle | zone | status |
|---|---|---|---|
| Lino Reyes | moto | Hato Mayor | activo |
| Luis Fernández | carro | Santiago / Zona Centro | descanso |
| Pedro Santana Guzman | bicicleta | Zona Sur / Gazcue | en_ruta |
| Ramón Jiménez | moto | Zona Norte / Ensanche Ozama | activo |

La columna se llama ya `vehicle`, `vehicle_type` desapareció y **ningún valor quedó
en NULL** — el riesgo que se había señalado (que los repartidores nunca hubieran
tenido vehículo guardado) no se materializó. El arreglo del `undefined` en pantalla
es efectivo **sin necesidad de desplegar código**, basta recargar el admin.

> 💡 **`PGRST204` = columna que el código escribe pero no existe en Supabase.**
> Un campo que se muestra como `undefined` en pantalla suele ser la misma causa.
> Antes de tocar código, comparar el objeto que se envía con
> `information_schema.columns`.

**También corregido** (`admin.v33.js` v=357): `saveDriver()` actualizaba el array en
memoria **antes** del PATCH, así que un error dejaba la pantalla mostrando un cambio
no guardado. Ahora la memoria se actualiza dentro del `.then()`.

> ⚠️ **Otras tablas migradas pueden tener el mismo desfase.** `insert_drivers.sql`
> también renombró `active` → `status`. Si aparece otro `PGRST204`, revisar el
> `migration/insert_*.sql` correspondiente antes que el código.

### 🛵 Los KPIs de Repartidores siempre en 0 (resuelto 2026-08-02, `admin.v33.js` v=356)

**Síntoma:** las columnas *Asignados*, *Entregados* y *Pendientes* de la pantalla
Repartidores marcaban **0 para los cuatro repartidores**, y *Total entregados* también.

**Causa — cadena rota, no un cálculo erróneo.** La infraestructura ya existía
(`_driverAssigned` / `_driverDelivered` / `_driverPending`, columna `driverId` en
Supabase desde `supabase_alter.sql:163`), pero **nadie escribía el dato**:

| Origen del pedido | ¿Llevaba `driverId`? |
|---|---|
| Nuevo pedido creado desde el admin | ✅ sí, con el `<select id="noDriver">` |
| Pedido hecho por un cliente en la tienda | ❌ nunca (el cliente no elige repartidor) |
| Cambio de estado a *enviado* / *entregado* | ❌ **el modal ni siquiera preguntaba** |

Como la inmensa mayoría de pedidos vienen de la tienda y su único punto de
asignación habría sido el cambio de estado, `driverId` era `null` siempre → los tres
contadores filtraban sobre un campo vacío → 0 perpetuo.

**Solución:**
- Nuevo `<select id="orderDriverEdit">` en el modal de pedido, junto al estado.
- `_toggleDriverRequired()`: marca el campo en naranja y avisa cuando el estado
  elegido es *enviado* o *entregado*.
- `saveOrderStatus()` **bloquea el guardado** sin repartidor en esos dos estados,
  guarda `driverId` y refresca `renderDrivers()` si la vista está montada.
- Opción explícita **🏬 Retiro en tienda (sin repartidor)** (valor `_retiro`) para no
  bloquear los pedidos que el cliente recoge en el local.
- `_mismoDriver()`: la comparación pasa de `===` estricto a `String(a)===String(b)`.
  `driverId` es TEXT en Supabase y `d.id` puede ser número o UUID — con el estricto,
  los contadores habrían seguido en 0 aun con el dato bien guardado.
- Corregido de paso un `return` sin `_unlockOS()` que dejaba el botón "Guardando…"
  colgado si el pedido desaparecía de memoria.

> ⚠️ **Pedidos históricos:** los que ya están en *enviado* o *entregado* siguen sin
> `driverId` y **no aparecerán en los contadores**. Solo se puede arreglar reabriendo
> cada uno y asignando repartidor a mano, o con un UPDATE en Supabase.

### 📉 Contadores de cliente en 0 · teléfonos sin guiones (2026-08-02, build 369)

**Síntoma:** el perfil de un cliente mostraba *Pedidos realizados **0***, *Total
gastado **RD$ 0.00*** y *Último pedido **—*** aunque el cliente sí tenía pedidos.
En la tabla convivían filas con cifras altas (Lizbeth: 12 pedidos / RD$ 48,397) y filas
a cero, así que **no era un fallo de carga sino de sincronía**.

> 📌 **Corrección posterior (2026-08-03):** aquí se dio por «correcta» la fila de Lizbeth.
> **No lo era** — esos 12 pedidos eran de `generateDemoCustomers()`, nunca existieron.
> Ver la sección «RESUELTO · Lizbeth» arriba.

**Causa — contadores denormalizados que nadie recalcula.** `customers.orders`,
`customers.spent` y `customers.lastOrder` son columnas que **solo se incrementan
en el momento de crear un pedido**, en dos sitios independientes:
`js/app.js:2986` (tienda) y `js/admin.v33.js:3174` (panel). Nunca se recalculan.
Se desincronizan con:

- pedidos **cancelados** o **borrados** (el contador no baja nunca),
- pedidos creados **antes** de que existiera ese código,
- pedidos creados desde el panel para un cliente que ya existía,
- y sobre todo: **los tres `PATCH` fallan en silencio** (`.catch(() => {})`), así
  que un error de red deja el contador desfasado para siempre y sin rastro.

**Solución — dejar de leerlos.** `_customerStats(c)` en `js/admin.v33.js` cuenta
los pedidos reales del array `orders` en cada render. Cruce por `clientId`, luego
`email`, y como último recurso el nombre normalizado (la misma regla que usa
`js/chat.js`). Se aplica en la tabla, en el modal de perfil y en los dos
ordenamientos (*Por gasto* / *Por pedidos*), que antes ordenaban por cifras
distintas a las que se veían.

- Los **cancelados** se excluyen del total gastado y se muestran aparte
  (`3 · 1 cancelado`), en vez de inflar la cifra.
- Si el array `orders` no está disponible se cae a los contadores guardados
  (`estimado: true`) para no mostrar ceros falsos.
- `_chatEstadisticasGlobales()` (`chat.js` v=231) también dejó de leer
  `customers.spent`: el Top 5 de Maya y la pantalla ya no pueden discrepar.

> ⚠️ Las columnas siguen existiendo y siguen desfasadas en Supabase. Ya no se
> leen en ninguna pantalla, pero **si alguien las consulta directamente en la BD
> obtendrá cifras falsas**. Recalcularlas con un `UPDATE ... FROM orders` es
> deuda técnica pendiente.

**Número de pedido abreviado.** `_orderShortLabel(o)`: si `order_number` es un
correlativo (`12`) muestra `#12`; si es un UUID heredado (`_orderFromSupa` hace
`if (!r.order_number && r.id) r.order_number = r.id`) muestra solo los 6 últimos
caracteres, `#4C9A1F`, en vez de 36 caracteres. *Último pedido* pasa a ser
`#12 · 28/07/2026 14:30`.

**Fechas.** `_orderTime(o)` parsea `"dd/mm/aaaa HH:MM"` (el formato que genera
`app.js:2886`), que `Date()` **no** entiende: sin esto el "último pedido" salía
aleatorio. Prioriza `created_at` si existe.

**Teléfonos con guiones obligatorios.** `fmtPhoneDO()` y `fmtPhoneDOPartial()`
viven en **`js/api.js`** porque es el único fichero que cargan las dos caras.

| Dónde | Qué hace |
|---|---|
| `js/location.js` (tienda) | máscara al escribir, normaliza **antes** de guardar y exige 10 dígitos si el campo no está vacío |
| `js/admin.v33.js` (panel) | formatea **al mostrar** en tabla y perfil → los números ya guardados sin guiones se ven bien sin tocar la BD |
| `saveCustomer()` | normaliza también lo que escribe el admin |

Regla: 10 dígitos → `809-696-1013`; 7 → `696-1013`; `1` inicial de 11 dígitos se
descarta; **cualquier otra longitud se deja intacta** (número extranjero).

> ⚠️ La máscara de la tienda **solo admite dígitos**: un cliente con teléfono
> extranjero con `+` no podrá escribirlo en el modal de ubicación. Asumido: es una
> tienda de barrio con reparto local.

### 🛵 Maya consulta repartidores (añadido 2026-08-02, `chat.js` v=230)

Última pieza del bloque de gestión. Solo tenía sentido **después** de rellenar
`driverId` en los pedidos históricos: antes los contadores habrían salido todos a 0
y Maya habría dado una foto falsa del negocio.

| Bloque | Cuándo | Contenido |
|---|---|---|
| `REPARTIDORES` | **siempre** | una línea por repartidor: vehículo, zona, estado, asignados / entregados / pendientes / cancelados y valor entregado + pedidos enviados sin repartidor + retiros en tienda |
| `REPARTIDOR: <nombre>` | si se nombra a uno | placa, desglose por estado y últimos 5 pedidos con cliente e importe |

**Por qué la tabla completa va siempre** (a diferencia del bloque de cliente):
es una línea por persona y hay 4. Así «¿cuántos ha entregado cada uno?» se responde
sin que el admin nombre a nadie. Tope de 25 repartidores por si crece la plantilla.

**Búsqueda por nombre — regla distinta a la de clientes.** Aquí basta **una** palabra
de 4+ letras (hay pocos y con nombres dispares, así «Reyes» funciona), pero si esa
única palabra la comparten varios se inyectan todos y el prompt pide concretar.
Los clientes siguen exigiendo 2+ palabras porque *Sabin Mota* / *Saury Mota* colisionan.

**⚠️ Regla duplicada:** `_mismoDriverChat()` replica `_mismoDriver()` de
`admin.v33.js:4957` (comparación por `String()`). Si se toca una, tocar la otra o
Maya y la pantalla de Repartidores darán cifras distintas. Igual que `_STOCK_BAJO`.

**Endurecido en v=232** tras un falso negativo en producción (Maya seguía diciendo
*«no tengo información sobre repartidores»*):

- `_chatLoadGestion()` usa **`Promise.allSettled`**, no `Promise.all`: antes, si
  fallaba **una** de las tres consultas se perdían las otras dos y Maya se quedaba
  ciega de todo a la vez, sin que nada lo indicara.
- Si la lista de repartidores llega vacía, el bloque **ya no se omite en silencio**:
  se inyecta diciendo «llegó VACÍA» con la orden de reportarlo. Un bloque ausente
  hace que el modelo rellene el hueco inventando *«no tengo acceso»*, que es
  exactamente el síntoma que despista.
- `console.log('[Chat] Contexto de gestión: N pedidos · N clientes · N repartidores')`
  en cada carga: convierte un diagnóstico de media hora en una mirada a la consola.

> ✅ **Verificado en producción 2026-08-02** tras subir el fichero que faltaba.
>
> 🔎 **Causa real del falso negativo:** `js/chat.js` no se había subido al repo,
> así que Cloudflare servía el contenido **v=229** bajo la URL `?v=231`. El
> `?v=` es solo una cadena para invalidar caché: **no verifica que el fichero
> haya cambiado**. Si un fichero JS parece no aplicar sus cambios, lo primero es
> comprobar que está realmente en el commit, no depurar el código.

**Definiciones que se le imponen al modelo:** *pendientes* de un repartidor =
`pendiente` + `procesando` + `enviado`; *entregados* = solo `entregado`. Y se le
prohíbe explícitamente confundir clientes con repartidores (listas distintas).

### 📊 Maya consulta pedidos y clientes (añadido 2026-08-02, `chat.js` v=229)

Maya pasa de "asistente de catálogo" a **asistente de gestión**. Solo en modo admin:
`_chatLoadGestion()` sale inmediatamente si `_IS_ADMIN` es falso.

| Bloque en el prompt | Cuándo se inyecta | Contenido |
|---|---|---|
| `INVENTARIO` | siempre | agotados + stock bajo (`< 20`) |
| `ESTADÍSTICAS GLOBALES` | siempre | pedidos por estado, ventas acumuladas, nº de clientes, top 5 por gasto |
| `CLIENTE: <nombre>` | solo si se detecta un cliente en la pregunta | pedidos por estado, total gastado, puntos, últimos 5 pedidos |
| `REPARTIDORES` / `REPARTIDOR` | v=230, ver sección anterior | KPIs por repartidor |

**Estados de pedido** (deben coincidir con el `<select>` de `admin.v33.js:2276`):
`pendiente` · `procesando` · `enviado` · `entregado` · `cancelado`.

**Por qué bajo demanda:** meter todos los pedidos en el prompt reventaría el límite
de tokens en cuanto haya unos cientos. El bloque de cliente solo aparece cuando
`_chatBuscarClientes()` identifica a alguien.

**Desambiguación de nombres:** exige **2+ palabras** del nombre coincidiendo, o el
nombre completo literal. Con una sola palabra "Mota" empataría con *Sabin Mota*,
*Saury Mota* y el propio *Casa Mota*. Si varios clientes empatan, se inyectan hasta
3 bloques y el prompt le ordena pedir que concreten.

**Pedidos ↔ cliente** se cruzan por `email` (fiable); si el pedido no lo trae, por
nombre normalizado.

> 🔒 **Privacidad:** se envían a Groq nombre, email, importes, estados y puntos.
> **NO** se envían teléfono, dirección, cédula ni coordenadas GPS, y el prompt le
> prohíbe explícitamente inventarlos. Si alguna vez se añaden, hay que revisar
> `privacy.html`.

**Rendimiento:** usa `DBCached.getOrders()` / `getCustomers()`, la misma caché que
el panel. Si el admin ya visitó Pedidos o Clientes, no hay peticiones extra.

### Maya no veía el inventario en el admin (resuelto 2026-08-02, `chat.js` v=228)

**Síntoma:** a "¿Cuáles productos tienen poco stock?" Maya contestaba *"el inventario
actual no muestra datos"*, mientras la pantalla de Inventario marcaba **Stock bajo: 1**.

**Tres fallos encadenados**, no uno:

| # | Fallo | Efecto |
|---|---|---|
| 1 | `_chatLoadProducts()` usaba `tables/products?limit=500` | 404 en producción → `catch` → `_chatProdCache = []`. Maya sin **ningún** producto |
| 2 | El `.map()` descartaba `stock` y `unit` | Aunque cargara, era imposible hablar de inventario. `p.unit` era siempre `undefined` |
| 3 | `_getRelevantProducts()` filtra por palabras del mensaje | "¿qué tiene poco stock?" no nombra productos → score 0 → devolvía los primeros alfabéticamente |

**Solución:**
- `DBCached.getProducts()` en lugar de `tables/*` (**otra víctima del bug `_IS_GENSPARK`**,
  van ya 6 sitios corregidos).
- Se añaden `stock` y `unit` al caché; el catálogo muestra `stock:` en modo admin.
- Nueva `_chatInventarioResumen()`: bloque con agotados y stock bajo **siempre** en el
  prompt, independiente del filtro de relevancia.
- `_getRelevantProducts()` detecta intención de inventario y ordena por stock ascendente.
- Prompt de admin reescrito: prohíbe explícitamente decir "no tengo acceso".
- `_chatProdCache` se reconstruye en cada mensaje desde `DBCached` (memoria, sin
  peticiones extra) → si el admin edita stock, Maya lo ve sin recargar.

> ⚠️ **`_STOCK_BAJO = 20` en `chat.js` debe coincidir con `p.stock < 20` de
> `js/admin.v33.js`** (líneas 144, 745, 1049, 3223). Si cambias el umbral en un sitio,
> cámbialo en el otro o Maya dará cifras distintas a las de la pantalla de Inventario.

### 🗑️ Maya retirada de la tienda (build 361, 2026-08-01)

**Decisión de producto del propietario:** el chatbot no aportaba valor real al cliente
final. Se retira **solo de la tienda**; en el admin sigue activo.

| Elemento | Qué se hizo |
|---|---|
| `index.html` FAB + panel (antes L900-961) | **Eliminado**, sustituido por comentario explicativo |
| `index.html` `<script>` de `chat.js` | **Eliminado** |
| `js/chat.js` | **Se conserva intacto** — lo carga `admin.html` |
| `admin.html` (FAB, panel, `_CHAT_IS_ADMIN`, enlace de descarga) | **Sin tocar** |
| `functions/api/chat.js` | **Se conserva** — lo necesitan el escáner y el Maya del admin |
| `css/style.css` bloque `.chat-*` (L3314→final) | Marcado **LEGACY · INERTE**, no purgado (ver deuda técnica) |
| `preview-chat-fab.html` | Movido a `backup/legacy/` |
| `images/maya-avatar-v2.png` | **Se conserva** — lo usa el admin |

> ⚠️ **Eliminar Maya ≠ eliminar el proxy.** El escáner de códigos de barras de la
> tienda usa `/api/chat` con el modelo de visión `llama-4-scout`, por una vía de código
> **independiente** de `chat.js` (`_groqVisionReadBarcode()` en `index.html`).
> Si alguien borra `functions/api/chat.js`, el escáner deja de leer códigos por IA.

**Para restaurarlo:** recuperar el bloque de markup de `backup/v28.0/index.html`
y volver a incluir el script de `js/chat.js` al final del documento.

### 🔐 Proxy de IA — la clave Groq NO se expone (✅ EN PRODUCCIÓN 2026-08-02)

La clave vive en una **variable de entorno de Cloudflare**, nunca en el navegador
ni en Supabase.

**Estado:** desplegado y verificado. Commit `4ca4087`.
`GET https://supermercadocasamota.com/api/chat` devuelve
`{"ok":true,"servicio":"proxy-ia-casamota","configurado":true}`.
Esa URL es el **health check**: úsala siempre como primer diagnóstico si la IA falla.
`configurado:false` = falta la variable o falta el *Retry deployment*.

| Pieza | Qué hace |
|---|---|
| `functions/api/chat.js` | Cloudflare Pages Function. Recibe `POST /api/chat`, añade la cabecera `Authorization` con `env.GROQ_API_KEY` y reenvía a Groq |
| `js/chat.js` (v=227) | Llama a `/api/chat` sin credenciales. `_chatLLMFetch()`. **Solo admin desde el build 361** |
| `index.html` (escáner) | `_groqVisionReadBarcode()` usa el mismo proxy. **Único consumidor de IA que queda en la tienda** |

**Configuración en Cloudflare** (una sola vez, ya hecha):
Workers & Pages → `supermercado-casa-mota` → Settings → **Variables and secrets**
→ Add → Type `Secret` · Name `GROQ_API_KEY` · Value `gsk_...` → Save.

> ⚠️ **"Automatic deployments enabled" NO aplica las variables nuevas.** Se inyectan
> al construir. Tras guardar o cambiar la clave hay que ir a **Deployments** → `···` en
> la fila superior de *All deployments* → **Retry deployment**. Es el paso que
> siempre se olvida y el causante típico de `configurado:false`.

**Protecciones del proxy:** lista blanca de modelos, tope de `max_tokens` (400),
límite de cuerpo (6 MB, por las fotos del escáner) y comprobación de mismo origen.

**Fallback:** si la Function no está desplegada (404/501), el cliente vuelve a la
llamada directa **solo si ese navegador tiene clave en `localStorage`** (caso del
admin). Así el despliegue es reversible y no deja el chat peor que antes.

> ⚠️ **NUNCA guardes la clave Groq en Supabase.** La tabla `settings` la lee
> cualquier cliente con la clave anónima, así que equivaldría a publicarla.
> Por eso `saveGroqKey()` (`ai.js` v=253) ya **no** escribe en la base de datos:
> solo guarda un respaldo local en el navegador del admin.

**Limitación honesta:** el proxy protege la *clave*, no el *endpoint*. Alguien
podría llamar a `/api/chat` y consumir cuota. La diferencia es que no puede
llevarse la clave a otro sitio y tú puedes limitar o cerrar el endpoint.

### La tienda no reflejaba las ediciones de productos (resuelto 2026-08-01)
- **Síntoma:** al editar un producto en el admin, la tienda seguía mostrando los
  datos viejos hasta recargar con F5. Crear o eliminar productos sí funcionaba.
- **Causa 1 — selector erróneo:** `_updateProductCardsDOMOnly()` buscaba
  `.product-price`, una clase que **no existe** en la tarjeta (la real es
  `.price-current`). `querySelector` devolvía `null` y la actualización de precio
  no se aplicaba nunca, en silencio.
- **Causa 2 — firma incompleta:** la comparación que decide si algo cambió sólo
  miraba `id|price|stock|badge|name`. Cambiar descripción, categoría, unidad,
  valoración o precio tachado se consideraba "nada cambió".
- **Causa 3 — campos no parcheados:** aunque se detectara el cambio, la función
  sólo tocaba precio y badge; nombre, descripción, categoría y estrellas no.
- **Solución (`app.js` v=338):** firma ampliada a todos los campos visibles de la
  fase 1; `_updateProductCardsDOMOnly()` reescrita con los selectores correctos y
  actualizando todos los campos; ahora devuelve `boolean` y, si un cambio no se
  puede parchear (badge o precio tachado que aparecen de cero), el llamador hace
  `renderProducts()` completo como plan B.
- **Limitación conocida:** cambiar **sólo la foto** de un producto existente sigue
  necesitando recarga completa. La imagen base64 no viaja en la fase 1
  (`_SELECT_FIELDS.products` no incluye `image`), así que el refresco silencioso
  no puede detectarlo.

### `admin.html` cargaba una versión antigua de `api.js` (resuelto 2026-08-01)
- **Síntoma:** el panel admin podía ejecutar código viejo de `api.js` servido desde la
  caché HTTP del navegador, sin los fixes de OAuth / `authProvider`.
- **Causa:** `admin.html` pedía `js/api.js?v=305` mientras `index.html` y
  `login-cliente.html` ya pedían `?v=320`. Al ser URLs distintas, el navegador
  mantenía dos copias cacheadas del mismo fichero.
- **Solución:** `admin.html` actualizado a `js/api.js?v=320`.
- **Prevención:** `api.js` lo comparten los **tres** HTML. Al subir su versión hay que
  cambiarla en `index.html`, `admin.html` y `login-cliente.html` a la vez.
  El Service Worker no ayuda aquí: es *network-only* para JS, pero la caché HTTP
  normal del navegador sí distingue por query string.

### Cliente OAuth mostraba "Sin contraseña" en admin
- **Causa:** `authProvider = NULL` en Supabase (creado con Nivel C)
- **Solución código:** `createClientFromOAuth()` siempre parchea authProvider
- **Solución DB:** `UPDATE customers SET "authProvider"='google' WHERE email='...'`

---

## 📋 Columnas SQL añadidas (ALTER TABLE)

```sql
-- Ejecutadas en Supabase (todas con IF NOT EXISTS)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "authProvider" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "avatar"       TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "locLat"       NUMERIC;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "locLng"       NUMERIC;

-- Refresh schema cache después de ALTER TABLE
NOTIFY pgrst, 'reload schema';
```

---

## 🔧 Funciones JS Clave

### `js/api.js`
| Función | Descripción |
|---|---|
| `createClientFromOAuth(profile)` | Crea o actualiza cliente OAuth con 3-level fallback |
| `DB.patchCustomer(id, fields)` | PATCH parcial a Supabase |
| `DB.getCustomerByEmail(email)` | Busca cliente por email |
| `_isSchemaErr(e)` | Detecta errores PGRST204/schema cache |
| `_nowTs()` | Timestamp legible "DD/MM/YYYY HH:MM" |

### `js/location.js`
| Función | Descripción |
|---|---|
| `openLocationModal(onConfirm, forceOpen)` | Abre modal GPS |
| `locConfirmAddress()` | Guarda dirección + ciudad + teléfono en Supabase |
| `requireAddressBeforeCheckout(onProceed)` | Guard de checkout |
| `renderLocationSection()` | Vista "Mi Ubicación" en panel cliente |

### `js/admin.v33.js`
| Función | Descripción |
|---|---|
| `viewCustomerDetail(id)` | Modal perfil cliente con GPS + badge OAuth |
| `openCustomerModal(id)` | Modal editar cliente con GPS preview |
| `_renderCustGpsPreview(lat, lng)` | Muestra/oculta bloque GPS en modal edición |
| `renderCustomers()` | Tabla de clientes con badges de acceso |
| `previewCustMap()` | Preview mapa en modal edición (enlace manual) |

---

## 📱 PWA (Progressive Web App)

- `manifest.json` configurado para instalación en iOS/Android
- `sw.js` — Service Worker para funcionamiento offline
- Icono: `images/logo-casamota.png`
- Display mode: `standalone` (sin barra del navegador)
- **Importante:** En modo standalone el login usa slider móvil, NO grid desktop

---

## 🔄 Sincronización admin → tienda

La tienda **se actualiza sola**, sin que el cliente recargue. Cuatro disparadores,
todos llaman a `_refreshProductsSilent()` (`app.js:209`):

| Disparador | Cuándo | Línea |
|---|---|---|
| `visibilitychange` | El usuario vuelve a la pestaña | `app.js:351` |
| `focus` | La ventana recupera el foco | `app.js:362` |
| Polling | Cada **5 min**, sólo si la pestaña está visible | `app.js:373` |
| Pull to refresh | Gesto de arrastrar hacia abajo (móvil) | `app.js:383` |

**Freno de 60 s** (`app.js:349`): entre dos refrescos deben pasar 60 segundos.
Si creas un producto y saltas a la tienda de inmediato, puede tardar un minuto.

| Cambio en el admin | ¿Llega solo a la tienda? |
|---|---|
| Crear / eliminar producto | ✅ Sí — re-render completo |
| Precio, stock, nombre, descripción, categoría, unidad, valoración, badge | ✅ Sí (desde v=338) |
| Cambiar **sólo la foto** | ❌ No — requiere recarga (la imagen no viaja en la fase 1) |

> No confundir con la **auto-recarga de productos** de Admin → Configuración
> (`cm_autoreload`, `admin.v33.js:6618`): esa refresca la tabla **del panel admin**,
> no la tienda del cliente.

---

## 🧠 Notas técnicas críticas

Conocimiento rescatado de `ESTADO_SESION.md` (abr-2026) y **verificado contra el código
actual el 2026-08-01**. Las notas que ya no aplicaban se descartaron.

| # | Nota | Dónde |
|---|---|---|
| 1 | **IDs UUID**: comparar siempre con `String()` y pasar entre comillas en `onclick` | Global |
| 2 | **Imágenes de producto**: cuadradas 800×800 o 1024×1024, fondo blanco (`object-fit: contain` en toda la app) | Global |
| 3 | **`renderStars()` está duplicada** en `app.js:39` y `admin.v33.js:25`. Si la cambias, cámbiala en las dos | `app.js` · `admin.v33.js` |
| 4 | **Font Awesome 6**: el icono correcto es `fa-star-half-stroke` (en FA 5 era `fa-star-half-alt`) | Global |
| 5 | **Clics en cards iOS Safari**: `touch-action: manipulation` + `_cardClick(event, id)`. No quitar, o los `<div>` dejan de recibir clics táctiles | `app.js:887` · `index.html:740` |
| 6 | **Paginación API**: `_apiGetAll()` recorre páginas de **200** registros (se bajó desde 500 para aligerar Supabase) | `api.js:140` |
| 7 | **Tope de 500 sin paginar** en `staff` y `drivers`: si el personal crece por encima de 500, se truncará en silencio | `api.js:448-508` |

> Descartadas por obsoletas: la nota del Service Worker `?v=125` (hoy `sw.js` v170 con
> `CACHE_NAME='casamota-v290'`) y el truco `ontouchend` / `_cardTapPending`, que ya no
> existe en el código.

---

## 🔑 Credenciales de prueba

> ⚠️ Este documento vive en el Segundo Cerebro, **no en el repo de GitHub**.
> No copies esta tabla a `README.md` ni a ningún archivo que se suba al repositorio.

### Clientes (tienda)
| Email | Contraseña |
|---|---|
| ana.garcia@gmail.com | Ana2024! |
| carlos.mota@gmail.com | Carlos2024! |
| maria.perez@gmail.com | Maria2024! |

### Admin
| Email | Contraseña | Rol |
|---|---|---|
| admin@casamota.com.do | Admin2024! | Super Admin |
| ana.ramirez@casamota.com.do | Ana2024! | Administradora |

---

## 📦 Índice de backups

Carpeta `backup/` con instantáneas **v1.0 → v28.0**, cada una con su propia copia de
`js/`, `css/` y HTML (son autónomas: no dependen de los archivos de la raíz).
Varias incluyen `BACKUP_INFO.md` o `CHANGELOG.md` con el detalle.

| Versión | Fecha | Código | Hito |
|---|---|---|---|
| v1.0 | Ene 2026 | v1 | Versión inicial |
| v2.0 | Feb 2026 | v30 | Tienda + Admin básico |
| v3.0 | Feb 2026 | v60 | Carrito + Checkout |
| v4.0 | Mar 2026 | v80 | Login clientes |
| v5.0 | Mar 2026 | v90 | Escáner básico |
| v6.0 | Mar 2026 | v100 | PWA + Favoritos |
| v7.0 | Mar 2026 | v110 | Fidelización |
| v8.0 | Abr 2026 | v115 | Notificaciones |
| v9.0 | Abr 2026 | v120 | Cupones de descuento |
| v10.0 | 06 Abr 2026 | v124 | Repartidores + Reportes |
| v11.0 | 13 Abr 2026 | v140 | Correcciones UUID, checkout mejorado |
| v12.0 | 15 Abr 2026 | v155 | Media estrella, modales admin |
| v13.0 – v28.0 | Abr – Jul 2026 | v163 → v331 | Ver `BACKUP_INFO.md` de cada carpeta |
| `legacy/` | 01 Ago 2026 | — | Código muerto retirado de `js/` y `css/` |

---

## ✅ Funcionalidades Completadas

- [x] Login cliente con email/contraseña
- [x] Login con Google (GIS One Tap)
- [x] Modal "Crear Cuenta" con orden: Google → Apple → WhatsApp → Tel → Email
- [x] GPS automático + reverse geocoding (Nominatim)
- [x] Campo teléfono en modal de dirección
- [x] Guard de checkout (requiere dirección antes de confirmar pedido)
- [x] Admin: badge azul "Acceso vía Google/Apple" para clientes OAuth
- [x] Admin: GPS en vista perfil cliente (iframe embed)
- [x] Admin: GPS en modal edición cliente (solo lectura)
- [x] Admin: tabla clientes con badges de acceso correcto
- [x] 3-level fallback en createClientFromOAuth
- [x] Post-patch authProvider si cayó a Nivel B/C
- [x] Fix PWA: slider móvil en app instalada
- [x] Fix cache busting: `admin.html` alineado a `api.js?v=320` (2026-08-01)
- [x] Página `404.html` con marca propia (autónoma, sin CDN ni JS)
- [x] Capa 2 de caché (`VER`) sincronizada con número de compilación global
- [x] Fix: la tienda ahora refleja las ediciones de productos sin recargar (`app.js` v=338)
- [x] Maya consulta inventario, pedidos por cliente y estadísticas globales
      (`chat.js` v=229) — **verificado en producción 2026-08-02**
- [x] Repartidor obligatorio al pasar un pedido a *enviado* / *entregado*
      (`admin.v33.js` v=357) + KPIs de Repartidores contando correctamente
- [x] `drivers.vehicle` renombrada en Supabase (SQL ejecutado, datos intactos)
- [x] `driverId` rellenado a mano en los pedidos históricos #1–#10
- [x] Maya conoce a los repartidores y sus KPIs (`chat.js` v=232) — verificado en producción
- [x] Pedidos / gastado / último pedido del cliente calculados en vivo (`admin.v33.js` v=358)
- [x] Teléfonos siempre con guiones `809-696-1013` (`api.js` v=321 + `location.js` v=121)

## 🔴 Pendientes / Por Implementar

- [ ] Apple Sign In (marcado como "Pronto" en UI)
- [ ] Notificaciones push para pedidos
- [ ] Sistema de reseñas de productos
- [x] Mover la llamada a Groq a un proxy para no exponer la API key en el cliente
- [x] `test-scanner.html` migrado a `DB.getSettings()` / `DB.saveSettings()` (build 371)
- [x] Rate-limiting en `/api/chat` — ventana deslizante + 429 (build 371)
- [ ] **Rate-limiting de verdad con WAF de Cloudflare.** El actual usa memoria del
      isolate: para ráfagas sirve, pero los isolates se recician y hay varios por
      región → no es un techo global garantizado
- [x] **`order_number` es ahora una secuencia de Postgres** con índice UNIQUE
      (build 376) — se elimina la reutilización de números, la carrera entre pedidos
      simultáneos y el `Date.now() % 100000`. Requiere ejecutar
      `limpieza/8-secuencia-order-number.sql`
- [x] **`backup-tool.html` migrado a `DB.*`** (build 376) — era la novena ocurrencia del
      bug `tables/…`; generaba un backup vacío sin avisar. Ahora además se niega a
      descargar un archivo sin datos
- [x] **Respaldo consolidado en `admin > Respaldo` y `backup-tool.html` borrado**
      (build 378) — un único camino de código vía `DB.exportTable()`, sin límites fijos,
      sin datos transformados, con las filas `deleted` dentro. Eliminados también el
      Checklist que mentía y la doble descarga de ~38 MB para mostrar conteos
- [x] **Foreign keys con `ON DELETE SET NULL`** — ✅ **SALDADA** (2026-08-04,
      `limpieza/10-claves-ajenas.sql`, 8/8 comprobaciones OK). `orders."clientId"` y
      `orders."driverId"` convertidas de `TEXT` a `UUID` y con FK hacia `customers.id` /
      `drivers.id`. El borrado seguro de clientes ya **no depende solo de JavaScript**:
      protege también desde el SQL Editor. Ver la sección de deuda estructural 3, abajo

## 🧹 Deuda técnica (auditoría 2026-08-01)

- [x] Mover los ficheros huérfanos de `js/` y `css/` a `backup/legacy/` (~550 KB)
- [x] Crear `404.html` y corregir los comentarios de `_redirects` (decían "Render")
- [x] Consolidar `ESTADO_SESION.md` en este documento y eliminar el duplicado obsoleto
- [ ] `README.md` (19 KB, en el repo) sigue siendo un changelog histórico muy largo.
      Valorar dejarlo como changelog puro y que **este** documento sea el único "estado actual"
- [x] Sincronizar la constante `VER` de `index.html` y `admin.html` (ambas a `361`)
- [x] Retirar el chatbot Maya de la tienda (build 361) manteniéndolo en el admin
- [x] Desplegar el proxy `/api/chat` con `GROQ_API_KEY` en Cloudflare (`configurado:true`)
- [x] **Rotar la clave de Groq** y revocar la anterior (hecho 2026-08-02)
- [x] Limpiar la clave residual del `localStorage` de los navegadores del admin
- [x] **Purgado el CSS muerto de `.chat-*`** en `css/style.css` (build 371): 3.816 →
      3.328 líneas (−488). Se auditó antes de borrar; render verificado después.
      ⚠️ Los `.chat-*` de `css/admin.v33.css` **siguen en uso** y no se tocaron.
- [x] `test-scanner.html` → `DB.getSettings()` (build 371)
- [x] Rate-limiting en `/api/chat` (build 371) — ver arriba la nota sobre el WAF
- [x] **Recalculados `customers.orders` / `spent` / `lastOrder`** en Supabase
      (2026-08-03). Verificado: 5/5 con `estado='='`
- [~] Teléfonos normalizados **a medias**: función `casamota_fmt_phone()` creada y
      3 columnas verificadas. Faltan `customers.whatsapp`, `drivers.whatsapp`,
      `staff.phone`, `orders.phone` (tanda 5 sin ejecutar). Pierde urgencia tras la
      limpieza de datos de prueba
- [x] Los `.catch(() => {})` silenciosos → `logFail(contexto)` (18 sitios, build 371)

## 🔴 Deuda técnica abierta (build 372)

- [x] **Desplegados los builds 371 y 372** a GitHub → Cloudflare Pages, antes de la
      limpieza de datos
- [x] Limpieza de datos de prueba ejecutada — tandas 1 a 5 ✅ (2026-08-03)
- [ ] Tanda 7 (`DROP SCHEMA respaldo`) — **solo tras validar en producción**, sin prisa
- [x] **Descripciones IA en lote — PROBADAS Y FUNCIONALES** en producción (2026-08-03).
      Llevaban rotas desde la migración a Supabase (`fetch('tables/products')` → 404) sin
      que nadie lo reportara. El cambio a `DB.getProducts({full:true})` las revivió.
- [x] **Rate-limiting de Maya — PROBADO Y FUNCIONAL**: corta en el mensaje 16 y muestra
      el aviso de espera en español en vez de «Sin conexión a la IA».
- [ ] Verificar el **borrado seguro de cliente** con datos reales: crear ficha → hacer
      pedido → borrar la ficha → el pedido debe seguir en el historial
- [x] Primer pedido tras la limpieza sale **#1** — verificado en producción
- [x] **Borrado seguro de cliente — PROBADO Y FUNCIONAL** en producción: aviso en el
      modal, toast con el conteo, y los pedidos siguen en el historial
- [x] Desplegados los **builds 373 a 376** — confirmado por el usuario: «todo comprobado
      y funcional»
- [ ] **Desplegar el build 378** (ver la tabla de ficheros en la cabecera). El build 377
      quedó absorbido: su único fichero, `backup-tool.html`, ya no existe
- [ ] 🔴 **Prueba del build 379 en producción (la más importante):** abrir un pedido,
      marcarlo **«🏬 Retiro en tienda»** y guardar. Debe guardar **sin error**. Volver a
      abrirlo: la opción debe seguir seleccionada. Luego asignar un repartidor real y
      comprobar que sus contadores en **Repartidores** cuadran
- [ ] **Prueba del build 378 en producción:** entrar en `admin > Respaldo` y comprobar que
      (1) los conteos de las 9 tablas aparecen **rápido**, sin descargar las tablas;
      (2) la exportación completa da ~1.969 registros / ~20 MB sin ningún `❌`;
      (3) la **Migración de Imágenes** sigue generando el ZIP y **no** lanza error al
      terminar (ahí estaba la llamada huérfana al Checklist)
- [ ] **Prueba del build 375:** hacer login y observar el dashboard. Debe cargar y
      **quedarse quieto** — sin pestañeos repetidos tras terminar la carga
- [ ] Tras desplegar, verificar en producción:
      1. Un pedido nuevo se ve como **#1** (o el nº que toque) en «Mis pedidos» de la tienda
      2. Con el panel abierto en Pedidos y un pedido hecho desde el móvil, la fila
         **aparece sola en menos de 30 s** y **suena el aviso**
      3. **Prueba clave del cambio a vigilancia global:** dejar el panel en **Inventario**
         (no en Pedidos), hacer un pedido desde el móvil → debe sonar igual
      4. Dejar el panel en **otra pestaña** del navegador → debe sonar y parpadear el título
- [ ] `README.md` (24 KB) sigue siendo un changelog histórico larguísimo

### Deudas del build 374 (asumidas, no bugs)

- **Con el panel cerrado no hay aviso.** Requiere push (ver arriba). Es la deuda grande.
- **30 s de retraso máximo.** Si se quisiera instantáneo, Supabase Realtime; el único punto
  a cambiar sería `_pvSondear()`.
- **En pestaña oculta el navegador ralentiza los `setInterval`** (hasta ~1/min). Mitigado
  sondeando al instante en `visibilitychange`, pero el aviso puede llegar más tarde de 30 s
  si el panel lleva mucho rato en segundo plano.
- No hay **contador visible** de pedidos pendientes en el sidebar: `updatePendingBadge()`
  sigue siendo un stub vacío. El aviso es sonoro + toast + título.
