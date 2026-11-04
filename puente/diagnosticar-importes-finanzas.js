// Valida desde el cursor confirmado de la carga, sin enviar lotes ni alterar estado.
import { join } from "node:path";
import { configurarFinanzas } from "./finanzas.config.js";
import { crearClienteSap } from "./sap.client.js";
import { crearControl } from "./control.js";
import { tomarCandado } from "./candado.js";
import { definicionesGetFinanzas, leerPaginaGet } from "./finanzas.get.js";
import { transformarFinanzas } from "./finanzas.transformar.js";
import { abrirFinanzas } from "./finanzas.estado.js";

let sap, liberar;
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^--entidad=[A-Za-z]+$/.test(args[0])) throw new Error("ARGUMENTOS_INVALIDOS");
  const entidad = args[0].slice(10);
  const config = configurarFinanzas(process.env);
  const def = definicionesGetFinanzas(config)[entidad];
  if (!def) throw new Error("ENTIDAD_INVALIDA");
  config.control = crearControl(config);
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  const { estado } = await abrirFinanzas(config, entidad);
  const cursorSap = estado.recorrido?.lectura === "get_parcial" ? estado.cursorSap : null;
  sap = crearClienteSap(config);
  const pagina = estado.pendiente ? { filas: estado.pendiente.lote.registros }
    : await leerPaginaGet({ sap, def, config, recorrido: estado.recorrido ?? { ventana: config.desde }, cursorSap, tamano: 20 });
  console.log(JSON.stringify({ evento: "diagnostico_punto_carga", entidad, secuencia: estado.secuencia,
    desdeEstado: Boolean(estado.recorrido), pendienteLocal: Boolean(estado.pendiente) }));
  let fallos = 0;
  for (const fila of pagina.filas) {
    try { transformarFinanzas(entidad, [fila], null); }
    catch (error) {
      fallos++;
      const campo = error.detalle?.campo;
      const valor = campo ? fila[campo] : undefined;
      const texto = String(valor);
      console.log(JSON.stringify({ evento: "diagnostico_importe", entidad, docEntry: fila.docEntry, cardCode: fila.cardCode,
        transId: fila.transId, linea: fila.linea, campo, tipo: valor === null ? "null" : typeof valor,
        valor: valor == null ? null : texto.length <= 100 && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(texto) ? texto : undefined,
        longitud: typeof valor === "string" ? valor.length : undefined }));
    }
  }
  console.log(JSON.stringify({ evento: "diagnostico_importes_fin", entidad, revisados: pagina.filas.length, fallos }));
} catch (error) {
  console.log(JSON.stringify({ evento: "diagnostico_importes_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION", detalle: error.detalle }));
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
