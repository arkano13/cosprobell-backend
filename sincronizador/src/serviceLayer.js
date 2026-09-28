export class ErrorServiceLayer extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ErrorServiceLayer";
    this.status = status;
  }
}

async function mensajeDeSap(respuesta) {
  try {
    const cuerpo = await respuesta.json();
    const mensaje = cuerpo?.error?.message;
    return typeof mensaje === "string" ? mensaje : (mensaje?.value ?? null);
  } catch {
    return null;
  }
}

function construirConsulta({ select, filter, orderby, top }) {
  const partes = [];

  if (select?.length) partes.push(`$select=${encodeURIComponent(select.join(","))}`);
  if (filter) partes.push(`$filter=${encodeURIComponent(filter)}`);
  if (orderby) partes.push(`$orderby=${encodeURIComponent(orderby)}`);
  if (top) partes.push(`$top=${top}`);

  return partes.length > 0 ? `?${partes.join("&")}` : "";
}

export function crearClienteServiceLayer({
  url,
  companyDb,
  usuario,
  contrasena,
  tiempoMaximoMs = 60_000,
}) {
  const base = new URL(`${url.replace(/\/+$/, "")}/`);
  let cookies = null;
  let infoSesion = null;

  function resolver(ruta) {
    const destino = new URL(ruta, base);

    // Las cookies de sesión nunca se envían a otro servidor.
    if (destino.origin !== base.origin) {
      throw new ErrorServiceLayer(`Service Layer devolvió un enlace a otro servidor: ${destino.origin}`);
    }

    return destino;
  }

  async function iniciarSesion() {
    const respuesta = await fetch(resolver("Login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CompanyDB: companyDb, UserName: usuario, Password: contrasena }),
      signal: AbortSignal.timeout(tiempoMaximoMs),
    });

    if (!respuesta.ok) {
      const mensaje = await mensajeDeSap(respuesta);
      throw new ErrorServiceLayer(
        `SAP rechazó el inicio de sesión (${respuesta.status})${mensaje ? `: ${mensaje}` : ""}`,
        respuesta.status
      );
    }

    const cuerpo = await respuesta.json();
    const recibidas = respuesta.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .filter((cookie) => /^(B1SESSION|ROUTEID)=/.test(cookie));

    cookies =
      recibidas.length > 0 ? recibidas.join("; ") : `B1SESSION=${cuerpo.SessionId}`;
    infoSesion = { version: cuerpo.Version ?? null, minutosSesion: cuerpo.SessionTimeout ?? null };

    return infoSesion;
  }

  async function obtener(ruta, { tamanoPagina, reintentarSesion = true } = {}) {
    if (!cookies) {
      await iniciarSesion();
    }

    const cabeceras = { Accept: "application/json", Cookie: cookies };

    if (tamanoPagina) {
      cabeceras.Prefer = `odata.maxpagesize=${tamanoPagina}`;
    }

    const respuesta = await fetch(resolver(ruta), {
      headers: cabeceras,
      signal: AbortSignal.timeout(tiempoMaximoMs),
    });

    // La sesión de SAP vence (30 minutos por defecto): se renueva una vez.
    if (respuesta.status === 401 && reintentarSesion) {
      cookies = null;
      return obtener(ruta, { tamanoPagina, reintentarSesion: false });
    }

    if (!respuesta.ok) {
      const mensaje = await mensajeDeSap(respuesta);
      throw new ErrorServiceLayer(
        `GET ${ruta.split("?")[0]} respondió ${respuesta.status}${mensaje ? `: ${mensaje}` : ""}`,
        respuesta.status
      );
    }

    return respuesta;
  }

  return {
    iniciarSesion,

    get sesion() {
      return infoSesion;
    },

    async *leerPaginas(entidad, { select, filter, orderby, tamanoPagina = 100 } = {}) {
      let ruta = `${entidad}${construirConsulta({ select, filter, orderby })}`;

      while (ruta) {
        const cuerpo = await (await obtener(ruta, { tamanoPagina })).json();
        yield cuerpo.value ?? [];

        const siguiente = cuerpo["@odata.nextLink"] ?? cuerpo["odata.nextLink"] ?? null;

        if (siguiente === ruta) {
          throw new ErrorServiceLayer(`Service Layer repitió la misma página de ${entidad}`);
        }

        ruta = siguiente;
      }
    },

    async leerPrimeros(entidad, opciones) {
      const cuerpo = await (await obtener(`${entidad}${construirConsulta(opciones)}`)).json();
      return cuerpo.value ?? [];
    },

    async contar(entidad, { filter } = {}) {
      const texto = await (await obtener(`${entidad}/$count${construirConsulta({ filter })}`)).text();
      const cantidad = Number(texto.trim());

      if (!Number.isInteger(cantidad)) {
        throw new ErrorServiceLayer(`Respuesta de conteo inesperada para ${entidad}`);
      }

      return cantidad;
    },

    async cerrarSesion() {
      if (!cookies) {
        return;
      }

      try {
        await fetch(resolver("Logout"), {
          method: "POST",
          headers: { Cookie: cookies },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // La sesión vencerá sola en SAP; no es motivo para fallar.
      } finally {
        cookies = null;
      }
    },
  };
}
