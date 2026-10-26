-- Cancelación de un traslado de la 01 a la 02: qué se decidió al recibirla y qué traslado original cerró.
ALTER TABLE "traslados_entrada" ADD COLUMN "cancelacion" TEXT;
ALTER TABLE "traslados_entrada" ADD COLUMN "cancelaDocEntry" INTEGER;
ALTER TABLE "traslados_entrada" ADD CONSTRAINT "traslados_entrada_cancelacion" CHECK (
  "cancelacion" IS NULL OR "cancelacion" IN ('vinculada', 'ambigua', 'sin_original'));
