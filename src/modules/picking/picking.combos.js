// Combos: en SAP son listas de materiales de tipo Conjunto (iAssemblyTree). El pedido trae solo el combo, que no tiene
// existencia ni código de barras, y SAP descuenta sus productos al entregar. La bodega prepara esos productos: cada uno se
// escanea y sale de la 02. Se prueba en tests/unit/picking.combos.test.js; cargarCombos recibe la conexión (no importa
// Prisma, así lo pueden usar módulos sin base en sus pruebas).
import { AppError } from "../../shared/errors/AppError.js";

export const TIPO_COMBO = "iAssemblyTree";

const falla = (code, message) => new AppError({ code, message, statusCode: 409 });

// Productos de un combo, con cuántas unidades de cada uno lleva UN combo. Solo artículos (no recursos ni textos); si un
// producto aparece en varias filas se suma. SAP define la lista para `cantidad` combos: la cuenta tiene que dar entera.
export function productosDelCombo(lista) {
  if (lista.retiradoEnSap) throw falla("COMBO_RETIRADO", "La receta ya no aparece en SAP; revise el pedido.");
  const porProducto = new Map();
  for (const linea of lista.lineas ?? []) {
    if (linea.tipo !== null && linea.tipo !== undefined && linea.tipo !== "pit_Item") continue;
    porProducto.set(linea.itemCode, (porProducto.get(linea.itemCode) ?? 0) + linea.cantidad);
  }
  const productos = [...porProducto].map(([itemCode, cantidad]) => {
    const factor = cantidad / lista.cantidad;
    if (!Number.isSafeInteger(factor) || factor <= 0 || factor > 2147483647) throw falla("COMBO_CANTIDAD_NO_ENTERA",
      `El combo ${lista.itemCode} lleva una cantidad no entera de ${itemCode} en SAP: revisá su lista de materiales.`);
    return { itemCode, factor };
  });
  if (!productos.length) throw falla("COMBO_SIN_PRODUCTOS", `El combo ${lista.itemCode} no tiene productos en su lista de materiales de SAP.`);
  return productos;
}

// Listas de los combos entre estos artículos: Map itemCode → { itemCode, tipo, cantidad, lineas }.
export async function cargarCombos(itemCodes, db) {
  const codigos = [...new Set(itemCodes)].filter(Boolean);
  if (!codigos.length) return new Map();
  const listas = await db.listaMateriales.findMany({ where: { itemCode: { in: codigos }, tipo: TIPO_COMBO } });
  const mapa = new Map(listas.map((l) => [l.itemCode, l]));
  const hijos = [...new Set(listas.flatMap(l => l.lineas.map(c => c.itemCode)))].filter(c => !mapa.has(c));
  if (hijos.length) {
    const anidados = await db.listaMateriales.findMany({ where: { itemCode: { in: hijos }, tipo: TIPO_COMBO } });
    for (const lista of anidados) if (hijos.includes(lista.itemCode)) mapa.set(lista.itemCode, lista);
  }
  return mapa;
}

// Todos los artículos del pedido: los de sus líneas y los productos de sus combos.
export function articulosDelPedido(lineas, combos) {
  return [...new Set(lineas.flatMap((l) => {
    const lista = combos?.get(l.itemCode);
    return [l.itemCode, ...(lista ? (lista.lineas ?? []).map((c) => c.itemCode) : [])];
  }))];
}
