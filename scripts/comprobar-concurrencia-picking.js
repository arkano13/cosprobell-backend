import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { escanearPicking, consultarPicking } from "../src/modules/picking/picking.service.js";
import { conDatosPicking } from "./helpers/datos-picking.js";

try {
  await conDatosPicking([5], async ({ sesionId, codigo }) => {
    const resultados = await Promise.allSettled([
      escanearPicking(sesionId, codigo, randomUUID()), escanearPicking(sesionId, codigo, randomUUID()),
    ]);
    assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 2);
    assert.deepEqual(resultados.map((r) => r.value.cantidadEscaneada).sort(), [1, 2]);
    const sesion = await consultarPicking(sesionId);
    assert.equal(sesion.lineas[0].cantidadEscaneada, 2);
    assert.equal(sesion.lineas[0].codigoBarrasEscaneado, codigo);
    console.log("APROBADO: dos escaneos aceptados, 2 de 5.");
  });
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
