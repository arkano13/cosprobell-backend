import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { ejemploFinanciero } from "../helpers/finanzas-normalizadas.js";
import { normalizarTanda } from "../../src/modules/finanzas/finanzas.normalizar.js";
import { entidadesPeriodicas } from "../../src/shared/finanzas/periodicas.js";
import { claveRegistro } from "../../src/shared/finanzas/contratos.js";
import { recibirActualizacion, estadoPeriodico } from "../../src/modules/finanzas/finanzas.periodicas.js";

test("periódicas PostgreSQL: historial, cambios atómicos, relaciones, idempotencia y rollback", { timeout: 120000 }, async t => {
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 1 });
  let db;
  try {
    for (const m of (await readdir(new URL("../../prisma/migrations/", import.meta.url))).filter(n => /^\d/.test(n)).sort()) {
      await pg.exec(await readFile(new URL(`../../prisma/migrations/${m}/migration.sql`, import.meta.url), "utf8"));
    }
    await socket.start();
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@${socket.getServerConn()}/periodicas`, max: 1 }) });
    const versiones = {};
    const r = (e, cambios = {}) => ejemploFinanciero(e, { ...(e === "clientes" ? { cardCode: "C1" } : {}), ...cambios });
    const fuente = {
      empresa: [r("empresa", { codigo: "empresa", monedaLocal: "LPS", monedaSistema: "USD" })],
      clientes: [r("clientes")], vendedores: [r("vendedores")], condicionesPago: [r("condicionesPago")],
      facturas: [r("facturas", { docEntry: 10, cardCode: "C1" })], notasCredito: [r("notasCredito", { docEntry: 30, cardCode: "C1" })],
      facturaLineas: [0, 1].map(linea => r("facturaLineas", { docEntry: 10, linea, cardCode: "C1" })),
      notaCreditoLineas: [r("notaCreditoLineas", { docEntry: 30, cardCode: "C1" })],
      cuotas: [r("cuotas", { docEntry: 10, cardCode: "C1" })], pagos: [r("pagos", { docEntry: 20, cardCode: "C1" })],
      aplicacionesPagos: [r("aplicacionesPagos", { pagoEntry: 20, cardCode: "C1", documento: 10, tipo: "it_Invoice" })],
      movimientos: [r("movimientos", { transId: 100, linea: 0, cardCode: "_SYS001" })],
    };
    // Orden de dependencias, deliberadamente sin conectar a DATABASE_URL.
    for (const e of ["empresa", "clientes", "vendedores", "condicionesPago", "facturas", "notasCredito", "facturaLineas", "notaCreditoLineas", "cuotas", "pagos", "aplicacionesPagos", "movimientos"]) {
      versiones[e] = randomUUID();
      await db.finanzaControl.create({ data: { entidad: e, empresa: "TEST", recorridoId: versiones[e], activoId: versiones[e],
        configuracion: { lectura: "get_parcial", desde: "1900-01-01", monedaLocal: "LPS", monedaSistema: "USD" },
        finalizadoEn: new Date(), publicadoEn: new Date(), lecturaPublicadaDesde: new Date(), cantidad: fuente[e].length } });
      for (const datos of fuente[e]) await db.finanzaRegistro.create({ data: { entidad: e, version: versiones[e], clave: claveRegistro(e, datos), datos } });
      assert.equal((await normalizarTanda(db, e, 50)).completo, true);
    }
    const body = (grupo, registros) => ({ protocolo: 1, operacionId: randomUUID(), empresa: "TEST", grupo,
      monedaLocal: "LPS", monedaSistema: "USD", versiones: Object.fromEntries(Object.keys(registros).map(e => [e, versiones[e]])), registros });
    const factura = body("facturas", { facturas: [r("facturas", { docEntry: 10, cardCode: "C1", pagado: "100", cancelado: "Y" })],
      facturaLineas: [r("facturaLineas", { docEntry: 10, linea: 0, cardCode: "C1", precio: "8682903.86" })], cuotas: [] });
    await t.test("precondiciones comprueban las doce conversiones y máximos", async () => {
      const estado = await estadoPeriodico("TEST", db);
      assert.deepEqual(estado.maximos, { facturas: 10, notasCredito: 30, pagos: 20, movimientos: 100 });
      assert.equal(Object.keys(estado.versiones).length, 12);
      const v = await db.finanzaNormalizacion.findUnique({ where: { entidad: "movimientos" } });
      await db.finanzaNormalizacion.update({ where: { entidad: "movimientos" }, data: { finalizadoEn: null } });
      await assert.rejects(estadoPeriodico("TEST", db), { code: "FINANZAS_PERIODICAS_NO_LISTAS" });
      await db.finanzaNormalizacion.update({ where: { entidad: "movimientos" }, data: { finalizadoEn: v.finalizadoEn } });
    });
    await t.test("reemplaza detalles completos, mantiene histórico y escribe JSON y tablas juntos", async () => {
      const publicado = (await db.finanzaControl.findUnique({ where: { entidad: "facturas" } })).publicadoEn;
      const resultado = await recibirActualizacion(factura, "TEST", db);
      assert.equal(resultado.normalizado, true);
      assert.equal((await db.factura.findUnique({ where: { docEntry: 10 } })).paidToDate.toString(), "100");
      assert.equal(await db.facturaLinea.count(), 1);
      assert.equal(await db.facturaCuota.count(), 0);
      assert.equal(await db.finanzaRegistro.count({ where: { entidad: "cuotas", version: versiones.cuotas } }), 0);
      assert.equal(await db.pago.count(), 1);
      const c = await db.finanzaControl.findUnique({ where: { entidad: "facturas" } });
      assert.equal(c.activoId, versiones.facturas);
      assert.equal(c.publicadoEn.toISOString(), publicado.toISOString());
      assert.ok(c.configuracion.periodica.revision);
      assert.equal((await db.finanzaNormalizacion.findUnique({ where: { entidad: "facturaLineas" } })).cantidad, 1);
    });
    await t.test("un acuse repetido no escribe ni revierte datos posteriores", async () => {
      const segunda = structuredClone(factura); segunda.operacionId = randomUUID(); segunda.registros.facturas[0].pagado = "101";
      await recibirActualizacion(segunda, "TEST", db);
      assert.equal((await recibirActualizacion(factura, "TEST", db)).repetido, true);
      assert.equal((await db.factura.findUnique({ where: { docEntry: 10 } })).paidToDate.toString(), "101");
      const cambiada = structuredClone(factura); cambiada.registros.facturas[0].pagado = "999";
      await assert.rejects(recibirActualizacion(cambiada, "TEST", db), { code: "OPERACION_FINANCIERA_MODIFICADA" });
    });
    await t.test("un cliente nuevo llega en la transacción y una relación inválida revierte todo", async () => {
      const nueva = body("facturas", { clientes: [r("clientes", { cardCode: "C2", limiteCredito: null })],
        facturas: [r("facturas", { docEntry: 11, cardCode: "C2" })], facturaLineas: [], cuotas: [] });
      await recibirActualizacion(nueva, "TEST", db);
      assert.equal((await db.cliente.findUnique({ where: { cardCode: "C2" } })).creditLimit, null);
      const invalida = body("facturas", { facturas: [r("facturas", { docEntry: 12, cardCode: "NO_EXISTE" })], facturaLineas: [], cuotas: [] });
      await assert.rejects(recibirActualizacion(invalida, "TEST", db), { code: "RELACION_FINANCIERA_FALTANTE" });
      assert.equal(await db.factura.count({ where: { docEntry: 12 } }), 0);
      assert.equal(await db.finanzaRegistro.count({ where: { entidad: "facturas", clave: "[12]" } }), 0);
      assert.equal(await db.finanzaActualizacion.count({ where: { operacionId: invalida.operacionId } }), 0);
    });
    await t.test("no mezcla versiones ni monedas y mantiene nulos de pagos", async () => {
      const pago = body("pagos", { pagos: [r("pagos", { docEntry: 21, cardCode: "C1", total: null })], aplicacionesPagos: [] });
      const incorrecta = structuredClone(pago); incorrecta.versiones.pagos = randomUUID();
      await assert.rejects(recibirActualizacion(incorrecta, "TEST", db), { code: "VERSION_FINANCIERA_CAMBIO" });
      const moneda = structuredClone(pago); moneda.monedaLocal = "HNL";
      await assert.rejects(recibirActualizacion(moneda, "TEST", db), { code: "MONEDA_EMPRESA_DISTINTA" });
      await recibirActualizacion(pago, "TEST", db);
      assert.equal((await db.pago.findUnique({ where: { docEntry: 21 } })).total, null);
      assert.equal((await db.finanzaNormalizacion.findMany()).length, entidadesPeriodicas.length);
    });
  } finally { await db?.$disconnect(); await socket.stop(); await pg.close(); }
});
