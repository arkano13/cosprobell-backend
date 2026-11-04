// Refresca UNA entidad completa mediante GET, conservando los cursores del resto.
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as dormir } from "node:timers/promises";
import { configurarFinanzas } from "./finanzas.config.js";
import { definicionesGetFinanzas, leerJsonFinancieroGet } from "./finanzas.get.js";
import { abrirFinanzas } from "./finanzas.estado.js";
import { sincronizarPaginaFinanzas } from "./finanzas.sincronizar.js";
import { clienteBackendFinanzas } from "./finanzas.backend.js";
import { crearClienteSap } from "./sap.client.js";
import { crearControl } from "./control.js";
import { tomarCandado } from "./candado.js";
import { ErrorPuente } from "./http.js";

export function entidadActualizacion(args) {
  if (args.length !== 1 || !/^--entidad=[A-Za-z]+$/.test(args[0])) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
  const entidad = args[0].slice(10);
  if (!["facturas", "notasCredito", "clientes", "vendedores", "condicionesPago", "pagos"].includes(entidad)) {
    throw new ErrorPuente("ENTIDAD_NO_ACTUALIZABLE");
  }
  return entidad;
}

export async function actualizarTandaGet({ config, def, almacen, sap, backend, detenido = () => false,
  informar = () => {}, sincronizar = sincronizarPaginaFinanzas }) {
  // La primera llamada inicia otro snapshot aunque el anterior ya haya terminado.
  // Si hay un recorrido pendiente, la función compartida lo retoma sin reiniciarlo.
  while (!detenido()) {
    try {
      const r = await sincronizar({ config: { ...config, reconciliar: true }, def, almacen, sap, backend });
      informar({ evento: "actualizacion_financiera", entidad: def.nombre, ...r });
      if (r.completo) return true;
    } catch (e) {
      if (e.code !== "PRESUPUESTO_AGOTADO") throw e;
      informar({ evento: "pausa_por_presupuesto", entidad: def.nombre });
      break;
    }
  }
  return false;
}

async function principal() {
  const informar = dato => console.log(JSON.stringify(dato));
  let liberar, sap, parar = false;
  const pausa = new AbortController();
  const detener = () => { parar = true; pausa.abort(); };
  const esperar = async ms => { try { await dormir(ms, undefined, { signal: pausa.signal }); } catch (e) { if (e.name !== "AbortError") throw e; } };
  process.on("SIGINT", detener); process.on("SIGTERM", detener);
  try {
    const entidad = entidadActualizacion(process.argv.slice(2));
    const config = configurarFinanzas(process.env);
    if (!isAbsolute(process.env.BRIDGE_STATE_DIR ?? "")) throw new ErrorPuente("STATE_DIR_ABSOLUTO_REQUERIDO");
    if (config.desde !== "1900-01-01") throw new ErrorPuente("HISTORIAL_COMPLETO_REQUERIDO");
    if (config.maxConsultas < 4) throw new ErrorPuente("PRESUPUESTO_FINANCIERO_MINIMO_4");
    if (Object.keys(config.frecuencias).length) throw new ErrorPuente("IMPORTACION_SIN_FRECUENCIAS");
    const segundos = Number(process.env.BRIDGE_FINANCE_IMPORT_PAUSE_SECONDS ?? 30);
    if (!Number.isInteger(segundos) || segundos < 15 || segundos > 600) throw new ErrorPuente("PAUSA_FINANCIERA_INVALIDA");
    const def = definicionesGetFinanzas(config)[entidad];
    informar({ evento: "alcance_actualizacion", entidad, historicoCompleto: true, restoSinReiniciar: true });
    while (!parar) {
      try { liberar = await tomarCandado(join(config.directorio, "ejecucion.lock")); }
      catch (e) {
        if (e.code !== "PUENTE_YA_BLOQUEADO") throw e;
        informar({ evento: "espera_puente_operativo", segundos }); await esperar(segundos * 1000); continue;
      }
      let completo = false;
      try {
        const almacen = await abrirFinanzas(config, entidad);
        config.control = crearControl(config);
        sap = crearClienteSap(config);
        for (const codigo of new Set([config.monedaLocal, config.monedaSistema])) {
          const dato = await sap.leerRecursoFinanciero(`Currencies('${codigo}')?$select=Code`, leerJsonFinancieroGet);
          if (dato.Code !== codigo) throw new ErrorPuente("MONEDA_NO_DISPONIBLE_SAP");
        }
        completo = await actualizarTandaGet({ config, def, almacen, sap, backend: clienteBackendFinanzas(config),
          detenido: () => parar, informar });
        informar({ evento: "resumen_actualizacion", entidad, completo, ...config.control.resumen() });
      } finally {
        await sap?.cerrar().catch(() => informar({ evento: "logout_no_confirmado" })); sap = null;
        await liberar?.(); liberar = null;
      }
      if (completo) { informar({ evento: "actualizacion_completa", entidad }); break; }
      if (!parar) { informar({ evento: "pausa_entre_tandas", segundos }); await esperar(segundos * 1000); }
    }
    if (parar) { informar({ evento: "actualizacion_interrumpida" }); process.exitCode = 130; }
  } catch (e) {
    informar({ evento: "actualizacion_fallida", codigo: e.code ?? "REVISAR_CONFIGURACION",
      ...(e instanceof ErrorPuente && e.detalle ? { detalle: e.detalle } : {}) });
    process.exitCode = 1;
  } finally {
    await sap?.cerrar().catch(() => {}); await liberar?.();
    process.off("SIGINT", detener); process.off("SIGTERM", detener);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
