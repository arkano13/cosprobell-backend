// Diagnóstico de forma: no muestra nombres, credenciales ni valores comerciales.
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { configurar } from "./config.js";
import { crearClienteSap } from "./sap.client.js";
import { tomarCandado } from "./candado.js";
import { crearControl } from "./control.js";
import { mkdir } from "node:fs/promises";
import { trasladoPreparacionSchema } from "../src/modules/sincronizacion/trasladosPreparacion.schemas.js";

const nombres = { docEntry: "DocEntry", docNum: "DocNum", cardCode: "CardCode", docDate: "DocDate", fromWarehouse: "FromWarehouse", toWarehouse: "ToWarehouse",
  lineas: "StockTransferLines", lineNum: "LineNum", itemCode: "ItemCode", quantity: "Quantity", fromWarehouseCode: "FromWarehouseCode",
  warehouseCode: "WarehouseCode", uomEntry: "UoMEntry", uomCode: "UoMCode", inventoryQuantity: "InventoryQuantity" };
export function diagnosticarTrasladoSap(t) {
  const dato = { docEntry: t.DocEntry, docNum: t.DocNum, cardCode: t.CardCode || null, docDate: t.DocDate,
    fromWarehouse: t.FromWarehouse, toWarehouse: t.ToWarehouse,
    lineas: Array.isArray(t.StockTransferLines) ? t.StockTransferLines.map(l => ({ lineNum: l.LineNum, itemCode: l.ItemCode, quantity: l.Quantity,
      fromWarehouseCode: l.FromWarehouseCode ?? null, warehouseCode: l.WarehouseCode ?? null, uomEntry: l.UoMEntry ?? null,
      uomCode: l.UoMCode ?? null, inventoryQuantity: l.InventoryQuantity ?? null })) : t.StockTransferLines };
  const resultado = trasladoPreparacionSchema.safeParse(dato);
  const paginadas = Object.keys(t).some(k => k.startsWith("StockTransferLines") && /nextlink/i.test(k));
  const problemas = (resultado.success ? [] : resultado.error.issues).slice(0, 20).map(issue => {
    let valor = dato; for (const parte of issue.path) valor = valor?.[parte];
    return { campo: issue.path.map(p => typeof p === "number" ? `[${p}]` : nombres[p] ?? p).join("."),
      motivo: issue.code, tipoRecibido: valor === null ? "null" : Array.isArray(valor) ? "array" : typeof valor };
  });
  if (paginadas) problemas.unshift({ campo: "StockTransferLines", motivo: "coleccion_paginada", tipoRecibido: "incompleta" });
  return { evento: "diagnostico_traslado", docEntry: t.DocEntry, valido: resultado.success && !paginadas,
    cantidadLineas: Array.isArray(t.StockTransferLines) ? t.StockTransferLines.length : null, lineasPaginadas: paginadas, problemas };
}

async function principal() {
  let sap, liberar;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !/^--numero=\d+$/.test(args[0])) throw new Error("ARGUMENTOS_INVALIDOS");
    const numero = Number(args[0].slice(9));
    if (!Number.isSafeInteger(numero) || numero < 0 || numero > 2147483647) throw new Error("NUMERO_INVALIDO");
    const config = configurar(process.env);
    config.control = crearControl({ ...config, maxConsultas: 3, maxDuracionMs: 60000 });
    await mkdir(config.directorio, { recursive: true });
    liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
    sap = crearClienteSap(config);
    const dato = await sap.documento(numero, { recurso: "StockTransfers", claveNumerica: true, claveLocal: "docEntry",
      campos: ["DocEntry", "DocNum", "CardCode", "DocDate", "FromWarehouse", "ToWarehouse", "StockTransferLines"] });
    const informe = diagnosticarTrasladoSap(dato);
    console.log(JSON.stringify(informe));
    process.exitCode = informe.valido ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify({ evento: "diagnostico_traslado_fallido", codigo: e.code ?? "REVISAR_CONFIGURACION" }));
    process.exitCode = 1;
  } finally { await sap?.cerrar().catch(() => {}); await liberar?.(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await principal();
