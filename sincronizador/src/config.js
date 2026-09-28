const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function leerUrl(valor, nombre, errores, { validar }) {
  try {
    const url = new URL(valor);
    const error = validar(url);

    if (error) {
      errores.push(`${nombre}: ${error}`);
      return null;
    }

    return url;
  } catch {
    errores.push(`${nombre}: no es una URL válida`);
    return null;
  }
}

export function leerConfiguracion(variables, { requiereBackend }) {
  const errores = [];

  const requeridas = ["SAP_SL_URL", "SAP_COMPANY_DB", "SAP_USER", "SAP_PASSWORD"];

  if (requiereBackend) {
    requeridas.push("BACKEND_URL", "BRIDGE_SECRET");
  }

  for (const nombre of requeridas) {
    if (!variables[nombre]?.trim()) {
      errores.push(`${nombre}: falta el valor`);
    }
  }

  if (errores.length > 0) {
    throw new Error(`Configuración incompleta:\n  - ${errores.join("\n  - ")}`);
  }

  const serviceLayer = leerUrl(variables.SAP_SL_URL.trim(), "SAP_SL_URL", errores, {
    validar: (url) => {
      if (url.protocol !== "https:" && !HOSTS_LOCALES.has(url.hostname)) {
        return "Service Layer debe usarse con HTTPS";
      }

      if (!/\/b1s\/v[12]\/?$/.test(url.pathname)) {
        return "debe terminar en /b1s/v1 o /b1s/v2";
      }

      return null;
    },
  });

  let backend = null;

  if (requiereBackend) {
    backend = leerUrl(variables.BACKEND_URL.trim(), "BACKEND_URL", errores, {
      validar: (url) =>
        url.protocol !== "https:" && !HOSTS_LOCALES.has(url.hostname)
          ? "el backend debe usarse con HTTPS"
          : null,
    });

    if (variables.BRIDGE_SECRET.length < 32) {
      errores.push("BRIDGE_SECRET: debe tener al menos 32 caracteres");
    }
  }

  if (errores.length > 0) {
    throw new Error(`Configuración inválida:\n  - ${errores.join("\n  - ")}`);
  }

  return Object.freeze({
    serviceLayerUrl: serviceLayer.href.replace(/\/+$/, ""),
    companyDb: variables.SAP_COMPANY_DB.trim(),
    usuario: variables.SAP_USER.trim(),
    contrasena: variables.SAP_PASSWORD,
    backendUrl: backend?.origin ?? null,
    secreto: requiereBackend ? variables.BRIDGE_SECRET : null,
  });
}
