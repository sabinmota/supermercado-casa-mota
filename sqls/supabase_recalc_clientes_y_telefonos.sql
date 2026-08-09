-- ═══════════════════════════════════════════════════════════════════════════
--  CASA MOTA — SANEADO DE DATOS
--  1) Recalcular customers.orders / spent / lastOrder desde los pedidos reales
--  2) Normalizar todos los teléfonos guardados al formato 809-696-1013
--  Fecha: 2026-08-02
-- ═══════════════════════════════════════════════════════════════════════════
--
--  POR QUÉ
--  -------
--  · customers.orders / spent / lastOrder son contadores denormalizados que
--    SOLO se incrementaban al crear un pedido (js/app.js y js/admin.v33.js).
--    Nunca se recalculaban, así que se desfasaron con cancelaciones, pedidos
--    borrados y PATCH fallidos en silencio.
--    Desde el build 369 las pantallas ya NO los leen (se cuentan en vivo),
--    pero siguen mal EN LA BASE DE DATOS: cualquier consulta directa,
--    exportación o informe daría cifras falsas. Esto los pone al día.
--
--  · Los teléfonos guardados antes del build 369 desde la tienda entraron
--    pegados ("8096961013"). El panel los maquilla al mostrarlos, pero el dato
--    crudo sigue sucio. Esto lo arregla en origen.
--
--  🔴 ACTUALIZADO EL 2026-08-04 — LEER ANTES DE EJECUTAR NADA DE AQUÍ
--  ------------------------------------------------------------------
--  Este fichero se escribió cuando orders."clientId" era TEXT. Se convirtió
--  a UUID con clave ajena (hoy en supabase_alter.sql, bloque 12.2 y 12.3).
--  Se corrigieron por eso tres sitios: la línea del ALTER (ahora UUID) y la
--  regla del JOIN de la vista (ya sin ::text y sin la comparación con '').
--
--  Si se ejecutara la versión antigua de la tanda 1 sobre la base de hoy,
--  el CREATE OR REPLACE VIEW fallaría con:
--      ERROR: operator does not exist: uuid = text
--  No corrompería datos —la vista no escribe—, pero las tandas 2 y 3 se
--  quedarían sin la vista que necesitan. Usa SIEMPRE esta versión.
--
--  CÓMO EJECUTARLO
--  ---------------
--  ⚠️ NO pegues las 300 líneas de golpe: el SQL Editor de Supabase solo
--     muestra el resultado del ÚLTIMO select, así que las vistas previas de
--     los pasos 1 y 3 se ejecutarían sin que las llegues a ver.
--     Ejecuta por tandas, en este orden:
--        Tanda 1 → líneas  51-101 (preparación: columnas + vista)   no escribe
--        Tanda 2 → líneas 110-126 (PASO 1: ver el desfase)          no escribe
--        Tanda 3 → líneas 138-175 (PASO 2: recalcular)              ESCRIBE
--        Tanda 4 → líneas 185-230 (PASO 3: función + ver teléfonos) no escribe
--        Tanda 5 → líneas 239-277 (PASO 4: normalizar teléfonos)    ESCRIBE
--        Tanda 6 → líneas 286-301 y 306-317 (PASO 5: verificar)     no escribe
--  Es idempotente: se puede ejecutar las veces que haga falta.
--
--  ⚠️ ANTES DE EMPEZAR: ejecuta el PASO A de
--     supabase_snapshot_antes_de_recalc.sql
--     Copia las 4 tablas afectadas al esquema "respaldo" y permite deshacer
--     solo estas columnas, sin perder los pedidos nuevos.
--     NO uses el botón Restore de Database → Backups para deshacer esto:
--     devolvería TODA la base de datos a la medianoche.
--     Para respaldar los datos usa admin.html → Respaldo (exporta JSON con
--     todas las tablas). El antiguo backup-tool.html se eliminó en el build 378.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  RED DE SEGURIDAD: asegurar que existen las columnas que se van a tocar.
--  Con IF NOT EXISTS, si ya están no pasa nada. Evita que el script muera a
--  medias por una columna ausente en un proyecto que venga de otra migración.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "orders"      INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "spent"       NUMERIC DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrder"   TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrderAt" BIGINT;
-- ⚠️ clientId es UUID desde el 2026-08-04 (supabase_alter.sql 12.2), no TEXT.
--    Con IF NOT EXISTS estas dos líneas no hacen nada en la base actual (la
--    columna ya existe), pero el tipo declarado importa si algún día se levanta
--    el proyecto desde cero: con TEXT no se podría crear la clave ajena.
ALTER TABLE public.orders    ADD COLUMN IF NOT EXISTS "clientId"    UUID;
ALTER TABLE public.orders    ADD COLUMN IF NOT EXISTS "date"        TEXT;


-- ═══════════════════════════════════════════════════════════════════════════
--  VISTA AUXILIAR — el cruce pedido ↔ cliente, en un solo sitio
-- ═══════════════════════════════════════════════════════════════════════════
--  Replica EXACTAMENTE la regla de _ordersOfCustomer() en js/admin.v33.js:
--    1º  clientId              (identificador directo, lo más fiable)
--    2º  email == email        (customer_email tiene prioridad sobre email)
--    3º  nombre == nombre      solo si el pedido no trae email
--  Si algún día cambia la regla en el JS, cambiarla también aquí.
--
--  ⚠️ ESTA DEFINICIÓN DEBE SER IDÉNTICA A LAS DE supabase_alter.sql (bloque
--     12.4) y supabase_new_project.sql (bloque 12.4). Son los TRES únicos
--     sitios que crean la vista; si divergen, la última que se ejecute gana
--     y nadie se entera. Comprobadas idénticas el 2026-08-09.

CREATE OR REPLACE VIEW public.v_pedidos_por_cliente AS
WITH ped AS (
  SELECT
    o.id,
    o."clientId"                                                        AS client_id,
    lower(btrim(coalesce(nullif(o.customer_email,''), o.email, '')))    AS oemail,
    lower(btrim(coalesce(o.customer, '')))                              AS oname,
    lower(btrim(coalesce(o.status, '')))                                AS ostatus,
    coalesce(o.total, 0)                                                AS ototal,
    o."date"::text                                                      AS odate,
    o.created_at
  FROM public.orders o
  WHERE coalesce(o.deleted, false) = false
),
cli AS (
  SELECT
    c.id,
    lower(btrim(coalesce(c.email, ''))) AS cemail,
    lower(btrim(coalesce(c.name,  ''))) AS cname
  FROM public.customers c
  WHERE coalesce(c.deleted, false) = false
)
SELECT
  cli.id AS customer_id,
  ped.*
FROM cli
JOIN ped ON (
      -- clientId es UUID igual que customers.id: se comparan directamente.
      -- Antes decía "ped.client_id <> '' AND ped.client_id = cli.id::text";
      -- con UUID eso ya no compila (no existe el operador uuid = text, y
      -- comparar un uuid con '' es un error de sintaxis en tiempo de ejecución).
      (ped.client_id IS NOT NULL AND ped.client_id = cli.id)
   OR (cli.cemail <> '' AND ped.oemail = cli.cemail)
   OR (ped.oemail = '' AND cli.cname <> '' AND ped.oname = cli.cname)
);

COMMENT ON VIEW public.v_pedidos_por_cliente IS
  'Cruce pedido↔cliente equivalente a _ordersOfCustomer() de js/admin.v33.js';


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO 1 — VISTA PREVIA (solo lectura, no cambia nada)
-- ═══════════════════════════════════════════════════════════════════════════
--  Compara lo guardado con lo real. Revisa este resultado ANTES de seguir:
--  si aquí ya sale todo "=", no hace falta ejecutar el paso 2.

SELECT
  c.name                                    AS cliente,
  c."orders"                                AS pedidos_guardado,
  count(v.id) FILTER (WHERE v.ostatus <> 'cancelado') AS pedidos_real,
  round(coalesce(c."spent", 0), 2)          AS gastado_guardado,
  round(coalesce(sum(v.ototal) FILTER (WHERE v.ostatus <> 'cancelado'), 0), 2) AS gastado_real,
  CASE
    WHEN coalesce(c."orders", 0) = count(v.id) FILTER (WHERE v.ostatus <> 'cancelado')
     AND round(coalesce(c."spent", 0), 2) =
         round(coalesce(sum(v.ototal) FILTER (WHERE v.ostatus <> 'cancelado'), 0), 2)
    THEN '=' ELSE '⚠️ DESFASADO'
  END                                       AS estado
FROM public.customers c
LEFT JOIN public.v_pedidos_por_cliente v ON v.customer_id = c.id
WHERE coalesce(c.deleted, false) = false
GROUP BY c.id, c.name, c."orders", c."spent"
ORDER BY estado DESC, cliente;


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO 2 — RECALCULAR (esto SÍ escribe)
-- ═══════════════════════════════════════════════════════════════════════════
--  Criterios, idénticos a los de la pantalla de Clientes:
--    · pedidos  = pedidos NO cancelados
--    · gastado  = suma de los NO cancelados
--    · último   = el más reciente por created_at, INCLUIDOS los cancelados
--                 (que te cancelen un pedido también es actividad)

WITH agg AS (
  SELECT
    customer_id,
    count(*) FILTER (WHERE ostatus <> 'cancelado')                  AS n_pedidos,
    coalesce(sum(ototal) FILTER (WHERE ostatus <> 'cancelado'), 0)  AS total_gastado
  FROM public.v_pedidos_por_cliente
  GROUP BY customer_id
),
ult AS (
  -- DISTINCT ON + ORDER BY created_at DESC = una fila por cliente, la más nueva.
  -- Se ordena por created_at (timestamptz real) y NO por la columna date, que
  -- es texto "dd/mm/aaaa HH:MM" y se ordenaría alfabéticamente (mal).
  SELECT DISTINCT ON (customer_id)
    customer_id,
    coalesce(nullif(btrim(odate), ''), to_char(created_at, 'DD/MM/YYYY HH24:MI')) AS fecha,
    (extract(epoch FROM created_at) * 1000)::bigint                               AS fecha_ms
  FROM public.v_pedidos_por_cliente
  ORDER BY customer_id, created_at DESC
)
UPDATE public.customers c
SET
  "orders"      = coalesce(agg.n_pedidos, 0),
  "spent"       = round(coalesce(agg.total_gastado, 0), 2),
  "lastOrder"   = ult.fecha,
  "lastOrderAt" = ult.fecha_ms
FROM agg
FULL JOIN ult ON ult.customer_id = agg.customer_id
WHERE c.id = coalesce(agg.customer_id, ult.customer_id)
  AND coalesce(c.deleted, false) = false;

-- Clientes sin ningún pedido: dejarlos en 0 en vez de en NULL o en un valor viejo
UPDATE public.customers c
SET "orders" = 0, "spent" = 0, "lastOrder" = NULL, "lastOrderAt" = NULL
WHERE coalesce(c.deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM public.v_pedidos_por_cliente v WHERE v.customer_id = c.id
  )
  AND (coalesce(c."orders", 0) <> 0 OR coalesce(c."spent", 0) <> 0 OR c."lastOrder" IS NOT NULL);


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO 3 — TELÉFONOS: función de formato (misma regla que fmtPhoneDO en JS)
-- ═══════════════════════════════════════════════════════════════════════════
--  10 dígitos → 809-696-1013 · 7 dígitos → 696-1013
--  Un '1' inicial de 11 dígitos se descarta (1-809-… → 809-…)
--  Cualquier otra longitud se deja INTACTA: puede ser un número extranjero.

CREATE OR REPLACE FUNCTION public.casamota_fmt_phone(v text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN v;
  END IF;

  d := regexp_replace(v, '\D', '', 'g');          -- solo dígitos
  IF d = '' THEN
    RETURN v;                                     -- texto sin dígitos → intacto
  END IF;

  IF length(d) = 11 AND left(d, 1) = '1' THEN
    d := right(d, 10);
  END IF;

  IF length(d) = 10 THEN
    RETURN substr(d,1,3) || '-' || substr(d,4,3) || '-' || substr(d,7,4);
  END IF;

  IF length(d) = 7 THEN
    RETURN substr(d,1,3) || '-' || substr(d,4,4);
  END IF;

  RETURN btrim(v);                                -- longitud rara → no tocar
END;
$$;

COMMENT ON FUNCTION public.casamota_fmt_phone(text) IS
  'Formato telefónico dominicano. Gemela SQL de fmtPhoneDO() en js/api.js';

-- Vista previa: qué cambiaría en customers (solo lectura)
SELECT
  name                              AS cliente,
  phone                             AS antes,
  public.casamota_fmt_phone(phone)  AS despues
FROM public.customers
WHERE coalesce(deleted, false) = false
  AND phone IS NOT NULL
  AND phone <> public.casamota_fmt_phone(phone)
ORDER BY name;


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO 4 — NORMALIZAR LOS TELÉFONOS (esto SÍ escribe)
-- ═══════════════════════════════════════════════════════════════════════════
--  Recorre las tablas/columnas de teléfono que existan. Las que no existan en
--  este proyecto se saltan sin error. Solo actualiza las filas que cambian.

DO $$
DECLARE
  r      record;
  n      integer;
  total  integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('customers', 'phone'),
      ('customers', 'whatsapp'),
      ('drivers',   'phone'),
      ('drivers',   'whatsapp'),
      ('staff',     'phone'),
      ('orders',    'customer_phone'),
      ('orders',    'phone')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
    ) THEN
      EXECUTE format(
        'UPDATE public.%I SET %I = public.casamota_fmt_phone(%I)
          WHERE %I IS NOT NULL AND %I <> public.casamota_fmt_phone(%I)',
        r.tbl, r.col, r.col, r.col, r.col, r.col
      );
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      IF n > 0 THEN
        RAISE NOTICE '% .% → % teléfonos normalizados', r.tbl, r.col, n;
      END IF;
    ELSE
      RAISE NOTICE '% .% no existe, se omite', r.tbl, r.col;
    END IF;
  END LOOP;

  RAISE NOTICE '───────────────────────────────';
  RAISE NOTICE 'TOTAL: % teléfonos normalizados', total;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  PASO 5 — VERIFICACIÓN FINAL
-- ═══════════════════════════════════════════════════════════════════════════
--  La columna "estado" debe salir '=' en TODAS las filas.
--  "tel_ok" debe ser true en todas: ningún teléfono sin guiones.

SELECT
  c.name                                    AS cliente,
  c.phone                                   AS telefono,
  (c.phone IS NULL OR c.phone = public.casamota_fmt_phone(c.phone)) AS tel_ok,
  c."orders"                                AS pedidos,
  round(coalesce(c."spent", 0), 2)          AS gastado,
  c."lastOrder"                             AS ultimo_pedido,
  CASE
    WHEN coalesce(c."orders", 0) = count(v.id) FILTER (WHERE v.ostatus <> 'cancelado')
    THEN '=' ELSE '⚠️ REVISAR'
  END                                       AS estado
FROM public.customers c
LEFT JOIN public.v_pedidos_por_cliente v ON v.customer_id = c.id
WHERE coalesce(c.deleted, false) = false
GROUP BY c.id, c.name, c.phone, c."orders", c."spent", c."lastOrder"
ORDER BY cliente;

-- Pedidos que NO han encajado con ningún cliente (huérfanos).
-- Lo normal es 0. Si aparecen, son pedidos con email y nombre que no coinciden
-- con ninguna ficha: no suman en las estadísticas de nadie.
SELECT
  o.order_number                        AS pedido,
  o.customer                            AS nombre_en_el_pedido,
  coalesce(nullif(o.customer_email,''), o.email) AS email_en_el_pedido,
  o.status,
  o.total
FROM public.orders o
WHERE coalesce(o.deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM public.v_pedidos_por_cliente v WHERE v.id = o.id
  )
ORDER BY o.order_number;
