import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { definicionesSqlFinanzas } from "./finanzas.sql.js";
import { lectorFinanciero, transformarFinanzas } from "./finanzas.transformar.js";

// Lee OADM sin pedir que se adivinen las monedas ni activar la carga financiera.
let sap;
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--comprobar", "--registrar"].includes(args[0])) throw new Error("Use --comprobar o --registrar");
  const config = configurar(process.env); config.control = crearControl(config);
  sap = crearClienteSap(config);
  const def = definicionesSqlFinanzas({}).empresa;
  await sap.prepararConsultaFinanciera(def.consulta, args[0] === "--registrar");
  const filas = await sap.paginaFinanciera(def.consulta, { k0: "" }, lectorFinanciero("empresa"), 1);
  const registros = transformarFinanzas("empresa", filas, null);
  if (registros.length !== 1) throw new Error("No se confirmó la configuración de la empresa");
  console.log(JSON.stringify({ evento: "monedas_sap", monedaLocal: registros[0].monedaLocal, monedaSistema: registros[0].monedaSistema }));
} catch (error) {
  console.error(JSON.stringify({ evento: "consulta_monedas_fallida", codigo: error.code ?? "REVISAR_CONFIGURACION" })); process.exitCode = 1;
} finally { if (sap) await sap.cerrar().catch(() => {}); }
