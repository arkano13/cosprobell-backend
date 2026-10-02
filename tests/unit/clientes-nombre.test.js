import test from "node:test";
import assert from "node:assert/strict";
import { construirLoteClientes } from "../../puente/clientes.js";
const cliente = { CardCode: "C11108", Valid: "tYES", Frozen: "tNO" };
test("cliente sin nombre conserva identidad y deja advertencia sin datos personales", t => {
  const avisos = [];
  t.mock.method(console, "warn", texto => avisos.push(JSON.parse(texto)));
  for (const CardName of [null, undefined, "", "   "]) {
    const lote = construirLoteClientes([{ ...cliente, CardName }], "TEST", 1);
    assert.equal(lote.clientes[0].cardName, "Cliente C11108");
    assert.equal(lote.clientes[0].cardCode, "C11108");
  }
  assert.equal(avisos.length, 4);
  assert.equal(avisos[0].codigo, "CLIENTE_SIN_NOMBRE");
});
test("nombre real posterior reemplaza el provisional y no se ocultan otros errores", () => {
  assert.equal(construirLoteClientes([{ ...cliente, CardName: "Nombre real" }], "TEST", 2).clientes[0].cardName, "Nombre real");
  for (const cambios of [{ CardName: 42 }, { CardName: "x".repeat(201) }, { CardName: "a\0b" }, { CardName: "Normal", Valid: null }]) {
    assert.throws(() => construirLoteClientes([{ ...cliente, ...cambios }], "TEST", 1), { code: "CLIENTE_SAP_INVALIDO" });
  }
});
