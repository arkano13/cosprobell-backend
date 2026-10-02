import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";

const ordenar = valor => Array.isArray(valor) ? valor.map(ordenar)
  : valor && typeof valor === "object" ? Object.fromEntries(Object.keys(valor).sort().map(k => [k, ordenar(valor[k])])) : valor;

// Ejecutar dentro de la misma transacción que cambia las existencias.
export async function ejecutarUnaVez(tx, solicitud, accion) {
  const { operacionId, ...contenido } = solicitud;
  if (typeof operacionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operacionId)) {
    throw new AppError({ code: "OPERACION_INVALIDA", message: "Se requiere operacionId UUID", statusCode: 400 });
  }
  const id = operacionId.toLowerCase();
  if (contenido.entrada) {
    const { operacionId: _id, ...entrada } = contenido.entrada;
    contenido.entrada = entrada;
  }
  const hash = createHash("sha256").update(JSON.stringify(ordenar(contenido))).digest("hex");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`operacion-inventario:${id}`}))::text`;
  const [anterior] = await tx.$queryRaw`SELECT hash, respuesta FROM inventario_operaciones WHERE id = ${id}::uuid`;
  if (anterior) {
    if (anterior.hash !== hash) throw new AppError({ code: "OPERACION_REUTILIZADA", message: "La operación ya se utilizó con otros datos o usuario", statusCode: 409 });
    return anterior.respuesta;
  }
  const respuesta = await accion();
  await tx.$executeRaw`INSERT INTO inventario_operaciones (id, hash, respuesta) VALUES (${id}::uuid, ${hash}, ${JSON.stringify(respuesta)}::jsonb)`;
  return respuesta;
}
