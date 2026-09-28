import test from "node:test";
import assert from "node:assert/strict";

import { leerConfiguracion } from "../src/config.js";

const completa = {
  SAP_SL_URL: "https://servidor-sap:50000/b1s/v1/",
  SAP_COMPANY_DB: "EMPRESA_PRUEBA",
  SAP_USER: "integracion",
  SAP_PASSWORD: "clave-secreta-sap",
  BACKEND_URL: "https://backend.example.com/",
  BRIDGE_SECRET: "s".repeat(40),
};

test("lee una configuración completa para sincronizar", () => {
  const config = leerConfiguracion(completa, { requiereBackend: true });

  assert.equal(config.serviceLayerUrl, "https://servidor-sap:50000/b1s/v1");
  assert.equal(config.companyDb, "EMPRESA_PRUEBA");
  assert.equal(config.backendUrl, "https://backend.example.com");
  assert.equal(config.secreto, completa.BRIDGE_SECRET);
  assert.ok(Object.isFrozen(config));
});

test("el diagnóstico no necesita backend ni secreto", () => {
  const { BACKEND_URL, BRIDGE_SECRET, ...soloSap } = completa;

  const config = leerConfiguracion(soloSap, { requiereBackend: false });

  assert.equal(config.backendUrl, null);
  assert.equal(config.secreto, null);
});

test("lista todas las variables faltantes", () => {
  assert.throws(
    () => leerConfiguracion({ ...completa, SAP_USER: " ", BACKEND_URL: "" }, { requiereBackend: true }),
    (error) => {
      assert.match(error.message, /SAP_USER: falta el valor/);
      assert.match(error.message, /BACKEND_URL: falta el valor/);
      return true;
    }
  );
});

test("exige HTTPS salvo en la propia máquina", () => {
  assert.throws(
    () => leerConfiguracion({ ...completa, SAP_SL_URL: "http://servidor-sap:50000/b1s/v1" }, { requiereBackend: false }),
    /Service Layer debe usarse con HTTPS/
  );

  assert.throws(
    () => leerConfiguracion({ ...completa, BACKEND_URL: "http://backend.example.com" }, { requiereBackend: true }),
    /el backend debe usarse con HTTPS/
  );

  const local = leerConfiguracion(
    { ...completa, SAP_SL_URL: "http://127.0.0.1:50000/b1s/v2", BACKEND_URL: "http://localhost:3000" },
    { requiereBackend: true }
  );

  assert.equal(local.serviceLayerUrl, "http://127.0.0.1:50000/b1s/v2");
});

test("exige la ruta de Service Layer", () => {
  assert.throws(
    () => leerConfiguracion({ ...completa, SAP_SL_URL: "https://servidor-sap:50000/" }, { requiereBackend: false }),
    /debe terminar en \/b1s\/v1 o \/b1s\/v2/
  );
});

test("rechaza un secreto corto sin mostrar ningún valor", () => {
  assert.throws(
    () => leerConfiguracion({ ...completa, BRIDGE_SECRET: "corto" }, { requiereBackend: true }),
    (error) => {
      assert.match(error.message, /BRIDGE_SECRET: debe tener al menos 32 caracteres/);
      assert.equal(error.message.includes("corto"), false);
      assert.equal(error.message.includes(completa.SAP_PASSWORD), false);
      return true;
    }
  );
});
