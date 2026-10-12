import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { transformarFinanzas } from "./finanzas.transformar.js";

// Lee las monedas de SAP (GetAdminInfo) sin pedir que se adivinen ni activar la carga financiera.
let sap;
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--comprobar", "--registrar"].includes(args[0])) throw new Error("Use --comprobar o --registrar");
  const config = configurar(process.env); config.control = crearControl(config);
  sap = crearClienteSap(config);
  const registros = transformarFinanzas("empresa", [{ codigo: "empresa", ...await sap.monedasEmpresa() }], null);
  if (registros.length !== 1) throw new Error("No se confirmó la configuración de la empresa");
  console.log(JSON.stringify({ evento: "monedas_sap", monedaLocal: registros[0].monedaLocal, monedaSistema: registros[0].monedaSistema }));
} catch (error) {
  console.error(JSON.stringify({ evento: "consulta_monedas_fallida", codigo: error.code ?? "REVISAR_CONFIGURACION", detalle: error.detalle })); process.exitCode = 1;
} finally { if (sap) await sap.cerrar().catch(() => {}); }
