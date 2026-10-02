import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "../../src/infrastructure/database/prisma.js";

// Solo para scripts de demostración en la base de pruebas.
// Crea referencias sintéticas y nunca actualiza productos existentes.
export async function conDatosPicking(cantidades, operacion) {
  const sufijo = randomUUID();
  const itemCode = `DEMO-${sufijo}`;
  const otroItemCode = `OTRO-${sufijo}`;
  const codigo = `001-${sufijo}`;
  const cajaCodigo = `CAJA-${sufijo}`;
  const otroCodigo = `OTRO-${sufijo}`;
  const sinConfirmarCodigo = `SIN-CONFIRMAR-${sufijo}`;
  const unidadId = randomInt(1_000_000_000, 2_000_000_000);
  const cajaId = unidadId + 1;

  // Una colisión aborta toda la preparación; no sobrescribe registros.
  const sesionId = await prisma.$transaction(async (tx) => {
    await tx.unidadMedida.createMany({ data: [
      { absEntry: unidadId, code: `UN-${sufijo}`, name: "Unidad individual ficticia" },
      { absEntry: cajaId, code: `CJ-${sufijo}`, name: "Caja ficticia" },
    ] });
    await tx.producto.createMany({ data: [
      { itemCode, itemName: "Shampoo de demostración" },
      { itemCode: otroItemCode, itemName: "Otro producto de demostración" },
    ] });
    const unidades = cantidades.reduce((suma, cantidad) => suma + cantidad, 0);
    await tx.inventarioProducto.create({ data: { itemCode, pequena: unidades } });
    await tx.inventarioPequenaLote.create({ data: { itemCode, clave: JSON.stringify([itemCode, "DEMO", null]), lote: "DEMO", unidades } });
    for (const etiqueta of [
      { itemCode, codigo, uomEntry: unidadId, individual: true },
      { itemCode, codigo: cajaCodigo, uomEntry: cajaId, individual: false },
      { itemCode: otroItemCode, codigo: otroCodigo, uomEntry: unidadId, individual: true },
      { itemCode, codigo: sinConfirmarCodigo, uomEntry: unidadId, individual: null },
    ]) {
      const { individual, ...datos } = etiqueta;
      await tx.productoCodigoBarras.create({ data: {
        ...datos,
        ...(individual === null ? {} : { confirmacionPicking: { create: {
          esUnidadIndividual: individual,
          itemCodeConfirmado: datos.itemCode,
          codigoConfirmado: datos.codigo,
          uomEntryConfirmado: datos.uomEntry,
          observacion: "Dato ficticio creado por script de pruebas",
        } } }),
      } });
    }
    // Sesión sintética; no importa una orden real ni modifica SAP.
    const sesion = await tx.pickingPedido.create({ data: {
      pedidoDocEntry: -1, usuarioId: "demo-picking", estado: "en_proceso",
      lineas: { create: cantidades.map((cantidad, indice) => ({
        pedidoLineNum: indice, itemCode, cantidadPedida: cantidad,
        cantidadEscaneada: 0, uomEntry: unidadId, uomCode: `UN-${sufijo}`,
      })) },
    } });
    return sesion.id;
  }, { maxWait: 10_000, timeout: 20_000 });

  console.log(`Sesión temporal creada: ${sesionId}`);
  try {
    return await operacion({ sesionId, codigo, itemCode, cajaCodigo,
      otroCodigo, sinConfirmarCodigo, unidadId, cajaId });
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.pickingEscaneo.deleteMany({ where: { pickingId: sesionId } });
      await tx.pickingPedidoLinea.deleteMany({ where: { pickingId: sesionId } });
      await tx.pickingPedido.delete({ where: { id: sesionId } });
      const filtro = { itemCode: { in: [itemCode, otroItemCode] } };
      await tx.inventarioMovimiento.deleteMany({ where: filtro });
      await tx.inventarioPequenaLote.deleteMany({ where: filtro });
      await tx.inventarioProducto.deleteMany({ where: filtro });
      const etiquetas = await tx.productoCodigoBarras.findMany({ where: filtro, select: { id: true } });
      await tx.confirmacionEtiquetaPicking.deleteMany({ where: {
        codigoBarrasId: { in: etiquetas.map((etiqueta) => etiqueta.id) },
      } });
      await tx.productoCodigoBarras.deleteMany({ where: filtro });
      await tx.producto.deleteMany({ where: filtro });
      await tx.unidadMedida.deleteMany({ where: { absEntry: { in: [unidadId, cajaId] } } });
    }, { maxWait: 10_000, timeout: 20_000 });
    console.log("Datos temporales eliminados.");
  }
}
