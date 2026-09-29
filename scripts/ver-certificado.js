// Muestra el certificado del Service Layer configurado en SAP_SERVICE_LAYER_URL y, si encuentra la raíz,
// la guarda en certificado/service-layer.pem para que ejecutar-puente.cmd la use.
// Solo lee el certificado: no inicia sesión en SAP ni envía usuario o contraseña.
// Uso: node --env-file=.env.puente scripts/ver-certificado.js
import tls from "node:tls";
import net from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";

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

  let raiz = cert;
  while (raiz.issuerCertificate && raiz.issuerCertificate !== raiz) raiz = raiz.issuerCertificate;
  if (raiz.issuerCertificate === raiz) {
    const base64 = raiz.raw.toString("base64").match(/.{1,64}/g).join("\n");
    mkdirSync("certificado", { recursive: true });
    writeFileSync("certificado/service-layer.pem", `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`);
    console.log("Guardado:          certificado/service-layer.pem (raíz:", raiz.subject?.CN + ")");
  } else {
    console.log(`Falta la raíz: pedir a sistemas el certificado de "${raiz.issuer?.CN}" y guardarlo como certificado/service-layer.pem.`);
  }
  socket.end();
});
socket.setTimeout(15000, () => { console.error("Sin respuesta del servidor en 15 segundos."); socket.destroy(); process.exitCode = 1; });
socket.on("error", (error) => { console.error("No se pudo conectar:", error.code ?? error.message); process.exitCode = 1; });
