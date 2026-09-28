-- CreateTable
CREATE TABLE "confirmaciones_etiquetas_picking" (
    "codigoBarrasId" INTEGER NOT NULL,
    "esUnidadIndividual" BOOLEAN NOT NULL,
    "itemCodeConfirmado" TEXT NOT NULL,
    "codigoConfirmado" TEXT NOT NULL,
    "uomEntryConfirmado" INTEGER,
    "confirmadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacion" TEXT,

    CONSTRAINT "confirmaciones_etiquetas_picking_pkey" PRIMARY KEY ("codigoBarrasId")
);

-- AddForeignKey
ALTER TABLE "confirmaciones_etiquetas_picking" ADD CONSTRAINT "confirmaciones_etiquetas_picking_codigoBarrasId_fkey" FOREIGN KEY ("codigoBarrasId") REFERENCES "productos_codigos_barras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
