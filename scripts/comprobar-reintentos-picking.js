import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { conDatosPicking } from "./helpers/datos-picking.js";
import { pickingEscaneosRepository } from "../src/modules/picking/picking.escaneos.repository.js";
import { escanearPicking, consultarPicking, consultarHistorialPicking, finalizarPicking } from "../src/modules/picking/picking.service.js";

const primeraOperacion = randomUUID();
try {
  await conDatosPicking([5], async ({ sesionId, codigo, cajaCodigo, sinConfirmarCodigo }) => {
    const contar = () => prisma.pickingEscaneo.count({ where: { pickingId: sesionId } });
    const leerCantidad = async () => (await consultarPicking(sesionId)).lineas[0].cantidadEscaneada;

    // Dos envíos de la misma lectura, incluso concurrentes, son un evento.
    const resultados = await Promise.allSettled([
      escanearPicking(sesionId, codigo, primeraOperacion, { aplicacion: "demo-reintentos" }),
      escanearPicking(sesionId, codigo, primeraOperacion, { aplicacion: "demo-reintentos" }),
    ]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 2);
    const primera = resultados[0].value;
    assert.deepEqual(resultados[1].value, primera);
    assert.equal(await leerCantidad(), 1);
    assert.equal(await contar(), 1);
    console.log("APROBADO: misma operación concurrente, una unidad y un evento.");

    await escanearPicking(sesionId, codigo, randomUUID());
    assert.deepEqual(await escanearPicking(sesionId, codigo, primeraOperacion), primera);
    assert.equal(await leerCantidad(), 2);
    assert.equal(await contar(), 2);
    console.log("APROBADO: una nueva lectura suma; el reintento conserva su respuesta original.");

    await assert.rejects(escanearPicking(sesionId, cajaCodigo, primeraOperacion), { code: "OPERACION_REUTILIZADA" });
    assert.equal(await leerCantidad(), 2);
    assert.equal(await contar(), 2);
    console.log("APROBADO: otro código con el mismo identificador se rechaza.");

    const rechazada = randomUUID();
    await assert.rejects(escanearPicking(sesionId, sinConfirmarCodigo, rechazada), { code: "ETIQUETA_SIN_CONFIRMAR" });
    const asociacion = await prisma.productoCodigoBarras.findFirstOrThrow({ where: { codigo: sinConfirmarCodigo } });
    await prisma.confirmacionEtiquetaPicking.create({ data: {
      codigoBarrasId: asociacion.id, esUnidadIndividual: true,
      itemCodeConfirmado: asociacion.itemCode, codigoConfirmado: asociacion.codigo,
      uomEntryConfirmado: asociacion.uomEntry, observacion: "Confirmación ficticia del script",
    } });
    await assert.rejects(escanearPicking(sesionId, sinConfirmarCodigo, rechazada), { code: "ETIQUETA_SIN_CONFIRMAR" });
    assert.equal(await contar(), 3);
    await escanearPicking(sesionId, sinConfirmarCodigo, randomUUID());
    assert.equal(await leerCantidad(), 3);
    console.log("APROBADO: rechazo persistido y estable; una nueva lectura permite reevaluar.");

    // Provocamos un fallo SQL real después del incremento y antes del evento.
    const recuperar = randomUUID();
    const crearOriginal = pickingEscaneosRepository.crear;
    const eventosAntes = await contar();
    const sesionAntes = await consultarPicking(sesionId);
    try {
      pickingEscaneosRepository.crear = async (_datos, tx) => {
        await tx.$queryRaw`SELECT 1 / 0 AS fallo_intencionado`;
        throw new Error("La división por cero debía fallar");
      };
      await assert.rejects(escanearPicking(sesionId, codigo, recuperar), (error) => error.code === "P2010");
    } finally {
      pickingEscaneosRepository.crear = crearOriginal;
    }
    assert.deepEqual(await consultarPicking(sesionId), sesionAntes);
    assert.equal(await contar(), eventosAntes);
    assert.equal((await escanearPicking(sesionId, codigo, recuperar)).cantidadEscaneada, 4);
    console.log("APROBADO: fallo SQL revierte cantidad e historial; el mismo UUID puede reintentarse.");

    await escanearPicking(sesionId, codigo, randomUUID());
    assert.equal((await finalizarPicking(sesionId)).estado, "completo");
    assert.deepEqual(await escanearPicking(sesionId, codigo, primeraOperacion), primera);
    await assert.rejects(escanearPicking(sesionId, codigo, randomUUID()), { code: "PICKING_NO_ACTIVO" });
    assert.equal(await leerCantidad(), 5);
    console.log("APROBADO: recupera una respuesta antigua tras el cierre y rechaza lecturas nuevas.");

    const eventos = [];
    let despuesDe;
    do {
      const pagina = await consultarHistorialPicking(sesionId, { limit: 2, despuesDe });
      assert.ok(pagina.data.length <= 2);
      eventos.push(...pagina.data);
      despuesDe = pagina.siguienteCursor;
    } while (despuesDe !== null);
    assert.equal(eventos.length, 7);
    assert.equal(new Set(eventos.map((e) => e.id)).size, 7);
    assert.equal(eventos.filter((e) => e.resultado === "aceptado").length, 5);
    assert.equal(eventos.filter((e) => e.resultado === "rechazado").length, 2);
    assert.equal(eventos.reduce((total, e) => total + e.cantidadRegistrada, 0), 5);
    assert.ok(eventos.every((e) => !Object.hasOwn(e, "respuesta")));
    console.table(eventos.map(({ resultado, cantidadRegistrada, errorCode }) => ({ resultado, cantidadRegistrada, errorCode })));
    console.log("APROBADO: historial paginado sin duplicados, cinco aceptados y dos rechazos.");
    // Mantener la primera sesión y su evento vivos prueba el alcance real
    // del índice compuesto, no solamente la reutilización tras limpiar.
    await conDatosPicking([1], async ({ sesionId: otraSesion, codigo: otroCodigo }) => {
      assert.equal((await escanearPicking(otraSesion, otroCodigo, primeraOperacion)).cantidadEscaneada, 1);
      assert.equal(await prisma.pickingEscaneo.count({ where: { operacionId: primeraOperacion } }), 2);
      assert.equal(await prisma.pickingEscaneo.count({ where: { pickingId: otraSesion } }), 1);
      console.log("APROBADO: el mismo UUID coexiste en dos sesiones independientes.");
    });
  });
  console.log("REINTENTOS E HISTORIAL APROBADOS.");
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
