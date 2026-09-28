import { configurar } from "./config.js";
import { abrirEstado } from "./estado.js";
import { crearClienteSap } from "./sap.client.js";
import { crearClienteBackend } from "./backend.client.js";
import { sincronizar } from "./sincronizar.js";
import { ErrorPuente } from "./http.js";

let parar = false, despertar;
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => { parar = true; despertar?.(); });
const esperar = (ms) => new Promise((resolve) => {
  const timer = setTimeout(() => { despertar = null; resolve(); }, ms);
  despertar = () => { clearTimeout(timer); despertar = null; resolve(); };
});
let almacen, sap;
try {
  if (process.argv.slice(2).some((a) => !["--once", "--watch"].includes(a)) ||
      (process.argv.includes("--once") && process.argv.includes("--watch"))) throw new Error("Argumentos inválidos");
  const config = configurar(process.env);
  almacen = await abrirEstado(config);
  sap = crearClienteSap(config);
  const backend = crearClienteBackend(config);
  const continuo = process.argv.includes("--watch");
  let fallos = 0;
  do {
    try {
      const resultado = await sincronizar({ config, almacen, sap, backend, detenido: () => parar });
      console.log(JSON.stringify({ evento: "ciclo", ...resultado })); fallos = 0;
      if (!continuo || parar) break;
      await esperar(config.intervaloMs);
    } catch (error) {
      // No imprimir cuerpos HTTP, cookies, claves, URLs ni errores del driver.
      // El detalle solo viene de ErrorPuente: código de producto y campo, sin valores.
      const detalle = error instanceof ErrorPuente ? error.detalle : undefined;
      console.error(JSON.stringify({ evento: "fallo", codigo: error.code ?? "ERROR_LOCAL", temporal: error.temporal === true, detalle }));
      if (!continuo || !error.temporal) { process.exitCode = 1; break; }
      fallos++; await esperar(Math.min(60000, 1000 * 2 ** Math.min(fallos, 6)));
    }
  } while (!parar);
} catch (error) {
  console.error(JSON.stringify({ evento: "inicio_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" })); process.exitCode = 1;
} finally {
  if (sap) await sap.cerrar().catch(() => console.error('{"evento":"logout_no_confirmado"}'));
  if (almacen) await almacen.cerrar().catch(() => { console.error('{"evento":"revisar_candado_local"}'); process.exitCode = 1; });
}
