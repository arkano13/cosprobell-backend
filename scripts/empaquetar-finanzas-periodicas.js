import { mkdir, readFile, writeFile, cp, lstat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nombre = process.argv[2] ?? "parche-finanzas-periodicas-20261105";
if (!/^[a-z][a-z0-9-]{1,70}$/.test(nombre) || process.argv.length > 3) throw new Error("Nombre de paquete inválido");
const salida = join(raiz, "dist", nombre);
if (await lstat(salida).catch(e => { if (e.code !== "ENOENT") throw e; })) throw new Error("El destino ya existe; use otro nombre");
const archivos = {
  puente: { "ejecutar-puente.cmd": "puente/windows/ejecutar-puente.cmd",
    ...Object.fromEntries(["puente/ejecutar-produccion.js", "puente/actualizar-finanzas-periodicas.js", "puente/finanzas.periodicas.js", "puente/finanzas.get.js", "src/shared/finanzas/periodicas.js"].map(p => [p, p])) },
  backend: Object.fromEntries(["prisma/schema.prisma", "prisma/migrations/20261105120000_finanzas_periodicas/migration.sql",
    "src/shared/finanzas/periodicas.js", "src/modules/finanzas/finanzas.periodicas.js", "src/modules/finanzas/finanzas.normalizar.js",
    "src/modules/finanzas/finanzas.repository.js", "src/modules/finanzas/finanzas.routes.js", "src/modules/finanzas/finanzas.consultas.js"].map(p => [p, p])),
};
await mkdir(salida, { recursive: true });
for (const [tipo, lista] of Object.entries(archivos)) {
  const carpeta = join(salida, tipo), manifiesto = [];
  await mkdir(carpeta);
  for (const [destino, fuente] of Object.entries(lista)) {
    const contenido = await readFile(join(raiz, fuente));
    await mkdir(dirname(join(carpeta, destino)), { recursive: true });
    await writeFile(join(carpeta, destino), contenido);
    manifiesto.push({ archivo: destino, sha256: createHash("sha256").update(contenido).digest("hex") });
  }
  await cp(join(raiz, "docs/INSTALAR_FINANZAS_PERIODICAS.md"), join(carpeta, "LEEME.md"));
  await writeFile(join(carpeta, "MANIFIESTO.json"), JSON.stringify({ version: "2026.11.05.1", tipo, archivos: manifiesto }, null, 2));
}
console.log(JSON.stringify({ paquete: salida, puente: Object.keys(archivos.puente).length, backend: Object.keys(archivos.backend).length,
  contieneCredenciales: false, contieneEstados: false }));
