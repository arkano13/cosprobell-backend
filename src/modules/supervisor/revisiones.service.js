// Preparaciones que necesitan la atención del supervisor.
import { prisma } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { comprobarPedidoElegible, lineasParaPreparar } from "../picking/picking.pedido.js";
import { pickingRepository } from "../picking/picking.repository.js";

export const HORAS_SIN_ENTREGA = 24;
const LIMITE = 100;

export const revisionesRepository = {
  enRevision() {
    return prisma.pickingPedido.findMany({ where: { estado: "requiere_revision" }, include: { lineas: true }, orderBy: { id: "asc" }, take: LIMITE });
  },
  // Preparaciones terminadas de pedidos que SAP todavía tiene abiertos (aún no se registró la entrega).
  async finalizadasAbiertas() {
    const filas = await prisma.$queryRaw`
      SELECT pp.id FROM picking_pedidos pp
      JOIN pedidos p ON p."docEntry" = pp."pedidoDocEntry"
      WHERE pp.estado IN ('completo', 'con_diferencias') AND p."documentStatus" = 'bost_Open' AND p.cancelled = false
      ORDER BY pp."fechaFin" ASC NULLS LAST, pp.id ASC LIMIT ${LIMITE * 2}`;
    if (!filas.length) return [];
    return prisma.pickingPedido.findMany({ where: { id: { in: filas.map((f) => f.id) } }, include: { lineas: true } });
  },
  pedidos(docEntries) {
    return prisma.pedido.findMany({ where: { docEntry: { in: docEntries } },
      include: { cliente: { select: { cardName: true } }, lineas: true } });
  },
  nombresProductos(itemCodes) {
    return prisma.producto.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, itemName: true } });
  },
};

const sumar = (lineas, valor) => lineas.reduce((total, l) => total + valor(l), 0);
const unidades = (lineas) => ({
  unidadesPreparadas: sumar(lineas, (l) => Math.min(l.cantidadEscaneada, l.cantidadPedida)),
  unidadesPedidas: sumar(lineas, (l) => l.cantidadPedida),
});

// Qué cambió entre lo que se estaba preparando y lo que hoy pide el pedido, línea por línea.
function diferencias(lineasSesion, lineasActuales) {
  const antes = new Map(lineasSesion.map((l) => [l.pedidoLineNum, l]));
  const ahora = new Map(lineasActuales.map((l) => [l.pedidoLineNum, l]));
  const cambios = [];
  for (const lineNum of [...new Set([...antes.keys(), ...ahora.keys()])].sort((a, b) => a - b)) {
    const a = antes.get(lineNum), b = ahora.get(lineNum);
    if (a && b && a.itemCode === b.itemCode && a.cantidadPedida === b.cantidadPedida && a.uomEntry === b.uomEntry) continue;
    if (a && b && a.itemCode !== b.itemCode) {
      cambios.push({ itemCode: a.itemCode, antes: a.cantidadPedida, ahora: null });
      cambios.push({ itemCode: b.itemCode, antes: null, ahora: b.cantidadPedida });
      continue;
    }
    cambios.push({ itemCode: (a ?? b).itemCode, antes: a?.cantidadPedida ?? null, ahora: b?.cantidadPedida ?? null,
      ...(a && b && a.uomEntry !== b.uomEntry ? { cambioUnidad: true } : {}) });
  }
  return cambios;
}

function revisar(sesion, pedido) {
  if (!pedido) return { motivo: "PEDIDO_NO_ENCONTRADO", mensaje: "El pedido ya no está en los datos de SAP", cambios: [], pedidoAbierto: false };
  try {
    comprobarPedidoElegible(pedido);
    const cambios = diferencias(sesion.lineas, lineasParaPreparar(pedido));
    return { motivo: cambios.length ? "CAMBIOS_EN_SAP" : "SIN_CAMBIOS", mensaje: null, cambios, pedidoAbierto: true };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const abierto = pedido.documentStatus === "bost_Open" && pedido.cancelled === false;
    return { motivo: error.code, mensaje: error.message, cambios: [], pedidoAbierto: abierto };
  }
}

const datosPedido = (pedido, docEntry) => ({ docEntry, docNum: pedido?.docNum ?? null, cliente: pedido?.cliente?.cardName ?? pedido?.cardCode ?? null });

export async function listarRevisiones({ repo = revisionesRepository, ahora = new Date() } = {}) {
  const [enRevision, finalizadas] = await Promise.all([repo.enRevision(), repo.finalizadasAbiertas()]);
  const docEntries = [...new Set([...enRevision, ...finalizadas].map((s) => s.pedidoDocEntry))];
  const pedidos = new Map((docEntries.length ? await repo.pedidos(docEntries) : []).map((p) => [p.docEntry, p]));
  const revisiones = enRevision.map((s) => ({ pickingId: s.id, pedido: datosPedido(pedidos.get(s.pedidoDocEntry), s.pedidoDocEntry),
    operador: s.usuarioId, fechaInicio: s.fechaInicio, ...unidades(s.lineas), ...revisar(s, pedidos.get(s.pedidoDocEntry)) }));

  const itemCodes = [...new Set(revisiones.flatMap((r) => r.cambios.map((c) => c.itemCode)))];
  const nombres = new Map((itemCodes.length ? await repo.nombresProductos(itemCodes) : []).map((p) => [p.itemCode, p.itemName]));
  for (const r of revisiones) for (const c of r.cambios) c.itemName = nombres.get(c.itemCode) ?? null;

  const conDiferencias = [], sinEntrega = [];
  for (const s of finalizadas.sort((a, b) => (b.fechaFin ?? 0) - (a.fechaFin ?? 0))) {
    const fila = { pickingId: s.id, pedido: datosPedido(pedidos.get(s.pedidoDocEntry), s.pedidoDocEntry), estado: s.estado,
      operador: s.usuarioId, fechaFin: s.fechaFin, ...unidades(s.lineas) };
    const horas = s.fechaFin ? Math.floor((ahora - s.fechaFin) / 3_600_000) : 0;
    if (horas >= HORAS_SIN_ENTREGA) sinEntrega.push({ ...fila, horasSinEntrega: horas });
    else if (s.estado === "con_diferencias") conDiferencias.push(fila);
  }
  return { enRevision: revisiones, conDiferencias: conDiferencias.slice(0, LIMITE), sinEntrega: sinEntrega.slice(0, LIMITE) };
}

// El supervisor anula una preparación en revisión: queda en el historial con sus lecturas y el pedido se
// puede volver a preparar con los datos actuales de SAP.
export async function anularRevision(pickingId, { picking = pickingRepository, ahora = () => new Date() } = {}) {
  const sesion = await prisma.pickingPedido.findUnique({ where: { id: pickingId }, select: { pedidoDocEntry: true } });
  if (!sesion) throw new AppError({ code: "PICKING_NO_ENCONTRADO", message: "Preparación no encontrada", statusCode: 404 });
  return picking.conPedidoBloqueado(sesion.pedidoDocEntry, async (tx) => {
    const sesiones = await picking.buscarSesionesDelPedido(sesion.pedidoDocEntry, tx);
    const actual = sesiones.find((s) => s.id === pickingId);
    if (actual?.estado !== "requiere_revision") {
      throw new AppError({ code: "PICKING_NO_EN_REVISION", message: "Esa preparación ya no está en revisión", statusCode: 409 });
    }
    await tx.pickingPedido.update({ where: { id: pickingId }, data: { estado: "anulada", fechaFin: ahora() } });
    return { pickingId, estado: "anulada" };
  });
}
