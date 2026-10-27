import { mkdir, cp, readFile, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION_OPERATIVA } from "../puente/version-operativa.js";
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "dist", "mejora-operativa-20261026");
if (dirname(resolve(destino)) !== resolve(raiz, "dist")) throw new Error("Destino inválido");
for (const ruta of [join(raiz,"dist"),destino]) {
  const info = await lstat(ruta).catch(e=>{if(e.code!=="ENOENT")throw e;});
  if(info?.isSymbolicLink())throw new Error("Destino enlazado no admitido");
}
await mkdir(join(destino,"puente"),{recursive:true});
await mkdir(join(destino,"scripts"),{recursive:true});
const nombres = ["config.js","control.js","ejecutar.js","estado.js","estado-publico.js","opciones.js","sap.client.js","sincronizar.js",
  "solicitud-manual.js","facturasPreparacion.js","version-operativa.js"];
const archivos=[];
for(const nombre of nombres){
  const archivo=`puente/${nombre}`;
  await cp(join(raiz,archivo),join(destino,archivo));
  archivos.push({archivo,sha256:createHash("sha256").update(await readFile(join(destino,archivo))).digest("hex")});
}
await cp(join(raiz,"scripts/verificar-mejora-operativa.js"),join(destino,"scripts/verificar-mejora-operativa.js"));
await cp(join(raiz,"docs/MEJORA_OPERATIVA_2026-10-26.md"),join(destino,"LEEME.md"));
await writeFile(join(destino,"MEJORA_OPERATIVA.json"),JSON.stringify({version:VERSION_OPERATIVA,armadoEn:new Date().toISOString(),archivos},null,2)+"\n");
console.log(`Parche operativo: ${destino}`);
