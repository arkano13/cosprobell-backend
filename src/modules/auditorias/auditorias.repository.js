// Consultas de las auditorías de bodega. Las lecturas se agregan por producto al consultar.
import { prisma } from "../../infrastructure/database/prisma.js";

const aMapa = (filas, campo = "unidades") => new Map(filas.map((f) => [f.itemCode, Number(f[campo])]));

export const auditoriasRepository = {
  almacenes(db = prisma) {
    return db.bodega.findMany({ where: { inactive: false }, select: { warehouseCode: true, warehouseName: true },
      orderBy: { warehouseCode: "asc" } });
  },
  // Por almacén: la auditoría en curso (con lo escaneado hasta ahora) y la última terminada.
  async estadoPorAlmacen(db = prisma) {
    const [enCurso, terminadas] = await Promise.all([
      db.$queryRaw`
        SELECT a.id, a.almacen, a."iniciadaPor", a."iniciadaEn", COUNT(l.id)::int AS unidades,
               COUNT(DISTINCT l."hechoPor")::int AS personas
        FROM auditorias a LEFT JOIN auditoria_lecturas l ON l."auditoriaId" = a.id
        WHERE a.estado = 'en_curso' GROUP BY a.id`,
      db.$queryRaw`
        SELECT DISTINCT ON (almacen) id, almacen, "terminadaEn" FROM auditorias
        WHERE estado = 'terminada' ORDER BY almacen, "terminadaEn" DESC`,
    ]);
    return { enCurso, terminadas };
  },
  async crear(almacen, iniciadaPor, db = prisma) {
    try {
      return await db.auditoriaBodega.create({ data: { almacen, iniciadaPor } });
    } catch (error) {
      if (error?.code === "P2002") return null;
      throw error;
    }
  },
  buscar(id, db = prisma) {
    return db.auditoriaBodega.findUnique({ where: { id } });
  },
  terminadas({ almacen = null, limit = 20 } = {}, db = prisma) {
    return db.auditoriaBodega.findMany({ where: { estado: "terminada", ...(almacen ? { almacen } : {}) },
      select: { id: true, almacen: true, iniciadaPor: true, iniciadaEn: true, terminadaPor: true, terminadaEn: true },
      orderBy: { terminadaEn: "desc" }, take: limit });
  },
  // Lo escaneado, producto por producto, con quién escaneó.
  async escaneado(auditoriaId, db = prisma) {
    const [productos, personas] = await Promise.all([
      db.$queryRaw`
        SELECT l."itemCode", COALESCE(p."itemName", l."itemCode") AS "itemName", COUNT(*)::int AS unidades,
               MAX(l.id) AS "ultimaLectura"
        FROM auditoria_lecturas l LEFT JOIN productos p ON p."itemCode" = l."itemCode"
        WHERE l."auditoriaId" = ${auditoriaId} GROUP BY l."itemCode", p."itemName" ORDER BY "ultimaLectura" DESC`,
      db.$queryRaw`SELECT DISTINCT "hechoPor" FROM auditoria_lecturas WHERE "auditoriaId" = ${auditoriaId} AND "hechoPor" IS NOT NULL`,
    ]);
    return { productos: productos.map(({ ultimaLectura, ...p }) => p), personas: personas.map((p) => p.hechoPor) };
  },
  // Una lectura; la misma operación otra vez no suma (devuelve null).
  async agregarLectura({ auditoriaId, operacionId, codigo, itemCode, hechoPor }, db = prisma) {
    const filas = await db.$queryRaw`
      INSERT INTO auditoria_lecturas ("auditoriaId", "operacionId", codigo, "itemCode", "hechoPor")
      SELECT ${auditoriaId}, ${operacionId}, ${codigo}, ${itemCode}, ${hechoPor}
      WHERE EXISTS (SELECT 1 FROM auditorias WHERE id = ${auditoriaId} AND estado = 'en_curso')
      ON CONFLICT ("auditoriaId", "operacionId") DO NOTHING RETURNING id`;
    return filas[0] ?? null;
  },
  async unidadesDe(auditoriaId, itemCode, db = prisma) {
    const [fila] = await db.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE "itemCode" = ${itemCode})::int AS producto, COUNT(*)::int AS total
      FROM auditoria_lecturas WHERE "auditoriaId" = ${auditoriaId}`;
    return fila;
  },
  // Borra la última lectura de esa persona en la auditoría.
  async quitarUltima(auditoriaId, hechoPor, db = prisma) {
    const filas = await db.$queryRaw`
      DELETE FROM auditoria_lecturas WHERE id = (
        SELECT id FROM auditoria_lecturas WHERE "auditoriaId" = ${auditoriaId} AND "hechoPor" IS NOT DISTINCT FROM ${hechoPor}
        ORDER BY id DESC LIMIT 1)
      RETURNING "itemCode"`;
    return filas[0] ?? null;
  },
  cerrar(id, datos, db = prisma) {
    return db.auditoriaBodega.updateMany({ where: { id, estado: "en_curso" }, data: datos });
  },
  async nombres(itemCodes, db = prisma) {
    if (!itemCodes.length) return new Map();
    const filas = await db.producto.findMany({ where: { itemCode: { in: itemCodes } }, select: { itemCode: true, itemName: true } });
    return new Map(filas.map((f) => [f.itemCode, f.itemName]));
  },
  // Lo que la app tiene en cada tipo de bodega.
  async appGrande(db = prisma) {
    return aMapa(await db.$queryRaw`
      SELECT "itemCode", SUM(unidades)::int AS unidades FROM inventario_cajas GROUP BY "itemCode" HAVING SUM(unidades) <> 0`);
  },
  async appPequena(db = prisma) {
    return aMapa(await db.$queryRaw`SELECT "itemCode", pequena AS unidades FROM inventario_productos WHERE pequena <> 0`);
  },
  async appConteo(almacen, db = prisma) {
    return aMapa(await db.$queryRaw`
      SELECT "itemCode", unidades FROM inventario_conteos_almacen WHERE almacen = ${almacen} AND unidades <> 0`);
  },
  // Lo que SAP tiene en el almacén; null si el puente no manda existencias de ese almacén.
  async sap(almacen, alcance, db = prisma) {
    const filas = await db.$queryRaw`
      SELECT "itemCode", SUM("inStock")::float AS unidades FROM productos_existencias WHERE "warehouseCode" = ${almacen}
      GROUP BY "itemCode"`;
    const disponible = alcance.length ? alcance.includes(almacen) : filas.length > 0;
    return disponible ? aMapa(filas.filter((f) => Number(f.unidades) !== 0)) : null;
  },
};
