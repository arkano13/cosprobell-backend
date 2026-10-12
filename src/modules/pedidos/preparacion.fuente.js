export function fuentePreparacion() {
  const fuente = process.env.PREPARACION_FUENTE ?? "pedidos";
  if (!["pedidos", "facturas"].includes(fuente)) throw new Error("PREPARACION_FUENTE inválida");
  return fuente === "facturas" ? "factura" : "pedido";
}
