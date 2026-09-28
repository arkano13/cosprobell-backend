export function createShutdown({
  server,
  prisma,
  logger,
  timeoutMs = 10_000,
  exit = (code) => process.exit(code),
}) {
  let closing = false;

  return function shutdown(signal) {
    if (closing) {
      return;
    }

    closing = true;
    logger.info({ signal }, "Iniciando cierre del servidor");

    const timer = setTimeout(() => {
      logger.error("Se agotó el tiempo de cierre");
      exit(1);
    }, timeoutMs);

    timer.unref();

    server.close(async (error) => {
      let exitCode = error ? 1 : 0;

      if (error) {
        logger.error({ err: error }, "Error al cerrar HTTP");
      }

      try {
        await prisma.$disconnect();
      } catch (error) {
        exitCode = 1;
        logger.error(
          { err: error },
          "Error al desconectar PostgreSQL"
        );
      } finally {
        clearTimeout(timer);
      }

      logger.info({ exitCode }, "Cierre terminado");
      exit(exitCode);
    });
  };
}