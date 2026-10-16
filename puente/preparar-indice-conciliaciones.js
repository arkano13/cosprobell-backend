import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { tomarCandado } from "./candado.js";
import { consultaIndiceConciliaciones as consulta } from "./conciliaciones-indice.sql.js";
let sap, liberar, etapa = "configuracion";
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--registrar", "--comprobar"].includes(args[0])) throw new Error("Use --registrar o --comprobar");
  const config = configurar(process.env);
  config.control = crearControl(config);
  await mkdir(config.directorio, { recursive: true });
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  sap = crearClienteSap(config);
  etapa = "registro_consulta";
  const resultado = await sap.prepararConsultaFinanciera(consulta, args[0] === "--registrar");
  console.log(JSON.stringify({ evento: "indice_conciliaciones", resultado, codigo: consulta.SqlCode }));
  etapa = "lectura_get";
  const filas = await sap.paginaFinanciera(consulta, { k0: 0 }, undefined, 1);
  if (filas.some(f => !Number.isInteger(f.reconNum) || f.reconNum <= 0)) throw new Error("Respuesta inválida");
  console.log(JSON.stringify({ evento: "indice_conciliaciones_get", resultado: "OK", registros: filas.length,
    primerNumero: filas[0]?.reconNum }));
} catch (error) {
  console.error(JSON.stringify({ evento: "indice_conciliaciones_fallido", etapa, codigo: error.code ?? "REVISAR_CONFIGURACION", detalle: error.detalle }));
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
