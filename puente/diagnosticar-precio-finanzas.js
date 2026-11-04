// GET de la misma muestra que falló. No envía datos al backend ni altera documentos SAP.
import { join } from "node:path";
import { configurarFinanzas } from "./finanzas.config.js";
import { crearClienteSap } from "./sap.client.js";
import { crearControl } from "./control.js";
import { tomarCandado } from "./candado.js";
import { definicionesGetFinanzas, leerPaginaGet } from "./finanzas.get.js";
import { FINANZAS } from "../src/shared/finanzas/contratos.js";

let sap, liberar;
try {
  if (process.argv.length !== 2) throw new Error("ARGUMENTOS_INVALIDOS");
  const config = configurarFinanzas(process.env);
  config.control = crearControl(config);
  liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
  sap = crearClienteSap(config);
  const def = definicionesGetFinanzas(config).notaCreditoLineas;
  const pagina = await leerPaginaGet({ sap, def, config, recorrido: { ventana: config.desde }, tamano: 1 });
  for (const fila of pagina.filas) {
    const precio = fila.precio;
    // Solo un valor numérico acotado. Nunca muestra textos, clientes o credenciales.
    const texto = String(precio);
    const numerico = texto.length <= 100 && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(texto);
    console.log(JSON.stringify({ evento: "diagnostico_precio", docEntry: fila.docEntry, linea: fila.linea,
      tipo: precio === null ? "null" : typeof precio, precio: numerico ? texto : undefined,
      longitud: typeof precio === "string" ? precio.length : undefined,
      valido: FINANZAS.notaCreditoLineas.campos.precio.safeParse(precio).success }));
  }
  if (!pagina.filas.length) console.log(JSON.stringify({ evento: "diagnostico_precio", registros: 0 }));
} catch (error) {
  console.log(JSON.stringify({ evento: "diagnostico_precio_fallido", codigo: error.code ?? "REVISAR_CONFIGURACION" }));
  process.exitCode = 1;
} finally {
  await sap?.cerrar().catch(() => {});
  await liberar?.();
}
