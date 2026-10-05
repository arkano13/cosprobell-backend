import { solicitar, leerJson, ErrorPuente } from "./http.js";
import { PRODUCTOS } from "./entidades.js";
import { crearTransporteSap } from "./sap-tls.js";
import { consultaParaConfig, validarConsultaExistencias, convertirExistenciaAlmacenes } from "./existencias.sql.js";
export function crearClienteSap(config, fetchImpl = fetch) {
  const { consulta, codigos } = consultaParaConfig(config);
  if (config.huellaSap) fetchImpl = crearTransporteSap(config.sapUrl, config.huellaSap);
  let cookie = null;
  let almacenesSqlVerificados = false;
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
    // Solo instalación manual explícita. La ejecución normal nunca crea consultas.
    async prepararConsultaExistencias(crear = false) {
      const ruta = `SQLQueries('${consulta.SqlCode}')`;
      try {
        const existente = await obtener(ruta);
        validarConsultaExistencias(existente.SqlText, consulta);
        return "existente";
      } catch (error) {
        if (error.code !== "HTTP_404" || !crear) throw error;
      }
      await config.control?.antesDeConsultar();
      const respuesta = await solicitar(`${config.sapUrl}/SQLQueries`, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(consulta),
      }, fetchImpl);
      await respuesta.body?.cancel();
      validarConsultaExistencias((await obtener(ruta)).SqlText, consulta);
      return "creada";
    },
    async pagina(cursor, entidad = PRODUCTOS) {
      // Misma forma que acepta Service Layer desde el navegador: "$" literal y espacios como %20.
      // URLSearchParams enviaría %24select y "+", que no están confirmados con el SAP real.
      if (cursor !== null && (entidad.claveNumerica
        ? !Number.isInteger(cursor) || cursor < 0 || cursor > 2147483647
        : typeof cursor !== "string")) throw new ErrorPuente("CURSOR_INVALIDO");
      if (entidad.consultaExistenciasSql) {
        if (!almacenesSqlVerificados) {
          for (const codigo of codigos) {
            const wh = await obtener(`Warehouses('${codigo}')?$select=WarehouseCode`);
            if (wh?.WarehouseCode !== codigo) throw new ErrorPuente("ALMACEN_SAP_INVALIDO", false, { solicitado: codigo, recibido: wh?.WarehouseCode });
          }
          almacenesSqlVerificados = true;
        }
        const tamano = entidad.tamanoPagina ?? 20;
        const parametro = encodeURIComponent(`'${(cursor ?? "").replaceAll("'", "''")}'`).replaceAll("'", "%27");
        const datos = await obtener(`SQLQueries('${consulta.SqlCode}')/List?after=${parametro}`,
          { Prefer: `odata.maxpagesize=${tamano}` });
        validarConsultaExistencias(datos.SqlText, consulta);
        if (!Array.isArray(datos.value) || datos.value.length > tamano ||
          (!datos.value.length && (datos["odata.nextLink"] || datos["@odata.nextLink"]))) throw new ErrorPuente("PAGINA_SAP_INVALIDA");
        const filas = datos.value.map(f => convertirExistenciaAlmacenes(f, codigos));
        if (new Set(filas.map(f => f.ItemCode)).size !== filas.length || filas.some(f => f.ItemCode === cursor)) {
          throw new ErrorPuente("PAGINACION_SIN_AVANCE");
        }
        // Nueva consulta parametrizada por clave; no seguir nextLink ni offsets externos.
        return filas;
      }
      const literal = cursor === null ? null : entidad.claveNumerica ? cursor : `'${cursor.replaceAll("'", "''")}'`;
      const condiciones = [entidad.filtro, cursor === null ? null : `${entidad.claveSap} gt ${literal}`].filter(Boolean);
      const tamano = entidad.tamanoPagina ?? 50;
      const filtro = condiciones.length ? `&$filter=${encodeURIComponent(condiciones.join(" and "))}` : "";
      const parametros = `$select=${entidad.campos.join(",")}&$orderby=${encodeURIComponent(`${entidad.claveSap} asc`)}&$top=${tamano}${filtro}`;
      // Sin Prefer, Service Layer devuelve 20 por página aunque $top pida 50.
      const datos = await obtener(`${entidad.recurso}?${parametros}`, { Prefer: `odata.maxpagesize=${tamano}` });
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
