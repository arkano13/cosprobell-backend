-- Foto de cuadre al contar o recibir: lo registrado en la bodega frente a lo que SAP tenía en su almacén.
-- Solo agrega una tabla; no cambia datos existentes.
CREATE TABLE "inventario_cuadres" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "bodega" TEXT NOT NULL,
    "almacen" TEXT,
    "accion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "registrado" INTEGER NOT NULL,
    "sap" INTEGER,
    "sinEntrega" INTEGER NOT NULL,
    "diferencia" INTEGER,
    "sapAl" TIMESTAMP(3),
    "primero" BOOLEAN NOT NULL,
    "hechoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_cuadres_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventario_cuadres_itemCode_bodega_creadoEn_idx" ON "inventario_cuadres"("itemCode", "bodega", "creadoEn");
CREATE INDEX "inventario_cuadres_creadoEn_idx" ON "inventario_cuadres"("creadoEn");
