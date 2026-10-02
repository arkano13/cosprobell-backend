import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";

export const versionEtiquetas = filas => createHash("sha256").update(JSON.stringify(
  [...filas].sort((a, b) => a.id - b.id).map(c => [c.id, c.itemCode, c.codigo, c.uomEntry])
)).digest("hex");

// Una confirmación está desactualizada si el código cambió después de confirmarse (producto, código o unidad).
const DESACTUALIZADA = Prisma.sql`(k."itemCodeConfirmado" <> c."itemCode" OR k."codigoConfirmado" <> c.codigo
  OR k."uomEntryConfirmado" IS DISTINCT FROM c."uomEntry")`;

function consultar(condiciones, limite, db) {
  return db.$queryRaw`
    SELECT c.id, c."itemCode", p."itemName", c.codigo, c."uomEntry", u.code AS "uomCode", u.name AS "uomNombre",
           c."sapAbsEntry", c.origen, (k."codigoBarrasId" IS NOT NULL) AS confirmada, k."esUnidadIndividual",
           k."confirmadaEn", k."confirmadaPor", k.observacion, COALESCE(${DESACTUALIZADA}, false) AS desactualizada
    FROM productos_codigos_barras c
    JOIN productos p ON p."itemCode" = c."itemCode"
    LEFT JOIN confirmaciones_etiquetas_picking k ON k."codigoBarrasId" = c.id
    LEFT JOIN unidades_medida u ON u."absEntry" = c."uomEntry"
    WHERE ${Prisma.join(condiciones, " AND ")}
    ORDER BY c.id
    LIMIT ${limite}`;
}

// Texto literal para ILIKE: % y _ no actúan como comodines.
const literal = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

export const etiquetasRepository = {
  listar({ estado, itemCode, buscar, cursor, limit }, db = prisma) {
    const condiciones = [Prisma.sql`c."retiradoEnSap" = false`];
    if (cursor !== undefined) condiciones.push(Prisma.sql`c.id > ${cursor}`);
    if (itemCode !== undefined) condiciones.push(Prisma.sql`c."itemCode" = ${itemCode}`);
    if (estado === "pendientes") condiciones.push(Prisma.sql`(k."codigoBarrasId" IS NULL OR ${DESACTUALIZADA})`);
    if (estado === "sin_confirmar") condiciones.push(Prisma.sql`k."codigoBarrasId" IS NULL`);
    if (estado === "desactualizadas") condiciones.push(Prisma.sql`k."codigoBarrasId" IS NOT NULL AND ${DESACTUALIZADA}`);
    if (estado === "confirmadas") condiciones.push(Prisma.sql`k."codigoBarrasId" IS NOT NULL AND NOT ${DESACTUALIZADA}`);
    if (buscar !== undefined) {
      const patron = `%${literal(buscar)}%`;
      condiciones.push(Prisma.sql`(c.codigo = ${buscar} OR c."itemCode" ILIKE ${patron} OR p."itemName" ILIKE ${patron})`);
    }
    return consultar(condiciones, limit + 1, db);
  },
  async contar(db = prisma) {
    const [fila] = await db.$queryRaw`
      SELECT count(*) FILTER (WHERE k."codigoBarrasId" IS NULL)::int AS "sinConfirmar",
             count(*) FILTER (WHERE k."codigoBarrasId" IS NULL AND c."uomEntry" = -1)::int AS "manualSinConfirmar",
             count(*) FILTER (WHERE k."codigoBarrasId" IS NOT NULL AND ${DESACTUALIZADA})::int AS desactualizadas,
             count(*) FILTER (WHERE k."codigoBarrasId" IS NOT NULL AND NOT ${DESACTUALIZADA})::int AS confirmadas
      FROM productos_codigos_barras c
      LEFT JOIN confirmaciones_etiquetas_picking k ON k."codigoBarrasId" = c.id
      WHERE c."retiradoEnSap" = false`;
    const pendientes = await db.$queryRaw`
      SELECT c.id, c."itemCode", c.codigo, c."uomEntry" FROM productos_codigos_barras c
      WHERE NOT c."retiradoEnSap" AND c."uomEntry" = -1
        AND NOT EXISTS (SELECT 1 FROM confirmaciones_etiquetas_picking k WHERE k."codigoBarrasId" = c.id)
      ORDER BY c.id`;
    return { ...fila, manualSinConfirmar: pendientes.length, versionManual: versionEtiquetas(pendientes) };
  },
  // Confirma como unidad todos los códigos sin confirmar con unidad Manual. Bloquea esas filas como la
  // confirmación individual y solo aplica si siguen siendo los que vio el supervisor (cantidad y contenido).
  confirmarManualPendientes({ cantidadEsperada, versionEsperada, confirmadaPor }) {
    return prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw`
        SELECT c.id, c."itemCode", c.codigo, c."uomEntry" FROM productos_codigos_barras c
        WHERE c."retiradoEnSap" = false AND c."uomEntry" = -1
          AND NOT EXISTS (SELECT 1 FROM confirmaciones_etiquetas_picking k WHERE k."codigoBarrasId" = c.id)
        ORDER BY c.id FOR UPDATE OF c`;
      if (filas.length !== cantidadEsperada) return { confirmadas: 0, disponibles: filas.length };
      if (versionEtiquetas(filas) !== versionEsperada) throw new AppError({ code: "ETIQUETAS_CAMBIARON",
        statusCode: 409, message: "Los códigos cambiaron. Actualizá la lista antes de confirmar." });
      const ids = filas.map((f) => f.id);
      const confirmadas = ids.length ? await tx.$executeRaw`
        INSERT INTO confirmaciones_etiquetas_picking ("codigoBarrasId", "esUnidadIndividual", "itemCodeConfirmado",
          "codigoConfirmado", "uomEntryConfirmado", "confirmadaEn", "confirmadaPor", observacion)
        SELECT c.id, true, c."itemCode", c.codigo, c."uomEntry", now(), ${confirmadaPor}, 'Confirmación masiva: unidad Manual'
        FROM productos_codigos_barras c WHERE c.id = ANY(${ids})
        ON CONFLICT ("codigoBarrasId") DO NOTHING` : 0;
      return { confirmadas, disponibles: filas.length };
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 60_000 });
  },
  async obtener(id, db = prisma) {
    const [fila] = await consultar([Prisma.sql`c.id = ${id}`], 1, db);
    return fila ?? null;
  },
  // Bloquea la fila del código mientras se confirma: una sincronización simultánea espera y, si cambia
  // el código, la confirmación queda desactualizada en vez de confirmar datos que ya no existen.
  conEtiquetaBloqueada(id, operacion) {
    return prisma.$transaction(async (tx) => {
      const [etiqueta] = await tx.$queryRaw`
        SELECT id, "itemCode", codigo, "uomEntry", "retiradoEnSap"
        FROM productos_codigos_barras WHERE id = ${id} FOR UPDATE`;
      return operacion({ tx, etiqueta: etiqueta ?? null });
    }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
  },
  guardarConfirmacion(confirmacion, tx) {
    const { codigoBarrasId, ...datos } = confirmacion;
    return tx.confirmacionEtiquetaPicking.upsert({ where: { codigoBarrasId }, create: confirmacion, update: datos });
  },
  eliminarConfirmacion(codigoBarrasId, tx) {
    return tx.confirmacionEtiquetaPicking.deleteMany({ where: { codigoBarrasId } });
  },
};
