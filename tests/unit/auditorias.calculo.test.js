import test from "node:test";
import assert from "node:assert/strict";
import { armarResultado, corregirResultado } from "../../src/modules/auditorias/auditorias.calculo.js";

test("auditoría: compara lo escaneado con la app y con SAP; lo no escaneado cuenta como 0", () => {
  const r = armarResultado({
    escaneado: new Map([["A", 18], ["B", 47], ["C", 31], ["D", 2]]),
    app: new Map([["A", 24], ["B", 47], ["C", 29], ["E", 3]]),
    sap: new Map([["A", 24], ["B", 46], ["C", 29], ["E", 3]]),
    nombres: new Map([["A", "K12"], ["B", "BS12"], ["C", "BS10"], ["D", "Tinte"], ["E", "SD207"]]),
  });
  assert.deepEqual(r.filas.map((f) => [f.itemCode, f.escaneado, f.app, f.sap, f.diferenciaApp, f.diferenciaSap]), [
    ["A", 18, 24, 24, -6, -6], ["E", 0, 3, 3, -3, -3], ["C", 31, 29, 29, 2, 2], ["D", 2, 0, 0, 2, 2], ["B", 47, 47, 46, 0, 1]]);
  assert.deepEqual(r.resumen, { productos: 5, escaneado: 98,
    contraApp: { cumplen: 1, faltan: { productos: 2, unidades: 9 }, sobran: { productos: 2, unidades: 4 } },
    contraSap: { cumplen: 0, faltan: { productos: 2, unidades: 9 }, sobran: { productos: 3, unidades: 5 } } });
});

test("auditoría: un almacén que la app no lleva se compara solo con SAP; sin SAP, solo lo escaneado", () => {
  const soloSap = armarResultado({ escaneado: new Map([["A", 5]]), sap: new Map([["A", 4.6], ["B", 2]]) });
  assert.deepEqual(soloSap.filas.map((f) => [f.itemCode, f.app, f.sap, f.diferenciaApp, f.diferenciaSap]), [["B", null, 2, null, -2], ["A", null, 5, null, 0]]);
  assert.equal(soloSap.resumen.contraApp, null);
  assert.deepEqual(soloSap.resumen.contraSap, { cumplen: 1, faltan: { productos: 1, unidades: 2 }, sobran: { productos: 0, unidades: 0 } });
  const nada = armarResultado({ escaneado: new Map([["A", 5]]) });
  assert.deepEqual([nada.resumen.contraApp, nada.resumen.contraSap, nada.filas[0].diferenciaApp], [null, null, null]);
});

test("auditoría: corregir lo escaneado recalcula con los mismos números de la app y de SAP y guarda lo original", () => {
  const base = { tipo: "pequena", personas: ["Ana"], ...armarResultado({ escaneado: new Map([["A", 5], ["B", 3]]),
    app: new Map([["A", 4], ["B", 3]]), sap: new Map([["A", 4], ["B", 2]]), nombres: new Map([["A", "Crema"], ["B", "Jabón"]]) }) };
  // Escanearon una crema de más: queda 4, cumple contra la app y contra SAP.
  const uno = corregirResultado(base, { itemCode: "A", escaneado: 4 });
  assert.equal(uno.antes, 5);
  assert.deepEqual(uno.resultado.filas.map((f) => [f.itemCode, f.escaneado, f.original, f.diferenciaApp, f.diferenciaSap]),
    [["A", 4, 5, 0, 0], ["B", 3, undefined, 0, 1]]);
  assert.deepEqual([uno.resultado.tipo, uno.resultado.resumen.escaneado, uno.resultado.resumen.contraApp.cumplen], ["pequena", 7, 2]);
  // Un producto que no se escaneó ni figuraba: app y SAP en 0. Volver al número original quita la marca.
  const dos = corregirResultado(uno.resultado, { itemCode: "C", itemName: "Shampoo", escaneado: 2 });
  assert.deepEqual(dos.resultado.filas.find((f) => f.itemCode === "C"),
    { itemCode: "C", itemName: "Shampoo", escaneado: 2, app: 0, sap: 0, diferenciaApp: 2, diferenciaSap: 2, original: 0 });
  const tres = corregirResultado(dos.resultado, { itemCode: "A", escaneado: 5 });
  assert.deepEqual([tres.antes, tres.resultado.filas.find((f) => f.itemCode === "A").original], [4, undefined]);
  // Sin contra qué comparar sigue sin comparar.
  const soloEscaneado = corregirResultado({ tipo: "otro", ...armarResultado({ escaneado: new Map([["A", 2]]) }) }, { itemCode: "A", escaneado: 1 });
  assert.deepEqual([soloEscaneado.resultado.resumen.contraApp, soloEscaneado.resultado.filas[0].sap], [null, null]);
});
