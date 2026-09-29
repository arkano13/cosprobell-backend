import { solicitar, leerJson, ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
export function crearClienteSap(config, fetchImpl = fetch) {
  let cookie = null;
  async function login() {
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
  return {
    async pagina(cursor, entidad = PRODUCTOS) {
      // Misma forma que acepta Service Layer desde el navegador: "$" literal y espacios como %20.
      // URLSearchParams enviaría %24select y "+", que no están confirmados con el SAP real.
      const condiciones = [entidad.filtro, cursor === null ? null : `${entidad.claveSap} gt '${cursor.replaceAll("'", "''")}'`].filter(Boolean);
      const filtro = condiciones.length ? `&$filter=${encodeURIComponent(condiciones.join(" and "))}` : "";
      const consulta = `$select=${entidad.campos.join(",")}&$orderby=${encodeURIComponent(`${entidad.claveSap} asc`)}&$top=50${filtro}`;
      if (!cookie) await login();
      for (let intento = 0; intento < 2; intento++) {
        try {
          // Sin Prefer, Service Layer devuelve 20 por página aunque $top pida 50.
          const respuesta = await solicitar(`${config.sapUrl}/${entidad.recurso}?${consulta}`,
            { headers: { Cookie: cookie, Prefer: "odata.maxpagesize=50" } }, fetchImpl);
          const datos = await leerJson(respuesta);
          if (!Array.isArray(datos.value) || datos.value.length > 50) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
          return datos.value;
        } catch (error) {
          if (error.code !== "HTTP_401" || intento === 1) throw error;
          cookie = null; await login();
        }
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
