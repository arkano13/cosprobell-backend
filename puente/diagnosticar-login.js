// Diagnóstico manual: un Login, sin consultas de negocio, seguido de Logout si entra.
// No imprime contraseña, cuerpo de Login, cookies ni respuesta de sesión.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { configurar } from "./config.js";
import { crearTransporteSap } from "./sap-tls.js";

async function main() {
  const archivo = parseEnv(await readFile(".env.puente", "utf8"));
  const campos = ["SAP_COMPANY_DB", "SAP_USER", "SAP_PASSWORD", "SAP_SERVICE_LAYER_URL"];
  const diferencias = campos.filter(c => archivo[c] !== undefined && process.env[c] !== archivo[c]);
  if (diferencias.length) {
    console.log(JSON.stringify({ evento: "variables_externas_distintas", campos: diferencias,
      mensaje: "El proceso no está usando los mismos valores que .env.puente. Revisar variables heredadas; no imprimir sus valores." }));
    process.exitCode = 1;
    return;
  }
  const config = configurar(process.env);
  const secretos = [config.password, config.clave, config.usuario];
  const limpiar = valor => {
    let texto = typeof valor === "string" ? valor : "Sin mensaje de SAP";
    for (const secreto of secretos.filter(Boolean)) {
      for (const variante of [secreto, JSON.stringify(secreto).slice(1, -1), encodeURIComponent(secreto)]) {
        texto = texto.replaceAll(variante, "[OCULTO]");
      }
    }
    return texto.replace(/(?:B1SESSION|ROUTEID|SessionId|Password)\s*[:=]\s*[^\s,;]+/gi, "[OCULTO]")
      .replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 800);
  };
  const transporte = config.huellaSap ? crearTransporteSap(config.sapUrl, config.huellaSap) : fetch;
  const respuesta = await transporte(`${config.sapUrl}/Login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: config.empresa, UserName: config.usuario, Password: config.password }),
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => null);
    const codigo = cuerpo?.error?.code;
    console.log(JSON.stringify({ evento: "login_rechazado", http: respuesta.status, empresa: config.empresa,
      codigoSap: typeof codigo === "number" ? codigo : /^-?\d{1,10}$/.test(String(codigo)) ? String(codigo) : null,
      mensaje: limpiar(cuerpo?.error?.message?.value ?? cuerpo?.error?.message) }));
    process.exitCode = 1;
    return;
  }
  const cookie = respuesta.headers.getSetCookie().map(c => c.split(";", 1)[0])
    .filter(c => /^(B1SESSION|ROUTEID)=/.test(c)).join("; ");
  await respuesta.body?.cancel();
  console.log(JSON.stringify({ evento: "login_correcto", http: respuesta.status, empresa: config.empresa }));
  if (!cookie.includes("B1SESSION=")) throw new Error("SESION_NO_CONFIRMADA");
  const cierre = await transporte(`${config.sapUrl}/Logout`, { method: "POST", headers: { Cookie: cookie },
    redirect: "error", signal: AbortSignal.timeout(30000) });
  await cierre.body?.cancel();
  console.log(JSON.stringify({ evento: "cierre_sesion", http: cierre.status }));
  if (!cierre.ok) process.exitCode = 1;
}
main().catch(() => {
  console.error(JSON.stringify({ evento: "diagnostico_interrumpido", codigo: "REVISAR_ARCHIVO_CONFIGURACION_O_CONEXION" }));
  process.exitCode = 1;
});
