import { loteProductosSchema } from "../src/modules/sincronizacion/productos.schemas.js";
import { loteClientesSchema } from "../src/modules/sincronizacion/clientes.schemas.js";
import { construirLote } from "./productos.js";
import { construirLoteClientes } from "./clientes.js";
import { lotePedidosSchema } from "../src/modules/sincronizacion/pedidos.schemas.js";
import { construirLotePedidos } from "./pedidos.js";
import { loteTrasladosPreparacionSchema } from "../src/modules/sincronizacion/trasladosPreparacion.schemas.js";
import { construirLoteTrasladosPreparacion } from "./trasladosPreparacion.js";
import { loteUnidadesSchema } from "../src/modules/sincronizacion/unidades.schemas.js";
import { construirLoteUnidades } from "./unidades.js";
import { loteCodigosBarrasSchema } from "../src/modules/sincronizacion/codigosBarras.schemas.js";
import { construirLoteCodigosBarras } from "./codigosBarras.js";
import { loteAlmacenesSchema } from "../src/modules/sincronizacion/almacenes.schemas.js";
import { loteExistenciasSchema } from "../src/modules/sincronizacion/existencias.schemas.js";
import { construirLoteAlmacenes } from "./almacenes.js";
import { construirLoteExistencias } from "./existencias.js";
import { fuenteExistencias } from "./existencias.sql.js";
import { loteListasMaterialesSchema } from "../src/modules/sincronizacion/listasMateriales.schemas.js";
import { construirLoteListasMateriales } from "./listasMateriales.js";
import { construirLoteFacturasPreparacion } from "./facturasPreparacion.js";
import { loteFacturasPreparacionSchema } from "../src/modules/sincronizacion/facturasPreparacion.schemas.js";
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
export const LISTAS_MATERIALES = { nombre: "listasMateriales", recurso: "ProductTrees", claveSap: "TreeCode", claveLocal: "itemCode",
  campos: ["TreeCode", "TreeType", "Quantity", "ProductTreeLines"], filtro: null, tamanoPagina: 20,
  dependencias: ["productos"], combos: true, confirmarRecorrido: true,
  schema: loteListasMaterialesSchema, construirLote: construirLoteListasMateriales };
export const FACTURAS_PREPARACION = { ...PEDIDOS, nombre: "facturasPreparacion", recurso: "Invoices",
  campos: [...PEDIDOS.campos, "ReserveInvoice"],
  // Las facturas sin preparar que quedan fuera de los días del recorrido se piden una por una (anulación, crédito).
  revisarCierres: true, rutaRevision: "facturasPreparacion/pendientes", ventanaFacturas: true, creditosPreparacion: true,
  schema: loteFacturasPreparacionSchema, construirLote: construirLoteFacturasPreparacion };
// Traslados que salen de la 02 (a consigna, a vendedores, etc.): se preparan como las facturas. Mismos días que las
// facturas (BRIDGE_PICKING_INVOICE_SINCE y _DAYS). Un traslado no cambia después de creado: no hay revisión de pendientes.
export const TRASLADOS_PREPARACION = { nombre: "trasladosPreparacion", recurso: "StockTransfers", claveSap: "DocEntry",
  claveLocal: "docEntry", dependencias: ["clientes", "productos"], claveNumerica: true, tamanoPagina: 10,
  campos: ["DocEntry", "DocNum", "DocDate", "CardCode", "FromWarehouse", "ToWarehouse", "StockTransferLines"],
  filtro: "FromWarehouse eq '02'", ventanaFacturas: true,
  schema: loteTrasladosPreparacionSchema, construirLote: construirLoteTrasladosPreparacion };
export const ENTIDADES = [CLIENTES, PRODUCTOS, UNIDADES, CODIGOS_BARRAS, LISTAS_MATERIALES, PEDIDOS, FACTURAS_PREPARACION, TRASLADOS_PREPARACION, ALMACENES, EXISTENCIAS];
export const entidadesHabilitadas = config => ENTIDADES.filter(e => (!e.inventario || config.inventarioHabilitado) && (!e.combos || config.combosHabilitados))
  .filter(e => e.nombre !== (config.fuentePreparacion === "facturas" ? "pedidos" : "facturasPreparacion"))
  .filter(e => e.nombre !== "trasladosPreparacion" || (config.trasladosHabilitados && config.fuentePreparacion === "facturas"))
  .map(e => e.nombre === "facturasPreparacion" ? { ...e,
    // La fecha la agrega cada recorrido (ver desdeFacturas en sincronizar.js).
    filtro: "DocType eq 'dDocument_Items' and ReserveInvoice eq 'tNO'",
    dependencias: [...e.dependencias, ...(config.combosHabilitados ? ["listasMateriales"] : [])] }
    : e.nombre === "pedidos" && config.combosHabilitados ? { ...e, dependencias: [...e.dependencias, "listasMateriales"] } : e.nombre === "existencias" ? { ...e, fuente: fuenteExistencias(config),
    ...(["sql-01-02", "sql-almacenes"].includes(config.modoExistencias) ? { consultaExistenciasSql: true, tamanoPagina: 20 } : {}) } : e);
