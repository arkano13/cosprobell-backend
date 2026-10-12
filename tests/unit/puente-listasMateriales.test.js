import test from "node:test";
import assert from "node:assert/strict";
import { construirLoteListasMateriales } from "../../puente/listasMateriales.js";
import { entidadesHabilitadas, LISTAS_MATERIALES } from "../../puente/entidades.js";
import { sincronizar } from "../../puente/sincronizar.js";
const receta = { TreeCode: "ER10474", TreeType: "iAssemblyTree", Quantity: 1,
  ProductTreeLines: ["ER10028", "ER10030", "ER10032"].map(ItemCode => ({ ItemCode, Quantity: 1, ItemType: "pit_Item" })) };

test("receta completa de SAP, sin convertir texto ni recursos en productos", () => {
  const r = construirLoteListasMateriales([{ ...receta, ProductTreeLines: [...receta.ProductTreeLines,
    { ItemType: "pit_Text", Quantity: 0 }, { ItemType: "pit_Resource", ItemCode: "R", Quantity: 0 }] }], "SAP", 1);
  assert.equal(r.listasMateriales[0].lineas.length, 3);
  assert.equal(r.listasMateriales[0].itemCode, "ER10474");
  for (const mal of [{ ...receta, Quantity: 0 }, { ...receta, ProductTreeLines: undefined },
    { ...receta, "ProductTreeLines@odata.nextLink": "otra" },
    { ...receta, ProductTreeLines: [{ ItemCode: "X", Quantity: 1, ItemType: "desconocido" }] }]) {
    assert.throws(() => construirLoteListasMateriales([mal], "SAP", 1), { code: "LISTA_MATERIALES_SAP_INVALIDA" });
  }
});
test("combos requieren activación y pedidos dependen de la primera carga completa", () => {
  assert.equal(entidadesHabilitadas({}).some(e => e.nombre === "listasMateriales"), false);
  const entidades = entidadesHabilitadas({ combosHabilitados: true });
  assert.ok(entidades.indexOf(LISTAS_MATERIALES) < entidades.findIndex(e => e.nombre === "pedidos"));
  assert.ok(entidades.find(e => e.nombre === "pedidos").dependencias.includes("listasMateriales"));
});
test("recetas: pausa recuperable y siguiente recorrido sin cambios confirma observados", async () => {
  const almacen = { estado: { secuencia: 0, cursor: null, pendiente: null }, async guardar(e) { this.estado = e; },
    leerHuellas: async () => ({}), confirmarHuellas: async () => {} };
  let remoto = 0, pausa = true, observados = 0;
  const backend = { estado: async () => remoto, recorrido: async () => {},
    enviar: async lote => { remoto = lote.secuencia; }, observar: async claves => { observados += claves.length; } };
  const sap = { pagina: async cursor => {
    if (cursor === null) return [receta];
    if (pausa) { pausa = false; throw Object.assign(new Error(), { code: "PRESUPUESTO_AGOTADO" }); }
    return [];
  } };
  const args = { config: { empresa: "SAP", soloCambios: true }, almacen, backend, sap, entidad: LISTAS_MATERIALES };
  await assert.rejects(sincronizar(args), { code: "PRESUPUESTO_AGOTADO" });
  assert.equal(almacen.estado.cursor, "ER10474");
  assert.equal((await sincronizar(args)).completo, true);
  const { separarCambios, claveHuella } = await import("../../puente/huellas.js");
  const fila = construirLoteListasMateriales([receta], "SAP", 1).listasMateriales[0];
  const hashes = separarCambios([fila], LISTAS_MATERIALES, {}).huellas;
  almacen.leerHuellas = async () => hashes;
  assert.ok(hashes[claveHuella("ER10474")]);
  assert.equal((await sincronizar(args)).completo, true);
  assert.equal(remoto, 1); assert.equal(observados, 1);
});
