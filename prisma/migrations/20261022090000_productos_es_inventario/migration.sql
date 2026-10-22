-- "Artículo de inventario" de SAP (InventoryItem). Un artículo que no lo es (por ejemplo, una promoción 2+1 que solo
-- referencia el precio) no tiene existencia: no se prepara ni se descuenta de la bodega.
ALTER TABLE "productos" ADD COLUMN "esInventario" BOOLEAN NOT NULL DEFAULT true;
