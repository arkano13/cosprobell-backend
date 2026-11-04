// Diagnóstico GET de la primera factura con el mismo alcance del sondeo.
// No escribe estado financiero ni envía datos al backend.
import { join } from "node:path";
import { configurarFinanzas } from "./finanzas.config.js";
import { crearClienteSap } from "./sap.client.js";
import { crearControl } from "./control.js";
import { tomarCandado } from "./candado.js";
import { definicionesGetFinanzas, leerPaginaGet, leerJsonFinancieroGet } from "./finanzas.get.js";

const describir = valor => {
  const texto = String(valor);
  return { tipo: valor === null ? "null" : typeof valor,
    valor: valor == null ? null : texto.length <= 100 && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(texto) ? texto : undefined };
};
let sap, liberar;
try {
  if (process.argv.length !== 2) throw new Error("ARGUMENTOS_INVALIDOS");
  const config = configurarFinanzas(process.env);
  config.control = crearControl(config);
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  sap = crearClienteSap(config);
  const def = definicionesGetFinanzas(config).cuotas;
  const pagina = await leerPaginaGet({ sap, def, config, recorrido: { ventana: config.desde }, tamano: 1 });
  for (const fila of pagina.filas) console.log(JSON.stringify({ evento: "diagnostico_cuota", docEntry: fila.docEntry,
    cuota: fila.cuota, total: describir(fila.total), totalFC: describir(fila.totalFC) }));
  if (pagina.filas.length) {
    const id = pagina.filas[0].docEntry;
    const dato = await sap.leerRecursoFinanciero(`Invoices?$select=DocEntry,DocumentInstallments&$filter=DocEntry%20eq%20${id}&$top=1`, leerJsonFinancieroGet);
    for (const cuota of dato.value?.[0]?.DocumentInstallments ?? []) {
      console.log(JSON.stringify({ evento: "estructura_cuota_sap", docEntry: id, cuota: cuota.InstallmentId,
        campos: Object.keys(cuota), Total: describir(cuota.Total), TotalFC: describir(cuota.TotalFC),
        TotalFc: describir(cuota.TotalFc), TotalSys: describir(cuota.TotalSys) }));
    }
  } else console.log(JSON.stringify({ evento: "diagnostico_cuota", registros: 0 }));
} catch (error) {
  console.log(JSON.stringify({ evento: "diagnostico_cuota_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
