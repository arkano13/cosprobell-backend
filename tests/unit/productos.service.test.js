import test from "node:test";
import assert from "node:assert/strict";

// Las pruebas sustituyen el repositorio; no consultan PostgreSQL.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { productosRepository } = await import("../../src/modules/productos/productos.repository.js");
const { buscarProductoPorCodigo } = await import("../../src/modules/productos/productos.service.js");

test("rechaza entradas vacias o no textuales sin consultar", async (t) => {
  const consulta = t.mock.method(productosRepository, "buscarPorCodigo", async () => []);
  for (const valor of [undefined, null, 123, "", "   "]) {
    assert.deepEqual(await buscarProductoPorCodigo(valor), { estado: "codigo_invalido" });
  }
  assert.equal(consulta.mock.callCount(), 0);
});

test("conserva ceros iniciales y encuentra el producto", async (t) => {
  const producto = { itemCode: "PROD-001", itemName: "Producto de prueba" };
  t.mock.method(productosRepository, "buscarPorCodigo", async (codigo) => {
    assert.equal(codigo, "00123");
    return [producto];
  });
  assert.deepEqual(await buscarProductoPorCodigo(" 00123 "), { estado: "encontrado", producto });
});

test("informa codigo desconocido", async (t) => {
  t.mock.method(productosRepository, "buscarPorCodigo", async () => []);
  assert.deepEqual(await buscarProductoPorCodigo("DESCONOCIDO"), { estado: "no_encontrado" });
});

test("no elige un producto cuando el codigo es ambiguo", async (t) => {
  t.mock.method(productosRepository, "buscarPorCodigo", async () => [
    { itemCode: "A" }, { itemCode: "B" },
  ]);
  assert.deepEqual(await buscarProductoPorCodigo("DUPLICADO"), { estado: "codigo_ambiguo" });
});

test("un fallo tecnico no se convierte en producto inexistente", async (t) => {
  const fallo = new Error("Fallo de consulta simulado");
  t.mock.method(productosRepository, "buscarPorCodigo", async () => { throw fallo; });
  await assert.rejects(buscarProductoPorCodigo("00123"), (err) => err === fallo);
});
