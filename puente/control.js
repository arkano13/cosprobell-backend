import { setTimeout as esperar } from "node:timers/promises";
import { ErrorPuente } from "./http.js";
import { fuenteExistencias } from "./existencias.sql.js";

// Presupuesto compartido por todas las entidades de una ejecución.
export function crearControl(config, { ahora = Date.now, dormir = esperar } = {}) {
  const inicio = ahora(); let consultas = 0, anterior = null;
  return {
    async antesDeConsultar() {
      if (consultas >= config.maxConsultas || ahora() - inicio >= config.maxDuracionMs) {
        throw new ErrorPuente("PRESUPUESTO_AGOTADO");
      }
      if (anterior !== null) await dormir(Math.max(0, config.pausaMs - (ahora() - anterior)));
      if (ahora() - inicio >= config.maxDuracionMs) throw new ErrorPuente("PRESUPUESTO_AGOTADO");
      anterior = ahora(); consultas++;
    },
    resumen: () => ({ consultasSap: consultas, duracionMs: ahora() - inicio }),
  };
}

export function entidadPendiente(estado, nombre, config, ahora = Date.now()) {
  if (nombre === "existencias" && config.modoExistencias &&
    (estado.fuenteExistencias ?? "items") !== fuenteExistencias(config)) return true;
  if (estado.pendiente || estado.cursor !== null || estado.inicioRecorrido || estado.porRevisar || estado.recorridoId) return true;
  if (!estado.ultimoCompleto) return true;
  if (config.forzar) return true;
  const intervalo = config.frecuencias?.[nombre];
  return intervalo !== undefined && ahora - Date.parse(estado.ultimoCompleto) >= intervalo * 1000;
}

// Prioriza las entidades menos atendidas para que un catálogo grande no acapare
// cada ejecución. Las dependencias iniciales se comprueban por separado.
export function ordenarEntidades(entidades, almacenes) {
  return entidades.map((entidad, i) => ({ entidad, i }))
    .sort((a, b) => (Date.parse(almacenes[a.i].estado.ultimaAtencion ?? "1970-01-01") || 0)
      - (Date.parse(almacenes[b.i].estado.ultimaAtencion ?? "1970-01-01") || 0));
}
