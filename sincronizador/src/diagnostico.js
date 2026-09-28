const CON_CODIGO = "BarCode ne null and BarCode ne ''";

const CONTEOS = [
  { clave: "bodegas", titulo: "Bodegas", entidad: "Warehouses" },
  { clave: "grupos", titulo: "Grupos de artículos", entidad: "ItemGroups" },
  { clave: "articulos", titulo: "Artículos", entidad: "Items" },
  { clave: "articulosActivos", titulo: "Artículos activos", entidad: "Items", filter: "Valid eq 'tYES'" },
  { clave: "articulosConCodigo", titulo: "Artículos con código de barras principal", entidad: "Items", filter: CON_CODIGO },
  { clave: "codigosBarras", titulo: "Códigos de barras registrados (por unidad)", entidad: "BarCodes" },
  { clave: "unidades", titulo: "Unidades de medida", entidad: "UnitOfMeasurements" },
  { clave: "gruposUnidades", titulo: "Grupos de unidades de medida", entidad: "UnitOfMeasurementGroups" },
  { clave: "ordenesAbiertas", titulo: "Órdenes de venta abiertas", entidad: "Orders", filter: "DocumentStatus eq 'bost_Open'" },
];

async function intentar(operacion) {
  try {
    return { valor: await operacion() };
  } catch (error) {
    return { error: error.message };
  }
}

function generarAlertas(conteos, muestras) {
  const valor = (clave) => conteos[clave]?.valor;
  const alertas = [];

  const conCodigo = valor("articulosConCodigo");
  const codigos = valor("codigosBarras");
  const activos = valor("articulosActivos");

  if (conCodigo === 0 && codigos === 0) {
    alertas.push(
      "No hay códigos de barras cargados en SAP: el escáner no podrá identificar productos hasta que se carguen."
    );
  } else if (conCodigo !== undefined && activos > 0 && conCodigo < activos / 2) {
    alertas.push(
      `Solo ${conCodigo} de ${activos} artículos activos tienen código de barras principal.`
    );
  }

  if (codigos !== undefined && conCodigo !== undefined && codigos > conCodigo) {
    alertas.push(
      "Hay más códigos registrados que artículos con código principal: probablemente existen códigos por unidad (caja y unidad). Revisar la muestra."
    );
  }

  if (valor("ordenesAbiertas") === 0) {
    alertas.push(
      "No hay órdenes de venta abiertas: confirmar qué documento usa bodega para preparar los despachos."
    );
  }

  const ultimas = muestras.ultimasOrdenes.valor;

  if (ultimas?.length > 0 && ultimas.every((orden) => orden.DocumentStatus === "bost_Close")) {
    alertas.push(
      `Las ${ultimas.length} órdenes más recientes ya están cerradas: revisar en qué momento se cierran respecto a la preparación.`
    );
  }

  return alertas;
}

export async function diagnosticar(serviceLayer) {
  const sesion = await serviceLayer.iniciarSesion();
  const conteos = {};

  for (const { clave, titulo, entidad, filter } of CONTEOS) {
    conteos[clave] = {
      titulo,
      ...(await intentar(() => serviceLayer.contar(entidad, { filter }))),
    };
  }

  const muestras = {
    ultimasOrdenes: await intentar(() =>
      serviceLayer.leerPrimeros("Orders", {
        select: ["DocEntry", "DocNum", "DocDate", "DocumentStatus", "Cancelled"],
        orderby: "DocEntry desc",
        top: 5,
      })
    ),
    articulosConCodigos: await intentar(() =>
      serviceLayer.leerPrimeros("Items", {
        select: ["ItemCode", "ItemName", "BarCode", "ItemBarCodeCollection"],
        filter: CON_CODIGO,
        orderby: "ItemCode",
        top: 3,
      })
    ),
  };

  return { sesion, conteos, muestras, alertas: generarAlertas(conteos, muestras) };
}

export function formatearDiagnostico({ sesion, conteos, muestras, alertas }) {
  const lineas = [
    "DIAGNÓSTICO DE SAP BUSINESS ONE (solo lectura)",
    "",
    `Conexión: correcta. Versión de Service Layer: ${sesion.version ?? "no informada"}. Sesión: ${sesion.minutosSesion ?? "?"} minutos.`,
    "",
    "Conteos:",
  ];

  for (const { titulo, valor, error } of Object.values(conteos)) {
    lineas.push(`  ${titulo}: ${error ? `no disponible (${error})` : valor}`);
  }

  lineas.push("", "Últimas órdenes de venta:");
  const ordenes = muestras.ultimasOrdenes;

  if (ordenes.error) {
    lineas.push(`  no disponible (${ordenes.error})`);
  } else if (ordenes.valor.length === 0) {
    lineas.push("  ninguna");
  } else {
    for (const orden of ordenes.valor) {
      lineas.push(
        `  N.º ${orden.DocNum} · ${orden.DocDate} · ${orden.DocumentStatus} · cancelada: ${orden.Cancelled}`
      );
    }
  }

  lineas.push("", "Muestra de artículos con código de barras:");
  const articulos = muestras.articulosConCodigos;

  if (articulos.error) {
    lineas.push(`  no disponible (${articulos.error})`);
  } else if (articulos.valor.length === 0) {
    lineas.push("  ninguno");
  } else {
    for (const articulo of articulos.valor) {
      const adicionales = (articulo.ItemBarCodeCollection ?? [])
        .map((codigo) => `${codigo.Barcode} (unidad ${codigo.UoMEntry})`)
        .join(", ");

      lineas.push(
        `  ${articulo.ItemCode} · ${articulo.ItemName} · principal ${articulo.BarCode}${adicionales ? ` · por unidad: ${adicionales}` : ""}`
      );
    }
  }

  lineas.push("", alertas.length > 0 ? "ATENCIÓN:" : "Sin alertas.");

  for (const alerta of alertas) {
    lineas.push(`  - ${alerta}`);
  }

  return lineas.join("\n");
}
