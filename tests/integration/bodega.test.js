import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { pedidosRepository } = await import("../../src/modules/pedidos/pedidos.repository.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre]; objeto[nombre] = implementacion; t.after(() => { objeto[nombre] = original; });
}

test("la pantalla de bodega se sirve sin API key y con la política de seguridad", async () => {
  const pagina = await fetch(`${url}/bodega/`);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get("content-type"), /text\/html/);
  assert.match(pagina.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await pagina.text(), /<script type="module" src="js\/app.js">/);
  for (const archivo of ["js/app.js", "js/api.js", "js/lecturas.js", "js/uuid.js", "js/iconos.js", "estilos.css"]) {
    assert.equal((await fetch(`${url}/bodega/${archivo}`)).status, 200, archivo);
  }
  assert.equal((await fetch(`${url}/bodega`, { redirect: "manual" })).status, 301);
  // Los datos siguen protegidos.
  assert.equal((await fetch(`${url}/pedidos`)).status, 401);
});

test("el detalle del pedido agrega el nombre de cada producto", async (t) => {
  sustituir(t, prisma.pedido, "findUnique", async () => ({ docEntry: 9, lineas: [{ lineNum: 0, itemCode: "P1" }, { lineNum: 1, itemCode: "P2" }] }));
  let consulta;
  sustituir(t, prisma.producto, "findMany", async (args) => { consulta = args; return [{ itemCode: "P1", itemName: "Shampoo" }]; });
  const pedido = await pedidosRepository.obtener(9);
  assert.deepEqual(consulta.where, { itemCode: { in: ["P1", "P2"] } });
  assert.deepEqual(pedido.lineas.map((l) => [l.itemCode, l.itemName]), [["P1", "Shampoo"], ["P2", null]]);
  sustituir(t, prisma.pedido, "findUnique", async () => null);
  assert.equal(await pedidosRepository.obtener(10), null);
});
