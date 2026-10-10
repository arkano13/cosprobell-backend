import { FINANZAS } from "../../shared/finanzas/contratos.js";
import { importe, unidades } from "../../shared/finanzas/decimal.js";
import { finanzasRepository as repo } from "./finanzas.repository.js";
import { exigirEntidad, falloFinanzas } from "./finanzas.ingreso.js";

export async function contextoFinanciero(entidad, version) {
  exigirEntidad(entidad);
  const control = await repo.control(entidad);
  if (!control?.publicadoEn || !control.activoId) throw falloFinanzas("FINANZAS_SIN_CARGA_COMPLETA", "Esta información aún no completó su primera carga", 503);
  if (version && version !== control.activoId) throw falloFinanzas("VERSION_FINANCIERA_CAMBIO", "La información cambió; reinicie la consulta");
  return { control, where: { entidad, version: FINANZAS[entidad].snapshot ? control.activoId : "actual" },
    meta: { version: control.activoId, ultimaCargaCompleta: control.publicadoEn, enActualizacion: !control.finalizadoEn,
      inicioLectura: control.lecturaPublicadaDesde, desdeDocumentos: control.configuracion.desde,
      monedaLocal: control.configuracion.monedaLocal, monedaSistema: control.configuracion.monedaSistema,
      validadoContraSap: false, criterio: "Lectura paginada de SAP; no es una instantánea transaccional de SAP" } };
}
export async function listarFinanzas(entidad, query) {
  const { where, meta } = await contextoFinanciero(entidad, query.version);
  if (query.cardCode) where.cardCode = query.cardCode;
  if (query.cursor) where.clave = { gt: query.cursor };
  if (query.desde || query.hasta) where.fecha = { ...(query.desde ? { gte: new Date(query.desde) } : {}), ...(query.hasta ? { lte: new Date(query.hasta) } : {}) };
  const filas = await repo.listar(where, query.limit + 1);
  const hayMas = filas.length > query.limit;
  if (hayMas) filas.pop();
  const data = filas.map(({ datos }) => ["facturas", "notasCredito", "cuotas"].includes(entidad) ? { ...datos,
    pendienteDocumentoLocal: importe(unidades(datos.total) - unidades(datos.pagado)),
    pendienteDocumentoFC: importe(unidades(datos.totalFC) - unidades(datos.pagadoFC)),
    pendienteDocumentoSC: importe(unidades(datos.totalSC) - unidades(datos.pagadoSC)) } : datos);
  return { data, meta: { ...meta, siguienteCursor: hayMas ? filas.at(-1).clave : null } };
}
export function resumirAntiguedad(grupos, corte) {
  const totales = { porVencer: 0n, dias1a30: 0n, dias31a60: 0n, dias61a90: 0n, masDe90: 0n, sinVencimiento: 0n, saldoAFavor: 0n };
  for (const grupo of grupos) {
    const saldo = unidades(String(grupo._sum.saldo ?? "0"));
    if (saldo < 0n) { totales.saldoAFavor += saldo; continue; }
    if (!grupo.vencimiento) { totales.sinVencimiento += saldo; continue; }
    const dias = Math.floor((Date.parse(corte) - new Date(grupo.vencimiento).getTime()) / 86400000);
    const tramo = dias <= 0 ? "porVencer" : dias <= 30 ? "dias1a30" : dias <= 60 ? "dias31a60" : dias <= 90 ? "dias61a90" : "masDe90";
    totales[tramo] += saldo;
  }
  return { ...Object.fromEntries(Object.entries(totales).map(([k, v]) => [k, importe(v)])),
    saldoNeto: importe(Object.values(totales).reduce((a, b) => a + b, 0n)) };
}
export async function consultarCartera(cardCode) {
  const { control, where, meta } = await contextoFinanciero("partidas");
  const { control: c, where: clientesWhere } = await contextoFinanciero("clientes");
  const cliente = (await repo.listar({ ...clientesWhere, cardCode }, 1))[0];
  if (!cliente) throw falloFinanzas("CLIENTE_NO_ENCONTRADO", "Cliente no recibido en la carga financiera", 404);
  const corte = new Date(control.publicadoEn).toISOString().slice(0, 10);
  // Separar créditos y débitos evita que un anticipo oculte deuda vencida en un tramo.
  const grupos = await repo.agruparVencimientos({ ...where, cardCode, saldo: { gte: "0" } });
  const creditos = await repo.agruparVencimientos({ ...where, cardCode, saldo: { lt: "0" } });
  const resultado = resumirAntiguedad([...grupos, ...creditos], corte);
  const despues = await repo.control("partidas");
  if (despues.activoId !== control.activoId) throw falloFinanzas("VERSION_FINANCIERA_CAMBIO", "La cartera cambió; repita la consulta");
  return { data: { cardCode, corte, moneda: meta.monedaLocal, ...resultado,
    saldoFichaSap: cliente?.datos.saldo ?? null,
    diferenciaConFicha: cliente ? importe(unidades(resultado.saldoNeto) - unidades(cliente.datos.saldo)) : null },
    meta: { ...meta, saldoFichaAl: c?.publicadoEn ?? null, advertencia: "Comparar con SAP al mismo corte. Los importes son en moneda local; los saldos FC/SC están en cada partida." } };
}
export async function consultarEstadoCuenta(cardCode, query) {
  const { control, where, meta } = await contextoFinanciero("movimientos", query.version);
  if (!control.finalizadoEn) throw falloFinanzas("FINANZAS_EN_ACTUALIZACION", "Espere a que termine la actualización del estado de cuenta", 503);
  const hastaDisponible = new Date(control.publicadoEn).toISOString().slice(0, 10);
  if (query.hasta > hastaDisponible || query.desde < control.configuracion.desde) throw falloFinanzas("PERIODO_NO_DISPONIBLE", "Período fuera del alcance confirmado", 400);
  const inicial = await repo.sumar({ ...where, cardCode, fecha: { lt: new Date(query.desde) } });
  const periodoWhere = { ...where, cardCode, fecha: { gte: new Date(query.desde), lte: new Date(query.hasta) } };
  const periodo = await repo.sumar(periodoWhere);
  const neto = r => unidades(String(r._sum.debe ?? "0")) - unidades(String(r._sum.haber ?? "0"));
  const filas = await repo.listar({ ...periodoWhere, ...(query.cursor ? { clave: { gt: query.cursor } } : {}) }, query.limit + 1);
  const hayMas = filas.length > query.limit;
  if (hayMas) filas.pop();
  // Una actualización concurrente invalida el resultado, en lugar de mezclar cortes.
  const despues = await repo.control("movimientos");
  if (despues.recorridoId !== control.recorridoId || !despues.finalizadoEn) throw falloFinanzas("VERSION_FINANCIERA_CAMBIO", "Reinicie la consulta después de la actualización");
  return { data: { cardCode, moneda: meta.monedaLocal, desde: query.desde, hasta: query.hasta,
    saldoInicial: importe(neto(inicial)), cargos: String(periodo._sum.debe ?? "0"), abonos: String(periodo._sum.haber ?? "0"),
    saldoFinal: importe(neto(inicial) + neto(periodo)), movimientos: filas.map(r => r.datos) },
    meta: { ...meta, siguienteCursor: hayMas ? filas.at(-1).clave : null } };
}
