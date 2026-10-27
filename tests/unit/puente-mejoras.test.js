import test from "node:test";
import assert from "node:assert/strict";
import { crearControl } from "../../puente/control.js";
import { crearClienteSap } from "../../puente/sap.client.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { entidadesHabilitadas } from "../../puente/entidades.js";
import { CONSULTA_EXISTENCIAS } from "../../puente/existencias.sql.js";
import { opcionesPuente, alcanceSeleccion } from "../../puente/opciones.js";
import { configurar } from "../../puente/config.js";

const base = { SAP_SERVICE_LAYER_URL: "https://sap.test/b1s/v1", BACKEND_URL: "https://backend.test", SAP_COMPANY_DB: "TEST",
  SAP_USER: "test", SAP_PASSWORD: "ficticia", BRIDGE_API_KEY: "x".repeat(40), BRIDGE_STATE_DIR: ".bridge-state" };
test("turnos comparten límite global y permiten terminar una página compuesta", async () => {
  const c = crearControl({ maxConsultas: 4, maxDuracionMs: 10000, pausaMs: 100 }, { dormir: async () => {} });
  c.iniciarTurno(1);
  await c.antesDeConsultar(); await c.antesDeConsultar();
  assert.throws(() => c.comprobarTurno(), { code: "PRESUPUESTO_ENTIDAD_AGOTADO" });
  c.finalizarTurno(); c.iniciarTurno(2);
  c.comprobarTurno(); await c.antesDeConsultar(); await c.antesDeConsultar();
  assert.throws(() => c.comprobarTurno(), { code: "PRESUPUESTO_AGOTADO" });
  await assert.rejects(c.antesDeConsultar(), { code: "PRESUPUESTO_AGOTADO" });
  assert.equal(c.resumen().consultasSap, 4);
});
test("selección dirigida valida entidades y conserva dependencias iniciales", () => {
  const entidades = [{ nombre: "clientes" }, { nombre: "productos" }, { nombre: "facturasPreparacion", dependencias: ["clientes", "productos"] }];
  const o = opcionesPuente(["--once", "--forzar", "--entidades=facturasPreparacion"], entidades);
  assert.deepEqual([...o.seleccion], ["facturasPreparacion"]);
  assert.deepEqual([...alcanceSeleccion(o.seleccion, entidades, [{ estado: {} }, { estado: { ultimoCompleto: "2026-10-01" } }, { estado: {} }])], ["facturasPreparacion", "clientes"]);
  for (const args of [["--entidades="], ["--entidades=otra"], ["--estado", "--forzar"], ["--once", "--watch"]]) assert.throws(() => opcionesPuente(args, entidades));
  assert.throws(() => opcionesPuente(["--entidades=productos"], entidades, ["productos"]), { code: "ENTIDAD_PAUSADA" });
  assert.equal(opcionesPuente(["--estado", "--entidades=productos"], entidades, ["productos"]).estado, true);
});
test("pausas y límites nuevos requieren nombres y valores válidos", () => {
  const c = configurar({ ...base, BRIDGE_PAUSED_ENTITIES: "existencias,productos", BRIDGE_MAX_REQUESTS_PER_ENTITY: "7" });
  assert.deepEqual(c.pausadas, ["existencias", "productos"]); assert.equal(c.maxConsultasEntidad, 7);
  for (const BRIDGE_PAUSED_ENTITIES of ["inexistente", "existencias,existencias"]) assert.throws(() => configurar({ ...base, BRIDGE_PAUSED_ENTITIES }));
});

test("almacenes se validan de forma recuperable, una vez por recorrido", async () => {
  const entidad = entidadesHabilitadas({ inventarioHabilitado: true, modoExistencias: "sql-01-02" }).find(e => e.nombre === "existencias");
  const almacen = { estado: { secuencia: 0, cursor: null, pendiente: null }, async guardar(s) { this.estado = structuredClone(s); } };
  const verificaciones = [];
  const cfg = { sapUrl: "https://sap.test/b1s/v1", empresa: "TEST", modoExistencias: "sql-01-02" };
  const transporte = async (url) => {
    if (url.endsWith("/Login")) return new Response("{}", { headers: { "Set-Cookie": "B1SESSION=ficticia" } });
    const codigo = /Warehouses\('([^']+)'\)/.exec(url)?.[1];
    if (codigo) { verificaciones.push(codigo); return Response.json({ WarehouseCode: codigo }); }
    return Response.json({ SqlText: CONSULTA_EXISTENCIAS.SqlText, value: [] });
  };
  const backend = { estado: async () => 0, recorrido: async () => {} };
  const control = maxConsultas => crearControl({ maxConsultas, maxDuracionMs: 60000, pausaMs: 100 }, { dormir: async () => {} });
  cfg.control = control(2);
  await assert.rejects(sincronizar({ config: cfg, almacen, entidad, backend, sap: crearClienteSap(cfg, transporte) }), { code: "PRESUPUESTO_AGOTADO" });
  assert.deepEqual(almacen.estado.verificacionAlmacenes.codigos, ["01"]);
  const recorridoId = almacen.estado.recorridoId;
  cfg.control = control(4);
  const r = await sincronizar({ config: cfg, almacen, entidad, backend, sap: crearClienteSap(cfg, transporte) });
  assert.equal(r.completo, true); assert.deepEqual(verificaciones, ["01", "02"]);
  assert.equal(almacen.estado.recorridoId, null); assert.equal(almacen.estado.verificacionAlmacenes, null);
  assert.ok(recorridoId);
  cfg.control = control(4);
  await sincronizar({ config: cfg, almacen, entidad, backend, sap: crearClienteSap(cfg, transporte) });
  assert.deepEqual(verificaciones, ["01", "02", "01", "02"]);
});
