import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../../src/shared/errors/AppError.js";
import { validarEtiquetaParaPicking } from "../../src/modules/picking/picking.etiqueta.js";

function crearEtiqueta() {
  return {
    id: 10,
    itemCode: "PROD-001",
    codigo: "0012345678905",
    uomEntry: 1,
    confirmacionPicking: {
      codigoBarrasId: 10,
      esUnidadIndividual: true,
      itemCodeConfirmado: "PROD-001",
      codigoConfirmado: "0012345678905",
      uomEntryConfirmado: 1,
    },
  };
}

function comprobarError(etiqueta, code, statusCode = 409) {
  assert.throws(
    () => validarEtiquetaParaPicking(etiqueta),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, code);
      assert.equal(error.statusCode, statusCode);
      return true;
    }
  );
}

test("rechaza una asociación inexistente", () => {
  for (const etiqueta of [null, undefined]) {
    comprobarError(etiqueta, "ETIQUETA_NO_ENCONTRADA", 404);
  }
});

test("rechaza etiquetas sin confirmación", () => {
  const etiqueta = crearEtiqueta();
  etiqueta.confirmacionPicking = null;

  comprobarError(etiqueta, "ETIQUETA_SIN_CONFIRMAR");
});

test("rechaza una confirmación perteneciente a otra asociación", () => {
  const etiqueta = crearEtiqueta();
  etiqueta.confirmacionPicking.codigoBarrasId = 99;

  comprobarError(etiqueta, "CONFIRMACION_DESACTUALIZADA");
});

test("exige revisión si cambia el producto, código o unidad", () => {
  const cambios = [
    { itemCode: "PROD-002" },
    { codigo: "0098765432105" },
    { uomEntry: 2 },
    { uomEntry: null },
  ];

  for (const cambio of cambios) {
    const etiqueta = {
      ...crearEtiqueta(),
      ...cambio,
    };

    comprobarError(etiqueta, "CONFIRMACION_DESACTUALIZADA");
  }
});

test("rechaza cajas y cualquier confirmación que no sea true", () => {
  for (const valor of [false, null, undefined, "true", 1]) {
    const etiqueta = crearEtiqueta();
    etiqueta.confirmacionPicking.esUnidadIndividual = valor;

    comprobarError(etiqueta, "PRESENTACION_NO_PERMITIDA");
  }
});

test("acepta una unidad confirmada sin modificar los datos recibidos", () => {
  const etiqueta = crearEtiqueta();
  const antes = structuredClone(etiqueta);

  assert.deepEqual(validarEtiquetaParaPicking(etiqueta), {
    codigoBarrasId: 10,
    codigo: "0012345678905",
    itemCode: "PROD-001",
    uomEntry: 1,
    cantidadUnidades: 1,
  });

  assert.deepEqual(etiqueta, antes);
});