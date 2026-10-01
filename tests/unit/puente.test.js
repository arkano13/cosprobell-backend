import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { configurar } from "../../puente/config.js";
import { abrirEstado, abrirAlmacen } from "../../puente/estado.js";
import { construirLoteClientes } from "../../puente/clientes.js";
import { CLIENTES, PRODUCTOS, ENTIDADES } from "../../puente/entidades.js";
import { construirLote } from "../../puente/productos.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { crearClienteBackend } from "../../puente/backend.client.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { ErrorPuente } from "../../puente/http.js";
const fila = (code = "P1", name = "Champú") => ({ ItemCode: code, ItemName: name, BarCode: "00123", Valid: "tYES", Frozen: "tNO" });
const variables = { SAP_SERVICE_LAYER_URL: "https://sap.example/b1s/v1", SAP_COMPANY_DB: "TEST", SAP_USER: "usuario", SAP_PASSWORD: "secreto",
  BACKEND_URL: "https://backend.example", BRIDGE_API_KEY: "clave-ficticia-con-mas-de-32-caracteres", BRIDGE_STATE_DIR: ".bridge-state" };
async function configTemporal(t) {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-emisor-"));
  t.after(() => rm(directorio, { recursive: true, force: true }));
  return configurar({ ...variables, BRIDGE_STATE_DIR: directorio });
}
test("transforma los campos SAP sin perder ceros iniciales", () => {
  assert.deepEqual(construirLote([fila()], "TEST", 1).productos[0], { itemCode: "P1", itemName: "Champú", barCode: "00123", valid: true, frozen: false });
  assert.equal(construirLote([{ ...fila(), BarCode: "" }], "TEST", 1).productos[0].barCode, null);
});
for (const datos of [{ ...fila(), Valid: null }, { ...fila(), Frozen: true }, { ...fila(), BarCode: 123 }, { ...fila(), ItemCode: " P1" }]) {
  test("rechaza producto SAP incompleto o incompatible", () => assert.throws(() => construirLote([datos], "TEST", 1), { code: "PRODUCTO_SAP_INVALIDO" }));
}
test("indica el producto y el campo SAP inválido sin incluir el valor", () => {
  for (const [datos, campo] of [[{ ...fila("P2"), ItemName: null }, "ItemName"], [{ ...fila("P2"), BarCode: "7401 " }, "BarCode"],
    [{ ...fila("P2"), Frozen: true }, "Frozen"], [fila(" P2"), "ItemCode"]]) {
    assert.throws(() => construirLote([fila(), datos], "TEST", 1), (e) => {
      assert.equal(e.code, "PRODUCTO_SAP_INVALIDO"); assert.deepEqual(e.detalle, { itemCode: datos.ItemCode, campo }); return true;
    });
  }
  assert.throws(() => construirLote([fila(), fila()], "TEST", 1), (e) => assert.deepEqual(e.detalle, { itemCode: "P1", campo: "ItemCode" }) ?? true);
  assert.throws(() => construirLote([fila()], "", 1), (e) => e.code === "PRODUCTO_SAP_INVALIDO" && e.detalle === undefined);
});
for (const cambio of [ { SAP_SERVICE_LAYER_URL: "http://sap.example/b1s/v1" }, { BACKEND_URL: "https://u:secreto@backend.example" },
  { SAP_SERVICE_LAYER_URL: "https://sap.example/otra" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { BRIDGE_INTERVAL_SECONDS: "0" }, { BRIDGE_API_KEY: "corta" } ]) {
  test("rechaza configuración insegura sin revelar secretos", () => assert.throws(() => configurar({ ...variables, ...cambio }), (e) => !e.message.includes("secreto")));
}
test("bloquea segunda instancia y vincula el estado a su origen", async (t) => {
  const config = await configTemporal(t); const a = await abrirEstado(config);
  await assert.rejects(abrirEstado(config), { code: "PUENTE_YA_BLOQUEADO" });
  await a.cerrar();
  await assert.rejects(abrirEstado({ ...config, origen: "otro" }), { code: "ESTADO_LOCAL_INCOMPATIBLE" });
  const b = await abrirEstado(config); await b.cerrar();
});
// PID fuera del rango que asignan Linux y Windows: nunca corresponde a un proceso vivo.
const PID_TERMINADO = 2147483644;
async function candadoPrevio(config, pid) {
  const candado = join(config.directorio, "ejecucion.lock"); await mkdir(candado);
  if (pid !== undefined) await writeFile(join(candado, "pid"), String(pid));
  return candado;
}
test("recupera el candado de un proceso que ya terminó y guarda el PID propio", async (t) => {
  const config = await configTemporal(t); const candado = await candadoPrevio(config, PID_TERMINADO);
  const a = await abrirEstado(config);
  assert.equal(await readFile(join(candado, "pid"), "utf8"), String(process.pid));
  assert.deepEqual((await readdir(config.directorio)).sort(), ["ejecucion.lock", "productos.json"]);
  await a.cerrar(); assert.deepEqual(await readdir(config.directorio), ["productos.json"]);
});
test("respeta un candado sin PID legible", async (t) => {
  const config = await configTemporal(t); await candadoPrevio(config);
  await assert.rejects(abrirEstado(config), { code: "PUENTE_YA_BLOQUEADO" });
  await writeFile(join(config.directorio, "ejecucion.lock", "pid"), "no-es-un-pid");
  await assert.rejects(abrirEstado(config), { code: "PUENTE_YA_BLOQUEADO" });
});
test("dos recuperaciones simultáneas del mismo candado huérfano: solo una continúa", async (t) => {
  const config = await configTemporal(t); await candadoPrevio(config, PID_TERMINADO);
  const resultados = await Promise.allSettled([abrirEstado(config), abrirEstado(config)]);
  const abiertos = resultados.filter((r) => r.status === "fulfilled");
  assert.equal(abiertos.length, 1);
  assert.equal(resultados.find((r) => r.status === "rejected").reason.code, "PUENTE_YA_BLOQUEADO");
  await abiertos[0].value.cerrar();
  assert.deepEqual(await readdir(config.directorio), ["productos.json"]);
});
test("cerrar no retira un candado que ya no es propio", async (t) => {
  const config = await configTemporal(t); const a = await abrirEstado(config);
  await writeFile(join(config.directorio, "ejecucion.lock", "pid"), String(PID_TERMINADO));
  await a.cerrar();
  assert.equal(await readFile(join(config.directorio, "ejecucion.lock", "pid"), "utf8"), String(PID_TERMINADO));
});
test("archivo corrupto no reinicia la secuencia silenciosamente", async (t) => {
  const config = await configTemporal(t); await writeFile(join(config.directorio, "productos.json"), "{");
  await assert.rejects(abrirEstado(config), { code: "ESTADO_LOCAL_INVALIDO" });
});
test("no envía nada si falla guardar el pendiente en disco", async () => {
  let envios = 0;
  await assert.rejects(sincronizar({ config: { empresa: "TEST" }, almacen: { estado: { secuencia: 0, cursor: null, pendiente: null }, guardar: async () => { throw new Error("Disco lleno"); } },
    backend: { estado: async () => 0, enviar: async () => { envios++; } }, sap: { pagina: async () => [fila()] } }), /Disco lleno/);
  assert.equal(envios, 0);
});
test("estado remoto distinto exige reconciliación antes de consultar SAP", async (t) => {
  const config = await configTemporal(t); const almacen = await abrirEstado(config); let consultas = 0;
  try {
    await assert.rejects(sincronizar({ config, almacen, backend: { estado: async () => 7 }, sap: { pagina: async () => { consultas++; } } }), { code: "REQUIERE_RECONCILIACION" });
    assert.equal(consultas, 0);
  } finally { await almacen.cerrar(); }
});
test("reinicio recupera lote confirmado cuya respuesta se perdió", async (t) => {
  const config = await configTemporal(t); let almacen = await abrirEstado(config); let remoto = 0, recibido;
  const backend = { estado: async () => remoto, enviar: async (lote) => { remoto = lote.secuencia; recibido = structuredClone(lote); throw new ErrorPuente("CONEXION_O_TLS", true); } };
  await assert.rejects(sincronizar({ config, almacen, backend, sap: { pagina: async () => [fila()] } }), { code: "CONEXION_O_TLS" });
  await almacen.cerrar(); almacen = await abrirEstado(config);
  assert.equal(almacen.estado.secuencia, 0); assert.equal(almacen.estado.pendiente.lote.productos[0].itemName, "Champú");
  let reenviado = false;
  backend.enviar = async (lote) => { assert.deepEqual(lote, recibido); reenviado = true; };
  try {
    const resultado = await sincronizar({ config, almacen, backend, sap: { pagina: async (cursor) => { assert.equal(reenviado, true); assert.equal(cursor, "P1"); return []; } } });
    assert.equal(resultado.completo, true); assert.equal(almacen.estado.secuencia, 1); assert.equal(almacen.estado.cursor, null);
    const disco = JSON.parse(await readFile(join(config.directorio, "productos.json"), "utf8")); assert.equal(disco.pendiente, null);
  } finally { await almacen.cerrar(); }
});
test("página repetida se detiene sin volver a enviar los mismos productos", async (t) => {
  const config = await configTemporal(t); const almacen = await abrirEstado(config); let envios = 0;
  try {
    await assert.rejects(sincronizar({ config, almacen, backend: { estado: async () => 0, enviar: async () => { envios++; } }, sap: { pagina: async () => [fila()] } }), { code: "PAGINACION_SIN_AVANCE" });
    assert.equal(envios, 1);
  } finally { await almacen.cerrar(); }
});
test("cliente SAP renueva una sesión vencida una vez y conserva ROUTEID", async () => {
  let login = 0, lecturas = 0;
  const cliente = crearClienteSap(configurar(variables), async (url, opciones) => {
    assert.equal(opciones.redirect, "error");
    if (url.endsWith("/Login")) {
      login++; return new Response("{}", { headers: [["Set-Cookie", `B1SESSION=s${login}; HttpOnly`], ["Set-Cookie", "ROUTEID=.node1; Path=/b1s"]] });
    }
    lecturas++; assert.match(opciones.headers.Cookie, /ROUTEID=.node1/);
    if (lecturas === 1) return new Response("{}", { status: 401 });
    assert.match(opciones.headers.Cookie, /B1SESSION=s2/); return Response.json({ value: [] });
  });
  assert.deepEqual(await cliente.pagina(null), []); assert.equal(login, 2); assert.equal(lecturas, 2);
});
test("filtro OData escapa comillas del código", async () => {
  const cliente = crearClienteSap(configurar(variables), async (url) => {
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=sesion" } });
    assert.equal(new URL(url).searchParams.get("$filter"), "ItemCode gt 'A''B'"); return Response.json({ value: [] });
  });
  await cliente.pagina("A'B");
});
test("consulta con $ literal, espacios %20, caracteres codificados y página de 50", async () => {
  const urls = [];
  const cliente = crearClienteSap(configurar(variables), async (url, opciones) => {
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=sesion" } });
    urls.push(url); assert.equal(opciones.headers.Prefer, "odata.maxpagesize=50"); return Response.json({ value: [] });
  });
  await cliente.pagina(null); await cliente.pagina("A+B&C D");
  assert.equal(urls[0], "https://sap.example/b1s/v1/Items?$select=ItemCode,ItemName,BarCode,Valid,Frozen&$orderby=ItemCode%20asc&$top=50");
  assert.equal(urls[1], `${urls[0]}&$filter=ItemCode%20gt%20'A%2BB%26C%20D'`);
  assert.equal(new URL(urls[1]).searchParams.get("$filter"), "ItemCode gt 'A+B&C D'");
});
test("confirmación inconsistente del backend se rechaza", async () => {
  const cliente = crearClienteBackend(configurar(variables), async () => Response.json({ data: { secuencia: 9, recibidos: 1, repetido: false } }));
  await assert.rejects(cliente.enviar(construirLote([fila()], "TEST", 1)), { code: "CONFIRMACION_INVALIDA" });
});
test("recorrido HTTP simulado: login, páginas, lotes, estado y logout", async (t) => {
  const config = await configTemporal(t); const peticiones = []; let secuencia = 0; const productos = new Map();
  const servidor = createServer(async (req, res) => {
    try {
      let texto = ""; for await (const chunk of req) texto += chunk;
      const u = new URL(req.url, "http://localhost"); peticiones.push(u.pathname);
      res.setHeader("Content-Type", "application/json");
      if (u.pathname === "/b1s/v1/Login") {
        assert.equal(JSON.parse(texto).CompanyDB, "TEST"); assert.equal(req.headers.authorization, undefined);
        res.setHeader("Set-Cookie", ["B1SESSION=sesion", "ROUTEID=.node1"]); res.end("{}");
      } else if (u.pathname === "/b1s/v1/Items") {
        assert.match(req.headers.cookie, /B1SESSION=sesion/);
        res.end(JSON.stringify({ value: u.searchParams.has("$filter") ? [] : [fila()] }));
      } else if (u.pathname === "/b1s/v1/Logout") { res.statusCode = 204; res.end(); }
      else {
        assert.equal(req.headers.authorization, `Bearer ${config.clave}`); assert.equal(req.headers.cookie, undefined);
        if (u.pathname.endsWith("/estado")) res.end(JSON.stringify({ data: { empresa: "TEST", ultimaSecuencia: secuencia } }));
        else {
          const lote = JSON.parse(texto); assert.equal(lote.secuencia, secuencia + 1); secuencia = lote.secuencia;
          for (const p of lote.productos) productos.set(p.itemCode, p);
          res.end(JSON.stringify({ data: { secuencia, recibidos: lote.productos.length, repetido: false } }));
        }
      }
    } catch { res.statusCode = 500; res.end('{}'); }
  });
  servidor.listen(0, "127.0.0.1"); await once(servidor, "listening");
  t.after(() => new Promise((resolve) => { servidor.close(resolve); servidor.closeAllConnections(); }));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const local = { ...config, sapUrl: `${base}/b1s/v1`, backendUrl: base };
  const almacen = await abrirEstado(config); const sap = crearClienteSap(local);
  try {
    const resultado = await sincronizar({ config: local, almacen, sap, backend: crearClienteBackend(local) });
    assert.equal(resultado.completo, true); assert.equal(productos.get("P1").barCode, "00123"); assert.equal(secuencia, 1);
    await sap.cerrar(); assert.ok(peticiones.includes("/b1s/v1/Logout"));
  } finally { await almacen.cerrar(); }
});

const clienteSap = (code = "C1", name = "Cliente Uno") => ({ CardCode: code, CardName: name, Valid: "tYES", Frozen: "tNO" });
test("clientes: transforma BusinessPartners e informa código y campo inválidos", () => {
  assert.deepEqual(construirLoteClientes([clienteSap("C001")], "TEST", 1).clientes, [{ cardCode: "C001", cardName: "Cliente Uno", valid: true, frozen: false }]);
  for (const [datos, campo] of [[{ ...clienteSap("C2"), CardName: null }, "CardName"], [{ ...clienteSap("C2"), Valid: "Y" }, "Valid"], [clienteSap("C2 "), "CardCode"]]) {
    assert.throws(() => construirLoteClientes([clienteSap(), datos], "TEST", 1), (e) => {
      assert.equal(e.code, "CLIENTE_SAP_INVALIDO"); assert.deepEqual(e.detalle, { cardCode: datos.CardCode, campo }); return true;
    });
  }
});
test("clientes se sincronizan antes que productos", () => {
  assert.deepEqual(ENTIDADES.map((e) => e.nombre), ["clientes", "productos", "unidades", "codigosBarras", "pedidos", "almacenes", "existencias",
    "entradasCompra", "entradasInventario", "salidasInventario", "devolucionesProveedor", "devolucionesCliente"]);
});
test("clientes: consulta solo clientes de SAP y combina el filtro con el cursor", async () => {
  const urls = [];
  const cliente = crearClienteSap(configurar(variables), async (url) => {
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=sesion" } });
    urls.push(url); return Response.json({ value: [] });
  });
  await cliente.pagina(null, CLIENTES); await cliente.pagina("C'1", CLIENTES);
  const base = "https://sap.example/b1s/v1/BusinessPartners?$select=CardCode,CardName,Valid,Frozen&$orderby=CardCode%20asc&$top=50";
  assert.equal(urls[0], `${base}&$filter=CardType%20eq%20'cCustomer'`);
  assert.equal(new URL(urls[1]).searchParams.get("$filter"), "CardType eq 'cCustomer' and CardCode gt 'C''1'");
});
test("clientes: el backend recibe en su ruta y se verifica la cantidad confirmada", async () => {
  const rutas = [];
  const backend = crearClienteBackend(configurar(variables), async (url, opciones) => {
    rutas.push(new URL(url).pathname);
    if (url.endsWith("/estado")) return Response.json({ data: { empresa: "TEST", ultimaSecuencia: 0 } });
    const lote = JSON.parse(opciones.body); return Response.json({ data: { secuencia: lote.secuencia, recibidos: lote.clientes.length, repetido: false } });
  });
  assert.equal(await backend.estado(CLIENTES), 0);
  await backend.enviar(construirLoteClientes([clienteSap(), clienteSap("C2")], "TEST", 1), CLIENTES);
  assert.deepEqual(rutas, ["/integracion/clientes/estado", "/integracion/clientes"]);
});
test("clientes: recorrido por CardCode, estado propio y recuperación del pendiente", async (t) => {
  const config = await configTemporal(t); const productos = await abrirEstado(config);
  try {
    let almacen = await abrirAlmacen(config, CLIENTES); let remoto = 0; const recibidos = [];
    const backend = { estado: async (e) => { assert.equal(e, CLIENTES); return remoto; },
      enviar: async (lote, e) => { assert.equal(e, CLIENTES); remoto = lote.secuencia; recibidos.push(...lote.clientes.map((c) => c.cardCode)); throw new ErrorPuente("CONEXION_O_TLS", true); } };
    const paginas = { null: [clienteSap("C1"), clienteSap("C2")], C2: [] };
    const sap = { pagina: async (cursor, e) => { assert.equal(e, CLIENTES); return paginas[cursor]; } };
    await assert.rejects(sincronizar({ config, almacen, sap, backend, entidad: CLIENTES }), { code: "CONEXION_O_TLS" });
    almacen = await abrirAlmacen(config, CLIENTES);
    assert.equal(almacen.estado.pendiente.cursor, "C2");
    backend.enviar = async (lote) => { recibidos.push(`reenvío ${lote.secuencia}`); };
    const resultado = await sincronizar({ config, almacen, sap, backend, entidad: CLIENTES });
    assert.deepEqual(resultado, { completo: true, lotes: 1, ultimaSecuencia: 1 });
    assert.deepEqual(recibidos, ["C1", "C2", "reenvío 1"]);
    assert.deepEqual((await readdir(config.directorio)).sort(), [`clientes-${config.origen}.sqlite`, "clientes.json", "ejecucion.lock", "productos.json"]);
    assert.equal(productos.estado.secuencia, 0);
  } finally { await productos.cerrar(); }
});
test("clientes: un pendiente que no cumple el contrato de clientes se rechaza", async (t) => {
  const config = await configTemporal(t);
  const lote = construirLote([fila()], "TEST", 1);
  await writeFile(join(config.directorio, "clientes.json"), JSON.stringify({ version: 1, origen: config.origen, secuencia: 0, cursor: null, pendiente: { lote, cursor: "P1" } }));
  await assert.rejects(abrirAlmacen(config, CLIENTES), { code: "PENDIENTE_INVALIDO" });
  await writeFile(join(config.directorio, "productos.json"), JSON.stringify({ version: 1, origen: config.origen, secuencia: 0, cursor: null, pendiente: { lote, cursor: "P1" } }));
  const almacen = await abrirAlmacen(config, PRODUCTOS); assert.equal(almacen.estado.pendiente.cursor, "P1");
});
