import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";

// Una confirmación está desactualizada si el código cambió después de confirmarse (producto, código o unidad).
const DESACTUALIZADA = Prisma.sql`(k."itemCodeConfirmado" <> c."itemCode" OR k."codigoConfirmado" <> c.codigo
  OR k."uomEntryConfirmado" IS DISTINCT FROM c."uomEntry")`;

function consultar(condiciones, limite, db) {
  return db.$queryRaw`
    SELECT c.id, c."itemCode", p."itemName", c.codigo, c."uomEntry", u.code AS "uomCode", u.name AS "uomNombre",
           c."sapAbsEntry", (k."codigoBarrasId" IS NOT NULL) AS confirmada, k."esUnidadIndividual",
           k."confirmadaEn", k."confirmadaPor", k.observacion, COALESCE(${DESACTUALIZADA}, false) AS desactualizada
    FROM productos_codigos_barras c
    JOIN productos p ON p."itemCode" = c."itemCode"
    LEFT JOIN confirmaciones_etiquetas_picking k ON k."codigoBarrasId" = c.id
    LEFT JOIN unidades_medida u ON u."absEntry" = c."uomEntry"
    WHERE ${Prisma.join(condiciones, " AND ")}
    ORDER BY c.id
    LIMIT ${limite}`;
}

export const etiquetasRepository = {
  listar({ estado, itemCode, cursor, limit }, db = prisma) {
    const condiciones = [Prisma.sql`c."retiradoEnSap" = false`];
    if (cursor !== undefined) condiciones.push(Prisma.sql`c.id > ${cursor}`);
    if (itemCode !== undefined) condiciones.push(Prisma.sql`c."itemCode" = ${itemCode}`);
    if (estado === "pendientes") condiciones.push(Prisma.sql`(k."codigoBarrasId" IS NULL OR ${DESACTUALIZADA})`);
    if (estado === "confirmadas") condiciones.push(Prisma.sql`k."codigoBarrasId" IS NOT NULL AND NOT ${DESACTUALIZADA}`);
    return consultar(condiciones, limit + 1, db);
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
