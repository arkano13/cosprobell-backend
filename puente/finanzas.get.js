import { createHash } from "node:crypto";
import { ErrorPuente } from "./http.js";

// Lectura financiera solo con GET sobre recursos de Service Layer: no registra ni usa SQLQueries.
// Primera etapa: facturas y sus líneas. Notas de crédito, pagos, cartera y el resto quedan pendientes.
// InternalReconciliations no se puede listar por GET en este SAP (HTTP 500 / 400), por eso no hay conciliaciones.

const ESTADOS = { bost_Open: "O", bost_Close: "C" };
const CANCELACIONES = { csNo: "N", csYes: "Y", csCancellation: "C" };
const CABECERA = ["DocEntry", "DocNum", "Series", "CardCode", "DocDate", "DocDueDate", "TaxDate", "DocCurrency",
  "DocTotal", "DocTotalFc", "DocTotalSys", "PaidToDate", "PaidToDateFC", "PaidToDateSys",
  "DocumentStatus", "CancelStatus", "SalesPersonCode", "PaymentGroupCode", "TransNum"];
// Una factura trae todas sus líneas: pocas facturas por GET mantienen la respuesta acotada.
const FACTURAS_POR_GET_LINEAS = 10;

// Importes con el texto exacto de SAP: un decimal nunca pasa por Number.
export async function lectorExacto(respuesta) {
  try {
    return JSON.parse(await respuesta.text(), (k, v, contexto) => {
      if (typeof v !== "number" || Number.isSafeInteger(v)) return v;
      if (!contexto?.source) throw new Error("NODE_SIN_DECIMALES_EXACTOS");
      return contexto.source;
    });
  } catch { throw new ErrorPuente("JSON_FINANCIERO_INVALIDO"); }
}
const importe = v => Number.isSafeInteger(v) ? String(v) : v;
const fechaSap = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "")) throw new ErrorPuente("CURSOR_INVALIDO"); return v; };
const entero = v => { if (!Number.isSafeInteger(v)) throw new ErrorPuente("CURSOR_INVALIDO"); return v; };
const invalida = (entidad, campo) => new ErrorPuente("FINANZA_SAP_INVALIDA", false, { entidad, campo });

// Mismo criterio que la consulta SQL original. Carga completa (since = history): documentos del período,
// abiertos o modificados. Cambios: además, solo los creados, modificados o abiertos desde la ventana.
export function filtroCambios({ history, since }) {
  const h = fechaSap(history), s = fechaSap(since);
  const base = `(DocDate ge '${h}' or DocumentStatus eq 'bost_Open' or UpdateDate ge '${s}')`;
  return s > h ? `${base} and (UpdateDate ge '${s}' or CreationDate ge '${s}' or DocumentStatus eq 'bost_Open')` : base;
}
function ruta(campos, filtro, tamano) {
  // Misma forma que el resto del puente: "$" literal y valores con encodeURIComponent.
  return `Invoices?$select=${campos.join(",")}&$orderby=${encodeURIComponent("DocEntry asc")}&$top=${tamano}&$filter=${encodeURIComponent(filtro)}`;
}
export function facturaDesdeSap(f) {
  const estado = ESTADOS[f.DocumentStatus];
  if (!estado) throw invalida("facturas", "estado");
  return { docEntry: f.DocEntry, docNum: f.DocNum, serie: f.Series, cardCode: f.CardCode, fecha: f.DocDate,
    vencimiento: f.DocDueDate, fechaDocumento: f.TaxDate, moneda: f.DocCurrency,
    total: importe(f.DocTotal), totalFC: importe(f.DocTotalFc), totalSC: importe(f.DocTotalSys),
    pagado: importe(f.PaidToDate), pagadoFC: importe(f.PaidToDateFC), pagadoSC: importe(f.PaidToDateSys),
    estado, cancelado: CANCELACIONES[f.CancelStatus] ?? f.CancelStatus,
    vendedor: f.SalesPersonCode, condicionPago: f.PaymentGroupCode, transId: f.TransNum };
}
function lineasDeFactura(f) {
  if (Object.keys(f).some(k => k.startsWith("DocumentLines") && /nextlink/i.test(k)) || !Array.isArray(f.DocumentLines)) {
    throw invalida("facturaLineas", "DocumentLines");
  }
  return f.DocumentLines.map(l => ({ docEntry: f.DocEntry, linea: l.LineNum, cardCode: f.CardCode, fecha: f.DocDate,
    itemCode: l.ItemCode, descripcion: l.ItemDescription, cantidad: importe(l.Quantity), precio: importe(l.Price),
    total: importe(l.LineTotal), almacen: l.WarehouseCode, baseTipo: l.BaseType, baseEntry: l.BaseEntry, baseLinea: l.BaseLine }))
    .sort((a, b) => a.linea - b.linea);
}
async function paginaFacturas(sap, p, tamano = 50) {
  const filtro = `DocEntry gt ${entero(p.k0)} and (${filtroCambios(p)})`;
  return (await sap.paginaGet(ruta(CABECERA, filtro, tamano), tamano, lectorExacto)).map(facturaDesdeSap);
}
// Cursor (docEntry, línea): se vuelve a pedir la factura del cursor para seguir después de su última línea enviada.
async function paginaLineas(sap, p, tamano = 50) {
  const k0 = entero(p.k0), k1 = entero(p.k1), registros = [];
  let condicion = `DocEntry ge ${k0}`;
  for (let vuelta = 0; ; vuelta++) {
    const facturas = await sap.paginaGet(ruta(["DocEntry", "CardCode", "DocDate", "DocumentLines"],
      `${condicion} and (${filtroCambios(p)})`, FACTURAS_POR_GET_LINEAS), FACTURAS_POR_GET_LINEAS, lectorExacto);
    for (const f of facturas) {
      for (const l of lineasDeFactura(f)) {
        if (f.DocEntry < k0 || (f.DocEntry === k0 && !(l.linea > k1))) continue;
        registros.push(l);
        if (registros.length === tamano) return registros;
      }
    }
    // Fin del recorrido, o página con líneas suficientes para enviar sin agotar el presupuesto.
    if (facturas.length < FACTURAS_POR_GET_LINEAS || (registros.length && vuelta >= 2)) return registros;
    condicion = `DocEntry gt ${entero(facturas.at(-1).DocEntry)}`;
  }
}
const huella = texto => createHash("sha256").update(texto).digest("hex");
export function definicionesGetFinanzas() {
  const comun = { incremental: true, lectura: "get" };
  return {
    facturas: { ...comun, nombre: "facturas", hash: huella(`get-v1 Invoices ${CABECERA.join(",")}`), leer: paginaFacturas },
    facturaLineas: { ...comun, nombre: "facturaLineas", hash: huella("get-v1 Invoices DocumentLines"), leer: paginaLineas },
  };
}
