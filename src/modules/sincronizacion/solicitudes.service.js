import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import { AppError } from "../../shared/errors/AppError.js";

const entidades = ["clientes", "productos", "unidades", "codigosBarras", "pedidos", "almacenes", "existencias"];
const nombres = z.array(z.enum(entidades)).min(1).max(entidades.length).refine(v => new Set(v).size === v.length);
const consultaSchema = z.object({ entidades: nombres }).strict();
const progresoSchema = z.object({
  id: z.string().uuid(), completas: z.array(z.enum(entidades)).max(entidades.length),
  error: z.string().regex(/^[A-Z0-9_]{1,60}$/).optional(),
}).strict();
const activo = s => s && ["pendiente", "sincronizando"].includes(s.estado);
const fallo = (code, message, statusCode = 400) => new AppError({ code, message, statusCode });

// Una solicitud vigente por empresa. La fila existente de configuración permite desplegar
// sin migración; la transacción serializa clics simultáneos y confirmaciones del puente.
export const solicitudesRepository = {
  async cambiar(empresa, operacion) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20261007, 1)::text`;
      const clave = `sincronizacion.manual:${empresa}`;
      const previo = (await tx.configuracion.findUnique({ where: { clave } }))?.valor ?? {};
      const { siguiente, resultado } = operacion(previo);
      await tx.configuracion.upsert({ where: { clave }, create: { clave, valor: siguiente }, update: { valor: siguiente } });
      return resultado;
    });
  },
  async leer(empresa) {
    return (await prisma.configuracion.findUnique({ where: { clave: `sincronizacion.manual:${empresa}` } }))?.valor ?? {};
  },
};

export function crearServicioSolicitudes({ repo = solicitudesRepository, ahora = () => new Date(), uuid = randomUUID } = {}) {
  const validarEmpresa = empresa => {
    if (!empresa) throw fallo("PUENTE_NO_CONFIGURADO", "Configure la empresa SAP del puente", 503);
  };
  return {
    async estado(empresa) {
      validarEmpresa(empresa);
      const d = await repo.leer(empresa);
      return { solicitud: d.solicitud ?? null, ultimaConexion: d.ultimaConexion ?? null, entidades: d.entidades ?? [] };
    },
    async solicitar(empresa, operadorId) {
      validarEmpresa(empresa);
      return repo.cambiar(empresa, d => {
        if (activo(d.solicitud)) return { siguiente: d, resultado: d.solicitud };
        if (!d.entidades?.length) throw fallo("PUENTE_PENDIENTE_ACTUALIZACION", "Actualice el puente y ejecute una vez para habilitar el botón", 409);
        const fecha = ahora();
        if (d.solicitud && fecha - new Date(d.solicitud.creadaEn) < 60000) {
          throw fallo("SINCRONIZACION_MUY_RECIENTE", "Espere un minuto antes de solicitar otra actualización", 429);
        }
        const solicitud = { id: uuid(), estado: "pendiente", creadaEn: fecha.toISOString(),
          iniciadaEn: null, finalizadaEn: null, actualizadoEn: fecha.toISOString(),
          operadorId, entidades: [...d.entidades], completas: [], error: null };
        return { siguiente: { ...d, solicitud }, resultado: solicitud };
      });
    },
    async consultar(empresa, entrada) {
      validarEmpresa(empresa);
      const v = consultaSchema.safeParse(entrada);
      if (!v.success) throw fallo("SOLICITUD_INVALIDA", "Entidades inválidas");
      return repo.cambiar(empresa, d => {
        const fecha = ahora().toISOString();
        let solicitud = d.solicitud ?? null;
        if (activo(solicitud)) {
          if (solicitud.entidades.some(e => !v.data.entidades.includes(e))) {
            solicitud = { ...solicitud, estado: "error", error: "ENTIDADES_DESHABILITADAS", finalizadaEn: fecha, actualizadoEn: fecha };
          } else solicitud = { ...solicitud, estado: "sincronizando", iniciadaEn: solicitud.iniciadaEn ?? fecha, actualizadoEn: fecha };
        }
        return { siguiente: { ...d, entidades: v.data.entidades, ultimaConexion: fecha, solicitud },
          resultado: activo(solicitud) ? solicitud : null };
      });
    },
    async progreso(empresa, entrada) {
      validarEmpresa(empresa);
      const v = progresoSchema.safeParse(entrada);
      if (!v.success) throw fallo("SOLICITUD_INVALIDA", "Progreso inválido");
      return repo.cambiar(empresa, d => {
        let s = d.solicitud;
        if (!s || s.id !== v.data.id) throw fallo("SOLICITUD_NO_VIGENTE", "La solicitud ya no está vigente", 409);
        if (v.data.completas.some(e => !s.entidades.includes(e))) throw fallo("SOLICITUD_INVALIDA", "Entidad ajena a la solicitud");
        if (!activo(s)) return { siguiente: d, resultado: s };
        const fecha = ahora().toISOString();
        const completas = [...new Set([...s.completas, ...v.data.completas])];
        const estado = v.data.error ? "error" : completas.length === s.entidades.length ? "completado" : "sincronizando";
        s = { ...s, completas, estado, actualizadoEn: fecha, error: v.data.error ?? null,
          finalizadaEn: ["error", "completado"].includes(estado) ? fecha : null };
        return { siguiente: { ...d, solicitud: s, ultimaConexion: fecha }, resultado: s };
      });
    },
  };
}
export const solicitudesService = crearServicioSolicitudes();
