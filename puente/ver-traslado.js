import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { TRASLADOS_PREPARACION } from "./entidades.js";

// Muestra un traslado de SAP por su número (solo lectura: Login, un GET y Logout). Sirve para ver traslados que el puente
// no trae, como los de la 01 a la 02. Uso: node --env-file=.env.puente puente/ver-traslado.js 4695
let sap;
try {
  const numero = Number(process.argv[2]);
  if (!Number.isInteger(numero) || numero <= 0) throw Object.assign(new Error("Use: ver-traslado.js NUMERO"), { code: "NUMERO_INVALIDO" });
  const config = configurar(process.env); config.control = crearControl(config);
  sap = crearClienteSap(config);
  const entidad = { ...TRASLADOS_PREPARACION, filtro: `DocNum eq ${numero}`, tamanoPagina: 5,
    campos: ["DocEntry", "DocNum", "DocDate", "FromWarehouse", "ToWarehouse", "Comments", "StockTransferLines"] };
  const traslados = await sap.pagina(null, entidad);
  if (!traslados.length) console.log(`No hay un traslado ${numero} en SAP.`);
  for (const t of traslados) {
    console.log(`Traslado ${t.DocNum} · ${String(t.DocDate).slice(0, 10)} · de ${t.FromWarehouse} a ${t.ToWarehouse}${t.Comments ? ` · ${t.Comments}` : ""}`);
    for (const l of t.StockTransferLines ?? []) {
      console.log(`  ${l.ItemCode}\t${l.ItemDescription ?? ""}\t${l.Quantity} ${l.UoMCode ?? ""}\t${l.FromWarehouseCode ?? ""} → ${l.WarehouseCode ?? ""}`);
    }
  }
} catch (error) {
  console.error(JSON.stringify({ evento: "ver_traslado_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION", mensaje: error.message }));
  process.exitCode = 1;
} finally { if (sap) await sap.cerrar().catch(() => {}); }
