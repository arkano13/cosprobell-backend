import { solicitar, leerJson, ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
import { crearTransporteSap } from "./sap-tls.js";
export function crearClienteSap(config, fetchImpl = fetch) {
  if (config.huellaSap) fetchImpl = crearTransporteSap(config.sapUrl, config.huellaSap);
  let cookie = null;
  async function login() {
    await config.control?.antesDeConsultar();
    const respuesta = await solicitar(`${config.sapUrl}/Login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CompanyDB: config.empresa, UserName: config.usuario, Password: config.password }),
    }, fetchImpl);
    const cookies = respuesta.headers.getSetCookie().map((v) => v.split(";", 1)[0])
      .filter((v) => /^(B1SESSION|ROUTEID)=/.test(v));
    await respuesta.body?.cancel();
    if (!cookies.some((v) => /^B1SESSION=.+/.test(v))) throw new ErrorPuente("SESION_SAP_INVALIDA");
    cookie = cookies.join("; ");
  }
  // GET con la sesión vigente; ante 401 renueva la sesión una sola vez.
  async function obtener(ruta, cabeceras = {}) {
    if (!cookie) await login();
    for (let intento = 0; ; intento++) {
      try {
        await config.control?.antesDeConsultar();
        return await leerJson(await solicitar(`${config.sapUrl}/${ruta}`, { headers: { Cookie: cookie, ...cabeceras } }, fetchImpl));
      } catch (error) {
        if (error.code !== "HTTP_401" || intento === 1) throw error;
        cookie = null; await login();
      }
    }
  }
  return {
    async pagina(cursor, entidad = PRODUCTOS) {
      // Misma forma que acepta Service Layer desde el navegador: "$" literal y espacios como %20.
      // URLSearchParams enviaría %24select y "+", que no están confirmados con el SAP real.
      if (cursor !== null && (entidad.claveNumerica
        ? !Number.isInteger(cursor) || cursor < 0 || cursor > 2147483647
        : typeof cursor !== "string")) throw new ErrorPuente("CURSOR_INVALIDO");
      const literal = cursor === null ? null : entidad.claveNumerica ? cursor : `'${cursor.replaceAll("'", "''")}'`;
      const condiciones = [entidad.filtro, cursor === null ? null : `${entidad.claveSap} gt ${literal}`].filter(Boolean);
      const tamano = entidad.tamanoPagina ?? 50;
      const filtro = condiciones.length ? `&$filter=${encodeURIComponent(condiciones.join(" and "))}` : "";
      const consulta = `$select=${entidad.campos.join(",")}&$orderby=${encodeURIComponent(`${entidad.claveSap} asc`)}&$top=${tamano}${filtro}`;
      // Sin Prefer, Service Layer devuelve 20 por página aunque $top pida 50.
      const datos = await obtener(`${entidad.recurso}?${consulta}`, { Prefer: `odata.maxpagesize=${tamano}` });
      if (!Array.isArray(datos.value) || datos.value.length > tamano) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
      if (!datos.value.length && (datos["odata.nextLink"] || datos["@odata.nextLink"])) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
      return datos.value;
    },
    // Un registro por su clave, con los mismos campos que el recorrido. Lo usa la revisión de pedidos cerrados.
    async documento(clave, entidad) {
      if (entidad.claveNumerica ? !Number.isInteger(clave) || clave < 0 || clave > 2147483647 : typeof clave !== "string") {
        throw new ErrorPuente("CURSOR_INVALIDO");
      }
      const literal = entidad.claveNumerica ? clave : `'${encodeURIComponent(clave.replaceAll("'", "''"))}'`;
      try {
        const datos = await obtener(`${entidad.recurso}(${literal})?$select=${entidad.campos.join(",")}`);
        if (!datos || typeof datos !== "object" || Array.isArray(datos)) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
        return datos;
      } catch (error) {
        if (error.code === "HTTP_404") throw new ErrorPuente("REGISTRO_NO_ENCONTRADO_EN_SAP", false, { [entidad.claveLocal]: clave });
        throw error;
      }
    },
    async cerrar() {
      if (!cookie) return;
      const anterior = cookie; cookie = null;
      const respuesta = await solicitar(`${config.sapUrl}/Logout`, { method: "POST", headers: { Cookie: anterior } }, fetchImpl);
      await respuesta.body?.cancel();
    },
  };
}
