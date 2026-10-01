import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { pickingRepository } = await import("../../src/modules/picking/picking.repository.js");
const { pickingEtiquetasRepository } = await import("../../src/modules/picking/picking.etiquetas.repository.js");
const { escanearPicking, finalizarPicking } = await import("../../src/modules/picking/picking.service.js");
const { pickingEscaneosRepository } = await import("../../src/modules/picking/picking.escaneos.repository.js");
const { AppError } = await import("../../src/shared/errors/AppError.js");
const { inventarioRepository } = await import("../../src/modules/inventario/inventario.repository.js");

function linea(cambios = {}) {
  return { id: 10, itemCode: "PROD-001", uomEntry: 1,
    cantidadPedida: 3, cantidadEscaneada: 0, ...cambios };
}

function producto() {
  return { itemCode: "PROD-001", codigosBarras: [{
    id: 5, itemCode: "PROD-001", codigo: "00123", uomEntry: 1,
    confirmacionPicking: { codigoBarrasId: 5, esUnidadIndividual: true,
      itemCodeConfirmado: "PROD-001", codigoConfirmado: "00123", uomEntryConfirmado: 1 },
  }] };
}

function preparar(t, opciones = {}) {
  const sesion = opciones.sesion === undefined ? { id: 25, estado: "en_proceso" } : opciones.sesion;
  const lineas = opciones.lineas ?? [linea()];
  const productos = opciones.productos ?? [producto()];
  const pasos = [];
  const tx = { async $queryRaw() { pasos.push("bloquear"); return sesion ? [sesion] : []; } };
  const original = prisma.$transaction;
  prisma.$transaction = async (operacion) => operacion(tx);
  t.after(() => { prisma.$transaction = original; });

  t.mock.method(pickingEscaneosRepository, "buscarOperacion", async (id, operacionId, db) => {
    assert.equal(db, tx); return null;
  });
  t.mock.method(pickingEscaneosRepository, "crear", async (datos, db) => {
    assert.equal(db, tx); return { id: 1, ...datos };
  });

  const consultaEtiquetas = t.mock.method(pickingEtiquetasRepository, "buscarProductos", async (codigo, db) => {
    assert.equal(db, tx);
    assert.equal(codigo, "00123");
    pasos.push("etiqueta");
    if (opciones.falloEtiqueta) throw opciones.falloEtiqueta;
    return productos;
  });

  const consultar = t.mock.method(pickingRepository, "buscarSesionConLineas", async (id, db) => {
    assert.equal(db, tx);
    pasos.push("lineas");
    return { ...sesion, lineas };
  });

  const incrementar = t.mock.method(pickingRepository, "incrementarLinea", async (datos, db) => {
    assert.equal(db, tx);
    pasos.push("incrementar");
    if (opciones.falloIncremento) throw opciones.falloIncremento;
    if (opciones.sinActualizacion) return [];
    const elegida = lineas.find((fila) => fila.id === datos.lineaId);
    return [{ ...elegida, cantidadEscaneada: elegida.cantidadEscaneada + 1,
      codigoBarrasEscaneado: datos.codigo }];
  });

  const finalizar = t.mock.method(pickingRepository, "guardarFinalizacion", async (id, estado, fechaFin, db) => {
    assert.equal(db, tx);
    pasos.push("finalizar");
    return { id, estado, fechaFin, lineas };
  });
  // Inventario: por defecto el producto todavía no está en el inventario y el cierre no descuenta nada.
  const inventario = { pequena: [], movimientos: [] };
  t.mock.method(inventarioRepository, "bloquearProductos", async (itemCodes, db) => { assert.equal(db, tx); pasos.push("bloquearInventario"); });
  t.mock.method(inventarioRepository, "estadoProducto", async (itemCode, db) => {
    assert.equal(db, tx); return opciones.enInventario ? { itemCode, pequena: 10 } : null;
  });
  t.mock.method(inventarioRepository, "cambiarPequena", async (itemCode, delta, db) => {
    assert.equal(db, tx); inventario.pequena.push([itemCode, delta]); pasos.push("descontarPequena");
  });
  t.mock.method(inventarioRepository, "registrarMovimientos", async (movimientos, db) => {
    assert.equal(db, tx); inventario.movimientos.push(...movimientos);
  });
  return { tx, pasos, incrementar, finalizar, consultar, consultaEtiquetas, inventario };
}

function errorEsperado(code, statusCode = 409) {
  return (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  };
}

test("escaneo integra etiqueta, confirmación y unidades en la misma transacción", async (t) => {
  const mocks = preparar(t);
  const resultado = await escanearPicking(25, " 00123 ", randomUUID());
  assert.equal(resultado.cantidadEscaneada, 1);
  assert.equal(resultado.codigoBarrasEscaneado, "00123");
  assert.deepEqual(mocks.incrementar.mock.calls[0].arguments, [{
    pickingId: 25, lineaId: 10, itemCode: "PROD-001", codigo: "00123", uomEntry: 1,
  }, mocks.tx]);
  assert.deepEqual(mocks.pasos, ["bloquear", "etiqueta", "lineas", "incrementar"]);
});

test("sesión inexistente impide escanear y finalizar antes de consultar etiquetas", async (t) => {
  const mocks = preparar(t, { sesion: null });
  await assert.rejects(escanearPicking(999, "00123", randomUUID()), errorEsperado("PICKING_NO_ENCONTRADO", 404));
  await assert.rejects(finalizarPicking(999), errorEsperado("PICKING_NO_ENCONTRADO", 404));
  assert.equal(mocks.consultaEtiquetas.mock.callCount(), 0);
  assert.equal(mocks.incrementar.mock.callCount(), 0);
  assert.equal(mocks.finalizar.mock.callCount(), 0);
});

test("sesión cerrada impide escanear y volver a finalizar", async (t) => {
  const mocks = preparar(t, { sesion: { id: 25, estado: "completo" } });
  await assert.rejects(escanearPicking(25, "00123", randomUUID()), errorEsperado("PICKING_NO_ACTIVO", 400));
  await assert.rejects(finalizarPicking(25), errorEsperado("PICKING_NO_ACTIVO", 400));
  assert.equal(mocks.consultaEtiquetas.mock.callCount(), 0);
  assert.equal(mocks.incrementar.mock.callCount(), 0);
  assert.equal(mocks.finalizar.mock.callCount(), 0);
});

test("cambio de SAP bloquea escaneo y finalización sin perder cantidades", async (t) => {
  const mocks = preparar(t, { sesion: { id: 25, estado: "requiere_revision" } });
  await assert.rejects(escanearPicking(25, "00123", randomUUID()), errorEsperado("PEDIDO_REQUIERE_REVISION"));
  await assert.rejects(finalizarPicking(25), errorEsperado("PEDIDO_REQUIERE_REVISION"));
  assert.equal(mocks.incrementar.mock.callCount(), 0);
  assert.equal(mocks.finalizar.mock.callCount(), 0);
  assert.equal(pickingEscaneosRepository.crear.mock.calls[0].arguments[0].resultado, "rechazado");
});

const rechazos = [
  { nombre: "código desconocido", code: "ETIQUETA_NO_ENCONTRADA", status: 404, preparar: () => ({ productos: [] }) },
  { nombre: "producto ambiguo", code: "CODIGO_AMBIGUO", preparar: () => ({ productos: [producto(), { itemCode: "OTRO", codigosBarras: [] }] }) },
  { nombre: "etiqueta sin confirmar", code: "ETIQUETA_SIN_CONFIRMAR", preparar: () => {
    const p = producto(); p.codigosBarras[0].confirmacionPicking = null; return { productos: [p] };
  } },
  { nombre: "caja", code: "PRESENTACION_NO_PERMITIDA", preparar: () => {
    const p = producto(); p.codigosBarras[0].confirmacionPicking.esUnidadIndividual = false; return { productos: [p] };
  } },
  { nombre: "confirmación desactualizada", code: "CONFIRMACION_DESACTUALIZADA", preparar: () => {
    const p = producto(); p.codigosBarras[0].uomEntry = 2; return { productos: [p] };
  } },
  { nombre: "producto ajeno", code: "PRODUCTO_FUERA_DEL_PEDIDO", preparar: () => ({ lineas: [linea({ itemCode: "OTRO" })] }) },
  { nombre: "unidad no definida", code: "UNIDAD_NO_DEFINIDA", preparar: () => ({ lineas: [linea({ uomEntry: null })] }) },
  { nombre: "línea Manual con etiqueta de otra unidad", code: "UNIDAD_INCOMPATIBLE", preparar: () => ({ lineas: [linea({ uomEntry: -1 })] }) },
  { nombre: "unidad incompatible", code: "UNIDAD_INCOMPATIBLE", preparar: () => ({ lineas: [linea({ uomEntry: 2 })] }) },
  { nombre: "cantidad fraccionaria", code: "CANTIDADES_INVALIDAS", preparar: () => ({ lineas: [linea({ cantidadPedida: 1.5 })] }) },
  { nombre: "cantidad completa", code: "CANTIDAD_COMPLETADA", preparar: () => ({ lineas: [linea({ cantidadEscaneada: 3 })] }) },
  { nombre: "presentaciones mezcladas del mismo producto", code: "UNIDAD_INCOMPATIBLE", preparar: () => ({ lineas: [linea(), linea({ id: 11, uomEntry: 2 })] }) },
];
for (const caso of rechazos) {
  test(`escaneo rechaza ${caso.nombre} antes de incrementar`, async (t) => {
    const mocks = preparar(t, caso.preparar());
    await assert.rejects(escanearPicking(25, "00123", randomUUID()), errorEsperado(caso.code, caso.status ?? 409));
    assert.equal(mocks.incrementar.mock.callCount(), 0);
  });
}

test("elige la primera línea pendiente por id y no cambia otra línea", async (t) => {
  const mocks = preparar(t, { lineas: [linea({ id: 12 }), linea({ id: 10, cantidadEscaneada: 3 }), linea({ id: 11 })] });
  const resultado = await escanearPicking(25, "00123", randomUUID());
  assert.equal(resultado.id, 11);
  assert.equal(mocks.incrementar.mock.calls[0].arguments[0].lineaId, 11);
});

test("no confunde una actualización vacía con cantidad completada", async (t) => {
  preparar(t, { sinActualizacion: true });
  await assert.rejects(escanearPicking(25, "00123", randomUUID()), errorEsperado("LINEA_MODIFICADA"));
});

for (const origen of ["falloEtiqueta", "falloIncremento"]) {
  test(`propaga ${origen} para que la transacción revierta`, async (t) => {
    const fallo = new Error("Fallo simulado");
    preparar(t, { [origen]: fallo });
    await assert.rejects(escanearPicking(25, "00123", randomUUID()), (error) => error === fallo);
  });
}

test("finaliza completo cuando las cantidades coinciden", async (t) => {
  preparar(t, { lineas: [linea({ cantidadEscaneada: 3 })] });
  const resultado = await finalizarPicking(25);
  assert.equal(resultado.estado, "completo");
  assert.ok(resultado.fechaFin instanceof Date);
});

test("finaliza con diferencias cuando falta cantidad", async (t) => {
  preparar(t);
  assert.equal((await finalizarPicking(25)).estado, "con_diferencias");
});

test("finalizar descuenta lo escaneado de la bodega pequeña antes de cerrar, en la misma transacción", async (t) => {
  const { pasos, inventario } = preparar(t, { enInventario: true, sesion: { id: 25, estado: "en_proceso", usuarioId: "Carmen" },
    lineas: [linea({ cantidadEscaneada: 2 }), linea({ id: 11, cantidadEscaneada: 1 }), linea({ id: 12, itemCode: "OTRO", cantidadEscaneada: 0 })] });
  assert.equal((await finalizarPicking(25)).estado, "con_diferencias");
  assert.deepEqual(inventario.pequena, [["PROD-001", -3]], "suma las líneas del producto y omite lo no escaneado");
  assert.deepEqual(inventario.movimientos, [{ grupo: "picking-25-PROD-001", tipo: "picking", itemCode: "PROD-001",
    bodega: "pequena", cantidad: -3, pickingId: 25, hechoPor: "Carmen" }]);
  assert.ok(pasos.indexOf("descontarPequena") < pasos.indexOf("finalizar"));
});

test("finalizar no descuenta productos que todavía no entraron al inventario", async (t) => {
  const { inventario } = preparar(t, { lineas: [linea({ cantidadEscaneada: 3 })] });
  assert.equal((await finalizarPicking(25)).estado, "completo");
  assert.deepEqual(inventario.pequena, []);
});
