import { AppError } from "../../shared/errors/AppError.js";
import { sincronizacionRepository } from "./sincronizacion.repository.js";

const MAX_CODIGOS_EN_MENSAJE = 20;

function listar(valores) {
  const visibles = valores.slice(0, MAX_CODIGOS_EN_MENSAJE).join(", ");
  const restantes = valores.length - MAX_CODIGOS_EN_MENSAJE;

  return restantes > 0 ? `${visibles} y ${restantes} más` : visibles;
}

// Las existencias y los grupos apuntan a catálogos que deben existir antes.
async function comprobarDependencias(tx, items) {
  const bodegas = [
    ...new Set(
      items.flatMap((item) =>
        item.existencias.map((existencia) => existencia.warehouseCode)
      )
    ),
  ];

  const grupos = [
    ...new Set(
      items
        .map((item) => item.producto.itemsGroupCode)
        .filter((grupo) => grupo !== null)
    ),
  ];

  const bodegasExistentes =
    await sincronizacionRepository.buscarBodegasExistentes(tx, bodegas);
  const gruposExistentes =
    await sincronizacionRepository.buscarGruposExistentes(tx, grupos);

  const bodegasFaltantes = bodegas.filter((codigo) => !bodegasExistentes.has(codigo));
  const gruposFaltantes = grupos.filter((numero) => !gruposExistentes.has(numero));

  if (bodegasFaltantes.length === 0 && gruposFaltantes.length === 0) {
    return;
  }

  const partes = [];

  if (bodegasFaltantes.length > 0) {
    partes.push(`bodegas ${listar(bodegasFaltantes)}`);
  }

  if (gruposFaltantes.length > 0) {
    partes.push(`grupos ${listar(gruposFaltantes)}`);
  }

  throw new AppError({
    code: "DEPENDENCIAS_FALTANTES",
    message: `Faltan en la base: ${partes.join("; ")}. Sincronice primero Warehouses e ItemGroups.`,
    statusCode: 409,
  });
}

const guardarPorEntidad = {
  async ItemGroups(tx, registros) {
    for (const grupo of registros) {
      await sincronizacionRepository.guardarGrupo(tx, grupo);
    }
  },

  async Warehouses(tx, registros) {
    for (const bodega of registros) {
      await sincronizacionRepository.guardarBodega(tx, bodega);
    }
  },

  async Items(tx, registros) {
    await comprobarDependencias(tx, registros);
    await sincronizacionRepository.guardarProductos(tx, registros);
  },
};

function esLoteRepetido(error) {
  return (
    error?.code === "P2002" &&
    error.meta?.modelName === "SincronizacionLote"
  );
}

async function registrarFallo({ entidad, loteId }, error, log) {
  const mensaje =
    error instanceof AppError
      ? error.message
      : "Error interno al procesar el lote";

  try {
    await sincronizacionRepository.registrarError({ entidad, loteId, mensaje });
  } catch (fallo) {
    log?.warn({ err: fallo }, "No se pudo registrar el error de sincronización");
  }
}

export async function procesarLote({ loteId, entidad, registros }, { log } = {}) {
  try {
    await sincronizacionRepository.enTransaccion(async (tx) => {
      const sincronizacion =
        await sincronizacionRepository.registrarEjecucion(tx, entidad);

      // La clave única de loteId impide aplicar dos veces el mismo lote.
      await sincronizacionRepository.registrarLote(tx, {
        loteId,
        sincronizacionId: sincronizacion.id,
        cantidadRegistros: registros.length,
      });

      await guardarPorEntidad[entidad](tx, registros);
    });
  } catch (error) {
    if (esLoteRepetido(error)) {
      return { estado: "duplicado", loteId, entidad };
    }

    await registrarFallo({ entidad, loteId }, error, log);
    throw error;
  }

  return {
    estado: "aplicado",
    loteId,
    entidad,
    registros: registros.length,
  };
}
