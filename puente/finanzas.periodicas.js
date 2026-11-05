import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { configurarFinanzas } from "./finanzas.config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";
import { tomarCandado } from "./candado.js";
import { clienteBackendFinanzas } from "./finanzas.backend.js";
import { definicionesGetFinanzas, convertirDocumentoGet, leerJsonFinancieroGet } from "./finanzas.get.js";
import { transformarFinanzas } from "./finanzas.transformar.js";
import { ErrorPuente } from "./http.js";
import { GRUPOS_FINANCIEROS, actualizacionFinancieraSchema } from "../src/shared/finanzas/periodicas.js";

const documentos = ["facturas", "notasCredito", "pagos", "movimientos"];
const catalogos = ["empresa", "clientes", "vendedores", "condicionesPago"];
const enc = x => encodeURIComponent(x).replaceAll("'", "%27");
const literal = x => typeof x === "number" ? String(x) : `'${x.replaceAll("'", "''")}'`;
const fechaVentana = x => new Date(Date.parse(x) - 2 * 86400000).toISOString().slice(0, 10);
const fallo = codigo => { throw new ErrorPuente(codigo); };

export function configurarPeriodicas(v) {
  const config = configurarFinanzas(v);
  if (!isAbsolute(v.BRIDGE_STATE_DIR ?? "")) fallo("STATE_DIR_ABSOLUTO_REQUERIDO");
  const segundos = Number(v.BRIDGE_FINANCE_PERIODIC_MAX_SECONDS ?? 25);
  const consultas = Number(v.BRIDGE_FINANCE_PERIODIC_MAX_REQUESTS ?? 8);
  if (!Number.isInteger(segundos) || segundos < 10 || segundos > 60 || !Number.isInteger(consultas) || consultas < 1 || consultas > 35) fallo("PRESUPUESTO_PERIODICO_INVALIDO");
  const frecuencias = { empresa: 86400, clientes: 21600, vendedores: 21600, condicionesPago: 21600,
    facturas: 3600, notasCredito: 3600, pagos: 3600, movimientos: 3600 };
  const personalizadas = JSON.parse(v.BRIDGE_FINANCE_PERIODIC_FREQUENCIES_JSON ?? "{}");
  if (!personalizadas || Array.isArray(personalizadas) || Object.entries(personalizadas).some(([g, s]) =>
    !Object.hasOwn(frecuencias, g) || !Number.isInteger(s) || s < 900 || s > 2592000)) fallo("FRECUENCIAS_PERIODICAS_INVALIDAS");
  return { ...config, frecuenciasPeriodicas: { ...frecuencias, ...personalizadas }, maxConsultas: consultas, maxDuracionMs: segundos * 1000 };
}

async function abrirEstadoPeriodico(config) {
  await mkdir(config.directorio, { recursive: true });
  const archivo = join(config.directorio, "finanzas-periodicas.json");
  let estado;
  try { estado = JSON.parse(await readFile(archivo, "utf8")); } catch (e) { if (e.code !== "ENOENT") fallo("ESTADO_PERIODICO_INVALIDO"); }
  estado ??= { version: 1, origen: config.origen, grupos: {}, pendiente: null };
  if (estado.version !== 1 || estado.origen !== config.origen || !estado.grupos || typeof estado.grupos !== "object" || Array.isArray(estado.grupos) ||
      estado.pendiente && !actualizacionFinancieraSchema.safeParse(estado.pendiente.cuerpo).success) fallo("ESTADO_PERIODICO_INVALIDO");
  return { estado, async guardar() {
    const temporal = `${archivo}.${randomUUID()}.tmp`;
    try { await writeFile(temporal, JSON.stringify(estado), { flag: "wx", mode: 0o600 }); await rename(temporal, archivo); }
    finally { await unlink(temporal).catch(e => { if (e.code !== "ENOENT") throw e; }); }
  } };
}

export function comprobarBasePeriodica(base, config) {
  if (base?.protocolo !== 1 || base.listo !== true || base.empresa !== config.empresa || base.desde !== config.desde ||
      base.monedaLocal !== config.monedaLocal || base.monedaSistema !== config.monedaSistema || !base.versiones || !base.maximos || !base.ultimaLectura) fallo("BASE_FINANCIERA_INCOMPATIBLE");
  for (const g of documentos) if (!Number.isSafeInteger(base.maximos[g]) || base.maximos[g] < -1) fallo("BASE_FINANCIERA_INCOMPATIBLE");
  for (const e of Object.values(GRUPOS_FINANCIEROS).flat()) if (!/^[a-f0-9-]{36}$/i.test(base.versiones[e] ?? "") || !Number.isFinite(Date.parse(base.ultimaLectura[e]))) fallo("BASE_FINANCIERA_INCOMPATIBLE");
}

function camposGrupo(defs, grupo) {
  return [...new Set(GRUPOS_FINANCIEROS[grupo].flatMap(e => {
    const d = defs[e]; return [...d.campos, ...(d.adicionales ?? []), ...(d.coleccion ? [d.coleccion] : [])];
  }))];
}
export function paquetePeriodico(defs, grupo, dato, config, base) {
  const datos = Array.isArray(dato) ? dato : [dato];
  const registros = Object.fromEntries(GRUPOS_FINANCIEROS[grupo].map(e => [e, transformarFinanzas(e, datos.flatMap(d => convertirDocumentoGet(defs[e], d)), null)]));
  const cuerpo = { protocolo: 1, operacionId: randomUUID(), empresa: config.empresa, grupo,
    monedaLocal: config.monedaLocal, monedaSistema: config.monedaSistema,
    versiones: Object.fromEntries(Object.keys(registros).map(e => [e, base.versiones[e]])), registros };
  if (!actualizacionFinancieraSchema.safeParse(cuerpo).success) fallo("ACTUALIZACION_FINANCIERA_INVALIDA");
  if (Buffer.byteLength(JSON.stringify(cuerpo)) > 950000) fallo("DOCUMENTO_FINANCIERO_DEMASIADO_GRANDE");
  return cuerpo;
}

export async function ejecutarPeriodicas({ config, informar = d => console.log(JSON.stringify(d)), comprobar = false,
  detener = () => false, crearSap = crearClienteSap, crearBackend = clienteBackendFinanzas }) {
  let liberar, sap;
  try {
    liberar = await tomarCandado(join(config.directorio, "ejecucion.lock"));
    const backend = crearBackend(config);
    const base = await backend("actualizacion", "estado");
    comprobarBasePeriodica(base, config);
    if (comprobar) { informar({ evento: "finanzas_periodicas_listas", protocolo: 1, normalizadas: 12 }); return; }
    const almacen = await abrirEstadoPeriodico(config), s = almacen.estado;
    const firma = JSON.stringify(base.versiones);
    // Nunca descartar un documento pendiente para cambiar silenciosamente de versión base.
    if (s.firma && s.firma !== firma && s.pendiente) fallo("VERSION_FINANCIERA_CAMBIO");
    if (s.firma !== firma) { s.grupos = {}; s.firma = firma; await almacen.guardar(); }
    const defs = definicionesGetFinanzas(config);
    config.control = crearControl(config);
    sap = crearSap(config);
    const terminarPendiente = async () => {
      if (!s.pendiente) return;
      const p = s.pendiente;
      let r;
      try { r = await backend("actualizacion", "documento", p.cuerpo); }
      catch (e) {
        // Un cliente creado después del histórico debe llegar antes de su documento.
        if (e.detalle?.codigoBackend !== "RELACION_FINANCIERA_FALTANTE" || p.cuerpo.registros.clientes || p.cuerpo.grupo === "movimientos") throw e;
        const cliente = p.cuerpo.registros[p.cuerpo.grupo][0].cardCode;
        const d = defs.clientes;
        const encontrado = await sap.leerRecursoFinanciero(`BusinessPartners?$select=${[...d.campos, ...d.adicionales].join(",")}&$top=1&$filter=${enc(`CardCode eq ${literal(cliente)} and CardType eq 'cCustomer'`)}`, leerJsonFinancieroGet);
        if (encontrado.value?.length !== 1 || encontrado.value[0].CardCode !== cliente) fallo("CLIENTE_FINANCIERO_NO_DISPONIBLE");
        const dato = encontrado.value[0];
        p.cuerpo.registros.clientes = transformarFinanzas("clientes", convertirDocumentoGet(d, dato), null);
        p.cuerpo.versiones.clientes = base.versiones.clientes;
        await almacen.guardar();
        r = await backend("actualizacion", "documento", p.cuerpo);
      }
      if (r.operacionId !== p.cuerpo.operacionId || r.normalizado !== true) fallo("CONFIRMACION_INVALIDA");
      Object.assign(s.grupos[p.grupo], p.avance);
      s.pendiente = null; await almacen.guardar();
      informar({ evento: "documento_financiero_actualizado", grupo: p.grupo, cambios: r.cambios, repetido: r.repetido });
    };
    await terminarPendiente();
    for (const grupo of [...documentos, ...catalogos]) {
      s.grupos[grupo] ??= { nuevo: base.maximos[grupo] ?? null, cursor: null, ultimoCompleto: null, ultimaAtencion: null,
        ventana: fechaVentana(base.ultimaLectura[grupo]) };
    }
    const leer = async (grupo, modo) => {
      if (detener()) return;
      config.control.comprobarTurno();
      const g = s.grupos[grupo], d = defs[grupo];
      if (grupo === "empresa") {
        const cuerpo = { protocolo: 1, operacionId: randomUUID(), empresa: config.empresa, grupo,
          monedaLocal: config.monedaLocal, monedaSistema: config.monedaSistema,
          versiones: { empresa: base.versiones.empresa }, registros: { empresa: [{ codigo: "empresa", monedaLocal: config.monedaLocal, monedaSistema: config.monedaSistema }] } };
        s.pendiente = { cuerpo, grupo, avance: { ultimoCompleto: new Date().toISOString(), ultimaAtencion: new Date().toISOString() } };
        await almacen.guardar(); await terminarPendiente(); return;
      }
      if (modo === "cambios" && documentos.includes(grupo) && g.cambiosDisponibles === undefined) {
        try {
          await sap.leerRecursoFinanciero(`${d.recurso}?$select=${d.clave},UpdateDate&$top=1&$filter=${enc(`UpdateDate ge '${g.ventana}'`)}`, leerJsonFinancieroGet);
          g.cambiosDisponibles = true;
        } catch (e) {
          if (e.code !== "HTTP_400") throw e;
          g.cambiosDisponibles = false;
          informar({ evento: "revision_historica_financiera", grupo, motivo: "SAP_SIN_FILTRO_UPDATE_DATE", acotadaPorPresupuesto: true });
        }
        await almacen.guardar();
      }
      const cursor = modo === "nuevos" ? g.nuevo : g.cursor;
      const filtros = [d.filtro, cursor != null ? `${d.clave} gt ${literal(cursor)}` : null,
        d.historico ? `DocDate ge '${config.desde}'` : null,
        modo === "cambios" && g.cambiosDisponibles ? `UpdateDate ge '${g.ventana}'` : null].filter(Boolean);
      const tamano = catalogos.includes(grupo) ? 20 : 1;
      const ruta = `${d.recurso}?$select=${camposGrupo(defs, grupo).join(",")}&$orderby=${enc(d.clave + " asc")}&$top=${tamano}` +
        (filtros.length ? `&$filter=${enc(filtros.map(f => `(${f})`).join(" and "))}` : "");
      const datos = await sap.leerRecursoFinanciero(ruta, leerJsonFinancieroGet);
      if (!Array.isArray(datos.value) || datos.value.length > tamano || !datos.value.length && (datos["odata.nextLink"] || datos["@odata.nextLink"])) fallo("PAGINA_SAP_INVALIDA");
      const ahora = new Date().toISOString();
      if (modo !== "nuevos") g.ultimaAtencion = ahora;
      if (!datos.value.length) {
        if (modo !== "nuevos") { g.cursor = null; g.ultimoCompleto = ahora; g.ventana = fechaVentana(g.iniciadoEn ?? ahora); g.iniciadoEn = null; }
        await almacen.guardar(); return false;
      }
      const dato = datos.value[0], id = datos.value.at(-1)[d.clave];
      if (!(typeof id === "string" && id.length || Number.isSafeInteger(id)) || cursor != null &&
        (id === cursor || typeof id === "number" && id < cursor)) fallo("PAGINACION_SIN_AVANCE");
      if (modo !== "nuevos") g.iniciadoEn ??= ahora;
      const cuerpo = paquetePeriodico(defs, grupo, catalogos.includes(grupo) ? datos.value : dato, config, base);
      s.pendiente = { cuerpo, grupo, avance: { [modo === "nuevos" ? "nuevo" : "cursor"]: id,
        ...(modo === "nuevos" ? {} : { ultimaAtencion: ahora }) } };
      await almacen.guardar(); await terminarPendiente(); return true;
    };
    // Una lectura de novedades por documento en cada ejecución: los catálogos y
    // revisiones de históricos no pueden ocultar una factura nueva al final de la cola.
    for (const grupo of documentos) { if (detener()) break; await leer(grupo, "nuevos"); }
    const cola = Object.keys(s.grupos).filter(grupo => {
      const g = s.grupos[grupo]; return !g.ultimoCompleto || g.cursor != null || Date.now() - Date.parse(g.ultimoCompleto) >= config.frecuenciasPeriodicas[grupo] * 1000;
    }).sort((a, b) => Date.parse(s.grupos[a].ultimaAtencion ?? "1970-01-01") - Date.parse(s.grupos[b].ultimaAtencion ?? "1970-01-01"));
    while (cola.length && !detener()) { const grupo = cola.shift(); if (await leer(grupo, "cambios")) cola.push(grupo); }
    informar({ evento: "resumen_finanzas_periodicas", ...config.control.resumen() });
  } catch (e) {
    if (["PRESUPUESTO_AGOTADO", "PUENTE_YA_BLOQUEADO"].includes(e.code)) {
      informar({ evento: "finanzas_periodicas_pausadas", codigo: e.code, ...config.control?.resumen() }); return;
    }
    throw e;
  } finally { await sap?.cerrar().catch(() => informar({ evento: "logout_no_confirmado" })); await liberar?.(); }
}
