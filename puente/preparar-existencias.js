import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { entidadesHabilitadas } from "./entidades.js";

let sap;
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--comprobar", "--registrar"].includes(args[0])) throw new Error("Use --comprobar o --registrar");
  const config = configurar(process.env);
  if (!["sql-01-02", "sql-almacenes"].includes(config.modoExistencias) || !config.inventarioHabilitado) throw new Error("Active el modo SQL e inventario antes de preparar");
  config.control = crearControl(config);
  sap = crearClienteSap(config);
  const resultado = await sap.prepararConsultaExistencias(args[0] === "--registrar");
  const entidad = entidadesHabilitadas(config).find(e => e.nombre === "existencias");
  const filas = await sap.pagina(null, { ...entidad, tamanoPagina: 1 });
  if (filas.length) entidad.construirLote(filas, config.empresa, 1);
  console.log(JSON.stringify({ evento: "consulta_existencias_lista", resultado, almacenes: config.almacenesSap, registros: filas.length }));
} catch (error) {
  console.error(JSON.stringify({ evento: "preparacion_fallida", codigo: error.code ?? "REVISAR_CONFIGURACION", detalle: error.detalle }));
  process.exitCode = 1;
} finally {
  if (sap) await sap.cerrar().catch(() => console.error('{"evento":"logout_no_confirmado"}'));
}
