// Escala fija SAP (6), con BigInt: evita redondeos binarios y mezclar monedas.
export function unidades(valor) {
  if (typeof valor !== "string" || !/^-?\d+(?:\.\d{1,6})?$/.test(valor)) throw new Error("IMPORTE_INVALIDO");
  const negativo = valor.startsWith("-");
  const [entero, fraccion = ""] = (negativo ? valor.slice(1) : valor).split(".");
  return (negativo ? -1n : 1n) * (BigInt(entero) * 1000000n + BigInt(fraccion.padEnd(6, "0")));
}
export function importe(valor) {
  const signo = valor < 0n ? "-" : "";
  const absoluto = valor < 0n ? -valor : valor;
  return `${signo}${absoluto / 1000000n}.${String(absoluto % 1000000n).padStart(6, "0")}`;
}
