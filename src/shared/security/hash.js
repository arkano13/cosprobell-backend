import { createHash } from "node:crypto";

export function hashApiKey(clave) {
  return createHash("sha256").update(clave).digest("hex");
}