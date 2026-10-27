import { FINANZAS, decimal, cursorRegistro, validarCursor } from "../src/shared/finanzas/contratos.js";
import { ErrorPuente } from "./http.js";

// Desplazar el punto sobre texto: nunca convertir la mantisa a Number ni redondear.
export function expandirCientifico(valor) {
  const partes = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(valor);
  if (!partes) return valor;
  const [, signo, entero, fraccion = "", exponente] = partes;
  const cifras = (entero + fraccion).replace(/^0+/, "");
  if (!cifras) return "0";
  const significativas = cifras.replace(/0+$/, "");
  const escala = BigInt(exponente) - BigInt(fraccion.length) + BigInt(cifras.length - significativas.length);
  const punto = BigInt(significativas.length) + escala;
  // Comprobar tamaño antes de reservar memoria; conservar inválidos para el contrato.
  if (punto > 13n || escala < -6n) return valor;
  if (escala >= 0n) return signo + significativas + "0".repeat(Number(escala));
  const posicion = Number(punto);
  return signo + (posicion > 0
    ? significativas.slice(0, posicion) + "." + significativas.slice(posicion)
    : "0." + "0".repeat(-posicion) + significativas);
}

// Los decimales del Service Layer pueden incluir un residuo de binary64 sobre sus seis
// decimales. Comparar como enteros exactos: tolerancia relativa 2^-52 y además
// absoluta de 1e-10. Nunca convertir cantidades monetarias a Number para redondear.
export function normalizarDecimalSap(valor) {
  if (typeof valor !== "string") return valor;
  const partes = /^(-?)(0|[1-9]\d{0,12})\.(\d{7,40})$/.exec(valor);
  if (!partes) return valor;
  const [, signo, entero, fraccion] = partes;
  const original = BigInt(entero + fraccion);
  const divisor = 10n ** BigInt(fraccion.length - 6);
  const redondeado = (original + divisor / 2n) / divisor;
  const residuo = original - redondeado * divisor;
  const diferencia = residuo < 0n ? -residuo : residuo;
  const escala = 10n ** BigInt(fraccion.length);
  if (diferencia * 4503599627370496n > original || diferencia * 10000000000n > escala ||
      (original !== 0n && redondeado === 0n)) return valor;
  const decimalCorto = String(redondeado % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return (redondeado === 0n ? "" : signo) + String(redondeado / 1000000n) + (decimalCorto ? "." + decimalCorto : "");
}
// Compatibilidad con las primeras pruebas y herramientas de precios.
export const normalizarPrecioSap = normalizarDecimalSap;

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
      if ((tipo === decimal || tipo.unwrap?.() === decimal) && typeof registro[campo] === "string") {
        registro[campo] = normalizarDecimalSap(expandirCientifico(registro[campo]));
      }
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
