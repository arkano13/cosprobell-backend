import { solicitar, leerJson, ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
// Código de error de nuestro backend (p. ej. PRODUCTO_NO_SINCRONIZADO): ayuda a diagnosticar sin exponer datos.
async function codigoDelBackend(respuesta) {
  const codigo = (await respuesta.json())?.error?.code;
  return typeof codigo === "string" && /^[A-Z0-9_]{1,60}$/.test(codigo) ? { codigoBackend: codigo } : undefined;
}
export function crearClienteBackend(config, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${config.clave}`, "Content-Type": "application/json" };
  const pedir = (ruta, opciones = { headers }) => solicitar(`${config.backendUrl}/integracion/${ruta}`, opciones, fetchImpl, codigoDelBackend);
  return {
    async solicitud(entidades) {
      const nombres = entidades.map(e => e.nombre);
      const { data } = await leerJson(await pedir("solicitud/consultar", {
        method: "POST", headers, body: JSON.stringify({ entidades: nombres }),
      }));
      if (data === null) return null;
      if (!data || typeof data.id !== "string" || !/^[a-f0-9-]{36}$/i.test(data.id) ||
        !Array.isArray(data.entidades) || !data.entidades.length || !data.entidades.every(n => nombres.includes(n)) ||
        !Array.isArray(data.completas) || !data.completas.every(n => data.entidades.includes(n))) throw new ErrorPuente("SOLICITUD_MANUAL_INVALIDA");
      return data;
    },
    async progresoSolicitud(id, completas, error) {
      const { data } = await leerJson(await pedir("solicitud/progreso", {
        method: "POST", headers, body: JSON.stringify({ id, completas, ...(error ? { error } : {}) }),
      }));
      if (data?.id !== id) throw new ErrorPuente("CONFIRMACION_INVALIDA");
      return data;
    },
    async recorrido(entidad, accion, recorridoId, secuencia) {
      const { data } = await leerJson(await pedir(`${entidad.nombre}/recorrido/${accion}`, {
        method: "POST", headers, body: JSON.stringify({ recorridoId, ...(accion === "finalizar" ? { secuencia } : {}) }),
      }));
      if (data?.recorridoId !== recorridoId || (accion === "finalizar" && data.completo !== true)) {
        throw new ErrorPuente("CONFIRMACION_INVALIDA");
      }
      return data;
    },
    async observar(claves, entidad) {
      const { data } = await leerJson(await pedir(`${entidad.nombre}/observados`, {
        method: "POST", headers, body: JSON.stringify({ claves }),
      }));
      if (data?.observados !== claves.length) throw new ErrorPuente("CONFIRMACION_INVALIDA");
    },
    async estado(entidad = PRODUCTOS) {
      const respuesta = await pedir(`${entidad.nombre}/estado`);
      const { data } = await leerJson(respuesta);
      if (!data || data.empresa !== config.empresa || !Number.isSafeInteger(data.ultimaSecuencia) || data.ultimaSecuencia < 0) {
        throw new ErrorPuente("ESTADO_BACKEND_INVALIDO");
      }
      return data.ultimaSecuencia;
    },
    // Pedidos que el backend tiene abiertos, con la hora de su última actualización y la hora actual,
    // ambas del reloj del backend: así la comparación no depende del reloj de este equipo.
    async pedidosAbiertos(ruta = "pedidos/abiertos") {
      const respuesta = await pedir(ruta);
      const { data } = await leerJson(respuesta);
      const fecha = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
      if (!data || !fecha(data.ahora) || !Array.isArray(data.pedidos) || !data.pedidos.every((p) =>
        Number.isSafeInteger(p?.docEntry) && p.docEntry >= 0 && fecha(p.sincronizadoEn))) {
        throw new ErrorPuente("ESTADO_BACKEND_INVALIDO");
      }
      return data;
    },
    // Hora del backend al empezar un recorrido completo (pedidos y códigos de barras).
    async hora() {
      const { data } = await leerJson(await pedir("hora"));
      if (!data || typeof data.ahora !== "string" || !Number.isFinite(Date.parse(data.ahora))) throw new ErrorPuente("ESTADO_BACKEND_INVALIDO");
      return data.ahora;
    },
    // Tras recorrer todos los códigos de barras: marca como retirados los que SAP ya no lista.
    async marcarRetirados(antesDe) {
      const { data } = await leerJson(await pedir("codigosBarras/retirados", { method: "POST", headers, body: JSON.stringify({ antesDe }) }));
      if (!data || !Number.isSafeInteger(data.retirados) || data.retirados < 0) throw new ErrorPuente("CONFIRMACION_INVALIDA");
      return data.retirados;
    },
    async enviar(lote, entidad = PRODUCTOS) {
      const respuesta = await pedir(entidad.nombre, { method: "POST", headers, body: JSON.stringify(lote) });
      const { data } = await leerJson(respuesta);
      if (!data || data.secuencia !== lote.secuencia || data.recibidos !== lote[entidad.nombre].length || typeof data.repetido !== "boolean") {
        throw new ErrorPuente("CONFIRMACION_INVALIDA");
      }
      return data;
    },
  };
}
