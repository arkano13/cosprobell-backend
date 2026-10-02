import test from "node:test";
import assert from "node:assert/strict";
import { ejecutarUnaVez } from "../../src/modules/inventario/inventario.operacion.js";

const id = "abcdef12-3456-4789-9123-123456789abc";
const solicitud = (unidades = 5, aplicacion = "operador:1") => ({ operacionId: id, tipo: "reponer", entrada: { unidades, operacionId: id }, aplicacion });
function memoria() {
  const registros = new Map();
  return {
    registros,
    async $queryRaw(sql, ...args) { return sql.join("").includes("SELECT hash") ? [registros.get(args[0])].filter(Boolean) : []; },
    async $executeRaw(_sql, clave, hash, respuesta) { registros.set(clave, { hash, respuesta: JSON.parse(respuesta) }); },
  };
}
test("inventario idempotente: un reintento devuelve el resultado sin repetir el movimiento", async () => {
  const tx = memoria(); let movimientos = 0;
  const accion = async () => ({ data: { movimiento: ++movimientos } });
  assert.deepEqual(await ejecutarUnaVez(tx, solicitud(), accion), await ejecutarUnaVez(tx, solicitud(), accion));
  assert.equal(movimientos, 1);
});
test("inventario idempotente: UUID en mayúsculas y propiedades reordenadas representan la misma operación", async () => {
  const tx = memoria();
  await ejecutarUnaVez(tx, solicitud(), async () => ({ ok: true }));
  const s = solicitud(); s.operacionId = id.toUpperCase(); s.entrada = { operacionId: s.operacionId, unidades: 5 };
  assert.deepEqual(await ejecutarUnaVez(tx, s, () => assert.fail("No debe ejecutar")), { ok: true });
});
test("inventario idempotente: cambiar cantidad o usuario con el mismo UUID produce conflicto", async () => {
  const tx = memoria();
  await ejecutarUnaVez(tx, solicitud(), async () => ({ ok: true }));
  for (const s of [solicitud(6), solicitud(5, "operador:2")]) {
    await assert.rejects(ejecutarUnaVez(tx, s, () => assert.fail("No debe ejecutar")), { code: "OPERACION_REUTILIZADA" });
  }
});
test("inventario idempotente: un fallo no guarda una respuesta exitosa y permite reintentar", async () => {
  const tx = memoria();
  await assert.rejects(ejecutarUnaVez(tx, solicitud(), async () => { throw new Error("fallo"); }), /fallo/);
  assert.equal(tx.registros.size, 0);
  assert.deepEqual(await ejecutarUnaVez(tx, solicitud(), async () => ({ ok: true })), { ok: true });
});
test("inventario idempotente: identificador inválido se rechaza antes de consultar", async () => {
  await assert.rejects(ejecutarUnaVez({}, { operacionId: "incorrecto" }, () => assert.fail()), { code: "OPERACION_INVALIDA" });
});
