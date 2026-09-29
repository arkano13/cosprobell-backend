import { configurar } from "./config.js";
import { abrirEstado, abrirAlmacen } from "./estado.js";
import { crearClienteSap } from "./sap.client.js";
import { crearClienteBackend } from "./backend.client.js";
import { sincronizar } from "./sincronizar.js";
import { ErrorPuente } from "./http.js";
import { ENTIDADES } from "./entidades.js";

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
  // Un solo candado para todo el proceso; cada entidad tiene su archivo de estado.
  almacen = await abrirEstado(config, ENTIDADES[0]);
  const almacenes = [almacen];
  for (const entidad of ENTIDADES.slice(1)) almacenes.push(await abrirAlmacen(config, entidad));
  sap = crearClienteSap(config);
  const backend = crearClienteBackend(config);
  const continuo = process.argv.includes("--watch");
  let fallos = 0;
  do {
    // Un error de datos en una entidad no impide sincronizar las demás; sin conexión se corta el ciclo.
    let temporal = false, fallidas = 0;
    for (const [i, entidad] of ENTIDADES.entries()) {
      if (parar) break;
      try {
        const resultado = await sincronizar({ config, almacen: almacenes[i], sap, backend, entidad, detenido: () => parar });
        console.log(JSON.stringify({ evento: "ciclo", entidad: entidad.nombre, ...resultado }));
      } catch (error) {
        // No imprimir cuerpos HTTP, cookies, claves, URLs ni errores del driver.
        // El detalle solo viene de ErrorPuente: código del registro y campo, sin valores.
        const detalle = error instanceof ErrorPuente ? error.detalle : undefined;
        console.error(JSON.stringify({ evento: "fallo", entidad: entidad.nombre, codigo: error.code ?? "ERROR_LOCAL", temporal: error.temporal === true, detalle }));
        if (error.temporal) { temporal = true; break; }
        fallidas++;
      }
    }
    if (!continuo || parar) { if (temporal || fallidas) process.exitCode = 1; break; }
    if (temporal) { fallos++; await esperar(Math.min(60000, 1000 * 2 ** Math.min(fallos, 6))); continue; }
    // En --watch, un error que requiere corrección detiene el proceso, como antes.
    if (fallidas) { process.exitCode = 1; break; }
    fallos = 0;
    await esperar(config.intervaloMs);
  } while (!parar);
} catch (error) {
  console.error(JSON.stringify({ evento: "inicio_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" })); process.exitCode = 1;
} finally {
  if (sap) await sap.cerrar().catch(() => console.error('{"evento":"logout_no_confirmado"}'));
  if (almacen) await almacen.cerrar().catch(() => { console.error('{"evento":"revisar_candado_local"}'); process.exitCode = 1; });
}
