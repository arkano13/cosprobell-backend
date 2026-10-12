import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { configurarFinanzas } from "./finanzas.config.js";
import { definicionesSqlFinanzas } from "./finanzas.sql.js";
import { abrirFinanzas } from "./finanzas.estado.js";
import { clienteBackendFinanzas } from "./finanzas.backend.js";
import { sincronizarPaginaFinanzas, parametrosFinanzas, fuenteFinanzas } from "./finanzas.sincronizar.js";
import { lectorFinanciero, transformarFinanzas } from "./finanzas.transformar.js";
import { tomarCandado } from "./candado.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { ErrorPuente } from "./http.js";
let sap, liberar, parar = false;
process.on("SIGINT", () => { parar = true; });
process.on("SIGTERM", () => { parar = true; });
try {
  const args = process.argv.slice(2);
  if (args.some(a => !["--once", "--sondeo", "--registrar", "--comprobar", "--reconciliar", "--forzar"].includes(a) && !/^--entidad=[A-Za-z]+$/.test(a))) throw new Error("Argumentos inválidos");
  const modo = args.filter(a => ["--sondeo", "--registrar", "--comprobar"].includes(a));
  if (modo.length > 1) throw new Error("Elija un solo modo");
  const config = configurarFinanzas(process.env);
  config.reconciliar = args.includes("--reconciliar");
  config.control = crearControl(config);
  const definiciones = definicionesSqlFinanzas(config);
  const seleccion = args.find(a => a.startsWith("--entidad="))?.split("=")[1];
  if (seleccion && !Object.hasOwn(definiciones, seleccion)) throw new Error("Entidad financiera inválida");
  if (modo.length && !seleccion) throw new Error("Sondeo y preparación requieren --entidad=NOMBRE");
  await mkdir(config.directorio, { recursive: true });
  // Comparte el candado del scanner: nunca consulta SAP en paralelo con él.
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  sap = crearClienteSap(config);
  if (config.huellaSap) console.error(JSON.stringify({ evento: "advertencia", codigo: "TLS_SAP_CERTIFICADO_FIJADO" }));
  if (modo.length) {
    const def = definiciones[seleccion];
    if (modo[0] !== "--sondeo") console.log(JSON.stringify({ evento: "consulta_financiera", entidad: seleccion,
      resultado: await sap.prepararConsultaFinanciera(def.consulta, modo[0] === "--registrar") }));
    const filas = await sap.paginaFinanciera(def.consulta, parametrosFinanzas(def, config,
      { ventana: def.historialContable ? "1900-01-01" : config.desde }, null), lectorFinanciero(seleccion), 1);
    const registros = transformarFinanzas(seleccion, filas, null);
    if (seleccion === "empresa" && (registros.length !== 1 || registros[0].monedaLocal !== config.monedaLocal || registros[0].monedaSistema !== config.monedaSistema)) throw new ErrorPuente("MONEDA_EMPRESA_DISTINTA");
    console.log(JSON.stringify({ evento: "sondeo_financiero", entidad: seleccion, registros: registros.length }));
  } else {
    const moneda = transformarFinanzas("empresa", await sap.paginaFinanciera(definiciones.empresa.consulta,
      parametrosFinanzas(definiciones.empresa, config, {}, null), lectorFinanciero("empresa"), 1), null);
    if (moneda.length !== 1 || moneda[0].monedaLocal !== config.monedaLocal || moneda[0].monedaSistema !== config.monedaSistema) throw new ErrorPuente("MONEDA_EMPRESA_DISTINTA");
    const backend = clienteBackendFinanzas(config);
    const pendientes = [];
    for (const def of Object.values(definiciones).filter(d => !seleccion || d.nombre === seleccion)) {
      const almacen = await abrirFinanzas(config, def.nombre);
      pendientes.push({ def, almacen });
    }
    pendientes.sort((a, b) => Date.parse(a.almacen.estado.ultimaAtencion ?? "1970-01-01") - Date.parse(b.almacen.estado.ultimaAtencion ?? "1970-01-01"));
    // Una página por entidad por ronda; repetir las incompletas solo si queda presupuesto.
    while (pendientes.length && !parar) {
      const { def, almacen } = pendientes.shift();
      const s = almacen.estado, frecuencia = config.frecuencias[def.nombre];
      if (!s.recorrido && s.ultimoCompleto && s.fuente === fuenteFinanzas(def, config) && !config.reconciliar && !args.includes("--forzar") &&
        (!frecuencia || Date.now() - Date.parse(s.ultimoCompleto) < frecuencia * 1000)) continue;
      await almacen.guardar({ ...s, ultimaAtencion: new Date().toISOString() });
      try {
        const resultado = await sincronizarPaginaFinanzas({ config, def, almacen, sap, backend });
        console.log(JSON.stringify({ evento: "ciclo_financiero", entidad: def.nombre, ...resultado }));
        if (!resultado.completo) pendientes.push({ def, almacen });
      } catch (error) {
        if (error.code === "PRESUPUESTO_AGOTADO") { console.log(JSON.stringify({ evento: "pausa_por_presupuesto", entidad: def.nombre })); break; }
        // Credenciales/permisos incorrectos no disparan intentos para todas las entidades.
        throw error;
      }
    }
  }
  console.log(JSON.stringify({ evento: "resumen_financiero", ...config.control.resumen() }));
} catch (error) {
  console.error(JSON.stringify({ evento: error.code === "PUENTE_YA_BLOQUEADO" ? "finanzas_omitidas" : "finanzas_fallidas", codigo: error.code ?? "REVISAR_CONFIGURACION",
    detalle: error instanceof ErrorPuente ? error.detalle : undefined }));
  process.exitCode = error.code === "PUENTE_YA_BLOQUEADO" ? 0 : 1;
} finally {
  await sap?.cerrar().catch(() => console.error('{"evento":"logout_no_confirmado"}'));
  await liberar?.();
}
