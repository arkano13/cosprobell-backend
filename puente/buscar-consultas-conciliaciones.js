import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
let sap;
try {
  const config = configurar(process.env);
  config.control = crearControl(config);
  sap = crearClienteSap(config);
  let cursor = null, encontradas = 0, revisadas = 0, completo = false;
  for (let pagina = 0; pagina < 5; pagina++) {
    const filas = await sap.pagina(cursor, {
      recurso: "SQLQueries", claveSap: "SqlCode", claveNumerica: false,
      campos: ["SqlCode", "SqlName", "SqlText"], tamanoPagina: 20,
    });
    if (!filas.length) { completo = true; break; }
    for (const fila of filas) {
      if (typeof fila.SqlCode !== "string" || typeof fila.SqlText !== "string") throw new Error("Respuesta inválida");
      revisadas++;
      if (/\b(?:OITR|ITR1)\b/i.test(fila.SqlText)) {
        encontradas++;
        console.log(JSON.stringify({ evento: "consulta_existente_candidata", codigo: fila.SqlCode,
          nombre: fila.SqlName, mencionaReconNum: /\bReconNum\b/i.test(fila.SqlText) }));
      }
    }
    const siguiente = filas.at(-1).SqlCode;
    if (siguiente === cursor) throw new Error("Paginación sin avance");
    cursor = siguiente;
  }
  console.log(JSON.stringify({ evento: "busqueda_consultas_fin", revisadas, encontradas, completo, cursor: completo ? null : cursor }));
} catch (error) {
  console.error(JSON.stringify({ evento: "busqueda_consultas_fallida", codigo: error.code ?? "RESPUESTA_INVALIDA" }));
  process.exitCode = 1;
} finally { await sap?.cerrar().catch(() => {}); }
