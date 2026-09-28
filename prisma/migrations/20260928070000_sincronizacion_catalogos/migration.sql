-- AlterTable
ALTER TABLE "productos_codigos_barras" ADD COLUMN     "uomEntry" INTEGER;

-- CreateIndex
CREATE INDEX "productos_codigos_barras_codigo_idx" ON "productos_codigos_barras"("codigo");

-- CreateIndex
CREATE INDEX "productos_codigos_barras_itemCode_idx" ON "productos_codigos_barras"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "sincronizaciones_entidad_key" ON "sincronizaciones"("entidad");

