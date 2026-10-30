import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// Con INVENTARIO_SAP_WAREHOUSES solo salen esos almacenes y los que la app lleva; en un almacén de SAP, lo esperado sale de SAP.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.INVENTARIO_SAP_WAREHOUSES = "01,02,V07";
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { operadoresRepository } = await import("../../src/modules/operadores/operadores.repository.js");
const { inventarioRepository } = await import("../../src/modules/inventario/inventario.repository.js");
const { auditoriasRepository: repo } = await import("../../src/modules/auditorias/auditorias.repository.js");
const { hashApiKey } = await import("../../src/shared/security/hash.js");
const { logger } = await import("../../src/infrastructure/logging/logger.js");
logger.level = "silent";

let server, url;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); url = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await prisma.$disconnect(); });

test("auditoría: solo los almacenes del alcance y los de la app; en uno de SAP se espera lo que dice SAP", async (t) => {
  const TOKEN = "e".repeat(64);
  t.mock.method(operadoresRepository, "buscarSesion", async (h) => (h === hashApiKey(TOKEN)
    ? { id: 5, cerradaEn: null, expiraEn: new Date(Date.now() + 3600000), operador: { id: 9, nombre: "Admin", activo: true, rol: "supervisor" } } : null));
  const headers = { Authorization: `Bearer ${TOKEN}` };
  t.mock.method(inventarioRepository, "opcion", async (clave) => (clave === "almacenesPorBodega" ? { grande: "01", pequena: "02" }
    : clave === "almacenesSoloConteo" ? [{ almacen: "03", tipo: "sueltas" }] : null));
  t.mock.method(inventarioRepository, "almacenesDeEstaBodega", async () => ["01", "02"]);
  t.mock.method(repo, "almacenes", async () => ["01", "02", "03", "05", "V07", "V99"].map((c) => ({ warehouseCode: c, warehouseName: c })));
  t.mock.method(repo, "estadoPorAlmacen", async () => ({ enCurso: [], terminadas: [] }));
  const { data } = await (await fetch(`${url}/inventario/auditorias`, { headers })).json();
  assert.deepEqual(data.map((a) => a.almacen), ["01", "02", "03", "V07"]);

  t.mock.method(repo, "buscar", async () => ({ id: 1, almacen: "V07", estado: "en_curso", iniciadaPor: "operador:Admin", iniciadaEn: new Date() }));
  t.mock.method(repo, "escaneado", async () => ({ productos: [{ itemCode: "A", itemName: "Uno", unidades: 2 }], personas: [] }));
  const sap = t.mock.method(repo, "sap", async () => new Map([["A", 3], ["B", 1.4]]));
  t.mock.method(repo, "nombres", async (c) => new Map(c.map((x) => [x, `Producto ${x}`])));
  const { data: vista } = await (await fetch(`${url}/inventario/auditorias/1`, { headers })).json();
  assert.deepEqual([vista.fuente, vista.esperadas, vista.productos.map((p) => [p.itemCode, p.unidades, p.esperadas])],
    ["sap", 4, [["A", 2, 3], ["B", 0, 1]]]);
  assert.deepEqual(sap.mock.calls[0].arguments.slice(0, 2), ["V07", ["01", "02", "V07"]]);
});
