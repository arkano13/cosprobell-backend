import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma.js";
import { escanearPicking } from "../src/modules/picking/picking.service.js";

async function main() {
  const codigo = `PRUEBA-LIMITE-${randomUUID()}`;
  let pickingId;

  try {
    const picking = await prisma.pickingPedido.create({
      data: {
        pedidoDocEntry: -1,
        usuarioId: "prueba-limite",
        estado: "en_proceso",
        lineas: {
          create: {
            pedidoLineNum: 0,
            itemCode: codigo,
            cantidadPedida: 1,
            cantidadEscaneada: 0,
          },
        },
      },
    });

    pickingId = picking.id;

    console.log("Sesión temporal creada:", pickingId);
    console.log("Ejecutando dos escaneos para una unidad...");

    const resultados = await Promise.allSettled([
      escanearPicking(pickingId, codigo),
      escanearPicking(pickingId, codigo),
    ]);

    const aceptados = resultados.filter(
      (resultado) => resultado.status === "fulfilled"
    );

    const rechazados = resultados.filter(
      (resultado) => resultado.status === "rejected"
    );

    assert.equal(
      aceptados.length,
      1,
      "Debe aceptarse exactamente un escaneo"
    );

    assert.equal(
      rechazados.length,
      1,
      "Debe rechazarse exactamente un escaneo"
    );

    assert.equal(
      aceptados[0].value.cantidadEscaneada,
      1,
      "El escaneo aceptado debe registrar una unidad"
    );

    assert.equal(
      rechazados[0].reason.code,
      "CANTIDAD_COMPLETADA",
      "El rechazo debe indicar que la cantidad está completa"
    );

    const sesionFinal = await prisma.pickingPedido.findUnique({
      where: {
        id: pickingId,
      },
      include: {
        lineas: true,
      },
    });

    assert.ok(sesionFinal, "La sesión debe existir");
    assert.equal(sesionFinal.estado, "en_proceso");
    assert.equal(sesionFinal.lineas.length, 1);

    assert.equal(
      sesionFinal.lineas[0].cantidadEscaneada,
      1,
      "La cantidad final no debe superar una unidad"
    );

    console.log("APROBADO: un escaneo aceptado.");
    console.log("Otro rechazado con CANTIDAD_COMPLETADA.");
    console.log("Cantidad final: 1 de 1.");
  } finally {
    if (pickingId !== undefined) {
      await prisma.$transaction(async (tx) => {
        await tx.pickingPedidoLinea.deleteMany({
          where: {
            pickingId,
          },
        });

        await tx.pickingPedido.delete({
          where: {
            id: pickingId,
          },
        });
      });

      console.log("Sesión temporal eliminada.");
    }
  }
}

try {
  await main();
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}