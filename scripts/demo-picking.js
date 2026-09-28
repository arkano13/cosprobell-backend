import assert from "node:assert/strict";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { consultarPicking, escanearPicking, finalizarPicking } from "../src/modules/picking/picking.service.js";
import { conDatosPicking } from "./helpers/datos-picking.js";

try {
  await conDatosPicking([3], async ({ sesionId, codigo, cajaCodigo, otroCodigo, sinConfirmarCodigo, cajaId, unidadId }) => {
    console.log("OBJETIVO: preparar 3 shampoos individuales con el servicio real.");
    async function rechazar(etiqueta, code) {
      const antes = await consultarPicking(sesionId);
      await assert.rejects(escanearPicking(sesionId, etiqueta), (error) => error.code === code);
      assert.deepEqual(await consultarPicking(sesionId), antes);
      console.log(`RECHAZADO sin cambios: ${code}`);
    }
    await rechazar(`DESCONOCIDO-${codigo}`, "ETIQUETA_NO_ENCONTRADA");
    await rechazar(cajaCodigo, "PRESENTACION_NO_PERMITIDA");
    await rechazar(otroCodigo, "PRODUCTO_FUERA_DEL_PEDIDO");
    await rechazar(sinConfirmarCodigo, "ETIQUETA_SIN_CONFIRMAR");

    // Comprobamos también una unidad incompatible y una referencia manual.
    for (const [uomEntry, code] of [[cajaId, "UNIDAD_INCOMPATIBLE"], [-1, "UNIDAD_NO_DEFINIDA"]]) {
      await prisma.pickingPedidoLinea.updateMany({ where: { pickingId: sesionId }, data: { uomEntry } });
      await rechazar(codigo, code);
    }
    await prisma.pickingPedidoLinea.updateMany({ where: { pickingId: sesionId }, data: { uomEntry: unidadId } });

    for (let cantidad = 1; cantidad <= 3; cantidad++) {
      const linea = await escanearPicking(sesionId, codigo);
      assert.equal(linea.cantidadEscaneada, cantidad);
      assert.equal(linea.codigoBarrasEscaneado, codigo);
      const guardada = (await consultarPicking(sesionId)).lineas[0];
      assert.equal(guardada.cantidadEscaneada, cantidad);
      assert.equal(guardada.codigoBarrasEscaneado, codigo);
      console.log(`ACEPTADO: shampoo individual, ${cantidad} de 3. Etiqueta guardada.`);
    }
    await rechazar(codigo, "CANTIDAD_COMPLETADA");
    const cierre = await finalizarPicking(sesionId);
    assert.equal(cierre.estado, "completo");
    assert.ok(cierre.fechaFin);
    const guardada = await consultarPicking(sesionId);
    assert.equal(guardada.estado, "completo");
    assert.equal(guardada.lineas[0].cantidadEscaneada, 3);
    assert.ok(guardada.fechaFin);
    await rechazar(codigo, "PICKING_NO_ACTIVO");
    console.log("DEMO APROBADA: el servicio real identifica, valida, registra y cierra.");
  });
} catch (error) {
  console.error("DEMO FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
