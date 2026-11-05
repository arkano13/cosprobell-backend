import { z } from "zod";
import { FINANZAS, claveRegistro } from "./contratos.js";

export const GRUPOS_FINANCIEROS = {
  empresa: ["empresa"], clientes: ["clientes"], vendedores: ["vendedores"], condicionesPago: ["condicionesPago"],
  facturas: ["facturas", "facturaLineas", "cuotas"], notasCredito: ["notasCredito", "notaCreditoLineas"],
  pagos: ["pagos", "aplicacionesPagos"], movimientos: ["movimientos"],
};
export const entidadesPeriodicas = Object.values(GRUPOS_FINANCIEROS).flat();
const listas = Object.fromEntries(entidadesPeriodicas.map(e => [e, z.array(FINANZAS[e].schema).max(2000).optional()]));
export const actualizacionFinancieraSchema = z.object({
  protocolo: z.literal(1), operacionId: z.string().uuid(), empresa: z.string().min(1).max(128),
  grupo: z.enum(Object.keys(GRUPOS_FINANCIEROS)), monedaLocal: z.string().min(1).max(3), monedaSistema: z.string().min(1).max(3),
  versiones: z.record(z.string(), z.string().uuid()), registros: z.object(listas).strict(),
}).strict().superRefine((d, ctx) => {
  const fallo = () => ctx.addIssue({ code: "custom", message: "Documento financiero incompleto o inconsistente" });
  const esperadas = GRUPOS_FINANCIEROS[d.grupo];
  const permitidas = new Set([...esperadas, ...(d.grupo === "movimientos" ? [] : ["clientes"])]);
  if (Object.keys(d.registros).some(e => !permitidas.has(e)) || esperadas.some(e => !d.registros[e])) return fallo();
  if (Object.keys(d.versiones).length !== Object.keys(d.registros).length || Object.keys(d.registros).some(e => !d.versiones[e])) return fallo();
  if (d.registros.clientes && d.grupo !== "clientes" && d.registros.clientes.length !== 1) return fallo();
  for (const [e, filas] of Object.entries(d.registros)) {
    if (new Set(filas.map(r => claveRegistro(e, r))).size !== filas.length) return fallo();
  }
  const cabecera = d.registros[d.grupo];
  const catalogo = ["clientes", "vendedores", "condicionesPago"].includes(d.grupo);
  if (!cabecera?.length || (catalogo ? cabecera.length > 20 : d.grupo !== "movimientos" && cabecera.length !== 1)) return fallo();
  const id = cabecera[0].docEntry ?? cabecera[0].transId;
  if (d.grupo === "movimientos" && cabecera.some(r => r.transId !== id)) return fallo();
  for (const e of esperadas.slice(1)) {
    if (d.registros[e].some(r => (r.docEntry ?? r.pagoEntry) !== id || r.cardCode !== cabecera[0].cardCode || r.fecha !== cabecera[0].fecha)) return fallo();
  }
  if (d.registros.clientes && d.grupo !== "clientes" && d.registros.clientes[0].cardCode !== cabecera[0].cardCode) fallo();
});

// La versión base identifica las tablas; la revisión invalida páginas de lectura que estaban abiertas.
export const revisionFinanciera = c => c?.configuracion?.periodica?.revision ?? c?.activoId;
