import { randomBytes } from "node:crypto";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { hashApiKey } from "../src/shared/security/hash.js";

const nombre = process.argv[2];

if (!nombre) {
  console.error("Uso: node scripts/crear-api-key.js <nombre-de-la-app>");
  process.exit(1);
}

const claveVisible = randomBytes(32).toString("hex");
const claveHash = hashApiKey(claveVisible);

const apiKey = await prisma.apiKey.create({
  data: { nombre, claveHash },
});

console.log("API key creada. Guarda esta clave ahora, no se puede recuperar despues:");
console.log("");
console.log(`  ${claveVisible}`);
console.log("");
console.log(`Nombre: ${apiKey.nombre} | id: ${apiKey.id}`);

await prisma.$disconnect();