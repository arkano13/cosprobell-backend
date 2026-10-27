import { definicionesGetFinanzas, camposNoDisponiblesGet } from "./finanzas.get.js";
import { abrirFinanzas } from "./finanzas.estado.js";
import { sincronizarPaginaFinanzas, fuenteFinanzas } from "./finanzas.sincronizar.js";

export async function abrirImportacion(config, abrir = abrirFinanzas) {
  const trabajos = [];
  for (const def of Object.values(definicionesGetFinanzas(config))) trabajos.push({ def, almacen: await abrir(config, def.nombre) });
  return trabajos;
}
export function trabajoCompleto(trabajo, config) {
  const s = trabajo.almacen.estado;
  return Boolean(!s.recorrido && s.ultimoCompleto && s.fuente === fuenteFinanzas(trabajo.def, config));
}
export function informeImportacion(config, trabajos, ahora = new Date()) {
  const entidades = trabajos.map(t => {
    const s = t.almacen.estado;
    return { entidad: t.def.nombre, completo: trabajoCompleto(t, config), registrosConfirmados: s.cantidadConfirmada ?? null,
      lotesConfirmados: s.secuencia, inicio: s.iniciadoEn ?? s.ultimoInicio ?? null, fin: trabajoCompleto(t, config) ? s.ultimoCompleto : null,
      camposNoDisponibles: camposNoDisponiblesGet[t.def.nombre] ?? [] };
  });
  return { version: 1, empresa: config.empresa, lectura: "get_parcial", puntual: true, desde: config.desde,
    monedaLocal: config.monedaLocal, monedaSistema: config.monedaSistema, monedasConfirmadasManualmente: true,
    generadoEn: ahora.toISOString(), completo: entidades.length > 0 && entidades.every(e => e.completo),
    validadoContraSap: false, carteraCompleta: false, excluidas: ["conciliaciones", "partidas"],
    advertencia: "Lecturas tomadas en distintos momentos; comparar contra SAP. Movimientos incluye líneas contables: consultar por código de cliente.", entidades };
}
export async function importarTanda({ config, trabajos, sap, backend, detenido = () => false, informar = () => {},
  sincronizar = sincronizarPaginaFinanzas }) {
  const cola = trabajos.filter(t => !trabajoCompleto(t, config)).sort((a, b) =>
    Date.parse(a.almacen.estado.ultimaAtencion ?? "1970-01-01") - Date.parse(b.almacen.estado.ultimaAtencion ?? "1970-01-01"));
  while (cola.length && !detenido()) {
    const t = cola.shift();
    await t.almacen.guardar({ ...t.almacen.estado, ultimaAtencion: new Date().toISOString() });
    try {
      const r = await sincronizar({ config, ...t, sap, backend });
      informar({ evento: "ciclo_financiero", entidad: t.def.nombre, ...r });
      if (!r.completo) cola.push(t);
    } catch (error) {
      if (error.code === "PRESUPUESTO_AGOTADO") {
        informar({ evento: "pausa_por_presupuesto", entidad: t.def.nombre });
        break;
      }
      error.entidadFinanciera = t.def.nombre;
      throw error;
    }
  }
  return informeImportacion(config, trabajos);
}
