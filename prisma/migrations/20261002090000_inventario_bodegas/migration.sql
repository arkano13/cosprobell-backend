-- Inventario de dos bodegas (grande por cajas y lotes, pequeña por unidades) y origen de los códigos de barras.
-- Solo agrega columnas y tablas: no modifica datos existentes salvo marcar como 'app' los códigos cargados a mano.

-- AlterTable
ALTER TABLE "productos_codigos_barras" ADD COLUMN     "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'sap',
ADD COLUMN     "registradoPor" TEXT;

-- CreateTable
CREATE TABLE "inventario_productos" (
    "itemCode" TEXT NOT NULL,
    "pequena" INTEGER NOT NULL DEFAULT 0,
    "adelantado" INTEGER NOT NULL DEFAULT 0,
    "sapCambioEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventario_productos_pkey" PRIMARY KEY ("itemCode")
);

-- CreateTable
CREATE TABLE "inventario_cajas" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "lote" TEXT,
    "vencimiento" DATE,
    "suelto" BOOLEAN NOT NULL DEFAULT false,
    "unidadesIniciales" INTEGER NOT NULL,
    "unidades" INTEGER NOT NULL,
    "recibidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recibidaPor" TEXT,

    CONSTRAINT "inventario_cajas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_movimientos" (
    "id" SERIAL NOT NULL,
    "grupo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "bodega" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "cajaId" INTEGER,
    "lote" TEXT,
    "pickingId" INTEGER,
    "descuentoId" INTEGER,
    "observacion" TEXT,
    "hechoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_descuentos" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "unidades" INTEGER NOT NULL,
    "documentos" TEXT,
    "hechoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "corregidoPor" TEXT,
    "corregidoEn" TIMESTAMP(3),
    "anterior" TEXT,

    CONSTRAINT "inventario_descuentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_stock" (
    "tipo" TEXT NOT NULL,
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "comentarios" TEXT,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_stock_pkey" PRIMARY KEY ("tipo","docEntry")
);

-- CreateTable
CREATE TABLE "documentos_stock_lineas" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "docEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "documentos_stock_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventario_cajas_codigo_key" ON "inventario_cajas"("codigo");

-- CreateIndex
CREATE INDEX "inventario_cajas_itemCode_idx" ON "inventario_cajas"("itemCode");

-- CreateIndex
CREATE INDEX "inventario_cajas_vencimiento_idx" ON "inventario_cajas"("vencimiento");

-- CreateIndex
CREATE INDEX "inventario_movimientos_itemCode_creadoEn_idx" ON "inventario_movimientos"("itemCode", "creadoEn");

-- CreateIndex
CREATE INDEX "inventario_movimientos_creadoEn_idx" ON "inventario_movimientos"("creadoEn");

-- CreateIndex
CREATE INDEX "inventario_movimientos_grupo_idx" ON "inventario_movimientos"("grupo");

-- CreateIndex
CREATE INDEX "inventario_movimientos_descuentoId_idx" ON "inventario_movimientos"("descuentoId");

-- CreateIndex
CREATE INDEX "inventario_descuentos_creadoEn_idx" ON "inventario_descuentos"("creadoEn");

-- CreateIndex
CREATE INDEX "documentos_stock_docDate_idx" ON "documentos_stock"("docDate");

-- CreateIndex
CREATE INDEX "documentos_stock_lineas_itemCode_idx" ON "documentos_stock_lineas"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_stock_lineas_tipo_docEntry_lineNum_key" ON "documentos_stock_lineas"("tipo", "docEntry", "lineNum");

-- AddForeignKey
ALTER TABLE "inventario_productos" ADD CONSTRAINT "inventario_productos_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_cajas" ADD CONSTRAINT "inventario_cajas_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "inventario_cajas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_descuentoId_fkey" FOREIGN KEY ("descuentoId") REFERENCES "inventario_descuentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_stock_lineas" ADD CONSTRAINT "documentos_stock_lineas_tipo_docEntry_fkey" FOREIGN KEY ("tipo", "docEntry") REFERENCES "documentos_stock"("tipo", "docEntry") ON DELETE CASCADE ON UPDATE CASCADE;


-- Códigos creados a mano antes de esta versión (sin registro de SAP).
UPDATE "productos_codigos_barras" SET "origen" = 'app' WHERE "sapAbsEntry" IS NULL;

-- Las unidades de una caja nunca quedan negativas.
ALTER TABLE "inventario_cajas" ADD CONSTRAINT "inventario_cajas_unidades_check" CHECK ("unidades" >= 0 AND "unidadesIniciales" > 0);
