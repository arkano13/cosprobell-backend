import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { crearActualizaciones } from "../../src/modules/actualizaciones/actualizaciones.service.js";

// Las rutas cargan la configuración del backend al importarse: una base ficticia alcanza (no se conecta).
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const { crearRutasActualizaciones } = await import("../../src/modules/actualizaciones/actualizaciones.routes.js");
const { default: errorHandler } = await import("../../src/middleware/errorHandler.js");

// GitHub falso: dos releases publicados (el más nuevo primero) y un borrador; la descarga redirige al almacenamiento.
function github() {
  const pedidos = [];
  const releases = [
    { draft: true, prerelease: false, assets: [{ id: 9, name: "latest.yml", size: 3 }] },
    { draft: false, prerelease: false, assets: [{ id: 1, name: "latest.yml", size: 11 }, { id: 2, name: "Bodega-Cosprobell-1.9.1-instalador.exe", size: 4 }] },
    { draft: false, prerelease: false, assets: [{ id: 3, name: "Bodega-Cosprobell-1.9.0-instalador.exe.blockmap", size: 5 }] },
  ];
  const fetchImpl = async (url, opciones = {}) => {
    pedidos.push({ url, opciones });
    if (url.endsWith("/releases?per_page=10")) return new Response(JSON.stringify(releases), { status: 200 });
    const asset = /\/releases\/assets\/(\d+)$/.exec(url);
    if (asset) return new Response(null, { status: 302, headers: { location: `https://almacen.example/archivo-${asset[1]}?firma=x` } });
    const archivo = /archivo-(\d+)/.exec(url);
    if (archivo) return new Response(`contenido ${archivo[1]}`, { status: 200 });
    return new Response("no", { status: 404 });
  };
  return { fetchImpl, pedidos };
}
const texto = async (archivo) => new Response(archivo.cuerpo).text();

test("actualizaciones: latest.yml del release más nuevo publicado; instaladores y blockmap de cualquier release", async () => {
  const g = github();
  const servicio = crearActualizaciones({ token: "tk", repo: "dueno/app", fetchImpl: g.fetchImpl });
  const yml = await servicio.archivo("latest.yml");
  assert.equal(await texto(yml), "contenido 1", "el borrador no cuenta");
  assert.deepEqual([yml.tipo, yml.tamano], ["text/yaml; charset=utf-8", 11]);
  assert.equal(await texto(await servicio.archivo("Bodega-Cosprobell-1.9.1-instalador.exe")), "contenido 2");
  assert.equal(await texto(await servicio.archivo("Bodega-Cosprobell-1.9.0-instalador.exe.blockmap")), "contenido 3", "de una versión anterior");
  // El token va solo a GitHub: la descarga redirigida al almacenamiento no lo lleva.
  const aGithub = g.pedidos.filter((p) => p.url.startsWith("https://api.github.com/"));
  assert.ok(aGithub.every((p) => p.opciones.headers.Authorization === "Bearer tk"));
  const alAlmacen = g.pedidos.filter((p) => p.url.startsWith("https://almacen.example/"));
  assert.equal(alAlmacen.length, 3);
  assert.ok(alAlmacen.every((p) => !p.opciones.headers?.Authorization));
  // La lista de versiones se pide una sola vez por minuto.
  assert.equal(g.pedidos.filter((p) => p.url.endsWith("/releases?per_page=10")).length, 1);
});

test("actualizaciones: sin configurar, nombre inválido, archivo que no está y GitHub caído", async () => {
  const g = github();
  await assert.rejects(crearActualizaciones({ token: undefined, repo: "dueno/app", fetchImpl: g.fetchImpl }).archivo("latest.yml"),
    { code: "ACTUALIZACIONES_SIN_CONFIGURAR", statusCode: 503 });
  const servicio = crearActualizaciones({ token: "tk", repo: "dueno/app", fetchImpl: g.fetchImpl });
  for (const nombre of ["../secreto.yml", "latest.json", "a/b.exe", ".exe"]) {
    await assert.rejects(servicio.archivo(nombre), { code: "ARCHIVO_INVALIDO" }, nombre);
  }
  await assert.rejects(servicio.archivo("Bodega-Cosprobell-0.1.0-instalador.exe"), { code: "ARCHIVO_NO_ENCONTRADO", statusCode: 404 });
  const caido = crearActualizaciones({ token: "tk", repo: "dueno/app", fetchImpl: async () => new Response("x", { status: 401 }) });
  await assert.rejects(caido.archivo("latest.yml"), { code: "ACTUALIZACIONES_NO_DISPONIBLES", statusCode: 502 });
});

test("actualizaciones por HTTP: pide la clave y transmite el archivo", async (t) => {
  const g = github();
  const app = express();
  const autenticar = (req, res, next) => (req.header("X-API-Key") === "clave-de-ingreso" ? next() : res.status(401).json({ error: "API key invalida" }));
  app.use(crearRutasActualizaciones({ servicio: crearActualizaciones({ token: "tk", repo: "dueno/app", fetchImpl: g.fetchImpl }), autenticar }));
  app.use(errorHandler);
  const servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  t.after(() => servidor.close());
  const url = `http://127.0.0.1:${servidor.address().port}/actualizaciones`;
  assert.equal((await fetch(`${url}/latest.yml`)).status, 401);
  const r = await fetch(`${url}/latest.yml`, { headers: { "X-API-Key": "clave-de-ingreso" } });
  assert.deepEqual([r.status, r.headers.get("content-type"), r.headers.get("cache-control"), await r.text()],
    [200, "text/yaml; charset=utf-8", "no-store", "contenido 1"]);
  const falta = await fetch(`${url}/Bodega-Cosprobell-0.1.0-instalador.exe`, { headers: { "X-API-Key": "clave-de-ingreso" } });
  assert.equal(falta.status, 404);
});
