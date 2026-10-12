import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ENTIDADES } from "./entidades.js";
import { validarAlmacenesSql } from "./existencias.sql.js";
function urlSegura(valor, campo) {
  let u;
  try { u = new URL(valor); } catch { throw new Error(`Configuración inválida: ${campo}`); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if ((u.protocol !== "https:" && !(local && u.protocol === "http:")) || u.username || u.password || u.search || u.hash) {
    throw new Error(`Configuración inválida: ${campo}`);
  }
  return u.href.replace(/\/+$/, "");
}
export function configurar(v) {
  if (v.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("No se permite desactivar la validación TLS");
  for (const campo of ["SAP_COMPANY_DB", "SAP_USER", "SAP_PASSWORD", "BRIDGE_API_KEY", "BRIDGE_STATE_DIR"]) {
    if (typeof v[campo] !== "string" || !v[campo].trim()) throw new Error(`Falta configuración: ${campo}`);
  }
  if (v.BRIDGE_API_KEY.length < 32) throw new Error("BRIDGE_API_KEY requiere al menos 32 caracteres");
  const sapUrl = urlSegura(v.SAP_SERVICE_LAYER_URL, "SAP_SERVICE_LAYER_URL");
  if (!/\/b1s\/v[12]$/.test(sapUrl)) throw new Error("SAP_SERVICE_LAYER_URL debe terminar en /b1s/v1 o /b1s/v2");
  const backendUrl = urlSegura(v.BACKEND_URL, "BACKEND_URL");
  const segundos = Number(v.BRIDGE_INTERVAL_SECONDS ?? 900);
  if (!Number.isSafeInteger(segundos) || segundos < 60 || segundos > 86400) throw new Error("BRIDGE_INTERVAL_SECONDS debe estar entre 60 y 86400");
  const empresa = v.SAP_COMPANY_DB.trim();
  const fuentePreparacion = v.BRIDGE_PICKING_SOURCE ?? "pedidos";
  if (!["pedidos", "facturas"].includes(fuentePreparacion)) throw new Error("BRIDGE_PICKING_SOURCE inválido");
  const facturasDesde = v.BRIDGE_PICKING_INVOICE_SINCE;
  if (fuentePreparacion === "facturas" && (!/^\d{4}-\d{2}-\d{2}$/.test(facturasDesde ?? "") ||
      !Number.isFinite(Date.parse(facturasDesde)) || new Date(facturasDesde).toISOString().slice(0, 10) !== facturasDesde)) {
    throw new Error("Defina BRIDGE_PICKING_INVOICE_SINCE=AAAA-MM-DD");
  }
  // Después de la primera carga, cada recorrido lee solo las facturas de los últimos días; las que siguen sin preparar
  // se vuelven a pedir una por una (las que informa el backend), aunque sean más viejas.
  const traslados = v.BRIDGE_PICKING_TRANSFERS ?? "false";
  if (!["true", "false"].includes(traslados)) throw new Error("BRIDGE_PICKING_TRANSFERS inválido");
  if (traslados === "true" && fuentePreparacion !== "facturas") throw new Error("BRIDGE_PICKING_TRANSFERS requiere BRIDGE_PICKING_SOURCE=facturas");
  const facturasDias = Number(v.BRIDGE_PICKING_INVOICE_DAYS ?? 2);
  if (!Number.isSafeInteger(facturasDias) || facturasDias < 1 || facturasDias > 60) throw new Error("BRIDGE_PICKING_INVOICE_DAYS inválido (1 a 60)");
  const activarInventario = v.BRIDGE_INVENTORY_ENABLED ?? "false";
  const activarCombos = v.BRIDGE_BOM_ENABLED ?? "false";
  if (!["true", "false"].includes(activarCombos)) throw new Error("BRIDGE_BOM_ENABLED inválido");
  if (!["true", "false"].includes(activarInventario)) throw new Error("BRIDGE_INVENTORY_ENABLED inválido");
  const modoExistencias = v.BRIDGE_STOCK_MODE ?? "items";
  if (!["items", "sql-01-02", "sql-almacenes"].includes(modoExistencias)) throw new Error("BRIDGE_STOCK_MODE inválido");
  const almacenesSap = modoExistencias === "sql-almacenes"
    ? validarAlmacenesSql((v.BRIDGE_WAREHOUSES ?? "").split(",").map(c => c.trim())) : ["01", "02"];
  if (modoExistencias !== "sql-almacenes" && v.BRIDGE_WAREHOUSES?.trim()) throw new Error("BRIDGE_WAREHOUSES requiere BRIDGE_STOCK_MODE=sql-almacenes");
  const excepcionTls = v.SAP_TLS_TEST_EXCEPTION ?? "false";
  if (!["false", "true"].includes(excepcionTls)) throw new Error("SAP_TLS_TEST_EXCEPTION inválido");
  const fijarCertificado = v.SAP_TLS_PINNED_CERTIFICATE ?? "false";
  if (!["false", "true"].includes(fijarCertificado)) throw new Error("SAP_TLS_PINNED_CERTIFICATE inválido");
  if (excepcionTls === "true" && empresa !== "XPRUEBAS2026" && fijarCertificado !== "true") {
    throw new Error("En producción active SAP_TLS_PINNED_CERTIFICATE explícitamente");
  }
  const huellaSap = excepcionTls === "true" || fijarCertificado === "true" ? (v.SAP_TLS_CERT_SHA256 ?? "").replaceAll(":", "").toUpperCase() : null;
  if (huellaSap !== null && (!/^[A-F0-9]{64}$/.test(huellaSap) || !sapUrl.startsWith("https://"))) {
    throw new Error("Certificado fijado requiere HTTPS y huella SHA-256 explícita");
  }
  const numero = (campo, defecto, min, max) => {
    const n = Number(v[campo] ?? defecto);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Configuración inválida: ${campo}`);
    return n;
  };
  let frecuencias;
  try { frecuencias = JSON.parse(v.BRIDGE_FREQUENCIES_JSON ?? "{}"); }
  catch { throw new Error("Configuración inválida: BRIDGE_FREQUENCIES_JSON"); }
  if (!frecuencias || Array.isArray(frecuencias) || typeof frecuencias !== "object" || Object.entries(frecuencias).some(([nombre, n]) =>
    !ENTIDADES.some(e => e.nombre === nombre) || !Number.isSafeInteger(n) || n < 60 || n > 2592000)) {
    throw new Error("Configuración inválida: BRIDGE_FREQUENCIES_JSON");
  }
  if (fuentePreparacion === "facturas" && frecuencias.facturasPreparacion == null && frecuencias.pedidos != null) {
    frecuencias.facturasPreparacion = frecuencias.pedidos;
  }
  // Los traslados se leen con la misma frecuencia que las facturas si no tienen una propia.
  if (traslados === "true" && frecuencias.trasladosPreparacion == null && frecuencias.facturasPreparacion != null) {
    frecuencias.trasladosPreparacion = frecuencias.facturasPreparacion;
  }
  return { sapUrl, backendUrl, empresa, usuario: v.SAP_USER, password: v.SAP_PASSWORD,
    fuentePreparacion, facturasDesde, facturasDias, trasladosHabilitados: traslados === "true",
    frecuencias, soloCambios: true, huellaSap, combosHabilitados: activarCombos === "true", inventarioHabilitado: activarInventario === "true", modoExistencias, almacenesSap,
    maxConsultas: numero("BRIDGE_MAX_REQUESTS", 25, 1, 10000),
    maxDuracionMs: numero("BRIDGE_MAX_SECONDS", 120, 10, 3600) * 1000,
    pausaMs: numero("BRIDGE_REQUEST_DELAY_MS", 500, 100, 60000),
    clave: v.BRIDGE_API_KEY, directorio: resolve(v.BRIDGE_STATE_DIR), intervaloMs: segundos * 1000,
    origen: createHash("sha256").update(JSON.stringify([sapUrl, backendUrl, empresa])).digest("hex") };
}
