import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import env from "../../config/env.js";

// Las conexiones se reusan: abrir una nueva cuesta cientos de milisegundos (más si la base se alcanza por la red
// pública). Quedan al menos 2 abiertas y las demás se cierran tras 5 minutos sin uso (por defecto eran 10 segundos,
// así que casi cada pantalla abría conexiones nuevas).
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: 10,
  min: 2,
  idleTimeoutMillis: 5 * 60_000,
  keepAlive: true,
});

export const prisma = new PrismaClient({ adapter });