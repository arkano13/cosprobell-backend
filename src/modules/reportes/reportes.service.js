// Reportes de bodega del panel del supervisor (solo lectura). Cada uno junta las consultas de reportes.repository y arma
// la respuesta con reportes.calculo. Nada de esto lee ni escribe SAP: todo sale de lo que la base ya guarda.
import { AppError } from "../../shared/errors/AppError.js";
import { reportesRepository } from "./reportes.repository.js";
import { rangoPeriodo, rangoDia, fechaLocal, lunesDe, sumarDias, inicioDelDia, diasHabiles } from "./reportes.periodo.js";
import { armarPreparaciones, armarDetalle, armarErrores, armarSalidas, armarReposiciones, armarCorrecciones, armarPendientes,
  armarActividad } from "./reportes.calculo.js";
import { textoAsignacion } from "../inventario/inventario.calculo.js";
import { asignacionDe, resumirAsignacion, listarPendientes } from "../inventario/inventario.service.js";
import { inventarioRepository } from "../inventario/inventario.repository.js";

const mapa = (filas, clave, valor) => new Map(filas.map((f) => [f[clave], f[valor]]));
const encabezado = (rango, ahora) => ({ generadoEn: new Date(ahora).toISOString(), periodo: rango.periodo ?? null,
  desde: rango.primerDia, hasta: rango.ultimoDia, dias: rango.dias });
const nombresDe = async (repo, itemCodes) => mapa(await repo.nombres([...new Set(itemCodes.filter(Boolean))]), "itemCode", "itemName");
const codigosDe = async (repo, itemCodes) => mapa(await repo.codigosPrincipales([...new Set(itemCodes.filter(Boolean))]), "itemCode", "codigo");
const FUENTE = { facturas: "factura", traslados: "traslado", todos: null };

// Filtros comunes: los operadores que se pueden elegir.
async function operadores(repo) {
  return (await repo.operadores()).map((o) => ({ nombre: o.nombre, rol: o.rol, activo: o.activo }));
}

export async function reportePreparaciones({ periodo, operador, documento }, { repo = reportesRepository, ahora = new Date() } = {}) {
  const rango = rangoPeriodo(periodo, ahora);
  const fuente = FUENTE[documento];
  const [sesiones, sinPreparar, lista] = await Promise.all([repo.preparaciones({ ...rango, operador, fuente }),
    repo.sinPreparar({ fuente }), operadores(repo)]);
  return { data: { ...encabezado(rango, ahora), filtros: { operador: operador ?? null, documento, operadores: lista },
    ...armarPreparaciones({ sesiones, sinPreparar, rango, hoy: rango.ultimoDia }) } };
}

export async function reporteDetallePreparacion(id, { repo = reportesRepository } = {}) {
  const sesion = await repo.sesion(id);
  if (!sesion) throw new AppError({ code: "PICKING_NO_ENCONTRADO", message: "Preparación no encontrada", statusCode: 404 });
  const [documento, escaneos, anulacion] = await Promise.all([repo.documento(sesion.pedidoDocEntry), repo.escaneos(id), repo.anuladoPor([id])]);
  const leidos = new Map((await repo.productosDeCodigos([...new Set(escaneos.filter((e) => !e.itemCode).map((e) => e.codigo))]))
    .map((f) => [f.codigo, { itemCode: f.itemCode, esCaja: f.esCaja }]));
  const itemCodes = [...sesion.lineas.flatMap((l) => [l.itemCode, l.comboItemCode]), ...escaneos.map((e) => e.itemCode),
    ...[...leidos.values()].map((l) => l.itemCode)];
  const [nombres, codigos] = await Promise.all([nombresDe(repo, itemCodes), codigosDe(repo, sesion.lineas.map((l) => l.itemCode))]);
  const anuladoPor = anulacion[0] ? { persona: anulacion[0].usuario?.replace(/^operador:/, "") ?? null, fecha: anulacion[0].creadoEn } : null;
  return { data: armarDetalle({ sesion, documento, escaneos, nombres, codigos, leidos, anuladoPor }) };
}

export async function reporteErrores({ periodo, operador }, { repo = reportesRepository, ahora = new Date() } = {}) {
  const rango = rangoPeriodo(periodo, ahora);
  // La tendencia siempre muestra las últimas 8 semanas (de lunes a domingo), aunque el período sea más corto.
  const semanas8 = { desde: inicioDelDia(sumarDias(lunesDe(fechaLocal(ahora)), -49)), hasta: ahora, operador };
  const [lecturas, [preparaciones], semanas, equivocados, lista] = await Promise.all([repo.lecturas({ ...rango, operador }),
    repo.preparacionesConLecturas({ ...rango, operador }), repo.lecturasPorSemana(semanas8), repo.equivocados({ ...rango, operador }),
    operadores(repo)]);
  const productoDe = mapa(await repo.productosDeCodigos([...new Set(equivocados.map((e) => e.codigo))]), "codigo", "itemCode");
  const nombres = await nombresDe(repo, [...productoDe.values(), ...equivocados.map((e) => e.siguiente)]);
  return { data: { ...encabezado(rango, ahora), filtros: { operador: operador ?? null, operadores: lista },
    ...armarErrores({ lecturas, preparaciones: preparaciones?.cantidad ?? 0, semanas, equivocados, productoDe, nombres, hoy: rango.ultimoDia }) } };
}

export async function reporteSalidas({ periodo, limite }, { repo = reportesRepository, ahora = new Date() } = {}) {
  const rango = rangoPeriodo(periodo, ahora);
  rango.diasHabiles = diasHabiles(rango);
  const [salidas, enPequena] = await Promise.all([repo.salidas(rango), repo.enPequena()]);
  const itemCodes = [...salidas.map((s) => s.itemCode), ...enPequena.map((p) => p.itemCode)];
  const [nombres, codigos] = await Promise.all([nombresDe(repo, salidas.map((s) => s.itemCode)), codigosDe(repo, itemCodes)]);
  return { data: { ...encabezado(rango, ahora), filtros: { limite },
    ...armarSalidas({ salidas, enPequena, nombres, codigos, rango, limite, ahora }) } };
}

export async function reporteReposiciones({ periodo, como }, { repo = reportesRepository, ahora = new Date() } = {}) {
  const rango = rangoPeriodo(periodo, ahora);
  // "Reponer pronto" usa lo que sale por día hábil en los últimos 30 días, sea cual sea el período elegido.
  const ultimos30 = rangoPeriodo("30d", ahora);
  const [reposiciones, salidas, enPequena] = await Promise.all([repo.reposiciones(rango), repo.salidas(ultimos30), repo.enPequena()]);
  const habiles = diasHabiles(ultimos30);
  const salidaDiaria = new Map(salidas.map((s) => [s.itemCode, s.unidades / habiles]));
  const cajas = new Map((await repo.cajasEnGrande([...salidaDiaria.keys()])).map((c) => [c.itemCode, c]));
  const itemCodes = [...reposiciones.map((r) => r.itemCode), ...salidaDiaria.keys()];
  const [nombres, codigos] = await Promise.all([nombresDe(repo, itemCodes), codigosDe(repo, itemCodes)]);
  return { data: { ...encabezado(rango, ahora), filtros: { como },
    ...armarReposiciones({ reposiciones, como, salidaDiaria, enPequena: mapa(enPequena, "itemCode", "pequena"), cajas, nombres, codigos, rango }) } };
}

export async function reporteCorrecciones({ periodo, tipo, persona }, { repo = reportesRepository, ahora = new Date() } = {}) {
  const rango = rangoPeriodo(periodo, ahora);
  const [registrados, antiguas, corregidos, anuladas] = await Promise.all([repo.cambiosRegistrados(rango), repo.edicionesAntiguas(rango),
    repo.descuentosCorregidos(rango), repo.anuladas(rango)]);
  const descuentos = corregidos.map((d) => ({ ...d, actual: textoAsignacion(resumirAsignacion(asignacionDe(d.movimientos))) || null }));
  const itemCodes = [...registrados.map((r) => { try { return JSON.parse(r.detalle ?? "{}").itemCode; } catch { return null; } }),
    ...antiguas.map((a) => a.itemCode), ...descuentos.map((d) => d.itemCode)];
  const nombres = await nombresDe(repo, itemCodes);
  return { data: { ...encabezado(rango, ahora), filtros: { tipo, persona: persona ?? null },
    ...armarCorrecciones({ registrados, antiguas, descuentos, anuladas, nombres, tipo, persona }) } };
}

export async function reportePendientes({ minDias }, { repo = reportesRepository, inventario = inventarioRepository, pendientes = listarPendientes,
  ahora = new Date() } = {}) {
  const [{ data }, estados] = await Promise.all([pendientes(), inventario.estados()]);
  const itemCodes = [...data.porUbicar, ...data.porDescontar, ...data.porPasar].map((v) => v.itemCode);
  const codigos = await codigosDe(repo, itemCodes);
  return { data: { generadoEn: new Date(ahora).toISOString(),
    ...armarPendientes({ pendientes: data, cambios: mapa(estados, "itemCode", "sapCambioEn"), codigos, minDias, ahora }) } };
}

export async function reporteActividad({ dia, persona }, { repo = reportesRepository, ahora = new Date() } = {}) {
  const fecha = dia ?? fechaLocal(ahora);
  const rango = rangoDia(fecha);
  const [preparaciones, lecturasHora, movimientos, cuadres, conteosAlmacen, descuentos, codigos, cambios] = await Promise.all([
    repo.preparaciones(rango), repo.lecturasPorHora(rango), repo.movimientosDelDia(rango), repo.cuadresDelDia(rango),
    repo.conteosAlmacenDelDia(rango), repo.descuentosDelDia(rango), repo.codigosDelDia(rango), repo.cambiosRegistrados(rango)]);
  const itemCodes = [...movimientos, ...cuadres, ...conteosAlmacen, ...descuentos, ...codigos].map((f) => f.itemCode)
    .concat(cambios.map((c) => { try { return JSON.parse(c.detalle ?? "{}").itemCode; } catch { return null; } }));
  const nombres = await nombresDe(repo, itemCodes);
  return { data: { generadoEn: new Date(ahora).toISOString(),
    ...armarActividad({ dia: fecha, preparaciones, lecturasHora, movimientos, cuadres, conteosAlmacen, descuentos, codigos, cambios, nombres, persona }) } };
}
