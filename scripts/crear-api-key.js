import { randomBytes } from "node:crypto";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { hashApiKey } from "../src/shared/security/hash.js";

// --solo-ingreso: la clave solo sirve para listar operadores e iniciar sesión con PIN (la que va dentro de la
// app de escritorio). Sin la opción, la clave accede a la API de aplicaciones.
const argumentos = process.argv.slice(2);
const soloIngreso = argumentos.includes("--solo-ingreso");
const nombre = argumentos.find((a) => !a.startsWith("--"));

if (!nombre || argumentos.some((a) => a.startsWith("--") && a !== "--solo-ingreso")) {
  console.error("Uso: node scripts/crear-api-key.js <nombre-de-la-app> [--solo-ingreso]");
  process.exit(1);
}

const claveVisible = randomBytes(32).toString("hex");
const claveHash = hashApiKey(claveVisible);

const apiKey = await prisma.apiKey.create({
  data: { nombre, claveHash, alcance: soloIngreso ? "ingreso" : "completo" },
});

console.log("API key creada. Guarda esta clave ahora, no se puede recuperar despues:");
console.log("");
console.log(`  ${claveVisible}`);
console.log("");
console.log(`Nombre: ${apiKey.nombre} | id: ${apiKey.id} | alcance: ${apiKey.alcance}`);

await prisma.$disconnect();