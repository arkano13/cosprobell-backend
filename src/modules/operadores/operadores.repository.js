import { prisma } from "../../infrastructure/database/prisma.js";

export const operadoresRepository = {
  listarActivos() {
    return prisma.operador.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  },

  buscarPorId(id) {
    return prisma.operador.findUnique({ where: { id } });
  },

  // Suma un intento fallido de forma atómica y devuelve el total actualizado.
  async sumarIntentoFallido(id) {
    const { intentosFallidos } = await prisma.operador.update({
      where: { id }, data: { intentosFallidos: { increment: 1 } }, select: { intentosFallidos: true },
    });
    return intentosFallidos;
  },

  bloquear(id, hasta) {
    return prisma.operador.update({ where: { id }, data: { bloqueadoHasta: hasta } });
  },

  reiniciarIntentos(id) {
    return prisma.operador.update({ where: { id }, data: { intentosFallidos: 0, bloqueadoHasta: null } });
  },

  crearSesion({ operadorId, tokenHash, aplicacion, expiraEn }) {
    return prisma.sesionOperador.create({ data: { operadorId, tokenHash, aplicacion, expiraEn } });
  },

  buscarSesion(tokenHash) {
    return prisma.sesionOperador.findUnique({ where: { tokenHash }, include: { operador: { select: { id: true, nombre: true, activo: true } } } });
  },

  cerrarSesion(id, cuando) {
    return prisma.sesionOperador.update({ where: { id }, data: { cerradaEn: cuando } });
  },
};
