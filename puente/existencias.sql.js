import { ErrorPuente } from "./http.js";
import { createHash } from "node:crypto";

export function validarAlmacenesSql(codigos) {
  if (!Array.isArray(codigos) || !codigos.length || codigos.length > 10 ||
      codigos.some(c => typeof c !== "string" || !/^[A-Za-z0-9_-]{1,8}$/.test(c)) ||
      new Set(codigos.map(c => c.toLowerCase())).size !== codigos.length) {
    throw new Error("BRIDGE_WAREHOUSES requiere entre 1 y 10 códigos únicos de SAP");
  }
  return [...codigos].sort();
}

export function fuenteExistencias(config) {
  if (config.modoExistencias === "sql-01-02") return "sql-01-02-v1";
  if (config.modoExistencias !== "sql-almacenes") return "items";
  const codigos = validarAlmacenesSql(config.almacenesSap);
  return `sql-almacenes-v1-${createHash("sha256").update(JSON.stringify(codigos)).digest("hex").slice(0, 20)}`;
}

export function consultaParaConfig(config) {
  if (config.modoExistencias !== "sql-almacenes") return { consulta: CONSULTA_EXISTENCIAS, codigos: ["01", "02"] };
  const codigos = validarAlmacenesSql(config.almacenesSap);
  // I pertenece a OITM. Conservar A-H para las consultas ya registradas.
  const aliases = "ABCDEFGHJK";
  const columnas = codigos.map((_, i) => {
    const a = aliases[i], n = i + 1;
    return `${a}.[WhsCode] AS [Warehouse${n}], ${a}.[OnHand] AS [InStock${n}], ${a}.[IsCommited] AS [Committed${n}], ${a}.[OnOrder] AS [Ordered${n}]`;
  });
  const joins = codigos.map((codigo, i) => {
    const a = aliases[i];
    return `LEFT JOIN [OITW] ${a} ON I.[ItemCode] = ${a}.[ItemCode] AND ${a}.[WhsCode] = '${codigo}'`;
  });
  return { codigos, consulta: {
    SqlCode: `COSPROBELL_STOCK_${fuenteExistencias(config).split("-").at(-1)}`,
    SqlName: `Cosprobell stock ${codigos.join(",")}`,
    SqlText: `SELECT TOP 20 I.[ItemCode], I.[InvntItem],\n ${columnas.join(",\n ")}\n FROM [OITM] I\n ${joins.join("\n ")}\n WHERE I.[ItemCode] > :after\n ORDER BY I.[ItemCode]`,
  } };
}

// Una fila por artículo, incluidos los no inventariables y los saldos cero.
// LEFT JOIN acotado en SAP: no descargar la colección de todos los almacenes.
export const CONSULTA_EXISTENCIAS = Object.freeze({
  SqlCode: "COSPROBELL_STOCK_0102_V1",
  SqlName: "Cosprobell existencias almacenes 01 y 02",
  SqlText: `SELECT TOP 20 I.[ItemCode], I.[InvntItem],
 A.[WhsCode] AS [Warehouse1], A.[OnHand] AS [InStock1], A.[IsCommited] AS [Committed1], A.[OnOrder] AS [Ordered1],
 B.[WhsCode] AS [Warehouse2], B.[OnHand] AS [InStock2], B.[IsCommited] AS [Committed2], B.[OnOrder] AS [Ordered2]
 FROM [OITM] I
 LEFT JOIN [OITW] A ON I.[ItemCode] = A.[ItemCode] AND A.[WhsCode] = '01'
 LEFT JOIN [OITW] B ON I.[ItemCode] = B.[ItemCode] AND B.[WhsCode] = '02'
 WHERE I.[ItemCode] > :after
 ORDER BY I.[ItemCode]`,
});

// SAP normaliza corchetes y espacios. No aceptar otra definición con el mismo código.
const normalizar = s => typeof s === "string" ? s.split(/('(?:''|[^'])*')/g)
  .map((parte, i) => i % 2 ? parte : parte.replace(/[\[\]\s]/g, "").toLowerCase()).join("") : null;
export function validarConsultaExistencias(sql, consulta = CONSULTA_EXISTENCIAS) {
  if (normalizar(sql) !== normalizar(consulta.SqlText)) throw new ErrorPuente("CONSULTA_EXISTENCIAS_INCOMPATIBLE");
}

export function convertirExistenciaSql(fila) {
  return convertirExistenciaAlmacenes(fila, ["01", "02"]);
}
export function convertirExistenciaAlmacenes(fila, codigos) {
  const fallo = () => { throw new ErrorPuente("EXISTENCIA_SAP_INVALIDA", false, { itemCode: fila?.ItemCode, campo: "SQLQueries" }); };
  if (!fila || typeof fila.ItemCode !== "string" || !fila.ItemCode || !["Y", "N"].includes(fila.InvntItem)) fallo();
  const lista = [];
  for (const [i, codigo] of codigos.entries()) {
    const n = i + 1;
    const wh = fila[`Warehouse${n}`];
    const valores = [fila[`InStock${n}`], fila[`Committed${n}`], fila[`Ordered${n}`]];
    if (wh === null && valores.every(v => v === null)) continue;
    if (wh !== codigo || valores.some(v => typeof v !== "number" || !Number.isFinite(v))) fallo();
    lista.push({ WarehouseCode: wh, InStock: valores[0], Committed: valores[1], Ordered: valores[2] });
  }
  return { ItemCode: fila.ItemCode, InventoryItem: fila.InvntItem === "Y" ? "tYES" : "tNO", ItemWarehouseInfoCollection: lista };
}
