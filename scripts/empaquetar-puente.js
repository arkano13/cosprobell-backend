// Arma dist/puente-cosprobell: una carpeta autónoma para copiar al equipo de Cosprobell.
// Contiene solo el puente, los contratos que valida antes de enviar, zod y los scripts de Windows.
// No incluye el backend, la base de datos ni credenciales. Uso: npm run empaquetar:puente
import { cp, mkdir, readdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !/^--destino=[a-z][a-z0-9-]{0,63}$/.test(args[0]))) {
  throw new Error("Uso: npm run empaquetar:puente -- --destino=puente-inventario");
}
const nombreDestino = args[0]?.slice("--destino=".length) ?? "puente-cosprobell";
if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(nombreDestino)) throw new Error("Nombre de destino inválido");
const destino = join(raiz, "dist", nombreDestino);
const copiar = (desde, hacia = desde) => cp(join(raiz, desde), join(destino, hacia), { recursive: true });

// Solo reconstruir el directorio generado; nunca borrar una instalación configurada.
if (dirname(resolve(destino)) !== resolve(raiz, "dist")) throw new Error("Destino de paquete inválido");
for (const ruta of [join(raiz, "dist"), destino]) {
  const info = await lstat(ruta).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (info?.isSymbolicLink()) throw new Error("No se empaqueta sobre enlaces");
}
const existentes = await readdir(destino).catch(error => { if (error.code === "ENOENT") return []; throw error; });
if (existentes.some(nombre => [".env.puente", ".bridge-state", "logs", "certificado"].includes(nombre))) {
  throw new Error("El destino contiene configuración o estado de ejecución; conservarlo antes de empaquetar");
}
await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });

// Código del puente (sin la carpeta windows, que va a la raíz del paquete).
for (const archivo of await readdir(join(raiz, "puente"))) {
  if (archivo.endsWith(".js")) await copiar(join("puente", archivo));
}
// Contratos compartidos con el receptor: el puente valida cada lote antes de enviarlo.
for (const archivo of await readdir(join(raiz, "src/modules/sincronizacion"))) {
  if (archivo.endsWith(".schemas.js")) await copiar(join("src/modules/sincronizacion", archivo));
}
await copiar("node_modules/zod");
for (const archivo of ["ejecutar-puente.cmd", "instalar-tarea.cmd", "desinstalar-tarea.cmd"]) await copiar(join("puente/windows", archivo), archivo);
for (const archivo of ["scripts/ver-certificado.js", "scripts/comprobar-candado-puente.js", ".env.puente.example"]) await copiar(archivo);
await copiar("docs/INSTALAR_PUENTE_WINDOWS.md", "LEEME.md");
await copiar("docs/PRUEBAS_PEDIDOS_SCANNER.md", "PRUEBAS_PEDIDOS_SCANNER.md");
await copiar("docs/ACTUALIZAR_ALMACENES_EXISTENCIAS.md", "ACTUALIZAR_ALMACENES_EXISTENCIAS.md");

const { version } = JSON.parse(await readFile(join(raiz, "package.json"), "utf8"));
await writeFile(join(destino, "package.json"), JSON.stringify({
  name: "puente-cosprobell", version, private: true, type: "module", engines: { node: ">=22.13.0" },
}, null, 2) + "\n");
let commit = "desconocido";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: raiz, encoding: "utf8" }).trim(); } catch { /* sin git */ }
await writeFile(join(destino, "VERSION.txt"), `puente-cosprobell ${version}\ncommit ${commit}\narmado ${new Date().toISOString()}\n`);

// Comprobación: todos los módulos del puente se cargan desde el paquete, sin el resto del proyecto,
// y zod se resuelve dentro del paquete (no desde node_modules del proyecto).
const verificacion = `
import { pathToFileURL } from "node:url";
for (const m of ["entidades", "estado", "sap.client", "backend.client", "sincronizar", "config"]) await import("./puente/" + m + ".js");
if (!import.meta.resolve("zod").startsWith(pathToFileURL(process.cwd() + "/node_modules/zod/").href)) throw new Error("zod se resolvió fuera del paquete");
`;
const prueba = spawnSync(process.execPath, ["--input-type=module", "-e", verificacion], { cwd: destino, encoding: "utf8" });
if (prueba.status !== 0) {
  console.error("El paquete no carga por sí solo:\n" + prueba.stderr);
  process.exit(1);
}
console.log(`Paquete listo: ${destino}`);
console.log("Comprimir esa carpeta y copiarla al equipo de Cosprobell. Instrucciones en LEEME.md.");
