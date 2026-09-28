import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// URL ficticia: las consultas de estas pruebas estÃ¡n simuladas.
process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/test";

const { default: app } = await import("../../src/app.js");

const { prisma } = await import(
  "../../src/infrastructure/database/prisma.js"
);

const { productosRepository } = await import(
  "../../src/modules/productos/productos.repository.js"
);

const { pickingRepository } = await import(
  "../../src/modules/picking/picking.repository.js"
);

const { logger } = await import(
  "../../src/infrastructure/logging/logger.js"
);

logger.level = "silent";

let server;
let baseUrl;

// Inicia un servidor local temporal para las pruebas.
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// Cierra los recursos al terminar.
after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      server.closeAllConnections();
    });
  }

  await prisma.$disconnect();
});

// Sustituye temporalmente los mÃ©todos dinÃ¡micos de Prisma.
function sustituir(t, objeto, nombre, implementacion) {
  const original = objeto[nombre];

  objeto[nombre] = implementacion;

  t.after(() => {
    objeto[nombre] = original;
  });
}

// Simula una API key vÃ¡lida sin consultar PostgreSQL.
function autenticar(t) {
  sustituir(t, prisma.apiKey, "findUnique", async () => ({
    id: 1,
    activa: true,
    nombre: "prueba",
  }));

  sustituir(t, prisma.apiKey, "update", async () => ({}));

  return {
    "X-API-Key": "clave-ficticia-de-prueba",
  };
}

// --------------------------------------------------
// AutenticaciÃ³n
// --------------------------------------------------

test("las rutas de negocio siguen requiriendo autenticacion", async () => {
  const rutas = [
    "/productos",
    "/bodegas",
    "/clientes",
    "/facturas",
    "/pagos",
    "/picking/1",
  ];

  for (const ruta of rutas) {
    const respuesta = await fetch(`${baseUrl}${ruta}`);

    assert.equal(respuesta.status, 401, ruta);

    assert.deepEqual(await respuesta.json(), {
      error: "Falta la API key (header X-API-Key)",
    });
  }
});

// --------------------------------------------------
// Productos
// --------------------------------------------------

test("GET productos conserva busqueda, limite y respuesta", async (t) => {
  const headers = autenticar(t);

  const productos = [
    {
      itemCode: "A",
      itemName: "Agua",
      valid: true,
      quantityOnStock: 3,
    },
  ];

  t.mock.method(
    productosRepository,
    "listar",
    async (filtro) => {
      assert.deepEqual(filtro, {
        q: "Agua",
        take: 2,
      });

      return productos;
    }
  );

  const respuesta = await fetch(
    `${baseUrl}/productos?q=Agua&limit=2`,
    { headers }
  );

  assert.equal(respuesta.status, 200);

  assert.deepEqual(await respuesta.json(), {
    data: productos,
  });
});

test("un limite invalido se rechaza antes de consultar productos", async (t) => {
  const headers = autenticar(t);

  const consulta = t.mock.method(
    productosRepository,
    "listar",
    async () => []
  );

  const respuesta = await fetch(
    `${baseUrl}/productos?limit=101`,
    { headers }
  );

  assert.equal(respuesta.status, 400);

  assert.equal(
    (await respuesta.json()).error,
    "Datos de entrada invalidos"
  );

  assert.equal(consulta.mock.callCount(), 0);
});

test("detalle inexistente conserva el 404", async (t) => {
  const headers = autenticar(t);

  t.mock.method(
    productosRepository,
    "buscarPorItemCode",
    async () => null
  );

  const respuesta = await fetch(
    `${baseUrl}/productos/NO-EXISTE`,
    { headers }
  );

  assert.equal(respuesta.status, 404);

  assert.deepEqual(await respuesta.json(), {
    error: "Producto no encontrado",
  });
});

test("un fallo interno responde 500 sin exponer su detalle", async (t) => {
  const headers = autenticar(t);

  t.mock.method(productosRepository, "listar", async () => {
    throw new Error("detalle-interno-privado");
  });

  const respuesta = await fetch(
    `${baseUrl}/productos`,
    { headers }
  );

  assert.equal(respuesta.status, 500);

  assert.deepEqual(await respuesta.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  });
});

// --------------------------------------------------
// Health
// --------------------------------------------------

test("health sigue siendo publico", async (t) => {
  sustituir(t, prisma, "$queryRaw", async () => [
    { valor: 1 },
  ]);

  const respuesta = await fetch(`${baseUrl}/health`);

  assert.equal(respuesta.status, 200);

  assert.deepEqual(await respuesta.json(), {
    status: "ok",
    db: "ok",
  });
});

test("health informa indisponibilidad sin exponer el fallo", async (t) => {
  sustituir(t, prisma, "$queryRaw", async () => {
    throw new Error("fallo simulado");
  });

  const respuesta = await fetch(`${baseUrl}/health`);

  assert.equal(respuesta.status, 503);

  assert.deepEqual(await respuesta.json(), {
    status: "error",
    db: "unreachable",
  });
});

// --------------------------------------------------
// Inicio de picking
// --------------------------------------------------

test("iniciar picking devuelve 404 si el pedido no existe", async (t) => {
  simularInicio(t);
  const headers = {
    ...autenticar(t),
    "Content-Type": "application/json",
  };

  t.mock.method(
    pickingRepository,
    "buscarPedidoConLineas",
    async (pedidoDocEntry) => {
      assert.equal(pedidoDocEntry, 9001);
      return null;
    }
  );

  let creaciones = 0;

  sustituir(t, prisma.pickingPedido, "create", async () => {
    creaciones++;
    return {};
  });

  const respuesta = await fetch(`${baseUrl}/picking`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pedidoDocEntry: 9001,
    }),
  });

  assert.equal(respuesta.status, 404);

  assert.deepEqual(await respuesta.json(), {
    error: "Pedido no encontrado",
  });

  assert.equal(creaciones, 0);
});

test("iniciar picking rechaza un pedido sin lÃ­neas", async (t) => {
  simularInicio(t);
  const headers = {
    ...autenticar(t),
    "Content-Type": "application/json",
  };

  t.mock.method(
    pickingRepository,
    "buscarPedidoConLineas",
    async () => ({
      docEntry: 9001,
      documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo",
      lineas: [],
    })
  );

  let creaciones = 0;

  sustituir(t, prisma.pickingPedido, "create", async () => {
    creaciones++;
    return {};
  });

  const respuesta = await fetch(`${baseUrl}/picking`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pedidoDocEntry: 9001,
    }),
  });

  assert.equal(respuesta.status, 400);

  assert.deepEqual(await respuesta.json(), {
    error: "El pedido no tiene lineas",
  });

  assert.equal(creaciones, 0);
});

test("iniciar picking oculta los errores de consulta", async (t) => {
  simularInicio(t);
  const headers = {
    ...autenticar(t),
    "Content-Type": "application/json",
  };

  t.mock.method(
    pickingRepository,
    "buscarPedidoConLineas",
    async () => {
      throw new Error("Detalle privado de la base");
    }
  );

  let creaciones = 0;

  sustituir(t, prisma.pickingPedido, "create", async () => {
    creaciones++;
    return {};
  });

  const respuesta = await fetch(`${baseUrl}/picking`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pedidoDocEntry: 9001,
    }),
  });

  assert.equal(respuesta.status, 500);

  assert.deepEqual(await respuesta.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  });

  assert.equal(creaciones, 0);
});

test("iniciar picking crea una sesiÃ³n y responde 201", async (t) => {
  simularInicio(t);
  const headers = {
    ...autenticar(t),
    "Content-Type": "application/json",
  };

  const sesionEsperada = {
    id: 25,
    pedidoDocEntry: 9001,
    usuarioId: "operador-demo",
    estado: "en_proceso",
    lineas: [
      {
        pedidoLineNum: 0,
        itemCode: "PROD-001",
        cantidadPedida: 10,
        cantidadEscaneada: 0,
      },
    ],
  };

  t.mock.method(
    pickingRepository,
    "buscarPedidoConLineas",
    async () => ({
      docEntry: 9001,
      documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo",
      lineas: [
        {
          lineNum: 0,
          itemCode: "PROD-001",
          quantity: 10,
        },
      ],
    })
  );

  const crear = t.mock.method(
    pickingRepository,
    "crearSesion",
    async (datos) => {
      assert.deepEqual(datos, {
        pedidoDocEntry: 9001,
        usuarioId: "operador-demo",
        lineas: [
          {
            pedidoLineNum: 0,
            itemCode: "PROD-001",
            cantidadPedida: 10,
            uomEntry: null,
            uomCode: null,
          },
        ],
      });

      return sesionEsperada;
    }
  );

  const respuesta = await fetch(`${baseUrl}/picking`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pedidoDocEntry: 9001,
      usuarioId: "operador-demo",
    }),
  });

  assert.equal(respuesta.status, 201);

  assert.deepEqual(await respuesta.json(), {
    data: sesionEsperada,
  });

  assert.equal(crear.mock.callCount(), 1);
});

test("iniciar picking oculta un fallo al guardar la sesiÃ³n", async (t) => {
  simularInicio(t);
  const headers = {
    ...autenticar(t),
    "Content-Type": "application/json",
  };

  t.mock.method(
    pickingRepository,
    "buscarPedidoConLineas",
    async () => ({
      docEntry: 9001,
      documentStatus: "bost_Open", cancelled: false, cancelStatus: "csNo",
      lineas: [
        {
          lineNum: 0,
          itemCode: "PROD-001",
          quantity: 10,
        },
      ],
    })
  );

  const crear = t.mock.method(
    pickingRepository,
    "crearSesion",
    async () => {
      throw new Error("Detalle privado de persistencia");
    }
  );

  const respuesta = await fetch(`${baseUrl}/picking`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pedidoDocEntry: 9001,
    }),
  });

  assert.equal(respuesta.status, 500);

  assert.deepEqual(await respuesta.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  });

  assert.equal(crear.mock.callCount(), 1);
});

test("consultar picking devuelve la sesiÃ³n y sus lÃ­neas", async (t) => {
  simularInicio(t);
  const headers = autenticar(t);

  const sesion = {
    id: 25,
    pedidoDocEntry: 9001,
    estado: "en_proceso",
    lineas: [
      {
        pedidoLineNum: 0,
        itemCode: "PROD-001",
        cantidadPedida: 10,
        cantidadEscaneada: 3,
      },
    ],
  };

  const consulta = t.mock.method(
    pickingRepository,
    "buscarSesionConLineas",
    async (id) => {
      assert.equal(id, 25);
      return sesion;
    }
  );

  const respuesta = await fetch(`${baseUrl}/picking/25`, {
    headers,
  });

  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), {
    data: sesion,
  });
  assert.equal(consulta.mock.callCount(), 1);
});

test("consultar picking inexistente devuelve 404", async (t) => {
  simularInicio(t);
  const headers = autenticar(t);

  t.mock.method(
    pickingRepository,
    "buscarSesionConLineas",
    async () => null
  );

  const respuesta = await fetch(`${baseUrl}/picking/999`, {
    headers,
  });

  assert.equal(respuesta.status, 404);
  assert.deepEqual(await respuesta.json(), {
    error: "Sesion de picking no encontrada",
  });
});

test("consultar picking rechaza un identificador invÃ¡lido", async (t) => {
  simularInicio(t);
  const headers = autenticar(t);

  const consulta = t.mock.method(
    pickingRepository,
    "buscarSesionConLineas",
    async () => null
  );

  const respuesta = await fetch(`${baseUrl}/picking/abc`, {
    headers,
  });

  assert.equal(respuesta.status, 400);
  assert.equal(
    (await respuesta.json()).error,
    "Datos de entrada invalidos"
  );
  assert.equal(consulta.mock.callCount(), 0);
});

test("consultar picking oculta los fallos internos", async (t) => {
  simularInicio(t);
  const headers = autenticar(t);

  t.mock.method(
    pickingRepository,
    "buscarSesionConLineas",
    async () => {
      throw new Error("Detalle privado de consulta");
    }
  );

  const respuesta = await fetch(`${baseUrl}/picking/25`, {
    headers,
  });

  assert.equal(respuesta.status, 500);
  assert.deepEqual(await respuesta.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    },
  });
});

// Escaneo y cierre mediante HTTP, con persistencia simulada.
const { pickingEtiquetasRepository } = await import(
  "../../src/modules/picking/picking.etiquetas.repository.js"
);

const { pickingEscaneosRepository } = await import("../../src/modules/picking/picking.escaneos.repository.js");

function prepararEscaneoHttp(t, cambios = {}) {
  const linea = { id: 10, pickingId: 25, itemCode: "PROD-001", uomEntry: 1,
    cantidadPedida: 3, cantidadEscaneada: 0, ...cambios.linea };
  const sesion = { id: 25, estado: cambios.estado ?? "en_proceso", lineas: [linea] };
  const tx = { async $queryRaw() { return [sesion]; } };
  const eventos = new Map();
  t.mock.method(pickingEscaneosRepository, "buscarOperacion", async (id, operacionId, db) => {
    assert.equal(db, tx); return eventos.get(operacionId) ?? null;
  });
  t.mock.method(pickingEscaneosRepository, "crear", async (datos, db) => {
    assert.equal(db, tx);
    const evento = { id: eventos.size + 1, ...datos };
    eventos.set(datos.operacionId, evento);
    return evento;
  });
  sustituir(t, prisma, "$transaction", async (operacion) => operacion(tx));
  t.mock.method(pickingEtiquetasRepository, "buscarProductos", async (codigo, db) => {
    assert.equal(db, tx);
    assert.equal(codigo, "00123");
    if (cambios.fallo) throw new Error("detalle privado de escaneo");
    if (cambios.desconocida) return [];
    return [{ itemCode: "PROD-001", codigosBarras: [{
      id: 5, itemCode: "PROD-001", codigo, uomEntry: 1,
      confirmacionPicking: cambios.sinConfirmar ? null : {
        codigoBarrasId: 5, esUnidadIndividual: !cambios.caja,
        itemCodeConfirmado: "PROD-001", codigoConfirmado: codigo, uomEntryConfirmado: 1,
      },
    }] }];
  });
  t.mock.method(pickingRepository, "buscarSesionConLineas", async (id, db) => {
    assert.equal(db, tx); return sesion;
  });
  const incrementar = t.mock.method(pickingRepository, "incrementarLinea", async (datos, db) => {
    assert.equal(db, tx);
    assert.equal(datos.itemCode, "PROD-001");
    assert.equal(datos.codigo, "00123");
    return [{ ...linea, cantidadEscaneada: linea.cantidadEscaneada + 1, codigoBarrasEscaneado: datos.codigo }];
  });
  t.mock.method(pickingRepository, "guardarFinalizacion", async (id, estado, fechaFin, db) => {
    assert.equal(db, tx); return { ...sesion, estado, fechaFin };
  });
  return incrementar;
}

async function enviarEscaneo(headers, codigo = "00123", id = "25", operacionId = randomUUID()) {
  return fetch(`${baseUrl}/picking/${id}/escanear`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo, operacionId }),
  });
}

test("HTTP escanear registra el cÃ³digo de barras y conserva ceros iniciales", async (t) => {
  const headers = autenticar(t);
  const incrementar = prepararEscaneoHttp(t);
  const respuesta = await enviarEscaneo(headers, " 00123 ");
  assert.equal(respuesta.status, 200);
  const { data } = await respuesta.json();
  assert.equal(data.cantidadEscaneada, 1);
  assert.equal(data.codigoBarrasEscaneado, "00123");
  assert.equal(incrementar.mock.callCount(), 1);
});

const rechazosHttp = [
  { nombre: "etiqueta desconocida", cambios: { desconocida: true }, status: 404 },
  { nombre: "caja", cambios: { caja: true }, status: 409 },
  { nombre: "etiqueta sin confirmar", cambios: { sinConfirmar: true }, status: 409 },
  { nombre: "unidad manual", cambios: { linea: { uomEntry: -1 } }, status: 409 },
  { nombre: "cantidad completa", cambios: { linea: { cantidadEscaneada: 3 } }, status: 409 },
  { nombre: "sesiÃ³n cerrada", cambios: { estado: "completo" }, status: 400 },
];
for (const caso of rechazosHttp) {
  test(`HTTP escanear rechaza ${caso.nombre} sin incrementar`, async (t) => {
    const headers = autenticar(t);
    const incrementar = prepararEscaneoHttp(t, caso.cambios);
    const respuesta = await enviarEscaneo(headers);
    assert.equal(respuesta.status, caso.status);
    // Se conserva por ahora el contrato de errores del controlador.
    assert.equal(typeof (await respuesta.json()).error, "string");
    assert.equal(incrementar.mock.callCount(), 0);
  });
}

test("HTTP escanear valida identificador y cÃ³digo antes de abrir transacciÃ³n", async (t) => {
  const headers = autenticar(t);
  let transacciones = 0;
  sustituir(t, prisma, "$transaction", async () => { transacciones++; });
  assert.equal((await enviarEscaneo(headers, "00123", "abc")).status, 400);
  assert.equal((await enviarEscaneo(headers, " ")).status, 400);
  assert.equal(transacciones, 0);
});

test("HTTP escanear y finalizar requieren autenticaciÃ³n", async () => {
  assert.equal((await enviarEscaneo({})).status, 401);
  const respuesta = await fetch(`${baseUrl}/picking/25/finalizar`, { method: "POST" });
  assert.equal(respuesta.status, 401);
});

test("HTTP escanear oculta errores internos", async (t) => {
  const headers = autenticar(t);
  const incrementar = prepararEscaneoHttp(t, { fallo: true });
  const respuesta = await enviarEscaneo(headers);
  assert.equal(respuesta.status, 500);
  assert.deepEqual(await respuesta.json(), { error: {
    code: "INTERNAL_ERROR", message: "Error interno del servidor",
  } });
  assert.equal(incrementar.mock.callCount(), 0);
});

for (const cantidad of [2, 3]) {
  test(`HTTP finalizar con ${cantidad} de 3 conserva el estado correcto`, async (t) => {
    const headers = autenticar(t);
    prepararEscaneoHttp(t, { linea: { cantidadEscaneada: cantidad } });
    const respuesta = await fetch(`${baseUrl}/picking/25/finalizar`, { method: "POST", headers });
    assert.equal(respuesta.status, 200);
    const { data } = await respuesta.json();
    assert.equal(data.estado, cantidad === 3 ? "completo" : "con_diferencias");
    assert.ok(data.fechaFin);
  });
}


test("HTTP repetir el mismo operacionId devuelve la misma respuesta y no incrementa", async (t) => {
  const headers = autenticar(t);
  const incrementar = prepararEscaneoHttp(t);
  const id = randomUUID();
  const primera = await enviarEscaneo(headers, "00123", "25", id);
  const segunda = await enviarEscaneo(headers, "00123", "25", id);
  assert.equal(primera.status, 200);
  assert.equal(segunda.status, 200);
  assert.deepEqual(await segunda.json(), await primera.json());
  assert.equal(incrementar.mock.callCount(), 1);
});

test("HTTP reutilizar operacionId con otro cÃ³digo responde 409", async (t) => {
  const headers = autenticar(t);
  const incrementar = prepararEscaneoHttp(t);
  const id = randomUUID();
  assert.equal((await enviarEscaneo(headers, "00123", "25", id)).status, 200);
  assert.equal((await enviarEscaneo(headers, "OTRO", "25", id)).status, 409);
  assert.equal(incrementar.mock.callCount(), 1);
});

test("HTTP exige operacionId antes de abrir una transacciÃ³n", async (t) => {
  const headers = autenticar(t);
  let llamadas = 0;
  sustituir(t, prisma, "$transaction", async () => { llamadas++; });
  const respuesta = await fetch(`${baseUrl}/picking/25/escanear`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: "00123" }),
  });
  assert.equal(respuesta.status, 400);
  assert.equal(llamadas, 0);
});

test("HTTP historial requiere autenticaciÃ³n y pagina los eventos", async (t) => {
  assert.equal((await fetch(`${baseUrl}/picking/25/escaneos`)).status, 401);
  const headers = autenticar(t);
  t.mock.method(pickingRepository, "buscarEstadoSesion", async () => ({ estado: "completo" }));
  const consulta = t.mock.method(pickingEscaneosRepository, "listar", async (id, query) => {
    assert.equal(id, 25);
    assert.deepEqual(query, { limit: 1, despuesDe: 7 });
    return [{ id: 8, resultado: "aceptado" }, { id: 9, resultado: "rechazado" }];
  });
  const respuesta = await fetch(`${baseUrl}/picking/25/escaneos?limit=1&despuesDe=7`, { headers });
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { data: [{ id: 8, resultado: "aceptado" }], siguienteCursor: 8 });
  const invalida = await fetch(`${baseUrl}/picking/25/escaneos?limit=1000`, { headers });
  assert.equal(invalida.status, 400);
  assert.equal(consulta.mock.callCount(), 1);
});

test("HTTP historial inexistente devuelve 404", async (t) => {
  const headers = autenticar(t);
  t.mock.method(pickingRepository, "buscarEstadoSesion", async () => null);
  assert.equal((await fetch(`${baseUrl}/picking/999/escaneos`, { headers })).status, 404);
});

function simularInicio(t, sesiones = []) {
  t.mock.method(pickingRepository, "conPedidoBloqueado", async (_id, operacion) => operacion(prisma));
  t.mock.method(pickingRepository, "buscarSesionesDelPedido", async () => sesiones);
}

test("iniciar picking retoma la sesión y responde 200", async (t) => {
  const sesion = { id: 25, estado: "en_proceso", usuarioId: "anterior", lineas: [{ cantidadEscaneada: 2 }] };
  simularInicio(t, [sesion]);
  t.mock.method(pickingRepository, "buscarPedidoConLineas", async () => ({ documentStatus: "bost_Open", cancelled: false, lineas: [] }));
  const crear = t.mock.method(pickingRepository, "crearSesion", async () => { throw new Error("No debe crear"); });
  const respuesta = await fetch(`${baseUrl}/picking`, { method: "POST", headers: { ...autenticar(t), "Content-Type": "application/json" }, body: JSON.stringify({ pedidoDocEntry: 9001, usuarioId: "otro" }) });
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { data: sesion });
  assert.equal(crear.mock.callCount(), 0);
});

for (const estado of ["bost_Close", null]) {
  test(`HTTP rechaza inicio con estado ${estado}`, async (t) => {
    simularInicio(t);
    t.mock.method(pickingRepository, "buscarPedidoConLineas", async () => ({ documentStatus: estado, cancelled: false, lineas: [] }));
    const respuesta = await fetch(`${baseUrl}/picking`, { method: "POST", headers: { ...autenticar(t), "Content-Type": "application/json" }, body: JSON.stringify({ pedidoDocEntry: 9001 }) });
    assert.equal(respuesta.status, 409);
    assert.equal(typeof (await respuesta.json()).error, "string");
  });
}
