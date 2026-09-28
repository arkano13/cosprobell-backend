import http from "node:http";
import { once } from "node:events";

const JSON_CT = { "Content-Type": "application/json" };

function errorSap(res, status, mensaje) {
  res.writeHead(status, JSON_CT);
  res.end(JSON.stringify({ error: { code: -1, message: { lang: "es", value: mensaje } } }));
}

// Imita lo esencial de Service Layer: login con cookies, paginación con
// nextLink, $count, vencimiento de sesión y logout.
export async function iniciarServiceLayerFalso({
  version = "v1",
  datos = {},
  conteos = {},
  contrasena = "clave-correcta",
  alterarRespuesta = (_entidad, cuerpo) => cuerpo,
} = {}) {
  const estado = {
    logins: 0,
    logouts: 0,
    cuerposLogin: [],
    peticiones: [],
    sesiones: new Set(),
    vencerProximaSesion: false,
  };

  const prefijo = `/b1s/${version}/`;

  const servidor = http.createServer(async (req, res) => {
    let cuerpo = "";
    for await (const parte of req) cuerpo += parte;

    const url = new URL(req.url, "http://localhost");
    const ruta = url.pathname.slice(prefijo.length);

    if (req.method === "POST" && ruta === "Login") {
      const datosLogin = JSON.parse(cuerpo);
      estado.cuerposLogin.push(datosLogin);

      if (datosLogin.Password !== contrasena) {
        return errorSap(res, 401, "Invalid login credential.");
      }

      estado.logins += 1;
      const sesion = `sesion-${estado.logins}`;
      estado.sesiones.add(sesion);

      res.writeHead(200, {
        ...JSON_CT,
        "Set-Cookie": [`B1SESSION=${sesion}; path=${prefijo}; HttpOnly`, "ROUTEID=.node1; path=/b1s"],
      });
      return res.end(JSON.stringify({ SessionId: sesion, Version: "1000180", SessionTimeout: 30 }));
    }

    if (req.method === "POST" && ruta === "Logout") {
      estado.logouts += 1;
      res.writeHead(204);
      return res.end();
    }

    estado.peticiones.push({ ruta, busqueda: url.searchParams, cabeceras: req.headers });

    const sesion = /B1SESSION=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];

    if (!estado.sesiones.has(sesion) || estado.vencerProximaSesion) {
      estado.vencerProximaSesion = false;
      estado.sesiones.delete(sesion);
      return errorSap(res, 401, "Invalid session or session already timeout.");
    }

    const [entidad, sufijo] = ruta.split("/");

    if (sufijo === "$count") {
      const clave = [entidad, url.searchParams.get("$filter")].filter(Boolean).join("|");

      if (!(clave in conteos)) {
        return errorSap(res, 404, `Sin conteo para ${clave}`);
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(String(conteos[clave]));
    }

    const registros = datos[entidad];

    if (!registros) {
      return errorSap(res, 404, `Entidad desconocida: ${entidad}`);
    }

    const tamano = Number(/odata\.maxpagesize=(\d+)/.exec(req.headers.prefer ?? "")?.[1] ?? 20);
    const salto = Number(url.searchParams.get("$skip") ?? 0);
    const tope = url.searchParams.get("$top");
    const respuesta = {
      value: registros.slice(salto, salto + (tope ? Math.min(Number(tope), tamano) : tamano)),
    };

    if (!tope && salto + tamano < registros.length) {
      const siguiente = new URLSearchParams(url.searchParams);
      siguiente.set("$skip", String(salto + tamano));
      respuesta[version === "v1" ? "odata.nextLink" : "@odata.nextLink"] =
        `${entidad}?${siguiente}`;
    }

    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify(alterarRespuesta(entidad, respuesta)));
  });

  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");

  return {
    url: `http://127.0.0.1:${servidor.address().port}/b1s/${version}`,
    estado,
    cerrar: () =>
      new Promise((resolve) => {
        servidor.close(resolve);
        servidor.closeAllConnections();
      }),
  };
}
