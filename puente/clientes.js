import { loteClientesSchema } from "../src/modules/sincronizacion/clientes.schemas.js";
import { crearConstructorLote } from "./lote.js";
export const construirLoteClientes = crearConstructorLote({
  entidad: "clientes", schema: loteClientesSchema, codigoError: "CLIENTE_SAP_INVALIDO", claveSap: "CardCode", claveLocal: "cardCode",
  camposSap: { cardCode: "CardCode", cardName: "CardName", valid: "Valid", frozen: "Frozen" },
  mapear: (c, booleano) => ({ cardCode: c.CardCode, cardName: c.CardName,
    valid: booleano(c, "Valid"), frozen: booleano(c, "Frozen") }),
});
