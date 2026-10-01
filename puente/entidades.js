import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { loteClientesSchema } from "../src/modules/sincronizacion/clientes.schemas.js";
import { construirLote } from "./productos.js";
import { construirLoteClientes } from "./clientes.js";
import { lotePedidosSchema } from "../src/modules/sincronizacion/pedidos.schemas.js";
import { construirLotePedidos } from "./pedidos.js";
import { loteUnidadesSchema } from "../src/modules/sincronizacion/unidades.schemas.js";
import { construirLoteUnidades } from "./unidades.js";
import { loteCodigosBarrasSchema } from "../src/modules/sincronizacion/codigosBarras.schemas.js";
import { construirLoteCodigosBarras } from "./codigosBarras.js";
import { loteAlmacenesSchema } from "../src/modules/sincronizacion/almacenes.schemas.js";
import { construirLoteAlmacenes } from "./almacenes.js";
import { loteExistenciasSchema } from "../src/modules/sincronizacion/existencias.schemas.js";
import { construirLoteExistencias } from "./existencias.js";
import { loteDocumentosSchema } from "../src/modules/sincronizacion/documentos.schemas.js";
import { crearConstructorDocumentos } from "./documentos.js";
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
  dependencias: ["clientes", "productos"],
  claveNumerica: true, tamanoPagina: 1,
  campos: ["DocEntry", "DocNum", "DocType", "CardCode", "DocDate", "DocDueDate", "DocTotal",
    "DocumentStatus", "Cancelled", "CancelStatus", "DocumentLines"],
  filtro: "DocType eq 'dDocument_Items' and DocumentStatus eq 'bost_Open'", revisarCierres: true,
  schema: lotePedidosSchema, construirLote: construirLotePedidos };
// Una orden por lote limita el tamaño del cuerpo, sin dividir sus líneas.
// El recorrido trae solo órdenes abiertas: su costo depende de las órdenes activas, no del historial.
// Las que se cierran o cancelan dejan de aparecer; revisarCierres las pide por clave al final (ver sincronizar.js).
// Catálogo de unidades de SAP ("Manual" no forma parte de él).
export const UNIDADES = { nombre: "unidades", recurso: "UnitOfMeasurements", claveSap: "AbsEntry", claveLocal: "absEntry",
  claveNumerica: true, campos: ["AbsEntry", "Code", "Name"], filtro: null,
  schema: loteUnidadesSchema, construirLote: construirLoteUnidades };
// Todos los códigos de barras con su producto y unidad. depurarRetirados: al terminar un recorrido completo,
// el backend marca como retirados los que SAP ya no lista (conserva sus confirmaciones).
export const CODIGOS_BARRAS = { nombre: "codigosBarras", recurso: "BarCodes", claveSap: "AbsEntry", claveLocal: "absEntry",
  dependencias: ["productos", "unidades"],
  claveNumerica: true, campos: ["AbsEntry", "ItemNo", "Barcode", "UoMEntry"], filtro: null, depurarRetirados: true,
  schema: loteCodigosBarrasSchema, construirLote: construirLoteCodigosBarras };
// Almacenes de SAP (Warehouses). El supervisor marca en la app cuáles son de esta bodega.
export const ALMACENES = { nombre: "almacenes", recurso: "Warehouses", claveSap: "WarehouseCode", claveLocal: "warehouseCode",
  campos: ["WarehouseCode", "WarehouseName", "Inactive"], filtro: null,
  schema: loteAlmacenesSchema, construirLote: construirLoteAlmacenes };
// Existencia por almacén de los artículos de inventario. Cada artículo trae una fila por almacén de la empresa,
// por eso la página es más chica.
export const EXISTENCIAS = { nombre: "existencias", recurso: "Items", claveSap: "ItemCode", claveLocal: "itemCode",
  dependencias: ["productos", "almacenes"], tamanoPagina: 20,
  campos: ["ItemCode", "ItemWarehouseInfoCollection"], filtro: "InventoryItem eq 'tYES'",
  schema: loteExistenciasSchema, construirLote: construirLoteExistencias };
// Documentos que mueven existencias, de los últimos BRIDGE_DOCUMENTOS_DIAS días (30 por defecto). Sirven para
// explicar en el inventario por qué SAP tiene más o menos que la bodega. Los de marketing pueden ser de servicios.
const fechaDesde = (config) => new Date(Date.now() - (config.documentosDias ?? 30) * 86_400_000).toISOString().slice(0, 10);
const documento = (nombre, recurso, { marketing }) => ({ nombre, recurso, claveSap: "DocEntry", claveLocal: "docEntry",
  claveNumerica: true, tamanoPagina: 10,
  campos: ["DocEntry", "DocNum", "DocDate", "Comments", "Cancelled", "CancelStatus", "DocumentLines"],
  filtro: (config) => `${marketing ? "DocType eq 'dDocument_Items' and " : ""}DocDate ge '${fechaDesde(config)}'`,
  schema: loteDocumentosSchema(nombre), construirLote: crearConstructorDocumentos(nombre) });
export const DOCUMENTOS = [
  documento("entradasCompra", "PurchaseDeliveryNotes", { marketing: true }),
  documento("entradasInventario", "InventoryGenEntries", { marketing: false }),
  documento("salidasInventario", "InventoryGenExits", { marketing: false }),
  documento("devolucionesProveedor", "PurchaseReturns", { marketing: true }),
  documento("devolucionesCliente", "Returns", { marketing: true }),
];
// Orden de cada ciclo: los códigos dependen de los productos, los pedidos de los clientes y las existencias
// de los productos y los almacenes.
export const ENTIDADES = [CLIENTES, PRODUCTOS, UNIDADES, CODIGOS_BARRAS, PEDIDOS, ALMACENES, EXISTENCIAS, ...DOCUMENTOS];
