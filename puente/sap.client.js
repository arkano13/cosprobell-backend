import { solicitar, leerJson, ErrorPuente } from "./http.js";
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
    async pagina(cursor) {
      const parametros = new URLSearchParams({
        "$select": "ItemCode,ItemName,BarCode,Valid,Frozen", "$orderby": "ItemCode asc", "$top": "50",
      });
      if (cursor !== null) parametros.set("$filter", `ItemCode gt '${cursor.replaceAll("'", "''")}'`);
      if (!cookie) await login();
      for (let intento = 0; intento < 2; intento++) {
        try {
          const respuesta = await solicitar(`${config.sapUrl}/Items?${parametros}`, { headers: { Cookie: cookie } }, fetchImpl);
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
