import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import env from "../src/config/env.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { loteSchema } from "../src/modules/sincronizacion/sincronizacion.schemas.js";
import { procesarLote } from "../src/modules/sincronizacion/sincronizacion.service.js";

if (env.nodeEnv === "production") {
  console.error("Este script escribe datos temporales: no se ejecuta en producción.");
  process.exit(1);
}

const sufijo = randomUUID().slice(0, 8).toUpperCase();
const grupo = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const bodegas = [`P${sufijo}A`, `P${sufijo}B`];
const itemCode = `PRUEBA-SYNC-${sufijo}`;
const entidades = ["ItemGroups", "Warehouses", "Items"];
const lotesUsados = [];

function lote(entidad, registros) {
  const loteId = randomUUID();
  lotesUsados.push(loteId);
  return loteSchema.parse({ loteId, entidad, registros });
}

function productoSap(existencias, codigos) {
  return {
    ItemCode: itemCode,
    ItemName: "Producto de prueba de sincronización",
    ItemsGroupCode: grupo,
    BarCode: `75${sufijo}`,
    Valid: "tYES",
    Frozen: "tNO",
    QuantityOnStock: 12,
    CreateDate: "2024-01-15",
    UpdateDate: "2026-09-28",
    ItemWarehouseInfoCollection: existencias,
    ItemBarCodeCollection: codigos,
  };
}

async function leerProducto() {
  return prisma.producto.findUniqueOrThrow({
    where: { itemCode },
    include: {
      existencias: { orderBy: { warehouseCode: "asc" } },
      codigosBarras: { orderBy: { codigo: "asc" } },
    },
  });
}

async function main() {
  const previas = new Set(
    (await prisma.sincronizacion.findMany({ where: { entidad: { in: entidades } } }))
      .map((fila) => fila.entidad)
  );

  try {
    // 1. Carga en orden de dependencias.
    const grupos = lote("ItemGroups", [{ Number: grupo, GroupName: "Grupo de prueba" }]);
    const almacenes = lote(
      "Warehouses",
      bodegas.map((codigo) => ({ WarehouseCode: codigo, WarehouseName: `Bodega ${codigo}`, Inactive: "tNO" }))
    );
    const productos = lote("Items", [
      productoSap(
        [
          { WarehouseCode: bodegas[0], InStock: 10, Committed: 2, Ordered: 0 },
          { WarehouseCode: bodegas[1], InStock: 2, Committed: 0, Ordered: 0 },
        ],
        [
          { Barcode: `75${sufijo}`, UoMEntry: 1 },
          { Barcode: `76${sufijo}`, UoMEntry: 5 },
        ]
      ),
    ]);

    for (const envio of [grupos, almacenes, productos]) {
      assert.equal((await procesarLote(envio)).estado, "aplicado");
    }

    let producto = await leerProducto();
    assert.equal(producto.itemsGroupCode, grupo);
    assert.deepEqual(producto.existencias.map((e) => [e.warehouseCode, e.inStock]), [
      [bodegas[0], 10],
      [bodegas[1], 2],
    ]);
    assert.deepEqual(producto.codigosBarras.map((c) => [c.codigo, c.uomEntry]), [
      [`75${sufijo}`, 1],
      [`76${sufijo}`, 5],
    ]);
    console.log("APROBADO 1/5: grupos, bodegas y producto guardados con existencias y códigos.");

    // 2. El mismo lote otra vez no se aplica dos veces.
    assert.equal((await procesarLote(productos)).estado, "duplicado");
    assert.equal((await leerProducto()).existencias.length, 2);
    console.log("APROBADO 2/5: un lote repetido se informa como duplicado.");

    // 3. Dos envíos simultáneos del mismo lote: uno aplicado, otro duplicado.
    const simultaneo = lote("Warehouses", [
      { WarehouseCode: bodegas[0], WarehouseName: "Renombrada", Inactive: "tNO" },
    ]);
    const estados = (await Promise.all([procesarLote(simultaneo), procesarLote(simultaneo)]))
      .map((resultado) => resultado.estado)
      .sort();
    assert.deepEqual(estados, ["aplicado", "duplicado"]);
    console.log("APROBADO 3/5: dos envíos simultáneos del mismo lote se aplican una sola vez.");

    // 4. Una bodega inexistente rechaza el lote completo sin escribir nada.
    const sinBodega = lote("Items", [
      productoSap([{ WarehouseCode: `NO-${sufijo}`, InStock: 1, Committed: 0, Ordered: 0 }], []),
    ]);
    await assert.rejects(procesarLote(sinBodega), (error) => {
      assert.equal(error.code, "DEPENDENCIAS_FALTANTES");
      return true;
    });
    assert.equal((await leerProducto()).existencias.length, 2);
    assert.equal(
      await prisma.errorSincronizacion.count({ where: { loteId: sinBodega.loteId } }),
      1
    );
    console.log("APROBADO 4/5: una bodega inexistente rechaza el lote y queda registrada.");

    // 5. Las colecciones de SAP reemplazan las anteriores.
    await procesarLote(
      lote("Items", [
        productoSap(
          [
            { WarehouseCode: bodegas[0], InStock: 7, Committed: 0, Ordered: 0 },
            { WarehouseCode: bodegas[1], InStock: 0, Committed: 0, Ordered: 0 },
          ],
          [{ Barcode: `75${sufijo}`, UoMEntry: 1 }]
        ),
      ])
    );
    producto = await leerProducto();
    assert.deepEqual(producto.existencias.map((e) => [e.warehouseCode, e.inStock]), [[bodegas[0], 7]]);
    assert.deepEqual(producto.codigosBarras.map((c) => c.codigo), [`75${sufijo}`]);
    console.log("APROBADO 5/5: existencias y códigos se reemplazan con la versión de SAP.");

    console.log("\nRESULTADO: 5 de 5 casos aprobados.");
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.productoExistencia.deleteMany({ where: { itemCode } });
      await tx.productoCodigoBarras.deleteMany({ where: { itemCode } });
      await tx.producto.deleteMany({ where: { itemCode } });
      await tx.productoExistencia.deleteMany({ where: { warehouseCode: { in: bodegas } } });
      await tx.bodega.deleteMany({ where: { warehouseCode: { in: bodegas } } });
      await tx.grupoProducto.deleteMany({ where: { number: grupo } });
      await tx.sincronizacionLote.deleteMany({ where: { loteId: { in: lotesUsados } } });
      await tx.errorSincronizacion.deleteMany({ where: { loteId: { in: lotesUsados } } });
      await tx.sincronizacion.deleteMany({
        where: { entidad: { in: entidades.filter((entidad) => !previas.has(entidad)) } },
      });
    });

    console.log("Datos temporales eliminados.");
  }
}

try {
  await main();
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
