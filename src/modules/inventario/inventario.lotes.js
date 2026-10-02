import { inventarioRepository as repo } from "./inventario.repository.js";
import { AppError } from "../../shared/errors/AppError.js";

const error = (code, message) => new AppError({ code, message, statusCode: 409 });
const movimiento = (fila, cantidad) => ({ pequenaLoteId: fila.id, lote: fila.lote, cantidad });

// El llamador mantiene el candado del producto y la transacción del movimiento completo.
export async function retirarLotes(itemCode, unidades, seleccion, tx) {
  const filas = await repo.lotesPequena(itemCode, tx);
  const disponibles = filas.reduce((total, fila) => total + fila.unidades, 0);
  if (disponibles < unidades) throw error("PEQUENA_INSUFICIENTE",
    `${itemCode}: la pequeña tiene ${disponibles} unidades y se necesitan ${unidades}. Primero registrá la reposición desde la grande.`);
  if (!seleccion && filas.length > 1) throw error("LOTES_REQUERIDOS",
    `${itemCode}: indicá los lotes de la pequeña que realmente se están retirando.`);
  const reparto = seleccion ?? [{ pequenaLoteId: filas[0]?.id, unidades }];
  if (!reparto.length || reparto.some(r => !Number.isSafeInteger(r.unidades) || r.unidades <= 0) ||
      new Set(reparto.map(r => r.pequenaLoteId)).size !== reparto.length ||
      reparto.reduce((total, r) => total + r.unidades, 0) !== unidades) {
    throw error("ASIGNACION_LOTES_INVALIDA", "La asignación por lotes debe coincidir con las unidades retiradas y no repetir lotes.");
  }
  for (const r of reparto) {
    const fila = filas.find(f => f.id === r.pequenaLoteId);
    if (!fila || fila.unidades < r.unidades) throw error("LOTE_INSUFICIENTE", `${itemCode}: el lote elegido no tiene suficientes unidades.`);
  }
  const movimientos = [];
  for (const r of reparto) {
    const fila = await repo.cambiarLotePequena(r.pequenaLoteId, itemCode, -r.unidades, tx);
    if (!fila) throw error("LOTE_INSUFICIENTE", "Cambió la existencia del lote. Actualizá la lista.");
    movimientos.push(movimiento(fila, -r.unidades));
  }
  return movimientos;
}

export async function contarLotes(itemCode, unidades, lotes, tx) {
  const anteriores = await repo.lotesPequena(itemCode, tx);
  if (!lotes && anteriores.length > 1) throw error("LOTES_REQUERIDOS", "Contá por lote para conservar la trazabilidad de la pequeña.");
  const nuevos = lotes ?? [{ lote: anteriores[0]?.lote ?? null, vencimiento: anteriores[0]?.vencimiento ?? null, unidades }];
  if (nuevos.reduce((total, fila) => total + fila.unidades, 0) !== unidades) {
    throw error("ASIGNACION_LOTES_INVALIDA", "La suma de los lotes debe coincidir con el conteo total.");
  }
  const cambios = [];
  for (const fila of anteriores) {
    await repo.cambiarLotePequena(fila.id, itemCode, -fila.unidades, tx);
    cambios.push(movimiento(fila, -fila.unidades));
  }
  for (const lote of nuevos) {
    if (!lote.unidades) continue;
    const fila = await repo.sumarLotePequena(itemCode, lote.lote, lote.vencimiento, lote.unidades, tx);
    cambios.push(movimiento(fila, lote.unidades));
  }
  const netos = new Map();
  for (const m of cambios) {
    const anterior = netos.get(m.pequenaLoteId);
    netos.set(m.pequenaLoteId, { ...m, cantidad: m.cantidad + (anterior?.cantidad ?? 0) });
  }
  return [...netos.values()].filter(m => m.cantidad !== 0);
}
