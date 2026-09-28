import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
const { pickingRepository } = await import("../../src/modules/picking/picking.repository.js");
const { pickingEtiquetasRepository } = await import("../../src/modules/picking/picking.etiquetas.repository.js");
const { pickingEscaneosRepository } = await import("../../src/modules/picking/picking.escaneos.repository.js");
const { escanearPicking, consultarHistorialPicking } = await import("../../src/modules/picking/picking.service.js");

function preparar(t) {
  const sesion = { id: 25, estado: "en_proceso" };
  const linea = { id: 10, pickingId: 25, itemCode: "PROD-001", uomEntry: 1,
    cantidadPedida: 5, cantidadEscaneada: 0 };
  const estado = { etiquetaDisponible: true, falloGuardar: null, confirmadas: 0 };
  const eventos = new Map();
  const tx = { async $queryRaw() { return [sesion]; } };
  const original = prisma.$transaction;
  prisma.$transaction = async (operacion) => {
    const resultado = await operacion(tx);
    estado.confirmadas++;
    return resultado;
  };
  t.after(() => { prisma.$transaction = original; });
  const buscar = t.mock.method(pickingEscaneosRepository, "buscarOperacion", async (id, uuid, db) => {
    assert.equal(db, tx);
    return eventos.get(`${id}:${uuid}`) ?? null;
  });
  const crear = t.mock.method(pickingEscaneosRepository, "crear", async (datos, db) => {
    assert.equal(db, tx);
    if (estado.falloGuardar) throw estado.falloGuardar;
    const evento = { id: eventos.size + 1, ...datos };
    eventos.set(`${datos.pickingId}:${datos.operacionId}`, evento);
    return evento;
  });
  const etiquetas = t.mock.method(pickingEtiquetasRepository, "buscarProductos", async (codigo, db) => {
    assert.equal(db, tx);
    if (!estado.etiquetaDisponible) return [];
    return [{ itemCode: "PROD-001", codigosBarras: [{ id: 7, itemCode: "PROD-001", codigo, uomEntry: 1,
      confirmacionPicking: { codigoBarrasId: 7, esUnidadIndividual: true,
        itemCodeConfirmado: "PROD-001", codigoConfirmado: codigo, uomEntryConfirmado: 1 },
    }] }];
  });
  t.mock.method(pickingRepository, "buscarSesionConLineas", async () => ({ ...sesion, lineas: [linea] }));
  const incrementar = t.mock.method(pickingRepository, "incrementarLinea", async (datos, db) => {
    assert.equal(db, tx);
    linea.cantidadEscaneada++;
    linea.codigoBarrasEscaneado = datos.codigo;
    return [{ ...linea, timestampEscaneo: new Date("2026-09-28T12:00:00Z") }];
  });
  return { estado, sesion, linea, eventos, buscar, crear, etiquetas, incrementar };
}

test("reintento conserva la respuesta original incluso después de otras lecturas", async (t) => {
  const f = preparar(t);
  const uuid = randomUUID();
  const primera = await escanearPicking(25, " 00123 ", uuid, { aplicacion: "escaner-demo" });
  await escanearPicking(25, "00123", randomUUID());
  const repetida = await escanearPicking(25, "00123", uuid.toUpperCase());
  assert.deepEqual(repetida, primera);
  assert.equal(repetida.cantidadEscaneada, 1);
  assert.equal(f.linea.cantidadEscaneada, 2);
  assert.equal(f.eventos.size, 2);
  assert.equal(f.incrementar.mock.callCount(), 2);
  const evento = [...f.eventos.values()][0];
  assert.equal(evento.aplicacion, "escaner-demo");
  assert.equal(evento.cantidadAntes, 0);
  assert.equal(evento.cantidadDespues, 1);
  assert.equal(evento.cantidadRegistrada, 1);
});

test("reintento aceptado se recupera tras cerrar sin revalidar etiqueta", async (t) => {
  const f = preparar(t);
  const uuid = randomUUID();
  const primera = await escanearPicking(25, "00123", uuid);
  f.sesion.estado = "completo";
  f.estado.etiquetaDisponible = false;
  assert.deepEqual(await escanearPicking(25, "00123", uuid), primera);
  assert.equal(f.etiquetas.mock.callCount(), 1);
  assert.equal(f.incrementar.mock.callCount(), 1);
});

test("reutilizar una operación con otro código no modifica el evento original", async (t) => {
  const f = preparar(t);
  const uuid = randomUUID();
  await escanearPicking(25, "00123", uuid);
  await assert.rejects(escanearPicking(25, "OTRO", uuid), { code: "OPERACION_REUTILIZADA" });
  assert.equal(f.eventos.size, 1);
  assert.equal(f.incrementar.mock.callCount(), 1);
});

test("un rechazo se confirma antes de responder y se repite sin consultar otra vez", async (t) => {
  const f = preparar(t);
  f.estado.etiquetaDisponible = false;
  const uuid = randomUUID();
  await assert.rejects(escanearPicking(25, "00123", uuid), { code: "ETIQUETA_NO_ENCONTRADA" });
  assert.equal(f.estado.confirmadas, 1);
  f.estado.etiquetaDisponible = true;
  await assert.rejects(escanearPicking(25, "00123", uuid), { code: "ETIQUETA_NO_ENCONTRADA" });
  assert.equal(f.eventos.size, 1);
  assert.equal(f.etiquetas.mock.callCount(), 1);
  assert.equal(f.incrementar.mock.callCount(), 0);
  assert.equal([...f.eventos.values()][0].cantidadRegistrada, 0);
  // Una lectura nueva después de corregir el problema lleva otro UUID.
  assert.equal((await escanearPicking(25, "00123", randomUUID())).cantidadEscaneada, 1);
});

test("una lectura nueva tras el cierre deja un rechazo en el historial", async (t) => {
  const f = preparar(t);
  f.sesion.estado = "completo";
  await assert.rejects(escanearPicking(25, "00123", randomUUID()), { code: "PICKING_NO_ACTIVO" });
  assert.equal(f.eventos.size, 1);
  assert.equal([...f.eventos.values()][0].errorCode, "PICKING_NO_ACTIVO");
  assert.equal(f.incrementar.mock.callCount(), 0);
});

test("fallar al guardar historial propaga el error sin confirmar la transacción", async (t) => {
  const f = preparar(t);
  const fallo = new Error("Escritura de historial fallida");
  f.estado.falloGuardar = fallo;
  await assert.rejects(escanearPicking(25, "00123", randomUUID()), (error) => error === fallo);
  assert.equal(f.estado.confirmadas, 0);
  // La reversión de cantidades se comprueba aparte contra PostgreSQL real.
});

test("datos de operación inválidos no abren una transacción", async (t) => {
  const f = preparar(t);
  await assert.rejects(escanearPicking(25, "00123"), { code: "DATOS_ESCANEO_INVALIDOS" });
  await assert.rejects(escanearPicking(25, "", randomUUID()), { code: "DATOS_ESCANEO_INVALIDOS" });
  assert.equal(f.buscar.mock.callCount(), 0);
  assert.equal(f.estado.confirmadas, 0);
});

test("historial pagina en orden y termina con cursor null", async (t) => {
  t.mock.method(pickingRepository, "buscarEstadoSesion", async () => ({ estado: "completo" }));
  t.mock.method(pickingEscaneosRepository, "listar", async (id, query) => {
    assert.equal(id, 25);
    return query.despuesDe === undefined ? [{ id: 1 }, { id: 2 }, { id: 3 }] : [{ id: 3 }];
  });
  assert.deepEqual(await consultarHistorialPicking(25, { limit: 2 }), {
    data: [{ id: 1 }, { id: 2 }], siguienteCursor: 2,
  });
  assert.deepEqual(await consultarHistorialPicking(25, { limit: 2, despuesDe: 2 }), {
    data: [{ id: 3 }], siguienteCursor: null,
  });
});

test("historial rechaza paginación inválida sin consultar", async (t) => {
  const consulta = t.mock.method(pickingRepository, "buscarEstadoSesion", async () => null);
  for (const query of [{ limit: 0 }, { limit: 101 }, { despuesDe: -1 }, { despuesDe: 1.5 }]) {
    await assert.rejects(consultarHistorialPicking(25, query), { code: "PAGINACION_INVALIDA" });
  }
  assert.equal(consulta.mock.callCount(), 0);
});

test("repositorio de historial limita la consulta a una sesión y no devuelve la respuesta completa", async () => {
  let consulta;
  const tx = { pickingEscaneo: { async findMany(datos) { consulta = datos; return []; } } };
  await pickingEscaneosRepository.listar(25, { limit: 2, despuesDe: 7 }, tx);
  assert.deepEqual(consulta.where, { pickingId: 25, id: { gt: 7 } });
  assert.equal(consulta.take, 3);
  assert.deepEqual(consulta.orderBy, { id: "asc" });
  assert.equal(consulta.select.respuesta, undefined);
});


// Comprobar solo error.code no detecta mensajes con codificación dañada.
test("mensajes de validación conservan las tildes", async () => {
  await assert.rejects(escanearPicking(25, "00123", "invalido"), {
    code: "DATOS_ESCANEO_INVALIDOS",
    message: "El escaneo requiere un código válido y un operacionId UUID",
  });
  await assert.rejects(consultarHistorialPicking(25, { limit: 0 }), {
    code: "PAGINACION_INVALIDA",
    message: "La paginación del historial no es válida",
  });
});

test("conflicto de operación conserva el mensaje completo", async (t) => {
  preparar(t);
  const uuid = randomUUID();
  await escanearPicking(25, "00123", uuid);
  await assert.rejects(escanearPicking(25, "OTRO", uuid), {
    code: "OPERACION_REUTILIZADA",
    message: "El operacionId ya se utilizó con otro código de barras",
  });
});

test("línea modificada conserva tildes al guardar y repetir el rechazo", async (t) => {
  const f = preparar(t);
  t.mock.method(pickingRepository, "incrementarLinea", async () => []);
  const uuid = randomUUID();
  const esperado = {
    code: "LINEA_MODIFICADA",
    message: "La línea cambió durante el escaneo; vuelva a consultar la sesión",
  };
  await assert.rejects(escanearPicking(25, "00123", uuid), esperado);
  const evento = [...f.eventos.values()][0];
  assert.equal(evento.errorMessage, esperado.message);
  await assert.rejects(escanearPicking(25, "00123", uuid), esperado);
  assert.equal(f.eventos.size, 1);
});
