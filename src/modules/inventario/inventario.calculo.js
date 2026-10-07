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

// Cajas de la grande que pasan a la pequeña por un traspaso de SAP. En la bodega se pasan cajas enteras: se busca la
// combinación de cajas enteras que sume justo lo que pasó SAP, tomando primero las que vencen antes. Si ninguna
// combinación da justo, se toman enteras las que entren (por vencimiento) y lo que falta se saca de una caja más
// (la abierta, si vence igual). cajas: { id, codigo, lote, vencimiento, unidades, unidadesIniciales }.
const MAXIMO_COMBINACION = 5_000_000;
export function repartirTraspaso(cajas, unidades, { lote } = {}) {
  const vence = (c) => (c.vencimiento ? new Date(c.vencimiento).getTime() : Infinity);
  const orden = cajas.filter((c) => c.unidades > 0).sort((a, b) => vence(a) - vence(b) || a.id - b.id);
  const disponibles = orden.reduce((t, c) => t + c.unidades, 0);
  if (disponibles < unidades) throw new AppError({ code: "LOTE_INSUFICIENTE", statusCode: 409,
    message: lote !== undefined ? `El lote ${lote ?? "sin lote"} tiene ${disponibles} unidades en la bodega grande`
      : `La bodega grande tiene ${disponibles} unidades de este producto` });
  const toma = new Map();
  if (orden.length * (unidades + 1) <= MAXIMO_COMBINACION) {
    // alcanza[i][s]: con las cajas desde la i se pueden juntar s unidades en cajas enteras.
    const alcanza = Array.from({ length: orden.length + 1 }, () => new Uint8Array(unidades + 1));
    alcanza[orden.length][0] = 1;
    for (let i = orden.length - 1; i >= 0; i -= 1) {
      const u = orden[i].unidades;
      for (let s = 0; s <= unidades; s += 1) alcanza[i][s] = alcanza[i + 1][s] || (s >= u && alcanza[i + 1][s - u]) ? 1 : 0;
    }
    if (alcanza[0][unidades]) {
      let faltan = unidades;
      orden.forEach((c, i) => {
        if (faltan >= c.unidades && alcanza[i + 1][faltan - c.unidades]) { toma.set(c.id, c.unidades); faltan -= c.unidades; }
      });
    }
  }
  if (!toma.size) {
    let faltan = unidades;
    for (const c of orden) if (c.unidades <= faltan) { toma.set(c.id, c.unidades); faltan -= c.unidades; }
    if (faltan > 0) {
      const resto = orden.filter((c) => !toma.has(c.id));
      const caja = resto.find((c) => c.unidades < c.unidadesIniciales && vence(c) === vence(resto[0])) ?? resto[0];
      toma.set(caja.id, faltan);
    }
  }
  return orden.filter((c) => toma.has(c.id)).map((c) => ({ cajaId: c.id, codigo: c.codigo, lote: c.lote ?? null,
    vencimiento: c.vencimiento ?? null, unidades: toma.get(c.id), entera: toma.get(c.id) === c.unidades }));
}

// Lo que sale de cada lote en un traspaso (para mostrar y aceptar), en el orden de las cajas.
export function lotesDeTraspaso(partes) {
  const lotes = new Map();
  for (const p of partes) {
    const clave = p.lote ?? "";
    if (!lotes.has(clave)) lotes.set(clave, { lote: p.lote, vencimiento: p.vencimiento, unidades: 0, cajas: 0 });
    const l = lotes.get(clave);
    l.unidades += p.unidades; l.cajas += 1;
    if (p.vencimiento && (!l.vencimiento || new Date(p.vencimiento) < new Date(l.vencimiento))) l.vencimiento = p.vencimiento;
  }
  return [...lotes.values()];
}

// Edición del conteo de la grande: qué cajas se anulan y cuáles se crean para que lo registrado quede como dice el
// formulario. Se agrupan por lote, vencimiento, unidades y si es bulto. Dentro de cada grupo se conservan las cajas
// más antiguas, porque sus etiquetas ya están puestas. existentes: cajas sin usar ({ id, lote, vencimiento, unidades,
// suelto }); deseadas: piezas ({ lote, vencimiento "AAAA-MM-DD", unidades, suelto }).
export function editarCajas(existentes, deseadas) {
  const dia = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
  const clave = (c) => JSON.stringify([c.lote ?? null, dia(c.vencimiento), c.unidades, Boolean(c.suelto)]);
  const porClave = new Map();
  for (const c of [...existentes].sort((a, b) => a.id - b.id)) {
    if (!porClave.has(clave(c))) porClave.set(clave(c), []);
    porClave.get(clave(c)).push(c);
  }
  const crear = [];
  for (const p of deseadas) {
    const libres = porClave.get(clave(p));
    if (libres?.length) libres.shift(); else crear.push(p);
  }
  const anular = [...porClave.values()].flat().sort((a, b) => a.id - b.id);
  return { anular, crear };
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
