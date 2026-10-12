// Fuente de los documentos a preparar (PREPARACION_FUENTE). env.schema.js la valida al arrancar; se lee de process.env en
// cada consulta para que las pruebas la puedan cambiar.
export function fuentePreparacion() {
  const fuente = process.env.PREPARACION_FUENTE ?? "pedidos";
  if (!["pedidos", "facturas"].includes(fuente)) throw new Error("PREPARACION_FUENTE inválida");
  return fuente === "facturas" ? "factura" : "pedido";
}
// Documentos que SAP ya descontó al crearlos: la factura y el traslado que sale de la 02. Se preparan después, solo sus
// líneas de la 02 y completos.
export const esSalidaSap = (fuenteDocumento) => fuenteDocumento === "factura" || fuenteDocumento === "traslado";
// Fuentes de documento que la lista y la preparación aceptan con la fuente configurada.
export const fuentesDocumento = () => fuentePreparacion() === "factura" ? ["factura", "traslado"] : ["pedido"];
