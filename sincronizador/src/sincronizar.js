import { randomUUID } from "node:crypto";
import { ENTIDADES, proyectar } from "./entidades.js";
import { dividirEnLotes } from "./lotes.js";

// Carga completa de cada catálogo. Una entidad que falla detiene las
// siguientes, porque dependen de ella.
export async function sincronizar({
  serviceLayer,
  backend,
  entidades = ENTIDADES,
  informar = () => {},
  generarId = randomUUID,
}) {
  const resumen = [];

  for (const entidad of entidades) {
    const inicio = Date.now();

    // La paginación por desplazamiento puede repetir registros si SAP cambia
    // durante la lectura: se conserva la última versión de cada clave.
    const registros = new Map();

    for await (const pagina of serviceLayer.leerPaginas(entidad.nombre, {
      select: entidad.campos,
      orderby: entidad.orden,
      tamanoPagina: entidad.tamanoPagina,
    })) {
      for (const registro of pagina) {
        registros.set(registro[entidad.clave], proyectar(registro, entidad));
      }
    }

    informar(`${entidad.nombre}: ${registros.size} registros leídos de SAP`);

    const lotes = dividirEnLotes([...registros.values()]);
    const conteo = { aplicado: 0, duplicado: 0 };

    for (const [indice, lote] of lotes.entries()) {
      const resultado = await backend.enviarLote({
        loteId: generarId(),
        entidad: entidad.nombre,
        registros: lote,
      });

      conteo[resultado.estado] += 1;
      informar(`${entidad.nombre}: lote ${indice + 1}/${lotes.length} ${resultado.estado}`);
    }

    resumen.push({
      entidad: entidad.nombre,
      registros: registros.size,
      lotes: lotes.length,
      aplicados: conteo.aplicado,
      duplicados: conteo.duplicado,
      segundos: Math.round((Date.now() - inicio) / 1000),
    });
  }

  return resumen;
}
