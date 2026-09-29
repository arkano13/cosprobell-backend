// Cliente de la API para la pantalla de bodega. Toda respuesta con error se convierte en ErrorApi.
export class ErrorApi extends Error {
  constructor({ status = 0, mensaje, codigo = null, temporal = false }) {
    super(mensaje);
    this.name = "ErrorApi";
    this.mensaje = mensaje;
    this.status = status;
    this.codigo = codigo;
    // temporal: conviene reintentar la misma solicitud (sin conexión, tiempo agotado o falla del servidor).
    this.temporal = temporal;
  }
}

const TEMPORALES = [408, 429, 500, 502, 503, 504];

export function crearApi({ clave, base = "", fetchImpl = (...args) => globalThis.fetch(...args), tiempoMs = 15000 }) {
  async function pedir(metodo, ruta, cuerpo) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), tiempoMs);
    let respuesta;
    try {
      respuesta = await fetchImpl(`${base}${ruta}`, {
        method: metodo,
        headers: { "X-API-Key": clave, ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: control.signal,
      });
    } catch {
      throw new ErrorApi({ mensaje: "Sin conexión con el servidor", temporal: true });
    } finally {
      clearTimeout(temporizador);
    }
    let datos = null;
    try { datos = await respuesta.json(); } catch { /* cuerpo vacío o que no es JSON */ }
    if (!respuesta.ok) {
      // Picking responde { error: "mensaje" }; el resto, { error: { code, message } }.
      const error = datos?.error;
      const mensaje = typeof error === "string" ? error : error?.message ?? `Error del servidor (${respuesta.status})`;
      const codigo = error && typeof error === "object" ? error.code ?? null : null;
      throw new ErrorApi({ status: respuesta.status, mensaje, codigo, temporal: TEMPORALES.includes(respuesta.status) });
    }
    return datos;
  }

  return {
    pedidos: (cursor = null) => pedir("GET", `/pedidos?estado=abiertos&limit=25${cursor === null ? "" : `&cursor=${cursor}`}`),
    pedido: (docEntry) => pedir("GET", `/pedidos/${docEntry}`),
    iniciar: (pedidoDocEntry, usuarioId) => pedir("POST", "/picking", { pedidoDocEntry, ...(usuarioId ? { usuarioId } : {}) }),
    sesion: (id) => pedir("GET", `/picking/${id}`),
    escanear: (id, codigo, operacionId) => pedir("POST", `/picking/${id}/escanear`, { codigo, operacionId }),
    escaneos: (id, despuesDe = null) => pedir("GET", `/picking/${id}/escaneos?limit=100${despuesDe === null ? "" : `&despuesDe=${despuesDe}`}`),
    finalizar: (id) => pedir("POST", `/picking/${id}/finalizar`),
  };
}
