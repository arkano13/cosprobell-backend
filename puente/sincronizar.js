import { ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
export async function sincronizar({ config, almacen, sap, backend, entidad = PRODUCTOS, detenido = () => false }) {
  let estado = almacen.estado;
  const remoto = await backend.estado(entidad);
  const coincide = remoto === estado.secuencia || (estado.pendiente && remoto === estado.pendiente.lote.secuencia);
  if (!coincide) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  let lotes = 0;
  while (!detenido()) {
    if (estado.pendiente) {
      await backend.enviar(estado.pendiente.lote, entidad);
      const siguiente = { ...estado, secuencia: estado.pendiente.lote.secuencia, cursor: estado.pendiente.cursor, pendiente: null };
      await almacen.guardar(siguiente); almacen.estado = estado = siguiente; lotes++;
      continue;
    }
    const filas = await sap.pagina(estado.cursor, entidad);
    if (!filas.length) {
      const siguiente = { ...estado, cursor: null };
      await almacen.guardar(siguiente); almacen.estado = siguiente;
      return { completo: true, lotes, ultimaSecuencia: estado.secuencia };
    }
    const lote = entidad.construirLote(filas, config.empresa, estado.secuencia + 1);
    const registros = lote[entidad.nombre];
    const cursor = registros.at(-1)[entidad.claveLocal];
    if (entidad.claveNumerica && registros.some((r, i) =>
      r[entidad.claveLocal] <= (i ? registros[i - 1][entidad.claveLocal] : estado.cursor ?? -1))) {
      throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    }
    if (cursor === estado.cursor || registros.some((r) => r[entidad.claveLocal] === estado.cursor)) throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    const siguiente = { ...estado, pendiente: { lote, cursor } };
    await almacen.guardar(siguiente); almacen.estado = estado = siguiente;
  }
  return { completo: false, lotes, ultimaSecuencia: estado.secuencia };
}
