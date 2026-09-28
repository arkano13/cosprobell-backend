import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Cada script usa su propio proceso y limpia sus datos de prueba.
const scripts = [
  "demo-picking.js",
  "comprobar-reintentos-picking.js",
  "comprobar-concurrencia-picking.js",
  "comprobar-limite-picking.js",
  "comprobar-bloqueo-picking.js",
  "comprobar-cierre-picking.js",
];

try {
  for (const script of scripts) {
    console.log(`\n=== ${script} ===`);
    execFileSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
      stdio: "inherit",
      windowsHide: true,
    });
  }
  console.log("\nAPROBADO: demo, reintentos, historial y seis escenarios de concurrencia.");
} catch {
  console.error("Se detuvo la comprobación porque un script falló.");
  process.exitCode = 1;
}
