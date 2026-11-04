// Compara cabeceras recientes con el filtro operativo. Solo GET a SAP;
// sin llamadas al backend ni cambios de estado/caché.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { tomarCandado } from "./candado.js";
import { desdeFacturas } from "./sincronizar.js";
import { leerJson, ErrorPuente } from "./http.js";

let sap, liberar;
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && !/^--numeros=\d+(?:,\d+){0,4}$/.test(args[0])) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
  const numeros = args[0]?.slice(10).split(",").map(Number);
  if (numeros?.some(n => !Number.isSafeInteger(n) || n < 0 || n > 2147483647)) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
  const config = configurar(process.env);
  if (config.fuentePreparacion !== "facturas") throw new ErrorPuente("FUENTE_NO_ES_FACTURAS");
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  const estado = JSON.parse(await readFile(join(config.directorio, "facturasPreparacion.json"), "utf8"));
  if (estado.origen !== config.origen) throw new ErrorPuente("ORIGEN_INCOMPATIBLE");
  const desde = estado.desdeRecorrido ?? desdeFacturas(config, estado);
  const filtro = `DocType eq 'dDocument_Items' and ReserveInvoice eq 'tNO' and DocDate ge '${desde}'`;
  console.log(JSON.stringify({ evento: "alcance_facturas", empresa: config.empresa, horaEquipo: new Date().toString(),
    diasConfigurados: config.facturasDias, desde, ultimoCompleto: estado.ultimoCompleto, cursor: estado.cursor,
    recorridoEnCurso: Boolean(estado.inicioRecorrido || estado.pendiente), filtro }));
  config.control = crearControl(config);
  sap = crearClienteSap(config);
  if (numeros) {
    const camposDetalle = "DocEntry,DocNum,DocDate,DocType,ReserveInvoice,Cancelled,CancelStatus,DocumentStatus,DocumentLines";
    const condicion = numeros.map(n => `DocNum eq ${n}`).join(" or ");
    const datos = await sap.leerRecursoFinanciero(`Invoices?$select=${camposDetalle}&$filter=${encodeURIComponent(condicion)}&$top=5`, leerJson);
    if (!Array.isArray(datos.value) || datos.value.length > 5) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
    for (const f of datos.value) console.log(JSON.stringify({ evento: "detalle_factura_sap", docEntry: f.DocEntry,
      numero: f.DocNum, fecha: f.DocDate, tipo: f.DocType, reserva: f.ReserveInvoice, cancelada: f.Cancelled,
      cancelStatus: f.CancelStatus, estado: f.DocumentStatus, lineasDisponibles: Array.isArray(f.DocumentLines),
      coleccionPaginada: Object.keys(f).some(k => k.startsWith("DocumentLines") && /nextlink/i.test(k)),
      lineas: Array.isArray(f.DocumentLines) ? f.DocumentLines.map(l => ({ linea: l.LineNum, articulo: l.ItemCode,
        cantidad: l.Quantity, almacen: l.WarehouseCode, estado: l.LineStatus })) : null }));
    console.log(JSON.stringify({ evento: "detalle_facturas_fin", encontradas: datos.value.length }));
  } else {
  const campos = "DocEntry,DocNum,DocDate,DocType,ReserveInvoice";
  for (const [muestra, condicion] of [["ultimas_sin_filtro", null], ["con_filtro_operativo", filtro]]) {
    const ruta = `Invoices?$select=${campos}&$orderby=DocEntry%20desc&$top=5` +
      (condicion ? `&$filter=${encodeURIComponent(condicion)}` : "");
    const datos = await sap.leerRecursoFinanciero(ruta, leerJson);
    if (!Array.isArray(datos.value) || datos.value.length > 5) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
    console.log(JSON.stringify({ evento: "muestra_facturas", muestra, cantidadMuestra: datos.value.length,
      facturas: datos.value.map(f => ({ docEntry: f.DocEntry, numero: f.DocNum, fecha: f.DocDate,
        tipo: f.DocType, reserva: f.ReserveInvoice })) }));
  }
  }
} catch (error) {
  console.log(JSON.stringify({ evento: "diagnostico_facturas_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
