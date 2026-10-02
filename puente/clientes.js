import { loteClientesSchema } from "../src/modules/sincronizacion/clientes.schemas.js";
import { crearConstructorLote } from "./lote.js";
function nombreCliente(c) {
  if (c.CardName == null || (typeof c.CardName === "string" && !c.CardName.trim())) {
    console.warn(JSON.stringify({ evento: "advertencia", codigo: "CLIENTE_SIN_NOMBRE", cardCode: c.CardCode }));
    return `Cliente ${c.CardCode}`;
  }
  return c.CardName;
}
export const construirLoteClientes = crearConstructorLote({
  entidad: "clientes", schema: loteClientesSchema, codigoError: "CLIENTE_SAP_INVALIDO", claveSap: "CardCode", claveLocal: "cardCode",
  camposSap: { cardCode: "CardCode", cardName: "CardName", valid: "Valid", frozen: "Frozen" },
  mapear: (c, booleano) => ({ cardCode: c.CardCode, cardName: nombreCliente(c),
    valid: booleano(c, "Valid"), frozen: booleano(c, "Frozen") }),
});
