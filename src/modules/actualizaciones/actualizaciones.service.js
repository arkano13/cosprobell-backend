// Actualizaciones de la app de escritorio. Los instaladores se publican como Releases del repositorio de la app, que es
// privado: el backend los busca en GitHub con un token de solo lectura (que nunca sale del servidor) y se los pasa a la
// app, que se identifica con su clave de ingreso. electron-updater pide latest.yml y después el instalador que nombra.
// También se sirven los .blockmap, por si algún día la app baja solo lo que cambió (hoy baja el instalador entero).
import { AppError } from "../../shared/errors/AppError.js";

const API = "https://api.github.com";
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(yml|exe|blockmap)$/;
const CACHE_MS = 60_000;

const falla = (code, statusCode, message) => new AppError({ code, statusCode, message });

export function crearActualizaciones({ token, repo, fetchImpl = fetch, ahora = Date.now }) {
  let cache = null;
  const cabeceras = (accept) => ({ Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cosprobell-backend" });

  // Los últimos releases publicados (sin borradores ni versiones de prueba), del más nuevo al más viejo. Se guardan un
  // minuto: una app que actualiza pide varios archivos seguidos.
  async function releases() {
    if (cache && cache.hasta > ahora()) return cache.lista;
    const r = await fetchImpl(`${API}/repos/${repo}/releases?per_page=10`, { headers: cabeceras("application/vnd.github+json") });
    if (!r.ok) throw falla("ACTUALIZACIONES_NO_DISPONIBLES", 502, `GitHub respondió ${r.status} al buscar las versiones`);
    const lista = (await r.json()).filter((x) => !x.draft && !x.prerelease);
    cache = { hasta: ahora() + CACHE_MS, lista };
    return lista;
  }

  // GitHub responde la descarga con una redirección a su almacenamiento: se sigue sin el token, que es solo para GitHub.
  async function descargar(asset) {
    const r = await fetchImpl(`${API}/repos/${repo}/releases/assets/${asset.id}`, { headers: cabeceras("application/octet-stream"), redirect: "manual" });
    const destino = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    const final = destino ? await fetchImpl(destino, { headers: { "User-Agent": "cosprobell-backend" } }) : r;
    if (!final.ok || !final.body) throw falla("ACTUALIZACIONES_NO_DISPONIBLES", 502, `GitHub respondió ${final.status} al descargar ${asset.name}`);
    return final.body;
  }

  return {
    // latest.yml sale del release más nuevo; un instalador o un .blockmap, del release que lo tenga (también versiones
    // anteriores, para la descarga parcial).
    async archivo(nombre) {
      if (!token || !repo) throw falla("ACTUALIZACIONES_SIN_CONFIGURAR", 503, "Las actualizaciones no están configuradas en el servidor");
      if (!NOMBRE.test(nombre)) throw falla("ARCHIVO_INVALIDO", 400, "Archivo inválido");
      const lista = await releases();
      const asset = (nombre === "latest.yml" ? lista.slice(0, 1) : lista).flatMap((x) => x.assets ?? []).find((a) => a.name === nombre);
      if (!asset) throw falla("ARCHIVO_NO_ENCONTRADO", 404, "Archivo no encontrado");
      return { cuerpo: await descargar(asset), tamano: asset.size ?? null,
        tipo: nombre.endsWith(".yml") ? "text/yaml; charset=utf-8" : "application/octet-stream" };
    },
  };
}
