import { loteCodigosBarrasSchema } from "../src/modules/sincronizacion/codigosBarras.schemas.js";
import { crearConstructorLote } from "./lote.js";
export const construirLoteCodigosBarras = crearConstructorLote({
  entidad: "codigosBarras", schema: loteCodigosBarrasSchema, codigoError: "CODIGO_BARRAS_SAP_INVALIDO", claveSap: "AbsEntry", claveLocal: "absEntry",
  camposSap: { absEntry: "AbsEntry", itemCode: "ItemNo", codigo: "Barcode", uomEntry: "UoMEntry" },
  mapear: (c) => ({ absEntry: c.AbsEntry, itemCode: c.ItemNo, codigo: c.Barcode, uomEntry: c.UoMEntry }),
});
