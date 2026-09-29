import { crearApi } from "./api.js";
import { crearColaLecturas } from "./lecturas.js";
import { icono } from "./iconos.js";

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
  delete vista.dataset.ancho;
  // Las partes condicionales (a && h(...)) pueden venir como false o null: no se muestran.
  vista.replaceChildren(...nodos.flat().filter((nodo) => nodo instanceof Node));
  window.scrollTo(0, 0);
}
// Vistas con varias columnas en PC (lista de pedidos y escaneo).
function mostrarAmplio(...nodos) {
  mostrar(...nodos);
  vista.dataset.ancho = "amplio";
}
function escuchar(objetivo, evento, funcion) {
  objetivo.addEventListener(evento, funcion);
  limpiezas.push(() => objetivo.removeEventListener(evento, funcion));
}
const cargando = (texto) => h("p", { class: "cargando" }, texto);
const tituloPedido = (docNum) => h("h1", {}, h("span", { class: "rotulo" }, "Pedido"), " ", String(docNum));
const boton = (clase, nombreIcono, texto, atributos = {}) =>
  h("button", { class: `boton ${clase}`.trim(), type: "button", ...atributos }, nombreIcono && icono(nombreIcono), texto);

// Aviso con ícono: el color nunca es la única señal.
const ICONO_AVISO = { error: "rechazada", alerta: "alerta", ok: "aceptada" };
function aviso(tipo, texto, atributos = {}, ...extra) {
  const { class: clase = "", ...resto } = atributos;
  return h("div", { class: `aviso aviso--${tipo} ${clase}`.trim(), ...resto },
    icono(ICONO_AVISO[tipo]), h("span", { class: "aviso__texto" }, texto), ...extra);
}
const textoAviso = (elemento, texto) => { elemento.querySelector(".aviso__texto").textContent = texto; };

function guardarSesion(sesion) {
  estado.sesion = sesion;
  if (sesion) guardado.escribir("sesion", sesion); else guardado.borrar("sesion");
}

function actualizarBarra() {
  const operador = document.getElementById("operador");
  operador.hidden = !estado.operador;
  operador.replaceChildren(...(estado.operador ? [icono("operador"), h("span", {}, `Operador: ${estado.operador}`)] : []));
}

// Error al cargar una vista: la clave inválida lleva a configurar el equipo; el resto ofrece reintentar.
function mostrarError(error, reintentar) {
  if (error?.status === 401) return vistaConfiguracion("La clave de este equipo no es válida o fue desactivada.");
  return mostrar(h("div", { class: "tarjeta" },
    aviso("error", error?.mensaje ?? "Ocurrió un error inesperado", { role: "alert" }),
    h("div", { class: "fila" },
      boton("boton--principal", "actualizar", "Reintentar", { onclick: reintentar }),
      boton("", "volver", "Volver a pedidos", { onclick: () => vistaPedidos() }))));
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
  const error = aviso("error", mensaje, { role: "alert", hidden: !mensaje });
  const guardar = h("button", { class: "boton boton--principal boton--ancho boton--grande", type: "submit" }, "Guardar y continuar");
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
      textoAviso(error, e.status === 401 ? "La clave no es válida o está desactivada." : e.mensaje);
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

  const buscador = h("input", { class: "buscador__campo", type: "search", placeholder: "Buscar por número o cliente", "aria-label": "Buscar pedido" });
  const lista = h("ul", { class: "pedidos" });
  const masBoton = boton("boton--ancho", null, "Cargar más pedidos");
  const vacio = h("p", { class: "suave vacio" });
  const contador = h("span", { class: "contador" });

  function pintar() {
    const filtro = buscador.value.trim().toLowerCase();
    const visibles = pedidos.filter((p) => !filtro || String(p.docNum).includes(filtro) || (p.cliente?.cardName ?? "").toLowerCase().includes(filtro));
    lista.replaceChildren(...visibles.map((p) => h("li", {},
      h("button", { class: "pedido", type: "button", onclick: () => vistaPedido(p.docEntry) },
        h("div", { class: "pedido__numero" }, h("span", { class: "rotulo" }, "Pedido"), " ", String(p.docNum)),
        icono("siguiente", "icono pedido__flecha"),
        h("div", { class: "pedido__corte", "aria-hidden": "true" }),
        h("div", { class: "pedido__cliente" }, p.cliente?.cardName ?? p.cardCode),
        h("div", { class: "pedido__meta" }, `Fecha ${fecha(p.docDate)} · Entrega ${fecha(p.docDueDate)}`),
        h("div", { class: "pedido__meta" }, `Datos de SAP ${hace(p.sincronizadoEn)}`),
        h("span", { class: "pedido__barras", "aria-hidden": "true" })))));
    contador.textContent = `${pedidos.length}${cursor === null ? "" : "+"}`;
    contador.setAttribute("aria-label", `${contador.textContent} pedidos cargados`);
    vacio.textContent = pedidos.length ? (visibles.length ? "" : "Ningún pedido coincide con la búsqueda.") : "No hay pedidos abiertos.";
    vacio.hidden = !vacio.textContent;
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

  const abierta = estado.sesion && aviso("alerta", `Tenés una preparación abierta: pedido ${estado.sesion.docNum ?? estado.sesion.docEntry}.`, {},
    boton("boton--principal", "escaner", "Continuar", { onclick: () => vistaEscaneo() }));

  mostrarAmplio(
    h("div", { class: "encabezado" }, h("div", { class: "encabezado__titulo" }, h("h1", {}, "Pedidos abiertos"), contador),
      boton("", "actualizar", "Actualizar", { onclick: () => vistaPedidos() })),
    abierta, h("label", { class: "buscador" }, icono("buscar"), buscador), vacio, lista, masBoton);
  pintar();
}

// ---------------------------------------------------------------------------
// Detalle del pedido e inicio de la preparación
// ---------------------------------------------------------------------------

// Hasta esta cantidad se dibuja una casilla por unidad; con más, basta el número.
const MAXIMO_CASILLAS = 24;

function tarjetaLinea(linea, nombre, { pedida, escaneada = null, reciente = false }) {
  const completa = escaneada !== null && escaneada >= pedida;
  const casillas = escaneada !== null && pedida <= MAXIMO_CASILLAS &&
    h("div", { class: "unidades", "aria-hidden": "true" },
      Array.from({ length: pedida }, (_, i) => h("span", { class: i < escaneada ? "lleno" : null })));
  return h("li", { class: `linea${completa ? " linea--completa" : ""}${reciente ? " linea--reciente" : ""}`, "data-linea": linea },
    h("div", { class: "linea__nombre" }, nombre.itemName ?? nombre.itemCode),
    h("div", { class: "linea__detalle" }, h("span", { class: "codigo" }, nombre.itemCode),
      [nombre.uomCode && `Unidad ${nombre.uomCode}`, nombre.warehouseCode && `Bodega ${nombre.warehouseCode}`].filter(Boolean).join(" · ")),
    h("div", { class: "linea__cantidad" },
      escaneada === null ? cantidad(pedida) : [cantidad(escaneada), h("span", { class: "linea__total" }, ` / ${cantidad(pedida)}`)],
      completa ? h("small", { class: "sello" }, "Listo")
        : h("small", {}, escaneada === null ? "a preparar" : `faltan ${cantidad(pedida - escaneada)}`)),
    casillas);
}

async function vistaPedido(docEntry) {
  mostrar(cargando("Cargando pedido…"));
  let respuesta;
  try { respuesta = await api.pedido(docEntry); } catch (error) { return mostrarError(error, () => vistaPedido(docEntry)); }
  const { data: pedido, preparacion } = respuesta;
  const problema = aviso("error", preparacion.message ?? "", { role: "alert", hidden: preparacion.datosValidos });
  const empezar = boton("boton--principal boton--ancho boton--grande", "escaner", "Empezar preparación", { disabled: !preparacion.datosValidos });
  empezar.addEventListener("click", async () => {
    empezar.disabled = true; problema.hidden = true;
    try {
      const { data: sesion } = await api.iniciar(pedido.docEntry, estado.operador);
      guardarSesion({ pickingId: sesion.id, docEntry: pedido.docEntry, docNum: pedido.docNum });
      vistaEscaneo();
    } catch (error) {
      if (error.status === 401) return mostrarError(error);
      textoAviso(problema, error.mensaje); problema.hidden = false; empezar.disabled = false;
    }
  });
  const lineasPorNumero = new Map(pedido.lineas.map((l) => [l.lineNum, l]));
  const aPreparar = preparacion.datosValidos ? preparacion.lineas : [];
  mostrar(
    boton("boton--volver", "volver", "Pedidos", { onclick: () => vistaPedidos() }),
    h("div", { class: "encabezado" }, tituloPedido(pedido.docNum)),
    h("div", { class: "tarjeta detalle-pedido" }, h("span", { class: "rotulo" }, "Cliente"),
      h("div", { class: "pedido__cliente" }, pedido.cliente?.cardName ?? pedido.cardCode),
      h("div", { class: "pedido__meta" }, `Fecha ${fecha(pedido.docDate)} · Entrega ${fecha(pedido.docDueDate)}`),
      h("div", { class: "pedido__meta" }, `Datos de SAP ${hace(pedido.sincronizadoEn)}`)),
    datosViejos(pedido.sincronizadoEn) && aviso("alerta",
      "Los datos de este pedido tienen más de una hora sin actualizarse desde SAP. Confirmá con el supervisor antes de preparar."),
    problema,
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

  const resultado = h("div", { class: "resultado", role: "status", "aria-live": "assertive" });
  const envio = h("div", { class: "envio" });
  const barra = h("div", { class: "progreso__barra" });
  const progreso = h("div", { class: "progreso", role: "progressbar", "aria-label": "Avance de la preparación",
    "aria-valuemin": "0", "aria-valuemax": "100" }, barra);
  const resumen = h("div", { class: "fila fila--entre resumen" });
  const bloqueo = aviso("error", "", { role: "alert", hidden: true });
  const desconexion = h("div", { class: "aviso aviso--alerta", hidden: true });
  const lista = h("ul", { class: "lineas" });
  const entrada = h("input", { class: "entrada-escaneo", inputmode: "none", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", enterkeyhint: "send", "aria-label": "Código escaneado", placeholder: "Esperando lectura…" });
  const teclado = boton("boton--teclado", "teclado", h("span", { class: "boton__texto" }, "Teclado"), { title: "Mostrar u ocultar el teclado en pantalla" });
  teclado.addEventListener("click", () => {
    entrada.setAttribute("inputmode", entrada.getAttribute("inputmode") === "none" ? "text" : "none");
    entrada.blur(); entrada.focus();
  });

  function pintar() {
    const lineas = [...sesion.lineas].sort((a, b) => a.pedidoLineNum - b.pedidoLineNum);
    const total = lineas.reduce((s, l) => s + l.cantidadPedida, 0);
    const hechas = lineas.reduce((s, l) => s + Math.min(l.cantidadEscaneada, l.cantidadPedida), 0);
    const porcentaje = total ? Math.round((hechas / total) * 100) : 0;
    barra.style.transform = `scaleX(${porcentaje / 100})`;
    progreso.setAttribute("aria-valuenow", String(porcentaje));
    progreso.classList.toggle("progreso--completo", porcentaje === 100);
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
      textoAviso(bloqueo, "SAP modificó este pedido mientras se preparaba. No se puede seguir escaneando: avisá al supervisor.");
    } else if (!activa) {
      textoAviso(bloqueo, `La preparación está en estado "${sesion.estado}".`);
    }
  }

  // Cada lectura cambia el recuadro con un destello breve: dos rechazos iguales seguidos también se notan.
  const movimientoReducido = matchMedia("(prefers-reduced-motion: reduce)");
  function mostrarResultado(tipo, titulo, detalle = "") {
    resultado.className = `resultado resultado--${tipo ?? "espera"}`;
    resultado.replaceChildren(tipo ? icono(tipo === "ok" ? "aceptada" : "rechazada") : h("span", { class: "resultado__laser" }, icono("escaner")),
      h("div", { class: "resultado__texto" }, h("span", { class: "resultado__titulo" }, titulo), detalle && h("small", {}, detalle)));
    if (tipo) {
      resultado.animate?.(movimientoReducido.matches
        ? [{ opacity: 0.6 }, { opacity: 1 }]
        : [{ opacity: 0.6, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
    }
  }
  mostrarResultado(null, "Escaneá el primer producto.");

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
        mostrarResultado("ok", nombreDe(linea),
          `${cantidad(linea.cantidadEscaneada)} de ${cantidad(linea.cantidadPedida)}${linea.cantidadEscaneada >= linea.cantidadPedida ? " · línea completa" : ""}`);
        sonar("ok");
      }
      if (tipo === "rechazada") {
        mostrarResultado("error", evento.error.mensaje, `Código ${lectura.codigo}`);
        sonar("error");
        refrescarSesion();
      }
      if (tipo === "detenida") {
        if (evento.error?.status === 401) return mostrarError(evento.error);
        desconexion.hidden = false;
        desconexion.replaceChildren(icono("sinRed"),
          h("span", { class: "aviso__texto" }, `Sin conexión. ${enCola} ${enCola === 1 ? "lectura pendiente" : "lecturas pendientes"}: se enviarán al reconectar, sin contarse dos veces.`),
          boton("", "actualizar", "Reintentar ahora", { onclick: () => cola.reanudar() }));
        sonar("error");
      }
  }

  const formulario = h("form", { class: "fila formulario-escaneo", onsubmit: (evento) => {
    evento.preventDefault();
    const codigo = entrada.value.trim();
    entrada.value = "";
    if (codigo) cola.agregar(codigo);
  } }, h("div", { class: "crecer campo-escaneo" }, icono("escaner"), entrada), teclado);
  const cabezaLector = h("div", { class: "escaneo__cabeza" }, h("span", { class: "rotulo" }, "Lector"),
    h("span", { class: "escaneo__estado escaneo__estado--listo" }, "Listo para leer"),
    h("span", { class: "escaneo__estado escaneo__estado--sin-foco" }, "Tocá el campo para leer"));

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
      dialogo.replaceChildren(h("div", { class: "dialogo__cuerpo" }, aviso("error", error.mensaje)),
        h("div", { class: "dialogo__acciones" }, boton("", null, "Cerrar", { onclick: () => dialogo.close() })));
      return;
    }
    dialogo.replaceChildren(
      h("div", { class: "dialogo__cuerpo" }, h("h2", {}, `Lecturas (${lecturas.length})`),
        lecturas.length === 0 ? h("p", { class: "suave" }, "Todavía no hay lecturas.") :
          h("ul", { class: "historial" }, lecturas.reverse().map((l) => h("li", {},
            l.resultado === "aceptado" ? icono("aceptada", "icono historial__ok") : icono("rechazada", "icono historial__error"),
            h("span", {}, `${l.resultado === "aceptado" ? "Aceptada" : "Rechazada"} · ${new Date(l.creadoEn).toLocaleTimeString("es-HN")} · ${l.codigo}`),
            h("div", { class: "suave" }, l.resultado === "aceptado"
              ? `${l.itemCode ?? ""} · quedó en ${cantidad(l.cantidadDespues)}` : (l.errorMessage ?? "Rechazada")))))),
      h("div", { class: "dialogo__acciones" }, boton("", null, "Cerrar", { onclick: () => dialogo.close() })));
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
      mostrarResultado("error", error.mensaje);
      refrescarSesion();
    }
  }

  mostrarAmplio(
    h("div", { class: "encabezado" }, h("div", {},
      tituloPedido(pedido.docNum),
      h("div", { class: "encabezado__sub" }, pedido.cliente?.cardName ?? pedido.cardCode))),
    datosViejos(pedido.sincronizadoEn) && aviso("alerta",
      `Datos de SAP ${hace(pedido.sincronizadoEn)}. Confirmá con el supervisor si el pedido sigue igual.`),
    bloqueo, desconexion,
    h("div", { class: "escaneo-layout" },
      h("section", { class: "escaneo", "aria-label": "Lectura de códigos" }, cabezaLector, formulario, resultado, envio, progreso, resumen),
      h("section", { "aria-label": "Líneas del pedido" },
        lista,
        h("div", { class: "acciones" },
          boton("", "lista", "Ver lecturas", { onclick: verLecturas }),
          boton("boton--principal", "finalizar", "Finalizar", { onclick: finalizar }),
          boton("", "salir", "Salir", { onclick: () => vistaPedidos() })))));
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
  const completo = sesion.estado === "completo";
  mostrar(
    h("div", { class: "encabezado" }, tituloPedido(pedido.docNum)),
    h("div", { class: `tarjeta cierre ${completo ? "cierre--completo" : "cierre--diferencias"}` },
      h("div", { class: "sello", "aria-hidden": "true" }, completo ? "Completo" : "Con faltantes"),
      h("p", {}, completo ? "Preparación completa." : "Preparación finalizada con diferencias.")),
    faltantes.length > 0 && h("div", { class: "tarjeta" }, h("h2", {}, "Faltantes"),
      h("ul", { class: "lineas" }, faltantes.map((l) => tarjetaLinea(l.pedidoLineNum,
        { ...lineasPedido.get(l.pedidoLineNum), itemCode: l.itemCode, uomCode: l.uomCode },
        { pedida: l.cantidadPedida, escaneada: l.cantidadEscaneada })))),
    boton("boton--principal boton--ancho boton--grande", "volver", "Volver a pedidos", { onclick: () => vistaPedidos() }));
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

for (const lugar of document.querySelectorAll("[data-icono]")) lugar.replaceWith(icono(lugar.dataset.icono));
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
