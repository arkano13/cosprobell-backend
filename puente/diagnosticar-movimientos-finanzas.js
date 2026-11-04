// Solo GET del primer asiento: muestra estructura/tipos, sin textos ni importes.
import { join } from "node:path";
import { configurarFinanzas } from "./finanzas.config.js";
import { crearClienteSap } from "./sap.client.js";
import { crearControl } from "./control.js";
import { tomarCandado } from "./candado.js";
import { leerJsonFinancieroGet } from "./finanzas.get.js";

const tipo = v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const tipos = (dato, nombres) => Object.fromEntries(nombres.map(n => [n, tipo(dato[n])]));
let sap, liberar;
try {
  if (process.argv.length !== 2) throw new Error("ARGUMENTOS_INVALIDOS");
  const config = configurarFinanzas(process.env);
  config.control = crearControl(config);
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  sap = crearClienteSap(config);
  const dato = await sap.leerRecursoFinanciero('JournalEntries?$orderby=JdtNum%20asc&$top=1', leerJsonFinancieroGet);
  const asiento = dato.value?.[0];
  if (!asiento) console.log(JSON.stringify({ evento: "diagnostico_movimientos", registros: 0 }));
  else {
    const lineas = asiento.JournalEntryLines;
    console.log(JSON.stringify({ evento: "diagnostico_asiento", id: asiento.JdtNum, campos: Object.keys(asiento),
      tipos: tipos(asiento, ["JdtNum", "ReferenceDate", "TaxDate", "DocumentType", "OriginalJournal", "BaseReference", "JournalEntryLines"]),
      cantidadLineas: Array.isArray(lineas) ? lineas.length : null,
      originalJournal: typeof asiento.OriginalJournal === "number" ? asiento.OriginalJournal : undefined }));
    if (Array.isArray(lineas)) {
      console.log(JSON.stringify({ evento: "diagnostico_identificadores_lineas", invalidos: lineas.map((l,i) => ({ indice:i, tipo:tipo(l.Line_ID) }))
        .filter((l,i) => !Number.isSafeInteger(lineas[i].Line_ID) || lineas[i].Line_ID < 0).slice(0, 5),
        repetidos: new Set(lineas.map(l=>l.Line_ID)).size !== lineas.length }));
      for (const [indice, linea] of lineas.slice(0, 2).entries()) console.log(JSON.stringify({ evento: "diagnostico_linea_asiento", indice,
        campos: Object.keys(linea), tipos: tipos(linea, ["Line_ID", "ShortName", "DueDate", "FCCurrency", "Debit", "Credit", "FCDebit", "FCCredit", "DebitSys", "CreditSys"]) }));
    }
  }
} catch (error) {
  console.log(JSON.stringify({ evento: "diagnostico_movimientos_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
