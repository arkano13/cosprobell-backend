import { configurar } from "./config.js";
import { abrirEstado, abrirAlmacen } from "./estado.js";
import { crearClienteSap } from "./sap.client.js";
import { crearClienteBackend } from "./backend.client.js";
import { sincronizar } from "./sincronizar.js";
import { ErrorPuente } from "./http.js";
import { entidadesHabilitadas } from "./entidades.js";
import { crearControl, entidadPendiente, ordenarEntidades } from "./control.js";
import { alcanceSolicitud, sincronizarSolicitud, confirmarSolicitudLocal, faltaSolicitud } from "./solicitud-manual.js";
import { opcionesPuente, alcanceSeleccion } from "./opciones.js";
import { estadoPublico } from "./estado-publico.js";
import { VERSION_OPERATIVA } from "./version-operativa.js";

let parar = false, despertar;
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => { parar = true; despertar?.(); });
const esperar = (ms) => new Promise((resolve) => {
  const timer = setTimeout(() => { despertar = null; resolve(); }, ms);
  despertar = () => { clearTimeout(timer); despertar = null; resolve(); };
});
let almacen, sap;
try {
  const config = configurar(process.env);
  const ENTIDADES = entidadesHabilitadas(config);
  const opciones = opcionesPuente(process.argv.slice(2), ENTIDADES, config.pausadas);
  console.log(JSON.stringify({ evento: "configuracion_activa", versionOperativa: VERSION_OPERATIVA, maxConsultas: config.maxConsultas,
    consultasPorTurno: config.maxConsultasEntidad, maxDuracionMs: config.maxDuracionMs, pausaMs: config.pausaMs,
    pausadas: config.pausadas, seleccionadas: opciones.seleccion ? [...opciones.seleccion] : null,
    frecuencias: config.frecuencias }));
  if (config.huellaSap) console.error(JSON.stringify({ evento: "advertencia", codigo: "TLS_SAP_CERTIFICADO_FIJADO", mensaje: "Vigencia, nombre y cadena de confianza omitidos; certificado verificado por huella SHA-256. Si cambia el certificado, la conexión se rechazará." }));
  config.forzar = process.argv.includes("--forzar") || process.argv.includes("--reconciliar");
  config.reconciliar = process.argv.includes("--reconciliar");
  const sondeo = process.argv.includes("--sondeo");
  if (config.forzar && process.argv.includes("--watch")) throw new Error("Forzar requiere una ejecución manual");
  if (sondeo && (process.argv.includes("--watch") || config.forzar)) throw new Error("Argumentos incompatibles");
  if (process.argv.includes("--watch") && !Object.keys(config.frecuencias).length) throw new Error("Defina frecuencias antes de usar --watch");
  if (opciones.estado) {
    console.log(JSON.stringify(await estadoPublico(config, ENTIDADES.filter(e => !opciones.seleccion || opciones.seleccion.has(e.nombre)))));
  } else {
  config.control = crearControl(config);
  sap = crearClienteSap(config);
  if (sondeo) {
    // No abre el estado, no contacta al backend y nunca retira registros.
    for (const entidad of ENTIDADES) {
      if (config.pausadas.includes(entidad.nombre) || opciones.seleccion && !opciones.seleccion.has(entidad.nombre)) continue;
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
    let solicitud = null;
    try {
      // Una ejecución dirigida por consola no altera solicitudes del botón.
      const disponibles = ENTIDADES.filter(e => !config.pausadas.includes(e.nombre));
      if (!opciones.seleccion && disponibles.length) solicitud = await backend.solicitud(disponibles);
      if (solicitud) await confirmarSolicitudLocal(solicitud, ENTIDADES, almacenes, backend);
    } catch (error) {
      if (error.code !== "HTTP_404") throw error;
      console.error(JSON.stringify({ evento: "solicitud_no_disponible", codigo: error.code }));
    }
    // Un error de datos en una entidad no impide sincronizar las demás; sin conexión se corta el ciclo.
    let temporal = false, fallidas = 0;
    const alcanceManual = alcanceSolicitud(solicitud, ENTIDADES, almacenes);
    const alcanceDirigido = alcanceSeleccion(opciones.seleccion, ENTIDADES, almacenes);
    const deseadas = new Set(ENTIDADES.filter((e,i) => !config.pausadas.includes(e.nombre) &&
      (!alcanceManual || alcanceManual.has(e.nombre)) && (!alcanceDirigido || alcanceDirigido.has(e.nombre)) &&
      (faltaSolicitud(solicitud,e.nombre) || entidadPendiente(almacenes[i].estado,e.nombre,config))).map(e=>e.nombre));
    const completadas = new Set();
    const orden = ordenarEntidades(ENTIDADES, almacenes).sort((a, b) =>
      Number(faltaSolicitud(solicitud, b.entidad.nombre)) - Number(faltaSolicitud(solicitud, a.entidad.nombre)));
    for (const { i, entidad } of orden) {
      if (parar) break;
      if (config.pausadas.includes(entidad.nombre)) {
        console.log(JSON.stringify({ evento: "entidad_pausada", entidad: entidad.nombre })); continue;
      }
      if (alcanceDirigido && !alcanceDirigido.has(entidad.nombre)) continue;
      if (alcanceManual && !alcanceManual.has(entidad.nombre)) {
        console.log(JSON.stringify({ evento: "aplazada_por_solicitud_manual", entidad: entidad.nombre }));
        continue;
      }
      const manual = faltaSolicitud(solicitud, entidad.nombre);
      if (!manual && !entidadPendiente(almacenes[i].estado, entidad.nombre, config)) {
        console.log(JSON.stringify({ evento: "omitida_por_frecuencia", entidad: entidad.nombre }));
        continue;
      }
      if (entidad.dependencias?.some(nombre => !almacenes[ENTIDADES.findIndex(e => e.nombre === nombre)].estado.ultimoCompleto)) {
        console.log(JSON.stringify({ evento: "espera_carga_inicial", entidad: entidad.nombre }));
        continue;
      }
      const atendido = { ...almacenes[i].estado, ultimaAtencion: new Date().toISOString() };
      await almacenes[i].guardar(atendido); almacenes[i].estado = atendido;
      const inicioEntidad = Date.now(), consultasAntes = config.control.resumen().consultasSap;
      const medicion = () => ({ consultasSap: config.control.resumen().consultasSap - consultasAntes,
        duracionMs: Date.now() - inicioEntidad, manual,
        modo: manual ? "solicitud_app" : opciones.seleccion ? "seleccion_consola" : config.forzar ? "forzado" : "frecuencias" });
      config.control.iniciarTurno(config.maxConsultasEntidad);
      try {
        const ejecutar = () => sincronizar({ config, almacen: almacenes[i], sap, backend, entidad, detenido: () => parar });
        const resultado = manual
          ? await sincronizarSolicitud({ almacen: almacenes[i], solicitud, ejecutar, detenido: () => parar })
          : await ejecutar();
        console.log(JSON.stringify({ evento: "ciclo", entidad: entidad.nombre, ...resultado, ...medicion() }));
        if (resultado.completo) completadas.add(entidad.nombre);
      } catch (error) {
        if (error.code === "PRESUPUESTO_ENTIDAD_AGOTADO") {
          console.log(JSON.stringify({ evento: "pausa_por_entidad", entidad: entidad.nombre, ...medicion() }));
          orden.push({ i, entidad }); continue;
        }
        if (error.code === "PRESUPUESTO_AGOTADO") {
          console.log(JSON.stringify({ evento: "pausa_por_presupuesto", entidad: entidad.nombre, ...medicion() }));
          break;
        }
        // No imprimir cuerpos HTTP, cookies, claves, URLs ni errores del driver.
        // El detalle solo viene de ErrorPuente: código del registro y campo, sin valores.
        const detalle = error instanceof ErrorPuente ? error.detalle : undefined;
        if (manual) {
          const codigo = /^[A-Z0-9_]{1,60}$/.test(error.code ?? "") ? error.code : "ERROR_LOCAL";
          await backend.progresoSolicitud(solicitud.id, [], codigo).catch(() => {});
          solicitud = null;
        }
        console.error(JSON.stringify({ evento: "fallo", entidad: entidad.nombre, codigo: error.code ?? "ERROR_LOCAL", temporal: error.temporal === true, detalle, ...medicion() }));
        // No volver a probar las mismas credenciales/permisos en cada entidad.
        if (["HTTP_401", "HTTP_403"].includes(error.code)) { fallidas++; break; }
        if (error.temporal) { temporal = true; break; }
        fallidas++;
      } finally { config.control.finalizarTurno(); }
      // Si se pierde la confirmación, conservar el éxito local y reenviarlo al reiniciar.
      if (solicitud) await confirmarSolicitudLocal(solicitud, ENTIDADES, almacenes, backend);
    }
    console.log(JSON.stringify({ evento: "resumen", ...config.control.resumen(),
      completadas: [...completadas], pendientes: [...deseadas].filter(n=>!completadas.has(n)), pausadas: config.pausadas }));
    if (!continuo || parar) { if (temporal || fallidas) process.exitCode = 1; break; }
    if (temporal) { fallos++; await esperar(Math.min(60000, 1000 * 2 ** Math.min(fallos, 6))); continue; }
    // En --watch, un error que requiere corrección detiene el proceso, como antes.
    if (fallidas) { process.exitCode = 1; break; }
    fallos = 0;
    await esperar(config.intervaloMs);
  } while (!parar);
  }
  }
} catch (error) {
  console.error(JSON.stringify({ evento: "inicio_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION",
    detalle: error instanceof ErrorPuente ? error.detalle : undefined })); process.exitCode = 1;
} finally {
  if (sap) await sap.cerrar().catch(() => console.error('{"evento":"logout_no_confirmado"}'));
  if (almacen) await almacen.cerrar().catch(() => { console.error('{"evento":"revisar_candado_local"}'); process.exitCode = 1; });
}
