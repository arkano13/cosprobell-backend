// Delta para la instalación revisada. --con-operativa incorpora las mejoras aprobadas.
import { execFileSync } from "node:child_process";
import { mkdir, cp, readFile, writeFile, lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || args.some(a => a !== "--con-operativa")) throw new Error("Argumentos inválidos");
const conOperativa = args.includes("--con-operativa");
const commit = execFileSync("git", ["rev-parse", "origin/main"], { cwd: raiz, encoding: "utf8" }).trim();
const git = archivo => execFileSync("git", ["show", `${commit}:${archivo}`], { cwd: raiz, encoding: "utf8" });
const hash = contenido => createHash("sha256").update(contenido).digest("hex");
const financieros = ["puente/importar-finanzas.js", "puente/finanzas.get.js", "puente/finanzas.importar.js",
  "puente/finanzas.estado.js", "puente/finanzas.sincronizar.js", "puente/finanzas.transformar.js", "src/shared/finanzas/contratos.js"];
const contratosTraslados = ["src/modules/sincronizacion/trasladosPreparacion.schemas.js", "src/modules/sincronizacion/trasladosEntrada.schemas.js"];
const operativos = ["puente/config.js", "puente/control.js", "puente/ejecutar.js", "puente/estado.js",
  "puente/estado-publico.js", "puente/opciones.js", "puente/sincronizar.js", "puente/solicitud-manual.js",
  "puente/facturasPreparacion.js", "puente/version-operativa.js"];
const backend = ["src/shared/finanzas/contratos.js", "src/modules/finanzas/finanzas.consultas.js",
  "src/modules/finanzas/finanzas.ingreso.js", "src/modules/finanzas/finanzas.repository.js"];
const fuenteCliente = await readFile(join(raiz, "puente/sap.client.js"), "utf8");
const inicio = fuenteCliente.indexOf("    // Importador puntual:");
const fin = fuenteCliente.indexOf("    async prepararConsultaFinanciera", inicio);
if (inicio < 0 || fin < inicio) throw new Error("Falta método GET financiero");
const originalCliente = git("puente/sap.client.js").replaceAll("\r\n", "\n");
const ancla = "    async prepararConsultaFinanciera";
if (originalCliente.split(ancla).length !== 2 || originalCliente.includes("leerRecursoFinanciero")) throw new Error("Revisar base SAP");
const cliente = originalCliente.replace(ancla, fuenteCliente.slice(inicio, fin).replaceAll("\r\n", "\n") + ancla);
if (cliente.includes("verificacionAlmacenesId") || cliente.includes("alcanceVerificacion")) throw new Error("Mejora operativa excluida");

async function preparar(nombre, lista, puente) {
  const destino = join(raiz, "dist", nombre);
  if (dirname(destino) !== join(raiz, "dist")) throw new Error("Destino inválido");
  for (const ruta of [join(raiz, "dist"), destino]) {
    const info = await lstat(ruta).catch(e => { if (e.code !== "ENOENT") throw e; });
    if (info?.isSymbolicLink()) throw new Error("No usar enlaces como destino");
  }
  await mkdir(destino, { recursive: true });
  if ((await readdir(destino)).length) throw new Error("Use un destino vacío; no sobrescribir una instalación");
  const archivos = [];
  for (const archivo of lista) {
    const contenido = archivo === "puente/sap.client.js" ? (conOperativa ? fuenteCliente : cliente) : contratosTraslados.includes(archivo)
      ? git(archivo) : await readFile(join(raiz, archivo));
    await mkdir(dirname(join(destino, archivo)), { recursive: true });
    await writeFile(join(destino, archivo), contenido);
    archivos.push({ archivo, sha256: hash(contenido) });
  }
  await cp(join(raiz, conOperativa ? "docs/PARCHE_FINANZAS_OPERATIVA_2026-10-26.md" : "docs/PARCHE_FINANZAS_2026-10-26.md"), join(destino, "LEEME.md"));
  if (puente) {
    await mkdir(join(destino, "scripts"), { recursive: true });
    await cp(join(raiz, "scripts/verificar-parche-finanzas.js"), join(destino, "scripts/verificar-parche-finanzas.js"));
  }
  await writeFile(join(destino, "PARCHE_FINANZAS.json"), JSON.stringify({ paquete: nombre, baseRemota: commit,
    incluyeCambiosLocales: true, mejoraOperativaIncluida: conOperativa, financieroRecurrente: false,
    conciliaciones: false, archivos }, null, 2) + "\n");
  console.log(destino);
}
await preparar(conOperativa ? "parche-finanzas-operativa-puente-20261026" : "parche-finanzas-puente-20261026",
  [...financieros, "puente/sap.client.js", ...contratosTraslados, ...(conOperativa ? operativos : [])], true);
if (!conOperativa) await preparar("parche-finanzas-backend-20261026", backend, false);
