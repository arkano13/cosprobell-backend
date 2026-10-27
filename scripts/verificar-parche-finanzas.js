import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifiesto = JSON.parse(await readFile(join(raiz, "PARCHE_FINANZAS.json"), "utf8"));
const errores = [];
for (const { archivo, sha256 } of manifiesto.archivos) {
  if (!/^(puente|src)\/[A-Za-z0-9_./-]+\.js$/.test(archivo) || archivo.split("/").includes("..")) throw new Error("Ruta inválida");
  try {
    const contenido = await readFile(join(raiz, archivo));
    if (createHash("sha256").update(contenido).digest("hex") !== sha256) errores.push(archivo);
  } catch { errores.push(archivo); }
}
console.log(JSON.stringify({ evento: "parche_financiero_verificado", correcto: errores.length === 0, errores }));
if (errores.length) process.exitCode = 1;
