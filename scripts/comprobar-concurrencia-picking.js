import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma.js";
import { escanearPicking } from "../src/modules/picking/picking.service.js";

async function main() {
  const codigo = `PRUEBA-${randomUUID()}`;
  let pickingId;

  try {
    const picking = await prisma.pickingPedido.create({
      data: {
        // Referencia ficticia: este modelo actualmente
        // no tiene una relación obligatoria con Pedido.
        pedidoDocEntry: -1,
        usuarioId: "prueba-concurrencia",
        estado: "en_proceso",

        lineas: {
          create: {
            pedidoLineNum: 0,
            itemCode: codigo,
            cantidadPedida: 5,
            cantidadEscaneada: 0,
          },
        },
      },
    });

    pickingId = picking.id;

    console.log("Sesión temporal creada:", pickingId);
    console.log("Ejecutando dos solicitudes de escaneo...");

    // Esperamos a que terminen ambas, incluso si alguna falla,
    // antes de comprobar resultados o limpiar los registros.
    const resultados = await Promise.allSettled([
      escanearPicking(pickingId, codigo),
      escanearPicking(pickingId, codigo),
    ]);

    for (const [indice, resultado] of resultados.entries()) {
      if (resultado.status === "rejected") {
        throw new Error(
          `Escaneo ${indice + 1} rechazado: ${
            resultado.reason?.code ?? "ERROR_INTERNO"
          }`
        );
      }
    }

    const cantidadesDevueltas = resultados
      .map((resultado) => resultado.value.cantidadEscaneada)
      .sort((a, b) => a - b);

    assert.deepEqual(
      cantidadesDevueltas,
      [1, 2],
      "Los escaneos deben registrar los avances 1 y 2"
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
      2,
      "La cantidad final debe ser exactamente 2"
    );

    console.log("APROBADO: ambos escaneos se registraron.");
    console.log("Cantidad final: 2 de 5.");
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