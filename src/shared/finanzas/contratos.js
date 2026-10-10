import { z } from "zod";

// Importes SAP de seis decimales: nunca Number en el transporte ni en los cálculos.
export const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/);
export const fecha = z.iso.date();
const texto = z.string().max(500).refine(v => !v.includes("\0"));
const entero = z.number().int().min(-2147483648).max(2147483647);
const tipos = { s: texto, i: entero, d: decimal, f: fecha, b: z.enum(["Y", "N", "C"]) };
const campos = especificacion => Object.fromEntries(especificacion.split(/\s+/).filter(Boolean).map(parte => {
  const [nombre, tipo] = parte.split(":");
  return [nombre, tipo.endsWith("?") ? tipos[tipo[0]].nullable() : tipos[tipo]];
}));
const documento = `docEntry:i docNum:i serie:i cardCode:s fecha:f vencimiento:f? fechaDocumento:f? moneda:s
  total:d totalFC:d totalSC:d pagado:d pagadoFC:d pagadoSC:d estado:s cancelado:b vendedor:i condicionPago:i transId:i?`;
const linea = `docEntry:i linea:i cardCode:s fecha:f itemCode:s? descripcion:s? cantidad:d precio:d total:d
  almacen:s? baseTipo:i? baseEntry:i? baseLinea:i?`;
const asiento = `transId:i linea:i cardCode:s fecha:f vencimiento:f? fechaDocumento:f? tipo:s documento:i? referencia:s?
  monedaFC:s? debe:d haber:d debeFC:d haberFC:d debeSC:d haberSC:d`;
const def = (claves, especificacion, extra = {}) => ({ claves, campos: campos(especificacion), ...extra });
export const FINANZAS = {
  empresa: def(["codigo"], "codigo:s monedaLocal:s monedaSistema:s", { snapshot: true }),
  clientes: def(["cardCode"], `cardCode:s nombre:s? activo:b bloqueado:b moneda:s saldo:d saldoFC:d saldoSC:d
    limiteCredito:d vendedor:i condicionPago:i zona:s? ruta:s?`, { snapshot: true }),
  vendedores: def(["codigo"], "codigo:i nombre:s? activo:b", { snapshot: true }),
  condicionesPago: def(["codigo"], "codigo:i nombre:s dias:i meses:i cuotas:i?", { snapshot: true }),
  facturas: def(["docEntry"], documento),
  facturaLineas: def(["docEntry", "linea"], linea),
  cuotas: def(["docEntry", "cuota"], `docEntry:i cuota:i cardCode:s fecha:f vencimiento:f total:d totalFC:d totalSC:d
    pagado:d pagadoFC:d pagadoSC:d estado:s`),
  notasCredito: def(["docEntry"], documento),
  notaCreditoLineas: def(["docEntry", "linea"], linea),
  pagos: def(["docEntry"], `docEntry:i docNum:i serie:i cardCode:s fecha:f moneda:s cancelado:b transId:i?
    total:d totalFC:d totalSC:d efectivo:d transferencia:d cheques:d tarjetas:d sinAplicarOriginal:d`),
  aplicacionesPagos: def(["pagoEntry", "linea"], `pagoEntry:i linea:i cardCode:s fecha:f cancelado:b documento:i tipo:s cuota:i?
    lineaDocumento:i? aplicado:d aplicadoFC:d aplicadoSC:d`),
  conciliaciones: def(["reconNum", "linea"], `reconNum:i linea:i cardCode:s fecha:f cancelado:b cancelacion:i tipoConciliacion:s
    transId:i lineaAsiento:i tipo:s documento:i cuota:i? monedaFC:s? sentido:s aplicado:d aplicadoFC:d aplicadoSC:d`, { snapshot: true }),
  movimientos: def(["transId", "linea"], asiento),
  partidas: def(["transId", "linea"], `${asiento} pendienteDebe:d pendienteHaber:d pendienteDebeFC:d pendienteHaberFC:d
    pendienteDebeSC:d pendienteHaberSC:d`, { snapshot: true }),
};
for (const d of Object.values(FINANZAS)) {
  for (const clave of new Set([...d.claves, ...(d.campos.cardCode ? ["cardCode"] : [])])) {
    if (d.campos[clave].safeParse("").success) d.campos[clave] = d.campos[clave].min(1).max(50);
  }
  d.schema = z.object(d.campos).strict();
}
export const nombresFinanzas = Object.keys(FINANZAS);
export const claveRegistro = (entidad, registro) => JSON.stringify(FINANZAS[entidad].claves.map(k => registro[k]));
export const cursorRegistro = (entidad, registro) => FINANZAS[entidad].claves.map(k => registro[k]);
export function validarCursor(entidad, cursor) {
  const d = FINANZAS[entidad];
  return Array.isArray(cursor) && cursor.length === d.claves.length && cursor.every((v, i) => d.campos[d.claves[i]].safeParse(v).success);
}
export const uuid = z.string().uuid();
export const inicioSchema = z.object({ recorridoId: uuid, empresa: z.string().min(1).max(128),
  desde: fecha, fuente: z.string().regex(/^[a-f0-9]{64}$/), modo: z.enum(["completo", "cambios"]),
  ventana: fecha, monedaLocal: z.string().min(1).max(3), monedaSistema: z.string().min(1).max(3) }).strict();
export const finalSchema = z.object({ recorridoId: uuid, secuencia: entero.nonnegative() }).strict();
export function loteFinanzasSchema(entidad) {
  return z.object({ recorridoId: uuid, secuencia: entero.positive(),
    registros: z.array(FINANZAS[entidad].schema).min(1).max(50) }).strict().refine(lote =>
    new Set(lote.registros.map(r => claveRegistro(entidad, r))).size === lote.registros.length);
}
