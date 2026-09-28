import { z } from "zod";
import { safeString } from "../../shared/validation/safeString.js";

export const MAX_REGISTROS_POR_LOTE = 500;

const textoOpcional = z
  .string()
  .trim()
  .nullish()
  .transform((valor) => valor || null);

const numeroOpcional = z
  .number()
  .finite()
  .nullish()
  .transform((valor) => valor ?? null);

const cantidad = z
  .number()
  .finite()
  .nullish()
  .transform((valor) => valor ?? 0);

const siNo = z.enum(["tYES", "tNO"]).transform((valor) => valor === "tYES");

// Service Layer v1 entrega "2024-01-15"; v2 entrega "2024-01-15T00:00:00Z".
const fechaSap = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
  .nullish()
  .transform((valor) => {
    if (!valor) {
      return null;
    }

    if (valor.length === 10) {
      return new Date(`${valor}T00:00:00Z`);
    }

    return new Date(valor.endsWith("Z") ? valor : `${valor}Z`);
  });

const grupoSapSchema = z
  .object({
    Number: z.number().int(),
    GroupName: safeString(1),
  })
  .transform((grupo) => ({
    number: grupo.Number,
    groupName: grupo.GroupName,
  }));

const bodegaSapSchema = z
  .object({
    WarehouseCode: safeString(1),
    WarehouseName: safeString(1),
    City: textoOpcional,
    Country: textoOpcional,
    Inactive: siNo,
  })
  .transform((bodega) => ({
    warehouseCode: bodega.WarehouseCode,
    warehouseName: bodega.WarehouseName,
    city: bodega.City,
    country: bodega.Country,
    inactive: bodega.Inactive,
  }));

const existenciaSapSchema = z.object({
  WarehouseCode: safeString(1),
  InStock: cantidad,
  Committed: cantidad,
  Ordered: cantidad,
});

const codigoBarrasSapSchema = z.object({
  Barcode: safeString(1),
  UoMEntry: z.number().int().nullish(),
});

const productoSapSchema = z
  .object({
    ItemCode: safeString(1),
    ItemName: safeString(1),
    ItemsGroupCode: z.number().int().nullish(),
    BarCode: textoOpcional,
    Valid: siNo,
    Frozen: siNo,
    QuantityOnStock: numeroOpcional,
    QuantityOrderedFromVendors: numeroOpcional,
    QuantityOrderedByCustomers: numeroOpcional,
    CreateDate: fechaSap,
    UpdateDate: fechaSap,
    ItemWarehouseInfoCollection: z.array(existenciaSapSchema).default([]),
    ItemBarCodeCollection: z.array(codigoBarrasSapSchema).default([]),
  })
  .superRefine((producto, ctx) => {
    const bodegas = new Set();

    producto.ItemWarehouseInfoCollection.forEach((existencia, indice) => {
      if (bodegas.has(existencia.WarehouseCode)) {
        ctx.addIssue({
          code: "custom",
          path: ["ItemWarehouseInfoCollection", indice, "WarehouseCode"],
          message: `Bodega repetida en el producto: ${existencia.WarehouseCode}`,
        });
      }

      bodegas.add(existencia.WarehouseCode);
    });
  })
  .transform((producto) => {
    const codigosVistos = new Set();

    return {
      producto: {
        itemCode: producto.ItemCode,
        itemName: producto.ItemName,
        itemsGroupCode: producto.ItemsGroupCode ?? null,
        barCode: producto.BarCode,
        valid: producto.Valid,
        frozen: producto.Frozen,
        quantityOnStock: producto.QuantityOnStock,
        quantityOrderedFromVendors: producto.QuantityOrderedFromVendors,
        quantityOrderedByCustomers: producto.QuantityOrderedByCustomers,
        sapCreateDate: producto.CreateDate,
        sapUpdateDate: producto.UpdateDate,
      },
      // Una bodega sin movimiento equivale a no tener fila: existencia cero.
      existencias: producto.ItemWarehouseInfoCollection
        .filter((e) => e.InStock !== 0 || e.Committed !== 0 || e.Ordered !== 0)
        .map((e) => ({
          warehouseCode: e.WarehouseCode,
          inStock: e.InStock,
          committed: e.Committed,
          ordered: e.Ordered,
        })),
      codigosBarras: producto.ItemBarCodeCollection
        .map((c) => ({ codigo: c.Barcode, uomEntry: c.UoMEntry ?? null }))
        .filter((c) => {
          const clave = `${c.codigo}|${c.uomEntry}`;
          const repetido = codigosVistos.has(clave);
          codigosVistos.add(clave);
          return !repetido;
        }),
    };
  });

function loteDe(entidad, registroSchema, obtenerClave) {
  return z
    .object({
      loteId: z.uuid(),
      entidad: z.literal(entidad),
      registros: z
        .array(registroSchema)
        .min(1)
        .max(MAX_REGISTROS_POR_LOTE),
    })
    .superRefine((lote, ctx) => {
      const vistas = new Set();

      lote.registros.forEach((registro, indice) => {
        const clave = obtenerClave(registro);

        // Un registro que ya falló no llega transformado y no tiene clave.
        if (clave === undefined) {
          return;
        }

        if (vistas.has(clave)) {
          ctx.addIssue({
            code: "custom",
            path: ["registros", indice],
            message: `Clave repetida en el lote: ${clave}`,
          });
        }

        vistas.add(clave);
      });
    });
}

export const loteSchema = z.discriminatedUnion("entidad", [
  loteDe("ItemGroups", grupoSapSchema, (grupo) => grupo.number),
  loteDe("Warehouses", bodegaSapSchema, (bodega) => bodega.warehouseCode),
  loteDe("Items", productoSapSchema, (item) => item.producto?.itemCode),
]);
