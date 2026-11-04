// PostgreSQL WASM efímero: no usa DATABASE_URL, SAP ni la base de Railway.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { normalizarTanda } from "../../src/modules/finanzas/finanzas.normalizar.js";
import { ENTIDADES_NORMALIZABLES, TABLAS_FINANZAS } from "../../src/modules/finanzas/finanzas.tablas.js";
import { leerFinanzas, leerLegadoFinanciero } from "../../src/modules/finanzas/finanzas.lectura-tablas.js";
import { claveRegistro } from "../../src/shared/finanzas/contratos.js";
import { ejemploFinanciero } from "../helpers/finanzas-normalizadas.js";

test("PostgreSQL: migración y conversión financiera por tandas, fiel, reanudable y aislada", { timeout: 120000 }, async t => {
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 1 });
  let db;
  try {
    const carpetas = (await readdir(new URL("../../prisma/migrations/", import.meta.url))).filter(n => /^\d/.test(n)).sort();
    for (const carpeta of carpetas.filter(n => !n.includes("normalizar_finanzas"))) {
      await pg.exec(await readFile(new URL(`../../prisma/migrations/${carpeta}/migration.sql`, import.meta.url), "utf8"));
    }
    // Una fila operativa anterior a la migración debe sobrevivir, con su precisión monetaria.
    await pg.exec(`INSERT INTO clientes ("cardCode", "cardName", "creditLimit", "sincronizadoEn")
      VALUES ('C1', 'Nombre operativo reciente', 0.1, '2026-11-03');`);
    await pg.exec(await readFile(new URL("../../prisma/migrations/20261103120000_normalizar_finanzas/migration.sql", import.meta.url), "utf8"));
    await pg.exec(`INSERT INTO conteos (nombre, "iniciadoPor") VALUES ('Conteo anterior a la conversión', 'Prueba local');
      INSERT INTO conteo_lecturas ("conteoId", "operacionId", codigo, "itemCode") VALUES (1, 'lectura-previa', 'ABC', 'P1');`);
    assert.equal((await pg.query(`SELECT "creditLimit"::text AS importe FROM clientes WHERE "cardCode"='C1'`)).rows[0].importe, "0.100000");
    await socket.start();
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@${socket.getServerConn()}/test_finanzas`, max: 1 }),
      log: [{ level: "query", emit: "event" }] });
    let escriturasMovimientos = 0;
    db.$on("query", consulta => { if (consulta.query.startsWith('INSERT INTO "movimientos_contables"')) escriturasMovimientos++; });
    const versiones = {};
    const registros = {
      empresa: [ejemploFinanciero("empresa", { codigo: "TEST", monedaLocal: "LPS", monedaSistema: "USD" })],
      clientes: [ejemploFinanciero("clientes", { cardCode: "C1", nombre: null, limiteCredito: null, ruta: "Ruta Norte" })],
      vendedores: [ejemploFinanciero("vendedores", { codigo: -1, nombre: null })],
      condicionesPago: [ejemploFinanciero("condicionesPago", { codigo: -1 })],
      facturas: [1, 4].map(docEntry => ejemploFinanciero("facturas", { docEntry, docNum: docEntry, cardCode: "C1", cancelado: "C" })),
      notasCredito: [ejemploFinanciero("notasCredito", { docEntry: 2, cardCode: "C1" })],
      facturaLineas: [ejemploFinanciero("facturaLineas", { docEntry: 1, linea: 0, cardCode: "C1", itemCode: null })],
      notaCreditoLineas: [ejemploFinanciero("notaCreditoLineas", { docEntry: 2, linea: 0, cardCode: "C1" })],
      cuotas: [ejemploFinanciero("cuotas", { docEntry: 1, cardCode: "C1", totalFC: null })],
      pagos: [ejemploFinanciero("pagos", { docEntry: 3, cardCode: "C1", total: null })],
      aplicacionesPagos: [
        ejemploFinanciero("aplicacionesPagos", { pagoEntry: 3, linea: 0, cardCode: "C1", tipo: "it_Invoice", documento: 1 }),
        ejemploFinanciero("aplicacionesPagos", { pagoEntry: 3, linea: 1, cardCode: "C1", tipo: "it_CredItnote", documento: 2 }),
        ejemploFinanciero("aplicacionesPagos", { pagoEntry: 3, linea: 2, cardCode: "C1", tipo: "it_Invoice", documento: 999 }),
      ],
      movimientos: [
        ejemploFinanciero("movimientos", { transId: 74761, linea: 3, cardCode: "_SYS00000000347", debe: "8682903.86", haber: "0" }),
        ejemploFinanciero("movimientos", { transId: 74762, linea: 3, cardCode: "C1", debe: "0", haber: "8682903.86" }),
      ],
    };
    async function cargar(entidad, datos) {
      const version = randomUUID();
      versiones[entidad] = version;
      const valores = { empresa: "TEST", recorridoId: version, activoId: version,
        configuracion: { lectura: "get_parcial", desde: "1900-01-01" }, iniciadoEn: new Date("2026-10-27"),
        finalizadoEn: new Date("2026-10-28"), publicadoEn: new Date("2026-10-28"), cantidad: datos.length };
      await db.finanzaControl.upsert({ where: { entidad }, create: { entidad, ...valores }, update: valores });
      for (const datosFila of datos) await db.finanzaRegistro.create({ data: {
        entidad, version, clave: claveRegistro(entidad, datosFila), datos: datosFila,
        cardCode: datosFila.cardCode ?? null, fecha: datosFila.fecha ? new Date(datosFila.fecha) : null,
        debe: datosFila.debe ?? null, haber: datosFila.haber ?? null,
      } });
      return version;
    }
    for (const entidad of ENTIDADES_NORMALIZABLES) await cargar(entidad, registros[entidad]);
    const cantidadRaw = await db.finanzaRegistro.count();

    await t.test("convierte las doce entidades, retoma tandas y conserva nombres operativos", async () => {
      for (const entidad of ENTIDADES_NORMALIZABLES) {
        let resultado, tandas = 0;
        do {
          resultado = await normalizarTanda(db, entidad, entidad === "movimientos" ? 50 : 1);
          assert.ok(++tandas <= 5);
          if (entidad === "facturas" && tandas === 1) {
            assert.equal(resultado.completo, false);
            const filas = await leerFinanzas(db, { entidad, version: versiones[entidad] }, "listar", 100);
            assert.equal(filas.length, 2, "usa el JSON hasta terminar la entidad");
            await assert.rejects(leerLegadoFinanciero(db, ["facturas"], () => assert.fail("no debe consultar tablas parciales")), { code: "FINANZAS_TABLAS_PENDIENTES" });
          }
        } while (!resultado.completo);
        const tabla = db[TABLAS_FINANZAS[entidad].modelo];
        assert.equal(await tabla.count({ where: { finVersion: versiones[entidad] } }), registros[entidad].length, entidad);
        assert.equal((await normalizarTanda(db, entidad)).completo, true);
        assert.equal(await tabla.count({ where: { finVersion: versiones[entidad] } }), registros[entidad].length, "no duplica");
        const filas = await leerFinanzas(db, { entidad, version: versiones[entidad] }, "listar", 100);
        assert.equal(filas.length, registros[entidad].length, entidad);
      }
      const cliente = await db.cliente.findUnique({ where: { cardCode: "C1" } });
      assert.equal(cliente.cardName, "Nombre operativo reciente");
      assert.equal(cliente.finNombre, null);
      assert.equal(cliente.creditLimit, null);
      assert.equal(cliente.valid, true, "el estado operativo reciente no se revierte");
      assert.equal(cliente.finActivo, "N", "el estado recibido se conserva por separado");
      assert.equal(escriturasMovimientos, 1, "las dos filas se escriben en un solo INSERT");
      const aplicaciones = await db.pagoFactura.findMany({ orderBy: { lineNum: "asc" } });
      assert.deepEqual(aplicaciones.map(r => r.facturaDocEntry), [1, null, null]);
      assert.deepEqual(aplicaciones.map(r => r.documentoSap), [1, 2, 999]);
      assert.equal((await db.factura.findUnique({ where: { docEntry: 1 } })).cancelled, true);
      assert.equal(await db.finanzaRegistro.count(), cantidadRaw, "no borra el origen");
      assert.equal(await db.pedido.count(), 0, "no crea preparaciones");
      const conteo = await db.conteo.findUnique({ where: { id: 1 }, include: { lecturas: true } });
      assert.equal(conteo.nombre, "Conteo anterior a la conversión");
      assert.equal(conteo.estado, "en_curso");
      assert.equal(conteo.lecturas.length, 1, "la conversión financiera no modifica el conteo");
      const legado = await leerLegadoFinanciero(db, ["facturas", "facturaLineas", "pagos", "aplicacionesPagos"], (tx, versiones) => tx.factura.findFirst({
        where: { docEntry: 1, finVersion: versiones.facturas },
        include: { lineas: { where: { finVersion: versiones.facturaLineas } }, aplicaciones: {
          where: { finVersion: versiones.aplicacionesPagos, pago: { finVersion: versiones.pagos } }, include: { pago: true },
        } },
      }));
      assert.equal(legado.lineas.length, 1);
      assert.equal(legado.aplicaciones.length, 1);
      const total = await leerFinanzas(db, { entidad: "movimientos", version: versiones.movimientos }, "sumar");
      assert.equal(String(total._sum.debe), "8682903.86");
    });

    await t.test("un error revierte filas y cursor; una versión nueva no muestra filas antiguas", async () => {
      const anterior = versiones.movimientos;
      await cargar("movimientos", [ejemploFinanciero("movimientos", { transId: 74761, linea: 3, cardCode: "C1", debe: "10.25" })]);
      await db.$executeRawUnsafe(`CREATE FUNCTION sabotear_normalizacion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.debe := NEW.debe + 1; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER sabotaje BEFORE INSERT OR UPDATE ON movimientos_contables
        FOR EACH ROW EXECUTE FUNCTION sabotear_normalizacion()`);
      await assert.rejects(normalizarTanda(db, "movimientos"), { code: "VERIFICACION_FINANCIERA_FALLIDA" });
      const avance = await db.finanzaNormalizacion.findUnique({ where: { entidad: "movimientos" } });
      assert.equal(avance.version, anterior);
      assert.equal(await db.movimientoContable.count({ where: { finVersion: versiones.movimientos } }), 0);
      await db.$executeRawUnsafe("DROP TRIGGER sabotaje ON movimientos_contables");
      assert.equal((await normalizarTanda(db, "movimientos")).completo, true);
      const nuevas = await leerFinanzas(db, { entidad: "movimientos", version: versiones.movimientos }, "listar", 100);
      assert.equal(nuevas.length, 1);
      assert.equal(nuevas[0].datos.debe, "10.25");
      assert.equal(await db.movimientoContable.count(), 2, "conserva el histórico sin incluirlo en la lectura publicada");
    });

    await t.test("una relación faltante detiene la tanda sin fabricar documentos", async () => {
      await cargar("cuotas", [ejemploFinanciero("cuotas", { docEntry: 999, cardCode: "C1" })]);
      await assert.rejects(normalizarTanda(db, "cuotas"), e => {
        assert.equal(e.code, "RELACION_FINANCIERA_FALTANTE");
        assert.deepEqual(e.detalle, { modelo: "factura", campo: "docEntry", faltantes: [999], totalFaltantes: 1 });
        return true;
      });
      assert.equal(await db.factura.count({ where: { docEntry: 999 } }), 0);
    });

    await t.test("una entidad vacía publica cero y excluye las filas de su versión anterior", async () => {
      await cargar("condicionesPago", []);
      assert.equal((await normalizarTanda(db, "condicionesPago")).cantidad, 0);
      assert.deepEqual(await leerFinanzas(db, { entidad: "condicionesPago", version: versiones.condicionesPago }, "listar", 100), []);
      assert.equal(await db.condicionPago.count(), 1, "conserva la fila histórica sin incluirla en la versión vacía");
    });
  } finally {
    await db?.$disconnect();
    await socket.stop();
    await pg.close();
  }
});
