SELECT o.order_number,
       o.customer,
       o.status,
       o."deliveryType",
       CASE WHEN o."driverId" IS NULL
            THEN 'sin repartidor'
            ELSE coalesce(d.name, 'repartidor no encontrado') END        AS repartidor,
       CASE WHEN o."deliveryType" = 'retiro' AND o."driverId" IS NOT NULL
            THEN 'CONTRADICTORIO - mal'
            WHEN o."deliveryType" = 'retiro'
            THEN 'retiro en tienda - correcto'
            WHEN o."driverId" IS NOT NULL
            THEN 'reparto con repartidor - correcto'
            ELSE 'reparto sin repartidor asignado' END                   AS diagnostico,
       to_char(o.created_at, 'YYYY-MM-DD HH24:MI')                       AS creado
FROM public.orders o
LEFT JOIN public.drivers d ON d.id = o."driverId"
WHERE coalesce(o.deleted, false) = false
ORDER BY o.created_at DESC
LIMIT 20;
