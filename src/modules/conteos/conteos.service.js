// Conteo con nombre: cualquier operador le pone un nombre, escanea unidad por unidad (el código de la unidad, como en
// el picking) y al finalizar queda la lista de productos con sus cantidades para el PDF y el Excel. Solo cuenta: no
// compara con existencias ni mueve inventario. Cada operador ve y usa sus conteos; el supervisor (o una aplicación),
// todos.
import { AppError } from "../../shared/errors/AppError.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { resolverEtiquetaParaPicking } from "../picking/picking.etiquetas.service.js";
import { conteosRepository as repo } from "./conteos.repository.js";

const falla = (code, statusCode, message) => new AppError({ code, statusCode, message });
const persona = (quien) => quien?.replace(/^operador:/, "") ?? null;
// undefined: ve todos (supervisor o aplicación); un número: solo los de ese operador.
const alcance = (operador) => (!operador || operador.rol === "supervisor" ? undefined : operador.id);

const vistaConteo = (c) => ({ id: c.id, nombre: c.nombre, estado: c.estado, iniciadoPor: persona(c.iniciadoPor),
  iniciadoEn: c.iniciadoEn, terminadoEn: c.terminadoEn, ...(c.unidades !== undefined ? { unidades: c.unidades, productos: c.productos } : {}) });

// Un conteo de otro operador responde como si no existiera.
async function exigir(id, operador) {
  const c = await repo.buscar(id);
  const propio = alcance(operador);
  if (!c || (propio !== undefined && c.operadorId !== propio)) throw falla("CONTEO_NO_ENCONTRADO", 404, "No existe ese conteo");
  return c;
}
async function exigirEnCurso(id, operador) {
  const c = await exigir(id, operador);
  if (c.estado !== "en_curso") throw falla("CONTEO_CERRADO", 409, c.estado === "terminado" ? "Ese conteo ya se finalizó" : "Ese conteo se descartó");
  return c;
}

export async function listar({ limit }, { operador }) {
  const { enCurso, terminados } = await repo.listar({ operadorId: alcance(operador), limit });
  return { data: { enCurso: enCurso.map(vistaConteo), terminados: terminados.map(vistaConteo) } };
}

export async function iniciar({ nombre }, { operador, aplicacion }) {
  const c = await repo.crear({ nombre, operadorId: operador?.id ?? null, iniciadoPor: aplicacion });
  return { data: vistaConteo(c) };
}

// Lo escaneado: en curso, lo último arriba; finalizado, por nombre (como sale en el documento).
export async function consultar(id, { operador }) {
  const c = await exigir(id, operador);
  const productos = await repo.escaneado(id);
  if (c.estado !== "en_curso") productos.sort((a, b) => a.itemName.localeCompare(b.itemName, "es") || a.itemCode.localeCompare(b.itemCode));
  return { data: { ...vistaConteo(c), unidades: productos.reduce((t, p) => t + p.unidades, 0), productos } };
}

export async function escanear(id, { codigo, operacionId }, { operador, aplicacion }) {
  await exigirEnCurso(id, operador);
  const etiqueta = await resolverEtiquetaParaPicking(codigo, prisma);
  const agregada = await repo.agregarLectura({ conteoId: id, operacionId, codigo: codigo.trim(), itemCode: etiqueta.itemCode, hechoPor: aplicacion });
  if (!agregada) {
    // La misma operación otra vez (reintento) no suma; si el conteo se cerró en el medio, se avisa.
    const c = await repo.buscar(id);
    if (c?.estado !== "en_curso") throw falla("CONTEO_CERRADO", 409, "Ese conteo ya se finalizó");
  }
  const [unidades, nombres] = await Promise.all([repo.unidadesDe(id, etiqueta.itemCode), repo.nombres([etiqueta.itemCode])]);
  return { data: { itemCode: etiqueta.itemCode, itemName: nombres.get(etiqueta.itemCode) ?? etiqueta.itemCode,
    unidadesProducto: unidades.producto, unidades: unidades.total, repetida: !agregada } };
}

export async function quitarUltima(id, { operador }) {
  await exigirEnCurso(id, operador);
  const quitada = await repo.quitarUltima(id);
  if (!quitada) throw falla("SIN_LECTURAS", 409, "No hay lecturas para quitar en este conteo");
  const [unidades, nombres] = await Promise.all([repo.unidadesDe(id, quitada.itemCode), repo.nombres([quitada.itemCode])]);
  return { data: { itemCode: quitada.itemCode, itemName: nombres.get(quitada.itemCode) ?? quitada.itemCode,
    unidadesProducto: unidades.producto, unidades: unidades.total } };
}

export async function terminar(id, quien) {
  await exigirEnCurso(id, quien.operador);
  const { count } = await repo.cerrar(id, { estado: "terminado", terminadoEn: new Date() });
  if (!count) throw falla("CONTEO_CERRADO", 409, "Ese conteo ya se cerró");
  return consultar(id, quien);
}

export async function anular(id, { operador }) {
  await exigirEnCurso(id, operador);
  const { count } = await repo.cerrar(id, { estado: "anulado", terminadoEn: new Date() });
  if (!count) throw falla("CONTEO_CERRADO", 409, "Ese conteo ya se cerró");
  return { data: { id, estado: "anulado" } };
}
