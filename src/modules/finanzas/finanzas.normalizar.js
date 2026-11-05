import { TABLAS_FINANZAS, ENTIDADES_NORMALIZABLES, datosParaTabla, datosDesdeTabla, columna, tipoCampo } from "./finanzas.tablas.js";
import { FINANZAS, snapshotFinanciero, claveRegistro as claveRegistroNormalizado } from "../../shared/finanzas/contratos.js";
import { unidades } from "../../shared/finanzas/decimal.js";
import { Prisma } from "../../../generated/prisma/client.js";

function fallo(code, entidad, detalle) {
  return Object.assign(new Error(`${code}: ${entidad}`), { code, entidad, ...(detalle ? { detalle } : {}) });
}
const esFactura = tipo => ["it_Invoice", "13"].includes(tipo);
export function equivalentes(entidad, a, b) {
  return Object.entries(FINANZAS[entidad].campos).every(([campo, schema]) => {
    if (a[campo] == null || b[campo] == null) return a[campo] === b[campo];
    const esDecimal = schema.safeParse("1.000001").success && !schema.safeParse("texto").success;
    return esDecimal ? unidades(a[campo]) === unidades(b[campo]) : a[campo] === b[campo];
  });
}
async function prepararRelaciones(entidad, registros, tx) {
  const relaciones = {
    facturas: ["cliente", "cardCode", "cardCode"], notasCredito: ["cliente", "cardCode", "cardCode"],
    pagos: ["cliente", "cardCode", "cardCode"], facturaLineas: ["factura", "docEntry", "docEntry"],
    notaCreditoLineas: ["notaCredito", "docEntry", "docEntry"], cuotas: ["factura", "docEntry", "docEntry"],
    aplicacionesPagos: ["pago", "pagoEntry", "docEntry"],
  };
  const relacion = relaciones[entidad];
  if (relacion) {
    const [modelo, origen, destino] = relacion;
    const ids = [...new Set(registros.map(r => r[origen]))];
    const filas = await tx[modelo].findMany({ where: { [destino]: { in: ids } }, select: { [destino]: true } });
    const existentes = new Set(filas.map(f => f[destino]));
    const faltantes = ids.filter(id => !existentes.has(id));
    if (faltantes.length) throw fallo("RELACION_FINANCIERA_FALTANTE", entidad,
      { modelo, campo: destino, faltantes: faltantes.slice(0, 20), totalFaltantes: faltantes.length });
  }
  if (entidad === "aplicacionesPagos") {
    const ids = [...new Set(registros.filter(r => esFactura(r.tipo)).map(r => r.documento))];
    // No se inventan facturas para anticipos u otros tipos de documento.
    return new Set((await tx.factura.findMany({ where: { docEntry: { in: ids } }, select: { docEntry: true } })).map(f => f.docEntry));
  }
  return new Set();
}
// Identificadores exclusivamente del mapa de código; los valores siempre son parámetros.
const identificador = nombre => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nombre)) throw new Error("IDENTIFICADOR_INTERNO_INVALIDO");
  return Prisma.raw(`"${nombre}"`);
};
async function guardarTanda(entidad, registros, version, control, tx, facturas) {
  if (!registros.length) return;
  const tabla = TABLAS_FINANZAS[entidad];
  const tiposSql = { Int: "INTEGER", Decimal: "DECIMAL(24,6)", DateTime: "DATE", String: "TEXT" };
  const tipos = Object.fromEntries(Object.entries(FINANZAS[entidad].campos).map(([campo, schema]) => [columna(entidad, campo), tiposSql[tipoCampo(schema)]]));
  Object.assign(tipos, { finVersion: "UUID", finClave: "TEXT", cardName: "TEXT", valid: "BOOLEAN", frozen: "BOOLEAN",
    sincronizadoEn: "TIMESTAMP(3)", salesEmployeeName: "TEXT", active: "BOOLEAN", cancelled: "BOOLEAN", facturaDocEntry: "INTEGER" });
  const filas = registros.map(r => {
    const datos = datosParaTabla(entidad, r, version);
    let extra = {};
    if (entidad === "clientes") extra = { cardName: r.nombre ?? r.cardCode, valid: r.activo === "Y", frozen: r.bloqueado === "Y", sincronizadoEn: control.iniciadoEn };
    if (entidad === "vendedores") extra = { salesEmployeeName: r.nombre ?? String(r.codigo), active: r.activo === "Y" };
    if (["facturas", "notasCredito", "pagos"].includes(entidad)) extra = { cancelled: r.cancelado !== "N", sincronizadoEn: control.iniciadoEn };
    if (entidad === "aplicacionesPagos") extra = { facturaDocEntry: esFactura(r.tipo) && facturas.has(r.documento) ? r.documento : null };
    return { ...datos, ...extra };
  });
  const columnas = Object.keys(filas[0]);
  const claves = tabla.claves.map(k => columna(entidad, k));
  const valores = filas.map(fila => Prisma.sql`(${Prisma.join(columnas.map(c => {
    const valor = fila[c] instanceof Date ? fila[c].toISOString() : fila[c];
    return Prisma.sql`${valor}::${Prisma.raw(tipos[c])}`;
  }))})`);
  const cambios = columnas.filter(c => !claves.includes(c) && !(entidad === "clientes" && ["cardName", "valid", "frozen", "sincronizadoEn"].includes(c)))
    .map(c => Prisma.sql`${identificador(c)} = EXCLUDED.${identificador(c)}`);
  if (entidad === "clientes") {
    // El histórico financiero no revierte un nombre/estado operativo más reciente.
    for (const c of ["cardName", "valid", "frozen"]) {
      cambios.push(Prisma.sql`${identificador(c)} = CASE
        WHEN destino."sincronizadoEn" <= EXCLUDED."sincronizadoEn"
          ${c === "cardName" ? Prisma.sql`AND EXCLUDED."finNombre" IS NOT NULL` : Prisma.empty}
        THEN EXCLUDED.${identificador(c)} ELSE destino.${identificador(c)} END`);
    }
  }
  await tx.$executeRaw(Prisma.sql`INSERT INTO ${identificador(tabla.nombre)} AS destino
    (${Prisma.join(columnas.map(identificador))}) VALUES ${Prisma.join(valores)}
    ON CONFLICT (${Prisma.join(claves.map(identificador))}) DO UPDATE SET ${Prisma.join(cambios)}`);
}

// Reutilizado por el receptor periódico dentro de SU transacción (JSON + tablas + acuse).
export async function guardarNormalizados(entidad, registros, version, control, tx) {
  const facturas = await prepararRelaciones(entidad, registros, tx);
  await guardarTanda(entidad, registros, version, control, tx, facturas);
  const claves = registros.map(r => claveRegistroNormalizado(entidad, r));
  const filas = await tx[TABLAS_FINANZAS[entidad].modelo].findMany({ where: { finVersion: version, finClave: { in: claves } } });
  const porClave = new Map(filas.map(r => [r.finClave, r]));
  for (const r of registros) {
    const fila = porClave.get(claveRegistroNormalizado(entidad, r));
    if (!fila || !equivalentes(entidad, r, datosDesdeTabla(entidad, fila))) throw fallo("VERIFICACION_FINANCIERA_FALLIDA", entidad);
  }
}

// Una tanda es una transacción: tablas, comprobación y cursor avanzan juntos.
// El mismo bloqueo del ingreso evita que cambie la versión durante la tanda.
export async function normalizarTanda(db, entidad, limite = 50) {
  if (!ENTIDADES_NORMALIZABLES.includes(entidad)) throw fallo("ENTIDAD_NO_NORMALIZABLE", entidad);
  if (!Number.isSafeInteger(limite) || limite < 1 || limite > 200) throw fallo("LIMITE_INVALIDO", entidad);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(20260928, 1001)::text`;
    const c = await tx.finanzaControl.findUnique({ where: { entidad } });
    if (!c?.finalizadoEn || !c.activoId || c.activoId !== c.recorridoId) {
      return { entidad, estado: "esperando_carga", completo: false };
    }
    // No materializar el almacén mutable "actual" como si fuera una instantánea.
    if (!snapshotFinanciero(entidad, c.configuracion)) throw fallo("NORMALIZACION_REQUIERE_SNAPSHOT", entidad);
    const version = c.activoId;
    let avance = await tx.finanzaNormalizacion.findUnique({ where: { entidad } });
    if (avance?.version === version && avance.finalizadoEn) return { entidad, estado: "completo", completo: true, cantidad: avance.cantidad };
    if (avance?.version !== version) {
      avance = await tx.finanzaNormalizacion.upsert({ where: { entidad },
        create: { entidad, version }, update: { version, cursor: null, cantidad: 0, finalizadoEn: null } });
    }
    const where = { entidad, version };
    const filas = await tx.finanzaRegistro.findMany({ where: { ...where, ...(avance.cursor ? { clave: { gt: avance.cursor } } : {}) },
      orderBy: { clave: "asc" }, take: limite });
    const registros = filas.map(f => FINANZAS[entidad].schema.parse(f.datos));
    const facturas = await prepararRelaciones(entidad, registros, tx);
    await guardarTanda(entidad, registros, version, c, tx, facturas);
    const modelo = tx[TABLAS_FINANZAS[entidad].modelo];
    const escritos = await modelo.findMany({ where: { finVersion: version, finClave: { in: filas.map(f => f.clave) } } });
    const porClave = new Map(escritos.map(f => [f.finClave, f]));
    for (const fila of filas) {
      const guardado = porClave.get(fila.clave);
      if (!guardado || !equivalentes(entidad, fila.datos, datosDesdeTabla(entidad, guardado))) {
        throw fallo("VERIFICACION_FINANCIERA_FALLIDA", entidad);
      }
    }
    const cantidad = avance.cantidad + filas.length;
    const completo = filas.length < limite;
    if (completo) {
      const origen = await tx.finanzaRegistro.count({ where });
      const destino = await modelo.count({ where: { finVersion: version } });
      if (cantidad !== origen || destino !== origen) throw fallo("CONTEO_FINANCIERO_DISTINTO", entidad);
    }
    await tx.finanzaNormalizacion.update({ where: { entidad }, data: {
      cursor: filas.at(-1)?.clave ?? avance.cursor, cantidad, finalizadoEn: completo ? new Date() : null,
    } });
    return { entidad, estado: completo ? "completo" : "en_curso", completo, cantidad, recibidos: filas.length };
  }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 30000 });
}
