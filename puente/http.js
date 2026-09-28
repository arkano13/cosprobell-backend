export class ErrorPuente extends Error {
  // detalle solo lleva datos no secretos que ayudan a corregir el origen (código de producto y campo).
  constructor(codigo, temporal = false, detalle = undefined) {
    super(codigo); this.code = codigo; this.temporal = temporal; this.detalle = detalle;
  }
}
export async function solicitar(url, opciones = {}, fetchImpl = fetch) {
  let respuesta;
  try { respuesta = await fetchImpl(url, { ...opciones, redirect: "error", signal: AbortSignal.timeout(30000) }); }
  catch { throw new ErrorPuente("CONEXION_O_TLS", true); }
  if (!respuesta.ok) {
    await respuesta.body?.cancel();
    throw new ErrorPuente(`HTTP_${respuesta.status}`, [408, 429, 500, 502, 503, 504].includes(respuesta.status));
  }
  return respuesta;
}
export async function leerJson(respuesta) {
  try { return await respuesta.json(); }
  catch { throw new ErrorPuente("RESPUESTA_JSON_INVALIDA"); }
}
