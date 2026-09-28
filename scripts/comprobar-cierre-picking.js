import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";

import { prisma } from "../src/infrastructure/database/prisma.js";
import { pickingRepository } from "../src/modules/picking/picking.repository.js";
import {
  escanearPicking,
  finalizarPicking,
} from "../src/modules/picking/picking.service.js";

function crearSenal() {
  let resolver;
  const promesa = new Promise((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

// Captura errores inmediatamente mientras observamos los bloqueos.
function observar(promesa) {
  return promesa.then(
    (valor) => ({ ok: true, valor }),
    (error) => ({ ok: false, error })
  );
}

function exigirExito(resultado) {
  if (!resultado.ok) {
    throw resultado.error;
  }
  return resultado.valor;
}

async function leerSesion(id) {
  return prisma.pickingPedido.findUniqueOrThrow({
    where: { id },
    include: {
      lineas: { orderBy: { pedidoLineNum: "asc" } },
    },
  });
}

async function conSesionTemporal(cantidades, prueba) {
  const codigo = `PRUEBA-CIERRE-${randomUUID()}`;

  const sesion = await prisma.pickingPedido.create({
    data: {
      pedidoDocEntry: -1,
      usuarioId: "prueba-cierre",
      estado: "en_proceso",
      lineas: {
        create: cantidades.map((cantidad, indice) => ({
          pedidoLineNum: indice,
          itemCode: codigo,
          cantidadPedida: cantidad,
          cantidadEscaneada: 0,
        })),
      },
    },
  });

  try {
    await prueba(sesion.id, codigo);
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.pickingPedidoLinea.deleteMany({
        where: { pickingId: sesion.id },
      });

      await tx.pickingPedido.delete({
        where: { id: sesion.id },
      });
    });

    console.log(`Sesión temporal ${sesion.id} eliminada.`);
  }
}

async function confirmarEspera(pid, segundaTerminada) {
  const limite = Date.now() + 4_000;

  while (Date.now() < limite) {
    const esperando = await prisma.$queryRaw`
      SELECT pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND ${pid}::integer = ANY(pg_blocking_pids(pid))
    `;

    if (esperando.length > 0) {
      assert.equal(
        segundaTerminada(),
        false,
        "La segunda operación terminó antes de liberar el bloqueo"
      );
      return;
    }

    if (segundaTerminada()) {
      throw new Error(
        "La segunda operación terminó sin esperar el bloqueo"
      );
    }

    await esperar(100);
  }

  throw new Error("PostgreSQL no confirmó la espera del bloqueo");
}

// Pausa la primera operación dentro de su transacción.
// Inicia la segunda y confirma que PostgreSQL la mantiene esperando.
async function ejecutarEnOrden(metodo, primera, segunda) {
  const original = pickingRepository[metodo];
  const preparada = crearSenal();
  const liberar = crearSenal();

  let resultadoPrimera;
  let resultadoSegunda;
  let segundaFinalizada = false;

  pickingRepository[metodo] = async function (...args) {
    const tx = args.at(-1);
    const resultado = await original.apply(this, args);
    const [{ pid }] = await tx.$queryRaw`
      SELECT pg_backend_pid() AS pid
    `;

    preparada.resolver(pid);
    await liberar.promesa;

    return resultado;
  };

  try {
    resultadoPrimera = observar(primera());

    // Si la primera falla antes de llegar a la pausa, no esperamos
    // una señal que nunca llegará.
    const pid = await Promise.race([
      preparada.promesa,
      resultadoPrimera.then((resultado) => {
        exigirExito(resultado);
        throw new Error("La primera operación no llegó a la pausa");
      }),
    ]);

    resultadoSegunda = observar(segunda()).then((resultado) => {
      segundaFinalizada = true;
      return resultado;
    });

    await confirmarEspera(pid, () => segundaFinalizada);
    liberar.resolver();

    return await Promise.all([
      resultadoPrimera,
      resultadoSegunda,
    ]);
  } finally {
    liberar.resolver();

    // Ninguna operación debe seguir trabajando al limpiar los datos.
    await Promise.allSettled(
      [resultadoPrimera, resultadoSegunda].filter(Boolean)
    );

    pickingRepository[metodo] = original;
  }
}

async function probarEscaneoPrimero() {
  await conSesionTemporal([1], async (id, codigo) => {
    const [escaneo, cierre] = await ejecutarEnOrden(
      "incrementarLinea",
      () => escanearPicking(id, codigo),
      () => finalizarPicking(id)
    );

    assert.equal(exigirExito(escaneo).cantidadEscaneada, 1);

    const finalizacion = exigirExito(cierre);
    assert.equal(finalizacion.estado, "completo");
    assert.equal(finalizacion.lineas[0].cantidadEscaneada, 1);
    assert.ok(finalizacion.fechaFin);

    const guardada = await leerSesion(id);
    assert.equal(guardada.estado, "completo");
    assert.equal(guardada.lineas[0].cantidadEscaneada, 1);
    assert.ok(guardada.fechaFin);

    console.log(
      "APROBADO 1/3: el cierre esperó al escaneo e incluyó la unidad."
    );
  });
}

async function probarCierrePrimero() {
  await conSesionTemporal([1], async (id, codigo) => {
    const [cierre, escaneo] = await ejecutarEnOrden(
      "guardarFinalizacion",
      () => finalizarPicking(id),
      () => escanearPicking(id, codigo)
    );

    const finalizacion = exigirExito(cierre);
    assert.equal(finalizacion.estado, "con_diferencias");
    assert.ok(finalizacion.fechaFin);

    assert.equal(
      escaneo.ok,
      false,
      "Un picking cerrado no debe aceptar el escaneo pendiente"
    );
    assert.equal(escaneo.error.code, "PICKING_NO_ACTIVO");

    const guardada = await leerSesion(id);
    assert.equal(guardada.estado, "con_diferencias");
    assert.equal(guardada.lineas[0].cantidadEscaneada, 0);
    assert.equal(
      guardada.fechaFin.getTime(),
      finalizacion.fechaFin.getTime()
    );

    console.log(
      "APROBADO 2/3: el escaneo esperó al cierre y fue rechazado."
    );
  });
}

async function probarProductoEnVariasLineas() {
  await conSesionTemporal([1, 2], async (id, codigo) => {
    // Cuatro solicitudes para tres unidades repartidas en dos líneas.
    const resultados = await Promise.allSettled(
      Array.from({ length: 4 }, () => escanearPicking(id, codigo))
    );

    const aceptados = resultados.filter(
      (resultado) => resultado.status === "fulfilled"
    );
    const rechazados = resultados.filter(
      (resultado) => resultado.status === "rejected"
    );

    assert.equal(aceptados.length, 3, "Deben aceptarse tres escaneos");
    assert.equal(rechazados.length, 1, "Debe rechazarse un escaneo");
    assert.equal(rechazados[0].reason.code, "CANTIDAD_COMPLETADA");

    const guardada = await leerSesion(id);
    assert.equal(guardada.estado, "en_proceso");

    assert.deepEqual(
      guardada.lineas.map((linea) => linea.cantidadEscaneada),
      [1, 2],
      "Las dos líneas deben quedar completas sin exceder sus cantidades"
    );

    for (const linea of guardada.lineas) {
      assert.ok(linea.cantidadEscaneada <= linea.cantidadPedida);
    }

    console.log(
      "APROBADO 3/3: producto repartido en dos líneas; sobrante rechazado."
    );
  });
}

try {
  await probarEscaneoPrimero();
  await probarCierrePrimero();
  await probarProductoEnVariasLineas();

  console.log("\nRESULTADO: 3 de 3 casos aprobados.");
} catch (error) {
  console.error("PRUEBA FALLIDA:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}