export class ErrorPuente extends Error {
  // detalle solo lleva datos no secretos que ayudan a corregir el origen (código de producto y campo).
  constructor(codigo, temporal = false, detalle = undefined) {
    super(codigo); this.code = codigo; this.temporal = temporal; this.detalle = detalle;
  }
}
// leerDetalle (opcional) extrae datos no secretos de una respuesta de error; solo lo usa el cliente del backend.
export async function solicitar(url, opciones = {}, fetchImpl = fetch, leerDetalle = null) {
  let respuesta;
  try { respuesta = await fetchImpl(url, { ...opciones, redirect: "error", signal: AbortSignal.timeout(30000) }); }
  catch { throw new ErrorPuente("CONEXION_O_TLS", true); }
  if (!respuesta.ok) {
    const detalle = leerDetalle ? await leerDetalle(respuesta).catch(() => undefined) : undefined;
    await respuesta.body?.cancel().catch(() => {});
    throw new ErrorPuente(`HTTP_${respuesta.status}`, [408, 429, 500, 502, 503, 504].includes(respuesta.status), detalle);
  }
  return respuesta;
}
export async function leerJson(respuesta) {
  try { return await respuesta.json(); }
  catch { throw new ErrorPuente("RESPUESTA_JSON_INVALIDA"); }
}
