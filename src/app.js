import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./infrastructure/logging/logger.js";
import healthRoutes from "./modules/health/health.routes.js";
import productosRoutes from "./modules/productos/productos.routes.js";
import bodegasRoutes from "./modules/bodegas/bodegas.routes.js";
import pickingRoutes from "./modules/picking/picking.routes.js";
import clientesRoutes from "./modules/clientes/clientes.routes.js";
import facturasRoutes from "./modules/facturas/facturas.routes.js";
import pagosRoutes from "./modules/pagos/pagos.routes.js";
import errorHandler from "./middleware/errorHandler.js";
import { requireAppAuth } from "./middleware/authenticate.js";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));
app.use(healthRoutes);
app.use(requireAppAuth);
app.use(productosRoutes);
app.use(bodegasRoutes);
app.use(pickingRoutes);
app.use(clientesRoutes);
app.use(facturasRoutes);
app.use(pagosRoutes);
app.use((req, res) => {
  res.status(404).json({ error: "Recurso no encontrado" });
});
app.use(errorHandler);

export default app;
