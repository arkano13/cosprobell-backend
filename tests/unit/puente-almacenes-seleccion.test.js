import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { consultaParaConfig, fuenteExistencias, convertirExistenciaAlmacenes, validarAlmacenesSql } from "../../puente/existencias.sql.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { entidadesHabilitadas } from "../../puente/entidades.js";
import { construirLoteExistencias } from "../../puente/existencias.js";
import { configurar } from "../../puente/config.js";
import { entidadPendiente } from "../../puente/control.js";

const seleccion = ["01", "02", "v01", "v03", "v05", "v05-1", "99"];
const config = { modoExistencias: "sql-almacenes", almacenesSap: seleccion, inventarioHabilitado: true,
  sapUrl: "https://sap.test/b1s/v1", empresa: "TEST", usuario: "test", password: "test" };

test("selección rechaza duplicados, SQL inyectado y listas vacías; preserva los códigos", () => {
  for (const lista of [[], ["01", "01"], ["v01", "V01"], ["' OR 1=1"], ["01", ""], Array.from({length:11}, (_,i)=>String(i))]) {
    assert.throws(() => validarAlmacenesSql(lista));
  }
  assert.ok(validarAlmacenesSql(seleccion).includes("v05-1"));
  const v = { SAP_SERVICE_LAYER_URL: config.sapUrl, SAP_COMPANY_DB: "TEST", SAP_USER: "test", SAP_PASSWORD: "test",
    BACKEND_URL: "https://backend.test", BRIDGE_API_KEY: "x".repeat(40), BRIDGE_STATE_DIR: ".bridge-state" };
  assert.throws(() => configurar({...v, BRIDGE_STOCK_MODE:"sql-almacenes"}));
  assert.throws(() => configurar({...v, BRIDGE_WAREHOUSES:"01,02"}));
  assert.deepEqual(configurar({...v, BRIDGE_STOCK_MODE:"sql-almacenes", BRIDGE_WAREHOUSES:seleccion.join(",")}).almacenesSap, [...seleccion].sort());
});

test("selección cambia identidad y fuerza recorrido; reordenarla conserva identidad", () => {
  assert.equal(fuenteExistencias(config), fuenteExistencias({...config, almacenesSap:[...seleccion].reverse()}));
  assert.notEqual(fuenteExistencias(config), fuenteExistencias({...config, almacenesSap:["01", "02"]}));
  const estado = { cursor:null, ultimoCompleto:new Date().toISOString(), fuenteExistencias:fuenteExistencias(config) };
  assert.equal(entidadPendiente(estado, "existencias", config), false);
  assert.equal(entidadPendiente(estado, "existencias", {...config, almacenesSap:["01"]}), true);
});

test("consulta de siete almacenes excluye ajenos y conserva ceros, ausencias y negativos", () => {
  const {consulta, codigos} = consultaParaConfig(config);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE OITM(ItemCode TEXT PRIMARY KEY,InvntItem TEXT);
      CREATE TABLE OITW(ItemCode TEXT,WhsCode TEXT,OnHand REAL,IsCommited REAL,OnOrder REAL,PRIMARY KEY(ItemCode,WhsCode));
      INSERT INTO OITM VALUES ('A','Y'),('B','Y'),('C','N');
      INSERT INTO OITW VALUES ('A','OTRO',999,0,0),('B','OTRO',888,0,0);`);
    const insertar = db.prepare("INSERT INTO OITW VALUES ('A',?, ?,0,0)");
    codigos.forEach((c,i) => insertar.run(c, i === 0 ? -2 : i+1));
    const stmt = db.prepare(consulta.SqlText.replace("TOP 20 ", "") + " LIMIT 20");
    const convertir = () => construirLoteExistencias(stmt.all({after:""}).map(f=>convertirExistenciaAlmacenes(f,codigos)),"TEST",1).existencias;
    assert.deepEqual(convertir()[0].almacenes.map(a=>a.warehouseCode), codigos);
    assert.equal(convertir()[0].almacenes[0].inStock,-2);
    assert.deepEqual(convertir().slice(1).map(a=>a.almacenes),[[],[]]);
    db.exec("UPDATE OITW SET OnHand=0 WHERE WhsCode<>'OTRO'");
    assert.deepEqual(convertir()[0].almacenes,[]);
    const rota = {...stmt.all({after:""})[0], InStock7:null};
    assert.throws(()=>convertirExistenciaAlmacenes(rota,codigos),{code:"EXISTENCIA_SAP_INVALIDA"});
  } finally { db.close(); }
});

test("cliente verifica todos los códigos exactos y nunca consulta Items ante un almacén incorrecto", async () => {
  const {consulta,codigos} = consultaParaConfig(config);
  const llamadas=[];
  const entidad=entidadesHabilitadas(config).find(e=>e.nombre==="existencias");
  const crear = incorrecto => crearClienteSap(config, async (url) => {
    llamadas.push(url);
    if(url.endsWith("/Login")) return new Response("{}",{headers:{"Set-Cookie":"B1SESSION=test"}});
    const wh=/Warehouses\('([^']+)'\)/.exec(url);
    if(wh) return Response.json({WarehouseCode:incorrecto ? wh[1].toUpperCase() : wh[1]});
    assert.ok(url.includes(consulta.SqlCode));
    return Response.json({SqlText:consulta.SqlText,value:[]});
  });
  assert.deepEqual(await crear(false).pagina(null,entidad),[]);
  assert.equal(llamadas.filter(u=>u.includes("/Warehouses(")).length,codigos.length);
  llamadas.length=0;
  await assert.rejects(crear(true).pagina(null,entidad),{code:"ALMACEN_SAP_INVALIDO"});
  assert.ok(!llamadas.some(u=>u.includes("/SQLQueries") || u.includes("/Items?")));
});
