import { z } from "zod";
import { identificador, loteDe } from "./lote.schemas.js";

// Listas de materiales de SAP (ProductTrees). Las de tipo Conjunto (iAssemblyTree) son los combos: el pedido trae solo
// el combo y SAP descuenta sus productos al entregar. Se reciben todas con su tipo; la bodega solo expande los conjuntos.
const cantidad = z.number().finite().positive().max(1_000_000);
const linea = z.object({
  itemCode: identificador(50),
  cantidad,
  // pit_Item, pit_Resource o pit_Text; null si SAP no lo informa (se toma como artículo).
  tipo: z.enum(["pit_Item", "pit_Resource", "pit_Text"]).nullable(),
}).strict();

export const loteListasMaterialesSchema = loteDe("listasMateriales", z.object({
  itemCode: identificador(50),
  tipo: z.string().min(1).max(30),
  cantidad,
  lineas: z.array(linea).max(500),
}), "itemCode", "Lista de materiales repetida en el lote");
