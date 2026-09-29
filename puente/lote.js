import { ErrorPuente } from "./http.js";
// Arma el constructor de lotes de una entidad: convierte las filas de SAP con `mapear` y valida el
// contrato del receptor. Un registro inválido se informa con su código y el campo SAP, nunca el valor.
export function crearConstructorLote({ entidad, schema, codigoError, claveSap, claveLocal, camposSap, mapear }) {
  const booleano = (fila, campo) => {
    if (fila[campo] === "tYES") return true;
    if (fila[campo] === "tNO") return false;
    throw new ErrorPuente(codigoError, false, { [claveLocal]: fila[claveSap], campo });
  };
  return (filas, empresa, secuencia) => {
    let registros;
    try { registros = filas.map((fila) => mapear(fila, booleano)); }
    catch (error) { throw error instanceof ErrorPuente ? error : new ErrorPuente(codigoError); }
    const resultado = schema.safeParse({ version: 1, empresa, secuencia, [entidad]: registros });
    if (!resultado.success) {
      const [raiz, indice, campo] = resultado.error.issues[0].path;
      const detalle = raiz === entidad && Number.isInteger(indice)
        ? { [claveLocal]: registros[indice][claveLocal], campo: camposSap[campo] ?? campo } : undefined;
      throw new ErrorPuente(codigoError, false, detalle);
    }
    return resultado.data;
  };
}
