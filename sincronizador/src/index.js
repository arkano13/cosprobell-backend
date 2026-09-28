import { leerConfiguracion } from "./config.js";
import { crearClienteServiceLayer } from "./serviceLayer.js";
import { crearClienteBackend } from "./backend.js";
import { sincronizar } from "./sincronizar.js";
import { diagnosticar, formatearDiagnostico } from "./diagnostico.js";

const COMANDOS = ["diagnostico", "sincronizar"];

function informar(mensaje) {
  console.log(`[${new Date().toISOString()}] ${mensaje}`);
}

async function main() {
  const comando = process.argv[2];

  if (!COMANDOS.includes(comando)) {
    console.error(`Uso: node --env-file=.env src/index.js <${COMANDOS.join("|")}>`);
    process.exitCode = 1;
    return;
  }

  const config = leerConfiguracion(process.env, {
    requiereBackend: comando === "sincronizar",
  });

  const serviceLayer = crearClienteServiceLayer({
    url: config.serviceLayerUrl,
    companyDb: config.companyDb,
    usuario: config.usuario,
    contrasena: config.contrasena,
  });

  try {
    if (comando === "diagnostico") {
      console.log(formatearDiagnostico(await diagnosticar(serviceLayer)));
      return;
    }

    const backend = crearClienteBackend({ url: config.backendUrl, secreto: config.secreto });
    informar(`Sincronizando desde ${config.serviceLayerUrl} hacia ${config.backendUrl}`);

    const resumen = await sincronizar({ serviceLayer, backend, informar });
    console.table(resumen);
    informar("Sincronización terminada");
  } finally {
    await serviceLayer.cerrarSesion();
  }
}

try {
  await main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
