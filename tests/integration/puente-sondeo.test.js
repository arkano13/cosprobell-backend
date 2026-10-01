import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sondeo consulta SAP simulado sin contactar backend ni crear estado", async t => {
  const carpeta = await mkdtemp(join(tmpdir(), "puente-sondeo-"));
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  const llamadas = [];
  const servidor = createServer((req, res) => {
    llamadas.push({ metodo: req.method, url: req.url });
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/Login")) res.setHeader("Set-Cookie", "B1SESSION=simulada; HttpOnly");
    res.end(JSON.stringify(req.method === "GET" ? { value: [] } : {}));
  });
  await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const { stdout } = await promisify(execFile)(process.execPath, ["puente/ejecutar.js", "--sondeo"], {
    timeout: 15000,
    env: { ...process.env, SAP_SERVICE_LAYER_URL: `${url}/b1s/v1`, BACKEND_URL: `${url}/backend`,
      SAP_COMPANY_DB: "TEST", SAP_USER: "prueba", SAP_PASSWORD: "ficticia", BRIDGE_API_KEY: "x".repeat(64),
      BRIDGE_STATE_DIR: join(carpeta, "estado"), BRIDGE_REQUEST_DELAY_MS: "100", BRIDGE_FREQUENCIES_JSON: "{}",
      BRIDGE_MAX_REQUESTS: "25", BRIDGE_MAX_SECONDS: "120", NODE_TLS_REJECT_UNAUTHORIZED: "1" },
  });
  assert.equal(llamadas.length, 7);
  assert.equal(llamadas.filter(x => x.metodo === "GET").length, 5);
  assert(llamadas.filter(x => x.metodo === "GET").every(x => x.url.includes("$top=1")));
  assert(llamadas.every(x => x.url.startsWith("/b1s/v1/")));
  assert.deepEqual(await readdir(carpeta), []);
  assert.equal(stdout.trim().split("\n").map(JSON.parse).filter(x => x.evento === "sondeo").length, 5);
});
