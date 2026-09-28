-- AlterTable
ALTER TABLE "bodegas" ALTER COLUMN "warehouseName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "grupos_productos" ALTER COLUMN "groupName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "productos" ALTER COLUMN "itemName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "productos_codigos_barras" ADD COLUMN     "uomEntry" INTEGER;

-- CreateIndex
CREATE INDEX "productos_codigos_barras_codigo_idx" ON "productos_codigos_barras"("codigo");

-- CreateIndex
CREATE INDEX "productos_codigos_barras_itemCode_idx" ON "productos_codigos_barras"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "sincronizaciones_entidad_key" ON "sincronizaciones"("entidad");

