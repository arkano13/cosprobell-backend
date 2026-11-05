import { configurarPeriodicas, ejecutarPeriodicas } from "./finanzas.periodicas.js";
import { ErrorPuente } from "./http.js";
const args = process.argv.slice(2);
let parar = false;
process.on("SIGINT", () => { parar = true; });
process.on("SIGTERM", () => { parar = true; });
try {
  if (args.some(a => !["--once", "--comprobar"].includes(a))) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
  await ejecutarPeriodicas({ config: configurarPeriodicas(process.env), comprobar: args.includes("--comprobar"), detener: () => parar });
} catch (e) {
  console.error(JSON.stringify({ evento: "finanzas_periodicas_fallidas", codigo: e.code ?? "REVISAR_CONFIGURACION", detalle: e instanceof ErrorPuente ? e.detalle : undefined }));
  process.exitCode = 1;
}
