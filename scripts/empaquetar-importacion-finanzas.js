import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile, cp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nombre = "importacion-finanzas-get-20261026";
execFileSync(process.execPath, ["scripts/empaquetar-puente.js", `--destino=${nombre}`], { cwd: raiz, stdio: "inherit" });
const destino = join(raiz, "dist", nombre);
await cp(join(raiz, "docs/IMPORTAR_FINANZAS_GET.md"), join(destino, "LEEME.md"));
const archivos = [];
async function recorrer(directorio) {
  for (const item of await readdir(directorio, { withFileTypes: true })) {
    const ruta = join(directorio, item.name);
    if (item.isDirectory()) await recorrer(ruta);
    else archivos.push({ archivo: relative(destino, ruta).replaceAll("\\", "/"), sha256: createHash("sha256").update(await readFile(ruta)).digest("hex") });
  }
}
await recorrer(destino);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: raiz, encoding: "utf8" }).trim();
const cambiosLocales = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: raiz, encoding: "utf8" }).trim());
await writeFile(join(destino, "MANIFIESTO.json"), JSON.stringify({ paquete: nombre, armadoEn: new Date().toISOString(),
  commitBase: commit, contieneCambiosLocales: cambiosLocales, puntual: true, lectura: "get_parcial", carteraCompleta: false,
  excluidas: ["conciliaciones", "partidas"], node: ">=22.13.0", entrada: "puente/importar-finanzas.js", archivos }, null, 2) + "\n");
for (const archivo of ["puente/importar-finanzas.js", "puente/finanzas.get.js", "puente/finanzas.importar.js"]) {
  const prueba = spawnSync(process.execPath, ["--check", archivo], { cwd: destino, encoding: "utf8" });
  if (prueba.status !== 0) throw new Error(prueba.stderr);
}
console.log(`Importador puntual preparado: ${destino}`);
console.log("Instalar en una carpeta aparte. Abrir LEEME.md; no reemplazar el puente operativo con este paquete.");
