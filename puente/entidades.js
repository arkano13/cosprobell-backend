import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { loteClientesSchema } from "../src/modules/sincronizacion/clientes.schemas.js";
import { construirLote } from "./productos.js";
import { construirLoteClientes } from "./clientes.js";
// recurso, campos, claveSap y filtro describen la consulta a Service Layer (recorrido por clave ascendente).
// nombre es a la vez la ruta del backend, el campo del lote y el archivo de estado local.
export const PRODUCTOS = { nombre: "productos", recurso: "Items", claveSap: "ItemCode", claveLocal: "itemCode",
  campos: ["ItemCode", "ItemName", "BarCode", "Valid", "Frozen"], filtro: null,
  schema: loteProductosSchema, construirLote };
export const CLIENTES = { nombre: "clientes", recurso: "BusinessPartners", claveSap: "CardCode", claveLocal: "cardCode",
  campos: ["CardCode", "CardName", "Valid", "Frozen"], filtro: "CardType eq 'cCustomer'",
  schema: loteClientesSchema, construirLote: construirLoteClientes };
// Orden de cada ciclo. Los pedidos, cuando se agreguen, irán después: dependen de los clientes.
export const ENTIDADES = [CLIENTES, PRODUCTOS];
