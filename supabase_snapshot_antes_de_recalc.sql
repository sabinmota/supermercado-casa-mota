-- ═══════════════════════════════════════════════════════════════════════════
--  CASA MOTA — RED DE SEGURIDAD ANTES DEL RECÁLCULO
--  Copia de seguridad quirúrgica de las 4 tablas que toca
--  supabase_recalc_clientes_y_telefonos.sql
--  Fecha: 2026-08-03
-- ═══════════════════════════════════════════════════════════════════════════
--
--  POR QUÉ ESTO Y NO EL "RESTORE" DE SUPABASE
--  ------------------------------------------
--  El botón Restore de Database → Backups devuelve TODA la base de datos al
--  estado de la medianoche: perderías todos los pedidos y clientes creados
--  desde entonces. Para deshacer un recálculo de contadores es desproporcionado.
--
--  Esto copia solo las tablas afectadas a un esquema aparte. Ocupa segundos,
--  no cuesta nada y permite volver atrás columna por columna sin perder
--  ninguna actividad nueva.
--
--  QUÉ TOCA EL SCRIPT DE RECÁLCULO
--  -------------------------------
--    customers → orders, spent, lastOrder, lastOrderAt, phone, whatsapp
--    orders    → customer_phone, phone
--    drivers   → phone, whatsapp
--    staff     → phone
--
--  CÓMO USARLO
--  -----------
--  PASO A  → ejecútalo ANTES de tocar nada.
--  PASO B  → comprobación (opcional, solo lectura).
--  PASO C  → SOLO si algo sale mal: deshace los cambios.
--  PASO D  → cuando todo esté verificado, borra la copia.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO A — CREAR LA COPIA  (ejecutar ANTES del recálculo)
-- ═══════════════════════════════════════════════════════════════════════════
--  Idempotente: si vuelves a ejecutarlo, borra la copia anterior y hace otra
--  nueva. Ojo con eso: no acumules ejecuciones después de haber recalculado,
--  porque sobreescribirías la foto del "antes".

CREATE SCHEMA IF NOT EXISTS respaldo;

DROP TABLE IF EXISTS respaldo.customers_pre_recalc;
DROP TABLE IF EXISTS respaldo.orders_pre_recalc;
DROP TABLE IF EXISTS respaldo.drivers_pre_recalc;
DROP TABLE IF EXISTS respaldo.staff_pre_recalc;

CREATE TABLE respaldo.customers_pre_recalc AS SELECT * FROM public.customers;
CREATE TABLE respaldo.orders_pre_recalc    AS SELECT * FROM public.orders;

-- drivers y staff pueden no existir en todos los proyectos: se copian solo si están
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='drivers') THEN
    EXECUTE 'CREATE TABLE respaldo.drivers_pre_recalc AS SELECT * FROM public.drivers';
    RAISE NOTICE 'drivers copiada';
  ELSE
    RAISE NOTICE 'drivers no existe, se omite';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='staff') THEN
    EXECUTE 'CREATE TABLE respaldo.staff_pre_recalc AS SELECT * FROM public.staff';
    RAISE NOTICE 'staff copiada';
  ELSE
    RAISE NOTICE 'staff no existe, se omite';
  END IF;
END $$;

-- Dejar constancia de cuándo se hizo la foto
COMMENT ON SCHEMA respaldo IS 'Copia previa al recálculo de contadores y teléfonos';

-- Resultado: cuántas filas se guardaron de cada tabla
SELECT 'customers' AS tabla, count(*) AS filas_copiadas FROM respaldo.customers_pre_recalc
UNION ALL
SELECT 'orders',    count(*) FROM respaldo.orders_pre_recalc
ORDER BY tabla;


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO B — COMPROBAR LA COPIA  (solo lectura, opcional)
-- ═══════════════════════════════════════════════════════════════════════════
--  Las dos columnas de filas deben coincidir. Si no coinciden, la copia se hizo
--  mal o alguien escribió entremedias: repite el PASO A.

SELECT
  (SELECT count(*) FROM public.customers)             AS clientes_ahora,
  (SELECT count(*) FROM respaldo.customers_pre_recalc) AS clientes_copia,
  (SELECT count(*) FROM public.orders)                AS pedidos_ahora,
  (SELECT count(*) FROM respaldo.orders_pre_recalc)    AS pedidos_copia;


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO C — DESHACER  (⚠️ SOLO si el recálculo salió mal)
-- ═══════════════════════════════════════════════════════════════════════════
--  NO ejecutes esto si todo fue bien.
--
--  Devuelve ÚNICAMENTE las columnas que el script modificó. Los pedidos y
--  clientes creados después del PASO A NO se pierden: las filas que no estén
--  en la copia simplemente no se tocan.
--
--  Quita los comentarios (--) del bloque que necesites.

-- ── C.1 · Deshacer los contadores de clientes ─────────────────────────────
-- UPDATE public.customers c
-- SET "orders"      = b."orders",
--     "spent"       = b."spent",
--     "lastOrder"   = b."lastOrder",
--     "lastOrderAt" = b."lastOrderAt"
-- FROM respaldo.customers_pre_recalc b
-- WHERE c.id = b.id;

-- ── C.2 · Deshacer los teléfonos de clientes ──────────────────────────────
-- UPDATE public.customers c
-- SET phone = b.phone
-- FROM respaldo.customers_pre_recalc b
-- WHERE c.id = b.id;

-- ── C.3 · Deshacer los teléfonos de pedidos ───────────────────────────────
-- UPDATE public.orders o
-- SET customer_phone = b.customer_phone
-- FROM respaldo.orders_pre_recalc b
-- WHERE o.id = b.id;

-- ── C.4 · Deshacer los teléfonos de repartidores ──────────────────────────
-- UPDATE public.drivers d
-- SET phone = b.phone
-- FROM respaldo.drivers_pre_recalc b
-- WHERE d.id = b.id;


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO D — LIMPIAR  (cuando ya hayas verificado que todo está bien)
-- ═══════════════════════════════════════════════════════════════════════════
--  No hay prisa: la copia no molesta a nadie y no la lee la aplicación.
--  Espera unos días de uso normal antes de borrarla.

-- DROP SCHEMA respaldo CASCADE;
