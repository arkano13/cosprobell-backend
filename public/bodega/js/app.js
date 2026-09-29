import { crearApi } from "./api.js";
import { crearColaLecturas } from "./lecturas.js";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Datos del equipo guardados en el navegador. Si el almacenamiento no está disponible, la pantalla sigue
// funcionando, pero hay que volver a configurar el equipo al recargar.
const guardado = {
  leer(clave) { try { return JSON.parse(localStorage.getItem(`bodega.${clave}`)); } catch { return null; } },
  escribir(clave, valor) { try { localStorage.setItem(`bodega.${clave}`, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } },
  borrar(clave) { try { localStorage.removeItem(`bodega.${clave}`); } catch { /* sin almacenamiento */ } },
};

// Crea elementos con texto seguro: los datos de SAP nunca se insertan como HTML.
function h(etiqueta, atributos = {}, ...hijos) {
  const elemento = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === false || valor === null || valor === undefined) continue;
    if (nombre.startsWith("on")) elemento.addEventListener(nombre.slice(2), valor);
    else if (nombre === "class") elemento.className = valor;
    else if (valor === true) elemento.setAttribute(nombre, "");
    else elemento.setAttribute(nombre, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo !== null && hijo !== undefined && hijo !== false) elemento.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return elemento;
}

function hace(fechaIso) {
  const minutos = Math.round((Date.now() - Date.parse(fechaIso)) / 60000);
  if (!Number.isFinite(minutos)) return "fecha desconocida";
  if (minutos < 1) return "hace menos de 1 minuto";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.floor(horas / 24)} d`;
}
// Las fechas de SAP son de calendario (sin hora): se muestran en UTC para no correrse un día.
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString("es-HN", { timeZone: "UTC" }) : "—");
const pendientesTexto = (n) => (n === 0 ? "Todas las líneas completas" : n === 1 ? "1 línea pendiente" : `${n} líneas pendientes`);
const cantidad = (valor) => (Number.isFinite(Number(valor)) ? Number(valor).toLocaleString("es-HN") : "—");
// Aviso (no bloqueo) cuando los datos del pedido tienen más de una hora: la regla definitiva está pendiente.
const MINUTOS_DATOS_VIEJOS = 60;
const datosViejos = (iso) => Date.now() - Date.parse(iso) > MINUTOS_DATOS_VIEJOS * 60000;

let audio = null;
function sonar(tipo) {
  try {
    audio ??= new AudioContext();
    const tonos = tipo === "ok" ? [[880, 0.12]] : [[260, 0.18], [180, 0.28]];
    let inicio = audio.currentTime;
    for (const [frecuencia, duracion] of tonos) {
      const oscilador = audio.createOscillator();
      const volumen = audio.createGain();
      oscilador.frequency.value = frecuencia;
      volumen.gain.value = 0.15;
      oscilador.connect(volumen).connect(audio.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + duracion);
      inicio += duracion + 0.05;
    }
  } catch { /* equipo sin sonido */ }
  if (tipo !== "ok") navigator.vibrate?.(300);
}

// ---------------------------------------------------------------------------
// Estado de la pantalla
// ---------------------------------------------------------------------------

const estado = {
  clave: guardado.leer("clave"),
  operador: guardado.leer("operador") ?? "",
  sesion: guardado.leer("sesion"), // { pickingId, docEntry, docNum }
};
let api = estado.clave ? crearApi({ clave: estado.clave }) : null;
let limpiezas = [];
// Una sola cola de lecturas por preparación, aunque se salga y se vuelva a entrar a la pantalla de escaneo:
// así las lecturas pendientes no se envían desde dos colas a la vez.
let lecturas = null; // { pickingId, cola, alCambiar }
function colaDe(pickingId) {
  if (lecturas?.pickingId !== pickingId) {
    const registro = { pickingId, alCambiar: () => {} };
    registro.cola = crearColaLecturas({
      enviar: (lectura) => api.escanear(pickingId, lectura.codigo, lectura.operacionId),
      guardar: (pendientes) => guardado.escribir(`cola.${pickingId}`, pendientes),
      pendientes: guardado.leer(`cola.${pickingId}`) ?? [],
      alCambiar: (evento) => registro.alCambiar(evento),
    });
    lecturas = registro;
  }
  return lecturas;
}

const vista = document.getElementById("vista");
const dialogo = document.getElementById("dialogo");

// Cambia de vista y retira los escuchadores de la anterior.
function mostrar(...nodos) {
  for (const limpiar of limpiezas) limpiar();
  limpiezas = [];
  // Las partes condicionales (a && h(...)) pueden venir como false o null: no se muestran.
  vista.replaceChildren(...nodos.flat().filter((nodo) => nodo instanceof Node));
  window.scrollTo(0, 0);
}
function escuchar(objetivo, evento, funcion) {
  objetivo.addEventListener(evento, funcion);
  limpiezas.push(() => objetivo.removeEventListener(evento, funcion));
}
const cargando = (texto) => h("p", { class: "cargando" }, texto);

function guardarSesion(sesion) {
  estado.sesion = sesion;
  if (sesion) guardado.escribir("sesion", sesion); else guardado.borrar("sesion");
}

function actualizarBarra() {
  document.getElementById("operador").textContent = estado.operador ? `Operador: ${estado.operador}` : "";
}

// Error al cargar una vista: la clave inválida lleva a configurar el equipo; el resto ofrece reintentar.
function mostrarError(error, reintentar) {
  if (error?.status === 401) return vistaConfiguracion("La clave de este equipo no es válida o fue desactivada.");
  return mostrar(h("div", { class: "tarjeta" },
    h("p", { class: "aviso aviso--error", role: "alert" }, error?.mensaje ?? "Ocurrió un error inesperado"),
    h("div", { class: "fila" },
      h("button", { class: "boton boton--principal", type: "button", onclick: reintentar }, "Reintentar"),
      h("button", { class: "boton", type: "button", onclick: () => vistaPedidos() }, "Volver a pedidos"))));
}

// Diálogo de confirmación: resuelve true o false.
function confirmar({ titulo, texto, aceptar = "Aceptar", peligro = false }) {
  return new Promise((resolver) => {
    const cerrar = (valor) => { dialogo.close(); resolver(valor); };
    dialogo.replaceChildren(
      h("div", { class: "dialogo__cuerpo" }, h("h2", {}, titulo), ...[].concat(texto).map((t) => h("p", {}, t))),
      h("div", { class: "dialogo__acciones" },
        h("button", { class: "boton", type: "button", onclick: () => cerrar(false) }, "Cancelar"),
        h("button", { class: `boton ${peligro ? "boton--peligro" : "boton--principal"}`, type: "button", onclick: () => cerrar(true) }, aceptar)));
    dialogo.onclose = () => resolver(false);
    dialogo.showModal();
  });
}

// ---------------------------------------------------------------------------
// Configuración del equipo
// ---------------------------------------------------------------------------

function vistaConfiguracion(mensaje = "") {
  const clave = h("input", { id: "cfg-clave", type: "password", autocomplete: "off", required: true });
  const operador = h("input", { id: "cfg-operador", type: "text", autocomplete: "name", maxlength: "60" });
  operador.value = estado.operador;
  const error = h("p", { class: "aviso aviso--error", role: "alert", hidden: !mensaje }, mensaje);
  const guardar = h("button", { class: "boton boton--principal boton--ancho", type: "submit" }, "Guardar y continuar");
  const formulario = h("form", { class: "tarjeta formulario", onsubmit: async (evento) => {
    evento.preventDefault();
    guardar.disabled = true; error.hidden = true;
    const prueba = crearApi({ clave: clave.value.trim() });
    try {
      await prueba.pedidos();
      estado.clave = clave.value.trim(); estado.operador = operador.value.trim();
      guardado.escribir("clave", estado.clave); guardado.escribir("operador", estado.operador);
      api = prueba;
      actualizarBarra();
      vistaPedidos();
    } catch (e) {
      error.textContent = e.status === 401 ? "La clave no es válida o está desactivada." : e.mensaje;
      error.hidden = false; guardar.disabled = false;
    }
  } },
  h("h1", {}, "Configurar este equipo"),
  h("p", { class: "suave" }, "La clave la entrega el supervisor y queda guardada solo en este equipo."),
  error,
  h("label", { for: "cfg-clave" }, "Clave del equipo"), clave,
  h("label", { for: "cfg-operador" }, "Nombre de quien escanea"), operador,
  guardar);
  mostrar(formulario);
  clave.focus();
}

// ---------------------------------------------------------------------------
// Lista de pedidos abiertos
// ---------------------------------------------------------------------------

async function vistaPedidos() {
  mostrar(cargando("Cargando pedidos abiertos…"));
  const pedidos = [];
  let cursor = null;
  try {
    const respuesta = await api.pedidos();
    pedidos.push(...respuesta.data); cursor = respuesta.siguienteCursor;
  } catch (error) { return mostrarError(error, vistaPedidos); }

  const buscador = h("input", { class: "buscador", type: "search", placeholder: "Buscar por número o cliente", "aria-label": "Buscar pedido" });
  const lista = h("ul", { class: "pedidos" });
  const masBoton = h("button", { class: "boton boton--ancho", type: "button" }, "Cargar más pedidos");
  const vacio = h("p", { class: "suave" });

  function pintar() {
    const filtro = buscador.value.trim().toLowerCase();
    const visibles = pedidos.filter((p) => !filtro || String(p.docNum).includes(filtro) || (p.cliente?.cardName ?? "").toLowerCase().includes(filtro));
    lista.replaceChildren(...visibles.map((p) => h("li", {},
      h("button", { class: "pedido", type: "button", onclick: () => vistaPedido(p.docEntry) },
        h("div", { class: "pedido__numero" }, `Pedido ${p.docNum}`),
        h("div", { class: "pedido__cliente" }, p.cliente?.cardName ?? p.cardCode),
        h("div", { class: "pedido__meta" }, `Fecha ${fecha(p.docDate)} · Entrega ${fecha(p.docDueDate)}`),
        h("div", { class: "pedido__meta" }, `Datos de SAP ${hace(p.sincronizadoEn)}`)))));
    vacio.textContent = pedidos.length ? (visibles.length ? "" : "Ningún pedido coincide con la búsqueda.") : "No hay pedidos abiertos.";
    masBoton.hidden = cursor === null;
  }
  buscador.addEventListener("input", pintar);
  masBoton.addEventListener("click", async () => {
    masBoton.disabled = true;
    try {
      const respuesta = await api.pedidos(cursor);
      pedidos.push(...respuesta.data); cursor = respuesta.siguienteCursor;
      pintar();
    } catch (error) { if (error.status === 401) return mostrarError(error); }
    masBoton.disabled = false;
  });

  const abierta = estado.sesion && h("div", { class: "aviso aviso--alerta fila fila--entre" },
    h("span", {}, `Tenés una preparación abierta: pedido ${estado.sesion.docNum ?? estado.sesion.docEntry}.`),
    h("button", { class: "boton boton--principal", type: "button", onclick: () => vistaEscaneo() }, "Continuar"));

  mostrar(
    h("div", { class: "fila fila--entre" }, h("h1", {}, "Pedidos abiertos"),
      h("button", { class: "boton", type: "button", onclick: () => vistaPedidos() }, "Actualizar")),
    abierta, buscador, vacio, lista, masBoton);
  pintar();
}

// ---------------------------------------------------------------------------
// Detalle del pedido e inicio de la preparación
// ---------------------------------------------------------------------------

function tarjetaLinea(linea, nombre, { pedida, escaneada = null, reciente = false }) {
  const completa = escaneada !== null && escaneada >= pedida;
  return h("li", { class: `linea${completa ? " linea--completa" : ""}${reciente ? " linea--reciente" : ""}`, "data-linea": linea },
    h("div", { class: "linea__nombre" }, nombre.itemName ?? nombre.itemCode),
    h("div", { class: "linea__detalle" },
      [nombre.itemCode, nombre.uomCode && `Unidad ${nombre.uomCode}`, nombre.warehouseCode && `Bodega ${nombre.warehouseCode}`].filter(Boolean).join(" · ")),
    h("div", { class: "linea__cantidad" },
      escaneada === null ? cantidad(pedida) : `${cantidad(escaneada)} / ${cantidad(pedida)}`,
      h("small", {}, escaneada === null ? "a preparar" : completa ? "completa" : `faltan ${cantidad(pedida - escaneada)}`)));
}

async function vistaPedido(docEntry) {
  mostrar(cargando("Cargando pedido…"));
  let respuesta;
  try { respuesta = await api.pedido(docEntry); } catch (error) { return mostrarError(error, () => vistaPedido(docEntry)); }
  const { data: pedido, preparacion } = respuesta;
  const aviso = h("p", { class: "aviso aviso--error", role: "alert", hidden: preparacion.datosValidos }, preparacion.message ?? "");
  const empezar = h("button", { class: "boton boton--principal boton--ancho", type: "button", disabled: !preparacion.datosValidos }, "Empezar preparación");
  empezar.addEventListener("click", async () => {
    empezar.disabled = true; aviso.hidden = true;
    try {
      const { data: sesion } = await api.iniciar(pedido.docEntry, estado.operador);
      guardarSesion({ pickingId: sesion.id, docEntry: pedido.docEntry, docNum: pedido.docNum });
      vistaEscaneo();
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      aviso.textContent = error.mensaje; aviso.hidden = false; empezar.disabled = false;
    }
  });
  const lineasPorNumero = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  const aPreparar = preparacion.datosValidos ? preparacion.lineas : [];
  mostrar(
    h("button", { class: "boton", type: "button", onclick: () => vistaPedidos() }, "← Pedidos"),
    h("h1", {}, `Pedido ${pedido.docNum}`),
    h("div", { class: "tarjeta" },
      h("div", { class: "pedido__cliente" }, pedido.cliente?.cardName ?? pedido.cardCode),
      h("div", { class: "suave" }, `Fecha ${fecha(pedido.docDate)} · Entrega ${fecha(pedido.docDueDate)}`),
      h("div", { class: "suave" }, `Datos de SAP ${hace(pedido.sincronizadoEn)}`)),
    datosViejos(pedido.sincronizadoEn) && h("p", { class: "aviso aviso--alerta" },
      "Los datos de este pedido tienen más de una hora sin actualizarse desde SAP. Confirmá con el supervisor antes de preparar."),
    aviso,
    aPreparar.length > 0 && h("h2", {}, "A preparar"),
    h("ul", { class: "lineas" }, aPreparar.map((l) =>
      tarjetaLinea(l.pedidoLineNum, { ...lineasPorNumero.get(l.pedidoLineNum), uomCode: l.uomCode }, { pedida: l.cantidadPedida }))),
    empezar);
}

// ---------------------------------------------------------------------------
// Escaneo
// ---------------------------------------------------------------------------

async function vistaEscaneo() {
  const { pickingId, docEntry } = estado.sesion;
  mostrar(cargando("Abriendo preparación…"));
  let pedido, sesion;
  try {
    [pedido, sesion] = await Promise.all([api.pedido(docEntry).then((r) => r.data), api.sesion(pickingId).then((r) => r.data)]);
  } catch (error) {
    if (error.status === 404) { guardarSesion(null); return vistaPedidos(); }
    return mostrarError(error, vistaEscaneo);
  }
  if (sesion.estado === "completo" || sesion.estado === "con_diferencias") {
    guardarSesion(null);
    return vistaResumen(sesion, pedido);
  }
  guardarSesion({ ...estado.sesion, docNum: pedido.docNum });
  const lineasPedido = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  let lineaReciente = null;

  const resultado = h("div", { class: "resultado", role: "status", "aria-live": "assertive" }, "Escaneá el primer producto.");
  const envio = h("div", { class: "envio" });
  const barra = h("div", { class: "progreso__barra" });
  const resumen = h("div", { class: "fila fila--entre" });
  const bloqueo = h("p", { class: "aviso aviso--error", role: "alert", hidden: true });
  const desconexion = h("div", { class: "aviso aviso--alerta fila fila--entre", hidden: true });
  const lista = h("ul", { class: "lineas" });
  const entrada = h("input", { class: "entrada-escaneo", inputmode: "none", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", enterkeyhint: "send", "aria-label": "Código escaneado", placeholder: "Esperando lectura…" });
  const teclado = h("button", { class: "boton", type: "button", title: "Mostrar u ocultar el teclado en pantalla" }, "Teclado");
  teclado.addEventListener("click", () => {
    entrada.setAttribute("inputmode", entrada.getAttribute("inputmode") === "none" ? "text" : "none");
    entrada.blur(); entrada.focus();
  });

  function pintar() {
    const lineas = [...sesion.lineas].sort((a, b) => a.pedidoLineNum - b.pedidoLineNum);
    const total = lineas.reduce((s, l) => s + l.cantidadPedida, 0);
    const hechas = lineas.reduce((s, l) => s + Math.min(l.cantidadEscaneada, l.cantidadPedida), 0);
    barra.style.width = `${total ? Math.round((hechas / total) * 100) : 0}%`;
    resumen.replaceChildren(
      h("strong", {}, `${cantidad(hechas)} de ${cantidad(total)} unidades`),
      h("span", { class: "suave" }, pendientesTexto(lineas.filter((l) => l.cantidadEscaneada < l.cantidadPedida).length)));
    // Primero las pendientes; las completas quedan al final.
    const orden = [...lineas].sort((a, b) => (a.cantidadEscaneada >= a.cantidadPedida) - (b.cantidadEscaneada >= b.cantidadPedida));
    lista.replaceChildren(...orden.map((l) => tarjetaLinea(l.pedidoLineNum,
      { ...lineasPedido.get(l.pedidoLineNum), itemCode: l.itemCode, uomCode: l.uomCode },
      { pedida: l.cantidadPedida, escaneada: l.cantidadEscaneada, reciente: l.id === lineaReciente })));
    const activa = sesion.estado === "en_proceso";
    entrada.disabled = !activa;
    bloqueo.hidden = activa;
    if (sesion.estado === "requiere_revision") {
      bloqueo.textContent = "SAP modificó este pedido mientras se preparaba. No se puede seguir escaneando: avisá al supervisor.";
    } else if (!activa) {
      bloqueo.textContent = `La preparación está en estado "${sesion.estado}".`;
    }
  }

  function mostrarResultado(tipo, titulo, detalle = "") {
    resultado.className = `resultado resultado--${tipo}`;
    resultado.replaceChildren(titulo, detalle ? h("small", {}, detalle) : "");
  }

  async function refrescarSesion() {
    try { sesion = (await api.sesion(pickingId)).data; pintar(); } catch { /* se reintenta en la próxima lectura */ }
  }

  function nombreDe(linea) {
    return lineasPedido.get(linea.pedidoLineNum)?.itemName ?? linea.itemCode;
  }

  const registro = colaDe(pickingId);
  const cola = registro.cola;
  function alCambiar(evento) {
      const { tipo, lectura, enCola } = evento;
      if (tipo === "enviando") envio.textContent = `Enviando ${lectura.codigo}…${enCola > 1 ? ` (${enCola - 1} en espera)` : ""}`;
      if (tipo === "reintentando") envio.textContent = `Sin respuesta; reintento ${evento.intento} de ${lectura.codigo}…`;
      if (tipo === "aceptada" || tipo === "rechazada") envio.textContent = enCola ? `${enCola} lecturas en espera` : "";
      if (tipo === "aceptada") {
        const linea = evento.respuesta.data;
        sesion.lineas = sesion.lineas.map((l) => (l.id === linea.id ? { ...l, ...linea } : l));
        lineaReciente = linea.id;
        desconexion.hidden = true;
        pintar();
        mostrarResultado("ok", `✓ ${nombreDe(linea)}`,
          `${cantidad(linea.cantidadEscaneada)} de ${cantidad(linea.cantidadPedida)}${linea.cantidadEscaneada >= linea.cantidadPedida ? " · línea completa" : ""}`);
        sonar("ok");
      }
      if (tipo === "rechazada") {
        mostrarResultado("error", `✗ ${evento.error.mensaje}`, `Código ${lectura.codigo}`);
        sonar("error");
        refrescarSesion();
      }
      if (tipo === "detenida") {
        if (evento.error?.status === 401) return mostrarError(evento.error);
        desconexion.hidden = false;
        desconexion.replaceChildren(
          h("span", {}, `Sin conexión. ${enCola} ${enCola === 1 ? "lectura pendiente" : "lecturas pendientes"}: se enviarán al reconectar, sin contarse dos veces.`),
          h("button", { class: "boton", type: "button", onclick: () => cola.reanudar() }, "Reintentar ahora"));
        sonar("error");
      }
  }

  const formulario = h("form", { class: "fila", onsubmit: (evento) => {
    evento.preventDefault();
    const codigo = entrada.value.trim();
    entrada.value = "";
    if (codigo) cola.agregar(codigo);
  } }, h("div", { class: "crecer" }, entrada), teclado);

  // El lector escribe como un teclado: la entrada debe tener el foco salvo que haya un diálogo abierto.
  const enfocar = () => { if (!dialogo.open && !entrada.disabled && document.activeElement !== entrada) entrada.focus({ preventScroll: true }); };
  // Vuelve enseguida: si el foco queda en un botón, el Enter del lector lo activaría.
  entrada.addEventListener("blur", () => setTimeout(enfocar, 0));

  async function verLecturas() {
    dialogo.replaceChildren(h("div", { class: "dialogo__cuerpo" }, cargando("Cargando lecturas…")));
    dialogo.showModal();
    const lecturas = [];
    try {
      let despuesDe = null;
      do {
        const pagina = await api.escaneos(pickingId, despuesDe);
        lecturas.push(...pagina.data); despuesDe = pagina.siguienteCursor;
      } while (despuesDe !== null);
    } catch (error) {
      dialogo.replaceChildren(h("div", { class: "dialogo__cuerpo" }, h("p", { class: "aviso aviso--error" }, error.mensaje)),
        h("div", { class: "dialogo__acciones" }, h("button", { class: "boton", type: "button", onclick: () => dialogo.close() }, "Cerrar")));
      return;
    }
    dialogo.replaceChildren(
      h("div", { class: "dialogo__cuerpo" }, h("h2", {}, `Lecturas (${lecturas.length})`),
        lecturas.length === 0 ? h("p", { class: "suave" }, "Todavía no hay lecturas.") :
          h("ul", { class: "historial" }, lecturas.reverse().map((l) => h("li", {},
            h("span", { class: l.resultado === "aceptado" ? "historial__ok" : "historial__error" }, l.resultado === "aceptado" ? "✓ " : "✗ "),
            `${new Date(l.creadoEn).toLocaleTimeString("es-HN")} · ${l.codigo}`,
            h("div", { class: "suave" }, l.resultado === "aceptado"
              ? `${l.itemCode ?? ""} · quedó en ${cantidad(l.cantidadDespues)}` : (l.errorMessage ?? "Rechazada")))))),
      h("div", { class: "dialogo__acciones" }, h("button", { class: "boton", type: "button", onclick: () => dialogo.close() }, "Cerrar")));
  }

  async function finalizar() {
    if (cola.pendientes > 0) {
      mostrarResultado("error", "Hay lecturas sin enviar", "Esperá a que se envíen antes de finalizar.");
      return;
    }
    const faltantes = sesion.lineas.filter((l) => l.cantidadEscaneada < l.cantidadPedida);
    const unidades = faltantes.reduce((s, l) => s + (l.cantidadPedida - l.cantidadEscaneada), 0);
    const ok = await confirmar(faltantes.length === 0
      ? { titulo: "Finalizar preparación", texto: "Todas las líneas están completas.", aceptar: "Finalizar" }
      : { titulo: "Finalizar con faltantes", peligro: true, aceptar: "Finalizar con diferencias",
          texto: [`Faltan ${cantidad(unidades)} unidades en ${faltantes.length} ${faltantes.length === 1 ? "línea" : "líneas"}.`,
            ...faltantes.map((l) => `• ${nombreDe(l)}: faltan ${cantidad(l.cantidadPedida - l.cantidadEscaneada)}`)] });
    if (!ok) return enfocar();
    try {
      const { data } = await api.finalizar(pickingId);
      guardarSesion(null);
      guardado.borrar(`cola.${pickingId}`);
      lecturas = null;
      vistaResumen(data, pedido);
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      mostrarResultado("error", `✗ ${error.mensaje}`);
      refrescarSesion();
    }
  }

  mostrar(
    h("div", { class: "fila fila--entre" },
      h("h1", {}, `Pedido ${pedido.docNum}`),
      h("span", { class: "suave" }, pedido.cliente?.cardName ?? pedido.cardCode)),
    datosViejos(pedido.sincronizadoEn) && h("p", { class: "aviso aviso--alerta" },
      `Datos de SAP ${hace(pedido.sincronizadoEn)}. Confirmá con el supervisor si el pedido sigue igual.`),
    bloqueo, desconexion,
    h("div", { class: "escaneo" }, formulario, resultado, envio, h("div", { class: "progreso" }, barra), resumen),
    lista,
    h("div", { class: "acciones" },
      h("button", { class: "boton", type: "button", onclick: verLecturas }, "Ver lecturas"),
      h("button", { class: "boton boton--principal", type: "button", onclick: finalizar }, "Finalizar"),
      h("button", { class: "boton", type: "button", onclick: () => vistaPedidos() }, "Salir")));
  pintar();
  // Escuchadores de esta vista: se retiran al cambiar de vista (mostrar()).
  registro.alCambiar = alCambiar;
  limpiezas.push(() => { registro.alCambiar = () => {}; });
  // Mientras no haya conexión se reintenta solo cada 15 segundos y al volver la red.
  const vigilante = setInterval(() => { if (cola.detenida) cola.reanudar(); }, 15000);
  limpiezas.push(() => clearInterval(vigilante));
  escuchar(window, "online", () => cola.reanudar());
  escuchar(document, "click", (evento) => { if (!evento.target.closest("button, a, input")) enfocar(); });
  enfocar();
  if (cola.pendientes) envio.textContent = `${cola.pendientes} lecturas pendientes de enviar…`;
  cola.reanudar();
}

// ---------------------------------------------------------------------------
// Resumen al finalizar
// ---------------------------------------------------------------------------

function vistaResumen(sesion, pedido) {
  const lineasPedido = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  const faltantes = sesion.lineas.filter((l) => l.cantidadEscaneada < l.cantidadPedida);
  mostrar(
    h("h1", {}, `Pedido ${pedido.docNum}`),
    h("p", { class: `aviso ${sesion.estado === "completo" ? "aviso--ok" : "aviso--alerta"}` },
      sesion.estado === "completo" ? "Preparación completa." : "Preparación finalizada con diferencias."),
    faltantes.length > 0 && h("div", { class: "tarjeta" }, h("h2", {}, "Faltantes"),
      h("ul", { class: "lineas" }, faltantes.map((l) => tarjetaLinea(l.pedidoLineNum,
        { ...lineasPedido.get(l.pedidoLineNum), itemCode: l.itemCode, uomCode: l.uomCode },
        { pedida: l.cantidadPedida, escaneada: l.cantidadEscaneada })))),
    h("button", { class: "boton boton--principal boton--ancho", type: "button", onclick: () => vistaPedidos() }, "Volver a pedidos"));
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

document.getElementById("btn-inicio").addEventListener("click", () => (api ? vistaPedidos() : vistaConfiguracion()));
document.getElementById("btn-menu").addEventListener("click", async () => {
  const cambiar = await confirmar({ titulo: "Configuración del equipo",
    texto: ["Podés cambiar la clave de este equipo o el nombre de quien escanea.",
      estado.sesion ? "La preparación abierta se conserva y se puede continuar después." : ""].filter(Boolean),
    aceptar: "Cambiar configuración" });
  if (cambiar) vistaConfiguracion();
});
const conexion = document.getElementById("estado-conexion");
const pintarConexion = () => { conexion.hidden = navigator.onLine; };
window.addEventListener("online", pintarConexion);
window.addEventListener("offline", pintarConexion);
pintarConexion();
actualizarBarra();

if (!api) vistaConfiguracion();
else if (estado.sesion) vistaEscaneo();
else vistaPedidos();
