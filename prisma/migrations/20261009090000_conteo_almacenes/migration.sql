-- Conteo de los almacenes "solo conteo" (la 03 y la 04): se cuentan y se comparan con SAP, sin movimientos.
CREATE TABLE "inventario_conteos_almacen" (
    "almacen" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "unidades" INTEGER NOT NULL,
    "cajas" INTEGER NOT NULL DEFAULT 0,
    "contadoPor" TEXT,
    "contadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPor" TEXT,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_conteos_almacen_pkey" PRIMARY KEY ("almacen","itemCode"),
    CONSTRAINT "inventario_conteos_almacen_unidades_check" CHECK ("unidades" >= 0 AND "cajas" >= 0)
);

CREATE TABLE "inventario_conteos_almacen_lineas" (
    "id" SERIAL NOT NULL,
    "almacen" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "lote" TEXT,
    "vencimiento" DATE,
    "cajas" INTEGER,
    "unidadesPorCaja" INTEGER,
    "unidades" INTEGER NOT NULL,

    CONSTRAINT "inventario_conteos_almacen_lineas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventario_conteos_almacen_lineas_unidades_check" CHECK ("unidades" > 0 AND ("cajas" IS NULL OR ("cajas" > 0 AND "unidadesPorCaja" > 0)))
);

CREATE INDEX "inventario_conteos_almacen_lineas_almacen_itemCode_idx" ON "inventario_conteos_almacen_lineas"("almacen", "itemCode");

ALTER TABLE "inventario_conteos_almacen" ADD CONSTRAINT "inventario_conteos_almacen_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventario_conteos_almacen_lineas" ADD CONSTRAINT "inventario_conteos_almacen_lineas_almacen_itemCode_fkey" FOREIGN KEY ("almacen", "itemCode") REFERENCES "inventario_conteos_almacen"("almacen", "itemCode") ON DELETE CASCADE ON UPDATE CASCADE;
