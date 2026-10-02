import https from "node:https";

// Excepción local: omite vigencia/nombre/CA, pero exige la huella configurada.
// No envía credenciales hasta comprobar el certificado y no sigue redirecciones.
export function crearTransporteSap(urlBase, huella) {
  const origen = new URL(urlBase).origin;
  return (url, opciones = {}) => new Promise((resolve, reject) => {
    if (new URL(url).origin !== origen) return reject(new Error("Destino SAP distinto"));
    const req = https.request(url, {
      method: opciones.method ?? "GET", headers: opciones.headers,
      rejectUnauthorized: false, agent: false, signal: opciones.signal,
    }, res => {
      const partes = []; let bytes = 0;
      res.on("error", reject);
      res.on("data", parte => {
        bytes += parte.length;
        if (bytes > 20 * 1024 * 1024) { res.destroy(new Error("Respuesta demasiado grande")); return; }
        partes.push(parte);
      });
      res.on("end", () => {
        if (res.statusCode >= 300 && res.statusCode < 400) return reject(new Error("Redirección rechazada"));
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        const vacia = [204, 205, 304].includes(res.statusCode);
        resolve(new Response(vacia ? null : Buffer.concat(partes), { status: res.statusCode, headers }));
      });
    });
    req.on("error", reject);
    req.on("socket", socket => socket.once("secureConnect", () => {
      const recibida = socket.getPeerCertificate().fingerprint256?.replaceAll(":", "").toUpperCase();
      if (recibida !== huella) { req.destroy(new Error("Huella SAP diferente")); return; }
      req.end(opciones.body);
    }));
  });
}
