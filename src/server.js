import app from "./app.js";
import env from "./config/env.js";
import { prisma } from "./infrastructure/database/prisma.js";
import { logger } from "./infrastructure/logging/logger.js";
import { createShutdown } from "./infrastructure/shutdown.js";

const server = app.listen(env.port, () => {
  logger.info(
    { port: env.port, environment: env.nodeEnv },
    "Servidor iniciado"
  );
});

const shutdown = createShutdown({
  server,
  prisma,
  logger,
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (error) => {
  logger.error({ err: error }, "No se pudo iniciar el servidor");
  shutdown("SERVER_ERROR");
});