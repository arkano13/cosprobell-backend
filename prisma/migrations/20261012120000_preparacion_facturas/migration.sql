ALTER TABLE "pedidos" ADD COLUMN "fuenteDocumento" TEXT NOT NULL DEFAULT 'pedido';
ALTER TABLE "pedidos" ADD COLUMN "sapDocEntry" INTEGER;
UPDATE "pedidos" SET "sapDocEntry" = "docEntry";
CREATE UNIQUE INDEX "pedidos_fuenteDocumento_sapDocEntry_key" ON "pedidos"("fuenteDocumento", "sapDocEntry");
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_identidad_documento" CHECK (
 ("fuenteDocumento" = 'pedido' AND "docEntry" >= 0 AND "sapDocEntry" = "docEntry") OR
 ("fuenteDocumento" = 'factura' AND "docEntry" < 0 AND "sapDocEntry" = -1 - "docEntry")
);
ALTER TABLE "pedidos_lineas" ADD COLUMN "cantidadCredito" DOUBLE PRECISION NOT NULL DEFAULT 0;
