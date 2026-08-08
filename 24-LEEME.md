# 24 · Worker de subida asegurado

Build 386 · Worker desplegado: `178a7c5a`

## Qué estaba mal

El Worker `r2-proxy-casamota` aceptaba `PUT` de cualquiera, sin identificación.
Comprobado desde fuera del panel: una petición suelta a `/put/test.txt` respondía
`{"ok":true}`. Con eso, un tercero podía:

- sobrescribir fotos de productos (basta acertar la clave)
- alojar ficheros arbitrarios bajo `img.supermercadocasamota.com`
- llenar el bucket a costa del dueño

No era un fallo introducido en esta sesión: el Worker era así desde junio.

## Una corrección importante a lo que se dijo antes

Durante varios mensajes se repitió que el arreglo consistía en «quitar `DELETE` y
restringir `Access-Control-Allow-Origin`». **Eso era un mal consejo.**

- **CORS no es un mecanismo de seguridad.** Solo limita lo que un *navegador*
  permite hacer a una página de otro dominio. `curl`, un script o Postman
  **ignoran las cabeceras CORS por completo**. La misma petición que demostró el
  agujero habría seguido funcionando igual.
- **`DELETE` nunca estuvo abierto.** El Worker ya rechazaba todo lo que no fuera
  `PUT`. Solo lo *anunciaba* en una cabecera. Quitarlo es cosmético.

El problema real era la ausencia de cualquier comprobación de identidad. Eso es
lo que se ha corregido.

## Controles añadidos

| Control | Respuesta | Qué evita |
|---|---|---|
| Token `x-upload-token` | 401 | subidas anónimas — el agujero de verdad |
| Clave debe empezar por `productos/` y no contener `..` | 403 | alojar ficheros arbitrarios en el dominio propio |
| `Content-Type` debe ser `image/*` | 415 | subir HTML, scripts o ejecutables |
| Cuerpo vacío | 400 | URLs guardadas que no muestran nada |
| Más de 6 MB | 413 | que un abuso o un fallo llene el bucket |

Los cuatro últimos los aplica el propio Worker y no dependen de que el panel se
comporte bien.

## Los dos dominios

La tienda responde tanto en `supermercadocasamota.com` como en
`www.supermercadocasamota.com`, y las dos son legítimas.

`Access-Control-Allow-Origin` **admite un solo valor, nunca una lista**. Por eso
`elegirOrigen()` mira el `Origin` de la petición y, si está en `ORIGENES`,
devuelve ese mismo. Se añadió `Vary: Origin` porque la respuesta ahora depende
del dominio que pregunta: sin esa cabecera, una caché intermedia podría servirle
a un dominio la cabecera calculada para el otro.

## Sobre el token: qué protege y qué no

El token vive en dos sitios:

- **Cloudflare**, como *Secret* `UPLOAD_TOKEN` (ya no se puede volver a leer;
  para cambiarlo se sobrescribe)
- **`js/admin.v33.js`**, en la constante `_R2_TOKEN`

**No es un secreto.** Ese fichero lo descarga el navegador, así que cualquiera
que abra el código fuente puede leerlo. Igual que la `x-admin-key`, que ya viajaba
así.

Lo que aporta: sube el listón de «cualquiera que conozca la URL» a «alguien que
se moleste en leer el JavaScript del panel», y **permite rotarlo** si algún día
aparece tráfico raro.

La protección real exigiría que un servidor emitiera el token tras comprobar la
sesión, y **un sitio estático no puede hacerlo**. Queda escrito para no confundir
esto con una solución completa.

### Cómo rotar el token

1. Cloudflare → Worker → Settings → Variables → editar `UPLOAD_TOKEN`
2. Redesplegar el Worker (la variable no entra en vigor hasta el despliegue)
3. Cambiar `_R2_TOKEN` en `js/admin.v33.js`, subir a GitHub y esperar Pages

El orden importa: entre los pasos 2 y 3 el panel recibe 401 y cae en base64.

## Efecto colateral esperado

Las herramientas de `migration/` que escriben en R2 **han dejado de funcionar**.
`pasar-277-a-r2.html` prueba el Worker escribiendo en `test/ping.txt`, y ahora eso
se rechaza (401 por falta de token, y 403 por estar fuera de `productos/`).
Es la protección haciendo su trabajo. Esas herramientas ya cumplieron su función.

`verificar-imagenes.html` **sigue funcionando**: solo lee del CDN y de Supabase,
nunca usa el Worker. Conviene conservarla.

## Comprobación después de subir los ficheros

1. Panel con recarga forzada (`Ctrl+Shift+R`) → debe indicar build **386**
2. Editar un producto y subir una foto
3. Debe guardarse como `https://img.supermercadocasamota.com/productos/…`

Si aparece con el aviso `⚠️` de base64, el token no coincide entre Cloudflare y
`admin.v33.js`. Se añadió un mensaje específico para el 401 precisamente para
distinguir ese caso de un fallo de red.
