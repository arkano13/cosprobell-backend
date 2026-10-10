import sincronizacionRoutes from "./modules/sincronizacion/sincronizacion.routes.js";
import { ingresoFinanzas, consultasFinanzas } from "./modules/finanzas/finanzas.routes.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./infrastructure/logging/logger.js";
import healthRoutes from "./modules/health/health.routes.js";
import productosRoutes from "./modules/productos/productos.routes.js";
import bodegasRoutes from "./modules/bodegas/bodegas.routes.js";
import pickingRoutes from "./modules/picking/picking.routes.js";
import pedidosRoutes from "./modules/pedidos/pedidos.routes.js";
import etiquetasRoutes from "./modules/etiquetas/etiquetas.routes.js";
import clientesRoutes from "./modules/clientes/clientes.routes.js";
import facturasRoutes from "./modules/facturas/facturas.routes.js";
import pagosRoutes from "./modules/pagos/pagos.routes.js";
import errorHandler from "./middleware/errorHandler.js";
import { requireAppAuth, soloAplicaciones } from "./middleware/authenticate.js";
import operadoresRoutes from "./modules/operadores/operadores.routes.js";
import supervisorRoutes from "./modules/supervisor/supervisor.routes.js";
import inventarioRoutes from "./modules/inventario/inventario.routes.js";
import actualizacionesRoutes from "./modules/actualizaciones/actualizaciones.routes.js";

const app = express();
app.use(helmet());
// La app de escritorio llama desde otro origen: el navegador consulta antes cada pedido (OPTIONS). maxAge deja esa
// respuesta guardada 2 horas (el máximo de Chromium) y ahorra un viaje de ida y vuelta por pedido.
app.use(cors({ maxAge: 7200 }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));
app.use(healthRoutes);
app.use("/integracion/finanzas", ingresoFinanzas);
app.use("/integracion", sincronizacionRoutes);
// Ingreso con nombre y PIN: acepta la clave de solo ingreso de la app de escritorio.
app.use(operadoresRoutes);
// Actualizaciones de la app de escritorio: también con la clave de solo ingreso.
app.use(actualizacionesRoutes);
// Aplicaciones con API key u operadores con sesión.
app.use(requireAppAuth);
app.use(pickingRoutes);
app.use(pedidosRoutes);
// Panel del supervisor (rol supervisor con sesión de PIN).
app.use("/supervisor", supervisorRoutes);
// Inventario de las dos bodegas (operadores y aplicaciones; algunas correcciones solo el supervisor).
app.use("/inventario", inventarioRoutes);
// Un operador solo llega hasta pedidos, picking, el panel y el inventario.
app.use(soloAplicaciones);
app.use("/finanzas", consultasFinanzas);
app.use(productosRoutes);
app.use(bodegasRoutes);
app.use(etiquetasRoutes);
app.use(clientesRoutes);
app.use(facturasRoutes);
app.use(pagosRoutes);
app.use((req, res) => {
  res.status(404).json({ error: "Recurso no encontrado" });
});
app.use(errorHandler);

export default app;
