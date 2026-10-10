import { configurar } from "./config.js";
import { fecha, nombresFinanzas } from "../src/shared/finanzas/contratos.js";

export function configurarFinanzas(v) {
  const base = configurar(v);
  if (v.BRIDGE_FINANCE_ENABLED !== "true") throw new Error("Active BRIDGE_FINANCE_ENABLED explícitamente después del sondeo y la migración");
  const desde = v.BRIDGE_FINANCE_SINCE;
  if (!fecha.safeParse(desde).success || desde > new Date().toISOString().slice(0, 10)) throw new Error("Defina BRIDGE_FINANCE_SINCE=AAAA-MM-DD");
  const campo = nombre => {
    const valor = v[nombre]?.trim() || null;
    if (valor && !/^U_[A-Za-z0-9_]{1,40}$/.test(valor)) throw new Error(`${nombre} debe ser un campo U_ confirmado en SAP`);
    return valor;
  };
  const moneda = nombre => {
    if (!/^[A-Za-z0-9$€£]{1,3}$/.test(v[nombre] ?? "")) throw new Error(`Defina ${nombre} según OADM de SAP`);
    return v[nombre];
  };
  const numero = (nombre, defecto, min, max) => {
    const n = Number(v[nombre] ?? defecto);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Configuración inválida: ${nombre}`);
    return n;
  };
  let frecuencias = {};
  try { frecuencias = JSON.parse(v.BRIDGE_FINANCE_FREQUENCIES_JSON ?? "{}"); } catch { throw new Error("Frecuencias financieras inválidas"); }
  if (!frecuencias || typeof frecuencias !== "object" || Array.isArray(frecuencias) || Object.entries(frecuencias).some(([k, n]) =>
    !nombresFinanzas.includes(k) || !Number.isInteger(n) || n < 900 || n > 2592000)) throw new Error("Frecuencias financieras inválidas");
  return { ...base, desde, campoZona: campo("BRIDGE_FINANCE_ZONE_FIELD"), campoRuta: campo("BRIDGE_FINANCE_ROUTE_FIELD"),
    monedaLocal: moneda("BRIDGE_FINANCE_LOCAL_CURRENCY"), monedaSistema: moneda("BRIDGE_FINANCE_SYSTEM_CURRENCY"),
    frecuencias, maxConsultas: numero("BRIDGE_FINANCE_MAX_REQUESTS", 10, 2, 100),
    maxDuracionMs: numero("BRIDGE_FINANCE_MAX_SECONDS", 60, 10, 120) * 1000,
    pausaMs: Math.max(base.pausaMs, 1500) };
}
