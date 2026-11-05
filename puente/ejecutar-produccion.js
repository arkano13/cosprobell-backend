import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { configurarPeriodicas, ejecutarPeriodicas } from "./finanzas.periodicas.js";
import { ErrorPuente } from "./http.js";

export async function coordinarProduccion({ args, entorno, ejecutarOperativo, ejecutarFinanciero, informar }) {
  const operativo = await ejecutarOperativo(args);
  if (operativo.codigo !== 0 || args.length || entorno.BRIDGE_FINANCE_PERIODIC_ENABLED !== "true") return operativo.codigo;
  if (!operativo.resumen || !Array.isArray(operativo.resumen.pendientes) || operativo.resumen.pendientes.length) {
    informar({ evento: "finanzas_aplazadas_por_operativa" }); return 0;
  }
  await ejecutarFinanciero(); return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const informar = d => console.log(JSON.stringify(d));
  let hijo, parar = false;
  const detener = () => { parar = true; hijo?.kill("SIGTERM"); };
  process.on("SIGINT", detener); process.on("SIGTERM", detener);
  try {
    const args = process.argv.slice(2);
    process.exitCode = await coordinarProduccion({ args, entorno: process.env, informar,
      ejecutarOperativo: argumentos => new Promise((resolve, reject) => {
        let resumen;
        hijo = spawn(process.execPath, [fileURLToPath(new URL("./ejecutar.js", import.meta.url)), "--once", ...argumentos],
          { env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
        const lineas = createInterface({ input: hijo.stdout });
        lineas.on("line", linea => {
          console.log(linea);
          try { const dato = JSON.parse(linea); if (dato.evento === "resumen") resumen = dato; } catch { /* salida ajena a JSON */ }
        });
        hijo.on("error", reject);
        hijo.on("close", codigo => { hijo = null; resolve({ codigo: codigo ?? 1, resumen }); });
      }),
      ejecutarFinanciero: () => ejecutarPeriodicas({ config: configurarPeriodicas(process.env), informar, detener: () => parar }),
    });
  } catch (e) {
    informar({ evento: "produccion_fallida", codigo: e.code ?? "REVISAR_CONFIGURACION", detalle: e instanceof ErrorPuente ? e.detalle : undefined });
    process.exitCode = 1;
  } finally { process.off("SIGINT", detener); process.off("SIGTERM", detener); }
}
