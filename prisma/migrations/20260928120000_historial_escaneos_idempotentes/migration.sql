-- CreateEnum
CREATE TYPE "ResultadoEscaneoPicking" AS ENUM ('aceptado', 'rechazado');

-- CreateTable
CREATE TABLE "picking_escaneos" (
    "id" SERIAL NOT NULL,
    "pickingId" INTEGER NOT NULL,
    "operacionId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "resultado" "ResultadoEscaneoPicking" NOT NULL,
    "lineaId" INTEGER,
    "itemCode" TEXT,
    "uomEntry" INTEGER,
    "cantidadRegistrada" INTEGER NOT NULL,
    "cantidadAntes" DOUBLE PRECISION,
    "cantidadDespues" DOUBLE PRECISION,
    "httpStatus" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "respuesta" JSONB,
    "aplicacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picking_escaneos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "picking_escaneos_pickingId_id_idx" ON "picking_escaneos"("pickingId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "picking_escaneos_pickingId_operacionId_key" ON "picking_escaneos"("pickingId", "operacionId");

-- AddForeignKey
ALTER TABLE "picking_escaneos" ADD CONSTRAINT "picking_escaneos_pickingId_fkey" FOREIGN KEY ("pickingId") REFERENCES "picking_pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_escaneos" ADD CONSTRAINT "picking_escaneos_lineaId_fkey" FOREIGN KEY ("lineaId") REFERENCES "picking_pedidos_lineas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
