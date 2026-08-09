-- ═══════════════════════════════════════════════════════════════════════════════
--  SUPERMERCADO CASA MOTA · LIMPIEZA QUIRÚRGICA DE DATOS DE PRUEBA
--  Build 372 · Opción B
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  QUÉ HACE
--  ────────
--  Vacía SOLO las tablas de clientes y pedidos (y sus rastros: notificaciones
--  y el histórico `usedBy` de los cupones). Deja intacto todo lo demás.
--
--     SE BORRA                      SE CONSERVA
--     ─────────────────────         ─────────────────────
--     customers   (5 filas)         products     ← tu catálogo
--     orders      (10 filas)        categories
--     notificaciones (si existen)   drivers      ← repartidores
--     cupones.usedBy → []           staff        ← personal y PINs
--                                   settings     ← configuración de la tienda
--                                   cupones      ← los cupones en sí
--
--  ⚠️  NO USES `supabase_truncate.sql` PARA ESTO.
--      Ese fichero hace TRUNCATE de las 9 tablas, incluidas products,
--      categories, drivers, staff y settings. Te dejaría la tienda vacía
--      y tendrías que reconstruir el catálogo entero a mano.
--
--  ═══ ⚠️ HISTÓRICO — YA EJECUTADO EL 2026-08-03 ══════════════════════════════
--
--  La limpieza de datos de prueba SE HIZO el 2026-08-03, usando la carpeta
--  `limpieza/`, que estaba partida en 7 tandas (preview, snapshot, verificar,
--  BORRAR, verificar final, deshacer, borrar respaldo). Esa carpeta se vació
--  el 2026-08-09 una vez todos sus scripts quedaron gastados.
--
--  Este fichero se conserva SOLO como referencia de lo que se borró.
--  No hay que volver a ejecutarlo.
--
--  ═══ CÓMO EJECUTARLO (si insistes en usar este fichero) ═════════════════════
--
--  Supabase → SQL Editor. Copia y pega UNA TANDA A LA VEZ, en este orden.
--  El editor solo muestra el resultado del ÚLTIMO SELECT de cada ejecución:
--  por eso van separadas.
--
--   ┌───────┬──────────┬──────────────────────────────────────┬─────────┐
--   │ Tanda │  Líneas  │ Qué hace                             │ Escribe │
--   ├───────┼──────────┼──────────────────────────────────────┼─────────┤
--   │  1    │  57–93   │ PREVIEW: qué se borraría exactamente │   No    │
--   │  2    │ 104–145  │ SNAPSHOT en el schema `respaldo`     │   Sí *  │
--   │  3    │ 155–168  │ Verificar que el snapshot copió bien │   No    │
--   │  4    │ 179–204  │ EL BORRADO                           │  SÍ ⚠️  │
--   │  5    │ 215–249  │ Verificación final                   │   No    │
--   │  6    │ 260–279  │ DESHACER (comentado, por si acaso)   │   Sí    │
--   │  7    │ 287–288  │ Borrar el respaldo cuando estés OK   │   Sí    │
--   └───────┴──────────┴──────────────────────────────────────┴─────────┘
--
--   * La tanda 2 escribe, pero solo CREA copias nuevas. No toca `public`.
--
--  NO SALTES LA TANDA 2. Es tu única marcha atrás: los backups automáticos
--  de Supabase (plan gratuito) solo permiten restaurar el proyecto ENTERO
--  a la medianoche, lo que te haría perder también el trabajo del día.
--
-- ═══════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 1 · PREVIEW (líneas 57–93) — no escribe nada                      ║
-- ║  Empieza en:  WITH conteos AS (                                          ║
-- ║  Termina en:  ORDER BY orden, detalle;                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
WITH conteos AS (
  SELECT 1 AS orden, '🗑️  SE BORRA · customers'        AS tabla,
         count(*)::text AS cantidad,
         coalesce(string_agg(name, ' | ' ORDER BY name), '(ninguno)') AS detalle
  FROM public.customers
  UNION ALL
  SELECT 2, '🗑️  SE BORRA · orders',
         count(*)::text,
         coalesce('total RD$' || to_char(sum(total), 'FM999G999G990D00'), '(ninguno)')
  FROM public.orders
  UNION ALL
  SELECT 3, '✅ SE CONSERVA · products',   count(*)::text, '(catálogo intacto)'   FROM public.products
  UNION ALL
  SELECT 4, '✅ SE CONSERVA · categories', count(*)::text, '(intacto)'            FROM public.categories
  UNION ALL
  SELECT 5, '✅ SE CONSERVA · drivers',    count(*)::text, '(intacto)'            FROM public.drivers
  UNION ALL
  SELECT 6, '✅ SE CONSERVA · staff',      count(*)::text, '(intacto)'            FROM public.staff
  UNION ALL
  SELECT 7, '✅ SE CONSERVA · settings',   count(*)::text, '(intacto)'            FROM public.settings
),
detalle_pedidos AS (
  SELECT 8 AS orden,
         '   ↳ pedido #' || coalesce(o.order_number::text, '?') AS tabla,
         coalesce(o.status, '?')                                AS cantidad,
         coalesce(o.customer, o.client, '(sin nombre)')
           || ' · RD$' || to_char(coalesce(o.total,0), 'FM999G999G990D00')
           || CASE WHEN o."clientId" IS NULL THEN ' · sin clientId'
                   WHEN NOT EXISTS (SELECT 1 FROM public.customers c
                                    WHERE c.id = o."clientId")
                        THEN ' · ❌ HUÉRFANO'
                   ELSE ' · vinculado' END                      AS detalle
  FROM public.orders o
)
SELECT tabla AS elemento, cantidad, detalle
FROM (SELECT * FROM conteos UNION ALL SELECT * FROM detalle_pedidos) t
ORDER BY orden, detalle;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 2 · SNAPSHOT (líneas 104–145) — crea copias, no toca `public`    ║
-- ║  Empieza en:  CREATE SCHEMA IF NOT EXISTS respaldo;                      ║
-- ║  Termina en:  SELECT 'snapshot creado' AS resultado;                     ║
-- ║                                                                          ║
-- ║  Si Supabase muestra "Potential issues detected" pulsa                   ║
-- ║  «Run and enable RLS» — el script ya activa RLS de todos modos.          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
CREATE SCHEMA IF NOT EXISTS respaldo;

DROP TABLE IF EXISTS respaldo.customers_pre_limpieza;
DROP TABLE IF EXISTS respaldo.orders_pre_limpieza;
DROP TABLE IF EXISTS respaldo.cupones_pre_limpieza;

CREATE TABLE respaldo.customers_pre_limpieza AS
  SELECT * FROM public.customers;

CREATE TABLE respaldo.orders_pre_limpieza AS
  SELECT * FROM public.orders;

-- `cupones` y `notificaciones` pueden no existir en tu proyecto.
-- Se copian solo si están, para que la tanda no falle entera por eso.
DO $$
BEGIN
  IF to_regclass('public.cupones') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE respaldo.cupones_pre_limpieza AS
             SELECT * FROM public.cupones';
  END IF;
  IF to_regclass('public.notificaciones') IS NOT NULL THEN
    DROP TABLE IF EXISTS respaldo.notificaciones_pre_limpieza;
    EXECUTE 'CREATE TABLE respaldo.notificaciones_pre_limpieza AS
             SELECT * FROM public.notificaciones';
  END IF;
END $$;

-- RLS en las copias: sin políticas, nadie puede leerlas vía la API pública.
-- El SQL Editor sí las ve porque usa el rol de servicio.
ALTER TABLE respaldo.customers_pre_limpieza ENABLE ROW LEVEL SECURITY;
ALTER TABLE respaldo.orders_pre_limpieza    ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regclass('respaldo.cupones_pre_limpieza') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE respaldo.cupones_pre_limpieza ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('respaldo.notificaciones_pre_limpieza') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE respaldo.notificaciones_pre_limpieza ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

SELECT 'snapshot creado' AS resultado;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 3 · VERIFICAR EL SNAPSHOT (líneas 155–168) — no escribe          ║
-- ║  Empieza en:  SELECT 'customers' AS tabla,                               ║
-- ║  Termina en:  ORDER BY tabla;                                            ║
-- ║                                                                          ║
-- ║  Las DOS filas deben decir ✅. Si alguna dice ❌, PARA y avísame.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
SELECT 'customers' AS tabla,
       (SELECT count(*) FROM public.customers)                  AS en_produccion,
       (SELECT count(*) FROM respaldo.customers_pre_limpieza)   AS en_respaldo,
       CASE WHEN (SELECT count(*) FROM public.customers)
               = (SELECT count(*) FROM respaldo.customers_pre_limpieza)
            THEN '✅ copia correcta' ELSE '❌ NO COINCIDE — PARA' END AS estado
UNION ALL
SELECT 'orders',
       (SELECT count(*) FROM public.orders),
       (SELECT count(*) FROM respaldo.orders_pre_limpieza),
       CASE WHEN (SELECT count(*) FROM public.orders)
               = (SELECT count(*) FROM respaldo.orders_pre_limpieza)
            THEN '✅ copia correcta' ELSE '❌ NO COINCIDE — PARA' END
ORDER BY tabla;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 4 · EL BORRADO (líneas 179–204) ⚠️ ESTO SÍ BORRA                  ║
-- ║  Empieza en:  BEGIN;                                                     ║
-- ║  Termina en:  COMMIT;                                                    ║
-- ║                                                                          ║
-- ║  Va dentro de una transacción: si cualquier línea falla, NADA se borra.  ║
-- ║  No ejecutes esto hasta que la tanda 3 haya dado ✅ en las tres filas.   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
BEGIN;

-- Orden: primero lo que depende de pedidos/clientes, luego ellos.
DO $$
BEGIN
  IF to_regclass('public.notificaciones') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.notificaciones';
  END IF;
END $$;

-- Los cupones se conservan, pero su histórico de uso apuntaba a clientes
-- que van a desaparecer. Se vacía para que no queden referencias muertas.
DO $$
BEGIN
  IF to_regclass('public.cupones') IS NOT NULL THEN
    EXECUTE 'UPDATE public.cupones
                SET "usedBy" = ''[]''::jsonb
              WHERE "usedBy" IS NOT NULL
                AND "usedBy" <> ''[]''::jsonb';
  END IF;
END $$;

DELETE FROM public.orders;
DELETE FROM public.customers;

COMMIT;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 5 · VERIFICACIÓN FINAL (líneas 215–249) — no escribe             ║
-- ║  Empieza en:  SELECT 'customers (debe ser 0)' AS comprobacion,           ║
-- ║  Termina en:  ORDER BY comprobacion;                                     ║
-- ║                                                                          ║
-- ║  Esperado: customers 0, orders 0, huérfanos 0, y products/categories/    ║
-- ║  drivers/staff/settings con sus cantidades de siempre.                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
SELECT 'customers (debe ser 0)' AS comprobacion,
       count(*)::text AS valor,
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌ quedan filas' END AS estado
FROM public.customers
UNION ALL
SELECT 'orders (debe ser 0)', count(*)::text,
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌ quedan filas' END
FROM public.orders
UNION ALL
SELECT 'pedidos huérfanos (debe ser 0)', count(*)::text,
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌ siguen ahí' END
FROM public.orders o
WHERE o."clientId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = o."clientId")
UNION ALL
SELECT 'products (NO debe ser 0)', count(*)::text,
       CASE WHEN count(*) > 0 THEN '✅ intacto' ELSE '❌ SE BORRÓ EL CATÁLOGO' END
FROM public.products
UNION ALL
SELECT 'categories (NO debe ser 0)', count(*)::text,
       CASE WHEN count(*) > 0 THEN '✅ intacto' ELSE '❌ se borró' END
FROM public.categories
UNION ALL
SELECT 'drivers (NO debe ser 0)', count(*)::text,
       CASE WHEN count(*) > 0 THEN '✅ intacto' ELSE '⚠️ estaba vacío o se borró' END
FROM public.drivers
UNION ALL
SELECT 'staff (NO debe ser 0)', count(*)::text,
       CASE WHEN count(*) > 0 THEN '✅ intacto' ELSE '❌ se borró el personal' END
FROM public.staff
UNION ALL
SELECT 'settings (NO debe ser 0)', count(*)::text,
       CASE WHEN count(*) > 0 THEN '✅ intacto' ELSE '❌ se borró la config' END
FROM public.settings
ORDER BY comprobacion;

-- Comprobación aparte de los cupones (la tabla puede no existir):
-- SELECT count(*) AS cupones_conservados FROM public.cupones;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 6 · DESHACER (líneas 260–279) — SOLO si algo salió mal           ║
-- ║  Está COMENTADO a propósito. Para usarlo, quita los `--` del bloque      ║
-- ║  y ejecútalo. Requiere que el schema `respaldo` siga existiendo.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- BEGIN;
--
-- -- Se restaura en orden inverso al borrado.
-- INSERT INTO public.customers
--   SELECT * FROM respaldo.customers_pre_limpieza;
--
-- INSERT INTO public.orders
--   SELECT * FROM respaldo.orders_pre_limpieza;
--
-- -- Devolver el histórico de uso a los cupones (solo esa columna).
-- UPDATE public.cupones c
--    SET "usedBy" = r."usedBy"
--   FROM respaldo.cupones_pre_limpieza r
--  WHERE c.id = r.id;
--
-- COMMIT;
--
-- -- Comprobar que volvió todo:
-- SELECT (SELECT count(*) FROM public.customers) AS clientes,
--        (SELECT count(*) FROM public.orders)    AS pedidos;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TANDA 7 · BORRAR EL RESPALDO (líneas 287–288)                          ║
-- ║  Ejecútalo SOLO cuando hayas entrado al panel, visto que todo funciona   ║
-- ║  y hecho un pedido de prueba nuevo. Después de esto no hay marcha atrás. ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- DROP SCHEMA respaldo CASCADE;
-- SELECT 'respaldo eliminado' AS resultado;
