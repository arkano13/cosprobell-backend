// Un recorrido empezado antes del clic puede haber leído ya el producto que acaba de
// cambiar. Se termina primero y luego se recorre de nuevo, sin borrar estado ni caché.
export function recorridoEnCurso(estado) {
  return Boolean(estado.pendiente || estado.cursor !== null || estado.inicioRecorrido ||
    estado.porRevisar || estado.recorridoId || estado.finalizando);
}
export function faltaSolicitud(solicitud, nombre) {
  return Boolean(solicitud?.entidades.includes(nombre) && !solicitud.completas.includes(nombre));
}
export async function prepararSolicitud(almacen, id) {
  if (almacen.estado.solicitudManualId !== id && !recorridoEnCurso(almacen.estado)) {
    const estado = { ...almacen.estado, solicitudManualId: id };
    await almacen.guardar(estado);
    almacen.estado = estado;
  }
}
export async function confirmarSolicitudLocal(solicitud, entidades, almacenes, backend) {
  const completas = entidades.filter((e, i) => faltaSolicitud(solicitud, e.nombre) &&
    almacenes[i].estado.solicitudManualCompletaId === solicitud.id).map(e => e.nombre);
  if (completas.length) {
    await backend.progresoSolicitud(solicitud.id, completas);
    solicitud.completas.push(...completas);
  }
}
