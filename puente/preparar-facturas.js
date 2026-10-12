import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { consultaCreditosPreparacion } from "./facturasPreparacion.sql.js";
import { entidadesHabilitadas } from "./entidades.js";
let sap;
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--comprobar", "--registrar"].includes(args[0])) throw new Error("Use --comprobar o --registrar");
  const config = configurar(process.env);
  if (config.fuentePreparacion !== "facturas") throw new Error("Configure BRIDGE_PICKING_SOURCE=facturas");
  config.control = crearControl(config); sap = crearClienteSap(config);
  const resultado = await sap.prepararConsultaFinanciera(consultaCreditosPreparacion, args[0] === "--registrar");
  const entidad = entidadesHabilitadas(config).find(e => e.nombre === "facturasPreparacion");
  const filas = await sap.pagina(null, entidad);
  if (filas.length) entidad.construirLote(filas, config.empresa, 1);
  console.log(JSON.stringify({ evento: "consulta_facturas_lista", resultado, desde: config.facturasDesde, almacen: "02", registros: filas.length }));
} catch (error) {
  console.error(JSON.stringify({ evento: "preparacion_fallida", codigo: error.code ?? "REVISAR_CONFIGURACION" })); process.exitCode = 1;
} finally { if (sap) await sap.cerrar().catch(() => {}); }
