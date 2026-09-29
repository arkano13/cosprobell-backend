// Inspecciona el certificado de Service Layer sin instalarlo ni modificar la confianza.
// Solo lee el certificado: no inicia sesión en SAP ni envía usuario o contraseña.
// Uso: node --env-file=.env.puente scripts/ver-certificado.js
import tls from "node:tls";
import net from "node:net";

let url;
try { url = new URL(process.env.SAP_SERVICE_LAYER_URL); } catch {
  console.error("Falta SAP_SERVICE_LAYER_URL. Ejecutar con: node --env-file=.env.puente scripts/ver-certificado.js");
  process.exit(1);
}
const host = url.hostname.replace(/^\[|\]$/g, "");
const port = Number(url.port || 443);

// rejectUnauthorized: false solo para poder LEER el certificado; el puente nunca lo desactiva.
const socket = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false }, () => {
  const cert = socket.getPeerCertificate(true);
  console.log("Servidor:         ", `${host}:${port}`);
  console.log("Emitido para:     ", cert.subject?.CN);
  console.log("Nombres válidos:  ", cert.subjectaltname ?? "(ninguno)");
  console.log("Emitido por:      ", cert.issuer?.CN);
  console.log("Vence:            ", cert.valid_to);
  console.log("Confiable aquí:   ", socket.authorized ? "sí" : `no (${socket.authorizationError})`);

  console.log("Huella SHA-256:   ", cert.fingerprint256 ?? "(no disponible)");
  console.log("Solo diagnóstico: no se guardó ni se instaló ningún certificado.");
  console.log("Pedir a sistemas la cadena de confianza o confirmar la huella por un canal independiente.");
  socket.end();
});
socket.setTimeout(15000, () => { console.error("Sin respuesta del servidor en 15 segundos."); socket.destroy(); process.exitCode = 1; });
socket.on("error", (error) => { console.error("No se pudo conectar:", error.code ?? error.message); process.exitCode = 1; });
