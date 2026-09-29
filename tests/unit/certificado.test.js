import test from "node:test";
import assert from "node:assert/strict";
import tls from "node:tls";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("diagnóstico de certificado no instala ni sobrescribe confianza", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "certificado-diagnostico-"));
  const cwd = process.cwd(); const url = process.env.SAP_SERVICE_LAYER_URL;
  const originalExit = process.exitCode;
  t.after(async () => {
    process.chdir(cwd); process.exitCode = originalExit;
    if (url === undefined) delete process.env.SAP_SERVICE_LAYER_URL; else process.env.SAP_SERVICE_LAYER_URL = url;
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, "certificado"));
  await writeFile(join(dir, "certificado/service-layer.pem"), "CERTIFICADO_APROBADO");
  process.chdir(dir); process.env.SAP_SERVICE_LAYER_URL = "https://sap.example:50000/b1s/v1";
  const cert = { subject: { CN: "sap.example" }, issuer: { CN: "No verificado" }, fingerprint256: "AA:BB", raw: Buffer.from("no-confiable") };
  cert.issuerCertificate = cert;
  const socket = { authorized: false, authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT", getPeerCertificate: () => cert,
    end() {}, setTimeout() {}, on() {} };
  t.mock.method(tls, "connect", (_opciones, callback) => { queueMicrotask(callback); return socket; });
  const mensajes = [];
  t.mock.method(console, "log", (...args) => mensajes.push(args.join(" ")));
  await import("../../scripts/ver-certificado.js");
  assert.equal(await readFile(join(dir, "certificado/service-layer.pem"), "utf8"), "CERTIFICADO_APROBADO");
  assert.deepEqual(await readdir(dir), ["certificado"]);
  assert.ok(mensajes.some((m) => m.includes("AA:BB")));
});
