-- Combos: listas de materiales de SAP y los productos del combo en las líneas de preparación. Solo agrega.
CREATE TABLE "listas_materiales" (
    "itemCode" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "lineas" JSONB NOT NULL,
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listas_materiales_pkey" PRIMARY KEY ("itemCode")
);

ALTER TABLE "picking_pedidos_lineas" ADD COLUMN "comboItemCode" TEXT;
ALTER TABLE "picking_pedidos_lineas" ADD COLUMN "comboFactor" INTEGER;
