import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
let sap;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !/^--numero=[1-9][0-9]*$/.test(args[0]))) throw new Error("Argumentos inválidos");
  const numero = args.length ? Number(args[0].split("=")[1]) : undefined;
  const config = configurar(process.env);
  config.control = crearControl(config);
  sap = crearClienteSap(config);
  process.exitCode = 1;
  for (const modo of numero === undefined ? ["minimo", "clave"] : ["documento"]) {
    try {
      console.log(JSON.stringify({ evento: "conciliaciones_get", modo, resultado: "OK", ...await sap.probarConciliacionesGet(modo, numero) }));
      process.exitCode = 0;
      break;
    } catch (error) {
      console.log(JSON.stringify({ evento: "conciliaciones_get", modo, resultado: "FALLO", codigo: error.code ?? "ERROR_LOCAL", detalle: error.detalle }));
      if (error.code !== "HTTP_400") break;
    }
  }
} catch (error) {
  console.error(JSON.stringify({ evento: "diagnostico_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
  process.exitCode = 1;
} finally { await sap?.cerrar().catch(() => {}); }
