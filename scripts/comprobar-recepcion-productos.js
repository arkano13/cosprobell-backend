import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { sincronizacionRepository as repo } from "../src/modules/sincronizacion/sincronizacion.repository.js";
import { recibirLote } from "../src/modules/sincronizacion/sincronizacion.service.js";
const recibirProductos = (lote, empresa) => recibirLote("productos", lote, empresa);

// Esquema desechable y exclusivo: no cambia productos ni estado reales.
const schema = `prueba_sync_${randomBytes(8).toString("hex")}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let creada = false, db;
const bloqueoOriginal = repo.conBloqueo;
const guardarOriginal = repo.guardarEstado;
const empresa = "EMPRESA_SINTETICA";
const lote = (secuencia, nombre = "Champú de prueba") => ({ version: 1, empresa, secuencia,
  productos: [{ itemCode: "P-TEST", itemName: nombre, barCode: "0012345", valid: true, frozen: false }] });
try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`); creada = true;
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE productos (LIKE public.productos INCLUDING ALL)`);
  const sql = await readFile(new URL("../prisma/migrations/20260928160000_estado_sincronizacion_productos/migration.sql", import.meta.url), "utf8");
  await admin.query(sql);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}` }, { schema }) });
  repo.conBloqueo = (fn) => bloqueoOriginal(fn, db);
  const resultados = await Promise.allSettled([recibirProductos(lote(1), empresa), recibirProductos(lote(1), empresa)]);
  for (const r of resultados) if (r.status === "rejected") throw r.reason;
  assert.equal(resultados.filter((r) => r.value.repetido).length, 1);
  assert.equal(await db.producto.count(), 1);
  assert.equal((await db.producto.findUnique({ where: { itemCode: "P-TEST" } })).barCode, "0012345");
  console.log("APROBADO: dos envíos simultáneos crean un producto y una confirmación.");
  await recibirProductos(lote(2, "Actualizado"), empresa);
  await assert.rejects(recibirProductos(lote(1), empresa), { code: "SECUENCIA_INVALIDA" });
  await assert.rejects(recibirProductos(lote(2, "Otro contenido"), empresa), { code: "LOTE_MODIFICADO" });
  assert.equal((await db.producto.findUnique({ where: { itemCode: "P-TEST" } })).itemName, "Actualizado");
  console.log("APROBADO: actualización sin duplicar y rechazo de contenido conflictivo o antiguo.");
  repo.guardarEstado = async (_estado, tx) => { await tx.$queryRaw`SELECT 1 / 0`; };
  await assert.rejects(recibirProductos(lote(3, "NO DEBE QUEDAR"), empresa));
  repo.guardarEstado = guardarOriginal;
  assert.equal((await repo.consultarEstado("productos", db)).secuencia, 2);
  assert.equal((await db.producto.findUnique({ where: { itemCode: "P-TEST" } })).itemName, "Actualizado");
  await recibirProductos(lote(3, "Recuperado"), empresa);
  assert.equal((await repo.consultarEstado("productos", db)).secuencia, 3);
  console.log("APROBADO: fallo SQL revierte producto y avance; reintento posterior funciona.");
} catch (error) {
  console.error("FALLÓ la prueba de recepción. Tipo:", error.name, "Código:", error.code ?? "sin código");
  process.exitCode = 1;
} finally {
  repo.conBloqueo = bloqueoOriginal; repo.guardarEstado = guardarOriginal;
  try {
    if (db) await db.$disconnect();
    if (creada) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); console.log("Esquema temporal eliminado."); }
  } catch { console.error("Revisar limpieza del esquema temporal:", schema); process.exitCode = 1; }
  await admin.end(); await prisma.$disconnect();
}
