import { createHash } from "node:crypto";
const SqlText = "SELECT H.[ReconNum] AS [reconNum] FROM [OITR] H WHERE H.[ReconNum] > :k0 ORDER BY H.[ReconNum]";
export const consultaIndiceConciliaciones = Object.freeze({
  SqlCode: `CP_FIN_${createHash("sha256").update(SqlText).digest("hex").slice(0, 20)}`,
  SqlName: "Cosprobell indice conciliaciones lectura",
  SqlText,
});
