import { listarEtiquetas, confirmarEtiqueta, revocarConfirmacion, contarEtiquetas, confirmarManualPendientes } from "../etiquetas/etiquetas.service.js";
import { listarOperadoresAdmin, crearOperador, cambiarPin, desbloquear, cambiarActivo } from "../operadores/operadores.admin.js";
import { listarRevisiones, anularRevision } from "./revisiones.service.js";
import { estadoSincronizacion } from "./sincronizacion.service.js";
import { listarAlmacenes, elegirAlmacenes as elegir } from "../inventario/inventario.service.js";
import { inventarioRepository } from "../inventario/inventario.repository.js";
import { registrarCodigo as registrar } from "../etiquetas/codigos.service.js";

const manejar = (accion) => async (req, res, next) => {
  try { res.json(await accion(req)); } catch (error) { next(error); }
};
const quien = (req) => ({ aplicacion: req.appNombre ?? null });

export async function resumenSupervisor() {
  const [etiquetas, revisiones, operadores, almacenes] = await Promise.all([contarEtiquetas(), listarRevisiones(), listarOperadoresAdmin(),
    inventarioRepository.almacenesDeEstaBodega()]);
  return { data: {
    etiquetas,
    revisiones: { enRevision: revisiones.enRevision.length, conDiferencias: revisiones.conDiferencias.length, sinEntrega: revisiones.sinEntrega.length },
    operadores: { total: operadores.length, bloqueados: operadores.filter((o) => o.estado === "bloqueado" || o.estado === "pausa").length },
    almacenes: { elegidos: almacenes.length },
  } };
}

export const resumen = manejar(() => resumenSupervisor());
export const etiquetas = manejar((req) => listarEtiquetas(req.validatedQuery));
export const confirmar = manejar((req) => confirmarEtiqueta(req.params.id, req.body, quien(req)));
export const revocar = manejar((req) => revocarConfirmacion(req.params.id));
export const confirmarManual = manejar((req) => confirmarManualPendientes(req.body, quien(req)));
export const operadores = manejar(async () => ({ data: await listarOperadoresAdmin() }));
export const crear = manejar(async (req) => ({ data: await crearOperador(req.body) }));
export const pin = manejar(async (req) => ({ data: await cambiarPin(req.params.id, req.body.pin, { exceptoSesionId: req.sesionOperadorId }) }));
export const desbloqueo = manejar(async (req) => ({ data: await desbloquear(req.params.id) }));
export const activo = manejar(async (req) => ({ data: await cambiarActivo(req.params.id, req.body.activo, { actorId: req.operador.id }) }));
export const revisiones = manejar(async () => ({ data: await listarRevisiones() }));
export const anulacion = manejar(async (req) => ({ data: await anularRevision(req.params.id) }));
export const sincronizacion = manejar(async () => ({ data: await estadoSincronizacion() }));
export const almacenes = manejar(() => listarAlmacenes());
export const elegirAlmacenes = manejar((req) => elegir(req.body, quien(req)));
export const registrarCodigo = manejar((req) => registrar(req.body, quien(req)));
