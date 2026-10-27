import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const raiz=resolve(dirname(fileURLToPath(import.meta.url)),"..");
try{
  const manifiesto=JSON.parse(await readFile(join(raiz,"MEJORA_OPERATIVA.json"),"utf8"));
  if(!Array.isArray(manifiesto.archivos)||!manifiesto.archivos.length)throw new Error("Manifiesto inválido");
  const diferentes=[];
  for(const entrada of manifiesto.archivos){
    if(!/^puente\/[a-zA-Z.-]+\.js$/.test(entrada.archivo)||!/^[a-f0-9]{64}$/.test(entrada.sha256))throw new Error("Manifiesto inválido");
    const dato=await readFile(join(raiz,entrada.archivo)).catch(()=>null);
    if(!dato||createHash("sha256").update(dato).digest("hex")!==entrada.sha256)diferentes.push(entrada.archivo);
  }
  console.log(JSON.stringify({evento:"verificacion_operativa",version:manifiesto.version,correcto:!diferentes.length,archivosDiferentes:diferentes}));
  if(diferentes.length)process.exitCode=1;
}catch{
  console.log(JSON.stringify({evento:"verificacion_operativa",correcto:false,codigo:"REVISAR_ARCHIVOS_Y_MANIFIESTO"}));
  process.exitCode=1;
}
