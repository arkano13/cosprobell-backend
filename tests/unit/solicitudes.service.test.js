import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { crearServicioSolicitudes } = await import("../../src/modules/sincronizacion/solicitudes.service.js");
const { prisma } = await import("../../src/infrastructure/database/prisma.js");
after(() => prisma.$disconnect());

function preparar() {
  const datos = new Map(); let tiempo = Date.now(), cola = Promise.resolve();
  const repo = {
    leer: async empresa => structuredClone(datos.get(empresa) ?? {}),
    cambiar(empresa, fn) {
      const operacion = cola.then(() => {
        const { siguiente, resultado } = fn(structuredClone(datos.get(empresa) ?? {}));
        datos.set(empresa, structuredClone(siguiente)); return structuredClone(resultado);
      });
      cola = operacion.catch(() => {}); return operacion;
    },
  };
  return { s: crearServicioSolicitudes({ repo, ahora: () => new Date(tiempo) }), repo,
    avanzar: ms => { tiempo += ms; } };
}
const capacidades = { entidades: ["productos", "pedidos", "existencias"] };

test("requiere puente actualizado, agrupa clics concurrentes y persiste al recrear el servicio", async () => {
  const { s, repo } = preparar();
  await assert.rejects(s.solicitar("SAP", 1), { code: "PUENTE_PENDIENTE_ACTUALIZACION" });
  await s.consultar("SAP", capacidades);
  const jobs = await Promise.all(Array.from({ length: 20 }, () => s.solicitar("SAP", 1)));
  assert.equal(new Set(jobs.map(j => j.id)).size, 1);
  assert.equal(jobs[0].estado, "pendiente");
  assert.equal((await crearServicioSolicitudes({ repo }).estado("SAP")).solicitud.id, jobs[0].id);
  assert.equal((await s.estado("OTRA")).solicitud, null);
});

test("presupuestos y desconexión no completan el trabajo; confirmaciones repetidas son idempotentes", async () => {
  const { s, avanzar } = preparar(); await s.consultar("SAP", capacidades);
  const { id } = await s.solicitar("SAP", 5);
  await s.consultar("SAP", capacidades);
  await s.progreso("SAP", { id, completas: ["productos"] });
  avanzar(3600000);
  assert.equal((await s.solicitar("SAP", 9)).id, id);
  const continuacion = await s.consultar("SAP", capacidades);
  assert.deepEqual(continuacion.completas, ["productos"]);
  assert.equal(continuacion.estado, "sincronizando");
  await s.progreso("SAP", { id, completas: ["productos", "pedidos", "existencias"] });
  const final = (await s.estado("SAP")).solicitud;
  avanzar(10000);
  const repetido = await s.progreso("SAP", { id, completas: ["productos"], error: "ERROR_LOCAL" });
  assert.deepEqual(repetido, final);
  assert.equal(final.estado, "completado");
  assert.equal(await s.consultar("SAP", capacidades), null);
});

test("valida empresa, capacidades y rechaza progreso ajeno sin mutar", async () => {
  const { s } = preparar();
  await assert.rejects(s.estado(""), { code: "PUENTE_NO_CONFIGURADO" });
  await assert.rejects(s.consultar("SAP", { entidades: ["clientes", "clientes"] }), { code: "SOLICITUD_INVALIDA" });
  await assert.rejects(s.consultar("SAP", { entidades: ["facturas"] }), { code: "SOLICITUD_INVALIDA" });
  await s.consultar("SAP", capacidades); const j = await s.solicitar("SAP", 1);
  await assert.rejects(s.progreso("OTRA", { id: j.id, completas: [] }), { code: "SOLICITUD_NO_VIGENTE" });
  await assert.rejects(s.progreso("SAP", { id: j.id, completas: ["clientes"] }), { code: "SOLICITUD_INVALIDA" });
  await assert.rejects(s.progreso("SAP", { id: j.id, completas: [], error: "una contraseña" }), { code: "SOLICITUD_INVALIDA" });
  assert.deepEqual((await s.estado("SAP")).solicitud, j);
});

test("informa configuración reducida y permite nueva solicitud después de la espera", async () => {
  const { s, avanzar } = preparar(); await s.consultar("SAP", capacidades);
  await s.solicitar("SAP", 1);
  assert.equal(await s.consultar("SAP", { entidades: ["productos"] }), null);
  assert.equal((await s.estado("SAP")).solicitud.error, "ENTIDADES_DESHABILITADAS");
  await assert.rejects(s.solicitar("SAP", 1), { code: "SINCRONIZACION_MUY_RECIENTE" });
  avanzar(61000);
  assert.deepEqual((await s.solicitar("SAP", 1)).entidades, ["productos"]);
});
