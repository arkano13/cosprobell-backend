import { createHash } from "node:crypto";
import { FINANZAS } from "../src/shared/finanzas/contratos.js";

const columnas = (alias, lista) => Object.fromEntries(lista.split(/\s+/).filter(Boolean).map(p => {
  const [origen, destino = origen] = p.split(":"); return [destino, `${alias}.[${origen}]`];
}));
const docs = columnas("H", `DocEntry:docEntry DocNum:docNum Series:serie CardCode:cardCode DocDate:fecha DocDueDate:vencimiento
  TaxDate:fechaDocumento DocCur:moneda DocTotal:total DocTotalFC:totalFC DocTotalSy:totalSC PaidToDate:pagado PaidFC:pagadoFC PaidSys:pagadoSC
  DocStatus:estado CANCELED:cancelado SlpCode:vendedor GroupNum:condicionPago TransId:transId`);
const lineas = { ...columnas("H", "DocEntry:docEntry CardCode:cardCode DocDate:fecha"),
  ...columnas("L", `LineNum:linea ItemCode:itemCode Dscription:descripcion Quantity:cantidad Price:precio LineTotal:total
    WhsCode:almacen BaseType:baseTipo BaseEntry:baseEntry BaseLine:baseLinea`) };
const diario = columnas("L", `TransId:transId Line_ID:linea ShortName:cardCode RefDate:fecha DueDate:vencimiento TaxDate:fechaDocumento
  TransType:tipo CreatedBy:documento BaseRef:referencia FCCurrency:monedaFC Debit:debe Credit:haber FCDebit:debeFC FCCredit:haberFC SYSDeb:debeSC SYSCred:haberSC`);
const cambiosDocumento = `(H.[DocDate] >= :history OR H.[DocStatus] = 'O' OR H.[UpdateDate] >= :since)
  AND (H.[UpdateDate] >= :since OR H.[CreateDate] >= :since OR H.[DocStatus] = 'O')`;
const cambiosPago = `(H.[DocDate] >= :history OR H.[UpdateDate] >= :since OR H.[NoDocSum] <> 0)
  AND (H.[UpdateDate] >= :since OR H.[CreateDate] >= :since OR H.[NoDocSum] <> 0)`;
const cliente = "INNER JOIN [OCRD] C ON C.[CardCode] = L.[ShortName] AND C.[CardType] = 'C'";

export function definicionesSqlFinanzas(config) {
  const udf = nombre => nombre ? `H.[${nombre}]` : "NULL";
  const d = {
    empresa: { from: "[OADM] H", columnas: { codigo: "'empresa'", ...columnas("H", "MainCurncy:monedaLocal SysCurrncy:monedaSistema") } },
    clientes: { from: "[OCRD] H", filtro: "H.[CardType] = 'C'", columnas: {
      ...columnas("H", `CardCode:cardCode CardName:nombre validFor:activo frozenFor:bloqueado Currency:moneda Balance:saldo BalanceFC:saldoFC BalanceSys:saldoSC
        CreditLine:limiteCredito SlpCode:vendedor GroupNum:condicionPago`), zona: udf(config.campoZona), ruta: udf(config.campoRuta) } },
    vendedores: { from: "[OSLP] H", columnas: columnas("H", "SlpCode:codigo SlpName:nombre Active:activo") },
    condicionesPago: { from: "[OCTG] H", columnas: columnas("H", "GroupNum:codigo PymntGroup:nombre ExtraDays:dias ExtraMonth:meses InstNum:cuotas") },
    facturas: { from: "[OINV] H", columnas: docs, filtro: cambiosDocumento, incremental: true },
    facturaLineas: { from: "[OINV] H INNER JOIN [INV1] L ON H.[DocEntry] = L.[DocEntry]", columnas: lineas, filtro: cambiosDocumento, incremental: true },
    cuotas: { from: "[OINV] H INNER JOIN [INV6] L ON H.[DocEntry] = L.[DocEntry]", filtro: cambiosDocumento, incremental: true,
      columnas: { ...columnas("H", "DocEntry:docEntry CardCode:cardCode DocDate:fecha"),
        ...columnas("L", `InstlmntID:cuota DueDate:vencimiento InsTotal:total InsTotalFC:totalFC InsTotalSy:totalSC PaidToDate:pagado PaidFC:pagadoFC PaidSys:pagadoSC Status:estado`) } },
    notasCredito: { from: "[ORIN] H", columnas: docs, filtro: cambiosDocumento, incremental: true },
    notaCreditoLineas: { from: "[ORIN] H INNER JOIN [RIN1] L ON H.[DocEntry] = L.[DocEntry]", columnas: lineas, filtro: cambiosDocumento, incremental: true },
    pagos: { from: "[ORCT] H", filtro: `H.[DocType] = 'C' AND ${cambiosPago}`, incremental: true,
      columnas: columnas("H", `DocEntry:docEntry DocNum:docNum Series:serie CardCode:cardCode DocDate:fecha DocCurr:moneda Canceled:cancelado TransId:transId
        DocTotal:total DocTotalFC:totalFC DocTotalSy:totalSC CashSum:efectivo TrsfrSum:transferencia CheckSum:cheques CreditSum:tarjetas NoDocSum:sinAplicarOriginal`) },
    aplicacionesPagos: { from: "[ORCT] H INNER JOIN [RCT2] L ON H.[DocEntry] = L.[DocNum]", filtro: `H.[DocType] = 'C' AND ${cambiosPago}`, incremental: true,
      columnas: { ...columnas("H", "DocEntry:pagoEntry CardCode:cardCode DocDate:fecha Canceled:cancelado"),
        ...columnas("L", "InvoiceId:linea DocEntry:documento InvType:tipo InstId:cuota DocLine:lineaDocumento SumApplied:aplicado AppliedFC:aplicadoFC AppliedSys:aplicadoSC") } },
    conciliaciones: { from: `[OITR] H INNER JOIN [ITR1] L ON H.[ReconNum] = L.[ReconNum] ${cliente}`,
      columnas: { ...columnas("H", "ReconNum:reconNum ReconDate:fecha Canceled:cancelado CancelAbs:cancelacion ReconType:tipoConciliacion"),
        ...columnas("L", `LineSeq:linea ShortName:cardCode TransId:transId TransRowId:lineaAsiento SrcObjTyp:tipo SrcObjAbs:documento
          InstID:cuota FrgnCurr:monedaFC IsCredit:sentido ReconSum:aplicado ReconSumFC:aplicadoFC ReconSumSC:aplicadoSC`) } },
    movimientos: { from: `[OJDT] H INNER JOIN [JDT1] L ON H.[TransId] = L.[TransId] ${cliente}`, columnas: diario,
      filtro: "(H.[UpdateDate] >= :since OR H.[CreateDate] >= :since)", incremental: true, historialContable: true },
    partidas: { from: `[JDT1] L ${cliente}`, columnas: { ...diario,
      ...columnas("L", `BalDueDeb:pendienteDebe BalDueCred:pendienteHaber BalFcDeb:pendienteDebeFC BalFcCred:pendienteHaberFC
        BalScDeb:pendienteDebeSC BalScCred:pendienteHaberSC`) },
      filtro: "(L.[BalDueDeb] <> 0 OR L.[BalDueCred] <> 0 OR L.[BalFcDeb] <> 0 OR L.[BalFcCred] <> 0 OR L.[BalScDeb] <> 0 OR L.[BalScCred] <> 0)" },
  };
  return Object.fromEntries(Object.entries(d).map(([nombre, valor]) => {
    const claves = FINANZAS[nombre].claves.map(k => valor.columnas[k]);
    const cursor = claves.map((k, i) => `(${[...claves.slice(0, i).map((p, j) => `${p} = :k${j}`), `${k} > :k${i}`].join(" AND ")})`).join(" OR ");
    const sql = `SELECT TOP 50 ${Object.entries(valor.columnas).map(([campo, expr]) => `${expr} AS [${campo}]`).join(", ")} FROM ${valor.from}
      WHERE (${cursor})${valor.filtro ? ` AND (${valor.filtro})` : ""} ORDER BY ${claves.join(", ")}`;
    const hash = createHash("sha256").update(sql).digest("hex");
    return [nombre, { ...valor, nombre, hash, consulta: { SqlCode: `CP_FIN_${hash.slice(0, 20)}`, SqlName: `Cosprobell finanzas ${nombre}`, SqlText: sql } }];
  }));
}
