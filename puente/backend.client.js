import { solicitar, leerJson, ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
export function crearClienteBackend(config, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${config.clave}`, "Content-Type": "application/json" };
  return {
    async estado(entidad = PRODUCTOS) {
      const respuesta = await solicitar(`${config.backendUrl}/integracion/${entidad.nombre}/estado`, { headers }, fetchImpl);
      const { data } = await leerJson(respuesta);
      if (!data || data.empresa !== config.empresa || !Number.isSafeInteger(data.ultimaSecuencia) || data.ultimaSecuencia < 0) {
        throw new ErrorPuente("ESTADO_BACKEND_INVALIDO");
      }
      return data.ultimaSecuencia;
    },
    // Pedidos que el backend tiene abiertos, con la hora de su última actualización y la hora actual,
    // ambas del reloj del backend: así la comparación no depende del reloj de este equipo.
    async pedidosAbiertos() {
      const respuesta = await solicitar(`${config.backendUrl}/integracion/pedidos/abiertos`, { headers }, fetchImpl);
      const { data } = await leerJson(respuesta);
      const fecha = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
      if (!data || !fecha(data.ahora) || !Array.isArray(data.pedidos) || !data.pedidos.every((p) =>
        Number.isSafeInteger(p?.docEntry) && p.docEntry >= 0 && fecha(p.sincronizadoEn))) {
        throw new ErrorPuente("ESTADO_BACKEND_INVALIDO");
      }
      return data;
    },
    async enviar(lote, entidad = PRODUCTOS) {
      const respuesta = await solicitar(`${config.backendUrl}/integracion/${entidad.nombre}`, { method: "POST", headers, body: JSON.stringify(lote) }, fetchImpl);
      const { data } = await leerJson(respuesta);
      if (!data || data.secuencia !== lote.secuencia || data.recibidos !== lote[entidad.nombre].length || typeof data.repetido !== "boolean") {
        throw new ErrorPuente("CONFIRMACION_INVALIDA");
      }
      return data;
    },
  };
}
