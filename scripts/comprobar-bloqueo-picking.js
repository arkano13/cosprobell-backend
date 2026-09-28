import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import pg from "pg";

import env from "../src/config/env.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { escanearPicking } from "../src/modules/picking/picking.service.js";

const { Client } = pg;

async function main() {
  const conexion = new Client({
    connectionString: env.databaseUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });

  const codigo = `PRUEBA-BLOQUEO-${randomUUID()}`;

  let pickingId;
  let transaccionAbierta = false;
  let resultadoEscaneo;
  let escaneoTerminado = false;

  try {
    await conexion.connect();

    const picking = await prisma.pickingPedido.create({
      data: {
        pedidoDocEntry: -1,
        usuarioId: "prueba-bloqueo",
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

    // Esta conexión mantiene bloqueada la sesión.
    await conexion.query("BEGIN");
    transaccionAbierta = true;

    await conexion.query(
      "SELECT id FROM picking_pedidos WHERE id = $1 FOR UPDATE",
      [pickingId]
    );

    const resultadoPid = await conexion.query(
      "SELECT pg_backend_pid() AS pid"
    );

    const pidBloqueador = resultadoPid.rows[0].pid;

    console.log("Sesión bloqueada. Iniciando escaneo...");

    // Capturamos ambos resultados para evitar rechazos sin manejar
    // mientras comprobamos el bloqueo.
    resultadoEscaneo = escanearPicking(pickingId, codigo).then(
      (value) => {
        escaneoTerminado = true;
        return { ok: true, value };
      },
      (error) => {
        escaneoTerminado = true;
        return { ok: false, error };
      }
    );

    let bloqueoConfirmado = false;
    const limite = Date.now() + 4_000;

    while (Date.now() < limite) {
      // PostgreSQL informa qué conexiones esperan a nuestro bloqueo.
      const conexionesEsperando = await prisma.$queryRaw`
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND ${pidBloqueador}::integer = ANY(pg_blocking_pids(pid))
      `;

      if (conexionesEsperando.length > 0) {
        bloqueoConfirmado = true;
        break;
      }

      if (escaneoTerminado) {
        break;
      }

      await esperar(150);
    }

    assert.ok(
      bloqueoConfirmado,
      "No se pudo confirmar en PostgreSQL que el escaneo espera el bloqueo"
    );

    assert.equal(
      escaneoTerminado,
      false,
      "El escaneo no debe terminar mientras la sesión esté bloqueada"
    );

    console.log("CONFIRMADO: PostgreSQL detecta el escaneo esperando.");

    await conexion.query("COMMIT");
    transaccionAbierta = false;

    console.log("Bloqueo liberado.");

    const resultado = await resultadoEscaneo;

    if (!resultado.ok) {
      throw resultado.error;
    }

    assert.equal(
      resultado.value.cantidadEscaneada,
      1,
      "El escaneo debe registrar una unidad después de liberar el bloqueo"
    );

    const sesionFinal = await prisma.pickingPedido.findUnique({
      where: { id: pickingId },
      include: { lineas: true },
    });

    assert.ok(sesionFinal, "La sesión debe existir");
    assert.equal(sesionFinal.estado, "en_proceso");
    assert.equal(sesionFinal.lineas.length, 1);
    assert.equal(sesionFinal.lineas[0].cantidadEscaneada, 1);

    console.log("APROBADO: el escaneo esperó y luego se registró.");
    console.log("Cantidad final: 1 de 5.");
  } finally {
    // Primero liberamos el bloqueo, incluso si una comprobación falla.
    try {
      if (transaccionAbierta) {
        await conexion.query("ROLLBACK");
      }
    } finally {
      await conexion.end();
    }

    // Esperamos a que el escaneo termine antes de borrar sus datos.
    if (resultadoEscaneo) {
      await resultadoEscaneo;
    }

    if (pickingId !== undefined) {
      await prisma.$transaction(async (tx) => {
        await tx.pickingPedidoLinea.deleteMany({
          where: { pickingId },
        });

        await tx.pickingPedido.delete({
          where: { id: pickingId },
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