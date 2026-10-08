-- Códigos de barras de las cajas del proveedor (uno o más por producto).
CREATE TABLE "inventario_codigos_caja" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "registradoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_codigos_caja_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventario_codigos_caja_codigo_key" ON "inventario_codigos_caja"("codigo");
CREATE INDEX "inventario_codigos_caja_itemCode_idx" ON "inventario_codigos_caja"("itemCode");

ALTER TABLE "inventario_codigos_caja" ADD CONSTRAINT "inventario_codigos_caja_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;
