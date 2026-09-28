// Orden obligatorio: los productos referencian grupos y bodegas.
// Solo se piden a SAP los campos que el backend guarda.
export const ENTIDADES = [
  {
    nombre: "ItemGroups",
    clave: "Number",
    campos: ["Number", "GroupName"],
    orden: "Number",
    tamanoPagina: 100,
  },
  {
    nombre: "Warehouses",
    clave: "WarehouseCode",
    campos: ["WarehouseCode", "WarehouseName", "City", "Country", "Inactive"],
    orden: "WarehouseCode",
    tamanoPagina: 100,
  },
  {
    nombre: "Items",
    clave: "ItemCode",
    campos: [
      "ItemCode",
      "ItemName",
      "ItemsGroupCode",
      "BarCode",
      "Valid",
      "Frozen",
      "QuantityOnStock",
      "QuantityOrderedFromVendors",
      "QuantityOrderedByCustomers",
      "CreateDate",
      "UpdateDate",
      "ItemWarehouseInfoCollection",
      "ItemBarCodeCollection",
    ],
    colecciones: {
      ItemWarehouseInfoCollection: ["WarehouseCode", "InStock", "Committed", "Ordered"],
      ItemBarCodeCollection: ["Barcode", "UoMEntry"],
    },
    orden: "ItemCode",
    tamanoPagina: 20,
  },
];

function elegir(objeto, campos) {
  return Object.fromEntries(
    campos.filter((campo) => campo in objeto).map((campo) => [campo, objeto[campo]])
  );
}

export function proyectar(registro, entidad) {
  const resultado = elegir(registro, entidad.campos);

  for (const [coleccion, campos] of Object.entries(entidad.colecciones ?? {})) {
    if (Array.isArray(resultado[coleccion])) {
      resultado[coleccion] = resultado[coleccion].map((fila) => elegir(fila, campos));
    }
  }

  return resultado;
}
