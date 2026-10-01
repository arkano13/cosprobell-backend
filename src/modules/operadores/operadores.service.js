import { randomBytes } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import { hashApiKey as hashToken } from "../../shared/security/hash.js";
import { verificarPin } from "../../shared/security/pin.js";
import { operadoresRepository } from "./operadores.repository.js";

// Una sesión dura un turno de trabajo.
export const DURACION_SESION_MS = 12 * 60 * 60 * 1000;
// Cada 5 PIN incorrectos seguidos: pausa de 15 minutos. Al llegar a 10: bloqueado hasta que el supervisor lo quite.
export const INTENTOS_PARA_PAUSA = 5;
export const PAUSA_MS = 15 * 60 * 1000;
export const INTENTOS_PARA_BLOQUEO = 10;
export const BLOQUEO_INDEFINIDO = new Date("9999-12-31T00:00:00.000Z");

const reloj = () => new Date();
export const ROLES = ["operador", "supervisor"];
const datosOperador = (o) => ({ id: o.id, nombre: o.nombre, rol: o.rol ?? "operador" });

export function listarOperadores({ repo = operadoresRepository } = {}) {
  return repo.listarActivos();
}

export async function iniciarSesion({ operadorId, pin, aplicacion = null }, { repo = operadoresRepository, ahora = reloj } = {}) {
  const operador = await repo.buscarPorId(operadorId);
  if (!operador || !operador.activo) {
    throw new AppError({ code: "OPERADOR_NO_DISPONIBLE", message: "Ese operador no existe o está desactivado", statusCode: 401 });
  }
  const momento = ahora();
  // Mientras dure el bloqueo no se evalúa el PIN: ni siquiera el correcto.
  if (operador.bloqueadoHasta && operador.bloqueadoHasta > momento) throw errorBloqueo(operador.bloqueadoHasta, momento);

  if (!verificarPin(pin, operador.pinHash)) {
    const intentos = await repo.sumarIntentoFallido(operador.id);
    if (intentos >= INTENTOS_PARA_BLOQUEO) {
      await repo.bloquear(operador.id, BLOQUEO_INDEFINIDO);
      throw errorBloqueo(BLOQUEO_INDEFINIDO, momento);
    }
    if (intentos % INTENTOS_PARA_PAUSA === 0) {
      const hasta = new Date(momento.getTime() + PAUSA_MS);
      await repo.bloquear(operador.id, hasta);
      throw errorBloqueo(hasta, momento);
    }
    throw new AppError({ code: "PIN_INCORRECTO", message: "PIN incorrecto", statusCode: 401 });
  }

  if (operador.intentosFallidos || operador.bloqueadoHasta) await repo.reiniciarIntentos(operador.id);
  // El token solo viaja al equipo; en la base queda su hash.
  const token = randomBytes(32).toString("hex");
  const expiraEn = new Date(momento.getTime() + DURACION_SESION_MS);
  await repo.crearSesion({ operadorId: operador.id, tokenHash: hashToken(token), aplicacion, expiraEn });
  return { token, expiraEn, operador: datosOperador(operador) };
}

// Devuelve el operador de una sesión vigente, o null si el token no sirve.
export async function autenticarSesion(token, { repo = operadoresRepository, ahora = reloj } = {}) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const sesion = await repo.buscarSesion(hashToken(token));
  if (!sesion || sesion.cerradaEn || sesion.expiraEn <= ahora() || !sesion.operador?.activo) return null;
  return { sesionId: sesion.id, operador: datosOperador(sesion.operador) };
}

export async function cerrarSesion(sesionId, { repo = operadoresRepository, ahora = reloj } = {}) {
  await repo.cerrarSesion(sesionId, ahora());
}

function errorBloqueo(hasta, momento) {
  if (hasta >= BLOQUEO_INDEFINIDO) {
    return new AppError({ code: "OPERADOR_BLOQUEADO", message: "Demasiados PIN incorrectos. Pedile al supervisor que te desbloquee.", statusCode: 423 });
  }
  const minutos = Math.max(1, Math.ceil((hasta - momento) / 60000));
  return new AppError({ code: "OPERADOR_EN_PAUSA", message: `Demasiados PIN incorrectos. Probá de nuevo en ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`, statusCode: 429 });
}
