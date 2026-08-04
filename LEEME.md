# Limpieza de datos de prueba — build 372

Los 5 clientes y 10 pedidos de la base de datos son datos de prueba.
Estos scripts los borran **sin tocar el catálogo**.

## Cómo se usa

Un fichero = una ejecución. Abre el fichero, **Ctrl+A** para seleccionar todo,
copia, pega en **Supabase → SQL Editor** y pulsa **RUN**.

No hay que buscar líneas ni cortar trozos. Ve en orden.

| Orden | Fichero | ¿Borra? | Qué hace |
|---|---|---|---|
| 1️⃣ | `1-preview.sql` | No | Te muestra qué se borraría y qué se conserva |
| 2️⃣ | `2-snapshot.sql` | No | Copia de seguridad al esquema `respaldo` |
| 3️⃣ | `3-verificar-snapshot.sql` | No | Comprueba que la copia salió bien |
| 4️⃣ | `4-BORRAR.sql` | **SÍ ⚠️** | El borrado |
| 5️⃣ | `5-verificar-final.sql` | No | Confirma que todo quedó como debía |
| 6️⃣ | `6-DESHACER-solo-si-algo-fallo.sql` | Sí | Marcha atrás (solo si hace falta) |
| 7️⃣ | `7-borrar-respaldo.sql` | Sí | Borra la copia de seguridad (sin prisa) |
| 8️⃣ | `8-secuencia-order-number.sql` | No | **Numeración de pedidos a prueba de duplicados** (build 376) |
| 9️⃣ | `9-diagnostico-claves-ajenas.sql` | No | **Solo lectura.** Diagnóstico previo a las claves ajenas (build 378) |
| 🔟 | `10-claves-ajenas.sql` | No | **Integridad referencial real** en `orders` (build 378). Después del 9️⃣ |
| 🔟✅ | `10-verificar.sql` | No | Los 8 checks del 10. **Fichero aparte** |
| 1️⃣1️⃣ | `11-borrar-columnas-muertas.sql` | **SÍ ⚠️** | Borra `products."categoryId"` y `notificaciones.customer_id` (vacías). Después del 🔟 |
| 1️⃣1️⃣✅ | `11-verificar.sql` | No | Los 4 checks del 11. **Fichero aparte** |
| 1️⃣2️⃣ | `12-producto-sin-categoria.sql` | No | **Solo lectura.** Localiza el producto sin categoría detectado por el check 4 |

## 🚨 CÓMO SE EJECUTAN: EL FICHERO ENTERO, DE UNA VEZ

**No ejecutes estos scripts paso a paso ni por trozos.** Cada fichero es una
sola transacción (`BEGIN` … `COMMIT`) y sus pasos dependen unos de otros.

El procedimiento correcto, para cualquiera de ellos:

1. Abre el fichero y selecciónalo **todo** (`Ctrl+A` / `Cmd+A`)
2. Cópialo
3. Pégalo en el SQL Editor de Supabase
4. `Ctrl+A` otra vez **dentro del editor**, para asegurarte de que se ejecuta todo
5. Run

**Por qué importa, con un ejemplo real:** en el script 10, el `PASO 2`
(`ALTER COLUMN ... TYPE`) **falla** si no se ejecutó antes el `PASO 0` que
retira la vista. Y ejecutar solo un trozo deja el `BEGIN;` abierto sin su
`COMMIT;`, o hace que cada trozo vaya por su cuenta sin la protección de
«todo o nada».

Los checks de verificación van en **fichero aparte** (`10-verificar.sql`,
`11-verificar.sql`) justo para que nunca tengas que seleccionar «solo una
parte» de un fichero largo.

### Si te sale `syntax error at or near "PASO"`

Significa que una línea de comentario perdió sus `--` al copiar. Era un
problema de las cabeceras decorativas de la primera versión de estos scripts;
los ficheros 10 y 11 se reescribieron **sin ningún carácter decorativo** para
que no pueda volver a pasar. Si te ocurre, vuelve a copiar el fichero entero.

## Reglas que no conviene saltarse

1. **No te salte la tanda 2.** Es tu única marcha atrás. Los backups automáticos
   de Supabase (plan gratuito) solo restauran el proyecto **entero** a la
   medianoche, así que perderías también el trabajo del día.

2. **Si la tanda 3 da ❌, para.** Significa que el respaldo está incompleto.

3. **Despliega el código ANTES de ejecutar la tanda 4.** El arreglo del borrado
   de clientes va en el build 372; si limpias la base con el código viejo en
   producción, el bug que deja pedidos huérfanos sigue vivo.

4. **La tanda 7 puede esperar.** Deja el respaldo ahí hasta que hayas hecho un
   pedido de prueba real y todo funcione.

## La numeración de pedidos — RESUELTO en el build 376

**Antes** (builds ≤375): `order_number` era una columna `INTEGER` normal y el
número se calculaba en JavaScript como `max(order_number) + 1`. Eso arrastraba
tres fallos reales:

1. **Reutilizaba números** al borrar el pedido con el número más alto.
2. **Dos clientes simultáneos** podían recibir el mismo número (ambos leían el
   mismo máximo antes de que el otro guardara).
3. Si fallaba la consulta, `js/app.js:2934` asignaba `Date.now() % 100000` — un
   número aleatorio de 5 cifras que además envenenaba la numeración siguiente.

**Ahora:** ejecuta `8-secuencia-order-number.sql`. Crea una secuencia de
Postgres, la pone como `DEFAULT` de la columna y añade un **índice UNIQUE** que
hace imposible repetir un número aunque un bug futuro lo intente. El navegador ya
no calcula nada: la base de datos asigna el número de forma atómica.

Con la tabla vacía la secuencia arranca en **1**, así que tu próximo pedido será
el **#1**.

> ⚠️ **Orden importante:** ejecuta este SQL **antes** de subir el código del
> build 376 a GitHub. El código nuevo espera que la base de datos ponga el
> número; si la secuencia aún no existe, hay una red de seguridad que lo asigna
> con el método antiguo y avisa en la consola, pero es mejor no depender de ella.

## Qué se borra y qué no

| 🗑️ Se borra | ✅ Se conserva |
|---|---|
| `customers` | `products` — tu catálogo |
| `orders` | `categories` |
| `notificaciones` | `drivers` — repartidores |
| `cupones.usedBy` (solo el histórico) | `staff` — personal y PINs |
| | `settings` — configuración |
| | `cupones` — los cupones en sí |

## 🛑 No uses `supabase_truncate.sql`

Ese fichero (en la raíz del proyecto) hace `TRUNCATE` de **las 9 tablas**,
incluidas `products`, `categories`, `drivers`, `staff` y `settings`.
Te dejaría la tienda vacía y tendrías que reconstruir el catálogo a mano.

## Nota

El fichero `supabase_limpiar_datos_prueba.sql` de la raíz contiene lo mismo
todo junto. Se mantiene como referencia, pero **usa estos ficheros numerados** —
el editor de Supabase no muestra números de línea, así que partirlo a mano
es innecesariamente incómodo.

El fichero `8-secuencia-order-number.sql` es independiente de la limpieza: se
puede ejecutar en cualquier momento, con la tabla vacía o llena.

## 9️⃣ Claves ajenas: por qué hay diagnóstico antes de migración

La base de datos **no tiene ninguna clave ajena (FOREIGN KEY)**. Comprobado:

```
grep -E "FOREIGN KEY|REFERENCES" *.sql   →  0 resultados
```

Consecuencia real: nada a nivel de base de datos impide que un pedido apunte a
un cliente que ya no existe. Hoy eso lo evita el JavaScript del panel
(`_desvincularPedidosDeCliente`, `js/api.js:401`), pero **solo si el borrado se
hace desde el panel**. Un `DELETE` escrito a mano en el SQL Editor deja pedidos
huérfanos y nadie se enteraría.

El arreglo definitivo es `FOREIGN KEY ... ON DELETE SET NULL`. El obstáculo es
que **los tipos no coinciden**:

| Columna hija | Tipo actual | Columna padre | Tipo |
|---|---|---|---|
| `orders."clientId"` | TEXT | `customers.id` | UUID |
| `orders."driverId"` | TEXT | `drivers.id` | UUID |
| `products."categoryId"` | TEXT | `categories.id` | UUID |
| `notificaciones.customer_id` | TEXT | `customers.id` | UUID |

PostgreSQL exige tipos compatibles en una clave ajena, así que primero hay que
convertir esas columnas a `UUID`. Y esa conversión **aborta entera si una sola
fila contiene un valor que no sea un UUID válido** — algo perfectamente posible
en una base migrada de un esquema anterior.

Por eso el paso 9 es **solo lectura**: mide cuántos valores están vacíos, con
formato inválido o ya huérfanos. El script 10 (la migración real) **se escribe
después de leer ese resultado**, no antes. Escribirlo antes sería adivinar, y
adivinar sobre `ALTER COLUMN ... TYPE` en producción es exactamente cómo se
pierden datos.

### Resultado del diagnóstico (ejecutado el 2026-08-04)

**Escenario 1, «limpio».** Cero claves ajenas existentes, cero valores con
formato inválido, cero huérfanos, cero cadenas vacías:

| Relación | total | con_valor | inválidos | huérfanos |
|---|---|---|---|---|
| `orders.clientId → customers.id` | 2 | 2 | **0** | **0** |
| `orders.driverId → drivers.id` | 2 | 1 | **0** | **0** |
| `products.categoryId → categories.id` | 1913 | **0** | 0 | 0 |
| `notificaciones.customer_id → customers.id` | 1 | **0** | 0 | 0 |

Camino corto disponible: conversión + claves ajenas en una sola transacción.

### Hallazgo: dos de las cuatro columnas están muertas

`products."categoryId"` tiene **0 valores en 1.913 productos** y
`notificaciones.customer_id` tiene **0 valores**. Están vacías porque **el
código nunca las usa**:

```
grep "categoryId"  js/api.js js/admin.v33.js  →  0 usos reales
grep "customer_id" js/*.js                    →  0 resultados
```

El vínculo real producto→categoría es otro: **`products.category`**, que guarda
el *slug* en texto (`lacteos`, `bebidas`…) y se compara contra
`categories.slug` (`js/admin.v33.js:912-920`; `_SELECT_FIELDS` en
`js/api.js:89` pide `category`, nunca `categoryId`).

Por eso el script 10 **no toca esas dos columnas**: ponerles una clave ajena
sería decorar columnas que nadie lee, y daría la falsa impresión de que la
relación producto→categoría está protegida cuando no lo estaría. Se borran en
el script 11.

### Lo que sigue sin proteger: producto → categoría

Es la única relación que estos scripts dejan fuera, y queda escrito a
propósito. El vínculo real es `products.category` (slug en texto) →
`categories.slug`. Ponerle una clave ajena exigiría dos cosas que no son
gratis:

1. `categories.slug` necesitaría un `UNIQUE`. Si hubiera dos categorías con el
   mismo slug entre las 35 actuales, el `UNIQUE` sería rechazado.
2. `ON DELETE SET NULL` ahí significaría que borrar **una** categoría deja a
   todos sus productos con `category = NULL`, y un producto sin categoría
   **desaparece del catálogo y del gráfico** (`js/admin.v33.js:919` lo descarta
   explícitamente). Sobre 1.913 productos eso es un efecto masivo y muy visible
   en la tienda.

Es una decisión de negocio, no técnica, y necesita su propio diagnóstico (¿hay
slugs duplicados? ¿hay productos con un slug que ya no existe?). Sería el
script 12, si se decide hacerlo.

### ✅ EJECUTADO Y VERIFICADO — 2026-08-04

Scripts 10 y 11 ejecutados en producción. **12 de 12 checks en verde.**

**`10-verificar.sql` — 8/8 OK:**

| Check | Resultado | Detalle |
|---|---|---|
| 1 · `clientId` ahora es UUID | OK | `uuid` |
| 2 · `driverId` ahora es UUID | OK | `uuid` |
| 3 · clave ajena `clientId → customers` | OK | `n (n = SET NULL)` |
| 4 · clave ajena `driverId → drivers` | OK | `n (n = SET NULL)` |
| 5 · ambas borran con SET NULL | OK | 2 de 2 con `confdeltype = n` |
| 6 · índices en las columnas hijas | OK | 2 de 2 |
| 7 · vista `v_pedidos_por_cliente` recreada | OK | 1 de 1 |
| 8 · la vista sigue devolviendo datos | OK | **2 cruces pedido↔cliente** |

El check 8 es el que confirma que el PASO 0 + PASO 5 funcionaron: la vista se
retiró, se cambió el tipo y se reconstruyó **sin perder ni un cruce**.

**`11-verificar.sql` — 4/4 OK:**

| Check | Resultado | Detalle |
|---|---|---|
| 1 · `products.categoryId` ya no existe | OK | 0 columnas |
| 2 · `notificaciones.customer_id` ya no existe | OK | 0 columnas |
| 3 · `products.category` (vínculo real) intacto | OK | `text` |
| 4 · productos con categoría asignada | OK | **1912 de 1913** |

### ⚠️ Hallazgo del check 4: un producto sin categoría

**1912 de 1913.** Falta uno. **No lo causaron los scripts 10 u 11** — ninguno
toca `products.category`; el 11 borró `categoryId`, que es otra columna y
estaba vacía. Ese producto ya estaba así antes, y el check lo destapó.

Importa porque un producto sin categoría es **invisible en la tienda**:

- `js/app.js:661` — filtra por categoría → no aparece al navegar
- `js/app.js:1013` — construye la lista de categorías → no entra en ninguna
- `js/admin.v33.js:919` — lo descarta del gráfico del panel

Existe y ocupa stock, pero un cliente solo llegaría a él buscando por nombre.

`12-producto-sin-categoria.sql` lo localiza (solo lectura) y además busca el
otro sabor del mismo problema: productos cuyo slug apunta a una categoría que
ya no existe.

### Qué arregla el script 10

Las dos relaciones que **sí se usan de verdad**: `orders."clientId"` y
`orders."driverId"`. Tras ejecutarlo, borrar un cliente o un repartidor
**desde cualquier sitio** (incluido un `DELETE` a mano en el SQL Editor)
conserva el pedido y pone su referencia a `NULL`, en vez de dejarlo apuntando
a un id inexistente.

`ON DELETE SET NULL`, nunca `CASCADE`: `CASCADE` borraría el pedido, y eso
sería destruir historial de ventas — el pedido ocurrió y se cobró de verdad.

**No hace falta desplegar nada.** El JavaScript sigue funcionando sin cambios
(comprobado consulta por consulta en la NOTA 1 del script).

### ⚠️ Corrección aplicada al script 10 antes de ejecutarlo

La primera versión del script 10 **habría fallado**. La vista
`v_pedidos_por_cliente` (definida en `supabase_recalc_clientes_y_telefonos.sql:72`)
**lee** `orders."clientId"`, y PostgreSQL se niega a cambiar el tipo de una
columna de la que depende una vista:

```
ERROR: cannot alter type of a column used by a view or rule
DETAIL: rule _RETURN on view v_pedidos_por_cliente depends on column "clientId"
```

El script corregido añade un **PASO 0** que elimina la vista y un **PASO 5** que
la reconstruye idéntica, todo dentro de la misma transacción (una vista no
guarda datos, es una consulta con nombre: recrearla no pierde nada). La única
diferencia en la vista nueva: `ped.client_id = cli.id::text` pasa a ser
`ped.client_id = cli.id`, porque ya son UUID contra UUID.

Se detectó al buscar `customer_id` en **todo** el proyecto en lugar de solo en
`js/`. Los checks del script 10 son ahora **8**, incluyendo que la vista se
recreó y que sigue devolviendo filas.

## 1️⃣1️⃣ Borrar las dos columnas muertas

Decisión tomada: **borrarlas**. Se puede sin perder nada porque están vacías
(medido, no supuesto) y ningún `.js`, `.html` ni `functions/` las menciona.

**Falso positivo descartado:** `customer_id` aparece en cuatro `.sql` más
(`supabase_recalc_clientes_y_telefonos.sql:91`, `supabase_recalc_conservador.sql:41`,
`supabase_diagnostico_huerfanos.sql:71`, `supabase_diagnostico_lizbeth.sql:118`),
pero todos se refieren al **alias** `cli.id AS customer_id` de la vista
`v_pedidos_por_cliente`, que solo lee de `orders` y `customers`. La tabla
`notificaciones` no aparece en esa vista. Nada depende de la columna que se
borra.

El script incluye un **PASO 1 que recuenta los valores en el momento de
ejecutarse** y aborta la transacción con un error claro si encuentra un solo
dato. Entre el diagnóstico y el borrado pudo entrar información nueva; antes
que fiarse de una medición previa, la repite.

**No se usa `CASCADE` a propósito**: si existiera una dependencia no detectada,
preferimos un error que la nombre antes que un borrado silencioso en cascada.
