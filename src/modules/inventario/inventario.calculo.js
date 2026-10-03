// Reglas del inventario sin acceso a la base (se prueban en tests/unit/inventario.calculo.test.js).
import { AppError } from "../../shared/errors/AppError.js";

// Después de un cambio en SAP (existencias o un pedido preparado que se entregó) se espera este tiempo
// antes de avisar: las existencias y los pedidos llegan en recorridos distintos del puente.
export const MINUTOS_PARA_ESTABILIZAR = 15;

export const codigoCaja = (id) => `CJ-${String(id).padStart(6, "0")}`;

// SAP = grande + pequeña + preparado sin entrega en SAP + diferencia. La diferencia positiva es mercadería
// que SAP tiene y la bodega todavía no ubicó; negativa, lo que SAP ya descontó y la bodega no asignó a un
// lote. Lo recibido en la app antes que SAP ("adelantado") cubre una diferencia negativa hasta que SAP lo registre.
export function clasificar({ sap, grande, pequena, sinEntrega, adelantado = 0, activo, sapCambioEn = null },
  ahora = Date.now(), minutos = MINUTOS_PARA_ESTABILIZAR) {
  const enSap = Math.round(sap ?? 0);
  const base = enSap - grande - pequena - sinEntrega;
  const faltaEnSap = Math.min(adelantado, Math.max(0, -base));
  const diferencia = base + faltaEnSap;
  const cambio = sapCambioEn ? new Date(sapCambioEn).getTime() : null;
  const estable = cambio === null || ahora - cambio >= minutos * 60_000;
  let estado = "al_dia";
  if (diferencia > 0) estado = !activo ? "conteo_inicial" : estable ? "por_ubicar" : "actualizando";
  else if (diferencia < 0) estado = estable ? "por_descontar" : "actualizando";
  return { enSap, diferencia, faltaEnSap, estable, estado };
}

// Traspaso de la 01 a la 02 que SAP ya registró y la bodega todavía no marcó: SAP tiene en el almacén de la 02 más
// que lo que hay en la 02 (más lo preparado sin entregar, que SAP todavía cuenta ahí) y, a la vez, en la 01 menos de
// lo que hay en sus cajas. Es lo menor de las dos diferencias, para no confundirlo con una entrada o una salida.
export function porPasar({ sapGrande, sapPequena, grande, pequena, sinEntrega = 0 }) {
  if (sapGrande === null || sapGrande === undefined || sapPequena === null || sapPequena === undefined) return 0;
  const sobraEnPequena = Math.round(sapPequena) - pequena - sinEntrega;
  const faltaEnGrande = grande - Math.round(sapGrande);
  return Math.max(0, Math.min(sobraEnPequena, faltaEnGrande));
}

// Unidades a restar de las cajas de un lote: primero las abiertas (para no abrir otra), después las
// cerradas en el orden en que se recibieron.
export function repartirEnCajas(cajas, unidades) {
  const orden = [...cajas].filter((c) => c.unidades > 0)
    .sort((a, b) => Number(b.unidades < b.unidadesIniciales) - Number(a.unidades < a.unidadesIniciales) || a.id - b.id);
  const reparto = [];
  let faltan = unidades;
  for (const caja of orden) {
    if (faltan === 0) break;
    const toma = Math.min(caja.unidades, faltan);
    reparto.push({ cajaId: caja.id, codigo: caja.codigo, unidades: toma });
    faltan -= toma;
  }
  if (faltan > 0) throw new AppError({ code: "LOTE_INSUFICIENTE", statusCode: 409,
    message: `El lote solo tiene ${unidades - faltan} unidades en la bodega grande` });
  return reparto;
}

// Una caja del mismo producto que conviene usar antes: abierta, o que vence antes que la escaneada.
export function cajaParaUsarAntes(caja, otras) {
  const vence = (c) => (c.vencimiento ? new Date(c.vencimiento).getTime() : Infinity);
  const candidatas = otras.filter((o) => o.id !== caja.id && o.unidades > 0)
    .filter((o) => vence(o) < vence(caja) || (o.unidades < o.unidadesIniciales && caja.unidades === caja.unidadesIniciales && vence(o) <= vence(caja)));
  candidatas.sort((a, b) => vence(a) - vence(b) || a.unidades - b.unidades);
  return candidatas[0] ?? null;
}

// Texto corto de una asignación ("L2408-090: 100 · pequeña: 4") para el historial.
export function textoAsignacion(asignaciones) {
  return asignaciones.map((a) => `${a.tipo === "pequena" ? "pequeña" : a.lote ?? "sin lote"}: ${a.unidades}`).join(" · ");
}
