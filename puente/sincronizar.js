import { ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
export async function sincronizar({ config, almacen, sap, backend, entidad = PRODUCTOS, detenido = () => false }) {
  let estado = almacen.estado;
  const guardar = async (siguiente) => { await almacen.guardar(siguiente); almacen.estado = estado = siguiente; };
  const remoto = await backend.estado(entidad);
  const coincide = remoto === estado.secuencia || (estado.pendiente && remoto === estado.pendiente.lote.secuencia);
  if (!coincide) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  let lotes = 0, terminado = false;
  // Al empezar un recorrido se anota la hora del backend. Al terminarlo:
  // - pedidos: los que el backend tiene abiertos y no se actualizaron desde entonces ya no figuran abiertos
  //   en SAP (se cerraron o cancelaron); se piden uno por uno para registrar su estado actual.
  // - códigos de barras: el backend marca como retirados los que no se recibieron desde entonces.
  const conInicio = entidad.revisarCierres || entidad.depurarRetirados;
  if (conInicio && estado.cursor === null && !estado.pendiente && !estado.porRevisar && !estado.inicioRecorrido) {
    await guardar({ ...estado, inicioRecorrido: await backend.hora() });
  }
  while (!detenido()) {
    if (estado.pendiente) {
      await backend.enviar(estado.pendiente.lote, entidad);
      await guardar({ ...estado, secuencia: estado.pendiente.lote.secuencia, cursor: estado.pendiente.cursor, pendiente: null }); lotes++;
      continue;
    }
    if (estado.porRevisar) {
      if (!estado.porRevisar.length) { terminado = true; break; }
      const [clave, ...resto] = estado.porRevisar;
      const lote = entidad.construirLote([await sap.documento(clave, entidad)], config.empresa, estado.secuencia + 1);
      await guardar({ ...estado, porRevisar: resto, pendiente: { lote, cursor: clave } });
      continue;
    }
    const filas = await sap.pagina(estado.cursor, entidad);
    if (!filas.length) {
      if (entidad.depurarRetirados && estado.inicioRecorrido) await backend.marcarRetirados(estado.inicioRecorrido);
      if (!entidad.revisarCierres) { terminado = true; break; }
      const { pedidos } = await backend.pedidosAbiertos();
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
    await guardar({ ...estado, pendiente: { lote, cursor } });
  }
  if (!terminado) return { completo: false, lotes, ultimaSecuencia: estado.secuencia };
  await guardar({ ...estado, cursor: null, ...(conInicio ? { porRevisar: null, inicioRecorrido: null } : {}) });
  return { completo: true, lotes, ultimaSecuencia: estado.secuencia };
}
