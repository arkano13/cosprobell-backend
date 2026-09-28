-- CreateTable
CREATE TABLE "grupos_productos" (
    "number" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,

    CONSTRAINT "grupos_productos_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "bodegas" (
    "warehouseCode" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "inactive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bodegas_pkey" PRIMARY KEY ("warehouseCode")
);

-- CreateTable
CREATE TABLE "listas_precios" (
    "priceListNo" INTEGER NOT NULL,
    "priceListName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isGrossPrice" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "listas_precios_pkey" PRIMARY KEY ("priceListNo")
);

-- CreateTable
CREATE TABLE "vendedores" (
    "salesEmployeeCode" INTEGER NOT NULL,
    "salesEmployeeName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vendedores_pkey" PRIMARY KEY ("salesEmployeeCode")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "cardCode" TEXT NOT NULL,
    "cardName" TEXT,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("cardCode")
);

-- CreateTable
CREATE TABLE "productos" (
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemsGroupCode" INTEGER,
    "barCode" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "quantityOnStock" DOUBLE PRECISION,
    "quantityOrderedFromVendors" DOUBLE PRECISION,
    "quantityOrderedByCustomers" DOUBLE PRECISION,
    "sapCreateDate" TIMESTAMP(3),
    "sapUpdateDate" TIMESTAMP(3),
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("itemCode")
);

-- CreateTable
CREATE TABLE "productos_precios" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "priceListNo" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "factor" DOUBLE PRECISION,

    CONSTRAINT "productos_precios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_existencias" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "inStock" DOUBLE PRECISION NOT NULL,
    "committed" DOUBLE PRECISION NOT NULL,
    "ordered" DOUBLE PRECISION NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productos_existencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_codigos_barras" (
    "id" SERIAL NOT NULL,
    "itemCode" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,

    CONSTRAINT "productos_codigos_barras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "cardCode" TEXT NOT NULL,
    "cardName" TEXT NOT NULL,
    "cardType" TEXT,
    "groupCode" INTEGER,
    "creditLimit" DOUBLE PRECISION,
    "currentAccountBalance" DOUBLE PRECISION,
    "openDeliveryNotesBalance" DOUBLE PRECISION,
    "openOrdersBalance" DOUBLE PRECISION,
    "openChecksBalance" DOUBLE PRECISION,
    "priceListNum" INTEGER,
    "payTermsGrpCode" INTEGER,
    "salesPersonCode" INTEGER,
    "currency" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "phone1" TEXT,
    "cellular" TEXT,
    "emailAddress" TEXT,
    "city" TEXT,
    "country" TEXT,
    "uRtn" TEXT,
    "uTipoCliente" TEXT,
    "uZona" TEXT,
    "uMuniList" TEXT,
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("cardCode")
);

-- CreateTable
CREATE TABLE "facturas" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "docType" TEXT,
    "cardCode" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "docDueDate" TIMESTAMP(3),
    "taxDate" TIMESTAMP(3),
    "docTotal" DOUBLE PRECISION NOT NULL,
    "docCurrency" TEXT,
    "docRate" DOUBLE PRECISION,
    "vatSum" DOUBLE PRECISION,
    "totalDiscount" DOUBLE PRECISION,
    "documentStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelStatus" TEXT,
    "salesPersonCode" INTEGER,
    "comments" TEXT,
    "reference1" TEXT,
    "paidToDate" DOUBLE PRECISION,
    "uTipo" TEXT,
    "uTipoFactura" TEXT,
    "uZona" TEXT,
    "uRtn" TEXT,
    "uCredito" TEXT,
    "uCai" TEXT,
    "uGira" TEXT,
    "uCodigo" TEXT,
    "sapCreationDate" TIMESTAMP(3),
    "sapUpdateDate" TIMESTAMP(3),
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "facturas_lineas" (
    "id" SERIAL NOT NULL,
    "facturaDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "discountPercent" DOUBLE PRECISION,
    "warehouseCode" TEXT,
    "lineTotal" DOUBLE PRECISION,
    "taxTotal" DOUBLE PRECISION,
    "totalInclTax" DOUBLE PRECISION,
    "baseType" INTEGER,
    "baseEntry" INTEGER,
    "baseLine" INTEGER,
    "lineStatus" TEXT,

    CONSTRAINT "facturas_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "docType" TEXT,
    "cardCode" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "docDueDate" TIMESTAMP(3),
    "taxDate" TIMESTAMP(3),
    "docTotal" DOUBLE PRECISION NOT NULL,
    "docCurrency" TEXT,
    "docRate" DOUBLE PRECISION,
    "vatSum" DOUBLE PRECISION,
    "totalDiscount" DOUBLE PRECISION,
    "documentStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelStatus" TEXT,
    "salesPersonCode" INTEGER,
    "comments" TEXT,
    "reference1" TEXT,
    "uTipo" TEXT,
    "uZona" TEXT,
    "sapCreationDate" TIMESTAMP(3),
    "sapUpdateDate" TIMESTAMP(3),
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "pedidos_lineas" (
    "id" SERIAL NOT NULL,
    "pedidoDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "discountPercent" DOUBLE PRECISION,
    "warehouseCode" TEXT,
    "lineTotal" DOUBLE PRECISION,
    "lineStatus" TEXT,

    CONSTRAINT "pedidos_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entregas" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "docType" TEXT,
    "cardCode" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "docDueDate" TIMESTAMP(3),
    "taxDate" TIMESTAMP(3),
    "docTotal" DOUBLE PRECISION NOT NULL,
    "docCurrency" TEXT,
    "documentStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "salesPersonCode" INTEGER,
    "comments" TEXT,
    "reference1" TEXT,
    "uTipo" TEXT,
    "uZona" TEXT,
    "sapCreationDate" TIMESTAMP(3),
    "sapUpdateDate" TIMESTAMP(3),
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entregas_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "entregas_lineas" (
    "id" SERIAL NOT NULL,
    "entregaDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "warehouseCode" TEXT,
    "lineTotal" DOUBLE PRECISION,
    "baseType" INTEGER,
    "baseEntry" INTEGER,
    "baseLine" INTEGER,
    "lineStatus" TEXT,

    CONSTRAINT "entregas_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_credito" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "docType" TEXT,
    "cardCode" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "docTotal" DOUBLE PRECISION NOT NULL,
    "docCurrency" TEXT,
    "documentStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "salesPersonCode" INTEGER,
    "comments" TEXT,
    "reference1" TEXT,
    "uTipo" TEXT,
    "uZona" TEXT,
    "facturaBaseEntry" INTEGER,
    "sapCreationDate" TIMESTAMP(3),
    "sapUpdateDate" TIMESTAMP(3),
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notas_credito_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "notas_credito_lineas" (
    "id" SERIAL NOT NULL,
    "notaCreditoDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemDescription" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "warehouseCode" TEXT,
    "lineTotal" DOUBLE PRECISION,
    "baseType" INTEGER,
    "baseEntry" INTEGER,
    "baseLine" INTEGER,

    CONSTRAINT "notas_credito_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER,
    "cardCode" TEXT,
    "docDate" TIMESTAMP(3) NOT NULL,
    "docCurrency" TEXT,
    "cashSum" DOUBLE PRECISION,
    "transferSum" DOUBLE PRECISION,
    "reference1" TEXT,
    "remarks" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "uVendedor" TEXT,
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "pagos_facturas" (
    "id" SERIAL NOT NULL,
    "pagoDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "facturaDocEntry" INTEGER NOT NULL,
    "sumApplied" DOUBLE PRECISION NOT NULL,
    "invoiceType" TEXT,
    "docLine" INTEGER,
    "installmentId" INTEGER,

    CONSTRAINT "pagos_facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas_mercancias" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "cardCode" TEXT,
    "docDate" TIMESTAMP(3) NOT NULL,
    "docTotal" DOUBLE PRECISION,
    "docCurrency" TEXT,
    "documentStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "uTipo" TEXT,
    "uZona" TEXT,
    "sapUpdateDate" TIMESTAMP(3),
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entradas_mercancias_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "entradas_mercancias_lineas" (
    "id" SERIAL NOT NULL,
    "entradaDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "warehouseCode" TEXT,
    "baseType" INTEGER,
    "baseEntry" INTEGER,
    "baseLine" INTEGER,
    "price" DOUBLE PRECISION,
    "lineTotal" DOUBLE PRECISION,

    CONSTRAINT "entradas_mercancias_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traslados_inventario" (
    "docEntry" INTEGER NOT NULL,
    "docNum" INTEGER NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "fromWarehouse" TEXT,
    "toWarehouse" TEXT,
    "reference1" TEXT,
    "documentStatus" TEXT,
    "uTipo" TEXT,
    "uZona" TEXT,
    "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traslados_inventario_pkey" PRIMARY KEY ("docEntry")
);

-- CreateTable
CREATE TABLE "traslados_inventario_lineas" (
    "id" SERIAL NOT NULL,
    "trasladoDocEntry" INTEGER NOT NULL,
    "lineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "fromWarehouseCode" TEXT,
    "warehouseCode" TEXT,
    "baseType" TEXT,
    "baseEntry" INTEGER,
    "baseLine" INTEGER,
    "uoMCode" TEXT,

    CONSTRAINT "traslados_inventario_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sincronizaciones" (
    "id" SERIAL NOT NULL,
    "entidad" TEXT NOT NULL,
    "cursor" TEXT,
    "ultimaEjecucion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL,

    CONSTRAINT "sincronizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sincronizaciones_lotes" (
    "id" SERIAL NOT NULL,
    "sincronizacionId" INTEGER NOT NULL,
    "loteId" TEXT NOT NULL,
    "cantidadRegistros" INTEGER NOT NULL,
    "resultado" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sincronizaciones_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "errores_sincronizacion" (
    "id" SERIAL NOT NULL,
    "entidad" TEXT NOT NULL,
    "loteId" TEXT,
    "mensaje" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "errores_sincronizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" SERIAL NOT NULL,
    "entidad" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "usuario" TEXT,
    "detalle" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picking_pedidos" (
    "id" SERIAL NOT NULL,
    "pedidoDocEntry" INTEGER NOT NULL,
    "usuarioId" TEXT,
    "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaFin" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'en_proceso',

    CONSTRAINT "picking_pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picking_pedidos_lineas" (
    "id" SERIAL NOT NULL,
    "pickingId" INTEGER NOT NULL,
    "pedidoLineNum" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "cantidadPedida" DOUBLE PRECISION NOT NULL,
    "cantidadEscaneada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codigoBarrasEscaneado" TEXT,
    "timestampEscaneo" TIMESTAMP(3),

    CONSTRAINT "picking_pedidos_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "productos_precios_itemCode_priceListNo_key" ON "productos_precios"("itemCode", "priceListNo");

-- CreateIndex
CREATE UNIQUE INDEX "productos_existencias_itemCode_warehouseCode_key" ON "productos_existencias"("itemCode", "warehouseCode");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_lineas_facturaDocEntry_lineNum_key" ON "facturas_lineas"("facturaDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_lineas_pedidoDocEntry_lineNum_key" ON "pedidos_lineas"("pedidoDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "entregas_lineas_entregaDocEntry_lineNum_key" ON "entregas_lineas"("entregaDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "notas_credito_lineas_notaCreditoDocEntry_lineNum_key" ON "notas_credito_lineas"("notaCreditoDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_facturas_pagoDocEntry_lineNum_key" ON "pagos_facturas"("pagoDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "entradas_mercancias_lineas_entradaDocEntry_lineNum_key" ON "entradas_mercancias_lineas"("entradaDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "traslados_inventario_lineas_trasladoDocEntry_lineNum_key" ON "traslados_inventario_lineas"("trasladoDocEntry", "lineNum");

-- CreateIndex
CREATE UNIQUE INDEX "sincronizaciones_lotes_loteId_key" ON "sincronizaciones_lotes"("loteId");

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_itemsGroupCode_fkey" FOREIGN KEY ("itemsGroupCode") REFERENCES "grupos_productos"("number") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_precios" ADD CONSTRAINT "productos_precios_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_precios" ADD CONSTRAINT "productos_precios_priceListNo_fkey" FOREIGN KEY ("priceListNo") REFERENCES "listas_precios"("priceListNo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_existencias" ADD CONSTRAINT "productos_existencias_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_existencias" ADD CONSTRAINT "productos_existencias_warehouseCode_fkey" FOREIGN KEY ("warehouseCode") REFERENCES "bodegas"("warehouseCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_codigos_barras" ADD CONSTRAINT "productos_codigos_barras_itemCode_fkey" FOREIGN KEY ("itemCode") REFERENCES "productos"("itemCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "clientes"("cardCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas_lineas" ADD CONSTRAINT "facturas_lineas_facturaDocEntry_fkey" FOREIGN KEY ("facturaDocEntry") REFERENCES "facturas"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "clientes"("cardCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_lineas" ADD CONSTRAINT "pedidos_lineas_pedidoDocEntry_fkey" FOREIGN KEY ("pedidoDocEntry") REFERENCES "pedidos"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "clientes"("cardCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas_lineas" ADD CONSTRAINT "entregas_lineas_entregaDocEntry_fkey" FOREIGN KEY ("entregaDocEntry") REFERENCES "entregas"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_credito" ADD CONSTRAINT "notas_credito_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "clientes"("cardCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_credito" ADD CONSTRAINT "notas_credito_facturaBaseEntry_fkey" FOREIGN KEY ("facturaBaseEntry") REFERENCES "facturas"("docEntry") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_credito_lineas" ADD CONSTRAINT "notas_credito_lineas_notaCreditoDocEntry_fkey" FOREIGN KEY ("notaCreditoDocEntry") REFERENCES "notas_credito"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "clientes"("cardCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_facturas" ADD CONSTRAINT "pagos_facturas_pagoDocEntry_fkey" FOREIGN KEY ("pagoDocEntry") REFERENCES "pagos"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_facturas" ADD CONSTRAINT "pagos_facturas_facturaDocEntry_fkey" FOREIGN KEY ("facturaDocEntry") REFERENCES "facturas"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_mercancias" ADD CONSTRAINT "entradas_mercancias_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "proveedores"("cardCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_mercancias_lineas" ADD CONSTRAINT "entradas_mercancias_lineas_entradaDocEntry_fkey" FOREIGN KEY ("entradaDocEntry") REFERENCES "entradas_mercancias"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traslados_inventario_lineas" ADD CONSTRAINT "traslados_inventario_lineas_trasladoDocEntry_fkey" FOREIGN KEY ("trasladoDocEntry") REFERENCES "traslados_inventario"("docEntry") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sincronizaciones_lotes" ADD CONSTRAINT "sincronizaciones_lotes_sincronizacionId_fkey" FOREIGN KEY ("sincronizacionId") REFERENCES "sincronizaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picking_pedidos_lineas" ADD CONSTRAINT "picking_pedidos_lineas_pickingId_fkey" FOREIGN KEY ("pickingId") REFERENCES "picking_pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
