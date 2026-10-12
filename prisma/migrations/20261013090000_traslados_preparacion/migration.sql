-- Traslados de SAP que salen de la 02: se preparan como las facturas. Un traslado a un almacén de vendedor puede no
-- tener cliente, y el almacén de destino se muestra en la bodega.
ALTER TABLE "pedidos" ALTER COLUMN "cardCode" DROP NOT NULL;
ALTER TABLE "pedidos" ADD COLUMN "almacenDestino" TEXT;
-- Cada fuente en su propio rango de claves: pedidos >= 0, facturas -1 a -1.000.000.000, traslados desde -1.000.000.001.
ALTER TABLE "pedidos" DROP CONSTRAINT "pedidos_identidad_documento";
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_identidad_documento" CHECK (
  ("fuenteDocumento" = 'pedido' AND "docEntry" >= 0 AND "sapDocEntry" = "docEntry") OR
  ("fuenteDocumento" = 'factura' AND "docEntry" < 0 AND "docEntry" > -1000000001 AND "sapDocEntry" = -1 - "docEntry") OR
  ("fuenteDocumento" = 'traslado' AND "docEntry" <= -1000000001 AND "sapDocEntry" = -1000000001 - "docEntry")
);
-- Solo los traslados pueden no tener cliente.
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cliente_requerido" CHECK ("cardCode" IS NOT NULL OR "fuenteDocumento" = 'traslado');
