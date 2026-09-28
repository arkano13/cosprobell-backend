import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../../src/shared/errors/AppError.js";
import { validarCompatibilidadLinea } from "../../src/modules/picking/picking.cantidades.js";

function crearLinea(cambios = {}) {
  return {
    itemCode: "PROD-001",
    uomEntry: 1,
    cantidadPedida: 3,
    cantidadEscaneada: 0,
    ...cambios,
  };
}

function crearEtiqueta(cambios = {}) {
  return {
    itemCode: "PROD-001",
    uomEntry: 1,
    cantidadUnidades: 1,
    ...cambios,
  };
}

function comprobarError(linea, etiqueta, code) {
  assert.throws(
    () => validarCompatibilidadLinea(linea, etiqueta),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, code);
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
}

test("acepta el mismo producto y unidad sin modificar los datos", () => {
  const linea = crearLinea();
  const etiqueta = crearEtiqueta();
  const antes = structuredClone({ linea, etiqueta });

  assert.doesNotThrow(() =>
    validarCompatibilidadLinea(linea, etiqueta)
  );

  assert.deepEqual({ linea, etiqueta }, antes);
});

test("rechaza un producto diferente", () => {
  comprobarError(
    crearLinea(),
    crearEtiqueta({ itemCode: "PROD-002" }),
    "PRODUCTO_FUERA_DE_LINEA"
  );
});

test("rechaza una cantidad por lectura distinta de uno", () => {
  for (const cantidadUnidades of [0, 2, 12, 0.5, "1", null]) {
    comprobarError(
      crearLinea(),
      crearEtiqueta({ cantidadUnidades }),
      "PRESENTACION_NO_PERMITIDA"
    );
  }
});

test("rechaza unidades desconocidas incluso cuando ambas referencias coinciden", () => {
  for (const uomEntry of [null, undefined, -1, "1", 1.5]) {
    comprobarError(
      crearLinea({ uomEntry }),
      crearEtiqueta(),
      "UNIDAD_NO_DEFINIDA"
    );

    comprobarError(
      crearLinea(),
      crearEtiqueta({ uomEntry }),
      "UNIDAD_NO_DEFINIDA"
    );

    comprobarError(
      crearLinea({ uomEntry }),
      crearEtiqueta({ uomEntry }),
      "UNIDAD_NO_DEFINIDA"
    );
  }
});

test("rechaza unidades distintas aunque tengan el mismo nombre", () => {
  comprobarError(
    crearLinea({ uomEntry: 1, uomCode: "UN" }),
    crearEtiqueta({ uomEntry: 2, uomCode: "UN" }),
    "UNIDAD_INCOMPATIBLE"
  );
});

test("rechaza fracciones, valores inválidos y cantidades excedidas", () => {
  const casos = [
    { cantidadPedida: 0 },
    { cantidadPedida: -1 },
    { cantidadPedida: 1.5 },
    { cantidadPedida: NaN },
    { cantidadPedida: Infinity },
    { cantidadPedida: Number.MAX_SAFE_INTEGER + 1 },
    { cantidadEscaneada: -1 },
    { cantidadEscaneada: 0.5 },
    { cantidadEscaneada: 4 },
    { cantidadEscaneada: "1" },
  ];

  for (const cambios of casos) {
    comprobarError(
      crearLinea(cambios),
      crearEtiqueta(),
      "CANTIDADES_INVALIDAS"
    );
  }
});

test("una línea completa sigue teniendo unidades compatibles", () => {
  // El rechazo por cantidad completada corresponde al servicio
  // de escaneo; esta función solo valida compatibilidad.
  assert.doesNotThrow(() =>
    validarCompatibilidadLinea(
      crearLinea({ cantidadEscaneada: 3 }),
      crearEtiqueta()
    )
  );
}); 