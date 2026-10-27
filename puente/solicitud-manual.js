// Un recorrido empezado antes del clic puede haber leído ya el producto que acaba de
// cambiar. Se termina primero y luego se recorre de nuevo, sin borrar estado ni caché.
export function recorridoEnCurso(estado) {
  return Boolean(estado.pendiente || estado.cursor !== null || estado.inicioRecorrido ||
    estado.porRevisar || estado.recorridoId || estado.finalizando);
}
export function faltaSolicitud(solicitud, nombre) {
  return Boolean(solicitud?.entidades.includes(nombre) && !solicitud.completas.includes(nombre));
}
// Durante una solicitud reservar el presupuesto a sus entidades y a las
// dependencias que nunca completaron su primera carga. Lo periódico espera.
export function alcanceSolicitud(solicitud, entidades, almacenes) {
  if (!solicitud) return null;
  const alcance = new Set();
  const agregar = nombre => {
    if (alcance.has(nombre)) return;
    alcance.add(nombre);
    const e = entidades.find(e => e.nombre === nombre);
    for (const dependencia of e?.dependencias ?? []) {
      const i = entidades.findIndex(e => e.nombre === dependencia);
      if (i >= 0 && !almacenes[i].estado.ultimoCompleto) agregar(dependencia);
    }
  };
  for (const e of entidades) if (faltaSolicitud(solicitud, e.nombre)) agregar(e.nombre);
  return alcance;
}
export async function sincronizarSolicitud({ almacen, solicitud, ejecutar, detenido = () => false }) {
  await prepararSolicitud(almacen, solicitud.id);
  const resultado = await ejecutar();
  // Si acabamos un recorrido anterior al clic, empezar el solicitado ahora,
  // con el MISMO presupuesto. No esperar otra ejecución solo por este cambio.
  if (resultado.completo && almacen.estado.solicitudManualCompletaId !== solicitud.id && !detenido()) {
    await prepararSolicitud(almacen, solicitud.id);
    const siguiente = await ejecutar();
    return { ...siguiente, lotes: (resultado.lotes ?? 0) + (siguiente.lotes ?? 0) };
  }
  return resultado;
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
