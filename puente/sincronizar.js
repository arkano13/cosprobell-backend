import { ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
import { separarCambios, claveHuella } from "./huellas.js";
import { randomUUID } from "node:crypto";
// Facturas a leer en un recorrido: la primera carga, todas desde la fecha de inicio; después, los últimos días
// (sin ir antes de la fecha de inicio). Fechas del equipo del puente.
export function desdeFacturas(config, estado, ahora = new Date()) {
  if (!estado.ultimoCompleto) return config.facturasDesde;
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - (config.facturasDias - 1));
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return fecha > config.facturasDesde ? fecha : config.facturasDesde;
}
export async function sincronizar({ config, almacen, sap, backend, entidad = PRODUCTOS, detenido = () => false }) {
  let estado = almacen.estado;
  const guardar = async (siguiente) => { await almacen.guardar(siguiente); almacen.estado = estado = siguiente; };
  if (entidad.nombre === "facturasPreparacion") {
    if (estado.facturasDesde && estado.facturasDesde !== config.facturasDesde) throw new ErrorPuente("CAMBIO_ALCANCE_FACTURAS");
    if (!estado.facturasDesde) await guardar({ ...estado, facturasDesde: config.facturasDesde });
  }
  const comparar = async registros => separarCambios(registros, entidad, config.reconciliar ? {} :
    await almacen.leerHuellas(registros.map(r => claveHuella(r[entidad.claveLocal]))));
  const remoto = await backend.estado(entidad);
  const coincide = remoto === estado.secuencia || (estado.pendiente && remoto === estado.pendiente.lote.secuencia);
  if (!coincide) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  let lotes = 0, terminado = false;
  if (entidad.confirmarRecorrido) {
    if (entidad.fuente && (estado.fuenteExistencias ?? "items") !== entidad.fuente) {
      // No mezclar un lote antiguo sin confirmar con el alcance nuevo.
      if (estado.pendiente) throw new ErrorPuente("CAMBIO_FUENTE_CON_PENDIENTE");
      await guardar({ ...estado, cursor: null, finalizando: false, fuenteExistencias: entidad.fuente });
    }
    if (!estado.recorridoId) {
      // Al actualizar desde una versión anterior, confirmar primero cualquier lote pendiente
      // y recorrer desde el inicio. Conservar secuencias y caché, sin editar archivos a mano.
      await guardar({ ...estado, cursor: estado.pendiente ? estado.cursor : null,
        reiniciarRecorrido: Boolean(estado.pendiente), recorridoId: randomUUID(), finalizando: false });
    }
    await backend.recorrido(entidad, "iniciar", estado.recorridoId);
    if (estado.finalizando) terminado = true;
  }
  // Al empezar un recorrido se anota la hora del backend. Al terminarlo:
  // - pedidos: los que el backend tiene abiertos y no se actualizaron desde entonces ya no figuran abiertos
  //   en SAP (se cerraron o cancelaron); se piden uno por uno para registrar su estado actual.
  // - códigos de barras: el backend marca como retirados los que no se recibieron desde entonces.
  const conInicio = entidad.revisarCierres || entidad.depurarRetirados;
  if (conInicio && estado.cursor === null && !estado.pendiente && !estado.porRevisar && !estado.inicioRecorrido) {
    await guardar({ ...estado, inicioRecorrido: await backend.hora(),
      ...(entidad.ventanaFacturas ? { desdeRecorrido: desdeFacturas(config, estado) } : {}) });
  }
  // Traslados: sin revisión de pendientes, pero con la misma ventana de días que las facturas.
  if (entidad.ventanaFacturas && !conInicio && estado.cursor === null && !estado.pendiente && !estado.desdeRecorrido) {
    await guardar({ ...estado, desdeRecorrido: desdeFacturas(config, estado) });
  }
  // Las facturas del recorrido: la fecha queda fija hasta terminarlo.
  let consulta = entidad.ventanaFacturas
    ? { ...entidad, filtro: `${entidad.filtro} and DocDate ge '${estado.desdeRecorrido ?? config.facturasDesde}'` } : entidad;
  if (entidad.consultaExistenciasSql && estado.recorridoId && entidad.fuente) {
    const previa = estado.verificacionAlmacenes;
    if (!previa || previa.recorridoId !== estado.recorridoId || previa.fuente !== entidad.fuente) {
      await guardar({ ...estado, verificacionAlmacenes: { recorridoId: estado.recorridoId, fuente: entidad.fuente, codigos: [] } });
    }
    consulta = { ...consulta, verificacionAlmacenesId: `${estado.recorridoId}:${entidad.fuente}`,
      almacenesVerificados: estado.verificacionAlmacenes.codigos,
      confirmarAlmacen: async codigo => {
        const codigos = [...new Set([...estado.verificacionAlmacenes.codigos, codigo])];
        await guardar({ ...estado, verificacionAlmacenes: { ...estado.verificacionAlmacenes, codigos } });
      } };
  }
  while (!detenido() && !terminado) {
    if (estado.pendiente) {
      await backend.enviar(estado.pendiente.lote, entidad);
      if (estado.pendiente.observados?.length) await backend.observar(estado.pendiente.observados, entidad);
      if (estado.pendiente.huellas) await almacen.confirmarHuellas(estado.pendiente.huellas);
      await guardar({ ...estado, secuencia: estado.pendiente.lote.secuencia,
        cursor: estado.reiniciarRecorrido ? null : estado.pendiente.cursor,
        ...(estado.reiniciarRecorrido ? { reiniciarRecorrido: false } : {}), pendiente: null }); lotes++;
      continue;
    }
    config.control?.comprobarTurno?.();
    if (estado.porRevisar) {
      if (!estado.porRevisar.length) { terminado = true; break; }
      const [clave, ...resto] = estado.porRevisar;
      const lote = entidad.construirLote([await sap.documento(clave, entidad)], config.empresa, estado.secuencia + 1);
      // Las revisiones también pueden encontrar un pedido sin cambios.
      if (config.soloCambios) {
        const partes = await comparar(lote[entidad.nombre]);
        if (!partes.cambios.length) {
          await backend.observar(partes.observados, entidad);
          await guardar({ ...estado, porRevisar: resto });
          continue;
        }
        await guardar({ ...estado, porRevisar: resto, pendiente: { lote, cursor: clave, huellas: partes.huellas } });
        continue;
      }
      await guardar({ ...estado, porRevisar: resto, pendiente: { lote, cursor: clave } });
      continue;
    }
    const filas = await sap.pagina(estado.cursor, consulta);
    if (!filas.length) {
      if (entidad.depurarRetirados && estado.inicioRecorrido) await backend.marcarRetirados(estado.inicioRecorrido);
      if (!entidad.revisarCierres) { terminado = true; break; }
      const { pedidos } = await backend.pedidosAbiertos(entidad.rutaRevision);
      // Sin hora de inicio (recorrido empezado por una versión anterior) la revisión queda para el próximo recorrido.
      const inicio = estado.inicioRecorrido ? Date.parse(estado.inicioRecorrido) : null;
      await guardar({ ...estado, porRevisar: inicio === null ? [] : pedidos.filter((p) => Date.parse(p.sincronizadoEn) < inicio).map((p) => p.docEntry) });
      continue;
    }
    const lote = entidad.construirLote(filas, config.empresa, estado.secuencia + 1);
    const registros = lote[entidad.nombre];
    const cursor = registros.at(-1)[entidad.claveLocal];
    if (entidad.claveNumerica && registros.some((r, i) =>
      r[entidad.claveLocal] <= (i ? registros[i - 1][entidad.claveLocal] : estado.cursor ?? -1))) {
      throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    }
    if (cursor === estado.cursor || registros.some((r) => r[entidad.claveLocal] === estado.cursor)) throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    if (config.soloCambios) {
      const partes = await comparar(registros);
      if (!partes.cambios.length) {
        await backend.observar(partes.observados, entidad);
        await guardar({ ...estado, cursor });
        continue;
      }
      lote[entidad.nombre] = partes.cambios;
      await guardar({ ...estado, pendiente: { lote, cursor, observados: partes.observados, huellas: partes.huellas } });
    } else await guardar({ ...estado, pendiente: { lote, cursor } });
  }
  if (!terminado) return { completo: false, lotes, ultimaSecuencia: estado.secuencia };
  if (entidad.confirmarRecorrido) {
    await guardar({ ...estado, finalizando: true });
    await backend.recorrido(entidad, "finalizar", estado.recorridoId, estado.secuencia);
  }
  await guardar({ ...estado, cursor: null, ultimoCompleto: new Date().toISOString(),
    ...(estado.solicitudManualId ? { solicitudManualCompletaId: estado.solicitudManualId, solicitudManualId: null } : {}),
    ...(entidad.confirmarRecorrido ? { recorridoId: null, finalizando: false, verificacionAlmacenes: null } : {}),
    ...(conInicio ? { porRevisar: null, inicioRecorrido: null, desdeRecorrido: null } : {}),
    ...(entidad.ventanaFacturas ? { desdeRecorrido: null } : {}) });
  return { completo: true, lotes, ultimaSecuencia: estado.secuencia };
}
