import assert from "node:assert/strict";
import { setTimeout as esperar } from "node:timers/promises";
import pg from "pg";
import env from "../src/config/env.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { escanearPicking, consultarPicking } from "../src/modules/picking/picking.service.js";
import { conDatosPicking } from "./helpers/datos-picking.js";

try {
  await conDatosPicking([5], async ({ sesionId, codigo }) => {
    const conexion = new pg.Client({ connectionString: env.databaseUrl,
      connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
    let transaccionAbierta = false;
    let resultadoEscaneo;
    let terminado = false;
    try {
      await conexion.connect();
      await conexion.query("BEGIN");
      transaccionAbierta = true;
      await conexion.query("SELECT id FROM picking_pedidos WHERE id = $1 FOR UPDATE", [sesionId]);
      const { rows: [{ pid }] } = await conexion.query("SELECT pg_backend_pid() AS pid");
      resultadoEscaneo = escanearPicking(sesionId, codigo).then(
        (valor) => { terminado = true; return { ok: true, valor }; },
        (error) => { terminado = true; return { ok: false, error }; }
      );
      let confirmado = false;
      const limite = Date.now() + 4_000;
      while (Date.now() < limite) {
        const filas = await prisma.$queryRaw`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database()
            AND ${pid}::integer = ANY(pg_blocking_pids(pid))
        `;
        if (filas.length > 0) { confirmado = true; break; }
        if (terminado) break;
        await esperar(100);
      }
      assert.ok(confirmado, "PostgreSQL debe confirmar la espera del bloqueo");
      assert.equal(terminado, false);
      console.log("CONFIRMADO: el escaneo espera en PostgreSQL.");
      await conexion.query("COMMIT");
      transaccionAbierta = false;
      const resultado = await resultadoEscaneo;
      if (!resultado.ok) throw resultado.error;
      assert.equal(resultado.valor.cantidadEscaneada, 1);
      const sesion = await consultarPicking(sesionId);
      assert.equal(sesion.lineas[0].cantidadEscaneada, 1);
      assert.equal(sesion.lineas[0].codigoBarrasEscaneado, codigo);
      console.log("APROBADO: escaneo registrado tras liberar el bloqueo, 1 de 5.");
    } finally {
      try {
        try {
          if (transaccionAbierta) await conexion.query("ROLLBACK");
        } finally {
          await conexion.end();
        }
      } finally {
        if (resultadoEscaneo) await resultadoEscaneo;
      }
    }
  });
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
