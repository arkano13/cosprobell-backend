import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// PIN de operador: exactamente 4 números. Se guarda con scrypt y una sal propia; nunca en claro.
export const FORMATO_PIN = /^\d{4}$/;
const LARGO = 32;

export function pinValido(pin) {
  return typeof pin === "string" && FORMATO_PIN.test(pin);
}

export function hashPin(pin) {
  if (!pinValido(pin)) throw new TypeError("El PIN debe tener exactamente 4 números");
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${scryptSync(pin, sal, LARGO).toString("hex")}`;
}

export function verificarPin(pin, guardado) {
  if (!pinValido(pin) || typeof guardado !== "string") return false;
  const [tipo, sal, hash] = guardado.split("$");
  if (tipo !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "hex");
  const calculado = scryptSync(pin, Buffer.from(sal, "hex"), esperado.length || LARGO);
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}
