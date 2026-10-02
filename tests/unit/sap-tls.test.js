import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { EventEmitter } from "node:events";
import { configurar } from "../../puente/config.js";
import { crearTransporteSap } from "../../puente/sap-tls.js";

const env = { SAP_SERVICE_LAYER_URL: "https://sap.example/b1s/v1", SAP_COMPANY_DB: "XPRUEBAS2026",
  SAP_USER: "test", SAP_PASSWORD: "test", BACKEND_URL: "https://backend.example", BRIDGE_API_KEY: "x".repeat(40), BRIDGE_STATE_DIR: ".bridge-state" };
test("excepción TLS requiere activación, huella y sociedad de pruebas", () => {
  assert.equal(configurar(env).huellaSap, null);
  assert.throws(() => configurar({ ...env, SAP_TLS_TEST_EXCEPTION: "true" }));
  assert.throws(() => configurar({ ...env, SAP_TLS_TEST_EXCEPTION: "true", SAP_TLS_CERT_SHA256: "AA".repeat(32), SAP_COMPANY_DB: "REAL" }));
  assert.equal(configurar({ ...env, SAP_TLS_TEST_EXCEPTION: "true", SAP_TLS_CERT_SHA256: "AA".repeat(32) }).huellaSap, "AA".repeat(32));
  assert.throws(() => configurar({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" }));
});
for (const coincide of [true, false]) test(`huella ${coincide ? "correcta permite" : "diferente impide"} enviar credenciales`, async t => {
  let enviado = false;
  t.mock.method(https, "request", (_url, opciones, callback) => {
    assert.equal(opciones.rejectUnauthorized, false);
    assert.equal(opciones.agent, false);
    const req = new EventEmitter();
    req.destroy = error => req.emit("error", error);
    req.end = body => {
      enviado = true; assert.equal(body, "secreto-ficticio");
      const res = new EventEmitter(); res.statusCode = 200;
      res.rawHeaders = ["Set-Cookie", "B1SESSION=test", "Set-Cookie", "ROUTEID=test"];
      callback(res); res.emit("data", Buffer.from("{}")); res.emit("end");
    };
    queueMicrotask(() => {
      const socket = new EventEmitter();
      socket.getPeerCertificate = () => ({ fingerprint256: (coincide ? "AA" : "BB").repeat(32) });
      req.emit("socket", socket); socket.emit("secureConnect");
    });
    return req;
  });
  const promesa = crearTransporteSap("https://sap.example/b1s/v1", "AA".repeat(32))("https://sap.example/b1s/v1/Login", { body: "secreto-ficticio", method: "POST" });
  if (coincide) assert.equal((await promesa).headers.getSetCookie().length, 2);
  else await assert.rejects(promesa, /Huella/);
  assert.equal(enviado, coincide);
});
test("transporte excepcional rechaza otros servidores", async () => {
  await assert.rejects(crearTransporteSap("https://sap.example", "AA".repeat(32))("https://backend.example"), /Destino/);
});
