-- ============================================================
-- SUPERMERCADO CASA MOTA — Setup completo proyecto nuevo
-- Proyecto: casa-mota-saopaulo (sa-east-1)
-- Ejecutar en: SQL Editor → Run
-- ============================================================

-- ── 1. CREAR TABLAS BASE ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.products (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  name         TEXT,
  description  TEXT,
  price        NUMERIC DEFAULT 0,
  stock        INTEGER DEFAULT 0,
  category     TEXT,
  image        TEXT,
  unit         TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.categories (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  name         TEXT,
  slug         TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.customers (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.orders (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  customer     TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  address      TEXT,
  total        NUMERIC DEFAULT 0,
  status       TEXT DEFAULT 'pendiente',
  items        INTEGER DEFAULT 0,
  notes        TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.staff (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  name         TEXT,
  email        TEXT,
  role         TEXT,
  pin          TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.drivers (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  name         TEXT,
  phone        TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.cupones (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.settings (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  key          TEXT,
  value        TEXT,
  deleted      BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.notificaciones (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  deleted      BOOLEAN DEFAULT false
);

-- ── 2. COLUMNAS EXTRA products ────────────────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isNew"          BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isFeatured"     BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isOnSale"       BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tags             JSONB   DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku              TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight           NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "costPrice"      NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "minStock"       INTEGER DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "maxStock"       INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "expiryDate"     TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier         TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "locationCode"   TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "taxRate"        NUMERIC DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isActive"       BOOLEAN DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "inStock"        BOOLEAN DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS inactive         BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "originalPrice"  NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode          TEXT;
-- categoryId: COLUMNA MUERTA. El codigo usa products.category (texto).
--   Se elimina en el bloque 12 al final de este fichero.
-- ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "categoryId"     TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS subcategory      TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand            TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origin           TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS allergens        TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "nutritionFacts" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS discount         NUMERIC DEFAULT 0;

-- ── 3. COLUMNAS EXTRA categories ─────────────────────────────
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS active         BOOLEAN DEFAULT true;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image          TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color          TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS "parentId"     TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS "isVisible"    BOOLEAN DEFAULT true;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS emoji          TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS "sortOrder"    INTEGER DEFAULT 99;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS "bgColor"      TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS "textColor"    TEXT;

-- ── 4. COLUMNAS EXTRA staff ───────────────────────────────────
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS avatar             TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS address            TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS cedula             TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "hireDate"         TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS salary             NUMERIC;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS department         TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS notes              TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS permissions        JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS cargo              TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "firstName"        TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "lastName"         TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'active';
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "lastLogin"        BIGINT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "createdAt"        BIGINT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "updatedAt"        BIGINT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "startDate"        TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS phone              TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "workSchedule"     TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "emergencyContact" TEXT;

-- ── 5. COLUMNAS EXTRA drivers ─────────────────────────────────
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS address          TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS email            TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "licenseNumber"  TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "licenseExpiry"  TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS rating           NUMERIC DEFAULT 5;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS avatar           TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS cedula           TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "createdAt"      BIGINT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "updatedAt"      BIGINT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS zone             TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'active';
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS plate            TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS whatsapp         TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "isAvailable"    BOOLEAN DEFAULT true;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "startDate"      TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS vehicle_type     TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "deliveryCount"  INTEGER DEFAULT 0;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "totalEarnings"  NUMERIC DEFAULT 0;

-- ── 6. COLUMNAS EXTRA cupones ─────────────────────────────────
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS activo           BOOLEAN DEFAULT true;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS nombre           TEXT;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS descripcion      TEXT;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "minAmount"      NUMERIC DEFAULT 0;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "maxDiscount"    NUMERIC;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS categories       JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS products         JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "usedBy"         JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS codigo           TEXT;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS tipo             TEXT DEFAULT 'percent';
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS valor            NUMERIC DEFAULT 0;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS minimo           NUMERIC DEFAULT 0;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS usos_max         INTEGER;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS usos_actuales    INTEGER DEFAULT 0;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS fecha_inicio     TEXT;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS fecha_fin        TEXT;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "usedCount"      INTEGER DEFAULT 0;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS usos_maximos     INTEGER;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "maxUses"        INTEGER;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS compra_minima    NUMERIC DEFAULT 0;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS descuento_max    NUMERIC;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "restrictCategories" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "restrictProducts"   JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.cupones ADD COLUMN IF NOT EXISTS "usadoPor"       JSONB DEFAULT '[]'::jsonb;

-- ── 7. COLUMNAS EXTRA customers ───────────────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "createdAt"         BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "updatedAt"         BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city                TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "birthDate"         TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS gender              TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS avatar              TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyTier"       TEXT DEFAULT 'bronze';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrderAt"       BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "totalOrders"       INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS cedula              TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS password            TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS orders              INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS spent               NUMERIC DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyPoints"     INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'active';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "firstName"         TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastName"          TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrder"         TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastLogin"         BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastLoginAt"       BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "mapLink"           TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyHistory"    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLog"        JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLastActivity" BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyExpiry"     BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLevel"      TEXT DEFAULT 'bronze';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "orderHistory"      JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS wishlist            JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "addressList"       JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "referralCode"      TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "referredBy"        TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS access              BOOLEAN DEFAULT true;

-- ── 8. COLUMNAS EXTRA orders ──────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "customerId"       TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "driverId"         UUID;  -- UUID desde 2026-08-04
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "deliveryFee"      NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal           NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount           NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax                NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon             TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "paymentStatus"    TEXT DEFAULT 'pending';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "deliveryType"     TEXT DEFAULT 'delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "scheduledAt"      BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "deliveredAt"      BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cancelReason"     TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS zone               TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "pointsEarned"     INTEGER DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "pointsUsed"       INTEGER DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS history            JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "invoiceNumber"    TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "autorizaSustitucion" BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "createdAt"        BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "updatedAt"        BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client             TEXT;
-- ⚠️ 2026-08-04: UUID, no TEXT. Ver el bloque 12.3 al final de este fichero
--    (claves ajenas ON DELETE SET NULL hacia customers.id / drivers.id).
--    Con TEXT no se podrían crear.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "clientId"         UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone              TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "payMethod"        TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS date               TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "productLines"     JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sustituciones      JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "ceroCentavos"     NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "horarioEntrega"   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rnc                TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "rncNombre"        TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "notaRepartidor"   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cuponId"          TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cuponUsado"       TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cuponDescuento"   NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cancelledAt"      BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cancelledBy"      TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "confirmedAt"      BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "confirmedBy"      TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "preparedAt"       BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "shippedAt"        BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "assignedAt"       BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS descuento          NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "descuentoMonto"   NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "descuentoPct"     NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS envio              NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS impuesto           NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS propina            NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS email              TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fechaEntrega"     TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fiscalNombre"     TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fiscalRNC"        TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fiscalSolicitado" BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "mapLink"          TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "payMethodLabel"   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping           NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source             TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS city               TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number       INTEGER;

-- ── 9. COLUMNAS EXTRA notificaciones ─────────────────────────
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS destinatario_id      TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS destinatario_type    TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS destinatario_nombre  TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS data                 JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS icon                 TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS link                 TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS "readAt"             BIGINT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS pedido_id            TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS cliente_email        TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS tipo                 TEXT DEFAULT 'info';
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS titulo               TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS mensaje              TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS leida                BOOLEAN DEFAULT false;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS leido                BOOLEAN DEFAULT false;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS "createdAt"          BIGINT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS "updatedAt"          BIGINT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS order_id             TEXT;
-- customer_id: COLUMNA MUERTA. El destinatario se identifica por cliente_email.
--   Se elimina en el bloque 12 al final de este fichero.
-- ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS customer_id          TEXT;

-- ── 10. ÍNDICES para mejor rendimiento ───────────────────────
CREATE INDEX IF NOT EXISTS idx_products_created_at  ON public.products(created_at);
CREATE INDEX IF NOT EXISTS idx_products_category    ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_deleted     ON public.products(deleted);
CREATE INDEX IF NOT EXISTS idx_orders_created_at    ON public.orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_number  ON public.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_customers_email      ON public.customers(email);
CREATE INDEX IF NOT EXISTS idx_categories_sort      ON public.categories("sortOrder");

-- ── 11. RLS — deshabilitar para acceso via API key ────────────
ALTER TABLE public.products       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupones        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- BLOQUE 12 — CAMBIOS DE ESQUEMA CONSOLIDADOS (2026-08-09)
-- Origen: limpieza/8, limpieza/10, limpieza/11 y limpieza/29.
-- Esos cuatro ficheros ya se ejecutaron sobre la base real y se
-- borraron. Su contenido vive aqui para que una base recreada
-- desde cero quede identica a la de produccion.
-- Todo el bloque es idempotente: se puede volver a ejecutar.
--
-- 🔴 DOS AVISOS, porque aqui el bloque corre ANTES de importar datos
--    (en supabase_alter.sql corre despues, y no aplican):
--
--  1) LAS CLAVES AJENAS DEL 12.3 RECHAZARAN LA IMPORTACION si algun
--     pedido apunta a un cliente o repartidor que aun no existe. Importa
--     SIEMPRE en este orden: customers y drivers PRIMERO, orders DESPUES.
--     Si el volcado no lo permite, ejecuta el bloque 12.3 al FINAL, ya
--     con los datos dentro.
--
--  2) EL setval DEL 12.1 SE QUEDA CORTO. Aqui orders esta vacia, asi que
--     la secuencia arranca en 1. Si luego importas pedidos con su
--     order_number, el primer pedido nuevo intentara el numero 1 y
--     chocara con el indice unico. DESPUES DE IMPORTAR, vuelve a lanzar:
--
--       SELECT setval('public.orders_order_number_seq',
--         COALESCE((SELECT MAX(order_number) FROM public.orders), 0) + 1, false);
-- ============================================================

-- ── 12.1 orders.order_number: numeracion automatica ───────────
-- Sin esto los pedidos nuevos nacen con order_number NULL y el
-- cliente no ve numero de pedido.
CREATE SEQUENCE IF NOT EXISTS public.orders_order_number_seq AS BIGINT;

SELECT setval(
  'public.orders_order_number_seq',
  COALESCE((SELECT MAX(order_number) FROM public.orders), 0) + 1,
  false
);

ALTER TABLE public.orders
  ALTER COLUMN order_number SET DEFAULT nextval('public.orders_order_number_seq');

ALTER SEQUENCE public.orders_order_number_seq
  OWNED BY public.orders.order_number;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_unique
  ON public.orders (order_number) WHERE order_number IS NOT NULL;

GRANT USAGE, SELECT ON SEQUENCE public.orders_order_number_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.orders_order_number_seq TO authenticated;


-- ── 12.2 orders: clientId / driverId a UUID ───────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'clientId' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.orders
      ALTER COLUMN "clientId" TYPE UUID USING NULLIF("clientId"::text, '')::uuid;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'driverId' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.orders
      ALTER COLUMN "driverId" TYPE UUID USING NULLIF("driverId"::text, '')::uuid;
  END IF;
END $$;


-- ── 12.3 orders: claves ajenas a customers y drivers ──────────
-- ON DELETE SET NULL: borrar un cliente NO borra sus pedidos,
-- solo desvincula. El historico de ventas se conserva.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_clientId_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT "orders_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES public.customers(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_driverId_fkey'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT "orders_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES public.drivers(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_clientid_idx ON public.orders ("clientId");
CREATE INDEX IF NOT EXISTS orders_driverid_idx ON public.orders ("driverId");


-- ── 12.4 Vista v_pedidos_por_cliente ──────────────────────────
-- Reproduce en SQL el cruce pedido-cliente que hace
-- _ordersOfCustomer() en js/admin.v33.js.
CREATE OR REPLACE VIEW public.v_pedidos_por_cliente AS
WITH ped AS (
  SELECT o.id,
         o."clientId" AS client_id,
         lower(btrim(coalesce(nullif(o.customer_email, ''), o.email, ''))) AS oemail,
         lower(btrim(coalesce(o.customer, ''))) AS oname,
         lower(btrim(coalesce(o.status, '')))   AS ostatus,
         coalesce(o.total, 0)                   AS ototal,
         o."date"::text                         AS odate,
         o.created_at
  FROM public.orders o
  WHERE coalesce(o.deleted, false) = false
), cli AS (
  SELECT c.id,
         lower(btrim(coalesce(c.email, ''))) AS cemail,
         lower(btrim(coalesce(c.name,  ''))) AS cname
  FROM public.customers c
  WHERE coalesce(c.deleted, false) = false
)
SELECT cli.id AS customer_id, ped.*
FROM cli
JOIN ped ON (
     (ped.client_id IS NOT NULL AND ped.client_id = cli.id)
  OR (cli.cemail <> '' AND ped.oemail = cli.cemail)
  OR (ped.oemail = '' AND cli.cname <> '' AND ped.oname = cli.cname)
);

COMMENT ON VIEW public.v_pedidos_por_cliente IS
  'Cruce pedido↔cliente equivalente a _ordersOfCustomer() de js/admin.v33.js';


-- ── 12.5 notificaciones: borrado del lado del cliente ─────────
-- deleted         = lo borro el ADMIN  (campana de la tienda)
-- borrada_cliente = lo borro el CLIENTE (campana de la tienda online)
-- Dos actores distintos sobre la misma fila: NUNCA compartir columna.
ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS borrada_cliente BOOLEAN DEFAULT false;

UPDATE public.notificaciones
   SET borrada_cliente = false
 WHERE borrada_cliente IS NULL;

CREATE INDEX IF NOT EXISTS idx_notif_cliente_email
  ON public.notificaciones(cliente_email);


-- ── 12.6 Borrar columnas muertas ──────────────────────────────
ALTER TABLE public.products       DROP COLUMN IF EXISTS "categoryId";
ALTER TABLE public.notificaciones DROP COLUMN IF EXISTS customer_id;

-- ============================================================
-- ✅ Estructura lista — ahora importar los datos
--
-- ORDEN DE IMPORTACION OBLIGATORIO (por las claves ajenas del 12.3):
--    1. categories
--    2. customers
--    3. drivers
--    4. staff · settings · cupones · products
--    5. orders          ← DESPUES de customers y drivers
--    6. notificaciones
--
-- Y AL TERMINAR, reajustar la secuencia de numeros de pedido:
--    SELECT setval('public.orders_order_number_seq',
--      COALESCE((SELECT MAX(order_number) FROM public.orders), 0) + 1, false);
-- ============================================================
