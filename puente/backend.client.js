import { solicitar, leerJson, ErrorPuente } from "./http.js";
export function crearClienteBackend(config, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${config.clave}`, "Content-Type": "application/json" };
  return {
    async estado() {
      const respuesta = await solicitar(`${config.backendUrl}/integracion/productos/estado`, { headers }, fetchImpl);
      const { data } = await leerJson(respuesta);
      if (!data || data.empresa !== config.empresa || !Number.isSafeInteger(data.ultimaSecuencia) || data.ultimaSecuencia < 0) {
        throw new ErrorPuente("ESTADO_BACKEND_INVALIDO");
      }
      return data.ultimaSecuencia;
    },
    async enviar(lote) {
      const respuesta = await solicitar(`${config.backendUrl}/integracion/productos`, { method: "POST", headers, body: JSON.stringify(lote) }, fetchImpl);
      const { data } = await leerJson(respuesta);
      if (!data || data.secuencia !== lote.secuencia || data.recibidos !== lote.productos.length || typeof data.repetido !== "boolean") {
        throw new ErrorPuente("CONFIRMACION_INVALIDA");
      }
      return data;
    },
  };
}
