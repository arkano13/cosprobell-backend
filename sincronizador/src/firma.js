import { createHmac } from "node:crypto";

// Debe coincidir con src/shared/security/firma.js del backend.
export function firmar(secreto, { marcaTiempo, metodo, ruta, cuerpo }) {
  return createHmac("sha256", secreto)
    .update(`${marcaTiempo}\n${metodo.toUpperCase()}\n${ruta}\n${cuerpo}`)
    .digest("hex");
}
