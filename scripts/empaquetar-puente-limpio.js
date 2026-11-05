// Paquete ejecutable mínimo: no copia credenciales, estados, logs ni diagnósticos.
import { readFile, writeFile, readdir, mkdir, cp, lstat } from "node:fs/promises";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 1 || !/^--destino=[a-z][a-z0-9-]{0,63}$/.test(args[0])) throw new Error("Use --destino=NOMBRE-NUEVO");
const nombre = args[0].slice(10);
if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(nombre)) throw new Error("Nombre reservado");
const destino = resolve(raiz, "dist", nombre);
if (dirname(destino) !== resolve(raiz, "dist")) throw new Error("Destino inválido");
await mkdir(join(raiz, "dist"), { recursive: true });
for (const p of [join(raiz, "dist"), destino]) {
  const info = await lstat(p).catch(e => { if (e.code !== "ENOENT") throw e; });
  if (info?.isSymbolicLink()) throw new Error("No se empaqueta sobre enlaces");
  if (p === destino && info) throw new Error("Use un destino nuevo; no se sobrescriben carpetas existentes");
}

const propios = new Set(), externos = new Set();
async function visitar(archivo) {
  if (propios.has(archivo)) return;
  const fuente = resolve(raiz, archivo);
  const rel = relative(raiz, fuente);
  if (rel.startsWith("..") || resolve(raiz, rel) !== fuente) throw new Error("Dependencia fuera del proyecto");
  const texto = await readFile(fuente, "utf8");
  propios.add(archivo);
  const rx = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?|\bimport\s*\()['"]([^'"]+)['"]/g;
  for (const m of texto.matchAll(rx)) {
    if (m[1].startsWith(".")) await visitar(relative(raiz, resolve(dirname(fuente), m[1])).replaceAll("\\", "/"));
    else if (!m[1].startsWith("node:")) externos.add(m[1]);
  }
}
for (const entrada of ["puente/ejecutar.js", "puente/ejecutar-produccion.js", "puente/actualizar-finanzas-periodicas.js", "puente/importar-finanzas.js", "puente/actualizar-finanzas-get.js"]) await visitar(entrada);
if ([...externos].some(p => p !== "zod")) throw new Error("Revisar nuevas dependencias externas");

await mkdir(destino);
for (const archivo of [...propios].sort()) {
  await mkdir(dirname(join(destino, archivo)), { recursive: true });
  await cp(join(raiz, archivo), join(destino, archivo));
}
if (externos.has("zod")) {
  await mkdir(join(destino, "node_modules"));
  await cp(join(raiz, "node_modules/zod"), join(destino, "node_modules/zod"), { recursive: true });
}
const { version } = JSON.parse(await readFile(join(raiz, "package.json"), "utf8"));
await writeFile(join(destino, "package.json"), JSON.stringify({ name: "puente-cosprobell", version, private: true,
  type: "module", engines: { node: ">=22.13.0" } }, null, 2) + "\n");
let lanzador = await readFile(join(raiz, "puente/windows/ejecutar-puente.cmd"), "utf8");
const ancla = 'cd /d "%~dp0" || exit /b 1';
if (!lanzador.includes(ancla)) throw new Error("Revisar lanzador de Windows");
lanzador = lanzador.replace(ancla, ancla + '\nif not exist "%~dp0.env.puente" (\n  echo Falta .env.puente en la carpeta del puente. Conservar la configuracion del servidor.\n  exit /b 2\n)');
await writeFile(join(destino, "ejecutar-puente.cmd"), lanzador.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"));
await writeFile(join(destino, "ejecutar-oculto.vbs"), `Option Explicit
Dim shell, fso, carpeta, codigo, comando
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = carpeta
comando = "cmd.exe /d /s /c " & Chr(34) & Chr(34) & carpeta & "\\ejecutar-puente.cmd" & Chr(34) & Chr(34)
codigo = shell.Run(comando, 0, True)
WScript.Quit codigo
`.replaceAll("\n", "\r\n"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: raiz, encoding: "utf8" }).trim();
const cambiosLocales = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: raiz, encoding: "utf8" }).trim());
await writeFile(join(destino, "VERSION.txt"), `puente-cosprobell ${version}\ncommit ${commit}\narmado ${new Date().toISOString()}\nfinanzas: GET periodico opcional; requiere backend y migracion compatibles\n`);

const verificacion = `import {pathToFileURL} from 'node:url';
for(const m of ['entidades','config','estado','estado-publico','sap.client','sincronizar','finanzas.get','finanzas.importar','actualizar-finanzas-get']) await import('./puente/'+m+'.js');
if(!import.meta.resolve('zod').startsWith(pathToFileURL(process.cwd()+'/node_modules/zod/').href)) throw new Error('zod fuera del paquete');`;
const prueba = spawnSync(process.execPath, ["--input-type=module", "-e", verificacion], { cwd: destino, encoding: "utf8" });
if (prueba.status !== 0) throw new Error(prueba.stderr);
for (const entrada of ["ejecutar", "importar-finanzas", "actualizar-finanzas-get"]) {
  const sintaxis = spawnSync(process.execPath, ["--check", `puente/${entrada}.js`], { cwd: destino, encoding: "utf8" });
  if (sintaxis.status !== 0) throw new Error(sintaxis.stderr);
}
const archivos = [];
async function inventariar(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, f.name), rel = relative(destino, p).replaceAll("\\", "/");
    if (f.isSymbolicLink()) throw new Error("Enlace en el paquete");
    if (/(^|\/)\.env(?:\.|$)|(^|\/)\.bridge-state[^/]*|(^|\/)logs(?:\/|$)|(^|\/)certificado(?:\/|$)/i.test(rel)) throw new Error("Archivo privado en el paquete");
    if (f.isDirectory()) await inventariar(p);
    else archivos.push({ archivo: rel, sha256: createHash("sha256").update(await readFile(p)).digest("hex") });
  }
}
await inventariar(destino);
await writeFile(join(raiz, "dist", `${nombre}-manifiesto.json`), JSON.stringify({ paquete: nombre, commitBase: commit,
  contieneCambiosLocales: cambiosLocales, generadoEn: new Date().toISOString(), modulosPropios: propios.size,
  sinCredenciales: true, sinEstados: true, sinLogs: true, financieroRecurrente: false, archivos }, null, 2) + "\n");
console.log(JSON.stringify({ evento: "paquete_limpio_listo", carpeta: destino, modulosPropios: propios.size,
  archivos: archivos.length, sinCredenciales: true, sinEstados: true, sinLogs: true }));
