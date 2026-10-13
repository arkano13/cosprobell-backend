// Cálculos de los reportes de bodega sin acceso a la base (se prueban en tests/unit/reportes.calculo.test.js). Reciben
// filas de reportes.repository y devuelven lo que muestra la app: tarjetas, tablas y frases destacadas.
import { diasDelRango, diasEntre, diaDeSemana, fechaLocal, horaLocal, semanaIso, lunesDe, sumarDias } from "./reportes.periodo.js";

// Preparaciones abiertas más de esto no cuentan en el tiempo promedio (se dejaron abiertas, no se tardó tanto).
export const HORAS_MAXIMAS_PREPARACION = 4;
// Un producto "alcanza para poco" en la 02 si con lo que hay cubre menos de estos días de salidas.
export const DIAS_REPONER_PRONTO = 3;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Números como los muestra la app (formato de Honduras): 4,312 y 3.1 %.
export const numero = (n) => Math.round(n).toLocaleString("es-HN");
export const porcentaje = (n) => `${(Math.round(n * 10) / 10).toLocaleString("es-HN", { maximumFractionDigits: 1 })} %`;
const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? uno : varios}`;
const nombreDia = (fecha) => `${DIAS[diaDeSemana(fecha)]} ${Number(fecha.slice(8, 10))}`;
const fechaCorta = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
export const rotuloDocumento = (fuente, docNum) => `${fuente === "traslado" ? "Traslado" : fuente === "pedido" ? "Pedido" : "Factura"} ${docNum ?? "—"}`;
const tasa = (parte, total) => (total > 0 ? (parte * 100) / total : 0);
const redondear1 = (n) => Math.round(n * 10) / 10;
const porNombre = (a, b) => (a ?? "").localeCompare(b ?? "", "es");

// Duración de una preparación en segundos, o null si no cuenta para el promedio (sin fin o abierta demasiado tiempo).
export function duracionValida(sesion) {
  if (!sesion.fechaFin || !sesion.fechaInicio) return null;
  const segundos = (new Date(sesion.fechaFin) - new Date(sesion.fechaInicio)) / 1000;
  return segundos >= 0 && segundos <= HORAS_MAXIMAS_PREPARACION * 3600 ? segundos : null;
}

// ---------- 1. Preparaciones ----------
const TERMINADA = new Set(["completo", "con_diferencias"]);

export function armarPreparaciones({ sesiones, sinPreparar, rango, hoy }) {
  const terminadas = sesiones.filter((s) => TERMINADA.has(s.estado));
  const conDif = terminadas.filter((s) => s.estado === "con_diferencias");
  const tiempos = terminadas.map(duracionValida).filter((d) => d !== null);
  const unidades = terminadas.reduce((t, s) => t + s.preparadas, 0);

  const dias = new Map(diasDelRango(rango).map((f) => [f, { fecha: f, completas: 0, conDiferencias: 0 }]));
  for (const s of terminadas) {
    const d = dias.get(fechaLocal(s.fechaFin));
    if (d) d[s.estado === "con_diferencias" ? "conDiferencias" : "completas"] += 1;
  }

  const operadores = new Map();
  for (const s of terminadas) {
    const nombre = s.operador ?? "Sin nombre";
    const o = operadores.get(nombre) ?? { operador: nombre, preparaciones: 0, unidades: 0, conDiferencias: 0, segundos: 0, cronometradas: 0, unidadesCronometradas: 0 };
    o.preparaciones += 1; o.unidades += s.preparadas;
    if (s.estado === "con_diferencias") o.conDiferencias += 1;
    const d = duracionValida(s);
    if (d !== null) { o.segundos += d; o.cronometradas += 1; o.unidadesCronometradas += s.preparadas; }
    operadores.set(nombre, o);
  }
  const porOperador = [...operadores.values()].map((o) => ({ operador: o.operador, preparaciones: o.preparaciones,
    unidades: Math.round(o.unidades), conDiferencias: o.conDiferencias,
    segundosPromedio: o.cronometradas ? Math.round(o.segundos / o.cronometradas) : null,
    ritmo: o.segundos > 0 ? Math.round(o.unidadesCronometradas / (o.segundos / 3600)) : null }))
    .sort((a, b) => b.preparaciones - a.preparaciones || porNombre(a.operador, b.operador));

  const esperando = sinPreparar.map((d) => ({ docEntry: d.docEntry, docNum: d.docNum, fuente: d.fuente, lineas: d.lineas,
    docDate: d.docDate, dias: Math.max(0, diasEntre(d.docDate, hoy)) }));
  const cola = { total: esperando.length, hoy: esperando.filter((d) => d.dias === 0).length,
    unoADos: esperando.filter((d) => d.dias >= 1 && d.dias <= 2).length, tresOMas: esperando.filter((d) => d.dias >= 3).length,
    lista: [...esperando].sort((a, b) => b.dias - a.dias || a.docNum - b.docNum).slice(0, 10) };

  const atencion = sesiones.filter((s) => s.estado !== "completo").map((s) => ({ pickingId: s.id, fuente: s.fuente, docNum: s.docNum,
    almacenDestino: s.almacenDestino, operador: s.operador, estado: s.estado, fecha: s.fechaFin ?? s.fechaInicio,
    preparadas: Math.round(s.preparadas), pedidas: Math.round(s.pedidas) }));

  const destacados = [];
  const masTrabajo = [...dias.values()].map((d) => ({ ...d, total: d.completas + d.conDiferencias })).sort((a, b) => b.total - a.total)[0];
  if (masTrabajo?.total > 0 && dias.size > 1) destacados.push(`El ${nombreDia(masTrabajo.fecha)} fue el día con más trabajo: ${plural(masTrabajo.total, "preparación", "preparaciones")}.`);
  const peor = porOperador.filter((o) => o.conDiferencias > 0).sort((a, b) => b.conDiferencias - a.conDiferencias)[0];
  if (peor && conDif.length === 1) destacados.push(`${peor.operador} tuvo la única preparación con diferencias.`);
  else if (peor) destacados.push(`${peor.operador} tuvo ${numero(peor.conDiferencias)} de las ${numero(conDif.length)} preparaciones con diferencias.`);
  const viejas = esperando.filter((d) => d.dias >= 3).sort((a, b) => b.dias - a.dias);
  if (viejas.length) destacados.push(`Hay ${plural(viejas.length, "documento esperando", "documentos esperando")} hace 3 días o más: el más viejo es ${rotuloDocumento(viejas[0].fuente, viejas[0].docNum).toLowerCase()}.`);
  if (!terminadas.length) destacados.push("No se terminó ninguna preparación en este período.");

  return {
    resumen: { preparaciones: terminadas.length, facturas: terminadas.filter((s) => s.fuente === "factura").length,
      traslados: terminadas.filter((s) => s.fuente === "traslado").length, unidades: Math.round(unidades),
      unidadesPorPreparacion: terminadas.length ? Math.round(unidades / terminadas.length) : 0,
      segundosPromedio: tiempos.length ? Math.round(tiempos.reduce((t, d) => t + d, 0) / tiempos.length) : null,
      conDiferencias: conDif.length, porcentajeConDiferencias: redondear1(tasa(conDif.length, terminadas.length)) },
    destacados, porDia: [...dias.values()], sinPreparar: cola, porOperador, atencion,
  };
}

// ---------- 3. Detalle de una preparación ----------
// codigos: Map itemCode → código de barras; leidos: Map código leído → { itemCode, esCaja }.
export function armarDetalle({ sesion, documento, escaneos, nombres, codigos, leidos, anuladoPor = null }) {
  const nombre = (itemCode) => nombres.get(itemCode) ?? null;
  const lineas = sesion.lineas.map((l) => ({ itemCode: l.itemCode, itemName: nombre(l.itemCode), codigo: l.codigoBarrasEscaneado ?? codigos.get(l.itemCode) ?? null,
    uomCode: l.uomCode, pedida: l.cantidadPedida, preparada: Math.min(l.cantidadEscaneada, l.cantidadPedida),
    falta: Math.max(0, l.cantidadPedida - l.cantidadEscaneada), combo: l.comboItemCode ? { itemCode: l.comboItemCode, itemName: nombre(l.comboItemCode) } : null }));
  const pedidaDe = new Map(sesion.lineas.map((l) => [l.id, l.cantidadPedida]));
  const comboDe = new Map(sesion.lineas.filter((l) => l.comboItemCode).map((l) => [l.id, nombre(l.comboItemCode) ?? l.comboItemCode]));
  const lecturas = escaneos.map((e) => {
    const leido = leidos.get(e.codigo);
    const itemCode = e.itemCode ?? leido?.itemCode ?? null;
    return { id: e.id, hora: e.creadoEn, resultado: e.resultado, codigo: e.codigo, itemCode, itemName: itemCode ? nombre(itemCode) : null,
      motivo: e.resultado === "rechazado" ? motivoRechazo(e.errorCode, leido?.esCaja === true) : null,
      mensaje: e.resultado === "rechazado" ? e.errorMessage : null,
      lleva: e.resultado === "aceptado" ? e.cantidadDespues : null, de: e.lineaId ? pedidaDe.get(e.lineaId) ?? null : null,
      combo: e.lineaId ? comboDe.get(e.lineaId) ?? null : null };
  });
  const pedidas = lineas.reduce((t, l) => t + l.pedida, 0), preparadas = lineas.reduce((t, l) => t + l.preparada, 0);
  const incompletas = lineas.filter((l) => l.falta > 0);
  lineas.sort((a, b) => (b.falta > 0) - (a.falta > 0));
  return {
    pickingId: sesion.id, estado: sesion.estado, operador: sesion.usuarioId, anuladoPor,
    documento: { fuente: documento?.fuenteDocumento ?? null, docNum: documento?.docNum ?? null, almacenDestino: documento?.almacenDestino ?? null },
    inicio: sesion.fechaInicio, fin: sesion.fechaFin,
    segundos: sesion.fechaFin ? Math.round((new Date(sesion.fechaFin) - new Date(sesion.fechaInicio)) / 1000) : null,
    unidades: { preparadas, pedidas }, lineasCompletas: lineas.length - incompletas.length, lineasTotal: lineas.length,
    faltan: { unidades: incompletas.reduce((t, l) => t + l.falta, 0), productos: incompletas.length },
    productos: lineas,
    lecturas: { total: lecturas.length, aceptadas: lecturas.filter((l) => l.resultado === "aceptado").length,
      rechazadas: lecturas.filter((l) => l.resultado === "rechazado").length, lista: lecturas },
  };
}

// ---------- 2. Errores evitados ----------
// Motivo de una lectura rechazada, en las palabras del reporte.
export function motivoRechazo(errorCode, esCaja = false) {
  if (errorCode === "PRODUCTO_FUERA_DEL_PEDIDO") return "equivocado";
  if (errorCode === "CANTIDAD_COMPLETADA") return "deMas";
  if (errorCode === "LINEA_MODIFICADA") return "cambioSap";
  if (errorCode === "ETIQUETA_NO_ENCONTRADA" && esCaja) return "codigoCaja";
  if (["ETIQUETA_NO_ENCONTRADA", "ETIQUETA_SIN_CONFIRMAR", "CONFIRMACION_DESACTUALIZADA", "CODIGO_AMBIGUO", "ASOCIACION_AMBIGUA"].includes(errorCode)) return "noRegistrado";
  return "otro";
}
export const MOTIVOS = [
  { motivo: "equivocado", titulo: "Producto equivocado", detalle: "no iba en el documento" },
  { motivo: "deMas", titulo: "De más", detalle: "ya estaba completo" },
  { motivo: "noRegistrado", titulo: "Código no registrado", detalle: "la etiqueta no está confirmada" },
  { motivo: "codigoCaja", titulo: "Código de caja", detalle: "se escaneó la caja y no la unidad" },
  { motivo: "cambioSap", titulo: "Cambió en SAP", detalle: "mientras se preparaba" },
  { motivo: "otro", titulo: "Otros", detalle: "presentación o estado de la preparación" },
];

// lecturas: filas de repo.lecturas; semanas: repo.lecturasPorSemana de las últimas 8 semanas; equivocados: repo.equivocados;
// productoDe: Map código → itemCode; nombres: Map itemCode → nombre.
export function armarErrores({ lecturas, preparaciones, semanas, equivocados, productoDe, nombres, hoy }) {
  const vacio = () => ({ lecturas: 0, rechazadas: 0, equivocado: 0, deMas: 0, noRegistrado: 0, codigoCaja: 0, cambioSap: 0, otro: 0 });
  const total = vacio(), operadores = new Map();
  for (const f of lecturas) {
    const nombre = f.operador ?? "Sin nombre";
    const o = operadores.get(nombre) ?? { operador: nombre, ...vacio() };
    for (const destino of [total, o]) {
      destino.lecturas += f.cantidad;
      if (f.resultado === "rechazado") { destino.rechazadas += f.cantidad; destino[motivoRechazo(f.errorCode, f.esCaja)] += f.cantidad; }
    }
    operadores.set(nombre, o);
  }
  const porOperador = [...operadores.values()].map((o) => ({ ...o, tasa: redondear1(tasa(o.rechazadas, o.lecturas)) }))
    .sort((a, b) => b.lecturas - a.lecturas || porNombre(a.operador, b.operador));

  const porSemanaMapa = new Map(semanas.map((s) => [s.semana, s]));
  const lunes = lunesDe(hoy);
  const porSemana = Array.from({ length: 8 }, (_, i) => {
    const semana = semanaIso(sumarDias(lunes, -7 * (7 - i)));
    const s = porSemanaMapa.get(semana) ?? { lecturas: 0, rechazadas: 0 };
    return { semana, numero: Number(semana.slice(-2)), lecturas: s.lecturas, rechazadas: s.rechazadas, tasa: redondear1(tasa(s.rechazadas, s.lecturas)) };
  });

  const porCodigo = new Map();
  for (const e of equivocados) {
    const c = porCodigo.get(e.codigo) ?? { codigo: e.codigo, veces: 0, siguientes: new Map() };
    c.veces += 1;
    if (e.siguiente) c.siguientes.set(e.siguiente, (c.siguientes.get(e.siguiente) ?? 0) + 1);
    porCodigo.set(e.codigo, c);
  }
  const productos = [...porCodigo.values()].sort((a, b) => b.veces - a.veces || a.codigo.localeCompare(b.codigo)).slice(0, 10).map((c) => {
    const itemCode = productoDe.get(c.codigo) ?? null;
    const [confunde, vecesConfunde] = [...c.siguientes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return { codigo: c.codigo, itemCode, itemName: itemCode ? nombres.get(itemCode) ?? null : null, veces: c.veces,
      seConfundeCon: confunde ? { itemCode: confunde, itemName: nombres.get(confunde) ?? null, veces: vecesConfunde } : null };
  });

  const motivos = MOTIVOS.map((m) => ({ ...m, cantidad: total[m.motivo] })).filter((m) => m.cantidad > 0 || m.motivo !== "otro");
  const actual = porSemana.at(-1), primera = porSemana[0];
  const destacados = [];
  if (total.equivocado > 0) destacados.push(`${plural(total.equivocado, "vez", "veces")} se escaneó un producto que no iba: el escáner lo frenó antes de que saliera.`);
  const top = productos[0];
  if (top?.veces >= 2) {
    const casiSiempre = top.seConfundeCon && top.seConfundeCon.veces * 2 > top.veces ? `, casi siempre por ${top.seConfundeCon.itemName ?? top.seConfundeCon.itemCode}` : "";
    destacados.push(`${top.itemName ?? top.codigo} es el que más se confunde: ${plural(top.veces, "vez", "veces")}${casiSiempre}.`);
  }
  const conLecturas = porOperador.filter((o) => o.lecturas >= 50);
  if (conLecturas.length > 1) {
    const alta = [...conLecturas].sort((a, b) => b.tasa - a.tasa)[0];
    if (alta.tasa > 0) destacados.push(`${alta.operador} tiene la tasa más alta (${porcentaje(alta.tasa)}). Vale revisar con él dónde están ubicados los productos parecidos.`);
  }
  if (!total.lecturas) destacados.push("No hubo lecturas en este período.");

  return {
    resumen: { lecturas: total.lecturas, preparaciones, rechazadas: total.rechazadas, porcentajeRechazadas: redondear1(tasa(total.rechazadas, total.lecturas)),
      equivocado: total.equivocado, tasaSemana: actual.tasa, tasaHace8Semanas: primera.lecturas ? primera.tasa : null },
    destacados, motivos, porSemana, porOperador, productos,
  };
}

// ---------- 4. Más salen ----------
// salidas: repo.salidas; enPequena: repo.enPequena; codigos: Map itemCode → código de barras.
export function armarSalidas({ salidas, enPequena, nombres, codigos, rango, limite, ahora }) {
  const habiles = rango.diasHabiles;
  const pequena = new Map(enPequena.map((p) => [p.itemCode, p]));
  const total = salidas.reduce((t, s) => t + s.unidades, 0);
  const filas = salidas.map((s) => {
    const en02 = pequena.get(s.itemCode)?.pequena ?? 0;
    const porDia = s.unidades / habiles;
    return { itemCode: s.itemCode, itemName: nombres.get(s.itemCode) ?? null, codigo: codigos.get(s.itemCode) ?? null,
      unidades: s.unidades, parte: redondear1(tasa(s.unidades, total)), documentos: s.documentos,
      porDia: Math.round(porDia * 10) / 10, en02, alcanzaDias: porDia > 0 ? Math.floor(Math.max(0, en02) / porDia) : null };
  }).sort((a, b) => b.unidades - a.unidades || a.itemCode.localeCompare(b.itemCode));
  const conSalida = new Set(salidas.map((s) => s.itemCode));
  const sinSalidas = enPequena.filter((p) => !conSalida.has(p.itemCode)).map((p) => ({ itemCode: p.itemCode, itemName: p.itemName,
    codigo: codigos.get(p.itemCode) ?? null, en02: p.pequena, ultimaSalida: p.ultimaSalida,
    diasSinSalir: p.ultimaSalida ? diasEntre(fechaLocal(p.ultimaSalida), fechaLocal(ahora)) : null, vencePrimero: p.vencePrimero }))
    .sort((a, b) => b.en02 - a.en02 || a.itemCode.localeCompare(b.itemCode));
  const poco = filas.filter((f) => f.alcanzaDias !== null && f.alcanzaDias < DIAS_REPONER_PRONTO);
  const top = filas.slice(0, limite);

  const destacados = [];
  if (top.length && filas.length > top.length) {
    destacados.push(`Los ${numero(top.length)} productos de la tabla son el ${porcentaje(tasa(top.reduce((t, f) => t + f.unidades, 0), total))} de todo lo que sale: conviene tenerlos más a mano en la 02.`);
  }
  const urgente = [...poco].sort((a, b) => a.alcanzaDias - b.alcanzaDias || b.porDia - a.porDia)[0];
  if (urgente) destacados.push(`${urgente.itemName ?? urgente.itemCode} alcanza para ${urgente.alcanzaDias < 1 ? "menos de 1 día" : plural(urgente.alcanzaDias, "día", "días")} con lo que hay en la 02: hay que pasar cajas de la 01.`);
  if (sinSalidas.length) destacados.push(`${plural(sinSalidas.length, "producto tiene", "productos tienen")} unidades en la 02 y no ${sinSalidas.length === 1 ? "salió" : "salieron"} en ${plural(rango.dias, "día", "días")}: ocupan lugar de despacho.`);

  return {
    resumen: { unidades: total, porDiaHabil: Math.round(total / habiles), diasHabiles: habiles, productos: filas.length,
      alcanzanParaPoco: poco.length, sinSalidas: sinSalidas.length },
    destacados, productos: top, sinSalidas,
  };
}

// ---------- 5. Reposiciones ----------
// reposiciones: repo.reposiciones; salidaDiaria: Map itemCode → unidades por día hábil (últimos 30 días);
// enPequena: Map itemCode → unidades en la 02; cajas: Map itemCode → { cajas, lote, vencimiento } de la 01.
export function armarReposiciones({ reposiciones, como, salidaDiaria, enPequena, cajas, nombres, codigos, rango }) {
  const elegidas = reposiciones.filter((r) => como === "todas" || (como === "sap" ? r.tipo === "traspaso" : r.tipo === "reposicion"));
  const semanas = new Map();
  for (let f = lunesDe(rango.primerDia); f <= rango.ultimoDia; f = sumarDias(f, 7)) {
    semanas.set(semanaIso(f), { semana: semanaIso(f), numero: Number(semanaIso(f).slice(-2)), sap: 0, mano: 0 });
  }
  const productos = new Map();
  for (const r of elegidas) {
    const s = semanas.get(semanaIso(fechaLocal(r.creadoEn)));
    if (s) s[r.tipo === "traspaso" ? "sap" : "mano"] += 1;
    const p = productos.get(r.itemCode) ?? { itemCode: r.itemCode, veces: 0, cajas: 0, unidades: 0, fechas: [] };
    p.veces += 1; p.cajas += r.cajas; p.unidades += r.unidades; p.fechas.push(new Date(r.creadoEn));
    productos.set(r.itemCode, p);
  }
  const masSeReponen = [...productos.values()].map((p) => {
    const fechas = p.fechas.sort((a, b) => a - b);
    const cadaDias = p.veces > 1 ? Math.round(diasEntre(fechaLocal(fechas[0]), fechaLocal(fechas.at(-1))) / (p.veces - 1)) : null;
    return { itemCode: p.itemCode, itemName: nombres.get(p.itemCode) ?? null, codigo: codigos.get(p.itemCode) ?? null, veces: p.veces,
      cajas: p.cajas, unidades: p.unidades, cajasPorVez: Math.round(p.cajas / p.veces), cadaDias, ultima: fechas.at(-1) };
  }).sort((a, b) => b.veces - a.veces || b.unidades - a.unidades).slice(0, 20);

  const reponerPronto = [...salidaDiaria.entries()].filter(([, porDia]) => porDia > 0).map(([itemCode, porDia]) => {
    const en02 = Math.max(0, enPequena.get(itemCode) ?? 0);
    const enGrande = cajas.get(itemCode);
    return { itemCode, itemName: nombres.get(itemCode) ?? null, codigo: codigos.get(itemCode) ?? null, en02,
      salePorDia: Math.round(porDia * 10) / 10, alcanzaDias: Math.floor(en02 / porDia), cajasEnGrande: enGrande?.cajas ?? 0,
      loteVencePrimero: enGrande ? { lote: enGrande.lote, vencimiento: enGrande.vencimiento } : null };
  }).filter((p) => p.alcanzaDias < DIAS_REPONER_PRONTO).sort((a, b) => a.alcanzaDias - b.alcanzaDias || b.salePorDia - a.salePorDia);

  const totalCajas = elegidas.reduce((t, r) => t + r.cajas, 0);
  const sap = elegidas.filter((r) => r.tipo === "traspaso").length;
  const nSemanas = Math.max(1, rango.dias / 7);
  const destacados = [];
  const frecuente = masSeReponen.find((p) => p.veces >= 3 && p.cadaDias !== null);
  if (frecuente) destacados.push(`${frecuente.itemName ?? frecuente.itemCode} se repuso ${plural(frecuente.veces, "vez", "veces")} en ${plural(rango.dias, "día", "días")}, cada ${plural(frecuente.cadaDias, "día", "días")}: conviene pasar más cajas por vez.`);
  if (elegidas.length && como === "todas") destacados.push(`El ${porcentaje(tasa(sap, elegidas.length))} de las reposiciones fueron traspasos de SAP aceptados; el resto se pasó a mano desde una caja.`);
  if (reponerPronto.length) destacados.push(`${plural(reponerPronto.length, "producto se va", "productos se van")} a quedar sin unidades en la 02 en menos de ${DIAS_REPONER_PRONTO} días si no se pasan cajas.`);
  if (!elegidas.length) destacados.push("No hubo reposiciones en este período.");

  return {
    resumen: { reposiciones: elegidas.length, porSemana: Math.round((elegidas.length / nSemanas) * 10) / 10, cajas: totalCajas,
      unidades: elegidas.reduce((t, r) => t + r.unidades, 0), productos: productos.size, reponerPronto: reponerPronto.length,
      deSap: sap, aMano: elegidas.length - sap },
    destacados, porSemana: [...semanas.values()], reponerPronto, masSeReponen,
  };
}

// ---------- 6. Correcciones ----------
const LUGAR = { grande: "la 01", pequena: "la 02" };
const lugarDe = (d) => d.almacen ? `la ${d.almacen}` : LUGAR[d.bodega] ?? d.bodega ?? "";
const TIPOS_CAMBIO = ["conteo", "lote", "anulada", "codigo"];

// registrados: repo.cambiosRegistrados; antiguas: repo.edicionesAntiguas; descuentos: repo.descuentosCorregidos (con el
// texto de la asignación vigente en ahora); anuladas: repo.anuladas.
export function armarCorrecciones({ registrados, antiguas, descuentos, anuladas, nombres, tipo = "todos", persona = null }) {
  const nombre = (itemCode) => nombres.get(itemCode) ?? itemCode;
  const cambios = [];
  for (const r of registrados) {
    let d; try { d = JSON.parse(r.detalle ?? "{}"); } catch { d = {}; }
    if (r.entidad === "conteo") {
      cambios.push({ tipo: "conteo", fecha: r.creadoEn, persona: r.persona, titulo: nombre(d.itemCode), itemCode: d.itemCode,
        detalle: `Conteo de ${lugarDe(d)}`, antes: d.antes ?? null, ahora: d.ahora ?? null, unidades: d.unidades ?? 0, lugar: lugarDe(d) });
    } else if (r.entidad === "codigo") {
      cambios.push({ tipo: "codigo", fecha: r.creadoEn, persona: r.persona, titulo: nombre(d.itemCode), itemCode: d.itemCode,
        detalle: d.clase === "caja" ? "Código de caja" : "Código de barras", antes: d.codigo ?? null, ahora: null });
    }
    // Las anulaciones registradas se leen junto con la preparación (anuladas), que tiene el documento.
  }
  for (const c of antiguas) {
    cambios.push({ tipo: "conteo", fecha: c.creadoEn, persona: c.persona, titulo: nombre(c.itemCode), itemCode: c.itemCode,
      detalle: "Conteo de la 01", antes: `${numero(c.registrado - c.cantidad)} u.`, ahora: `${numero(c.registrado)} u.`, unidades: c.cantidad, lugar: "la 01" });
  }
  for (const d of descuentos) {
    cambios.push({ tipo: "lote", fecha: d.corregidoEn, persona: d.corregidoPor?.replace(/^operador:/, "") ?? null, titulo: nombre(d.itemCode),
      itemCode: d.itemCode, detalle: `Salida marcada de ${numero(d.unidades)} u.`, antes: d.anterior ?? null, ahora: d.actual ?? null });
  }
  for (const a of anuladas) {
    cambios.push({ tipo: "anulada", fecha: a.fechaFin, persona: a.persona ?? null,
      titulo: `${rotuloDocumento(a.fuente, a.docNum)}${a.almacenDestino ? ` · a la ${a.almacenDestino}` : ""}`, pickingId: a.id,
      detalle: `Cambió en SAP mientras se preparaba${a.operador ? ` · ${a.operador}` : ""}`,
      antes: plural(a.lecturas, "lectura", "lecturas"), ahora: "Se vuelve a preparar" });
  }
  cambios.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const delPeriodo = persona ? cambios.filter((c) => c.persona === persona) : cambios;
  const conteos = delPeriodo.filter((c) => c.tipo === "conteo");
  const resumen = { todos: delPeriodo.length, conteo: conteos.length, unidadesConteo: conteos.reduce((t, c) => t + (c.unidades ?? 0), 0),
    lote: delPeriodo.filter((c) => c.tipo === "lote").length, anulada: delPeriodo.filter((c) => c.tipo === "anulada").length,
    codigo: delPeriodo.filter((c) => c.tipo === "codigo").length };
  const lista = tipo === "todos" ? delPeriodo : delPeriodo.filter((c) => c.tipo === tipo);

  const destacados = [];
  const editados = new Map();
  for (const c of conteos) {
    const clave = `${c.itemCode}|${c.lugar}`;
    editados.set(clave, { ...c, veces: (editados.get(clave)?.veces ?? 0) + 1 });
  }
  const repetido = [...editados.values()].sort((a, b) => b.veces - a.veces)[0];
  if (repetido?.veces >= 2) destacados.push(`El conteo de ${repetido.lugar} de ${repetido.titulo} se editó ${numero(repetido.veces)} veces: conviene volver a contarlo.`);
  const lotes = delPeriodo.filter((c) => c.tipo === "lote");
  if (lotes.length >= 2) {
    const porDia = new Map();
    for (const c of lotes) { const f = fechaLocal(c.fecha); porDia.set(f, (porDia.get(f) ?? 0) + 1); }
    const [dia, cuantos] = [...porDia.entries()].sort((a, b) => b[1] - a[1])[0];
    if (cuantos >= 2) destacados.push(`${numero(cuantos)} de los ${numero(lotes.length)} cambios de lote fueron del mismo día (${fechaCorta(dia)}).`);
  }
  if (!delPeriodo.length) destacados.push("No hubo correcciones en este período.");

  const personas = [...new Set(cambios.map((c) => c.persona).filter(Boolean))].sort(porNombre);
  return { resumen, destacados, personas, cambios: lista, tipos: TIPOS_CAMBIO };
}

// ---------- 7. Pendientes atrasados ----------
// Antigüedad en días de calendario (hora de Honduras) desde el último cambio de SAP del producto.
const bucket = (dias) => (dias === null ? "sinFecha" : dias === 0 ? "hoy" : dias <= 2 ? "unoADos" : dias <= 6 ? "tresASeis" : "sieteOMas");

// pendientes: los de listarPendientes del inventario; cambios: Map itemCode → sapCambioEn.
export function armarPendientes({ pendientes, cambios, codigos, minDias, ahora }) {
  const hoy = fechaLocal(ahora);
  const con = (clase, lista, unidades) => lista.map((v) => {
    const desde = cambios.get(v.itemCode) ?? null;
    const dias = desde ? Math.max(0, diasEntre(fechaLocal(desde), hoy)) : null;
    return { clase, itemCode: v.itemCode, itemName: v.itemName, codigo: codigos.get(v.itemCode) ?? null, unidades: unidades(v), desde, dias };
  });
  const grupos = {
    faltaGuardar: con("faltaGuardar", pendientes.porUbicar, (v) => Math.abs(v.diferencia)),
    faltaMarcarSalida: con("faltaMarcarSalida", pendientes.porDescontar, (v) => Math.abs(v.diferencia)),
    traspasosPorAceptar: con("traspasosPorAceptar", pendientes.porPasar, (v) => v.unidades),
  };
  const tarjeta = (lista) => {
    const cuenta = { total: lista.length, hoy: 0, unoADos: 0, tresASeis: 0, sieteOMas: 0, sinFecha: 0 };
    for (const p of lista) cuenta[bucket(p.dias)] += 1;
    const viejo = [...lista].sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity))[0] ?? null;
    return { ...cuenta, masViejo: viejo ? { itemCode: viejo.itemCode, itemName: viejo.itemName, dias: viejo.dias } : null };
  };
  const todos = Object.values(grupos).flat();
  const lista = todos.filter((p) => p.dias === null || p.dias >= minDias)
    .sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity) || a.itemCode.localeCompare(b.itemCode));

  const destacados = [];
  const g = grupos.faltaGuardar;
  if (g.length) {
    const semana = g.filter((p) => p.dias === null || p.dias >= 7).sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity));
    const nombres = semana.slice(0, 2).map((p) => p.itemName ?? p.itemCode);
    destacados.push(`${plural(g.length, "producto espera", "productos esperan")} Falta guardar${semana.length
      ? `; ${numero(semana.length)} ${semana.length === 1 ? "lleva" : "llevan"} más de una semana: ${nombres.join(" y ")}${semana.length > 2 ? " y otros" : ""}` : ""}.`);
  }
  const traspaso = [...grupos.traspasosPorAceptar].filter((p) => p.dias !== null && p.dias >= 2).sort((a, b) => b.dias - a.dias)[0];
  if (traspaso) destacados.push(`El traspaso de ${traspaso.itemName ?? traspaso.itemCode} está sin aceptar desde el ${nombreDia(fechaLocal(traspaso.desde))}: hasta que se acepte, la 02 no cuadra.`);
  const s = grupos.faltaMarcarSalida.filter((p) => p.dias !== null && p.dias >= 3);
  if (s.length) destacados.push(`${plural(s.length, "salida espera", "salidas esperan")} hace 3 días o más que se marque de qué lote salió.`);
  if (!todos.length) destacados.push("No hay pendientes: el inventario está al día con SAP.");

  return {
    resumen: { faltaGuardar: tarjeta(grupos.faltaGuardar), faltaMarcarSalida: tarjeta(grupos.faltaMarcarSalida),
      traspasosPorAceptar: tarjeta(grupos.traspasosPorAceptar) },
    destacados, minDias, lista,
  };
}

// ---------- 8. Actividad por operador ----------
// Une lo que hizo cada persona en el día: preparaciones (por quien la preparó), lecturas, movimientos del inventario,
// conteos, salidas marcadas, códigos registrados y cambios del supervisor.
export function armarActividad({ dia, preparaciones, lecturasHora, movimientos, cuadres, conteosAlmacen, descuentos, codigos, cambios, nombres, persona = null }) {
  const nombre = (itemCode) => nombres.get(itemCode) ?? itemCode;
  const personas = new Map();
  const de = (quien) => {
    const clave = quien ?? "Sin nombre";
    if (!personas.has(clave)) personas.set(clave, { persona: clave, primera: null, ultima: null, preparaciones: 0, unidades: 0,
      recepciones: 0, productosContados: new Set(), reposiciones: 0, salidasMarcadas: 0, codigosRegistrados: 0, porHora: new Array(24).fill(0), acciones: [] });
    return personas.get(clave);
  };
  const marcar = (p, instante) => {
    const t = new Date(instante);
    if (!p.primera || t < p.primera) p.primera = t;
    if (!p.ultima || t > p.ultima) p.ultima = t;
  };
  const accion = (quien, instante, tipo, titulo, detalle = null, contarHora = true) => {
    const p = de(quien);
    marcar(p, instante);
    if (contarHora) p.porHora[horaLocal(instante)] += 1;
    p.acciones.push({ hora: new Date(instante), tipo, titulo, detalle });
    return p;
  };

  for (const l of lecturasHora) {
    const p = de(l.persona);
    p.porHora[l.hora] += l.cantidad;
    marcar(p, l.primera); marcar(p, l.ultima);
  }
  for (const s of preparaciones) {
    if (!TERMINADA.has(s.estado)) continue;
    const p = accion(s.operador, s.fechaFin, "preparacion", rotuloDocumento(s.fuente, s.docNum),
      `${numero(s.preparadas)} de ${numero(s.pedidas)} unidades${s.estado === "con_diferencias" ? " · con diferencias" : ""}`, false);
    p.preparaciones += 1; p.unidades += s.preparadas;
  }
  for (const m of movimientos) {
    if (m.tipo === "reposicion" || m.tipo === "traspaso") {
      const p = accion(m.persona, m.creadoEn, "reposicion", nombre(m.itemCode),
        `${plural(m.cajas, "caja", "cajas")} a la 02${m.tipo === "traspaso" ? " · traspaso de SAP" : " · a mano"}`);
      p.reposiciones += 1;
    } else if (m.tipo === "reasignacion") {
      accion(m.persona, m.creadoEn, "correccion", nombre(m.itemCode), "Lote cambiado en una salida marcada");
    } else if (m.tipo === "descuento") {
      continue; // las salidas marcadas se cuentan por su descuento
    } else if (m.tipo === "correccion" && !cuadres.some((c) => c.itemCode === m.itemCode && c.accion === "edicion")) {
      accion(m.persona, m.creadoEn, "correccion", nombre(m.itemCode), `Corrección de ${numero(m.entra ?? -(m.sale ?? 0))} u.`);
    }
  }
  for (const c of cuadres) {
    if (c.accion === "recepcion" && !c.primero) {
      const mov = movimientos.find((m) => m.tipo === "recepcion" && m.itemCode === c.itemCode && Math.abs(new Date(m.creadoEn) - new Date(c.creadoEn)) < 5000);
      const p = accion(c.persona, c.creadoEn, "recepcion", nombre(c.itemCode),
        mov?.cajas ? `${plural(mov.cajas, "caja", "cajas")} · ${plural(mov.lotes, "lote", "lotes")}` : `${numero(c.cantidad)} u. a ${LUGAR[c.bodega]}`);
      p.recepciones += 1;
    } else {
      const texto = c.accion === "no_hay" ? `No hay en ${LUGAR[c.bodega]}` : c.accion === "edicion" ? `Conteo de ${LUGAR[c.bodega]} editado`
        : `${numero(c.cantidad)} u. en ${LUGAR[c.bodega]}`;
      const p = accion(c.persona, c.creadoEn, "conteo", nombre(c.itemCode), texto);
      p.productosContados.add(`${c.bodega}|${c.itemCode}`);
    }
  }
  for (const c of conteosAlmacen) {
    const p = accion(c.persona, c.creadoEn, "conteo", nombre(c.itemCode), `${numero(c.unidades)} u. en la ${c.almacen}${c.editado ? " · editado" : ""}`);
    p.productosContados.add(`${c.almacen}|${c.itemCode}`);
  }
  for (const d of descuentos) {
    const p = accion(d.persona, d.creadoEn, "salida", nombre(d.itemCode), `Salida marcada de ${numero(d.unidades)} u.`);
    p.salidasMarcadas += 1;
  }
  for (const c of codigos) {
    const p = accion(c.persona, c.creadoEn, "codigo", nombre(c.itemCode), c.clase === "caja" ? "Código de caja registrado" : "Código de barras registrado");
    p.codigosRegistrados += 1;
  }
  for (const c of cambios) {
    let d; try { d = JSON.parse(c.detalle ?? "{}"); } catch { d = {}; }
    if (c.entidad === "preparacion") accion(c.persona, c.creadoEn, "correccion", "Preparación anulada", d.documento ?? null);
    else if (c.entidad === "codigo") accion(c.persona, c.creadoEn, "correccion", nombre(d.itemCode), `${d.clase === "caja" ? "Código de caja" : "Código de barras"} quitado`);
  }

  const filas = [...personas.values()].map((p) => ({ persona: p.persona, primera: p.primera, ultima: p.ultima, preparaciones: p.preparaciones,
    unidades: Math.round(p.unidades), recepciones: p.recepciones, productosContados: p.productosContados.size, reposiciones: p.reposiciones,
    salidasMarcadas: p.salidasMarcadas, codigosRegistrados: p.codigosRegistrados }))
    .sort((a, b) => (a.primera ?? 0) - (b.primera ?? 0) || porNombre(a.persona, b.persona));
  const elegido = persona && personas.has(persona) ? personas.get(persona) : null;
  const detalle = elegido ? {
    ...filas.find((f) => f.persona === elegido.persona),
    porHora: elegido.porHora.map((cantidad, hora) => ({ hora, cantidad })),
    acciones: elegido.acciones.sort((a, b) => b.hora - a.hora),
  } : null;
  return { dia, personas: filas, detalle };
}

// ---------- 9. Vencimientos ----------
// Tramos de días hasta el vencimiento (negativo: ya venció).
export const TRAMOS_VENCIMIENTO = [
  { tramo: "vencido", desde: -Infinity, hasta: -1 }, { tramo: "en30", desde: 0, hasta: 30 },
  { tramo: "en60", desde: 31, hasta: 60 }, { tramo: "en90", desde: 61, hasta: 90 }, { tramo: "mas", desde: 91, hasta: Infinity },
];
const tramoDe = (dias) => TRAMOS_VENCIMIENTO.find((t) => dias >= t.desde && dias <= t.hasta).tramo;

// filas: repo.vencimientos; sinFecha: repo.sinVencimiento; almacenes: { grande, pequena } (códigos de SAP de cada bodega);
// codigos: Map itemCode → código de barras; donde: "todas" o el código de un almacén.
export function armarVencimientos({ filas, sinFecha, almacenes, codigos, hoy, donde = "todas" }) {
  const codigoDe = (f) => (f.lugar === "almacen" ? f.almacen : almacenes[f.lugar] ?? (f.lugar === "grande" ? "01" : "02"));
  const lotes = filas.map((f) => {
    const dias = diasEntre(hoy, f.vencimiento);
    return { itemCode: f.itemCode, itemName: f.itemName, codigo: codigos.get(f.itemCode) ?? null, almacen: codigoDe(f),
      enCajas: f.lugar === "grande" || (f.lugar === "almacen" && f.cajas > 0), lote: f.lote, vencimiento: f.vencimiento, dias, tramo: tramoDe(dias),
      cajas: f.cajas, unidades: f.unidades, contadoEn: f.contadoEn ?? null };
  }).filter((l) => donde === "todas" || l.almacen === donde);
  const sinFechaLista = sinFecha.map((s) => ({ almacen: s.lugar === "almacen" ? s.almacen : almacenes[s.lugar] ?? (s.lugar === "grande" ? "01" : "02"),
    productos: s.productos, unidades: s.unidades })).filter((s) => donde === "todas" || s.almacen === donde);

  const resumen = Object.fromEntries(TRAMOS_VENCIMIENTO.map((t) => [t.tramo, { lotes: 0, unidades: 0 }]));
  for (const l of lotes) { resumen[l.tramo].lotes += 1; resumen[l.tramo].unidades += l.unidades; }
  resumen.sinFecha = { productos: sinFechaLista.reduce((t, s) => t + s.productos, 0), unidades: sinFechaLista.reduce((t, s) => t + s.unidades, 0) };

  // Por mes de vencimiento (lo vencido junto, al principio).
  const meses = new Map([["vencido", { mes: "vencido", unidades: 0, lotes: 0 }]]);
  for (const l of lotes) {
    const clave = l.dias < 0 ? "vencido" : l.vencimiento.slice(0, 7);
    const m = meses.get(clave) ?? { mes: clave, unidades: 0, lotes: 0 };
    m.unidades += l.unidades; m.lotes += 1;
    meses.set(clave, m);
  }
  const porMes = [...meses.values()].sort((a, b) => (a.mes === "vencido" ? -1 : b.mes === "vencido" ? 1 : a.mes.localeCompare(b.mes)));

  // Productos en los que la 01 tiene un lote que vence antes que todos los de la 02: conviene pasar ese primero.
  const primero = new Map();
  for (const l of lotes) {
    if (l.almacen !== (almacenes.grande ?? "01") && l.almacen !== (almacenes.pequena ?? "02")) continue;
    const lado = l.almacen === (almacenes.grande ?? "01") ? "grande" : "pequena";
    const p = primero.get(l.itemCode) ?? { itemCode: l.itemCode, itemName: l.itemName };
    if (!p[lado] || l.vencimiento < p[lado].vencimiento) p[lado] = l;
    primero.set(l.itemCode, p);
  }
  const pasarPrimero = [...primero.values()].filter((p) => p.grande && p.pequena && p.grande.vencimiento < p.pequena.vencimiento && p.grande.dias >= 0)
    .map((p) => ({ itemCode: p.itemCode, itemName: p.itemName, loteGrande: p.grande.lote, venceGrande: p.grande.vencimiento,
      lotePequena: p.pequena.lote, vencePequena: p.pequena.vencimiento }))
    .sort((a, b) => a.venceGrande.localeCompare(b.venceGrande));

  const lugarMayor = (lista) => {
    const por = new Map();
    for (const l of lista) por.set(l.almacen, (por.get(l.almacen) ?? 0) + l.unidades);
    return [...por.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const vencidos = lotes.filter((l) => l.dias < 0);
  const porVencer = lotes.filter((l) => l.dias >= 0);
  const destacados = [];
  if (vencidos.length) destacados.push(`Hay ${plural(vencidos.length, "lote vencido", "lotes vencidos")} con ${plural(resumen.vencido.unidades, "unidad", "unidades")}: hay que sacarlos de la venta. La mayor parte está en la ${lugarMayor(vencidos)}.`);
  const proximo = porVencer[0];
  if (proximo) destacados.push(`Lo próximo en vencer: ${proximo.itemName}${proximo.lote ? `, lote ${proximo.lote}` : ""}, el ${fechaCorta(proximo.vencimiento)}/${proximo.vencimiento.slice(0, 4)} (${proximo.dias === 0 ? "hoy" : `en ${plural(proximo.dias, "día", "días")}`}) en la ${proximo.almacen}: ${proximo.enCajas && proximo.cajas ? plural(proximo.cajas, "caja", "cajas") : plural(proximo.unidades, "unidad", "unidades")}.`);
  if (pasarPrimero.length) destacados.push(`En ${plural(pasarPrimero.length, "producto", "productos")} la ${almacenes.grande ?? "01"} tiene un lote que vence antes que el de la ${almacenes.pequena ?? "02"}: conviene pasar ese primero.`);
  if (resumen.sinFecha.unidades) destacados.push(`${plural(resumen.sinFecha.unidades, "unidad no tiene", "unidades no tienen")} fecha de vencimiento cargada (${plural(resumen.sinFecha.productos, "producto", "productos")}): no aparecen en este reporte.`);
  if (!lotes.length && !resumen.sinFecha.unidades) destacados.push("Nada vence en este plazo.");

  return { resumen, destacados, porMes, vencidos, porVencer, pasarPrimero, sinFecha: sinFechaLista };
}
