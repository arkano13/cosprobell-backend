// Importación puntual nativa GET. No registra consultas ni crea tareas de Windows.
import { join, isAbsolute } from "node:path";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as dormir } from "node:timers/promises";
import { configurarFinanzas } from "./finanzas.config.js";
import { crearClienteSap } from "./sap.client.js";
import { crearControl } from "./control.js";
import { tomarCandado } from "./candado.js";
import { clienteBackendFinanzas } from "./finanzas.backend.js";
import { definicionesGetFinanzas, leerPaginaGet, leerJsonFinancieroGet, camposNoDisponiblesGet } from "./finanzas.get.js";
import { transformarFinanzas } from "./finanzas.transformar.js";
import { abrirImportacion, importarTanda, informeImportacion } from "./finanzas.importar.js";
import { ErrorPuente } from "./http.js";

const escribir = dato => console.log(JSON.stringify(dato));
let parar = false, liberar, sap, config, trabajos;
const pausa = new AbortController();
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => { parar = true; pausa.abort(); });
async function esperar(ms) { try { await dormir(ms, undefined, { signal: pausa.signal }); } catch (e) { if (e.name !== "AbortError") throw e; } }
async function guardarInforme(datos, nombre = "informe-importacion-finanzas.json") {
  const temporal = join(config.directorio, `informe-${randomUUID()}.tmp`);
  try {
    await writeFile(temporal, JSON.stringify(datos, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporal, join(config.directorio, nombre));
  } finally { await unlink(temporal).catch(e => { if (e.code !== "ENOENT") throw e; }); }
}
try {
  const args = process.argv.slice(2);
  const modos = args.filter(a => ["--sondeo", "--cargar", "--tanda", "--estado"].includes(a));
  if (modos.length !== 1 || args.some(a => !modos.includes(a) && !/^--entidad=[A-Za-z]+$/.test(a)) ||
      args.filter(a => a.startsWith("--entidad=")).length > 1) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
  const modo = modos[0], seleccion = args.find(a => a.startsWith("--entidad="))?.slice(10);
  if (seleccion && modo !== "--sondeo") throw new ErrorPuente("ENTIDAD_SOLO_EN_SONDEO");
  config = configurarFinanzas(process.env);
  if (!isAbsolute(process.env.BRIDGE_STATE_DIR ?? "")) throw new ErrorPuente("STATE_DIR_ABSOLUTO_REQUERIDO");
  if (config.desde !== "1900-01-01") throw new ErrorPuente("HISTORIAL_COMPLETO_REQUERIDO");
  if (config.maxConsultas < 4) throw new ErrorPuente("PRESUPUESTO_FINANCIERO_MINIMO_4");
  if (Object.keys(config.frecuencias).length) throw new ErrorPuente("IMPORTACION_SIN_FRECUENCIAS");
  let source;
  JSON.parse('{"n":0.1}', (k,v,c) => { if (k === "n") source = c?.source; return v; });
  if (source !== "0.1") throw new ErrorPuente("NODE_SIN_DECIMALES_EXACTOS");
  const segundosPausa = Number(process.env.BRIDGE_FINANCE_IMPORT_PAUSE_SECONDS ?? 30);
  if (!Number.isInteger(segundosPausa) || segundosPausa < 15 || segundosPausa > 600) throw new ErrorPuente("PAUSA_FINANCIERA_INVALIDA");
  const defs = definicionesGetFinanzas(config);
  if (seleccion && !defs[seleccion]) throw new ErrorPuente("ENTIDAD_NO_DISPONIBLE_GET");
  await mkdir(config.directorio, { recursive: true });
  escribir({ evento: "alcance_importacion", puntual: true, desde: config.desde, entidades: Object.keys(defs),
    excluidas: ["conciliaciones", "partidas"], carteraCompleta: false, monedas: "configuradas_manualmente" });
  do {
    if (parar) break;
    try { liberar = await tomarCandado(join(config.directorio, "ejecucion.lock")); }
    catch (e) {
      if (e.code !== "PUENTE_YA_BLOQUEADO" || modo !== "--cargar") throw e;
      escribir({ evento: "espera_puente_operativo", segundos: segundosPausa });
      await esperar(segundosPausa * 1000); continue;
    }
    try {
      if (modo !== "--sondeo") trabajos = await abrirImportacion(config);
      if (modo === "--estado") { escribir(informeImportacion(config, trabajos)); break; }
      if (modo !== "--sondeo" && informeImportacion(config, trabajos).completo) {
        await guardarInforme(informeImportacion(config, trabajos));
        escribir({ evento: "importacion_completa", sinNuevasConsultas: true }); break;
      }
      config.control = crearControl(config);
      sap = crearClienteSap(config);
      if (config.huellaSap) escribir({ evento: "advertencia", codigo: "TLS_SAP_CERTIFICADO_FIJADO" });
      for (const codigo of new Set([config.monedaLocal, config.monedaSistema])) {
        const dato = await sap.leerRecursoFinanciero(`Currencies('${codigo}')?$select=Code`, leerJsonFinancieroGet);
        if (dato.Code !== codigo) throw new ErrorPuente("MONEDA_NO_DISPONIBLE_SAP");
      }
      if (modo === "--sondeo") {
        const resultados = [];
        for (const def of Object.values(defs).filter(d => !seleccion || d.nombre === seleccion)) {
          if (parar) break;
          await esperar(Math.max(1500, config.pausaMs));
          if (parar) break;
          config.control = crearControl(config);
          const pagina = await leerPaginaGet({ sap, def, config, recorrido: { ventana: config.desde }, tamano: 1 });
          const filas = transformarFinanzas(def.nombre, pagina.filas, null);
          const dato = { evento: "sondeo_financiero", entidad: def.nombre, registrosMuestra: filas.length,
            camposNoDisponibles: camposNoDisponiblesGet[def.nombre] ?? [] };
          escribir(dato); resultados.push(dato);
        }
        await guardarInforme({ generadoEn: new Date().toISOString(), resultados, interrumpido: parar,
          aviso: "Muestras sin enviar al backend; no certifican todo el historial." }, "sondeo-importacion-finanzas.json");
        break;
      }
      const informe = await importarTanda({ config, trabajos, sap, backend: clienteBackendFinanzas(config),
        detenido: () => parar, informar: escribir });
      await guardarInforme(informe);
      escribir({ evento: "resumen_importacion", completo: informe.completo,
        completas: informe.entidades.filter(e => e.completo).length, total: informe.entidades.length, ...config.control.resumen() });
      if (informe.completo || modo === "--tanda" || parar) break;
    } finally {
      await sap?.cerrar().catch(() => escribir({ evento: "logout_no_confirmado" })); sap = null;
      await liberar?.(); liberar = null;
    }
    escribir({ evento: "pausa_entre_tandas", segundos: segundosPausa });
    await esperar(segundosPausa * 1000);
  } while (!parar);
  if (parar) { escribir({ evento: "importacion_interrumpida", aviso: "Repetir --cargar para continuar." }); process.exitCode = 130; }
} catch (error) {
  const codigo = error.code ?? "REVISAR_CONFIGURACION";
  escribir({ evento: "importacion_fallida", codigo, entidad: error.entidadFinanciera,
    detalle: error instanceof ErrorPuente ? error.detalle : undefined });
  if (config && trabajos) await guardarInforme({ ...informeImportacion(config, trabajos), ultimoError: { codigo, entidad: error.entidadFinanciera } }).catch(() => {});
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
