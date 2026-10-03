import test from "node:test";
import assert from "node:assert/strict";
import { clasificar, codigoCaja, porPasar, repartirEnCajas, cajaParaUsarAntes, textoAsignacion, MINUTOS_PARA_ESTABILIZAR } from "../../src/modules/inventario/inventario.calculo.js";

const ahora = Date.parse("2026-10-01T15:00:00Z");
const hace = (minutos) => new Date(ahora - minutos * 60_000);
const base = { sap: 0, grande: 0, pequena: 0, sinEntrega: 0, adelantado: 0, activo: true, sapCambioEn: null };

test("código de caja con seis cifras", () => {
  assert.equal(codigoCaja(123), "CJ-000123");
  assert.equal(codigoCaja(1234567), "CJ-1234567");
});

test("cuadra: SAP = grande + pequeña + preparado sin entrega", () => {
  assert.deepEqual(clasificar({ ...base, sap: 130, grande: 100, pequena: 24, sinEntrega: 6 }, ahora),
    { enSap: 130, diferencia: 0, faltaEnSap: 0, estable: true, estado: "al_dia" });
});

test("SAP tiene más: por ubicar si está en el inventario, conteo inicial si todavía no", () => {
  assert.equal(clasificar({ ...base, sap: 100, grande: 0 }, ahora).estado, "por_ubicar");
  assert.equal(clasificar({ ...base, sap: 100, activo: false }, ahora).estado, "conteo_inicial");
});

test("SAP tiene menos: por descontar", () => {
  const c = clasificar({ ...base, sap: 20, grande: 100, pequena: 0 }, ahora);
  assert.equal(c.diferencia, -80); assert.equal(c.estado, "por_descontar");
});

test("un cambio reciente en SAP espera antes de avisar, en los dos sentidos", () => {
  const reciente = hace(MINUTOS_PARA_ESTABILIZAR - 1), viejo = hace(MINUTOS_PARA_ESTABILIZAR);
  assert.equal(clasificar({ ...base, sap: 120, grande: 100, sapCambioEn: reciente }, ahora).estado, "actualizando");
  assert.equal(clasificar({ ...base, sap: 80, grande: 100, sapCambioEn: reciente }, ahora).estado, "actualizando");
  assert.equal(clasificar({ ...base, sap: 80, grande: 100, sapCambioEn: viejo }, ahora).estado, "por_descontar");
  // Un producto que cuadra no queda "actualizando" aunque SAP haya cambiado.
  assert.equal(clasificar({ ...base, sap: 100, grande: 100, sapCambioEn: reciente }, ahora).estado, "al_dia");
});

test("lo recibido antes que SAP cubre la diferencia negativa hasta que SAP lo registra", () => {
  const c = clasificar({ ...base, sap: 0, grande: 100, adelantado: 100 }, ahora);
  assert.deepEqual([c.diferencia, c.faltaEnSap, c.estado], [0, 100, "al_dia"]);
  // Adelantado de 100 pero SAP descontó 30 de otra cosa: lo adelantado no tapa ese descuento.
  const d = clasificar({ ...base, sap: 70, grande: 200, adelantado: 100 }, ahora);
  assert.deepEqual([d.diferencia, d.faltaEnSap, d.estado], [-30, 100, "por_descontar"]);
});

test("SAP con decimales se redondea a unidades", () => {
  assert.equal(clasificar({ ...base, sap: 99.6, grande: 100 }, ahora).estado, "al_dia");
});

test("repartir: primero la caja abierta, después las cerradas en orden de llegada", () => {
  const cajas = [
    { id: 1, codigo: "CJ-000001", unidades: 20, unidadesIniciales: 20 },
    { id: 2, codigo: "CJ-000002", unidades: 5, unidadesIniciales: 20 },
    { id: 3, codigo: "CJ-000003", unidades: 20, unidadesIniciales: 20 },
    { id: 4, codigo: "CJ-000004", unidades: 0, unidadesIniciales: 20 },
  ];
  assert.deepEqual(repartirEnCajas(cajas, 30), [
    { cajaId: 2, codigo: "CJ-000002", unidades: 5 }, { cajaId: 1, codigo: "CJ-000001", unidades: 20 }, { cajaId: 3, codigo: "CJ-000003", unidades: 5 }]);
  assert.throws(() => repartirEnCajas(cajas, 46), { code: "LOTE_INSUFICIENTE", statusCode: 409 });
});

test("usar antes: la caja abierta o la que vence primero", () => {
  const escaneada = { id: 1, unidades: 20, unidadesIniciales: 20, vencimiento: new Date("2027-05-01") };
  const abierta = { id: 2, unidades: 7, unidadesIniciales: 20, vencimiento: new Date("2027-05-01") };
  const vencePrimero = { id: 3, unidades: 20, unidadesIniciales: 20, vencimiento: new Date("2027-01-01") };
  const vaciaQueVence = { id: 4, unidades: 0, unidadesIniciales: 20, vencimiento: new Date("2026-11-01") };
  assert.equal(cajaParaUsarAntes(escaneada, [escaneada, abierta]).id, 2);
  assert.equal(cajaParaUsarAntes(escaneada, [escaneada, abierta, vencePrimero, vaciaQueVence]).id, 3);
  assert.equal(cajaParaUsarAntes(vencePrimero, [escaneada, abierta, vencePrimero]), null);
  // Una caja abierta no "le gana" a otra abierta: solo se sugiere si la escaneada está cerrada.
  assert.equal(cajaParaUsarAntes({ ...escaneada, unidades: 3 }, [abierta]), null);
});

test("traspaso de la 01 a la 02 que SAP ya registró y falta marcar", () => {
  // SAP pasó 24 de la 01 a la 02: en la 01 tiene 24 menos que las cajas y en la 02, 24 más.
  assert.equal(porPasar({ sapGrande: 96, sapPequena: 30, grande: 120, pequena: 6 }), 24);
  // Lo preparado sin entregar sigue en la 02 para SAP: no es un traspaso.
  assert.equal(porPasar({ sapGrande: 96, sapPequena: 30, grande: 120, pequena: 0, sinEntrega: 6 }), 24);
  // Solo una de las dos diferencias (una entrada a la 02 o una salida de la 01) no es un traspaso.
  assert.equal(porPasar({ sapGrande: 120, sapPequena: 30, grande: 120, pequena: 6 }), 0);
  assert.equal(porPasar({ sapGrande: 96, sapPequena: 6, grande: 120, pequena: 6 }), 0);
  // Traspaso y salida a la vez: cuenta lo menor.
  assert.equal(porPasar({ sapGrande: 84, sapPequena: 30, grande: 120, pequena: 6 }), 24);
  // Sin almacén asignado a alguna bodega no se calcula.
  assert.equal(porPasar({ sapGrande: null, sapPequena: 30, grande: 120, pequena: 6 }), 0);
  assert.equal(porPasar({ sapGrande: 95.6, sapPequena: 30.2, grande: 120, pequena: 6 }), 24);
});

test("texto de una asignación para el historial", () => {
  assert.equal(textoAsignacion([{ tipo: "lote", lote: "L2408-090", unidades: 100 }, { tipo: "lote", lote: null, unidades: 2 }, { tipo: "pequena", unidades: 4 }]),
    "L2408-090: 100 · sin lote: 2 · pequeña: 4");
});
