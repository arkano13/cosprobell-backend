import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("CLI dirigido: reparte turnos, confirma lotes y no fuerza otras entidades ni el botón", { timeout: 30000 }, async t => {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-dirigido-"));
  const llamadas = [], recibidos = [], secuencias = { clientes: 0, productos: 0 };
  let falloLogin = false;
  const servidor = createServer(async (req,res) => {
    const url = new URL(req.url,"http://local");
    const json = data => { res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(data)); };
    llamadas.push(url.pathname);
    if (url.pathname.endsWith("/Login")) {
      if (falloLogin) { res.statusCode=401;json({error:{code:"401"}});return; }
      res.setHeader("Set-Cookie","B1SESSION=ficticia"); json({}); return;
    }
    if (url.pathname.endsWith("/Logout")) { res.writeHead(204).end(); return; }
    if (url.pathname.startsWith("/b1s/")) {
      const clientes = url.pathname.endsWith("/BusinessPartners");
      const prefix = clientes ? "C" : "P";
      const anterior = Number(new RegExp(`${prefix}(\\d+)`).exec(url.searchParams.get("$filter") ?? "")?.[1] ?? 0);
      const fila = anterior >= 2 ? [] : [clientes
        ? { CardCode: `C${anterior+1}`, CardName: "Cliente", Valid: "tYES", Frozen: "tNO" }
        : { ItemCode: `P${anterior+1}`, ItemName: "Producto", BarCode: null, Valid: "tYES", Frozen: "tNO" }];
      json({value:fila}); return;
    }
    const [,entidad,accion] = /^\/integracion\/(clientes|productos)(?:\/(estado|observados))?$/.exec(url.pathname) ?? [];
    if (!entidad) { res.writeHead(404).end(); return; }
    if (accion === "estado") { json({data:{empresa:"TEST",ultimaSecuencia:secuencias[entidad]}}); return; }
    let body="";for await(const c of req)body+=c;
    const dato=JSON.parse(body);
    if (accion === "observados") { json({data:{observados:dato.claves.length}});return; }
    secuencias[entidad]=dato.secuencia;recibidos.push([entidad,dato[entidad].length]);
    json({data:{secuencia:dato.secuencia,recibidos:dato[entidad].length,repetido:false}});
  });
  await new Promise(r=>servidor.listen(0,"127.0.0.1",r));
  t.after(async()=>{servidor.closeAllConnections();await new Promise(r=>servidor.close(r));await rm(directorio,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${servidor.address().port}`;
  const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,
    SAP_SERVICE_LAYER_URL:`${url}/b1s/v1`,BACKEND_URL:url,SAP_COMPANY_DB:"TEST",SAP_USER:"test",SAP_PASSWORD:"ficticia",
    BRIDGE_API_KEY:"x".repeat(40),BRIDGE_STATE_DIR:directorio,BRIDGE_REQUEST_DELAY_MS:"100",BRIDGE_MAX_REQUESTS:"25",BRIDGE_MAX_REQUESTS_PER_ENTITY:"2"};
  const {stdout}=await promisify(execFile)(process.execPath,["puente/ejecutar.js","--once","--forzar","--entidades=clientes,productos"],{env,timeout:20000});
  assert.match(stdout,/pausa_por_entidad/);
  assert.deepEqual(stdout.trim().split(/\r?\n/).map(JSON.parse).find(e=>e.evento==="resumen").pendientes,[]);
  assert.equal(llamadas.some(r=>r.includes("solicitud")),false);
  assert.equal(llamadas.some(r=>/Items|BusinessPartners/.test(r)),true);
  assert.equal(recibidos.reduce((s,r)=>s+r[1],0),4);
  assert.deepEqual(secuencias,{clientes:2,productos:2});
  const paginas=llamadas.filter(r=>/BusinessPartners|Items/.test(r));
  assert.equal(paginas.length,6);
  const clienteUltima=paginas.lastIndexOf("/b1s/v1/BusinessPartners");
  assert.ok(paginas.indexOf("/b1s/v1/Items")<clienteUltima);
  const antes=llamadas.length;
  const estado=await promisify(execFile)(process.execPath,["puente/ejecutar.js","--estado"],{env:{...env,BRIDGE_PAUSED_ENTITIES:"productos"},timeout:10000});
  assert.match(estado.stdout,/estado_local/);assert.equal(llamadas.length,antes);
  const estadoLocal=estado.stdout.trim().split(/\r?\n/).map(JSON.parse).find(e=>e.evento==="estado_local");
  assert.equal(estadoLocal.entidades.find(e=>e.entidad==="productos").pausada,true);
  await assert.rejects(promisify(execFile)(process.execPath,["puente/ejecutar.js","--once","--forzar","--entidades=productos"],
    {env:{...env,BRIDGE_PAUSED_ENTITIES:"productos"},timeout:10000}),e=>e.stderr.includes("ENTIDAD_PAUSADA"));
  assert.equal(llamadas.length,antes);
  falloLogin=true;
  const iniciosAntes=llamadas.filter(r=>r.endsWith("/Login")).length;
  await assert.rejects(promisify(execFile)(process.execPath,["puente/ejecutar.js","--once","--forzar","--entidades=clientes,productos"],
    {env,timeout:10000}),e=>e.stderr.includes("HTTP_401"));
  assert.equal(llamadas.filter(r=>r.endsWith("/Login")).length-iniciosAntes,1);
});
