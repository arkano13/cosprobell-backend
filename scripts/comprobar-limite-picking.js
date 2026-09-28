import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { escanearPicking, consultarPicking } from "../src/modules/picking/picking.service.js";
import { conDatosPicking } from "./helpers/datos-picking.js";

try {
  await conDatosPicking([1], async ({ sesionId, codigo }) => {
    const resultados = await Promise.allSettled([
      escanearPicking(sesionId, codigo, randomUUID()), escanearPicking(sesionId, codigo, randomUUID()),
    ]);
    const aceptados = resultados.filter((r) => r.status === "fulfilled");
    const rechazados = resultados.filter((r) => r.status === "rejected");
    assert.equal(aceptados.length, 1);
    assert.equal(rechazados.length, 1);
    assert.equal(rechazados[0].reason.code, "CANTIDAD_COMPLETADA");
    const sesion = await consultarPicking(sesionId);
    assert.equal(sesion.lineas[0].cantidadEscaneada, 1);
    assert.equal(sesion.lineas[0].codigoBarrasEscaneado, codigo);
    console.log("APROBADO: un escaneo aceptado y otro rechazado; 1 de 1.");
  });
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
