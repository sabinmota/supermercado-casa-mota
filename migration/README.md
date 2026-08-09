# Carpeta `migration/`

Contenido actual: **3 ficheros**. El 2026-08-08 se borraron 29.

## Qué queda y para qué sirve

| Fichero | Uso |
|---|---|
| `verificar-imagenes.html` + `.js` | Diagnóstico: comprueba que las imágenes del catálogo cargan de verdad desde R2. **Son pareja**, el `.js` no funciona solo. |
| `setup-worker.html` | Referencia del código del Worker de R2. El Paso 4 (migración) ya no existe: se completó. |

## Qué se borró y por qué

**Migración a R2 (11 ficheros)** — `r2-migrate-now`, `r2-migrate-v2`, `r2-migrate-worker`,
`migrar-imagenes-r2`, `copiar-imagenes-base64`, `asignar-imagenes`, `generar-sql-imagenes`,
`pasar-277-a-r2` (`.html` + `.js`), `test-r2-credentials`, `test-cdn-images`, `debug-imagenes`.

Eran siete intentos sucesivos del mismo trabajo. La migración terminó y está confirmada:
una medición del peso de la columna `images` dio unos **87 bytes por imagen** entre 1922
productos, imposible con base64 → todo son URLs de R2.

**Importación inicial (13 ficheros)** — los `.csv` y los `insert_*.sql` de junio de 2026.
Volcado de arranque ya ejecutado; los datos vivos están en Supabase y esos ficheros llevaban
dos meses desfasados. Ocupaban ~2 MB.

**Parches SQL (3 ficheros)** — `fix_image_paths.sql`, `saopaulo_columnas_faltantes.sql`,
`saopaulo_add_rating_reviews.sql`. Aplicados hace tiempo; el esquema vigente está en
`supabase_new_project.sql` y `supabase_alter.sql`.

**Datos temporales (1)** — `github_images_raw.json`, 1 MB de volcado intermedio.

Se comprobó antes de borrar que **ningún fichero de la web los referenciaba**.

---

## 🔴 Incidente de seguridad detectado durante esta limpieza

Dos ficheros llevaban un **token de API de Cloudflare escrito en el código**, en un
repositorio **público**:

- `test-r2-credentials.html` línea 11 — `const CF_TOK = 'cfat_...'`
- `r2-migrate-now.html` línea 104 — el mismo token en un `<input type="password">`

El token era **`blue-tooth-34b7`**, permiso **Workers R2 Storage Write**, activo desde hacía
60 días. Con él se podían **sobrescribir o borrar las imágenes de los 1922 productos**.

`Last used` estaba vacío: nadie llegó a usarlo.

**Resuelto:** el usuario revocó el token en Cloudflare el 2026-08-08, antes de borrar los
ficheros. Ese es el orden correcto — **borrar un fichero de GitHub no lo quita del
historial**, así que el token habría seguido siendo recuperable. Lo único que corta el riesgo
de verdad es revocarlo.

Un `<input type="password">` **no oculta nada**: el valor está en el código fuente en claro.

### Regla para el futuro

Ninguna credencial de escritura va en un fichero del repositorio, ni siquiera en una
herramienta de un solo uso. Se piden por pantalla y se guardan en `localStorage`, o viven en
las variables de entorno del Worker.

Excepciones conocidas y aceptadas, que **no** son secretos:

- **clave `anon` de Supabase** — pública por diseño, ya está en `js/api.js`
- **`x-admin-key`** — está en `js/api.js:34`, que sirve la web a todo el mundo. No es un
  secreto y nunca lo fue; conviene tenerlo presente, pero no es un fallo de esta carpeta.
