import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { actualizarTandaGet, entidadActualizacion } from "../../puente/actualizar-finanzas-get.js";
import { definicionesGetFinanzas, leerJsonFinancieroGet } from "../../puente/finanzas.get.js";
import { fuenteFinanzas } from "../../puente/finanzas.sincronizar.js";

test("actualizar GET: solo admite cabeceras/catálogos explícitos", () => {
  assert.equal(entidadActualizacion(["--entidad=facturas"]), "facturas");
  for (const args of [[], ["--entidad=movimientos"], ["--entidad=partidas"], ["--entidad=facturas", "--todo"], ["--entidad=facturas=otra"]]) {
    assert.throws(() => entidadActualizacion(args));
  }
});

test("actualizar GET: abre otra carga de facturas terminadas, respeta el presupuesto y retoma el mismo recorrido", async () => {
  const config = { empresa: "TEST", desde: "1900-01-01", monedaLocal: "LPS", monedaSistema: "USD" };
  const def = definicionesGetFinanzas(config).facturas;
  const previo = randomUUID();
  const almacen = { nuevo: false, estado: { recorrido: null, secuencia: 1, cursor: null, pendiente: null,
    ultimoRecorrido: previo, ultimoInicio: "2026-10-27T00:00:00Z", ultimoCompleto: "2026-10-28T00:00:00Z",
    fuente: fuenteFinanzas(def, config) }, async guardar(s) { this.estado = structuredClone(s); } };
  let remoto = { empresa: "TEST", recorridoId: previo, secuencia: 1, finalizadoEn: "2026-10-28T00:00:00Z" };
  const r = { DocEntry: 17235, DocNum: 1018395, Series: 1, CardCode: "C1", DocDate: "2026-10-28", DocDueDate: "2026-11-28",
    TaxDate: "2026-10-28", DocCurrency: "LPS", DocTotal: "100.20", DocTotalFc: "0", DocTotalSys: "4.50",
    PaidToDate: "0", PaidToDateFC: "0", PaidToDateSys: "0", DocumentStatus: "bost_Open", SalesPersonCode: -1,
    PaymentGroupCode: -1, TransNum: 10, Cancelled: "tNO", CancelStatus: "csNo" };
  let lecturas = 0, limitar = true, envios = 0;
  const sap = { leerRecursoFinanciero: async (ruta, lector) => {
    assert.match(ruta, /^Invoices\?/);
    assert.equal(lector, leerJsonFinancieroGet);
    lecturas++;
    if (lecturas > 1 && limitar) throw Object.assign(new Error(), { code: "PRESUPUESTO_AGOTADO" });
    return lector(Response.json({ value: lecturas === 1 ? [r] : [] }));
  } };
  const backend = async (entidad, accion, dato) => {
    assert.equal(entidad, "facturas");
    if (accion === "estado") return remoto;
    if (accion === "iniciar") {
      assert.equal(dato.lectura, "get_parcial");
      assert.equal(dato.modo, "completo");
      assert.equal(dato.ventana, "1900-01-01");
      if (remoto.recorridoId !== dato.recorridoId) remoto = { empresa: "TEST", recorridoId: dato.recorridoId, secuencia: 0, finalizadoEn: null };
      return { recorridoId: dato.recorridoId };
    }
    if (accion === "lote") {
      assert.equal(dato.registros[0].docEntry, 17235);
      remoto.secuencia = dato.secuencia; envios++;
      return { secuencia: dato.secuencia, recibidos: dato.registros.length, repetido: false };
    }
    if (accion === "finalizar") { remoto.finalizadoEn = new Date(); return { recorridoId: dato.recorridoId, completo: true }; }
    assert.fail(accion);
  };
  const entrada = { config, def, almacen, sap, backend };
  assert.equal(await actualizarTandaGet(entrada), false);
  const enCurso = almacen.estado.recorrido.recorridoId;
  assert.notEqual(enCurso, previo);
  assert.equal(envios, 1);
  limitar = false;
  assert.equal(await actualizarTandaGet(entrada), true);
  assert.equal(almacen.estado.ultimoRecorrido, enCurso);
  assert.equal(almacen.estado.recorrido, null);
  assert.equal(envios, 1, "no reinicia ni duplica la página confirmada");
});
