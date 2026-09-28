import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";

const { firmar, firmaValida, VENTANA_FIRMA_MS } = await import(
  "../../src/shared/security/firma.js"
);
const { crearAutenticacionPuente } = await import(
  "../../src/middleware/authenticate.js"
);

const secreto = "s".repeat(32);
const ahora = 1_800_000_000_000;

const datos = {
  marcaTiempo: String(ahora),
  metodo: "POST",
  ruta: "/sync/lotes",
  cuerpo: '{"loteId":"x"}',
};

test("una firma es válida solo para los mismos datos y secreto", () => {
  const firma = firmar(secreto, datos);

  assert.match(firma, /^[0-9a-f]{64}$/);
  assert.equal(firmaValida(secreto, datos, firma), true);

  for (const cambio of [
    { marcaTiempo: String(ahora + 1) },
    { metodo: "PUT" },
    { ruta: "/sync/otra" },
    { cuerpo: '{"loteId":"y"}' },
  ]) {
    assert.equal(firmaValida(secreto, { ...datos, ...cambio }, firma), false);
  }

  assert.equal(firmaValida("o".repeat(32), datos, firma), false);
});

test("rechaza firmas con formato inválido sin lanzar errores", () => {
  for (const firma of ["", "abc", "Z".repeat(64), `${firmar(secreto, datos)}00`]) {
    assert.equal(firmaValida(secreto, datos, firma), false);
  }
});

function peticion({ cabeceras = {}, cuerpo = datos.cuerpo } = {}) {
  const normalizadas = Object.fromEntries(
    Object.entries(cabeceras).map(([nombre, valor]) => [nombre.toLowerCase(), valor])
  );

  return {
    method: "POST",
    originalUrl: "/sync/lotes",
    rawBody: Buffer.from(cuerpo),
    header: (nombre) => normalizadas[nombre.toLowerCase()],
  };
}

function autenticar(req, opciones = {}) {
  const middleware = crearAutenticacionPuente({
    secreto,
    ahora: () => ahora,
    ...opciones,
  });

  let recibido;
  middleware(req, {}, (error) => {
    recibido = error ?? null;
  });

  return recibido;
}

function cabecerasValidas(marcaTiempo = String(ahora)) {
  return {
    "X-Bridge-Timestamp": marcaTiempo,
    "X-Bridge-Signature": firmar(secreto, { ...datos, marcaTiempo }),
  };
}

test("acepta una petición firmada correctamente", () => {
  assert.equal(autenticar(peticion({ cabeceras: cabecerasValidas() })), null);
});

test("rechaza peticiones sin firma", () => {
  const error = autenticar(peticion());

  assert.equal(error.code, "FIRMA_REQUERIDA");
  assert.equal(error.statusCode, 401);
});

test("rechaza marcas de tiempo vencidas o mal formadas", () => {
  for (const marca of [
    String(ahora - VENTANA_FIRMA_MS - 1),
    String(ahora + VENTANA_FIRMA_MS + 1),
    "1800000000",
    "abc",
  ]) {
    const error = autenticar(peticion({ cabeceras: cabecerasValidas(marca) }));
    assert.equal(error.code, "FIRMA_VENCIDA", marca);
  }
});

test("rechaza un cuerpo modificado después de firmar", () => {
  const error = autenticar(
    peticion({ cabeceras: cabecerasValidas(), cuerpo: '{"loteId":"otro"}' })
  );

  assert.equal(error.code, "FIRMA_INVALIDA");
});

test("responde 503 si el servidor no tiene secreto configurado", () => {
  const error = autenticar(peticion({ cabeceras: cabecerasValidas() }), {
    secreto: undefined,
  });

  assert.equal(error.code, "PUENTE_NO_CONFIGURADO");
  assert.equal(error.statusCode, 503);
});
