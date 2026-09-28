import { construirLote } from "./productos.js";
import { ErrorPuente } from "./http.js";
export async function sincronizar({ config, almacen, sap, backend, detenido = () => false }) {
  let estado = almacen.estado;
  const remoto = await backend.estado();
  const coincide = remoto === estado.secuencia || (estado.pendiente && remoto === estado.pendiente.lote.secuencia);
  if (!coincide) throw new ErrorPuente("REQUIERE_RECONCILIACION");
  let lotes = 0;
  while (!detenido()) {
    if (estado.pendiente) {
      await backend.enviar(estado.pendiente.lote);
      const siguiente = { ...estado, secuencia: estado.pendiente.lote.secuencia, cursor: estado.pendiente.cursor, pendiente: null };
      await almacen.guardar(siguiente); almacen.estado = estado = siguiente; lotes++;
      continue;
    }
    const filas = await sap.pagina(estado.cursor);
    if (!filas.length) {
      const siguiente = { ...estado, cursor: null };
      await almacen.guardar(siguiente); almacen.estado = siguiente;
      return { completo: true, lotes, ultimaSecuencia: estado.secuencia };
    }
    const lote = construirLote(filas, config.empresa, estado.secuencia + 1);
    const cursor = lote.productos.at(-1).itemCode;
    if (cursor === estado.cursor || lote.productos.some((p) => p.itemCode === estado.cursor)) throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    const siguiente = { ...estado, pendiente: { lote, cursor } };
    await almacen.guardar(siguiente); almacen.estado = estado = siguiente;
  }
  return { completo: false, lotes, ultimaSecuencia: estado.secuencia };
}
