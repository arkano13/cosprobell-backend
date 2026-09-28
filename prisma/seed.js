import { prisma } from "../src/infrastructure/database/prisma.js";

async function main() {
  console.log("Sembrando datos sinteticos...");

  // --- Catalogos ---
  const grupoBebidas = await prisma.grupoProducto.upsert({
    where: { number: 100 },
    update: {},
    create: { number: 100, groupName: "Bebidas" },
  });
  const grupoAbarrotes = await prisma.grupoProducto.upsert({
    where: { number: 101 },
    update: {},
    create: { number: 101, groupName: "Abarrotes" },
  });

  const bodegaCentral = await prisma.bodega.upsert({
    where: { warehouseCode: "BOD-CENTRAL" },
    update: {},
    create: {
      warehouseCode: "BOD-CENTRAL",
      warehouseName: "Bodega Central",
      city: "San Pedro Sula",
      country: "HN",
    },
  });
  const bodegaSucursal = await prisma.bodega.upsert({
    where: { warehouseCode: "BOD-SUC01" },
    update: {},
    create: {
      warehouseCode: "BOD-SUC01",
      warehouseName: "Sucursal 1",
      city: "San Pedro Sula",
      country: "HN",
    },
  });

  const listaBase = await prisma.listaPrecio.upsert({
    where: { priceListNo: 1 },
    update: {},
    create: { priceListNo: 1, priceListName: "Base", active: true },
  });
  const listaPublico = await prisma.listaPrecio.upsert({
    where: { priceListNo: 3 },
    update: {},
    create: { priceListNo: 3, priceListName: "Publico", active: true },
  });

  await prisma.vendedor.upsert({
    where: { salesEmployeeCode: 1 },
    update: {},
    create: { salesEmployeeCode: 1, salesEmployeeName: "Vendedor Demo 1" },
  });
  await prisma.vendedor.upsert({
    where: { salesEmployeeCode: 2 },
    update: {},
    create: { salesEmployeeCode: 2, salesEmployeeName: "Vendedor Demo 2" },
  });

  // --- Productos ---
  const productosData = [
    { itemCode: "PROD-001", itemName: "Agua embotellada 600ml", grupo: grupoBebidas, precioBase: 12, precioPublico: 15 },
    { itemCode: "PROD-002", itemName: "Refresco cola 2L", grupo: grupoBebidas, precioBase: 35, precioPublico: 42 },
    { itemCode: "PROD-003", itemName: "Arroz 1lb", grupo: grupoAbarrotes, precioBase: 18, precioPublico: 22 },
    { itemCode: "PROD-004", itemName: "Frijol rojo 1lb", grupo: grupoAbarrotes, precioBase: 25, precioPublico: 30 },
    { itemCode: "PROD-005", itemName: "Aceite vegetal 1L", grupo: grupoAbarrotes, precioBase: 55, precioPublico: 65 },
  ];

  for (const p of productosData) {
    await prisma.producto.upsert({
      where: { itemCode: p.itemCode },
      update: {},
      create: {
        itemCode: p.itemCode,
        itemName: p.itemName,
        itemsGroupCode: p.grupo.number,
        valid: true,
        quantityOnStock: 0,
      },
    });

    await prisma.productoPrecio.upsert({
      where: { itemCode_priceListNo: { itemCode: p.itemCode, priceListNo: listaBase.priceListNo } },
      update: { price: p.precioBase },
      create: {
        itemCode: p.itemCode,
        priceListNo: listaBase.priceListNo,
        price: p.precioBase,
        currency: "LPS",
      },
    });
    await prisma.productoPrecio.upsert({
      where: { itemCode_priceListNo: { itemCode: p.itemCode, priceListNo: listaPublico.priceListNo } },
      update: { price: p.precioPublico },
      create: {
        itemCode: p.itemCode,
        priceListNo: listaPublico.priceListNo,
        price: p.precioPublico,
        currency: "LPS",
      },
    });

    await prisma.productoExistencia.upsert({
      where: { itemCode_warehouseCode: { itemCode: p.itemCode, warehouseCode: bodegaCentral.warehouseCode } },
      update: { inStock: 100 },
      create: {
        itemCode: p.itemCode,
        warehouseCode: bodegaCentral.warehouseCode,
        inStock: 100,
        committed: 0,
        ordered: 0,
      },
    });
    await prisma.productoExistencia.upsert({
      where: { itemCode_warehouseCode: { itemCode: p.itemCode, warehouseCode: bodegaSucursal.warehouseCode } },
      update: { inStock: 30 },
      create: {
        itemCode: p.itemCode,
        warehouseCode: bodegaSucursal.warehouseCode,
        inStock: 30,
        committed: 0,
        ordered: 0,
      },
    });
  }

  // --- Clientes ---
  const clientesData = [
    { cardCode: "CLI-001", cardName: "Distribuidora Demo S. de R.L." },
    { cardCode: "CLI-002", cardName: "Comercial Ejemplo" },
    { cardCode: "CLI-003", cardName: "Minimarket Prueba" },
  ];
  for (const c of clientesData) {
    await prisma.cliente.upsert({
      where: { cardCode: c.cardCode },
      update: {},
      create: {
        cardCode: c.cardCode,
        cardName: c.cardName,
        creditLimit: 5000,
        currentAccountBalance: 0,
        valid: true,
      },
    });
  }

  // --- Pedidos (para probar el escaner de picking) ---
  const pedido1 = await prisma.pedido.upsert({
    where: { docEntry: 9001 },
    update: {},
    create: {
      docEntry: 9001,
      docNum: 9001,
      cardCode: "CLI-001",
      docDate: new Date(),
      docTotal: 12 * 10 + 35 * 5,
      documentStatus: "bost_Open",
    },
  });
  await prisma.pedidoLinea.upsert({
    where: { pedidoDocEntry_lineNum: { pedidoDocEntry: pedido1.docEntry, lineNum: 0 } },
    update: {},
    create: {
      pedidoDocEntry: pedido1.docEntry,
      lineNum: 0,
      itemCode: "PROD-001",
      quantity: 10,
      warehouseCode: bodegaCentral.warehouseCode,
    },
  });
  await prisma.pedidoLinea.upsert({
    where: { pedidoDocEntry_lineNum: { pedidoDocEntry: pedido1.docEntry, lineNum: 1 } },
    update: {},
    create: {
      pedidoDocEntry: pedido1.docEntry,
      lineNum: 1,
      itemCode: "PROD-002",
      quantity: 5,
      warehouseCode: bodegaCentral.warehouseCode,
    },
  });

  console.log("Seed completado: 2 grupos, 2 bodegas, 2 listas de precio, 5 productos, 3 clientes, 1 pedido con 2 lineas.");
}

main()
  .catch((err) => {
    console.error("Error corriendo el seed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

    // --- Facturas (para probar reportes y pagos) ---
  const factura1 = await prisma.factura.upsert({
    where: { docEntry: 8001 },
    update: {},
    create: {
      docEntry: 8001,
      docNum: 8001,
      cardCode: "CLI-001",
      docDate: new Date("2026-08-01"),
      docDueDate: new Date("2026-08-31"),
      docTotal: 500,
      documentStatus: "bost_Open",
      paidToDate: 200,
    },
  });
  await prisma.facturaLinea.upsert({
    where: { facturaDocEntry_lineNum: { facturaDocEntry: factura1.docEntry, lineNum: 0 } },
    update: {},
    create: {
      facturaDocEntry: factura1.docEntry,
      lineNum: 0,
      itemCode: "PROD-003",
      quantity: 20,
      price: 18,
      lineTotal: 360,
    },
  });

  const factura2 = await prisma.factura.upsert({
    where: { docEntry: 8002 },
    update: {},
    create: {
      docEntry: 8002,
      docNum: 8002,
      cardCode: "CLI-001",
      docDate: new Date("2026-07-01"),
      docDueDate: new Date("2026-07-31"), // ya vencida, para probar mora
      docTotal: 300,
      documentStatus: "bost_Open",
      paidToDate: 0,
    },
  });

  // --- Pago (aplicado parcialmente a factura1, sin tocar factura2) ---
  const pago1 = await prisma.pago.upsert({
    where: { docEntry: 7001 },
    update: {},
    create: {
      docEntry: 7001,
      docNum: 7001,
      cardCode: "CLI-001",
      docDate: new Date("2026-08-15"),
      cashSum: 200,
    },
  });
  await prisma.pagoFactura.upsert({
    where: { pagoDocEntry_lineNum: { pagoDocEntry: pago1.docEntry, lineNum: 0 } },
    update: {},
    create: {
      pagoDocEntry: pago1.docEntry,
      lineNum: 0,
      facturaDocEntry: factura1.docEntry,
      sumApplied: 200,
    },
  });