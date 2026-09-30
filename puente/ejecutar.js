import { configurar } from "./config.js";
import { abrirEstado, abrirAlmacen } from "./estado.js";
import { crearClienteSap } from "./sap.client.js";
import { crearClienteBackend } from "./backend.client.js";
import { sincronizar } from "./sincronizar.js";
import { ErrorPuente } from "./http.js";
import { ENTIDADES } from "./entidades.js";
import { crearControl, entidadPendiente, ordenarEntidades } from "./control.js";

let parar = false, despertar;
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => { parar = true; despertar?.(); });
const esperar = (ms) => new Promise((resolve) => {
  const timer = setTimeout(() => { despertar = null; resolve(); }, ms);
  despertar = () => { clearTimeout(timer); despertar = null; resolve(); };
});
let almacen, sap;
try {
  if (process.argv.slice(2).some((a) => !["--once", "--watch", "--sondeo", "--forzar", "--reconciliar"].includes(a)) ||
      (process.argv.includes("--once") && process.argv.includes("--watch"))) throw new Error("Argumentos inválidos");
  const config = configurar(process.env);
  config.forzar = process.argv.includes("--forzar") || process.argv.includes("--reconciliar");
  config.reconciliar = process.argv.includes("--reconciliar");
  const sondeo = process.argv.includes("--sondeo");
  if (config.forzar && process.argv.includes("--watch")) throw new Error("Forzar requiere una ejecución manual");
  if (sondeo && (process.argv.includes("--watch") || config.forzar)) throw new Error("Argumentos incompatibles");
  if (process.argv.includes("--watch") && !Object.keys(config.frecuencias).length) throw new Error("Defina frecuencias antes de usar --watch");
  config.control = crearControl(config);
  sap = crearClienteSap(config);
  if (sondeo) {
    // No abre el estado, no contacta al backend y nunca retira registros.
    for (const entidad of ENTIDADES) {
      const filas = await sap.pagina(null, { ...entidad, tamanoPagina: 1 });
      if (filas.length) entidad.construirLote(filas, config.empresa, 1);
      console.log(JSON.stringify({ evento: "sondeo", entidad: entidad.nombre, registros: filas.length }));
    }
    console.log(JSON.stringify({ evento: "resumen", ...config.control.resumen() }));
  } else {
  // Un solo candado para todo el proceso; cada entidad tiene su archivo de estado.
  almacen = await abrirEstado(config, ENTIDADES[0]);
  const almacenes = [almacen];
  for (const entidad of ENTIDADES.slice(1)) almacenes.push(await abrirAlmacen(config, entidad));
  const backend = crearClienteBackend(config);
  const continuo = process.argv.includes("--watch");
  let fallos = 0;
  do {
    config.control = crearControl(config);
    // Un error de datos en una entidad no impide sincronizar las demás; sin conexión se corta el ciclo.
    let temporal = false, fallidas = 0;
    for (const { i, entidad } of ordenarEntidades(ENTIDADES, almacenes)) {
      if (parar) break;
      if (!entidadPendiente(almacenes[i].estado, entidad.nombre, config)) {
        console.log(JSON.stringify({ evento: "omitida_por_frecuencia", entidad: entidad.nombre }));
        continue;
      }
      if (entidad.dependencias?.some(nombre => !almacenes[ENTIDADES.findIndex(e => e.nombre === nombre)].estado.ultimoCompleto)) {
        console.log(JSON.stringify({ evento: "espera_carga_inicial", entidad: entidad.nombre }));
        continue;
      }
      const atendido = { ...almacenes[i].estado, ultimaAtencion: new Date().toISOString() };
      await almacenes[i].guardar(atendido); almacenes[i].estado = atendido;
      try {
        const resultado = await sincronizar({ config, almacen: almacenes[i], sap, backend, entidad, detenido: () => parar });
        console.log(JSON.stringify({ evento: "ciclo", entidad: entidad.nombre, ...resultado }));
      } catch (error) {
        if (error.code === "PRESUPUESTO_AGOTADO") {
          console.log(JSON.stringify({ evento: "pausa_por_presupuesto", entidad: entidad.nombre }));
          break;
        }
        // No imprimir cuerpos HTTP, cookies, claves, URLs ni errores del driver.
        // El detalle solo viene de ErrorPuente: código del registro y campo, sin valores.
        const detalle = error instanceof ErrorPuente ? error.detalle : undefined;
        console.error(JSON.stringify({ evento: "fallo", entidad: entidad.nombre, codigo: error.code ?? "ERROR_LOCAL", temporal: error.temporal === true, detalle }));
        if (error.temporal) { temporal = true; break; }
        fallidas++;
      }
    }
    console.log(JSON.stringify({ evento: "resumen", ...config.control.resumen() }));
    if (!continuo || parar) { if (temporal || fallidas) process.exitCode = 1; break; }
    if (temporal) { fallos++; await esperar(Math.min(60000, 1000 * 2 ** Math.min(fallos, 6))); continue; }
    // En --watch, un error que requiere corrección detiene el proceso, como antes.
    if (fallidas) { process.exitCode = 1; break; }
    fallos = 0;
    await esperar(config.intervaloMs);
  } while (!parar);
  }
} catch (error) {
  console.error(JSON.stringify({ evento: "inicio_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" })); process.exitCode = 1;
} finally {
  if (sap) await sap.cerrar().catch(() => console.error('{"evento":"logout_no_confirmado"}'));
  if (almacen) await almacen.cerrar().catch(() => { console.error('{"evento":"revisar_candado_local"}'); process.exitCode = 1; });
}
