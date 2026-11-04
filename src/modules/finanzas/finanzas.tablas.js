import { FINANZAS, claveRegistro } from "../../shared/finanzas/contratos.js";

// Una columna por campo recibido. El JSON original sigue siendo el comprobante
// de la carga, pero las lecturas publicadas pueden usar estas tablas.
const documento = {
  fecha: "docDate", vencimiento: "docDueDate", fechaDocumento: "taxDate", moneda: "docCurrency",
  total: "docTotal", pagado: "paidToDate", estado: "documentStatus", cancelado: "canceladoSap",
  vendedor: "salesPersonCode", condicionPago: "payTermsGrpCode",
};
const linea = {
  linea: "lineNum", descripcion: "itemDescription", cantidad: "quantity", precio: "price",
  total: "lineTotal", almacen: "warehouseCode", baseTipo: "baseType", baseEntry: "baseEntry", baseLinea: "baseLine",
};
const tabla = (modelo, nombre, claves, mapa = {}) => ({ modelo, nombre, claves, mapa });
export const TABLAS_FINANZAS = {
  empresa: tabla("empresaFinanciera", "empresa_financiera", ["codigo"]),
  clientes: tabla("cliente", "clientes", ["cardCode"], {
    nombre: "finNombre", activo: "finActivo", bloqueado: "finBloqueado", moneda: "currency",
    saldo: "currentAccountBalance", limiteCredito: "creditLimit", vendedor: "salesPersonCode",
    condicionPago: "payTermsGrpCode", zona: "zonaFinanciera", ruta: "uZona",
  }),
  vendedores: tabla("vendedor", "vendedores", ["codigo"], {
    codigo: "salesEmployeeCode", nombre: "finNombre", activo: "finActivo",
  }),
  condicionesPago: tabla("condicionPago", "condiciones_pago", ["codigo"]),
  facturas: tabla("factura", "facturas", ["docEntry"], documento),
  notasCredito: tabla("notaCredito", "notas_credito", ["docEntry"], documento),
  facturaLineas: tabla("facturaLinea", "facturas_lineas", ["docEntry", "linea"], {
    ...linea, docEntry: "facturaDocEntry",
  }),
  notaCreditoLineas: tabla("notaCreditoLinea", "notas_credito_lineas", ["docEntry", "linea"], {
    ...linea, docEntry: "notaCreditoDocEntry",
  }),
  cuotas: tabla("facturaCuota", "facturas_cuotas", ["docEntry", "cuota"]),
  pagos: tabla("pago", "pagos", ["docEntry"], {
    fecha: "docDate", moneda: "docCurrency", cancelado: "canceladoSap", efectivo: "cashSum", transferencia: "transferSum",
  }),
  aplicacionesPagos: tabla("pagoFactura", "pagos_facturas", ["pagoEntry", "linea"], {
    pagoEntry: "pagoDocEntry", linea: "lineNum", documento: "documentoSap", tipo: "invoiceType",
    cuota: "installmentId", lineaDocumento: "docLine", aplicado: "sumApplied",
  }),
  // ShortName puede ser una cuenta de mayor (_SYS...), no necesariamente un cliente.
  movimientos: tabla("movimientoContable", "movimientos_contables", ["transId", "linea"]),
};
export const ENTIDADES_NORMALIZABLES = Object.keys(TABLAS_FINANZAS);
export const columna = (entidad, campo) => TABLAS_FINANZAS[entidad].mapa[campo] ?? campo;
export function tipoCampo(schema) {
  if (schema.safeParse(1).success) return "Int";
  if (schema.safeParse("1.000001").success && !schema.safeParse("texto").success) return "Decimal";
  if (schema.safeParse("2000-01-01").success && !schema.safeParse("texto").success) return "DateTime";
  return "String";
}
export function datosParaTabla(entidad, datos, version) {
  const validos = FINANZAS[entidad].schema.parse(datos);
  return {
    ...Object.fromEntries(Object.entries(validos).map(([campo, valor]) => [columna(entidad, campo),
      valor != null && tipoCampo(FINANZAS[entidad].campos[campo]) === "DateTime" ? new Date(`${valor}T00:00:00Z`) : valor])),
    finVersion: version, finClave: claveRegistro(entidad, validos),
  };
}
export function datosDesdeTabla(entidad, fila) {
  return FINANZAS[entidad].schema.parse(Object.fromEntries(Object.entries(FINANZAS[entidad].campos).map(([campo, schema]) => {
    const valor = fila[columna(entidad, campo)];
    const tipo = tipoCampo(schema);
    return [campo, valor == null ? null : tipo === "Decimal" ? String(valor)
      : tipo === "DateTime" ? valor.toISOString().slice(0, 10) : valor];
  })));
}
