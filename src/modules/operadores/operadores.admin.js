// Administración de operadores: la usan el panel del supervisor y scripts/operadores.js.
import { prisma } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";
import { hashPin, pinValido } from "../../shared/security/pin.js";
import { BLOQUEO_INDEFINIDO, ROLES } from "./operadores.service.js";

const error = (code, message, statusCode = 400) => new AppError({ code, message, statusCode });
export const normalizarNombre = (texto) => String(texto ?? "").trim().replace(/\s+/g, " ");

export function validarNombre(texto) {
  const nombre = normalizarNombre(texto);
  if (nombre.length < 2 || nombre.length > 60) throw error("NOMBRE_INVALIDO", "El nombre debe tener entre 2 y 60 caracteres.");
  return nombre;
}

function validarPin(pin) {
  if (!pinValido(pin)) throw error("PIN_INVALIDO", "El PIN debe tener exactamente 4 números, por ejemplo 4827.");
  return pin;
}

// Se permiten, pero se avisa: son los primeros que alguien probaría.
export const pinFacil = (pin) => /^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin);
const advertencia = (pin) => (pinFacil(pin) ? `${pin} es un PIN fácil de adivinar. Conviene elegir otro.` : null);

function validarRol(rol) {
  if (!ROLES.includes(rol)) throw error("ROL_INVALIDO", `El rol debe ser ${ROLES.join(" o ")}.`);
  return rol;
}

export const operadoresAdminRepository = {
  listar() {
    return prisma.operador.findMany({
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, rol: true, activo: true, intentosFallidos: true, bloqueadoHasta: true,
        sesiones: { select: { creadaEn: true }, orderBy: { creadaEn: "desc" }, take: 1 } },
    });
  },
  buscarPorId: (id) => prisma.operador.findUnique({ where: { id } }),
  buscarPorNombre: (nombre) => prisma.operador.findUnique({ where: { nombre } }),
  crear: (datos) => prisma.operador.create({ data: datos }),
  // Actualiza y, si corresponde, cierra en la misma transacción las sesiones abiertas (salvo la indicada).
  actualizar(id, data, { cerrarSesiones = false, exceptoSesionId = null } = {}) {
    return prisma.$transaction(async (tx) => {
      const operador = await tx.operador.update({ where: { id }, data });
      if (cerrarSesiones) {
        await tx.sesionOperador.updateMany({
          where: { operadorId: id, cerradaEn: null, ...(exceptoSesionId ? { NOT: { id: exceptoSesionId } } : {}) },
          data: { cerradaEn: new Date() },
        });
      }
      return operador;
    });
  },
};

export function estadoOperador(o, ahora = new Date()) {
  if (!o.activo) return "inactivo";
  if (o.bloqueadoHasta && o.bloqueadoHasta > ahora) return o.bloqueadoHasta >= BLOQUEO_INDEFINIDO ? "bloqueado" : "pausa";
  return "activo";
}

const vista = (o, ahora) => {
  const estado = estadoOperador(o, ahora);
  return { id: o.id, nombre: o.nombre, rol: o.rol ?? "operador", estado, activo: o.activo,
    intentosFallidos: o.intentosFallidos ?? 0, pausaHasta: estado === "pausa" ? o.bloqueadoHasta : null,
    ultimoIngreso: o.sesiones?.[0]?.creadaEn ?? null };
};

async function existente(id, repo) {
  const operador = await repo.buscarPorId(id);
  if (!operador) throw error("OPERADOR_NO_ENCONTRADO", "No existe ese operador.", 404);
  return operador;
}

export async function listarOperadoresAdmin({ repo = operadoresAdminRepository, ahora = new Date() } = {}) {
  return (await repo.listar()).map((o) => vista(o, ahora));
}

export async function crearOperador({ nombre, pin, rol = "operador" }, { repo = operadoresAdminRepository } = {}) {
  const datos = { nombre: validarNombre(nombre), pinHash: hashPin(validarPin(pin)), rol: validarRol(rol) };
  if (await repo.buscarPorNombre(datos.nombre)) throw error("OPERADOR_DUPLICADO", `Ya existe una persona llamada "${datos.nombre}".`, 409);
  const operador = await repo.crear(datos);
  return { operador: { id: operador.id, nombre: operador.nombre, rol: operador.rol }, advertencia: advertencia(pin) };
}

// Cambiar el PIN también desbloquea y cierra las sesiones abiertas (salvo la de quien lo cambia).
export async function cambiarPin(id, pin, { exceptoSesionId = null, repo = operadoresAdminRepository } = {}) {
  const operador = await existente(id, repo);
  await repo.actualizar(operador.id, { pinHash: hashPin(validarPin(pin)), intentosFallidos: 0, bloqueadoHasta: null },
    { cerrarSesiones: true, exceptoSesionId });
  return { nombre: operador.nombre, advertencia: advertencia(pin) };
}

export async function desbloquear(id, { repo = operadoresAdminRepository } = {}) {
  const operador = await existente(id, repo);
  await repo.actualizar(operador.id, { intentosFallidos: 0, bloqueadoHasta: null });
  return { nombre: operador.nombre };
}

// Desactivar cierra sus sesiones. Nadie puede desactivarse a sí mismo.
export async function cambiarActivo(id, activo, { actorId = null, repo = operadoresAdminRepository } = {}) {
  const operador = await existente(id, repo);
  if (!activo && actorId === operador.id) throw error("NO_DESACTIVAR_PROPIO", "No podés desactivar tu propio usuario.", 409);
  await repo.actualizar(operador.id, activo ? { activo: true, intentosFallidos: 0, bloqueadoHasta: null } : { activo: false },
    { cerrarSesiones: !activo });
  return { nombre: operador.nombre, activo };
}

// Cambiar el rol cierra las sesiones: el permiso nuevo rige desde el próximo ingreso.
export async function cambiarRol(id, rol, { repo = operadoresAdminRepository } = {}) {
  const operador = await existente(id, repo);
  await repo.actualizar(operador.id, { rol: validarRol(rol) }, { cerrarSesiones: true });
  return { nombre: operador.nombre, rol };
}
