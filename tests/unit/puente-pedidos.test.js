import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PEDIDOS } from "../../puente/entidades.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { abrirAlmacen } from "../../puente/estado.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { pedidoSap } from "../fixtures/pedido.js";
import { crearClienteBackend } from "../../puente/backend.client.js";
import { ErrorPuente } from "../../puente/http.js";

test("Orders recorre solo pedidos abiertos con cursor numérico y pide las líneas completas", async () => {
  const urls = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1", empresa: "TEST" }, async (url, opciones) => {
    urls.push(url);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticio; HttpOnly" } });
    assert.equal(opciones.headers.Prefer, "odata.maxpagesize=1");
    return Response.json({ value: [pedidoSap({ DocEntry: 10 })] });
  });
  await sap.pagina(9, PEDIDOS);
  const url = new URL(urls[1]);
  assert.equal(url.searchParams.get("$filter"), "DocType eq 'dDocument_Items' and DocumentStatus eq 'bost_Open' and DocEntry gt 9");
  assert.equal(url.searchParams.get("$top"), "1");
  assert.ok(url.searchParams.get("$select").includes("DocumentLines"));
  await assert.rejects(sap.pagina("9 or 1 eq 1", PEDIDOS), { code: "CURSOR_INVALIDO" });
  assert.equal(urls.length, 2);
});

test("pedidos recupera lote pendiente tras perder confirmación y persiste cursor numérico", async (t) => {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-pedidos-"));
  t.after(() => rm(directorio, { recursive: true, force: true }));
  const config = { directorio, origen: "origen-simulado", empresa: "TEST" };
  let remoto = 0, perderRespuesta = true;
  const enviados = [], cursores = [];
  const backend = { estado: async () => remoto, hora: async () => "2026-09-28T12:00:00.000Z", pedidosAbiertos: async () => ({ ahora: "2026-09-28T12:00:00.000Z", pedidos: [] }), enviar: async (lote, entidad) => {
    assert.equal(entidad, PEDIDOS); enviados.push(structuredClone(lote)); remoto = lote.secuencia;
    if (perderRespuesta) { perderRespuesta = false; throw new Error("respuesta perdida"); }
  } };
  const sap = { pagina: async (cursor) => { cursores.push(cursor); return cursor === null ? [pedidoSap()] : []; } };
  const almacen = await abrirAlmacen(config, PEDIDOS);
  await assert.rejects(sincronizar({ config, almacen, sap, backend, entidad: PEDIDOS }), /respuesta perdida/);
  const recuperado = await abrirAlmacen(config, PEDIDOS);
  assert.equal(recuperado.estado.pendiente.cursor, 9);
  const resultado = await sincronizar({ config, almacen: recuperado, sap, backend, entidad: PEDIDOS });
  assert.equal(resultado.completo, true);
  assert.deepEqual(enviados[0], enviados[1]);
  assert.deepEqual(cursores, [null, 9]);
  assert.equal((await abrirAlmacen(config, PEDIDOS)).estado.secuencia, 1);
});

test("pedido con líneas paginadas o de servicio no se envía como instantánea completa", () => {
  for (const cambios of [{ "DocumentLines@odata.nextLink": "otra" }, { DocType: "dDocument_Service" }]) {
    assert.throws(() => PEDIDOS.construirLote([pedidoSap(cambios)], "TEST", 1), { code: "PEDIDO_SAP_INVALIDO" });
  }
});

test("una página que retrocede no se guarda ni se envía", async () => {
  const almacen = { estado: { secuencia: 1, cursor: 10, pendiente: null }, guardar: async () => assert.fail("No debe guardar") };
  await assert.rejects(sincronizar({ config: { empresa: "TEST" }, almacen, entidad: PEDIDOS,
    sap: { pagina: async () => [pedidoSap()] }, backend: { estado: async () => 1, enviar: async () => assert.fail("No debe enviar") } }),
  { code: "PAGINACION_SIN_AVANCE" });
});

// Backend simulado: guarda cada pedido con la hora (simulada) de su última recepción.
function backendSimulado() {
  let reloj = 1000, remoto = 0; const pedidos = new Map(), enviados = [];
  const iso = (ms) => new Date(ms).toISOString();
  return { pedidos, enviados, backend: {
    estado: async () => remoto,
    hora: async () => iso(++reloj),
    pedidosAbiertos: async () => ({ ahora: iso(++reloj), pedidos: [...pedidos.values()]
      .filter((p) => p.documentStatus === "bost_Open").map((p) => ({ docEntry: p.docEntry, sincronizadoEn: iso(p.en) })) }),
    enviar: async (lote) => { remoto = lote.secuencia; for (const p of lote.pedidos) { pedidos.set(p.docEntry, { ...p, en: ++reloj }); enviados.push(p.docEntry); } },
  } };
}
async function almacenTemporal(t) {
  const directorio = await mkdtemp(join(tmpdir(), "cosprobell-cierres-"));
  t.after(() => rm(directorio, { recursive: true, force: true }));
  const config = { directorio, origen: "origen-simulado", empresa: "TEST" };
  return { config, abrir: () => abrirAlmacen(config, PEDIDOS) };
}
test("al terminar el recorrido pide por clave los pedidos abiertos localmente que SAP ya no lista", async (t) => {
  const { config, abrir } = await almacenTemporal(t); const f = backendSimulado();
  let abiertosSap = [pedidoSap({ DocEntry: 1 }), pedidoSap({ DocEntry: 2 }), pedidoSap({ DocEntry: 3 })];
  const documentos = [];
  const sap = {
    pagina: async (cursor) => abiertosSap.filter((p) => p.DocEntry > (cursor ?? -1)).slice(0, 1),
    documento: async (clave) => { documentos.push(clave); return pedidoSap({ DocEntry: clave, DocumentStatus: "bost_Close", Cancelled: clave === 3 ? "tYES" : "tNO", CancelStatus: clave === 3 ? "csYes" : "csNo" }); },
  };
  let resultado = await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: PEDIDOS });
  assert.deepEqual(resultado, { completo: true, lotes: 3, ultimaSecuencia: 3 });
  assert.deepEqual(documentos, []);
  // En SAP se cierra el 2 y se cancela el 3: dejan de aparecer entre los abiertos.
  abiertosSap = [pedidoSap({ DocEntry: 1 })];
  resultado = await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: PEDIDOS });
  assert.deepEqual(resultado, { completo: true, lotes: 3, ultimaSecuencia: 6 });
  assert.deepEqual(documentos, [2, 3]);
  assert.equal(f.pedidos.get(2).documentStatus, "bost_Close");
  assert.equal(f.pedidos.get(3).cancelled, true);
  const disco = (await abrir()).estado;
  assert.deepEqual([disco.cursor, disco.porRevisar, disco.inicioRecorrido, disco.pendiente], [null, null, null, null]);
  // Tercer recorrido: nada que revisar.
  await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: PEDIDOS });
  assert.deepEqual(documentos, [2, 3]);
});
test("una revisión de cierres interrumpida continúa donde quedó sin volver a recorrer SAP", async (t) => {
  const { config, abrir } = await almacenTemporal(t); const f = backendSimulado();
  let abiertosSap = [pedidoSap({ DocEntry: 1 }), pedidoSap({ DocEntry: 2 }), pedidoSap({ DocEntry: 3 })];
  const paginas = [], documentos = []; let fallar = true;
  const sap = {
    pagina: async (cursor) => { paginas.push(cursor); return abiertosSap.filter((p) => p.DocEntry > (cursor ?? -1)).slice(0, 1); },
    documento: async (clave) => {
      documentos.push(clave);
      if (clave === 3 && fallar) { fallar = false; throw new ErrorPuente("CONEXION_O_TLS", true); }
      return pedidoSap({ DocEntry: clave, DocumentStatus: "bost_Close" });
    },
  };
  await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: PEDIDOS });
  abiertosSap = []; paginas.length = 0;
  await assert.rejects(sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: PEDIDOS }), { code: "CONEXION_O_TLS" });
  assert.deepEqual((await abrir()).estado.porRevisar, [3]);
  paginas.length = 0;
  const resultado = await sincronizar({ config, almacen: await abrir(), sap, backend: f.backend, entidad: PEDIDOS });
  assert.equal(resultado.completo, true);
  assert.deepEqual(paginas, []);
  assert.deepEqual(documentos, [1, 2, 3, 3]);
  assert.ok([1, 2, 3].every((d) => f.pedidos.get(d).documentStatus === "bost_Close"));
});
test("un recorrido iniciado sin hora de inicio deja la revisión para el siguiente", async (t) => {
  const { config, abrir } = await almacenTemporal(t); const f = backendSimulado();
  const almacen = await abrir(); await almacen.guardar({ ...almacen.estado, cursor: 5 }); almacen.estado = { ...almacen.estado, cursor: 5 };
  const sap = { pagina: async () => [], documento: async () => assert.fail("No debe revisar sin hora de inicio") };
  const resultado = await sincronizar({ config, almacen, sap, backend: f.backend, entidad: PEDIDOS });
  assert.equal(resultado.completo, true);
});
test("SAP: lee un pedido por su clave e informa si no existe", async () => {
  const urls = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1", empresa: "TEST" }, async (url) => {
    urls.push(url);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticio; HttpOnly" } });
    return url.includes("Orders(7)") ? Response.json(pedidoSap({ DocEntry: 7 })) : new Response("{}", { status: 404 });
  });
  assert.equal((await sap.documento(7, PEDIDOS)).DocEntry, 7);
  assert.equal(urls[1], `https://sap.test/b1s/v1/Orders(7)?$select=${PEDIDOS.campos.join(",")}`);
  await assert.rejects(sap.documento(8, PEDIDOS), (e) => e.code === "REGISTRO_NO_ENCONTRADO_EN_SAP" && e.detalle.docEntry === 8 && e.temporal === false);
  await assert.rejects(sap.documento("8 or 1 eq 1", PEDIDOS), { code: "CURSOR_INVALIDO" });
});
test("backend: valida la lista de pedidos abiertos", async () => {
  const config = { backendUrl: "https://backend.test", clave: "x".repeat(40), empresa: "TEST" };
  const respuesta = (data) => crearClienteBackend(config, async (url) => { assert.equal(new URL(url).pathname, "/integracion/pedidos/abiertos"); return Response.json({ data }); });
  const valido = { ahora: "2026-09-28T12:00:00.000Z", pedidos: [{ docEntry: 1, sincronizadoEn: "2026-09-28T11:00:00.000Z" }] };
  assert.deepEqual(await respuesta(valido).pedidosAbiertos(), valido);
  for (const data of [{ ...valido, ahora: "ayer" }, { ...valido, pedidos: [{ docEntry: "1", sincronizadoEn: valido.ahora }] }, { ahora: valido.ahora }]) {
    await assert.rejects(respuesta(data).pedidosAbiertos(), { code: "ESTADO_BACKEND_INVALIDO" });
  }
});
