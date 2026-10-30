// Auditoría de bodega: el supervisor la inicia en un almacén, los operadores escanean todo lo que hay unidad por unidad
// (sin lotes, vencimientos ni códigos de caja) y al terminar se compara con la app y con SAP. Solo informa: no mueve
// inventario. Mientras está en curso no se muestra lo que dice el sistema, para no contar "hasta llegar al número".
import { AppError } from "../../shared/errors/AppError.js";
import env from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { resolverEtiquetaParaPicking } from "../picking/picking.etiquetas.service.js";
import { almacenesPorBodega, guardadosSoloConteo } from "../inventario/inventario.service.js";
import { inventarioRepository } from "../inventario/inventario.repository.js";
import { auditoriasRepository as repo } from "./auditorias.repository.js";
import { armarResultado } from "./auditorias.calculo.js";

const falla = (code, statusCode, message) => new AppError({ code, statusCode, message });
const persona = (quien) => quien?.replace(/^operador:/, "") ?? null;

// Qué es cada almacén para la auditoría: la grande (01) y la pequeña (02) de la app, uno "solo conteo" (03, 04) u otro
// que la app no lleva (solo se compara con SAP).
async function tipos() {
  const [porBodega, soloConteo] = await Promise.all([almacenesPorBodega(), guardadosSoloConteo()]);
  const mapa = new Map(soloConteo.map((a) => [a.almacen, "conteo"]));
  if (porBodega.pequena) mapa.set(porBodega.pequena, "pequena");
  if (porBodega.grande) mapa.set(porBodega.grande, "grande");
  return mapa;
}
const ORDEN = { grande: 0, pequena: 1, conteo: 2, otro: 3 };

export async function listarAlmacenes() {
  const [almacenes, porTipo, { enCurso, terminadas }] = await Promise.all([repo.almacenes(), tipos(), repo.estadoPorAlmacen()]);
  // Con INVENTARIO_SAP_WAREHOUSES, solo esos almacenes (los que manda el puente) y los que la app lleva.
  const alcance = env.inventarioSapWarehouses ?? [];
  const curso = new Map(enCurso.map((a) => [a.almacen, a]));
  const ultima = new Map(terminadas.map((a) => [a.almacen, a]));
  const data = almacenes.filter((a) => !alcance.length || alcance.includes(a.warehouseCode) || porTipo.has(a.warehouseCode)).map((a) => {
    const tipo = porTipo.get(a.warehouseCode) ?? "otro";
    const c = curso.get(a.warehouseCode), u = ultima.get(a.warehouseCode);
    return { almacen: a.warehouseCode, nombre: a.warehouseName, tipo, comparaApp: tipo !== "otro",
      enCurso: c ? { id: c.id, iniciadaPor: persona(c.iniciadaPor), iniciadaEn: c.iniciadaEn, unidades: c.unidades, personas: c.personas } : null,
      ultima: u ? { id: u.id, terminadaEn: u.terminadaEn } : null };
  }).sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo] || a.almacen.localeCompare(b.almacen));
  return { data };
}

export async function iniciar({ almacen }, { aplicacion }) {
  const existe = (await repo.almacenes()).some((a) => a.warehouseCode === almacen);
  if (!existe) throw falla("ALMACEN_NO_ENCONTRADO", 404, `No existe el almacén ${almacen} en SAP`);
  const creada = await repo.crear(almacen, aplicacion);
  if (!creada) throw falla("AUDITORIA_EN_CURSO", 409, `Ya hay una auditoría en curso en la ${almacen}: unite a esa`);
  return { data: vistaAuditoria(creada) };
}

const vistaAuditoria = (a) => ({ id: a.id, almacen: a.almacen, estado: a.estado, iniciadaPor: persona(a.iniciadaPor),
  iniciadaEn: a.iniciadaEn, terminadaPor: persona(a.terminadaPor), terminadaEn: a.terminadaEn });

async function exigir(id) {
  const a = await repo.buscar(id);
  if (!a) throw falla("AUDITORIA_NO_ENCONTRADA", 404, "No existe esa auditoría");
  return a;
}
async function exigirEnCurso(id) {
  const a = await exigir(id);
  if (a.estado !== "en_curso") throw falla("AUDITORIA_CERRADA", 409, a.estado === "terminada"
    ? "Esa auditoría ya terminó" : "Esa auditoría se anuló");
  return a;
}

// Lo que se espera encontrar, como las líneas de un pedido: en los almacenes que la app lleva, lo que dice la app; en los
// demás, lo que dice SAP (null si el puente no manda sus existencias).
async function esperado(almacen) {
  const tipo = (await tipos()).get(almacen) ?? "otro";
  if (tipo === "grande") return { fuente: "app", mapa: await repo.appGrande() };
  if (tipo === "pequena") return { fuente: "app", mapa: await repo.appPequena() };
  if (tipo === "conteo") return { fuente: "app", mapa: await repo.appConteo(almacen) };
  const sap = await repo.sap(almacen, env.inventarioSapWarehouses ?? []);
  return { fuente: sap ? "sap" : null, mapa: sap ?? new Map() };
}

// Lo escaneado hasta ahora y lo que se espera de cada producto (esperadas), como las líneas de un pedido. Entran los
// productos esperados y los escaneados que no se esperaban (esperadas 0).
export async function consultar(id) {
  const a = await exigir(id);
  const [{ productos, personas }, { fuente, mapa }] = await Promise.all([repo.escaneado(id), esperado(a.almacen)]);
  const escaneado = new Map(productos.map((p) => [p.itemCode, p]));
  const faltan = [...mapa.keys()].filter((c) => !escaneado.has(c) && mapa.get(c) > 0);
  const nombres = await repo.nombres(faltan);
  const lineas = [...productos.map((p) => ({ ...p, esperadas: Math.max(0, Math.round(mapa.get(p.itemCode) ?? 0)) })),
    ...faltan.map((c) => ({ itemCode: c, itemName: nombres.get(c) ?? c, unidades: 0, esperadas: Math.round(mapa.get(c)) }))];
  return { data: { ...vistaAuditoria(a), personas: personas.map(persona), fuente,
    unidades: productos.reduce((t, p) => t + p.unidades, 0), esperadas: lineas.reduce((t, l) => t + l.esperadas, 0),
    productos: lineas } };
}

export async function escanear(id, { codigo, operacionId }, { aplicacion }) {
  await exigirEnCurso(id);
  const etiqueta = await resolverEtiquetaParaPicking(codigo, prisma);
  const agregada = await repo.agregarLectura({ auditoriaId: id, operacionId, codigo: codigo.trim(), itemCode: etiqueta.itemCode,
    hechoPor: aplicacion });
  if (!agregada) {
    // La misma operación otra vez (reintento) no suma; si la auditoría se cerró en el medio, se avisa.
    const a = await repo.buscar(id);
    if (a?.estado !== "en_curso") throw falla("AUDITORIA_CERRADA", 409, "Esa auditoría ya terminó");
  }
  const [unidades, nombres] = await Promise.all([repo.unidadesDe(id, etiqueta.itemCode), repo.nombres([etiqueta.itemCode])]);
  return { data: { itemCode: etiqueta.itemCode, itemName: nombres.get(etiqueta.itemCode) ?? etiqueta.itemCode,
    unidadesProducto: unidades.producto, unidades: unidades.total, repetida: !agregada } };
}

export async function quitarUltima(id, { aplicacion }) {
  await exigirEnCurso(id);
  const quitada = await repo.quitarUltima(id, aplicacion);
  if (!quitada) throw falla("SIN_LECTURAS", 409, "No tenés lecturas para quitar en esta auditoría");
  const [unidades, nombres] = await Promise.all([repo.unidadesDe(id, quitada.itemCode), repo.nombres([quitada.itemCode])]);
  return { data: { itemCode: quitada.itemCode, itemName: nombres.get(quitada.itemCode) ?? quitada.itemCode,
    unidadesProducto: unidades.producto, unidades: unidades.total } };
}

// Lo que la app y SAP dicen de ese almacén, en el momento de terminar.
async function comparar(almacen) {
  const tipo = (await tipos()).get(almacen) ?? "otro";
  const [app, sap, existenciasSapAl] = await Promise.all([
    tipo === "grande" ? repo.appGrande() : tipo === "pequena" ? repo.appPequena() : tipo === "conteo" ? repo.appConteo(almacen) : null,
    repo.sap(almacen, env.inventarioSapWarehouses ?? []),
    inventarioRepository.existenciasSapAl(),
  ]);
  if (sap && tipo === "pequena") {
    // SAP ya descontó lo facturado sin preparar (sigue en la bodega) y todavía cuenta lo preparado sin entregar (ya salió).
    for (const d of await inventarioRepository.diferido()) {
      const ajuste = Number(d.porPreparar) - Number(d.sinEntrega);
      if (ajuste) sap.set(d.itemCode, (sap.get(d.itemCode) ?? 0) + ajuste);
    }
  }
  return { tipo, app, sap, existenciasSapAl };
}

export async function terminar(id, { aplicacion }) {
  const a = await exigirEnCurso(id);
  const { productos, personas } = await repo.escaneado(id);
  const { tipo, app, sap, existenciasSapAl } = await comparar(a.almacen);
  const escaneado = new Map(productos.map((p) => [p.itemCode, p.unidades]));
  const codigos = [...new Set([...escaneado.keys(), ...(app?.keys() ?? []), ...(sap?.keys() ?? [])])];
  const nombres = await repo.nombres(codigos);
  const resultado = { tipo, personas: personas.map(persona), existenciasSapAl,
    ...armarResultado({ escaneado, app, sap, nombres }) };
  const { count } = await repo.cerrar(id, { estado: "terminada", terminadaPor: aplicacion, terminadaEn: new Date(), resultado });
  if (!count) throw falla("AUDITORIA_CERRADA", 409, "Esa auditoría ya se cerró");
  return { data: { ...vistaAuditoria({ ...a, estado: "terminada", terminadaPor: aplicacion, terminadaEn: new Date() }), ...resultado } };
}

export async function anular(id, { aplicacion }) {
  await exigirEnCurso(id);
  const { count } = await repo.cerrar(id, { estado: "anulada", terminadaPor: aplicacion, terminadaEn: new Date() });
  if (!count) throw falla("AUDITORIA_CERRADA", 409, "Esa auditoría ya se cerró");
  return { data: { id, estado: "anulada" } };
}

export async function resultado(id) {
  const a = await exigir(id);
  if (a.estado !== "terminada") throw falla("AUDITORIA_SIN_RESULTADO", 409, a.estado === "en_curso"
    ? "La auditoría sigue en curso: terminala para ver el resultado" : "Esa auditoría se anuló");
  return { data: { ...vistaAuditoria(a), ...a.resultado } };
}

export async function historial(query) {
  const filas = await repo.terminadas(query);
  return { data: filas.map(vistaAuditoria) };
}
