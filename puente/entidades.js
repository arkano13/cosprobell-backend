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
import { loteExistenciasSchema } from "../src/modules/sincronizacion/existencias.schemas.js";
import { construirLoteAlmacenes } from "./almacenes.js";
import { construirLoteExistencias } from "./existencias.js";
import { fuenteExistencias } from "./existencias.sql.js";
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
// SAP puede devolver "Manual" (-1); excluirlo del catálogo de unidades utilizables.
export const UNIDADES = { nombre: "unidades", recurso: "UnitOfMeasurements", claveSap: "AbsEntry", claveLocal: "absEntry",
  claveNumerica: true, campos: ["AbsEntry", "Code", "Name"], filtro: "AbsEntry ge 0",
  schema: loteUnidadesSchema, construirLote: construirLoteUnidades };
// Todos los códigos de barras con su producto y unidad. depurarRetirados: al terminar un recorrido completo,
// el backend marca como retirados los que SAP ya no lista (conserva sus confirmaciones).
export const CODIGOS_BARRAS = { nombre: "codigosBarras", recurso: "BarCodes", claveSap: "AbsEntry", claveLocal: "absEntry",
  dependencias: ["productos", "unidades"],
  claveNumerica: true, campos: ["AbsEntry", "ItemNo", "Barcode", "UoMEntry"], filtro: null, depurarRetirados: true,
  schema: loteCodigosBarrasSchema, construirLote: construirLoteCodigosBarras };
// Orden de cada ciclo: los códigos dependen de los productos y los pedidos de los clientes.
export const ALMACENES = { nombre: "almacenes", recurso: "Warehouses", claveSap: "WarehouseCode", claveLocal: "warehouseCode",
  campos: ["WarehouseCode", "WarehouseName", "Inactive"], filtro: null, inventario: true, confirmarRecorrido: true,
  schema: loteAlmacenesSchema, construirLote: construirLoteAlmacenes };
// Recorrer también artículos que dejan de ser inventariables permite limpiar su saldo anterior.
// Una página pequeña limita el tamaño de las colecciones anidadas y del envío al backend.
export const EXISTENCIAS = { nombre: "existencias", recurso: "Items", claveSap: "ItemCode", claveLocal: "itemCode",
  campos: ["ItemCode", "InventoryItem", "ItemWarehouseInfoCollection"], filtro: null, tamanoPagina: 5,
  dependencias: ["productos", "almacenes"], inventario: true, confirmarRecorrido: true,
  schema: loteExistenciasSchema, construirLote: construirLoteExistencias };
export const ENTIDADES = [CLIENTES, PRODUCTOS, UNIDADES, CODIGOS_BARRAS, PEDIDOS, ALMACENES, EXISTENCIAS];
export const entidadesHabilitadas = config => ENTIDADES.filter(e => !e.inventario || config.inventarioHabilitado)
  .map(e => e.nombre === "existencias" ? { ...e, fuente: fuenteExistencias(config),
    ...(["sql-01-02", "sql-almacenes"].includes(config.modoExistencias) ? { consultaExistenciasSql: true, tamanoPagina: 20 } : {}) } : e);
