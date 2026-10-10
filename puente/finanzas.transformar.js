import { FINANZAS, cursorRegistro, validarCursor } from "../src/shared/finanzas/contratos.js";
import { ErrorPuente } from "./http.js";

// JSON.parse con source mantiene exactamente los decimales del texto HTTP.
// No usar Response.json(): ya habría convertido los importes a coma flotante.
export function lectorFinanciero(entidad) {
  return async respuesta => {
    try {
      return JSON.parse(await respuesta.text(), (k, v, contexto) => {
        if (typeof v === "number" && FINANZAS[entidad].campos[k]?.safeParse("0.1").success) {
          if (!contexto?.source) throw new Error("NODE_SIN_DECIMALES_EXACTOS");
          return contexto.source;
        }
        return v;
      });
    } catch { throw new ErrorPuente("JSON_FINANCIERO_INVALIDO"); }
  };
}
export function transformarFinanzas(entidad, filas, cursor) {
  const def = FINANZAS[entidad];
  let anterior = cursor;
  return filas.map(f => {
    const registro = { ...f };
    for (const [campo, tipo] of Object.entries(def.campos)) {
      if (["fecha", "vencimiento", "fechaDocumento"].includes(campo) && typeof registro[campo] === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(registro[campo]) && tipo.safeParse(registro[campo].slice(0, 10)).success) {
        registro[campo] = registro[campo].slice(0, 10);
      }
    }
    const validado = def.schema.safeParse(registro);
    if (!validado.success) throw new ErrorPuente("FINANZA_SAP_INVALIDA", false, { entidad, campo: String(validado.error.issues[0]?.path[0]) });
    const siguiente = cursorRegistro(entidad, validado.data);
    if (!validarCursor(entidad, siguiente)) throw new ErrorPuente("CURSOR_INVALIDO");
    // Para claves de texto SAP decide la colación. Se comprueban duplicados;
    // para claves numéricas se exige avance lexicográfico estricto.
    if (anterior && (JSON.stringify(siguiente) === JSON.stringify(anterior) ||
      (typeof siguiente[0] === "number" && !siguiente.some((v, i) => v > anterior[i] && siguiente.slice(0, i).every((p, j) => p === anterior[j]))))) {
      throw new ErrorPuente("PAGINACION_SIN_AVANCE");
    }
    anterior = siguiente;
    return validado.data;
  });
}
