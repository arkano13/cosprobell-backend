import { z } from "zod";
import { identificador, texto, loteDe } from "./lote.schemas.js";
// Contrato mínimo: identifica al cliente para los pedidos. Saldos, contactos y
// datos personales quedan fuera hasta que una función concreta los necesite.
export const loteClientesSchema = loteDe("clientes", z.object({
  cardCode: identificador(50),
  cardName: texto(200),
  valid: z.boolean(),
  frozen: z.boolean(),
}), "cardCode", "Cliente repetido en el lote");
