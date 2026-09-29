// Crea datos ficticios para probar la pantalla de bodega sin SAP: un cliente, productos, códigos de barras
// (confirmados, sin confirmar y de caja) y dos pedidos abiertos. Solo para la base de desarrollo o pruebas.
// Uso:
//   node scripts/datos-demo-bodega.js            crea los datos (falla si ya existen)
//   node scripts/datos-demo-bodega.js --reiniciar  borra los datos de demostración y los vuelve a crear
//   node scripts/datos-demo-bodega.js --borrar     borra los datos de demostración, incluidas sus preparaciones
import "dotenv/config";
import { prisma } from "../src/infrastructure/database/prisma.js";

if (process.env.NODE_ENV === "production") {
  console.error("No se ejecuta con NODE_ENV=production: estos datos son ficticios.");
  process.exit(1);
}

const UNIDAD = 900001, CAJA = 900002;
const CLIENTE = "DEMO-CLIENTE";
const PRODUCTOS = [
  { itemCode: "DEMO-SHAMPOO", itemName: "Shampoo demostración 400 ml" },
  { itemCode: "DEMO-JABON", itemName: "Jabón demostración 110 g" },
  { itemCode: "DEMO-CREMA", itemName: "Crema demostración 200 ml" },
  { itemCode: "DEMO-OTRO", itemName: "Producto que no está en el pedido" },
];
// estado: "unidad" (confirmado como unidad individual), "caja" (confirmado como no unidad) o null (sin confirmar).
const CODIGOS = [
  { codigo: "7400000000017", itemCode: "DEMO-SHAMPOO", uomEntry: UNIDAD, estado: "unidad", uso: "shampoo, unidad" },
  { codigo: "7400000000024", itemCode: "DEMO-JABON", uomEntry: UNIDAD, estado: "unidad", uso: "jabón, unidad" },
  { codigo: "7400000000031", itemCode: "DEMO-CREMA", uomEntry: UNIDAD, estado: null, uso: "crema, SIN confirmar (se rechaza)" },
  { codigo: "7400000000048", itemCode: "DEMO-SHAMPOO", uomEntry: CAJA, estado: "caja", uso: "caja de shampoo (se rechaza)" },
  { codigo: "7400000000055", itemCode: "DEMO-OTRO", uomEntry: UNIDAD, estado: "unidad", uso: "producto fuera del pedido (se rechaza)" },
];
const PEDIDOS = [
  { docEntry: 900001, docNum: 90001, lineas: [["DEMO-SHAMPOO", 3], ["DEMO-JABON", 2], ["DEMO-CREMA", 1]] },
  { docEntry: 900002, docNum: 90002, lineas: [["DEMO-JABON", 4]] },
];
const itemCodes = PRODUCTOS.map((p) => p.itemCode);
const docEntries = PEDIDOS.map((p) => p.docEntry);

async function borrar(tx) {
  const sesiones = await tx.pickingPedido.findMany({ where: { pedidoDocEntry: { in: docEntries } }, select: { id: true } });
  const ids = sesiones.map((s) => s.id);
  await tx.pickingEscaneo.deleteMany({ where: { pickingId: { in: ids } } });
  await tx.pickingPedidoLinea.deleteMany({ where: { pickingId: { in: ids } } });
  await tx.pickingPedido.deleteMany({ where: { id: { in: ids } } });
  await tx.pedidoLinea.deleteMany({ where: { pedidoDocEntry: { in: docEntries } } });
  await tx.pedido.deleteMany({ where: { docEntry: { in: docEntries } } });
  const codigos = await tx.productoCodigoBarras.findMany({ where: { itemCode: { in: itemCodes } }, select: { id: true } });
  await tx.confirmacionEtiquetaPicking.deleteMany({ where: { codigoBarrasId: { in: codigos.map((c) => c.id) } } });
  await tx.productoCodigoBarras.deleteMany({ where: { itemCode: { in: itemCodes } } });
  await tx.producto.deleteMany({ where: { itemCode: { in: itemCodes } } });
  await tx.cliente.deleteMany({ where: { cardCode: CLIENTE } });
  await tx.unidadMedida.deleteMany({ where: { absEntry: { in: [UNIDAD, CAJA] } } });
}

async function crear(tx) {
  await tx.unidadMedida.createMany({ data: [
    { absEntry: UNIDAD, code: "UN-DEMO", name: "Unidad (demostración)" },
    { absEntry: CAJA, code: "CJ12-DEMO", name: "Caja de 12 (demostración)" },
  ] });
  await tx.cliente.create({ data: { cardCode: CLIENTE, cardName: "Cliente de demostración" } });
  await tx.producto.createMany({ data: PRODUCTOS });
  for (const { estado, uso, ...codigo } of CODIGOS) {
    await tx.productoCodigoBarras.create({ data: { ...codigo,
      ...(estado === null ? {} : { confirmacionPicking: { create: {
        esUnidadIndividual: estado === "unidad", itemCodeConfirmado: codigo.itemCode, codigoConfirmado: codigo.codigo,
        uomEntryConfirmado: codigo.uomEntry, confirmadaPor: "datos-demo-bodega", observacion: "Dato ficticio de demostración",
      } } }) } });
  }
  const hoy = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  for (const pedido of PEDIDOS) {
    await tx.pedido.create({ data: {
      docEntry: pedido.docEntry, docNum: pedido.docNum, docType: "dDocument_Items", cardCode: CLIENTE,
      docDate: hoy, docDueDate: hoy, docTotal: 0, documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo",
      lineas: { create: pedido.lineas.map(([itemCode, cantidad], lineNum) => ({
        lineNum, itemCode, quantity: cantidad, lineStatus: "bost_Open", warehouseCode: "01", uomEntry: UNIDAD, uomCode: "UN-DEMO",
        remainingOpenQuantity: cantidad, inventoryQuantity: cantidad, remainingOpenInventoryQuantity: cantidad,
      })) },
    } });
  }
}

const opcion = process.argv[2];
try {
  if (opcion && !["--reiniciar", "--borrar"].includes(opcion)) throw new Error("Opción desconocida. Usar --reiniciar o --borrar.");
  await prisma.$transaction(async (tx) => {
    if (opcion) await borrar(tx);
    if (opcion === "--borrar") return;
    const existentes = await tx.producto.count({ where: { itemCode: { in: itemCodes } } })
      + await tx.pedido.count({ where: { docEntry: { in: docEntries } } });
    if (existentes) throw new Error("Ya existen datos de demostración. Usar --reiniciar para volver a crearlos.");
    await crear(tx);
  }, { maxWait: 10_000, timeout: 30_000 });
  if (opcion === "--borrar") {
    console.log("Datos de demostración borrados.");
  } else {
    console.log(`Pedidos de demostración: ${PEDIDOS.map((p) => p.docNum).join(" y ")}.`);
    console.log("Códigos para escanear (o escribir y presionar Enter):");
    for (const c of CODIGOS) console.log(`  ${c.codigo}  ${c.uso}`);
    console.log("Si no tenés una API key para la pantalla: node scripts/crear-api-key.js bodega-demo");
  }
} catch (error) {
  console.error("No se pudieron preparar los datos:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
