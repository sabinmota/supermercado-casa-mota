DROP TABLE IF EXISTS tmp_estado_tel;
CREATE TEMP TABLE tmp_estado_tel (
  columna       text,
  con_dato      bigint,
  sin_formatear bigint,
  estado        text
);

DO $$
DECLARE
  r  record;
  a  bigint;
  b  bigint;
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
      WHERE table_schema = 'public'
        AND table_name  = r.tbl
        AND column_name = r.col
    ) THEN
      EXECUTE format(
        'SELECT count(*),
                count(*) FILTER (WHERE %I <> public.casamota_fmt_phone(%I))
           FROM public.%I
          WHERE %I IS NOT NULL AND btrim(%I) <> %L',
        r.col, r.col, r.tbl, r.col, r.col, ''
      ) INTO a, b;

      INSERT INTO tmp_estado_tel VALUES (
        r.tbl || '.' || r.col,
        a,
        b,
        CASE WHEN b = 0 THEN 'OK' ELSE 'PENDIENTE' END
      );
    ELSE
      INSERT INTO tmp_estado_tel VALUES (
        r.tbl || '.' || r.col,
        0,
        0,
        'NO EXISTE - se omite'
      );
    END IF;
  END LOOP;
END $$;

SELECT columna,
       con_dato::text       AS con_dato,
       sin_formatear::text  AS sin_formatear,
       estado
FROM tmp_estado_tel
ORDER BY columna;
