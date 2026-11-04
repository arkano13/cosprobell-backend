import env from "../../config/env.js";

export const puedeConsultarFinanzas = req => env.finanzasAppsAutorizadas.includes(req.appNombre);
export function exigirConsultaFinanciera(req, res, next) {
  if (!puedeConsultarFinanzas(req)) return res.status(403).json({ error: "Aplicación sin permiso de consulta financiera" });
  next();
}
