-- AlterTable
ALTER TABLE "pedidos_lineas" ADD COLUMN     "inventoryQuantity" DOUBLE PRECISION,
ADD COLUMN     "remainingOpenInventoryQuantity" DOUBLE PRECISION,
ADD COLUMN     "remainingOpenQuantity" DOUBLE PRECISION,
ADD COLUMN     "uomCode" TEXT,
ADD COLUMN     "uomEntry" INTEGER;

-- AlterTable
ALTER TABLE "productos_codigos_barras" ADD COLUMN     "sapAbsEntry" INTEGER,
ADD COLUMN     "uomEntry" INTEGER;
