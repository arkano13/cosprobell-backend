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

test("Orders usa cursor numérico, incluye cierres y pide las líneas completas", async () => {
  const urls = [];
  const sap = crearClienteSap({ sapUrl: "https://sap.test/b1s/v1", empresa: "TEST" }, async (url, opciones) => {
    urls.push(url);
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticio; HttpOnly" } });
    assert.equal(opciones.headers.Prefer, "odata.maxpagesize=1");
    return Response.json({ value: [pedidoSap({ DocEntry: 10 })] });
  });
  await sap.pagina(9, PEDIDOS);
  const url = new URL(urls[1]);
  assert.equal(url.searchParams.get("$filter"), "DocType eq 'dDocument_Items' and DocEntry gt 9");
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
  const backend = { estado: async () => remoto, enviar: async (lote, entidad) => {
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
