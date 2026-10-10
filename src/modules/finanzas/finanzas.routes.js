import { Router } from "express";
import { z } from "zod";
import { requireBridgeAuth } from "../../middleware/bridgeAuth.js";
import { inicioSchema, fecha, nombresFinanzas } from "../../shared/finanzas/contratos.js";
import { estadoFinanzas, iniciarFinanzas, recibirFinanzas, finalizarFinanzas, falloFinanzas } from "./finanzas.ingreso.js";
import { listarFinanzas, consultarCartera, consultarEstadoCuenta } from "./finanzas.consultas.js";
import { finanzasRepository } from "./finanzas.repository.js";
import env from "../../config/env.js";
const envolver = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };
export const ingresoFinanzas = Router();
ingresoFinanzas.use(requireBridgeAuth);
for (const entidad of nombresFinanzas) {
  ingresoFinanzas.get(`/${entidad}/estado`, envolver(async req => ({ data: await estadoFinanzas(entidad, req.empresaSap) })));
  for (const [accion, fn] of Object.entries({ iniciar: iniciarFinanzas, lote: recibirFinanzas, finalizar: finalizarFinanzas })) {
    ingresoFinanzas.post(`/${entidad}/${accion}`, envolver(async req => ({ data: await fn(entidad, req.body, req.empresaSap) })));
  }
}
const lista = z.object({ cardCode: z.string().min(1).max(50).optional(), cursor: z.string().min(1).max(200).optional(),
  version: inicioSchema.shape.recorridoId.optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
  desde: fecha.optional(), hasta: fecha.optional() }).strict().refine(q => !q.desde || !q.hasta || q.desde <= q.hasta);
const validar = (schema, valor) => {
  const r = schema.safeParse(valor);
  if (!r.success) throw falloFinanzas("CONSULTA_INVALIDA", "Filtros financieros inválidos", 400);
  return r.data;
};
export const consultasFinanzas = Router();
consultasFinanzas.use((req, res, next) => {
  if (!env.finanzasAppsAutorizadas.includes(req.appNombre)) return res.status(403).json({ error: "Aplicación sin permiso de consulta financiera" });
  next();
});
consultasFinanzas.get("/estado", envolver(async () => ({ data: await finanzasRepository.controles(), validadoContraSap: false })));
consultasFinanzas.get("/cartera", envolver(req => consultarCartera(validar(z.object({ cardCode: z.string().min(1).max(50) }).strict(), req.query).cardCode)));
consultasFinanzas.get("/estado-cuenta", envolver(req => {
  const q = validar(lista, req.query);
  if (!q.cardCode || !q.desde || !q.hasta) throw falloFinanzas("CONSULTA_INVALIDA", "Indique cliente, desde y hasta", 400);
  return consultarEstadoCuenta(q.cardCode, q);
}));
for (const entidad of nombresFinanzas) consultasFinanzas.get(`/${entidad}`, envolver(req => listarFinanzas(entidad, validar(lista, req.query))));
