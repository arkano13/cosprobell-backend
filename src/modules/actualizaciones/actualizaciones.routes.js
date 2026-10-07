import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import env from "../../config/env.js";
import { requireIngresoAuth } from "../../middleware/authenticate.js";
import { crearActualizaciones } from "./actualizaciones.service.js";

// Archivos de actualización de la app de escritorio (ver actualizaciones.service.js). Pide una API key activa: la app
// usa su clave de solo ingreso.
export function crearRutasActualizaciones({ servicio, autenticar = requireIngresoAuth }) {
  const router = Router();
  router.get("/actualizaciones/:archivo", autenticar, async (req, res, next) => {
    let archivo;
    try { archivo = await servicio.archivo(req.params.archivo); } catch (error) { return next(error); }
    res.setHeader("Content-Type", archivo.tipo);
    res.setHeader("Cache-Control", "no-store");
    if (archivo.tamano) res.setHeader("Content-Length", String(archivo.tamano));
    try {
      await pipeline(Readable.fromWeb(archivo.cuerpo), res);
    } catch (error) {
      req.log?.warn({ err: error }, "se cortó la descarga de una actualización");
      res.destroy();
    }
  });
  return router;
}

export default crearRutasActualizaciones({
  servicio: crearActualizaciones({ token: env.actualizacionesToken, repo: env.actualizacionesRepo }),
});
