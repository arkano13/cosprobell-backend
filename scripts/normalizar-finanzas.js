import { pathToFileURL } from "node:url";
import { ENTIDADES_NORMALIZABLES } from "../src/modules/finanzas/finanzas.tablas.js";
import { normalizarTanda } from "../src/modules/finanzas/finanzas.normalizar.js";

const argumentoInvalido = codigo => Object.assign(new Error(codigo), { code: codigo });
export function opcionesNormalizacion(args) {
  const valores = {};
  for (const arg of args) {
    const m = /^(--estado|--aplicar|--una-tanda|--entidad=[A-Za-z]+|--lote=\d+)$/.exec(arg);
    if (!m) throw argumentoInvalido("ARGUMENTO_INVALIDO");
    const [clave, valor = true] = arg.slice(2).split("=");
    if (Object.hasOwn(valores, clave)) throw argumentoInvalido("ARGUMENTO_REPETIDO");
    valores[clave] = valor;
  }
  if (Boolean(valores.estado) === Boolean(valores.aplicar)) throw argumentoInvalido("INDIQUE_ESTADO_O_APLICAR");
  const entidad = valores.entidad;
  if (entidad && !ENTIDADES_NORMALIZABLES.includes(entidad)) throw argumentoInvalido("ENTIDAD_NO_NORMALIZABLE");
  const limite = Number(valores.lote ?? 50);
  if (!Number.isSafeInteger(limite) || limite < 1 || limite > 200) throw argumentoInvalido("LIMITE_INVALIDO");
  if (valores.estado && (valores['una-tanda'] || valores.lote)) throw argumentoInvalido("ESTADO_NO_ACEPTA_TANDAS");
  return { estado: Boolean(valores.estado), unaTanda: Boolean(valores['una-tanda']), limite,
    entidades: entidad ? [entidad] : ENTIDADES_NORMALIZABLES };
}

// No imprimir mensajes/stack de Prisma: pueden contener SQL, parámetros o URLs.
export function resumenErrorNormalizacion(error, entidad) {
  const campos = Array.isArray(error?.issues) ? [...new Set(error.issues.map(i =>
    i.path?.filter(p => typeof p === "string" && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(p)).join(".")).filter(Boolean))].slice(0, 20) : [];
  const codigo = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code
    : campos.length ? "CONTRATO_FINANCIERO_INVALIDO" : "NORMALIZACION_INVALIDA";
  const tipo = ["Error", "ZodError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError",
    "PrismaClientInitializationError", "PrismaClientRustPanicError"].includes(error?.name) ? error.name : "Error";
  return { evento: "normalizacion_fallida", codigo, tipo,
    ...(ENTIDADES_NORMALIZABLES.includes(error?.entidad ?? entidad) ? { entidad: error?.entidad ?? entidad } : {}),
    ...(error?.detalle && error.code === "RELACION_FINANCIERA_FALTANTE" ? { detalle: error.detalle } : {}),
    ...(campos.length ? { camposInvalidos: campos } : {}) };
}

async function principal() {
  let prisma, entidadEnCurso;
  try {
    const opciones = opcionesNormalizacion(process.argv.slice(2));
    ({ prisma } = await import("../src/infrastructure/database/prisma.js"));
    if (opciones.estado) {
      for (const entidad of opciones.entidades) {
        entidadEnCurso = entidad;
        const [c, n] = await Promise.all([
          prisma.finanzaControl.findUnique({ where: { entidad } }),
          prisma.finanzaNormalizacion.findUnique({ where: { entidad } }),
        ]);
        console.log(JSON.stringify({ evento: "estado_normalizacion", entidad,
          cargaCompleta: Boolean(c?.finalizadoEn), convertidos: n?.cantidad ?? 0,
          completo: Boolean(n?.finalizadoEn && n.version === c?.activoId), version: n?.version ?? null }));
      }
      return;
    }
    let interrumpido = false;
    const parar = () => { interrumpido = true; };
    process.on("SIGINT", parar);
    process.on("SIGTERM", parar);
    let todas = true;
    try {
      for (const entidad of opciones.entidades) {
        entidadEnCurso = entidad;
        let r;
        do {
          if (interrumpido) { todas = false; break; }
          r = await normalizarTanda(prisma, entidad, opciones.limite);
          console.log(JSON.stringify({ evento: "normalizacion_financiera", ...r }));
          if (r.estado === "esperando_carga") break;
          // Libera el bloqueo entre tandas para la sincronización operativa.
          if (!r.completo && !opciones.unaTanda) await new Promise(resolve => setTimeout(resolve, 100));
        } while (!r.completo && !opciones.unaTanda);
        if (!r?.completo) todas = false;
        if (interrumpido) break;
      }
      console.log(JSON.stringify({ evento: "normalizacion_fin", completo: todas, interrumpido }));
      if (!todas) process.exitCode = 2;
    } finally {
      process.off("SIGINT", parar);
      process.off("SIGTERM", parar);
    }
  } catch (e) {
    console.error(JSON.stringify(resumenErrorNormalizacion(e, entidadEnCurso)));
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();
