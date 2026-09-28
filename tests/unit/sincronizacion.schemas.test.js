import test from "node:test";
import assert from "node:assert/strict";

import {
  loteSchema,
  MAX_REGISTROS_POR_LOTE,
} from "../../src/modules/sincronizacion/sincronizacion.schemas.js";

const loteId = "3f2b8c1e-5d4a-4b7e-9c2f-1a6e8d0b4c3a";

function lote(entidad, registros, cambios = {}) {
  return { loteId, entidad, registros, ...cambios };
}

function bodegaSap(cambios = {}) {
  return {
    WarehouseCode: "01",
    WarehouseName: "Bodega Principal",
    City: "San Pedro Sula",
    Country: "HN",
    Inactive: "tNO",
    ...cambios,
  };
}

function productoSap(cambios = {}) {
  return {
    ItemCode: "PROD-001",
    ItemName: "Agua 600ml",
    ItemsGroupCode: 100,
    BarCode: "0012345678905",
    Valid: "tYES",
    Frozen: "tNO",
    QuantityOnStock: 130,
    QuantityOrderedFromVendors: 0,
    QuantityOrderedByCustomers: 12,
    CreateDate: "2024-01-15",
    UpdateDate: "2026-09-20T00:00:00Z",
    ItemWarehouseInfoCollection: [
      { WarehouseCode: "01", InStock: 100, Committed: 12, Ordered: 0 },
      { WarehouseCode: "02", InStock: 30, Committed: 0, Ordered: 0 },
      { WarehouseCode: "03", InStock: 0, Committed: 0, Ordered: 0 },
    ],
    ItemBarCodeCollection: [
      { AbsEntry: 1, Barcode: "0012345678905", UoMEntry: 1, FreeText: "" },
      { AbsEntry: 2, Barcode: "0098765432105", UoMEntry: 5, FreeText: "" },
    ],
    ...cambios,
  };
}

function rutasConError(resultado) {
  return resultado.error.issues.map((issue) => issue.path.join("."));
}

test("convierte grupos de SAP al modelo local", () => {
  const resultado = loteSchema.safeParse(
    lote("ItemGroups", [{ Number: 100, GroupName: " Bebidas ", Extra: 1 }])
  );

  assert.equal(resultado.success, true);
  assert.deepEqual(resultado.data.registros, [
    { number: 100, groupName: "Bebidas" },
  ]);
});

test("convierte bodegas y normaliza textos vacíos", () => {
  const resultado = loteSchema.safeParse(
    lote("Warehouses", [
      bodegaSap({ Street: "Dirección interna" }),
      bodegaSap({ WarehouseCode: "02", City: "   ", Country: null, Inactive: "tYES" }),
    ])
  );

  assert.equal(resultado.success, true);
  assert.deepEqual(resultado.data.registros, [
    {
      warehouseCode: "01",
      warehouseName: "Bodega Principal",
      city: "San Pedro Sula",
      country: "HN",
      inactive: false,
    },
    {
      warehouseCode: "02",
      warehouseName: "Bodega Principal",
      city: null,
      country: null,
      inactive: true,
    },
  ]);
});

test("convierte productos con existencias y códigos de barras", () => {
  const resultado = loteSchema.safeParse(lote("Items", [productoSap()]));

  assert.equal(resultado.success, true);

  const [item] = resultado.data.registros;

  assert.deepEqual(item.producto, {
    itemCode: "PROD-001",
    itemName: "Agua 600ml",
    itemsGroupCode: 100,
    barCode: "0012345678905",
    valid: true,
    frozen: false,
    quantityOnStock: 130,
    quantityOrderedFromVendors: 0,
    quantityOrderedByCustomers: 12,
    sapCreateDate: new Date("2024-01-15T00:00:00Z"),
    sapUpdateDate: new Date("2026-09-20T00:00:00Z"),
  });

  assert.deepEqual(item.codigosBarras, [
    { codigo: "0012345678905", uomEntry: 1 },
    { codigo: "0098765432105", uomEntry: 5 },
  ]);
});

test("omite existencias sin movimiento y conserva las demás", () => {
  const resultado = loteSchema.safeParse(lote("Items", [productoSap()]));

  assert.deepEqual(resultado.data.registros[0].existencias, [
    { warehouseCode: "01", inStock: 100, committed: 12, ordered: 0 },
    { warehouseCode: "02", inStock: 30, committed: 0, ordered: 0 },
  ]);
});

test("acepta un producto sin colecciones ni grupo", () => {
  const sap = productoSap({ ItemsGroupCode: null, BarCode: "" });
  delete sap.ItemWarehouseInfoCollection;
  delete sap.ItemBarCodeCollection;

  const resultado = loteSchema.safeParse(lote("Items", [sap]));

  assert.equal(resultado.success, true);

  const [item] = resultado.data.registros;
  assert.equal(item.producto.itemsGroupCode, null);
  assert.equal(item.producto.barCode, null);
  assert.deepEqual(item.existencias, []);
  assert.deepEqual(item.codigosBarras, []);
});

test("elimina códigos de barras repetidos con la misma unidad", () => {
  const resultado = loteSchema.safeParse(
    lote("Items", [
      productoSap({
        ItemBarCodeCollection: [
          { Barcode: "111", UoMEntry: 1 },
          { Barcode: "111", UoMEntry: 1 },
          { Barcode: "111", UoMEntry: 5 },
        ],
      }),
    ])
  );

  assert.deepEqual(resultado.data.registros[0].codigosBarras, [
    { codigo: "111", uomEntry: 1 },
    { codigo: "111", uomEntry: 5 },
  ]);
});

test("rechaza una bodega repetida dentro de un producto", () => {
  const resultado = loteSchema.safeParse(
    lote("Items", [
      productoSap({
        ItemWarehouseInfoCollection: [
          { WarehouseCode: "01", InStock: 1, Committed: 0, Ordered: 0 },
          { WarehouseCode: "01", InStock: 2, Committed: 0, Ordered: 0 },
        ],
      }),
    ])
  );

  assert.equal(resultado.success, false);
  assert.deepEqual(rutasConError(resultado), [
    "registros.0.ItemWarehouseInfoCollection.1.WarehouseCode",
  ]);
});

test("rechaza fechas y valores de SAP inesperados", () => {
  const resultado = loteSchema.safeParse(
    lote("Items", [
      productoSap({ UpdateDate: "20/09/2026" }),
      productoSap({ ItemCode: "PROD-002", Valid: "Y" }),
      productoSap({ ItemCode: "PROD-003", QuantityOnStock: "130" }),
    ])
  );

  assert.equal(resultado.success, false);
  assert.deepEqual(rutasConError(resultado), [
    "registros.0.UpdateDate",
    "registros.1.Valid",
    "registros.2.QuantityOnStock",
  ]);
});

test("rechaza una entidad desconocida", () => {
  const resultado = loteSchema.safeParse(lote("Usuarios", [bodegaSap()]));

  assert.equal(resultado.success, false);
  assert.deepEqual(rutasConError(resultado), ["entidad"]);
});

test("rechaza un identificador de lote inválido", () => {
  for (const valor of [undefined, "", "lote-1", 123]) {
    const resultado = loteSchema.safeParse(
      lote("Warehouses", [bodegaSap()], { loteId: valor })
    );

    assert.equal(resultado.success, false);
    assert.deepEqual(rutasConError(resultado), ["loteId"]);
  }
});

test("rechaza lotes vacíos o demasiado grandes", () => {
  const demasiados = Array.from(
    { length: MAX_REGISTROS_POR_LOTE + 1 },
    (_, indice) => bodegaSap({ WarehouseCode: `B${indice}` })
  );

  for (const registros of [[], demasiados]) {
    const resultado = loteSchema.safeParse(lote("Warehouses", registros));

    assert.equal(resultado.success, false);
    assert.deepEqual(rutasConError(resultado), ["registros"]);
  }
});

test("indica qué registro y campo fallaron", () => {
  const resultado = loteSchema.safeParse(
    lote("Warehouses", [
      bodegaSap(),
      bodegaSap({ WarehouseCode: "   " }),
      bodegaSap({ WarehouseCode: "03", Inactive: "Y" }),
    ])
  );

  assert.equal(resultado.success, false);
  assert.deepEqual(rutasConError(resultado), [
    "registros.1.WarehouseCode",
    "registros.2.Inactive",
  ]);
});

test("rechaza claves repetidas dentro del mismo lote", () => {
  const casos = [
    lote("Warehouses", [bodegaSap(), bodegaSap({ WarehouseName: "Otra" })]),
    lote("ItemGroups", [
      { Number: 100, GroupName: "A" },
      { Number: 100, GroupName: "B" },
    ]),
    lote("Items", [productoSap(), productoSap({ ItemName: "Otro" })]),
  ];

  for (const caso of casos) {
    const resultado = loteSchema.safeParse(caso);

    assert.equal(resultado.success, false, caso.entidad);
    assert.deepEqual(rutasConError(resultado), ["registros.1"], caso.entidad);
  }
});
