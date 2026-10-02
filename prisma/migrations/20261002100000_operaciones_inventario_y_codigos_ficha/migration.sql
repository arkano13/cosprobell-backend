CREATE TABLE "inventario_operaciones" (
  "id" UUID PRIMARY KEY,
  "hash" TEXT NOT NULL,
  "respuesta" JSONB NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Completar asociaciones de fichas ya sincronizadas: no confirmar etiquetas automáticamente.
-- Solo códigos válidos y sin asociación activa equivalente; conserva registros existentes.
INSERT INTO productos_codigos_barras
  ("itemCode", codigo, "uomEntry", origen, "sincronizadoEn", "retiradoEnSap")
SELECT p."itemCode", p."barCode", -1, 'ficha', now(), false
FROM productos p
WHERE p."barCode" IS NOT NULL AND length(p."barCode") BETWEEN 1 AND 254
  AND p."barCode" = btrim(p."barCode")
  AND NOT EXISTS (
    SELECT 1 FROM productos_codigos_barras c
    WHERE c."itemCode" = p."itemCode" AND c.codigo = p."barCode" AND NOT c."retiradoEnSap"
  );
