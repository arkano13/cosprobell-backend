import test from "node:test";
import assert from "node:assert/strict";

import { crearClienteServiceLayer, ErrorServiceLayer } from "../src/serviceLayer.js";
import { iniciarServiceLayerFalso } from "./serviceLayerFalso.js";

const bodegas = Array.from({ length: 45 }, (_, i) => ({
  WarehouseCode: String(i).padStart(2, "0"),
}));

async function preparar(t, opciones = {}) {
  const sap = await iniciarServiceLayerFalso({ datos: { Warehouses: bodegas }, ...opciones });
  t.after(() => sap.cerrar());

  const cliente = crearClienteServiceLayer({
    url: sap.url,
    companyDb: "EMPRESA_PRUEBA",
    usuario: "integracion",
    contrasena: opciones.contrasenaCliente ?? "clave-correcta",
  });

  return { sap, cliente };
}

async function leerTodo(cliente, opciones) {
  const paginas = [];

  for await (const pagina of cliente.leerPaginas("Warehouses", opciones)) {
    paginas.push(pagina);
  }

  return paginas;
}

for (const version of ["v1", "v2"]) {
  test(`recorre todas las páginas con el enlace siguiente de ${version}`, async (t) => {
    const { sap, cliente } = await preparar(t, { version });

    const paginas = await leerTodo(cliente, {
      select: ["WarehouseCode", "WarehouseName"],
      orderby: "WarehouseCode",
      tamanoPagina: 20,
    });

    assert.deepEqual(paginas.map((pagina) => pagina.length), [20, 20, 5]);
    assert.deepEqual(paginas.flat(), bodegas);

    const [primera] = sap.estado.peticiones;
    assert.equal(primera.busqueda.get("$select"), "WarehouseCode,WarehouseName");
    assert.equal(primera.busqueda.get("$orderby"), "WarehouseCode");
    assert.equal(primera.cabeceras.prefer, "odata.maxpagesize=20");
    assert.match(primera.cabeceras.cookie, /B1SESSION=sesion-1/);
    assert.match(primera.cabeceras.cookie, /ROUTEID=\.node1/);
  });
}

test("inicia sesión con la empresa y el usuario configurados", async (t) => {
  const { sap, cliente } = await preparar(t);

  const sesion = await cliente.iniciarSesion();

  assert.deepEqual(sesion, { version: "1000180", minutosSesion: 30 });
  assert.deepEqual(sap.estado.cuerposLogin, [
    { CompanyDB: "EMPRESA_PRUEBA", UserName: "integracion", Password: "clave-correcta" },
  ]);
});

test("renueva la sesión una vez cuando SAP la da por vencida", async (t) => {
  const { sap, cliente } = await preparar(t);
  await cliente.iniciarSesion();
  sap.estado.vencerProximaSesion = true;

  const paginas = await leerTodo(cliente, { tamanoPagina: 100 });

  assert.equal(paginas.flat().length, 45);
  assert.equal(sap.estado.logins, 2);
});

test("muestra el mensaje de SAP si el login falla, sin la contraseña", async (t) => {
  const { cliente } = await preparar(t, { contrasenaCliente: "clave-equivocada" });

  await assert.rejects(cliente.iniciarSesion(), (error) => {
    assert.ok(error instanceof ErrorServiceLayer);
    assert.equal(error.status, 401);
    assert.match(error.message, /Invalid login credential/);
    assert.equal(error.message.includes("clave-equivocada"), false);
    return true;
  });
});

test("no sigue enlaces hacia otro servidor", async (t) => {
  const { sap, cliente } = await preparar(t, {
    alterarRespuesta: (_entidad, cuerpo) => ({
      ...cuerpo,
      "odata.nextLink": "http://otro-servidor.example/b1s/v1/Warehouses?$skip=20",
    }),
  });

  await assert.rejects(leerTodo(cliente, { tamanoPagina: 20 }), /otro servidor/);
  assert.equal(sap.estado.peticiones.length, 1);
});

test("informa el error de SAP al consultar una entidad", async (t) => {
  const { cliente } = await preparar(t);

  await assert.rejects(
    cliente.leerPrimeros("NoExiste", { top: 1 }),
    /GET NoExiste respondió 404: Entidad desconocida/
  );
});

test("cuenta registros con y sin filtro", async (t) => {
  const { cliente } = await preparar(t, {
    conteos: { Items: 120, "Items|BarCode ne null": 7 },
  });

  assert.equal(await cliente.contar("Items"), 120);
  assert.equal(await cliente.contar("Items", { filter: "BarCode ne null" }), 7);
});

test("cierra la sesión y tolera que SAP no responda", async (t) => {
  const { sap, cliente } = await preparar(t);
  await cliente.iniciarSesion();

  await cliente.cerrarSesion();
  assert.equal(sap.estado.logouts, 1);

  await cliente.iniciarSesion();
  await sap.cerrar();
  await cliente.cerrarSesion();
});
