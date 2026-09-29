import { loteUnidadesSchema } from "../src/modules/sincronizacion/unidades.schemas.js";
import { crearConstructorLote } from "./lote.js";
export const construirLoteUnidades = crearConstructorLote({
  entidad: "unidades", schema: loteUnidadesSchema, codigoError: "UNIDAD_SAP_INVALIDA", claveSap: "AbsEntry", claveLocal: "absEntry",
  camposSap: { absEntry: "AbsEntry", code: "Code", name: "Name" },
  mapear: (u) => ({ absEntry: u.AbsEntry, code: u.Code, name: u.Name === "" ? null : u.Name }),
});
