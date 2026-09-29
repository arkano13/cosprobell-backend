import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { loteClientesSchema } from "../src/modules/sincronizacion/clientes.schemas.js";
import { construirLote } from "./productos.js";
import { construirLoteClientes } from "./clientes.js";
import { lotePedidosSchema } from "../src/modules/sincronizacion/pedidos.schemas.js";
import { construirLotePedidos } from "./pedidos.js";
// recurso, campos, claveSap y filtro describen la consulta a Service Layer (recorrido por clave ascendente).
// nombre es a la vez la ruta del backend, el campo del lote y el archivo de estado local.
export const PRODUCTOS = { nombre: "productos", recurso: "Items", claveSap: "ItemCode", claveLocal: "itemCode",
  campos: ["ItemCode", "ItemName", "BarCode", "Valid", "Frozen"], filtro: null,
  schema: loteProductosSchema, construirLote };
export const CLIENTES = { nombre: "clientes", recurso: "BusinessPartners", claveSap: "CardCode", claveLocal: "cardCode",
  campos: ["CardCode", "CardName", "Valid", "Frozen"], filtro: "CardType eq 'cCustomer'",
  schema: loteClientesSchema, construirLote: construirLoteClientes };
// Orden de cada ciclo. Los pedidos, cuando se agreguen, irán después: dependen de los clientes.
export const PEDIDOS = { nombre: "pedidos", recurso: "Orders", claveSap: "DocEntry", claveLocal: "docEntry",
  claveNumerica: true, tamanoPagina: 1,
  campos: ["DocEntry", "DocNum", "DocType", "CardCode", "DocDate", "DocDueDate", "DocTotal",
    "DocumentStatus", "Cancelled", "CancelStatus", "DocumentLines"],
  filtro: "DocType eq 'dDocument_Items'", schema: lotePedidosSchema, construirLote: construirLotePedidos };
// Una orden por lote limita el tamaño del cuerpo, sin dividir sus líneas.
// Incluimos órdenes cerradas y canceladas para detectar cambios en preparación.
export const ENTIDADES = [CLIENTES, PRODUCTOS, PEDIDOS];
