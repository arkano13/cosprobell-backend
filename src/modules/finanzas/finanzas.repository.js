import { prisma } from "../../infrastructure/database/prisma.js";
import { sincronizacionRepository } from "../sincronizacion/sincronizacion.repository.js";
import { FINANZAS, claveRegistro } from "../../shared/finanzas/contratos.js";
import { unidades, importe } from "../../shared/finanzas/decimal.js";

export const finanzasRepository = {
  conBloqueo: fn => sincronizacionRepository.conBloqueo(fn),
  async otraEmpresa(empresa, tx) {
    return await sincronizacionRepository.existeOtraEmpresa(empresa, tx) ||
      Boolean(await tx.finanzaControl.findFirst({ where: { empresa: { not: empresa } }, select: { entidad: true } }));
  },
  control: (entidad, db = prisma) => db.finanzaControl.findUnique({ where: { entidad } }),
  controles: () => prisma.finanzaControl.findMany({ orderBy: { entidad: "asc" } }),
  async iniciar(entidad, entrada, tx) {
    const { recorridoId, empresa } = entrada;
    const datos = { recorridoId, empresa, configuracion: entrada, iniciadoEn: new Date(), finalizadoEn: null,
      secuencia: 0, ultimoHash: null, cantidad: 0 };
    return tx.finanzaControl.upsert({ where: { entidad }, create: { entidad, ...datos }, update: datos });
  },
  async guardar(entidad, control, registros, tx) {
    const version = FINANZAS[entidad].snapshot ? control.recorridoId : "actual";
    for (const datos of registros) {
      const clave = claveRegistro(entidad, datos);
      const fila = { datos, cardCode: datos.cardCode ?? null, fecha: datos.fecha ? new Date(datos.fecha) : null,
        vencimiento: datos.vencimiento ? new Date(datos.vencimiento) : null,
        debe: datos.debe ?? null, haber: datos.haber ?? null,
        saldo: entidad === "partidas" ? importe(unidades(datos.pendienteDebe) - unidades(datos.pendienteHaber)) : null,
        actualizadoEn: new Date() };
      await tx.finanzaRegistro.upsert({ where: { entidad_version_clave: { entidad, version, clave } },
        create: { entidad, version, clave, ...fila }, update: fila });
    }
  },
  confirmar: (entidad, secuencia, ultimoHash, cantidad, tx) => tx.finanzaControl.update({ where: { entidad },
    data: { secuencia, ultimoHash, cantidad: { increment: cantidad } } }),
  async publicar(entidad, control, tx) {
    const ahora = new Date();
    await tx.finanzaControl.update({ where: { entidad }, data: { finalizadoEn: ahora, publicadoEn: ahora,
      lecturaPublicadaDesde: control.iniciadoEn, activoId: control.recorridoId } });
    if (FINANZAS[entidad].snapshot) await tx.finanzaRegistro.deleteMany({ where: { entidad,
      version: { notIn: [control.recorridoId, ...(control.activoId ? [control.activoId] : [])] } } });
  },
  listar: (where, take) => prisma.finanzaRegistro.findMany({ where, orderBy: { clave: "asc" }, take }),
  agruparVencimientos: where => prisma.finanzaRegistro.groupBy({ by: ["vencimiento"], where, _sum: { saldo: true } }),
  sumar: where => prisma.finanzaRegistro.aggregate({ where, _sum: { debe: true, haber: true } }),
};
