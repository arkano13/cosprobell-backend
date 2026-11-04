import { TABLAS_FINANZAS, columna, datosDesdeTabla } from "./finanzas.tablas.js";
import { FINANZAS } from "../../shared/finanzas/contratos.js";
import { AppError } from "../../shared/errors/AppError.js";

// Marcador y filas se leen en una misma instantánea PostgreSQL. Si empieza otra
// conversión, una consulta nunca mezcla sus filas con la versión anterior.
export async function lecturaTablas(db, where, operacion, take) {
  const { entidad, version, clave, ...filtros } = where;
  const tabla = TABLAS_FINANZAS[entidad];
  if (!tabla || version === "actual" || Object.keys(filtros).some(k => !FINANZAS[entidad].campos[k])) return null;
  const avance = await db.finanzaNormalizacion.findUnique({ where: { entidad } });
  if (avance?.version !== version || !avance.finalizadoEn) return null;
  const normalizado = { finVersion: version, ...(clave ? { finClave: clave } : {}),
    ...Object.fromEntries(Object.entries(filtros).map(([k, v]) => [columna(entidad, k), v])) };
  const modelo = db[tabla.modelo];
  if (operacion === "sumar") return modelo.aggregate({ where: normalizado, _sum: { debe: true, haber: true } });
  const filas = await modelo.findMany({ where: normalizado, orderBy: { finClave: "asc" }, take });
  return filas.map(fila => ({ clave: fila.finClave, datos: datosDesdeTabla(entidad, fila) }));
}

export function leerFinanzas(db, where, operacion, take) {
  return db.$transaction(async tx => {
    const normalizado = await lecturaTablas(tx, where, operacion, take);
    if (normalizado !== null) return normalizado;
    return operacion === "sumar"
      ? tx.finanzaRegistro.aggregate({ where, _sum: { debe: true, haber: true } })
      : tx.finanzaRegistro.findMany({ where, orderBy: { clave: "asc" }, take });
  }, { isolationLevel: "RepeatableRead", timeout: 10000 });
}

// Las rutas anteriores también deben evitar mostrar una conversión parcial.
export function leerLegadoFinanciero(db, entidades, consultar) {
  return db.$transaction(async tx => {
    const versiones = {};
    for (const entidad of entidades) {
      const c = await tx.finanzaControl.findUnique({ where: { entidad } });
      const n = await tx.finanzaNormalizacion.findUnique({ where: { entidad } });
      if (!c?.activoId || !n?.finalizadoEn || n.version !== c.activoId) {
        throw new AppError({ code: "FINANZAS_TABLAS_PENDIENTES", message: "Esta información aún no terminó su conversión a tablas", statusCode: 503 });
      }
      versiones[entidad] = c.activoId;
    }
    return consultar(tx, versiones);
  }, { isolationLevel: "RepeatableRead", timeout: 10000 });
}
