import { createHmac, timingSafeEqual } from "node:crypto";

export const VENTANA_FIRMA_MS = 5 * 60 * 1000;

const FORMATO_FIRMA = /^[0-9a-f]{64}$/;

// Firma método, ruta, cuerpo y momento: una firma no sirve para otra petición
// ni después de la ventana de tiempo.
export function firmar(secreto, { marcaTiempo, metodo, ruta, cuerpo }) {
  return createHmac("sha256", secreto)
    .update(`${marcaTiempo}\n${metodo.toUpperCase()}\n${ruta}\n${cuerpo}`)
    .digest("hex");
}

export function firmaValida(secreto, datos, firmaRecibida) {
  if (!FORMATO_FIRMA.test(firmaRecibida)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(firmar(secreto, datos), "hex"),
    Buffer.from(firmaRecibida, "hex")
  );
}
