import { solicitar, leerJson, ErrorPuente } from "./http.js";
export function clienteBackendFinanzas(config, fetchImpl = fetch) {
  return async (entidad, accion, body) => {
    const headers = { Authorization: `Bearer ${config.clave}`, "Content-Type": "application/json" };
    const r = await solicitar(`${config.backendUrl}/integracion/finanzas/${entidad}/${accion}`,
      { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }, fetchImpl, async respuesta => {
        const code = (await respuesta.json())?.error?.code;
        return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? { codigoBackend: code } : undefined;
      });
    const resultado = await leerJson(r);
    if (!Object.hasOwn(resultado, "data")) throw new ErrorPuente("CONFIRMACION_INVALIDA");
    return resultado.data;
  };
}
