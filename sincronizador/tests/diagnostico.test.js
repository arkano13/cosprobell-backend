import test from "node:test";
import assert from "node:assert/strict";

import { diagnosticar, formatearDiagnostico } from "../src/diagnostico.js";

const CON_CODIGO = "BarCode ne null and BarCode ne ''";

function serviceLayerFalso({ conteos, ordenes = [], articulos = [], fallas = {} }) {
  return {
    async iniciarSesion() {
      return { version: "1000180", minutosSesion: 30 };
    },
    async contar(entidad, { filter } = {}) {
      const clave = filter ? `${entidad}|${filter}` : entidad;

      if (fallas[clave]) {
        throw new Error(fallas[clave]);
      }

      return conteos[clave];
    },
    async leerPrimeros(entidad) {
      return entidad === "Orders" ? ordenes : articulos;
    },
  };
}

function conteosBase(cambios = {}) {
  return {
    Warehouses: 100,
    ItemGroups: 35,
    Items: 1200,
    "Items|Valid eq 'tYES'": 900,
    [`Items|${CON_CODIGO}`]: 850,
    BarCodes: 850,
    UnitOfMeasurements: 4,
    UnitOfMeasurementGroups: 3,
    "Orders|DocumentStatus eq 'bost_Open'": 12,
    ...cambios,
  };
}

const ordenesCerradas = [
  { DocNum: 5010, DocDate: "2026-09-27", DocumentStatus: "bost_Close", Cancelled: "tNO" },
  { DocNum: 5009, DocDate: "2026-09-27", DocumentStatus: "bost_Close", Cancelled: "tNO" },
];

test("advierte cuando faltan códigos de barras y órdenes abiertas", async () => {
  const resultado = await diagnosticar(
    serviceLayerFalso({
      conteos: conteosBase({
        [`Items|${CON_CODIGO}`]: 0,
        BarCodes: 0,
        "Orders|DocumentStatus eq 'bost_Open'": 0,
      }),
      ordenes: ordenesCerradas,
    })
  );

  assert.equal(resultado.conteos.bodegas.valor, 100);
  assert.equal(resultado.alertas.length, 3);
  assert.match(resultado.alertas[0], /No hay códigos de barras cargados en SAP/);
  assert.match(resultado.alertas[1], /No hay órdenes de venta abiertas/);
  assert.match(resultado.alertas[2], /Las 2 órdenes más recientes ya están cerradas/);

  const texto = formatearDiagnostico(resultado);
  assert.match(texto, /Bodegas: 100/);
  assert.match(texto, /N\.º 5010 · 2026-09-27 · bost_Close/);
  assert.match(texto, /ATENCIÓN:/);
});

test("no alerta cuando hay códigos y órdenes abiertas", async () => {
  const resultado = await diagnosticar(
    serviceLayerFalso({
      conteos: conteosBase(),
      ordenes: [{ ...ordenesCerradas[0], DocumentStatus: "bost_Open" }],
    })
  );

  assert.deepEqual(resultado.alertas, []);
  assert.match(formatearDiagnostico(resultado), /Sin alertas\./);
});

test("señala pocos artículos con código y posibles códigos por unidad", async () => {
  const resultado = await diagnosticar(
    serviceLayerFalso({
      conteos: conteosBase({ [`Items|${CON_CODIGO}`]: 100, BarCodes: 260 }),
      articulos: [
        {
          ItemCode: "A1",
          ItemName: "Agua",
          BarCode: "0012345678905",
          ItemBarCodeCollection: [
            { Barcode: "0012345678905", UoMEntry: 1 },
            { Barcode: "1001234567890", UoMEntry: 5 },
          ],
        },
      ],
    })
  );

  assert.match(resultado.alertas[0], /Solo 100 de 900 artículos activos/);
  assert.match(resultado.alertas[1], /códigos por unidad/);
  assert.match(
    formatearDiagnostico(resultado),
    /A1 · Agua · principal 0012345678905 · por unidad: 0012345678905 \(unidad 1\), 1001234567890 \(unidad 5\)/
  );
});

test("una consulta no disponible no detiene el diagnóstico", async () => {
  const resultado = await diagnosticar(
    serviceLayerFalso({
      conteos: conteosBase(),
      fallas: { UnitOfMeasurements: "GET UnitOfMeasurements respondió 403: sin permiso" },
    })
  );

  assert.equal(resultado.conteos.unidades.error, "GET UnitOfMeasurements respondió 403: sin permiso");
  assert.equal(resultado.conteos.gruposUnidades.valor, 3);
  assert.match(formatearDiagnostico(resultado), /Unidades de medida: no disponible \(GET/);
});

test("falla si no puede iniciar sesión en SAP", async () => {
  const serviceLayer = serviceLayerFalso({ conteos: {} });
  serviceLayer.iniciarSesion = async () => {
    throw new Error("SAP rechazó el inicio de sesión (401)");
  };

  await assert.rejects(diagnosticar(serviceLayer), /SAP rechazó el inicio de sesión/);
});
