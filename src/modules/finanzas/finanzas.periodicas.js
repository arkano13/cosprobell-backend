import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma.js";
import { claveRegistro } from "../../shared/finanzas/contratos.js";
import { actualizacionFinancieraSchema, entidadesPeriodicas } from "../../shared/finanzas/periodicas.js";
import { TABLAS_FINANZAS, columna } from "./finanzas.tablas.js";
import { guardarNormalizados } from "./finanzas.normalizar.js";
import { finanzasRepository as repo } from "./finanzas.repository.js";
import { falloFinanzas } from "./finanzas.ingreso.js";

async function controlesListos(tx, empresa) {
  if (!empresa || await repo.otraEmpresa(empresa, tx)) throw falloFinanzas("ORIGEN_INCOMPATIBLE", "Empresa financiera distinta");
  const controles = Object.fromEntries((await tx.finanzaControl.findMany()).map(c => [c.entidad, c]));
  const normalizados = Object.fromEntries((await tx.finanzaNormalizacion.findMany()).map(n => [n.entidad, n]));
  for (const e of entidadesPeriodicas) {
    const c = controles[e], n = normalizados[e];
    if (!c?.finalizadoEn || c.empresa !== empresa || !c.activoId || c.activoId !== c.recorridoId ||
        c.configuracion.lectura !== "get_parcial" || !n?.finalizadoEn || n.version !== c.activoId) {
      throw falloFinanzas("FINANZAS_PERIODICAS_NO_LISTAS", "Complete y normalice las doce entidades antes de activar las actualizaciones");
    }
  }
  return controles;
}

export async function estadoPeriodico(empresa, db = prisma) {
  return repo.conBloqueo(async tx => {
    const controles = await controlesListos(tx, empresa);
    const maximos = {};
    for (const [grupo, modelo, campo] of [["facturas", "factura", "docEntry"], ["notasCredito", "notaCredito", "docEntry"],
      ["pagos", "pago", "docEntry"], ["movimientos", "movimientoContable", "transId"]]) {
      maximos[grupo] = (await tx[modelo].aggregate({ where: { finVersion: controles[grupo].activoId }, _max: { [campo]: true } }))._max[campo] ?? -1;
    }
    return { protocolo: 1, listo: true, empresa, maximos, versiones: Object.fromEntries(entidadesPeriodicas.map(e => [e, controles[e].activoId])),
      desde: controles.empresa.configuracion.desde, monedaLocal: controles.empresa.configuracion.monedaLocal,
      monedaSistema: controles.empresa.configuracion.monedaSistema,
      ultimaLectura: Object.fromEntries(entidadesPeriodicas.map(e => [e, controles[e].lecturaPublicadaDesde ?? controles[e].iniciadoEn])) };
  }, db);
}

export async function recibirActualizacion(entrada, empresa, db = prisma) {
  const v = actualizacionFinancieraSchema.safeParse(entrada);
  if (!v.success) throw falloFinanzas("ACTUALIZACION_FINANCIERA_INVALIDA", "Documento financiero incompleto o inválido", 400);
  const d = v.data;
  if (d.empresa !== empresa) throw falloFinanzas("EMPRESA_NO_AUTORIZADA", "Empresa distinta", 403);
  const hash = createHash("sha256").update(JSON.stringify(d)).digest("hex");
  return repo.conBloqueo(async tx => {
    const acuse = await tx.finanzaActualizacion.findUnique({ where: { operacionId: d.operacionId } });
    if (acuse) {
      if (acuse.empresa !== empresa || acuse.hash !== hash) throw falloFinanzas("OPERACION_FINANCIERA_MODIFICADA", "La operación ya se usó con otro contenido");
      return { ...acuse.respuesta, repetido: true };
    }
    const controles = await controlesListos(tx, empresa);
    const grupos = Object.keys(d.registros);
    for (const e of grupos) {
      const c = controles[e];
      if (c.activoId !== d.versiones[e]) throw falloFinanzas("VERSION_FINANCIERA_CAMBIO", "Cambió la carga base; revise el estado antes de continuar");
      if (c.configuracion.monedaLocal !== d.monedaLocal || c.configuracion.monedaSistema !== d.monedaSistema) {
        throw falloFinanzas("MONEDA_EMPRESA_DISTINTA", "Monedas distintas de la carga original");
      }
    }
    // Primero un cliente nuevo si fue necesario obtenerlo para este documento.
    grupos.sort((a, b) => Number(b === "clientes") - Number(a === "clientes"));
    const ahora = new Date(), cambios = [];
    for (const e of grupos) {
      const filas = d.registros[e], c = controles[e], version = c.activoId;
      const claves = filas.map(r => claveRegistro(e, r));
      const esDetalle = ["facturaLineas", "cuotas", "notaCreditoLineas", "aplicacionesPagos", "movimientos"].includes(e);
      const idCampo = e === "aplicacionesPagos" ? "pagoEntry" : e === "movimientos" ? "transId" : "docEntry";
      const id = d.registros[d.grupo][0].docEntry ?? d.registros[d.grupo][0].transId;
      const scope = esDetalle ? { datos: { path: [idCampo], equals: id } } : { clave: { in: claves } };
      const previas = await tx.finanzaRegistro.findMany({ where: { entidad: e, version, ...scope }, select: { clave: true, datos: true } });
      const iguales = previas.length === filas.length && filas.every(r => {
        const anterior = previas.find(f => f.clave === claveRegistro(e, r))?.datos;
        // JSONB no conserva el orden de las propiedades.
        return anterior && Object.keys(r).every(k => anterior[k] === r[k]);
      });
      if (iguales) continue;
      if (esDetalle) {
        const sobrantes = previas.filter(r => !claves.includes(r.clave)).map(r => r.clave);
        if (sobrantes.length) {
          await tx.finanzaRegistro.deleteMany({ where: { entidad: e, version, clave: { in: sobrantes } } });
          await tx[TABLAS_FINANZAS[e].modelo].deleteMany({ where: { finVersion: version,
            [columna(e, idCampo)]: id, finClave: { in: sobrantes } } });
        }
      }
      await repo.guardar(e, c, filas, tx);
      await guardarNormalizados(e, filas, version, { iniciadoEn: ahora }, tx);
      const cantidad = await tx.finanzaRegistro.count({ where: { entidad: e, version } });
      await tx.finanzaNormalizacion.update({ where: { entidad: e }, data: { cantidad, actualizadoEn: ahora } });
      // No reemplazar publicadoEn: sigue identificando la lectura histórica completa.
      await tx.finanzaControl.update({ where: { entidad: e }, data: { cantidad,
        configuracion: { ...c.configuracion, periodica: { revision: randomUUID(), actualizadaEn: ahora.toISOString() } } } });
      cambios.push(e);
    }
    const respuesta = { operacionId: d.operacionId, normalizado: true, entidades: grupos, cambios, repetido: false };
    await tx.finanzaActualizacion.create({ data: { operacionId: d.operacionId, empresa, hash, respuesta } });
    return respuesta;
  }, db).catch(e => {
    if (["RELACION_FINANCIERA_FALTANTE", "VERIFICACION_FINANCIERA_FALLIDA"].includes(e.code)) throw falloFinanzas(e.code, "Revise las relaciones y los datos del documento financiero");
    throw e;
  });
}
