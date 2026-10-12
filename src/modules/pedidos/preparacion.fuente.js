// Fuente de los documentos a preparar (PREPARACION_FUENTE). env.schema.js la valida al arrancar; se lee de process.env en
// cada consulta para que las pruebas la puedan cambiar.
export function fuentePreparacion() {
  const fuente = process.env.PREPARACION_FUENTE ?? "pedidos";
  if (!["pedidos", "facturas"].includes(fuente)) throw new Error("PREPARACION_FUENTE inválida");
  return fuente === "facturas" ? "factura" : "pedido";
}
