import { createHash } from "node:crypto";
import { ErrorPuente } from "./http.js";
import { expandirCientifico } from "./finanzas.transformar.js";

const mapa = texto => Object.fromEntries(texto.split(/\s+/).filter(Boolean).map(p => p.split(":")));
const documento = mapa(`docEntry:DocEntry docNum:DocNum serie:Series cardCode:CardCode fecha:DocDate vencimiento:DocDueDate
  fechaDocumento:TaxDate moneda:DocCurrency total:DocTotal totalFC:DocTotalFc totalSC:DocTotalSys pagado:PaidToDate
  pagadoFC:PaidToDateFC pagadoSC:PaidToDateSys estado:DocumentStatus vendedor:SalesPersonCode condicionPago:PaymentGroupCode transId:TransNum`);
const cabecera = mapa("docEntry:DocEntry cardCode:CardCode fecha:DocDate");
const linea = mapa(`linea:LineNum itemCode:ItemCode descripcion:ItemDescription cantidad:Quantity precio:Price total:LineTotal
  almacen:WarehouseCode baseTipo:BaseType baseEntry:BaseEntry baseLinea:BaseLine`);
const money = new Set(["CurrentAccountBalance", "CreditLimit", "DocTotal", "DocTotalFc", "DocTotalSys", "PaidToDate", "PaidToDateFC", "PaidToDateSys",
  "Quantity", "Price", "LineTotal", "Total", "TotalFC", "CashSum", "TransferSum", "SumApplied", "AppliedFC", "AppliedSys",
  "Debit", "Credit", "FCDebit", "FCCredit", "DebitSys", "CreditSys"]);
export async function leerJsonFinancieroGet(respuesta) {
  try {
    return JSON.parse(await respuesta.text(), (k, v, contexto) => {
      if (money.has(k) && typeof v === "number") {
        if (!contexto?.source) throw new Error("NODE_SIN_DECIMALES_EXACTOS");
        return expandirCientifico(contexto.source);
      }
      return v;
    });
  } catch { throw new ErrorPuente("JSON_FINANCIERO_INVALIDO"); }
}
function convertir(m, dato) { return Object.fromEntries(Object.entries(m).map(([destino, origen]) => [destino, dato[origen]])); }
function bandera(v) {
  if (["tYES", "Y"].includes(v)) return "Y";
  if (["tNO", "N"].includes(v)) return "N";
  throw new ErrorPuente("FINANZA_SAP_INVALIDA", false, { campo: "bandera" });
}
function cancelacionDocumento(d) {
  if (d.CancelStatus === "csCancellation") return "C";
  if (d.CancelStatus === "csYes") return "Y";
  return bandera(d.Cancelled);
}
export const camposNoDisponiblesGet = {
  clientes: ["saldoFC", "saldoSC"],
  cuotas: ["totalSC", "pagado", "pagadoFC", "pagadoSC", "estado"],
  pagos: ["transId", "total", "totalFC", "totalSC", "cheques", "tarjetas", "sinAplicarOriginal"],
  movimientos: ["documento"],
};
function base(nombre, recurso, clave, m, extra = {}) {
  return { nombre, recurso, clave, mapa: m, campos: [...new Set([clave, ...Object.values(m), ...(extra.campos ?? [])])], ...extra, nativo: true };
}
export function definicionesGetFinanzas(config) {
  const ruta = config.campoRuta, zona = config.campoZona;
  const defs = [
    { nombre: "empresa", nativo: true },
    base("clientes", "BusinessPartners", "CardCode", mapa(`cardCode:CardCode nombre:CardName moneda:Currency saldo:CurrentAccountBalance
      limiteCredito:CreditLimit vendedor:SalesPersonCode condicionPago:PayTermsGrpCode`), {
      filtro: "CardType eq 'cCustomer'", adicionales: ["Valid", "Frozen", ...[ruta, zona].filter(Boolean)],
      completar: d => ({ activo: bandera(d.Valid), bloqueado: bandera(d.Frozen), saldoFC: null, saldoSC: null,
        ruta: ruta ? d[ruta] ?? null : null, zona: zona ? d[zona] ?? null : null }) }),
    base("vendedores", "SalesPersons", "SalesEmployeeCode", mapa("codigo:SalesEmployeeCode nombre:SalesEmployeeName"), {
      adicionales: ["Active"], completar: d => ({ activo: bandera(d.Active) }) }),
    base("condicionesPago", "PaymentTermsTypes", "GroupNumber", mapa("codigo:GroupNumber nombre:PaymentTermsGroupName dias:NumberOfAdditionalDays meses:NumberOfAdditionalMonths cuotas:NumberOfInstallments")),
    ...[ ["facturas", "Invoices"], ["notasCredito", "CreditNotes"] ].map(([n, r]) => base(n, r, "DocEntry", documento, {
      historico: true, adicionales: ["Cancelled", "CancelStatus"], completar: d => ({ cancelado: cancelacionDocumento(d) }) })),
    ...[ ["facturaLineas", "Invoices"], ["notaCreditoLineas", "CreditNotes"] ].map(([n, r]) => base(n, r, "DocEntry", cabecera, {
      coleccion: "DocumentLines", claveLinea: "LineNum", mapaLinea: linea, historico: true })),
    base("cuotas", "Invoices", "DocEntry", cabecera, { coleccion: "DocumentInstallments", claveLinea: "InstallmentId", historico: true,
      mapaLinea: mapa("cuota:InstallmentId vencimiento:DueDate total:Total totalFC:TotalFC"),
      completar: () => ({ totalSC: null, pagado: null, pagadoFC: null, pagadoSC: null, estado: null }) }),
    base("pagos", "IncomingPayments", "DocEntry", mapa("docEntry:DocEntry docNum:DocNum serie:Series cardCode:CardCode fecha:DocDate moneda:DocCurrency efectivo:CashSum transferencia:TransferSum"), {
      filtro: "DocType eq 'rCustomer'", historico: true, adicionales: ["Cancelled"],
      completar: d => ({ cancelado: bandera(d.Cancelled), transId: null, total: null, totalFC: null, totalSC: null, cheques: null, tarjetas: null, sinAplicarOriginal: null }) }),
    base("aplicacionesPagos", "IncomingPayments", "DocEntry", mapa("pagoEntry:DocEntry cardCode:CardCode fecha:DocDate"), {
      filtro: "DocType eq 'rCustomer'", historico: true, adicionales: ["Cancelled"], coleccion: "PaymentInvoices", claveLinea: "LineNum",
      mapaLinea: mapa("linea:LineNum documento:DocEntry tipo:InvoiceType cuota:InstallmentId lineaDocumento:DocLine aplicado:SumApplied aplicadoFC:AppliedFC aplicadoSC:AppliedSys"),
      completar: d => ({ cancelado: bandera(d.Cancelled) }) }),
    // OriginalJournal es TransType: el documento que originó el asiento.
    // DocumentType es otra propiedad y puede ser null aun con origen confirmado.
    base("movimientos", "JournalEntries", "JdtNum", mapa("transId:JdtNum fecha:ReferenceDate fechaDocumento:TaxDate tipo:OriginalJournal referencia:BaseReference"), {
      coleccion: "JournalEntryLines", claveLinea: "Line_ID", completar: () => ({ documento: null }),
      mapaLinea: mapa("linea:Line_ID cardCode:ShortName vencimiento:DueDate monedaFC:FCCurrency debe:Debit haber:Credit debeFC:FCDebit haberFC:FCCredit debeSC:DebitSys haberSC:CreditSys") }),
  ];
  return Object.fromEntries(defs.map(d => {
    const hash = createHash("sha256").update(JSON.stringify(["get-puntual-v2", d, config.campoRuta, config.campoZona])).digest("hex");
    return [d.nombre, { ...d, hash }];
  }));
}
const literal = valor => typeof valor === "number" ? String(valor) : `'${valor.replaceAll("'", "''")}'`;
const enc = valor => encodeURIComponent(valor).replaceAll("'", "%27");

export async function leerPaginaGet({ sap, def, config, recorrido, cursorSap = null, tamano = 20 }) {
  if (def.nombre === "empresa") return { filas: cursorSap ? [] : [{ codigo: "empresa", monedaLocal: config.monedaLocal, monedaSistema: config.monedaSistema }],
    cursorSap: { id: "empresa", linea: null }, completo: Boolean(cursorSap) };
  const filtros = [def.filtro];
  if (cursorSap) filtros.push(`${def.clave} ${cursorSap.linea === null ? "gt" : "ge"} ${literal(cursorSap.id)}`);
  if (def.historico) filtros.push(`DocDate ge '${config.desde}'`);
  const campos = [...new Set([...def.campos, ...(def.adicionales ?? []), ...(def.coleccion ? [def.coleccion] : [])])];
  const limite = def.coleccion ? Math.min(tamano, 5) : tamano;
  const ruta = `${def.recurso}?$select=${campos.join(",")}&$orderby=${enc(def.clave + " asc")}&$top=${limite}` +
    (filtros.filter(Boolean).length ? `&$filter=${enc(filtros.filter(Boolean).map(f => `(${f})`).join(" and "))}` : "");
  const datos = await sap.leerRecursoFinanciero(ruta, leerJsonFinancieroGet);
  if (!Array.isArray(datos.value) || datos.value.length > limite ||
      (!datos.value.length && (datos["odata.nextLink"] || datos["@odata.nextLink"]))) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
  if (!datos.value.length) return { filas: [], cursorSap, completo: true };
  const filas = []; let siguiente = cursorSap;
  for (const d of datos.value) {
    const id = d[def.clave];
    if (!(def.clave === "CardCode" ? typeof id === "string" && id.length > 0 : Number.isSafeInteger(id)) ||
      (siguiente && ((typeof id === "number" && id < siguiente.id) || (siguiente.linea === null && id === siguiente.id)))) throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    if (!def.coleccion) {
      filas.push({ ...convertir(def.mapa, d), ...def.completar?.(d) });
      siguiente = { id, linea: null };
    } else {
      if (!Array.isArray(d[def.coleccion]) || Object.keys(d).some(k => /nextLink$/i.test(k))) throw new ErrorPuente("COLECCION_FINANCIERA_INCOMPLETA");
      const lineas = d[def.coleccion];
      if (lineas.some(l => !Number.isSafeInteger(l[def.claveLinea]) || l[def.claveLinea] < 0) || new Set(lineas.map(l => l[def.claveLinea])).size !== lineas.length) throw new ErrorPuente("FINANZA_SAP_INVALIDA");
      const pendientes = lineas.filter(l => !cursorSap || id !== cursorSap.id || cursorSap.linea === null || l[def.claveLinea] > cursorSap.linea)
        .sort((a, b) => a[def.claveLinea] - b[def.claveLinea]);
      const capacidad = 50 - filas.length;
      for (const l of pendientes.slice(0, capacidad)) {
        const registro = { ...convertir(def.mapa, d), ...convertir(def.mapaLinea, l), ...def.completar?.(d) };
        if (def.nombre === "movimientos") {
          if (!(typeof registro.tipo === "string" && registro.tipo.trim().length > 0 || Number.isSafeInteger(registro.tipo))) {
            throw new ErrorPuente("FINANZA_SAP_INVALIDA", false, { entidad: "movimientos", campo: "OriginalJournal", transId: id });
          }
          registro.tipo = String(registro.tipo);
        }
        filas.push(registro);
      }
      siguiente = { id, linea: pendientes.length > capacidad ? pendientes[capacidad - 1][def.claveLinea] : null };
      if (filas.length === 50) break;
    }
  }
  return { filas, cursorSap: siguiente, completo: false };
}
