// Consultas de los conteos con nombre. Las lecturas se agregan por producto al consultar.
import { prisma } from "../../infrastructure/database/prisma.js";

export const conteosRepository = {
  crear({ nombre, operadorId, iniciadoPor }, db = prisma) {
    return db.conteo.create({ data: { nombre, operadorId, iniciadoPor } });
  },
  buscar(id, db = prisma) {
    return db.conteo.findUnique({ where: { id } });
  },
  // Los conteos (de un operador, o todos con operadorId undefined) con sus unidades y productos: los en curso y los
  // últimos terminados.
  async listar({ operadorId, limit }, db = prisma) {
    const filtro = operadorId === undefined ? {} : { operadorId };
    const [enCurso, terminados] = await Promise.all([
      db.conteo.findMany({ where: { ...filtro, estado: "en_curso" }, orderBy: { iniciadoEn: "desc" } }),
      db.conteo.findMany({ where: { ...filtro, estado: "terminado" }, orderBy: { terminadoEn: "desc" }, take: limit }),
    ]);
    const ids = [...enCurso, ...terminados].map((c) => c.id);
    const totales = ids.length ? await db.$queryRaw`
      SELECT "conteoId", COUNT(*)::int AS unidades, COUNT(DISTINCT "itemCode")::int AS productos
      FROM conteo_lecturas WHERE "conteoId" = ANY(${ids}) GROUP BY "conteoId"` : [];
    const por = new Map(totales.map((t) => [t.conteoId, t]));
    const con = (c) => ({ ...c, unidades: por.get(c.id)?.unidades ?? 0, productos: por.get(c.id)?.productos ?? 0 });
    return { enCurso: enCurso.map(con), terminados: terminados.map(con) };
  },
  // Lo escaneado, producto por producto: lo último escaneado primero.
  async escaneado(conteoId, db = prisma) {
    const filas = await db.$queryRaw`
      SELECT l."itemCode", COALESCE(p."itemName", l."itemCode") AS "itemName", COUNT(*)::int AS unidades,
             MAX(l.id) AS "ultimaLectura"
      FROM conteo_lecturas l LEFT JOIN productos p ON p."itemCode" = l."itemCode"
      WHERE l."conteoId" = ${conteoId} GROUP BY l."itemCode", p."itemName" ORDER BY "ultimaLectura" DESC`;
    return filas.map(({ ultimaLectura, ...f }) => f);
  },
  // Una lectura; la misma operación otra vez no suma (devuelve null), ni una lectura en un conteo cerrado.
  async agregarLectura({ conteoId, operacionId, codigo, itemCode, hechoPor }, db = prisma) {
    const filas = await db.$queryRaw`
      INSERT INTO conteo_lecturas ("conteoId", "operacionId", codigo, "itemCode", "hechoPor")
      SELECT ${conteoId}, ${operacionId}, ${codigo}, ${itemCode}, ${hechoPor}
      WHERE EXISTS (SELECT 1 FROM conteos WHERE id = ${conteoId} AND estado = 'en_curso')
      ON CONFLICT ("conteoId", "operacionId") DO NOTHING RETURNING id`;
    return filas[0] ?? null;
  },
  async unidadesDe(conteoId, itemCode, db = prisma) {
    const [fila] = await db.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE "itemCode" = ${itemCode})::int AS producto, COUNT(*)::int AS total
      FROM conteo_lecturas WHERE "conteoId" = ${conteoId}`;
    return fila;
  },
  // Borra la última lectura del conteo (en curso).
  async quitarUltima(conteoId, db = prisma) {
    const filas = await db.$queryRaw`
      DELETE FROM conteo_lecturas WHERE id = (
        SELECT l.id FROM conteo_lecturas l JOIN conteos c ON c.id = l."conteoId"
        WHERE l."conteoId" = ${conteoId} AND c.estado = 'en_curso' ORDER BY l.id DESC LIMIT 1)
      RETURNING "itemCode"`;
    return filas[0] ?? null;
  },
  cerrar(id, datos, db = prisma) {
    return db.conteo.updateMany({ where: { id, estado: "en_curso" }, data: datos });
  },
  async nombres(itemCodes, db = prisma) {
    if (!itemCodes.length) return new Map();
    const filas = await db.producto.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, itemName: true } });
    return new Map(filas.map((f) => [f.itemCode, f.itemName]));
  },
};
