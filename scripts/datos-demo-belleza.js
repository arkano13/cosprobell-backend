// Crea un catálogo ficticio de productos de belleza con pedidos abiertos para probar la app de bodega sin SAP.
// No toca los datos de scripts/datos-demo-bodega.js (pedidos 90001 y 90002). Solo para la base de desarrollo o pruebas.
// Uso:
//   node scripts/datos-demo-belleza.js              crea los datos (falla si ya existen)
//   node scripts/datos-demo-belleza.js --reiniciar  borra estos datos, incluidas sus preparaciones, y los vuelve a crear
//   node scripts/datos-demo-belleza.js --refrescar  marca los pedidos como recién llegados de SAP (quita el aviso de más de una hora)
//   node scripts/datos-demo-belleza.js --borrar     borra estos datos, incluidas sus preparaciones
import "dotenv/config";
import { prisma } from "../src/infrastructure/database/prisma.js";

if (process.env.NODE_ENV === "production") {
  console.error("No se ejecuta con NODE_ENV=production: estos datos son ficticios.");
  process.exit(1);
}

const UNIDAD = 900011, CAJA = 900012;
const UNIDAD_CODIGO = "UN-BEL";

const CLIENTES = [
  { cardCode: "DEMO-BEL-C01", cardName: "Salón Luna (demo)" },
  { cardCode: "DEMO-BEL-C02", cardName: "Farmacia Central (demo)" },
  { cardCode: "DEMO-BEL-C03", cardName: "Tienda de Belleza Aurora (demo)" },
  { cardCode: "DEMO-BEL-C04", cardName: "Spa Brisa (demo)" },
];

const PRODUCTOS = [
  { itemCode: "DEMO-BEL-SH01", itemName: "Shampoo hidratante con argán 400 ml" },
  { itemCode: "DEMO-BEL-AC01", itemName: "Acondicionador reparador con keratina 400 ml" },
  { itemCode: "DEMO-BEL-MC01", itemName: "Mascarilla capilar nutritiva 250 g" },
  { itemCode: "DEMO-BEL-CC01", itemName: "Crema corporal de karité 250 ml" },
  { itemCode: "DEMO-BEL-PS01", itemName: "Protector solar FPS 50 120 ml" },
  { itemCode: "DEMO-BEL-LB01", itemName: "Labial mate rojo cereza 3.5 g" },
  { itemCode: "DEMO-BEL-BM01", itemName: "Base de maquillaje tono medio 30 ml" },
  { itemCode: "DEMO-BEL-ES01", itemName: "Esmalte de uñas rosa pastel 12 ml" },
  { itemCode: "DEMO-BEL-AM01", itemName: "Agua micelar desmaquillante 200 ml" },
  { itemCode: "DEMO-BEL-SR01", itemName: "Sérum facial con vitamina C 30 ml" },
  { itemCode: "DEMO-BEL-PF01", itemName: "Perfume floral 50 ml" },
  { itemCode: "DEMO-BEL-JF01", itemName: "Jabón facial de carbón activado 100 g" },
  { itemCode: "DEMO-BEL-TC01", itemName: "Tinte capilar castaño claro" },
];
const nombre = new Map(PRODUCTOS.map((p) => [p.itemCode, p.itemName]));

// EAN-13 de circulación restringida (prefijo 2): no chocan con códigos de productos reales.
function ean13(base12) {
  const suma = [...base12].reduce((total, digito, i) => total + Number(digito) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (suma % 10)) % 10);
}

// estado: "unidad" (confirmado como unidad individual), "caja" (confirmado como no unidad) o null (sin confirmar).
const CODIGOS = [
  ...PRODUCTOS.map((p, i) => ({
    codigo: ean13(`209000000${String(101 + i)}`), itemCode: p.itemCode, uomEntry: UNIDAD, estado: "unidad",
    uso: p.itemCode === "DEMO-BEL-TC01" ? "se rechaza: no está en ningún pedido" : "se acepta",
  })),
  { codigo: ean13("209000000201"), itemCode: "DEMO-BEL-SH01", uomEntry: CAJA, estado: "caja", uso: "se rechaza: es la caja de 6" },
  { codigo: ean13("209000000202"), itemCode: "DEMO-BEL-SR01", uomEntry: UNIDAD, estado: null, uso: "se rechaza: etiqueta nueva sin confirmar" },
];

// Cada línea: [itemCode, cantidad, pendiente, cerrada]. Si no se indica, pendiente = cantidad.
const PEDIDOS = [
  { docEntry: 900101, docNum: 91001, cardCode: "DEMO-BEL-C01", fecha: 0, entrega: 0, nota: "Línea capilar",
    lineas: [["DEMO-BEL-SH01", 6], ["DEMO-BEL-AC01", 6], ["DEMO-BEL-MC01", 3]] },
  { docEntry: 900102, docNum: 91002, cardCode: "DEMO-BEL-C02", fecha: -1, entrega: 0, nota: "Protector con entrega parcial: quedan 4 de 6",
    lineas: [["DEMO-BEL-PS01", 6, 4], ["DEMO-BEL-AM01", 3], ["DEMO-BEL-JF01", 5], ["DEMO-BEL-CC01", 2]] },
  { docEntry: 900103, docNum: 91003, cardCode: "DEMO-BEL-C03", fecha: 0, entrega: 1, nota: "Maquillaje; el perfume ya se entregó",
    lineas: [["DEMO-BEL-LB01", 3], ["DEMO-BEL-BM01", 2], ["DEMO-BEL-ES01", 6], ["DEMO-BEL-PF01", 2, 0, true]] },
  { docEntry: 900104, docNum: 91004, cardCode: "DEMO-BEL-C04", fecha: 0, entrega: 1, nota: "Cuidado facial y corporal",
    lineas: [["DEMO-BEL-SR01", 2], ["DEMO-BEL-CC01", 4], ["DEMO-BEL-JF01", 2], ["DEMO-BEL-PF01", 1]] },
  { docEntry: 900105, docNum: 91005, cardCode: "DEMO-BEL-C02", fecha: 0, entrega: 0, nota: "Pedido rápido de una unidad",
    lineas: [["DEMO-BEL-SH01", 1]] },
  { docEntry: 900106, docNum: 91006, cardCode: "DEMO-BEL-C03", fecha: 0, entrega: 2, nota: "Pedido grande",
    lineas: [["DEMO-BEL-SH01", 12], ["DEMO-BEL-AC01", 12], ["DEMO-BEL-ES01", 30], ["DEMO-BEL-LB01", 8], ["DEMO-BEL-PS01", 6]] },
];

const itemCodes = PRODUCTOS.map((p) => p.itemCode);
const docEntries = PEDIDOS.map((p) => p.docEntry);
const cardCodes = CLIENTES.map((c) => c.cardCode);

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
  await tx.cliente.deleteMany({ where: { cardCode: { in: cardCodes } } });
  await tx.unidadMedida.deleteMany({ where: { absEntry: { in: [UNIDAD, CAJA] } } });
}

function dia(desplazamiento) {
  const hoy = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(hoy.getTime() + desplazamiento * 86_400_000);
}

async function crear(tx) {
  await tx.unidadMedida.createMany({ data: [
    { absEntry: UNIDAD, code: UNIDAD_CODIGO, name: "Unidad (demo belleza)" },
    { absEntry: CAJA, code: "CJ6-BEL", name: "Caja de 6 (demo belleza)" },
  ] });
  await tx.cliente.createMany({ data: CLIENTES });
  await tx.producto.createMany({ data: PRODUCTOS });
  for (const { estado, uso, ...codigo } of CODIGOS) {
    await tx.productoCodigoBarras.create({ data: { ...codigo,
      ...(estado === null ? {} : { confirmacionPicking: { create: {
        esUnidadIndividual: estado === "unidad", itemCodeConfirmado: codigo.itemCode, codigoConfirmado: codigo.codigo,
        uomEntryConfirmado: codigo.uomEntry, confirmadaPor: "datos-demo-belleza", observacion: "Dato ficticio de demostración",
      } } }) } });
  }
  for (const pedido of PEDIDOS) {
    await tx.pedido.create({ data: {
      docEntry: pedido.docEntry, docNum: pedido.docNum, docType: "dDocument_Items", cardCode: pedido.cardCode,
      docDate: dia(pedido.fecha), docDueDate: dia(pedido.entrega), docTotal: 0, documentStatus: "bost_Open",
      cancelled: false, cancelStatus: "csNo", comments: `Pedido ficticio de demostración. ${pedido.nota}`,
      lineas: { create: pedido.lineas.map(([itemCode, cantidad, pendiente = cantidad, cerrada = false], lineNum) => ({
        lineNum, itemCode, itemDescription: nombre.get(itemCode), quantity: cantidad,
        lineStatus: cerrada ? "bost_Close" : "bost_Open", warehouseCode: "01", uomEntry: UNIDAD, uomCode: UNIDAD_CODIGO,
        remainingOpenQuantity: pendiente, inventoryQuantity: cantidad, remainingOpenInventoryQuantity: pendiente,
      })) },
    } });
  }
}

const opcion = process.argv[2];
try {
  if (opcion && !["--reiniciar", "--refrescar", "--borrar"].includes(opcion)) {
    throw new Error("Opción desconocida. Usar --reiniciar, --refrescar o --borrar.");
  }
  if (opcion === "--refrescar") {
    const { count } = await prisma.pedido.updateMany({ where: { docEntry: { in: docEntries } }, data: { sincronizadoEn: new Date() } });
    if (!count) throw new Error("No hay pedidos de belleza. Crearlos con: node scripts/datos-demo-belleza.js");
    console.log(`${count} pedidos marcados como recién llegados de SAP.`);
  } else {
    await prisma.$transaction(async (tx) => {
      if (opcion) await borrar(tx);
      if (opcion === "--borrar") return;
      const existentes = await tx.producto.count({ where: { itemCode: { in: itemCodes } } })
        + await tx.pedido.count({ where: { docEntry: { in: docEntries } } });
      if (existentes) throw new Error("Ya existen los datos de belleza. Usar --reiniciar para volver a crearlos.");
      const ajenos = await tx.productoCodigoBarras.findMany({
        where: { codigo: { in: CODIGOS.map((c) => c.codigo) } }, select: { codigo: true, itemCode: true } });
      if (ajenos.length) {
        throw new Error(`Estos códigos ya pertenecen a otros productos: ${ajenos.map((c) => `${c.codigo} (${c.itemCode})`).join(", ")}`);
      }
      await crear(tx);
    }, { maxWait: 10_000, timeout: 60_000 });
    if (opcion === "--borrar") {
      console.log("Datos de belleza borrados.");
    } else {
      console.log("Pedidos de belleza:");
      for (const p of PEDIDOS) {
        const unidades = p.lineas.reduce((total, [, cantidad, pendiente = cantidad, cerrada]) => total + (cerrada ? 0 : pendiente), 0);
        const cliente = CLIENTES.find((c) => c.cardCode === p.cardCode).cardName;
        console.log(`  ${p.docNum}  ${cliente.padEnd(32)} ${String(unidades).padStart(3)} ${unidades === 1 ? "unidad  " : "unidades"}  ${p.nota}`);
      }
      console.log("Códigos para escanear (o escribir y presionar Enter):");
      for (const c of CODIGOS) console.log(`  ${c.codigo}  ${nombre.get(c.itemCode).padEnd(45)} ${c.uso}`);
    }
  }
} catch (error) {
  console.error("No se pudieron preparar los datos:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}