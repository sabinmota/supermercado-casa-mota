# 🗄️ Código legacy — NO EDITAR

Ficheros retirados de `js/` y `css/` el **2026-08-01** tras una auditoría de dependencias.

## ¿Por qué están aquí?

Ningún HTML activo (`index.html`, `admin.html`, `login-cliente.html` ni el resto de
páginas de la raíz) los carga. Se comprobó por búsqueda de texto que sólo aparecían
referenciados desde las carpetas `backup/vN.0/`, y **cada una de esas carpetas tiene su
propia copia local de `js/` y `css/`**, por lo que moverlos no rompe las versiones
archivadas.

Se movieron —en lugar de borrarse— para conservar el historial consultable.

## Contenido

| Fichero | Sustituido por |
|---|---|
| `js/admin.js` · `js/admin.v32.js` | `js/admin.v33.js` |
| `js/extras.js` · `js/extras.v32.js` | `js/extras.v33.js` |
| `js/auth.v32.js` | `js/auth.js` (tienda) · `js/auth.v33.js` (admin) |
| `js/darkmode.js` | Sin sustituto — funcionalidad retirada de `index.html` |
| `css/admin.css` · `css/admin.v32.css` | `css/admin.v33.css` |

## ⚠️ Aviso

Los nombres son casi idénticos a los de los ficheros activos (`admin.js` vs
`admin.v33.js`). **Editar algo aquí no tiene ningún efecto en producción.**
Si buscas la lógica del panel admin, está en `js/admin.v33.js` (raíz del proyecto).

Consulta `casamota-estado.md` para la tabla de ficheros y versiones vigentes.
