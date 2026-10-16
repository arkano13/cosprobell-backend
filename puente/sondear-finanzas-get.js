import { pathToFileURL } from "node:url";
import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";

// Campos confirmados en el catálogo de SAP de Cosprobell. No imprime valores.
const recursos = [
  ["BusinessPartners", "CardCode", ["CardCode", "CurrentAccountBalance", "SalesPersonCode", "PayTermsGrpCode", "U_ZONA"], "CardType eq 'cCustomer'"],
  ["Invoices", "DocEntry", ["DocEntry", "DocTotal", "DocTotalFc", "DocTotalSys", "PaidToDate", "PaidToDateFC", "PaidToDateSys", "Cancelled", "DocumentInstallments"]],
  ["CreditNotes", "DocEntry", ["DocEntry", "DocTotal", "PaidToDate", "Cancelled", "DocumentLines"]],
  ["IncomingPayments", "DocEntry", ["DocEntry", "Cancelled", "PaymentInvoices"]],
  ["SalesPersons", "SalesEmployeeCode", ["SalesEmployeeCode", "SalesEmployeeName", "Active"]],
  ["PaymentTermsTypes", "GroupNumber", ["GroupNumber", "PaymentTermsGroupName", "NumberOfInstallments"]],
  ["JournalEntries", "JdtNum", ["JdtNum", "JournalEntryLines"]],
  ["InternalReconciliations", "ReconNum", ["ReconNum", "CancelAbs", "InternalReconciliationRows"]],
  ["Currencies", "Code", ["Code", "Name"]],
];

export async function sondearFinanzasGet(sap, emitir = console.log) {
  let fallos = 0;
  for (const [recurso, claveSap, campos, filtro] of recursos) {
    try {
      const filas = await sap.pagina(null, { recurso, claveSap, campos, filtro, tamanoPagina: 1 });
      emitir(JSON.stringify({ evento: "sondeo_get", recurso, resultado: "OK", registros: filas.length,
        camposAusentes: filas.length ? campos.filter(campo => !Object.hasOwn(filas[0], campo)) : [],
        coleccionesPaginadas: filas.length ? Object.keys(filas[0]).filter(campo => /nextLink$/i.test(campo)) : [],
      }));
    } catch (error) {
      fallos++;
      emitir(JSON.stringify({ evento: "sondeo_get", recurso, resultado: "FALLO", codigo: error.code ?? "ERROR_LOCAL" }));
      if (["HTTP_401", "CONEXION_O_TLS", "PRESUPUESTO_AGOTADO"].includes(error.code)) break;
    }
  }
  emitir(JSON.stringify({ evento: "sondeo_get_fin", fallos }));
  return fallos;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let sap;
  try {
    if (process.argv.length !== 2) throw new Error("Argumentos inválidos");
    const config = configurar(process.env);
    config.control = crearControl(config);
    sap = crearClienteSap(config);
    process.exitCode = await sondearFinanzasGet(sap) ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ evento: "sondeo_get_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
    process.exitCode = 1;
  } finally { await sap?.cerrar().catch(() => {}); }
}
