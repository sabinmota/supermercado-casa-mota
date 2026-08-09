-- ============================================================
-- SUPERMERCADO CASA MOTA — Agregar columnas faltantes
-- Ejecutar en: Supabase → SQL Editor → Run
-- ============================================================

-- ── products: columnas extra del backup ──────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isNew"          BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isFeatured"     BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isOnSale"       BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tags             JSONB   DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "sku"            TEXT;
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
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "barcode"        TEXT;
-- categoryId: COLUMNA MUERTA. Se elimina en el bloque 12 al final de este fichero.
--   El codigo usa products.category (texto), nunca categoryId.
--   Linea conservada comentada para dejar constancia de que existio.
-- ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "categoryId"     TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "subcategory"    TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "brand"          TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "origin"         TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "allergens"      TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "nutritionFacts" TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "discount"       NUMERIC DEFAULT 0;

-- ── categories: columnas extra del backup ────────────────────
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

-- ── staff: columnas extra del backup ─────────────────────────
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS avatar             TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS address            TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "cedula"           TEXT;
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
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "createdAt"       BIGINT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "updatedAt"       BIGINT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "startDate"       TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS phone             TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "workSchedule"   TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "emergencyContact" TEXT;

-- ── drivers: columnas extra del backup ───────────────────────
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS address          TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS email            TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "licenseNumber"  TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "licenseExpiry"  TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS rating           NUMERIC DEFAULT 5;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS avatar           TEXT;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS "cedula"         TEXT;
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

-- ── cupones: columnas extra del backup ───────────────────────
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

-- ── notificaciones: columnas extra del backup ────────────────
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
-- customer_id: COLUMNA MUERTA. Se elimina en el bloque 12 al final de este fichero.
--   El destinatario se identifica por cliente_email, nunca por customer_id.
-- ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS customer_id          TEXT;
-- borrada_cliente: se crea en el bloque 12.5 al final de este fichero.
--   Es la columna de borrado del CLIENTE, separada de deleted, que es
--   la del ADMIN. Dos actores, dos columnas.

-- ── customers: columnas extra del backup ─────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "createdAt"    BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "updatedAt"    BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city           TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "birthDate"    TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS gender         TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes          TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS avatar         TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyTier"  TEXT DEFAULT 'bronze';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrderAt"  BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "totalOrders"  INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "cedula"       TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS password       TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS orders         INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS spent          NUMERIC DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyPoints" INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS status         TEXT DEFAULT 'active';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "firstName"    TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastName"     TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrder"    TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastLogin"    BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastOrderAt"  BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "lastLoginAt"  BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "mapLink"      TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyHistory"     JSONB  DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLastActivity" TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "access"       BOOLEAN DEFAULT true;

-- ── orders: columnas extra del backup ────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "customerId"      TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "driverId"        UUID;  -- UUID desde 2026-08-04
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "deliveryFee"     NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal          NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount          NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax               NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "paymentStatus"   TEXT DEFAULT 'pending';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "deliveryType"    TEXT DEFAULT 'delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "scheduledAt"     BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "deliveredAt"     BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cancelReason"    TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS zone              TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "pointsEarned"    INTEGER DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "pointsUsed"      INTEGER DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS history           JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "invoiceNumber"   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "autorizaSustitucion" BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "createdAt"       BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "updatedAt"       BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer          TEXT;
-- ⚠️ 2026-08-04: clientId/driverId son UUID. Ver el bloque 12.2/12.3 al final
--    de este fichero, que además les pone clave ajena. Declarados aquí como
--    UUID para que un proyecto levantado de cero admita esas claves ajenas.
--    Sobre la base actual estas líneas no hacen nada (IF NOT EXISTS).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "clientId"        UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone             TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "payMethod"       TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS date              TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "productLines"    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sustituciones     JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "ceroCentavos"    BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "horarioEntrega"  TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rnc               TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "rncNombre"       TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "notaRepartidor"  TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cuponId"         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cuponUsado"      TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cuponDescuento"  NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cancelledAt"     BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "cancelledBy"     TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "confirmedAt"     BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "confirmedBy"     TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "preparedAt"      BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "shippedAt"       BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "assignedAt"      BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS descuento          NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "descuentoMonto"   NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "descuentoPct"     NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "envio"            NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "impuesto"         NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "propina"          NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fechaEntrega"    TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fiscalNombre"    TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fiscalRNC"       TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "fiscalSolicitado" BOOLEAN DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "mapLink"         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "payMethodLabel"  TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping          NUMERIC DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source            TEXT;

-- ── customers: columnas extra adicionales ─────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyHistory"      JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLog"          JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLastActivity" BIGINT;

-- ── orders: columnas faltantes (ciudad, número correlativo) ───
-- city: ciudad de entrega del pedido
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS city          TEXT;
-- order_number: número correlativo corto (ej: 1, 2, 3) para mostrar al cliente
-- separado del UUID interno que genera Supabase en la columna id
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number  INTEGER;
-- ceroCentavos: cambiar de BOOLEAN a NUMERIC (guarda el monto decimal, ej: 0.50)
ALTER TABLE public.orders ALTER COLUMN "ceroCentavos" DROP DEFAULT;
ALTER TABLE public.orders ALTER COLUMN "ceroCentavos" TYPE NUMERIC USING CASE WHEN "ceroCentavos" THEN 0 ELSE 0 END;
ALTER TABLE public.orders ALTER COLUMN "ceroCentavos" SET DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyExpiry"       BIGINT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "loyaltyLevel"        TEXT DEFAULT 'bronze';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "orderHistory"        JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "wishlist"            JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "addressList"         JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "referralCode"        TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS "referredBy"          TEXT;


-- ============================================================
-- BLOQUE 12 — CAMBIOS DE ESQUEMA CONSOLIDADOS (2026-08-09)
-- Origen: limpieza/8, limpieza/10, limpieza/11 y limpieza/29.
-- Esos cuatro ficheros ya se ejecutaron sobre la base real y se
-- borraron. Su contenido vive aqui para que una base recreada
-- desde cero quede identica a la de produccion.
-- Todo el bloque es idempotente: se puede volver a ejecutar.
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
-- Guardado: si la columna ya es UUID el USING con NULLIF fallaria,
-- por eso se comprueba el tipo actual antes de convertir.
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
-- _ordersOfCustomer() en js/admin.v33.js: primero por clientId,
-- si no hay, por email, y si tampoco, por nombre.
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
-- Son dos actores distintos sobre la misma fila: NUNCA compartir columna.
ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS borrada_cliente BOOLEAN DEFAULT false;

UPDATE public.notificaciones
   SET borrada_cliente = false
 WHERE borrada_cliente IS NULL;

CREATE INDEX IF NOT EXISTS idx_notif_cliente_email
  ON public.notificaciones(cliente_email);


-- ── 12.6 Borrar columnas muertas ──────────────────────────────
-- Va al final a proposito: si alguna linea anterior de este mismo
-- fichero las creo, aqui quedan eliminadas igualmente.
ALTER TABLE public.products       DROP COLUMN IF EXISTS "categoryId";
ALTER TABLE public.notificaciones DROP COLUMN IF EXISTS customer_id;
