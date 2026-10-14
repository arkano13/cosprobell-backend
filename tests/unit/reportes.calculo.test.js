import test from "node:test";
import assert from "node:assert/strict";
import { rangoPeriodo, rangoDia, inicioDelDia, fechaLocal, semanaIso, diasHabiles } from "../../src/modules/reportes/reportes.periodo.js";
import { armarPreparaciones, armarDetalle, armarErrores, armarSalidas, armarReposiciones, armarCorrecciones, armarPendientes,
  armarActividad, armarVencimientos, motivoRechazo, duracionValida } from "../../src/modules/reportes/reportes.calculo.js";
import { textoConteo } from "../../src/modules/inventario/inventario.calculo.js";

const h = (iso) => new Date(iso);
// 13/10/2026 15:20 en Honduras (UTC−6).
const AHORA = h("2026-10-13T21:20:00Z");

test("períodos: los días se cortan en la hora de Honduras", () => {
  assert.equal(inicioDelDia("2026-10-13").toISOString(), "2026-10-13T06:00:00.000Z");
  // 23:30 del 12 en Honduras ya es 13 en UTC: sigue siendo el 12.
  assert.equal(fechaLocal(h("2026-10-13T05:30:00Z")), "2026-10-12");
  const r = rangoPeriodo("7d", AHORA);
  assert.deepEqual([r.primerDia, r.ultimoDia, r.dias, r.desde.toISOString()], ["2026-10-07", "2026-10-13", 7, "2026-10-07T06:00:00.000Z"]);
  assert.deepEqual([rangoPeriodo("hoy", AHORA).primerDia, rangoPeriodo("mes", AHORA).primerDia], ["2026-10-13", "2026-10-01"]);
  assert.deepEqual([rangoDia("2026-10-12").desde.toISOString(), rangoDia("2026-10-12").hasta.toISOString()],
    ["2026-10-12T06:00:00.000Z", "2026-10-13T06:00:00.000Z"]);
  assert.equal(semanaIso("2026-10-13"), "2026-W42");
  assert.equal(semanaIso("2027-01-01"), "2026-W53");
  // Del miércoles 7 al martes 13 hay un domingo: 6 días hábiles.
  assert.equal(diasHabiles(r), 6);
});

test("preparaciones: tarjetas, por día, por operador y la cola sin preparar", () => {
  const s = (id, operador, estado, inicio, fin, preparadas, pedidas, fuente = "factura") => ({ id, operador, estado, fuente, docNum: 10000 + id,
    fechaInicio: h(inicio), fechaFin: fin ? h(fin) : null, preparadas, pedidas });
  const sesiones = [
    s(1, "Ana", "completo", "2026-10-12T15:00:00Z", "2026-10-12T15:10:00Z", 20, 20),
    s(2, "Ana", "con_diferencias", "2026-10-12T16:00:00Z", "2026-10-12T16:20:00Z", 10, 12),
    // Abierta más de 4 horas: cuenta como preparación pero no en el tiempo promedio.
    s(3, "Beto", "completo", "2026-10-09T13:00:00Z", "2026-10-09T19:00:00Z", 30, 30, "traslado"),
    s(4, "Beto", "anulada", "2026-10-13T14:00:00Z", "2026-10-13T15:00:00Z", 2, 5),
  ];
  const sinPreparar = [{ docEntry: -1, docNum: 10388, fuente: "factura", lineas: 12, docDate: "2026-10-09" },
    { docEntry: -2, docNum: 10458, fuente: "factura", lineas: 3, docDate: "2026-10-13" },
    { docEntry: -3, docNum: 2219, fuente: "traslado", lineas: 5, docDate: "2026-10-12" }];
  const r = armarPreparaciones({ sesiones, sinPreparar, rango: rangoPeriodo("7d", AHORA), hoy: "2026-10-13" });
  assert.deepEqual(r.resumen, { preparaciones: 3, facturas: 2, traslados: 1, unidades: 60, unidadesPorPreparacion: 20,
    segundosPromedio: 900, conDiferencias: 1, porcentajeConDiferencias: 33.3 });
  assert.deepEqual(r.porDia.find((d) => d.fecha === "2026-10-12"), { fecha: "2026-10-12", completas: 1, conDiferencias: 1 });
  assert.equal(r.porDia.length, 7);
  // Ritmo: unidades por hora de las preparaciones cronometradas (Ana: 30 unidades en 30 minutos).
  assert.deepEqual(r.porOperador.map((o) => [o.operador, o.preparaciones, o.segundosPromedio, o.ritmo]), [["Ana", 2, 900, 60], ["Beto", 1, null, null]]);
  assert.deepEqual([r.sinPreparar.total, r.sinPreparar.hoy, r.sinPreparar.unoADos, r.sinPreparar.tresOMas, r.sinPreparar.lista[0].docNum],
    [3, 1, 1, 1, 10388]);
  assert.deepEqual(r.atencion.map((a) => [a.pickingId, a.estado]), [[2, "con_diferencias"], [4, "anulada"]]);
  assert.deepEqual(r.destacados, ["El lunes 12 fue el día con más trabajo: 2 preparaciones.", "Ana tuvo la única preparación con diferencias.",
    "Hay 1 documento esperando hace 3 días o más: el más viejo es factura 10388."]);
  assert.equal(duracionValida({ fechaInicio: h("2026-10-12T10:00:00Z"), fechaFin: null }), null);
});

test("detalle: productos con lo que faltó primero y lecturas con su motivo", () => {
  const sesion = { id: 7, estado: "con_diferencias", usuarioId: "Ana", fechaInicio: h("2026-10-13T16:31:00Z"), fechaFin: h("2026-10-13T16:42:00Z"),
    lineas: [{ id: 1, itemCode: "A", cantidadPedida: 12, cantidadEscaneada: 12, uomCode: "Unidad" },
      { id: 2, itemCode: "C", cantidadPedida: 4, cantidadEscaneada: 2, uomCode: "Unidad", codigoBarrasEscaneado: "7401C" }] };
  const escaneos = [
    { id: 3, codigo: "CAJA-A", resultado: "rechazado", errorCode: "ETIQUETA_NO_ENCONTRADA", errorMessage: "No se encontró", creadoEn: h("2026-10-13T16:40:00Z") },
    { id: 2, codigo: "7401B", resultado: "rechazado", errorCode: "PRODUCTO_FUERA_DEL_PEDIDO", errorMessage: "No va", creadoEn: h("2026-10-13T16:39:00Z") },
    { id: 1, codigo: "7401C", resultado: "aceptado", lineaId: 2, itemCode: "C", cantidadDespues: 2, creadoEn: h("2026-10-13T16:35:00Z") },
  ];
  const r = armarDetalle({ sesion, documento: { fuenteDocumento: "factura", docNum: 10452 }, escaneos,
    nombres: new Map([["A", "Shampoo"], ["B", "Crema"], ["C", "Tinte"]]), codigos: new Map([["A", "7401A"]]),
    leidos: new Map([["CAJA-A", { itemCode: "A", esCaja: true }], ["7401B", { itemCode: "B", esCaja: false }]]) });
  assert.deepEqual([r.segundos, r.unidades, r.lineasCompletas, r.faltan], [660, { preparadas: 14, pedidas: 16 }, 1, { unidades: 2, productos: 1 }]);
  assert.deepEqual(r.productos.map((p) => [p.itemCode, p.codigo, p.falta]), [["C", "7401C", 2], ["A", "7401A", 0]]);
  const conLotes = armarDetalle({ sesion, documento: { fuenteDocumento: "factura", docNum: 10452, cliente: { cardName: "SB Rapunzel's" } }, escaneos,
    nombres: new Map(), codigos: new Map(), leidos: new Map(),
    lotes: [{ itemCode: "A", lote: "L330", vencimiento: "2027-03-31", unidades: 8 }, { itemCode: "A", lote: "L331", vencimiento: null, unidades: 4 }] });
  assert.equal(conLotes.documento.cliente, "SB Rapunzel's");
  assert.deepEqual(conLotes.productos.find((p) => p.itemCode === "A").lotes,
    [{ lote: "L330", vencimiento: "2027-03-31", unidades: 8 }, { lote: "L331", vencimiento: null, unidades: 4 }]);
  assert.deepEqual(r.lecturas.lista.map((l) => [l.itemName, l.motivo, l.lleva, l.de]),
    [["Shampoo", "codigoCaja", null, null], ["Crema", "equivocado", null, null], ["Tinte", null, 2, 4]]);
});

test("errores evitados: motivos, tendencia de 8 semanas y con qué se confunde", () => {
  assert.deepEqual(["PRODUCTO_FUERA_DEL_PEDIDO", "CANTIDAD_COMPLETADA", "LINEA_MODIFICADA", "ETIQUETA_SIN_CONFIRMAR", "PICKING_NO_ACTIVO"]
    .map((c) => motivoRechazo(c)), ["equivocado", "deMas", "cambioSap", "noRegistrado", "otro"]);
  assert.deepEqual([motivoRechazo("ETIQUETA_NO_ENCONTRADA", true), motivoRechazo("ETIQUETA_NO_ENCONTRADA", false)], ["codigoCaja", "noRegistrado"]);
  const lecturas = [
    { operador: "Ana", resultado: "aceptado", errorCode: null, esCaja: false, cantidad: 90 },
    { operador: "Ana", resultado: "rechazado", errorCode: "PRODUCTO_FUERA_DEL_PEDIDO", esCaja: false, cantidad: 6 },
    { operador: "Ana", resultado: "rechazado", errorCode: "ETIQUETA_NO_ENCONTRADA", esCaja: true, cantidad: 4 },
    { operador: "Beto", resultado: "aceptado", errorCode: null, esCaja: false, cantidad: 99 },
    { operador: "Beto", resultado: "rechazado", errorCode: "CANTIDAD_COMPLETADA", esCaja: false, cantidad: 1 },
  ];
  const semanas = [{ semana: "2026-W35", lecturas: 100, rechazadas: 8 }, { semana: "2026-W42", lecturas: 200, rechazadas: 11 }];
  const equivocados = [{ codigo: "400", siguiente: "P250" }, { codigo: "400", siguiente: "P250" }, { codigo: "400", siguiente: null }, { codigo: "B3", siguiente: "B4" }];
  const r = armarErrores({ lecturas, preparaciones: 12, semanas, equivocados, productoDe: new Map([["400", "P400"], ["B3", "PB3"]]),
    nombres: new Map([["P400", "Shampoo 400 ml"], ["P250", "Shampoo 250 ml"], ["PB3", "Tinte 3"], ["B4", "Tinte 4"]]), hoy: "2026-10-13" });
  assert.deepEqual(r.resumen, { lecturas: 200, preparaciones: 12, rechazadas: 11, porcentajeRechazadas: 5.5, equivocado: 6, tasaSemana: 5.5, tasaHace8Semanas: 8 });
  assert.deepEqual(r.motivos.map((m) => [m.motivo, m.cantidad]), [["equivocado", 6], ["deMas", 1], ["noRegistrado", 0], ["codigoCaja", 4], ["cambioSap", 0]]);
  assert.deepEqual(r.porSemana.map((s) => s.numero), [35, 36, 37, 38, 39, 40, 41, 42]);
  assert.deepEqual(r.porOperador.map((o) => [o.operador, o.tasa]), [["Ana", 10], ["Beto", 1]]);
  assert.deepEqual(r.productos.map((p) => [p.itemName, p.veces, p.seConfundeCon?.itemName]), [["Shampoo 400 ml", 3, "Shampoo 250 ml"], ["Tinte 3", 1, "Tinte 4"]]);
  assert.match(r.destacados[1], /^Shampoo 400 ml es el que más se confunde: 3 veces, casi siempre por Shampoo 250 ml\.$/);
  assert.match(r.destacados[2], /^Ana tiene la tasa más alta \(10 %\)/);
});

test("más salen: parte del total, para cuántos días alcanza y lo que no sale", () => {
  const rango = { ...rangoPeriodo("30d", AHORA) };
  rango.diasHabiles = 26;
  const r = armarSalidas({ salidas: [{ itemCode: "A", unidades: 1066, documentos: 212 }, { itemCode: "B", unidades: 260, documentos: 40 },
    { itemCode: "C", unidades: 26, documentos: 5 }],
  enPequena: [{ itemCode: "A", pequena: 38 }, { itemCode: "B", pequena: 100 }, { itemCode: "Z", itemName: "Kit", pequena: 22, ultimaSalida: h("2026-08-22T15:00:00Z"), vencePrimero: "2027-03-31" }],
  nombres: new Map([["A", "Shampoo"], ["B", "Crema"], ["C", "Tinte"]]), codigos: new Map(), rango, limite: 2, ahora: AHORA });
  assert.deepEqual(r.resumen, { unidades: 1352, porDiaHabil: 52, diasHabiles: 26, productos: 3, alcanzanParaPoco: 2, sinSalidas: 1 });
  assert.deepEqual(r.productos.map((p) => [p.itemCode, p.parte, p.porDia, p.alcanzaDias]), [["A", 78.8, 41, 0], ["B", 19.2, 10, 10]]);
  assert.deepEqual(r.sinSalidas.map((p) => [p.itemCode, p.en02, p.diasSinSalir, p.vencePrimero]), [["Z", 22, 52, "2027-03-31"]]);
  assert.equal(r.destacados[1], "Shampoo alcanza para menos de 1 día con lo que hay en la 02: hay que pasar cajas de la 01.");
});

test("reposiciones: por semana, reponer pronto y cada cuánto", () => {
  const rep = (dia, tipo, itemCode, cajas, unidades) => ({ tipo, itemCode, cajas, unidades, creadoEn: h(`${dia}T16:00:00Z`) });
  const reposiciones = [rep("2026-10-01", "traspaso", "A", 4, 160), rep("2026-10-07", "traspaso", "A", 4, 160),
    rep("2026-10-13", "reposicion", "A", 4, 160), rep("2026-10-12", "reposicion", "B", 1, 12)];
  const args = { reposiciones, salidaDiaria: new Map([["A", 41], ["B", 2]]), enPequena: new Map([["A", 38], ["B", 60]]),
    cajas: new Map([["A", { cajas: 14, lote: "L2409", vencimiento: "2027-03-31" }]]), nombres: new Map([["A", "Shampoo"]]), codigos: new Map(),
    rango: rangoPeriodo("30d", AHORA) };
  const r = armarReposiciones({ ...args, como: "todas" });
  assert.deepEqual([r.resumen.reposiciones, r.resumen.cajas, r.resumen.unidades, r.resumen.productos, r.resumen.deSap], [4, 13, 492, 2, 2]);
  assert.deepEqual(r.masSeReponen[0], { itemCode: "A", itemName: "Shampoo", codigo: null, veces: 3, cajas: 12, unidades: 480, cajasPorVez: 4,
    cadaDias: 6, ultima: h("2026-10-13T16:00:00Z") });
  assert.deepEqual(r.reponerPronto.map((p) => [p.itemCode, p.alcanzaDias, p.cajasEnGrande, p.loteVencePrimero.lote]), [["A", 0, 14, "L2409"]]);
  assert.deepEqual(r.porSemana.filter((s) => s.sap + s.mano > 0).map((s) => [s.numero, s.sap, s.mano]), [[40, 1, 0], [41, 1, 0], [42, 0, 2]]);
  assert.equal(armarReposiciones({ ...args, como: "sap" }).resumen.reposiciones, 2);
});

test("correcciones: conteos, lotes, anuladas y códigos, filtrados por tipo y persona", () => {
  const registrados = [
    { entidad: "conteo", persona: "Sup", creadoEn: h("2026-10-13T15:12:00Z"),
      detalle: JSON.stringify({ itemCode: "C", bodega: "grande", antes: "12 cajas × 12 · L330", ahora: "11 cajas × 12 · L330", unidades: -12 }) },
    { entidad: "conteo", persona: "Sup", creadoEn: h("2026-10-11T17:05:00Z"),
      detalle: JSON.stringify({ itemCode: "C", bodega: "grande", antes: "13 cajas × 12", ahora: "12 cajas × 12 · L330", unidades: -12 }) },
    { entidad: "codigo", persona: "Ana", creadoEn: h("2026-10-08T16:02:00Z"), detalle: JSON.stringify({ clase: "caja", codigo: "17401", itemCode: "K" }) },
    { entidad: "preparacion", persona: "Sup", creadoEn: h("2026-10-12T23:40:00Z"), detalle: JSON.stringify({ pickingId: 9 }) },
  ];
  const descuentos = [{ itemCode: "B", unidades: 24, corregidoPor: "operador:Sup", corregidoEn: h("2026-10-09T22:22:00Z"), anterior: "B765: 24", actual: "B771: 24" },
    { itemCode: "B", unidades: 12, corregidoPor: "operador:Sup", corregidoEn: h("2026-10-09T22:18:00Z"), anterior: "B765: 12", actual: "B771: 12" }];
  const anuladas = [{ id: 9, operador: "Beto", fechaFin: h("2026-10-12T23:40:00Z"), fuente: "traslado", docNum: 2231, almacenDestino: "V03", lecturas: 120, persona: "Sup" }];
  const base = { registrados, antiguas: [{ itemCode: "G", cantidad: -6, registrado: 34, persona: "Sup", creadoEn: h("2026-10-07T21:31:00Z") }],
    descuentos, anuladas, nombres: new Map([["C", "Crema 1 L"], ["B", "Tinte 3"], ["K", "Kit"], ["G", "Gel"]]) };
  const r = armarCorrecciones(base);
  assert.deepEqual(r.resumen, { todos: 7, conteo: 3, unidadesConteo: -30, lote: 2, anulada: 1, codigo: 1 });
  assert.deepEqual(r.cambios.map((c) => c.tipo), ["conteo", "anulada", "conteo", "lote", "lote", "codigo", "conteo"]);
  assert.deepEqual(r.cambios[1], { tipo: "anulada", fecha: h("2026-10-12T23:40:00Z"), persona: "Sup", titulo: "Traslado 2231 · a la V03", pickingId: 9,
    detalle: "Cambió en SAP mientras se preparaba · Beto", antes: "120 lecturas", ahora: "Se vuelve a preparar" });
  assert.deepEqual(r.cambios.at(-1).antes, "40 u.");
  assert.deepEqual(r.destacados, ["El conteo de la 01 de Crema 1 L se editó 2 veces: conviene volver a contarlo.",
    "2 de los 2 cambios de lote fueron del mismo día (09/10)."]);
  assert.deepEqual(armarCorrecciones({ ...base, tipo: "lote" }).cambios.length, 2);
  assert.deepEqual(armarCorrecciones({ ...base, persona: "Ana" }).resumen.todos, 1);
});

test("pendientes: antigüedad desde el último cambio de SAP, por grupo y en la lista", () => {
  const pendientes = { porUbicar: [{ itemCode: "N", itemName: "Producto N", diferencia: 96 }, { itemCode: "C", itemName: "Crema", diferencia: 48 },
    { itemCode: "H", itemName: "Hoy", diferencia: 2 }],
  porDescontar: [{ itemCode: "G", itemName: "Gel", diferencia: -12 }], porPasar: [{ itemCode: "B", itemName: "Tinte", unidades: 60 }] };
  const cambios = new Map([["N", h("2026-10-04T14:30:00Z")], ["C", h("2026-10-05T20:10:00Z")], ["H", h("2026-10-13T15:00:00Z")],
    ["G", h("2026-10-09T22:00:00Z")], ["B", h("2026-10-08T16:45:00Z")]]);
  const r = armarPendientes({ pendientes, cambios, codigos: new Map(), minDias: 3, ahora: AHORA });
  assert.deepEqual(r.resumen.faltaGuardar, { total: 3, hoy: 1, unoADos: 0, tresASeis: 0, sieteOMas: 2, sinFecha: 0,
    masViejo: { itemCode: "N", itemName: "Producto N", dias: 9 } });
  assert.deepEqual(r.lista.map((p) => [p.clase, p.itemCode, p.dias]), [["faltaGuardar", "N", 9], ["faltaGuardar", "C", 8],
    ["traspasosPorAceptar", "B", 5], ["faltaMarcarSalida", "G", 4]]);
  assert.deepEqual(r.destacados.slice(0, 2), ["3 productos esperan Falta guardar; 2 llevan más de una semana: Producto N y Crema.",
    "El traspaso de Tinte está sin aceptar desde el jueves 8: hasta que se acepte, la 02 no cuadra."]);
});

test("actividad: lo que hizo cada persona en el día, con acciones por hora", () => {
  const r = armarActividad({ dia: "2026-10-13",
    preparaciones: [{ estado: "completo", operador: "Ana", fechaFin: h("2026-10-13T21:55:00Z"), fuente: "factura", docNum: 10461, preparadas: 24, pedidas: 24 },
      { estado: "anulada", operador: "Ana", fechaFin: h("2026-10-13T20:00:00Z"), fuente: "factura", docNum: 1, preparadas: 1, pedidas: 2 }],
    lecturasHora: [{ persona: "Ana", hora: 15, cantidad: 24, primera: h("2026-10-13T21:30:00Z"), ultima: h("2026-10-13T21:54:00Z") }],
    movimientos: [{ tipo: "traspaso", itemCode: "A", persona: "Ana", cajas: 4, creadoEn: h("2026-10-13T21:20:00Z") }],
    cuadres: [{ accion: "recepcion", primero: false, itemCode: "P", bodega: "grande", cantidad: 72, persona: "Ana", creadoEn: h("2026-10-13T17:40:00Z") },
      { accion: "recepcion", primero: true, itemCode: "C", bodega: "grande", cantidad: 132, persona: "Ana", creadoEn: h("2026-10-13T19:10:00Z") }],
    conteosAlmacen: [], descuentos: [], codigos: [{ clase: "caja", itemCode: "B", persona: "Ana", creadoEn: h("2026-10-13T16:05:00Z") }],
    cambios: [], nombres: new Map([["A", "Shampoo"], ["P", "Producto P"], ["C", "Crema"], ["B", "Tinte"]]), persona: "Ana" });
  assert.deepEqual(r.personas, [{ persona: "Ana", primera: h("2026-10-13T16:05:00Z"), ultima: h("2026-10-13T21:55:00Z"), preparaciones: 1, unidades: 24,
    recepciones: 1, productosContados: 1, reposiciones: 1, salidasMarcadas: 0, codigosRegistrados: 1 }]);
  assert.deepEqual(r.detalle.acciones.map((a) => [a.tipo, a.titulo]), [["preparacion", "Factura 10461"], ["reposicion", "Shampoo"],
    ["conteo", "Crema"], ["recepcion", "Producto P"], ["codigo", "Tinte"]]);
  assert.equal(r.detalle.porHora[15].cantidad, 25);
  assert.equal(armarActividad({ dia: "2026-10-13", preparaciones: [], lecturasHora: [], movimientos: [], cuadres: [], conteosAlmacen: [],
    descuentos: [], codigos: [], cambios: [], nombres: new Map(), persona: "Nadie" }).detalle, null);
});

test("texto de un conteo para el registro de cambios", () => {
  assert.equal(textoConteo([{ unidades: 12, lote: "L330" }, { unidades: 12, lote: "L330" }, { unidades: 5, lote: "L331", suelto: true }]),
    "2 cajas × 12 · L330 + 5 u. sueltas · L331");
  assert.equal(textoConteo([{ cajas: 3, unidadesPorCaja: 12, unidades: 36, lote: "A" }, { cajas: null, unidades: 4, lote: null }]), "3 cajas × 12 · A + 4 u. sueltas");
  assert.equal(textoConteo([]), "0 u.");
});

test("vencimientos: tramos, por mes, qué pasar primero y lo que no tiene fecha", () => {
  const f = (lugar, itemCode, lote, vencimiento, cajas, unidades, almacen = null) => ({ lugar, almacen, itemCode, itemName: `Producto ${itemCode}`,
    lote, vencimiento, cajas, unidades });
  const filas = [f("grande", "A", "L1", "2026-10-01", 2, 24), f("pequena", "B", "B1", "2026-10-20", 0, 6),
    f("grande", "C", "C1", "2026-11-10", 1, 12), f("pequena", "C", "C2", "2027-01-15", 0, 5), f("almacen", "D", "D1", "2026-12-31", 3, 36, "04")];
  const base = { filas, sinFecha: [{ lugar: "grande", almacen: null, productos: 2, unidades: 40 }], almacenes: { grande: "01", pequena: "02" },
    codigos: new Map([["A", "7401"]]), hoy: "2026-10-13" };
  const r = armarVencimientos(base);
  assert.deepEqual(r.resumen, { vencido: { lotes: 1, unidades: 24 }, en30: { lotes: 2, unidades: 18 }, en60: { lotes: 0, unidades: 0 },
    en90: { lotes: 1, unidades: 36 }, mas: { lotes: 1, unidades: 5 }, sinFecha: { productos: 2, unidades: 40 } });
  assert.deepEqual(r.vencidos.map((l) => [l.itemCode, l.almacen, l.dias, l.codigo]), [["A", "01", -12, "7401"]]);
  assert.deepEqual(r.porMes.map((m) => [m.mes, m.unidades]), [["vencido", 24], ["2026-10", 6], ["2026-11", 12], ["2026-12", 36], ["2027-01", 5]]);
  // C: la 01 tiene un lote que vence antes que el de la 02.
  assert.deepEqual(r.pasarPrimero, [{ itemCode: "C", itemName: "Producto C", loteGrande: "C1", venceGrande: "2026-11-10", lotePequena: "C2", vencePequena: "2027-01-15" }]);
  assert.equal(r.destacados[0], "Hay 1 lote vencido con 24 unidades: hay que sacarlo de la venta. La mayor parte está en la 01.");
  assert.equal(r.destacados[1], "Lo próximo en vencer: Producto B, lote B1, el 20/10/2026 (en 7 días) en la 02: 6 unidades.");
  const solo04 = armarVencimientos({ ...base, donde: "04" });
  assert.deepEqual([solo04.porVencer.map((l) => [l.itemCode, l.enCajas, l.cajas]), solo04.resumen.sinFecha.unidades], [[["D", true, 3]], 0]);
});
