import test from "node:test";
import assert from "node:assert/strict";

import { sincronizar } from "../src/sincronizar.js";
import { ENTIDADES } from "../src/entidades.js";
import { dividirEnLotes } from "../src/lotes.js";

function serviceLayerFalso(paginasPorEntidad) {
  const lecturas = [];

  return {
    lecturas,
    async *leerPaginas(entidad, opciones) {
      lecturas.push([entidad, opciones]);

      for (const pagina of paginasPorEntidad[entidad] ?? []) {
        yield pagina;
      }
    },
  };
}

function backendFalso({ fallarEn } = {}) {
  const lotes = [];

  return {
    lotes,
    async enviarLote(lote) {
      if (lote.entidad === fallarEn) {
        throw new Error(`Rechazado: ${lote.entidad}`);
      }

      lotes.push(lote);
      return { estado: "aplicado" };
    },
  };
}

function generadorDeIds() {
  let n = 0;
  return () => `lote-${++n}`;
}

const itemSap = {
  ItemCode: "A",
  ItemName: "Agua",
  ItemsGroupCode: 100,
  BarCode: "123",
  Valid: "tYES",
  Frozen: "tNO",
  U_Campo: "no se envía",
  ItemWarehouseInfoCollection: [
    { WarehouseCode: "01", InStock: 5, Committed: 1, Ordered: 0, MinimalStock: 2 },
  ],
  ItemBarCodeCollection: [{ AbsEntry: 9, Barcode: "123", UoMEntry: 1, FreeText: "" }],
};

test("sincroniza en orden y envía solo los campos permitidos", async () => {
  const serviceLayer = serviceLayerFalso({
    ItemGroups: [[{ Number: 100, GroupName: "Bebidas", U_Extra: 1 }]],
    Warehouses: [[{ WarehouseCode: "01", WarehouseName: "Principal", Inactive: "tNO" }]],
    Items: [[itemSap]],
  });
  const backend = backendFalso();

  const resumen = await sincronizar({ serviceLayer, backend, generarId: generadorDeIds() });

  assert.deepEqual(backend.lotes.map((lote) => [lote.loteId, lote.entidad]), [
    ["lote-1", "ItemGroups"],
    ["lote-2", "Warehouses"],
    ["lote-3", "Items"],
  ]);

  assert.deepEqual(backend.lotes[0].registros, [{ Number: 100, GroupName: "Bebidas" }]);
  assert.deepEqual(backend.lotes[2].registros, [
    {
      ItemCode: "A",
      ItemName: "Agua",
      ItemsGroupCode: 100,
      BarCode: "123",
      Valid: "tYES",
      Frozen: "tNO",
      ItemWarehouseInfoCollection: [{ WarehouseCode: "01", InStock: 5, Committed: 1, Ordered: 0 }],
      ItemBarCodeCollection: [{ Barcode: "123", UoMEntry: 1 }],
    },
  ]);

  assert.deepEqual(
    resumen.map(({ entidad, registros, lotes, aplicados }) => [entidad, registros, lotes, aplicados]),
    [
      ["ItemGroups", 1, 1, 1],
      ["Warehouses", 1, 1, 1],
      ["Items", 1, 1, 1],
    ]
  );
});

test("pide a SAP los campos, el orden y el tamaño de página definidos", async () => {
  const serviceLayer = serviceLayerFalso({});

  await sincronizar({ serviceLayer, backend: backendFalso() });

  assert.deepEqual(
    serviceLayer.lecturas,
    ENTIDADES.map((entidad) => [
      entidad.nombre,
      { select: entidad.campos, orderby: entidad.orden, tamanoPagina: entidad.tamanoPagina },
    ])
  );
});

test("conserva la última versión de un registro repetido entre páginas", async () => {
  const backend = backendFalso();

  await sincronizar({
    serviceLayer: serviceLayerFalso({
      Warehouses: [
        [{ WarehouseCode: "01", WarehouseName: "Antigua" }],
        [{ WarehouseCode: "01", WarehouseName: "Actual" }, { WarehouseCode: "02", WarehouseName: "Otra" }],
      ],
    }),
    backend,
  });

  assert.deepEqual(backend.lotes[0].registros, [
    { WarehouseCode: "01", WarehouseName: "Actual" },
    { WarehouseCode: "02", WarehouseName: "Otra" },
  ]);
});

test("no envía lotes vacíos", async () => {
  const backend = backendFalso();

  const resumen = await sincronizar({ serviceLayer: serviceLayerFalso({}), backend });

  assert.equal(backend.lotes.length, 0);
  assert.ok(resumen.every((fila) => fila.registros === 0 && fila.lotes === 0));
});

test("detiene la sincronización si una entidad falla", async () => {
  const serviceLayer = serviceLayerFalso({
    ItemGroups: [[{ Number: 1, GroupName: "G" }]],
    Warehouses: [[{ WarehouseCode: "01" }]],
    Items: [[itemSap]],
  });

  await assert.rejects(
    sincronizar({ serviceLayer, backend: backendFalso({ fallarEn: "Warehouses" }) }),
    /Rechazado: Warehouses/
  );

  assert.deepEqual(serviceLayer.lecturas.map(([entidad]) => entidad), ["ItemGroups", "Warehouses"]);
});

test("divide los registros por cantidad y por tamaño", () => {
  const pequenos = Array.from({ length: 1200 }, (_, i) => ({ i }));
  assert.deepEqual(dividirEnLotes(pequenos).map((lote) => lote.length), [500, 500, 200]);

  const grandes = Array.from({ length: 5 }, () => ({ texto: "x".repeat(300_000) }));
  assert.deepEqual(dividirEnLotes(grandes).map((lote) => lote.length), [2, 2, 1]);

  assert.deepEqual(dividirEnLotes([]), []);
});

test("rechaza un registro que no cabe en ningún lote", () => {
  assert.throws(
    () => dividirEnLotes([{ texto: "x".repeat(800_000) }]),
    /supera el máximo por lote/
  );
});
