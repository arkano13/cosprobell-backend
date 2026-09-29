-- Códigos de barras sincronizados desde BarCodes de SAP.
-- Aditiva: no borra filas ni confirmaciones. El índice único sobre "sapAbsEntry" fallará si ya
-- existen filas repetidas con el mismo AbsEntry (las filas sin AbsEntry no cuentan: NULL no se repite).
-- Comprobar antes:  SELECT "sapAbsEntry", count(*) FROM productos_codigos_barras
--                   WHERE "sapAbsEntry" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;

-- AlterTable
ALTER TABLE "confirmaciones_etiquetas_picking" ADD COLUMN     "confirmadaPor" TEXT;

-- AlterTable
ALTER TABLE "productos_codigos_barras" ADD COLUMN     "retiradoEnSap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sincronizadoEn" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "productos_codigos_barras_sapAbsEntry_key" ON "productos_codigos_barras"("sapAbsEntry");

-- CreateIndex
CREATE INDEX "productos_codigos_barras_codigo_idx" ON "productos_codigos_barras"("codigo");
