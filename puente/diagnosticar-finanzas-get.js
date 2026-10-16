import { pathToFileURL } from "node:url";
import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { ErrorPuente } from "./http.js";

const recursos = ["BusinessPartners", "Invoices", "CreditNotes", "IncomingPayments",
  "SalesPersons", "PaymentTermsTypes", "JournalEntries", "InternalReconciliations", "Currencies"];
const atributo = (texto, nombre) => texto.match(new RegExp(`\\b${nombre}\\s*=\\s*["']([^"']+)["']`))?.[1];
export function describirFinanzas(xml) {
  if (typeof xml !== "string" || !/<(?:\w+:)?Edmx\b/.test(xml) || !/<(?:\w+:)?EntityContainer\b/.test(xml)) {
    throw new ErrorPuente("METADATOS_SAP_INVALIDOS");
  }
  const tipos = new Map();
  for (const m of xml.matchAll(/<(?:\w+:)?(?:EntityType|ComplexType)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?(?:EntityType|ComplexType)>/g)) {
    const nombre = atributo(m[1], "Name");
    const campos = [...m[2].matchAll(/<(?:\w+:)?Property\b([^>]*)/g)].map(p => ({
      nombre: atributo(p[1], "Name"), tipo: atributo(p[1], "Type"),
    })).filter(p => p.nombre && p.tipo);
    tipos.set(nombre, campos);
  }
  const conjuntos = new Map([...xml.matchAll(/<(?:\w+:)?EntitySet\b([^>]*)/g)]
    .map(m => [atributo(m[1], "Name"), atributo(m[1], "EntityType")?.split(".").at(-1)]));
  return recursos.map(recurso => {
    const tipo = conjuntos.get(recurso);
    const campos = tipos.get(tipo) ?? [];
    const detalles = campos.filter(p => /Collection\(/.test(p.tipo)).map(p => {
      const tipoDetalle = p.tipo.match(/^Collection\((.+)\)$/)?.[1]?.split(".").at(-1);
      return { nombre: p.nombre, campos: tipos.get(tipoDetalle) ?? [] };
    });
    return { recurso, publicado: conjuntos.has(recurso), campos, detalles };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let sap;
  try {
    if (process.argv.length !== 2) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
    const config = configurar(process.env);
    config.control = crearControl(config);
    sap = crearClienteSap(config);
    for (const resultado of describirFinanzas(await sap.esquemaFinanciero())) {
      console.log(JSON.stringify({ evento: "recurso_financiero", ...resultado }));
    }
    console.log(JSON.stringify({ evento: "diagnostico_get_completo" }));
  } catch (error) {
    console.error(JSON.stringify({ evento: "diagnostico_get_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
    process.exitCode = 1;
  } finally { await sap?.cerrar().catch(() => {}); }
}
