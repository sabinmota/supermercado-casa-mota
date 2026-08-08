DROP TABLE IF EXISTS tmp_carrusel;

CREATE TEMP TABLE tmp_carrusel (
  orden   int,
  clave   text,
  metrica text,
  valor   text,
  nota    text
);

DO $$
BEGIN
  INSERT INTO tmp_carrusel VALUES
    (1, 'D1', 'Productos con base64 en el carrusel',
     (SELECT count(DISTINCT p.id) FROM products p
      WHERE p.images IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.images) e
                    WHERE e LIKE 'data:%'))::text,
     'Lo que el verificador encontro');

  INSERT INTO tmp_carrusel VALUES
    (2, 'D2', 'Imagenes base64 sueltas en carruseles',
     (SELECT count(*) FROM products p, jsonb_array_elements_text(p.images) e
      WHERE p.images IS NOT NULL AND e LIKE 'data:%')::text,
     'Total de fotos, no de productos');

  INSERT INTO tmp_carrusel VALUES
    (3, 'D3', 'De esos, con image NULL',
     (SELECT count(DISTINCT p.id) FROM products p
      WHERE p.images IS NOT NULL AND p.image IS NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.images) e
                    WHERE e LIKE 'data:%'))::text,
     'Los que la fase 2 no alcanzaba');

  INSERT INTO tmp_carrusel VALUES
    (4, 'D4', 'De esos, con image en el CDN',
     (SELECT count(DISTINCT p.id) FROM products p
      WHERE p.images IS NOT NULL AND p.image LIKE 'http%'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.images) e
                    WHERE e LIKE 'data:%'))::text,
     'Estos si entraban en la fase 2');

  INSERT INTO tmp_carrusel VALUES
    (5, 'D5', 'Peso total del base64 en carruseles',
     (SELECT COALESCE(round(sum(length(e)) / 1024.0 / 1024.0, 2), 0) FROM products p,
      jsonb_array_elements_text(p.images) e
      WHERE p.images IS NOT NULL AND e LIKE 'data:%')::text || ' MB',
     'Lo que sigue viajando en cada consulta');

  INSERT INTO tmp_carrusel VALUES
    (6, 'D6', 'Base64 en la columna image',
     (SELECT count(*) FROM products WHERE image LIKE 'data:%')::text,
     'Deberia seguir en 0');
END $$;

SELECT clave, metrica, valor, nota FROM tmp_carrusel ORDER BY orden;

SELECT
  p.name                                   AS producto,
  CASE WHEN p.image IS NULL THEN 'NULL'
       WHEN p.image LIKE 'data:%' THEN 'base64'
       WHEN p.image LIKE 'http%' THEN 'CDN'
       ELSE 'otro' END                     AS imagen_principal,
  jsonb_array_length(p.images)             AS total_carrusel,
  (SELECT count(*) FROM jsonb_array_elements_text(p.images) e
   WHERE e LIKE 'data:%')                  AS en_base64,
  p.deleted                                AS borrado
FROM products p
WHERE p.images IS NOT NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.images) e
              WHERE e LIKE 'data:%')
ORDER BY p.name;
