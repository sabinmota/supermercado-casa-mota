DROP SCHEMA IF EXISTS respaldo CASCADE;

SELECT 'respaldo eliminado - ya no se puede deshacer' AS resultado,
       count(*)::text                                 AS esquemas_respaldo_restantes
FROM information_schema.schemata
WHERE schema_name = 'respaldo';
