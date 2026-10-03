// Inventario de la bodega: cajas por lote en la grande, unidades sueltas en la pequeña, y la diferencia con lo
// que SAP tiene en los almacenes de esta bodega. Nada se escribe en SAP.
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import { inventarioRepository as repo } from "./inventario.repository.js";
import { retirarLotes, contarLotes } from "./inventario.lotes.js";
import { clasificar, codigoCaja, porPasar, repartirEnCajas, cajaParaUsarAntes, textoAsignacion } from "./inventario.calculo.js";

const OPCION_FILTRAR_PEDIDOS = "pedidosSoloDeEstaBodega";
const OPCION_ALMACENES_POR_BODEGA = "almacenesPorBodega";
const falla = (code, statusCode, message) => new AppError({ code, statusCode, message });
const sinProducto = () => falla("PRODUCTO_NO_ENCONTRADO", 404, "Producto no encontrado");
const sinCaja = () => falla("CAJA_NO_ENCONTRADA", 404, "No hay una caja con ese código");
const numero = (n) => Number(n).toLocaleString("es-HN");
const fechaIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const DIAS_POR_VENCER = 60;
// Búsqueda en las listas: sin distinguir mayúsculas ni tildes ("serum" encuentra "Sérum").
const normalizar = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const coincide = (texto) => (v) => !texto || normalizar(v.itemCode).includes(texto) || normalizar(v.itemName).includes(texto);

async function exigirSaldoConciliado(itemCode, tx) {
  const saldo = await repo.estadoProducto(itemCode, tx);
  if (saldo && saldo.pequena < 0) throw falla("CONTEO_REQUERIDO", 409,
    `${itemCode}: hay un saldo negativo antiguo. El supervisor debe registrar el conteo por lote antes de mover mercancía.`);
}

function vistaEstado(f, ahora = Date.now(), comparacionDisponible = true) {
  if (!comparacionDisponible) return { itemCode: f.itemCode, itemName: f.itemName, activo: f.activo,
    grande: f.grande, pequena: f.pequena, sinEntrega: null, enSap: null, diferencia: null, faltaEnSap: null,
    estado: "sin_comparacion_sap" };
  const c = clasificar(f, ahora);
  return { itemCode: f.itemCode, itemName: f.itemName, activo: f.activo, grande: f.grande, pequena: f.pequena,
    sinEntrega: f.sinEntrega, enSap: c.enSap, diferencia: c.diferencia, faltaEnSap: c.faltaEnSap, estado: c.estado };
}
const vistaCaja = (c) => ({ id: c.id, codigo: c.codigo, itemCode: c.itemCode, itemName: c.producto?.itemName ?? c.itemName ?? undefined,
  lote: c.lote, vencimiento: fechaIso(c.vencimiento), suelto: c.suelto, unidadesIniciales: c.unidadesIniciales, unidades: c.unidades,
  abierta: c.unidades > 0 && c.unidades < c.unidadesIniciales, recibidaEn: c.recibidaEn, recibidaPor: c.recibidaPor });

async function exigirAlmacenes() {
  const almacenes = await repo.almacenesDeEstaBodega();
  if (!almacenes.length) throw falla("ALMACENES_SIN_ELEGIR", 409,
    "Falta elegir los almacenes de SAP de esta bodega (Panel del supervisor → Almacenes)");
  if (!(await repo.comparacionDisponible())) throw falla("COMPARACION_SAP_NO_DISPONIBLE", 409,
    "Faltan datos recientes de almacenes y existencias de SAP. El inventario local sigue disponible.");
  return almacenes;
}
async function estadoDe(itemCode, tx) {
  const [fila] = await repo.estados({ itemCodes: [itemCode] }, tx);
  if (!fila) throw sinProducto();
  return vistaEstado(fila);
}

// ---------- Consultas ----------

export async function resumenInventario() {
  const almacenes = await repo.almacenesDeEstaBodega();
  const comparacionDisponible = await repo.comparacionDisponible();
  const [bodegas, estados, porVencer, movimientos, existenciasSapAl, nombres] = await Promise.all([
    repo.resumenBodegas(), almacenes.length ? repo.estados() : [], repo.porVencer(60), repo.movimientos({ limite: 8 }),
    repo.existenciasSapAl(), bodegasConNombre(almacenes)]);
  const vistas = estados.map((f) => vistaEstado(f, Date.now(), comparacionDisponible));
  const contar = (estado) => vistas.filter((v) => v.estado === estado).length;
  const avance = async (bodega) => {
    if (!nombres[bodega]) return null;
    const filas = await repo.conteoBodega(bodega, nombres[bodega].almacen);
    return { total: filas.length, contados: filas.filter((f) => f.contado).length };
  };
  const [conteoGrande, conteoPequena, pases] = await Promise.all([avance("grande"), avance("pequena"),
    comparacionDisponible ? pasesPendientes() : []]);
  return { data: { almacenes, comparacionDisponible, existenciasSapAl, bodegas: nombres,
    conteo: { grande: conteoGrande, pequena: conteoPequena }, ...bodegas,
    pendientes: { porUbicar: contar("por_ubicar"), porDescontar: contar("por_descontar"), porPasar: pases.length, actualizando: contar("actualizando"),
      conteoInicial: contar("conteo_inicial"), faltaEnSap: vistas.filter((v) => v.faltaEnSap > 0).length },
    porVencer: { vencidos: porVencer.filter((l) => l.vencido).length, proximos: porVencer.filter((l) => !l.vencido).length },
    movimientos } };
}

export async function buscarProductos({ buscar, limit }) {
  return { data: await repo.buscarProductos(buscar, limit) };
}

export async function consultarProducto(itemCode) {
  const producto = await repo.producto(itemCode);
  if (!producto) throw sinProducto();
  const almacenes = await repo.almacenesDeEstaBodega();
  const comparacionDisponible = await repo.comparacionDisponible();
  const nombres = await bodegasConNombre(almacenes);
  const asignados = [nombres.grande?.almacen, nombres.pequena?.almacen].filter(Boolean);
  const [estado, cajas, movimientos, documentos, ultima, lotesPequena, sap, contado, pases] = await Promise.all([
    comparacionDisponible ? estadoDe(itemCode) : null, repo.cajasDe(itemCode), repo.movimientos({ itemCode, limite: 15 }),
    repo.documentosRecientes([itemCode], { dias: 60, porProducto: 8 }), repo.ultimaRecepcion(itemCode), repo.lotesPequena(itemCode),
    repo.sapDeProducto(itemCode, asignados), repo.contadoEn(itemCode), comparacionDisponible ? pasesPendientes([itemCode]) : []]);
  const sapDe = (bodega) => (nombres[bodega] ? Math.round(sap.get(nombres[bodega].almacen) ?? 0) : null);
  // Bodega grande agrupada por lote (y vencimiento), con sus cajas.
  const lotes = new Map();
  for (const c of cajas) {
    const clave = `${c.lote ?? ""}|${fechaIso(c.vencimiento) ?? ""}`;
    if (!lotes.has(clave)) lotes.set(clave, { lote: c.lote, vencimiento: fechaIso(c.vencimiento), cerradas: 0, abiertas: 0, unidades: 0, cajas: [] });
    const l = lotes.get(clave);
    if (c.unidades < c.unidadesIniciales) l.abiertas += 1; else l.cerradas += 1;
    l.unidades += c.unidades; l.cajas.push(vistaCaja(c));
  }
  return { data: {
    itemCode: producto.itemCode, itemName: producto.itemName, almacenes, comparacionDisponible, estado,
    pequena: producto.inventario?.pequena ?? 0, enInventario: Boolean(producto.inventario),
    codigos: producto.codigosBarras.map((c) => ({ id: c.id, codigo: c.codigo, origen: c.origen, confirmado: c.confirmacionPicking?.esUnidadIndividual === true })),
    lotes: [...lotes.values()], lotesPequena, movimientos, documentos,
    sugerencia: ultima ? { unidadesPorCaja: ultima.unidadesIniciales } : null,
    bodegas: nombres, sapPorBodega: { grande: sapDe("grande"), pequena: sapDe("pequena") },
    contadoEn: { grande: contado.has("grande") || cajas.length > 0, pequena: contado.has("pequena") || (producto.inventario?.pequena ?? 0) !== 0 },
    porPasar: pases[0]?.unidades ?? 0,
  } };
}

export async function listarPendientes() {
  await exigirAlmacenes();
  const vistas = (await repo.estados()).map((f) => vistaEstado(f));
  const de = (estado) => vistas.filter((v) => v.estado === estado);
  const porUbicar = de("por_ubicar"), porDescontar = de("por_descontar");
  const documentos = await repo.documentosRecientes([...porUbicar, ...porDescontar].map((v) => v.itemCode), { dias: 30, porProducto: 3 });
  const docs = (itemCode) => documentos.filter((d) => d.itemCode === itemCode);
  const inicial = de("conteo_inicial");
  return { data: {
    porUbicar: porUbicar.map((v) => ({ ...v, documentos: docs(v.itemCode) })),
    porPasar: await pasesPendientes(),
    porDescontar: porDescontar.map((v) => ({ ...v, documentos: docs(v.itemCode) })),
    actualizando: de("actualizando"),
    faltaEnSap: vistas.filter((v) => v.faltaEnSap > 0),
    conteoInicial: { productos: inicial.length, unidades: inicial.reduce((t, v) => t + v.diferencia, 0) },
  } };
}

// Productos que todavía no entraron al inventario y SAP dice que hay: la lista del conteo inicial.
export async function listarConteoInicial({ buscar, pagina, limit }) {
  await exigirAlmacenes();
  const texto = buscar ? normalizar(buscar) : null;
  const todos = (await repo.estados()).map((f) => vistaEstado(f)).filter((v) => v.estado === "conteo_inicial")
    .filter(coincide(texto));
  return { data: todos.slice(pagina * limit, (pagina + 1) * limit), total: todos.length };
}

// Todos los productos de las bodegas: los registrados en la grande o la pequeña y los que SAP tiene en los almacenes
// de esta bodega. Lo de SAP va con la fecha en que llegó; el estado frente a SAP, solo con comparación disponible.
const FILTRAR = {
  todos: () => true,
  grande: (v) => v.grande > 0,
  pequena: (v) => v.pequena !== 0,
  // Falta contar: SAP lo tiene y todavía no se contó en ninguna bodega (un "no hay" ya cuenta como contado).
  solo_sap: (v) => !v.activo && v.grande === 0 && v.pequena === 0 && v.sap > 0,
  diferencia: (v) => v.estado === "por_ubicar" || v.estado === "por_descontar",
  por_vencer: (v) => v.porVencer === true,
};
export async function listarExistencias({ buscar, filtro, pagina, limit }) {
  const [almacenes, comparacionDisponible, existenciasSapAl, filas, lotesPorVencer] = await Promise.all([
    repo.almacenesDeEstaBodega(), repo.comparacionDisponible(), repo.existenciasSapAl(), repo.estados(), repo.porVencer(DIAS_POR_VENCER)]);
  const vencen = new Set(lotesPorVencer.map((l) => l.itemCode));
  const conSap = almacenes.length > 0;
  const texto = buscar ? normalizar(buscar) : null;
  const vistas = filas.map((f) => {
    const e = conSap && comparacionDisponible ? vistaEstado(f) : null;
    return { itemCode: f.itemCode, itemName: f.itemName, grande: f.grande, cajas: f.cajas ?? 0, pequena: f.pequena,
      sinEntrega: f.sinEntrega, sap: conSap ? Math.round(f.sap ?? 0) : null, estado: e?.estado ?? null, diferencia: e?.diferencia ?? null,
      porVencer: vencen.has(f.itemCode), activo: f.activo === true };
  }).filter((v) => v.grande !== 0 || v.pequena !== 0 || v.sinEntrega !== 0 || (v.sap ?? 0) !== 0)
    .filter(coincide(texto));
  const conteos = Object.fromEntries(Object.entries(FILTRAR).map(([nombre, cumple]) => [nombre, vistas.filter(cumple).length]));
  const elegidas = vistas.filter(FILTRAR[filtro]);
  return { data: elegidas.slice(pagina * limit, (pagina + 1) * limit).map(({ activo, ...v }) => v), total: elegidas.length, conteos,
    almacenes, comparacionDisponible, existenciasSapAl };
}

export async function consultarCaja(codigo) {
  const caja = await repo.cajaPorCodigo(codigo);
  if (!caja) throw sinCaja();
  const otras = await repo.cajasDe(caja.itemCode);
  const antes = cajaParaUsarAntes(caja, otras);
  const producto = await repo.producto(caja.itemCode);
  return { data: { ...vistaCaja(caja), pequena: producto?.inventario?.pequena ?? 0,
    usarAntes: antes ? vistaCaja(antes) : null } };
}

export async function listarPorVencer({ dias }) {
  const lotes = await repo.porVencer(dias);
  return { data: lotes.map((l) => ({ ...l, vencimiento: fechaIso(l.vencimiento) })) };
}

export async function listarMovimientos({ itemCode, antesDe, limit }) {
  const filas = await repo.movimientos({ itemCode, antesDe, limite: limit + 1 });
  const data = filas.slice(0, limit);
  return { data, siguienteCursor: filas.length > limit ? data.at(-1).id : null };
}

// Asignación vigente de un descuento: lo que hoy está restado de cada caja o de la pequeña.
function asignacionDe(movimientos) {
  const netos = new Map();
  for (const m of movimientos) {
    const clave = m.bodega === "pequena" ? `pequena:${m.pequenaLoteId ?? "antiguo"}` : `caja:${m.cajaId}`;
    const actual = netos.get(clave) ?? { tipo: m.bodega === "pequena" ? "pequena" : "lote", lote: m.lote, pequenaLoteId: m.pequenaLoteId, cajaId: m.cajaId, codigo: m.caja?.codigo ?? null, unidades: 0 };
    actual.unidades -= m.cantidad;
    netos.set(clave, actual);
  }
  return [...netos.values()].filter((a) => a.unidades > 0);
}
function resumirAsignacion(asignacion) {
  const porLote = new Map();
  for (const a of asignacion) {
    const clave = a.tipo === "pequena" ? "pequena" : `lote:${a.lote ?? ""}`;
    const actual = porLote.get(clave) ?? { tipo: a.tipo, lote: a.tipo === "pequena" ? null : a.lote, unidades: 0, cajas: [], lotesPequena: [] };
    actual.unidades += a.unidades;
    if (a.codigo) actual.cajas.push(a.codigo);
    if (a.tipo === "pequena") actual.lotesPequena.push({ pequenaLoteId: a.pequenaLoteId ?? null, lote: a.lote ?? null, unidades: a.unidades });
    porLote.set(clave, actual);
  }
  return [...porLote.values()];
}

export async function listarDescuentos({ antesDe, limit }) {
  const filas = await repo.descuentos({ antesDe, limite: limit + 1 });
  const nombres = new Map((await Promise.all([...new Set(filas.map((d) => d.itemCode))].map((i) => repo.producto(i))))
    .filter(Boolean).map((p) => [p.itemCode, p.itemName]));
  const data = filas.slice(0, limit).map((d) => ({ id: d.id, itemCode: d.itemCode, itemName: nombres.get(d.itemCode) ?? null,
    unidades: d.unidades, documentos: d.documentos, hechoPor: d.hechoPor, creadoEn: d.creadoEn,
    corregidoPor: d.corregidoPor, corregidoEn: d.corregidoEn, anterior: d.anterior,
    asignacion: resumirAsignacion(asignacionDe(d.movimientos)) }));
  return { data, siguienteCursor: filas.length > limit ? data.at(-1).id : null };
}

// ---------- Movimientos ----------

// Mercadería que entra: en cajas a la grande, o suelta a la grande (un bulto) o a la pequeña. Si supera lo que
// SAP tiene por ubicar, solo se acepta confirmando que llegó antes que SAP la registre ("adelantado").
// Cajas a crear en la grande: { unidades, lote, vencimiento, suelto }. Vacío si va a la pequeña.
function piezasRecepcion(entrada) {
  const { modo, lote = null, vencimiento = null } = entrada;
  if (modo === "lotes") return [];
  const repetir = (n, pieza) => Array.from({ length: n }, () => ({ ...pieza }));
  if (modo === "cajas") return repetir(entrada.cajas, { unidades: entrada.unidadesPorCaja, lote, vencimiento, suelto: false });
  if (modo === "suelto") return entrada.destino === "grande" ? [{ unidades: entrada.unidades, lote, vencimiento, suelto: true }] : [];
  const piezas = entrada.grupos.flatMap((g) => repetir(g.cajas, { unidades: g.unidadesPorCaja, lote: g.lote ?? null,
    vencimiento: g.vencimiento ?? null, suelto: false }));
  const b = entrada.bulto;
  return b ? [...piezas, { unidades: b.unidades, lote: b.lote ?? null, vencimiento: b.vencimiento ?? null, suelto: true }] : piezas;
}

export async function recibir(entrada, { aplicacion }) {
  const { itemCode, modo, lote = null, vencimiento = null, adelantar = false } = entrada;
  const destino = modo === "suelto" ? entrada.destino : modo === "lotes" ? "pequena" : "grande";
  const piezas = piezasRecepcion(entrada);
  // A la pequeña: un solo lote (suelto) o varios (lotes).
  const lotesPequena = modo === "lotes" ? entrada.lotes.map((l) => ({ unidades: l.unidades, lote: l.lote ?? null, vencimiento: l.vencimiento ?? null }))
    : [{ unidades: entrada.unidades, lote, vencimiento }];
  const total = destino === "grande" ? piezas.reduce((t, p) => t + p.unidades, 0) : lotesPequena.reduce((t, l) => t + l.unidades, 0);
  return repo.conProducto(itemCode, async (tx) => {
    const estado = await estadoDe(itemCode, tx);
    const comparacionDisponible = await repo.comparacionDisponible(tx);
    const porUbicar = comparacionDisponible ? Math.max(0, estado.diferencia) : total;
    const excede = total - porUbicar;
    if (excede > 0 && !adelantar) throw falla("EXCEDE_POR_UBICAR", 409, porUbicar === 0
      ? `SAP todavía no registró mercadería por ubicar de este producto. Si llegó antes que SAP, confirmá que se reciba igual.`
      : `SAP tiene ${numero(porUbicar)} por ubicar y estás recibiendo ${numero(total)}. Si llegó más de lo que SAP registró, confirmá que se reciba igual.`);
    await repo.activar(itemCode, tx);
    if (excede > 0) await repo.sumarAdelantado(itemCode, excede, tx);
    const g = randomUUID();
    let creadas = [];
    if (destino === "grande") {
      const ids = await repo.reservarIdsCajas(piezas.length, tx);
      const ahora = new Date();
      creadas = ids.map(({ id }, i) => ({ id, codigo: codigoCaja(id), itemCode, lote: piezas[i].lote, suelto: piezas[i].suelto,
        vencimiento: piezas[i].vencimiento ? new Date(`${piezas[i].vencimiento}T00:00:00.000Z`) : null,
        unidadesIniciales: piezas[i].unidades, unidades: piezas[i].unidades, recibidaEn: ahora, recibidaPor: aplicacion }));
      await repo.crearCajas(creadas, tx);
      await repo.registrarMovimientos(creadas.map((c) => ({ grupo: g, tipo: "recepcion", itemCode, bodega: "grande", cantidad: c.unidades,
        cajaId: c.id, lote: c.lote, hechoPor: aplicacion, observacion: excede > 0 ? "Recibido antes que SAP" : null })), tx);
    } else {
      await exigirSaldoConciliado(itemCode, tx);
      const movimientos = [];
      for (const l of lotesPequena) {
        const saldo = await repo.sumarLotePequena(itemCode, l.lote, l.vencimiento, l.unidades, tx);
        movimientos.push({ grupo: g, tipo: "recepcion", itemCode, bodega: "pequena", cantidad: l.unidades, lote: l.lote,
          pequenaLoteId: saldo.id, hechoPor: aplicacion, observacion: excede > 0 ? "Recibido antes que SAP" : null });
      }
      await repo.cambiarPequena(itemCode, total, tx);
      await repo.registrarMovimientos(movimientos, tx);
    }
    return { data: { cajas: creadas.map(vistaCaja), unidades: total, destino, adelantado: Math.max(0, excede) } };
  }, { operacionId: entrada.operacionId, tipo: "recibir", entrada, aplicacion });
}

// De una caja de la grande a la pequeña.
export async function reponer(entrada, { aplicacion }) {
  const { caja: codigo, unidades } = entrada;
  const caja = await repo.cajaPorCodigo(codigo);
  if (!caja) throw sinCaja();
  return repo.conProducto(caja.itemCode, async (tx) => {
    const actual = await repo.cajaBloqueada(caja.id, tx);
    await exigirSaldoConciliado(caja.itemCode, tx);
    if (unidades > actual.unidades) throw falla("CAJA_INSUFICIENTE", 409, `La caja ${codigo} tiene ${numero(actual.unidades)} unidades`);
    await repo.activar(caja.itemCode, tx);
    await repo.cambiarUnidadesCaja(caja.id, -unidades, tx);
    const saldo = await repo.sumarLotePequena(caja.itemCode, actual.lote, actual.vencimiento, unidades, tx);
    await repo.cambiarPequena(caja.itemCode, unidades, tx);
    const g = randomUUID();
    await repo.registrarMovimientos([
      { grupo: g, tipo: "reposicion", itemCode: caja.itemCode, bodega: "grande", cantidad: -unidades, cajaId: caja.id, lote: caja.lote, hechoPor: aplicacion },
      { grupo: g, tipo: "reposicion", itemCode: caja.itemCode, bodega: "pequena", cantidad: unidades, cajaId: caja.id, lote: actual.lote, pequenaLoteId: saldo.id, hechoPor: aplicacion },
    ], tx);
    const estado = await repo.estadoProducto(caja.itemCode, tx);
    return { data: { caja: vistaCaja({ ...actual, unidades: actual.unidades - unidades }), pequena: estado.pequena } };
  }, { operacionId: entrada.operacionId, tipo: "reponer", entrada, aplicacion });
}

// Resta las unidades asignadas (de cajas de un lote o de la pequeña) dentro de la transacción del producto.
async function aplicarAsignaciones(itemCode, asignaciones, { tipo, grupo, descuentoId, hechoPor }, tx) {
  const movimientos = [], retirar = [];
  for (const a of asignaciones) {
    if (a.tipo === "pequena") {
      const estado = await repo.estadoProducto(itemCode, tx);
      if ((estado?.pequena ?? 0) < a.unidades) throw falla("PEQUENA_INSUFICIENTE", 409,
        `La bodega pequeña tiene ${numero(estado?.pequena ?? 0)} unidades de este producto`);
      const partes = await retirarLotes(itemCode, a.unidades, a.lotes, tx);
      await repo.cambiarPequena(itemCode, -a.unidades, tx);
      movimientos.push(...partes.map(p => ({ grupo, tipo, itemCode, bodega: "pequena", ...p, descuentoId, hechoPor })));
      continue;
    }
    const cajas = await repo.cajasDeLoteBloqueadas(itemCode, a.lote ?? null, tx);
    const reparto = repartirEnCajas(cajas, a.unidades);
    for (const r of reparto) {
      await repo.cambiarUnidadesCaja(r.cajaId, -r.unidades, tx);
      movimientos.push({ grupo, tipo, itemCode, bodega: "grande", cantidad: -r.unidades, cajaId: r.cajaId, lote: a.lote ?? null, descuentoId, hechoPor });
      retirar.push({ codigo: r.codigo, unidades: r.unidades, lote: a.lote ?? null });
    }
  }
  await repo.registrarMovimientos(movimientos, tx);
  return retirar;
}
const sumar = (asignaciones) => asignaciones.reduce((t, a) => t + a.unidades, 0);

// SAP descontó y la bodega elige de qué lotes (o de la pequeña) salió. Solo con la diferencia estable y exacta.
export async function descontar(entrada, { aplicacion }) {
  const { itemCode, unidades, asignaciones } = entrada;
  if (sumar(asignaciones) !== unidades) throw falla("ASIGNACION_INCOMPLETA", 400, `Hay que asignar exactamente ${numero(unidades)} unidades`);
  return repo.conProducto(itemCode, async (tx) => {
    await exigirAlmacenes();
    const estado = await estadoDe(itemCode, tx);
    if (estado.estado === "actualizando") throw falla("SAP_ACTUALIZANDO", 409, "SAP se está actualizando para este producto. Probá en unos minutos.");
    if (estado.diferencia >= 0 || -estado.diferencia !== unidades) throw falla("CANTIDAD_CAMBIO", 409,
      estado.diferencia >= 0 ? "Ya no hay nada por descontar de este producto" : `Ahora hay ${numero(-estado.diferencia)} por descontar (antes ${numero(unidades)}). Revisá y volvé a intentar.`);
    const documentos = (await repo.documentosRecientes([itemCode], { dias: 14, porProducto: 3 }, tx))
      .filter((d) => d.tipo === "salidaInventario" || d.tipo === "devolucionProveedor")
      .map((d) => `${d.tipo === "salidaInventario" ? "Salida de mercancías" : "Devolución al proveedor"} ${d.docNum}`).join(", ") || null;
    const descuento = await repo.crearDescuento({ itemCode, unidades, documentos, hechoPor: aplicacion }, tx);
    const retirar = await aplicarAsignaciones(itemCode, asignaciones, { tipo: "descuento", grupo: randomUUID(), descuentoId: descuento.id, hechoPor: aplicacion }, tx);
    return { data: { id: descuento.id, unidades, retirar } };
  }, { operacionId: entrada.operacionId, tipo: "descontar", entrada, aplicacion });
}

// "Cambiar lote": devuelve lo restado a sus cajas (o a la pequeña) y lo resta según la nueva elección.
export async function reasignarDescuento(id, entrada, { aplicacion }) {
  const { asignaciones } = entrada;
  const previo = await repo.descuento(id);
  if (!previo) throw falla("DESCUENTO_NO_ENCONTRADO", 404, "Descuento no encontrado");
  if (sumar(asignaciones) !== previo.unidades) throw falla("ASIGNACION_INCOMPLETA", 400, `Hay que asignar exactamente ${numero(previo.unidades)} unidades`);
  return repo.conProducto(previo.itemCode, async (tx) => {
    const descuento = await repo.descuento(id, tx);
    const actual = asignacionDe(descuento.movimientos);
    const g = randomUUID();
    const devolver = [];
    for (const a of actual) {
      if (a.tipo === "pequena") {
        if (!a.pequenaLoteId) throw falla("DESCUENTO_SIN_LOTE", 409, "Este descuento antiguo no identifica el lote. Requiere conciliación antes de reasignarlo.");
        const saldo = await repo.cambiarLotePequena(a.pequenaLoteId, descuento.itemCode, a.unidades, tx);
        if (!saldo) throw falla("LOTE_NO_ENCONTRADO", 409, "No se encontró el lote original del descuento.");
        await repo.cambiarPequena(descuento.itemCode, a.unidades, tx);
      }
      else await repo.cambiarUnidadesCaja(a.cajaId, a.unidades, tx);
      devolver.push({ grupo: g, tipo: "reasignacion", itemCode: descuento.itemCode, bodega: a.tipo === "pequena" ? "pequena" : "grande",
        cantidad: a.unidades, cajaId: a.cajaId ?? null, pequenaLoteId: a.pequenaLoteId ?? null, lote: a.lote ?? null, descuentoId: id, hechoPor: aplicacion, observacion: "Devuelto al cambiar el lote" });
    }
    await repo.registrarMovimientos(devolver, tx);
    const retirar = await aplicarAsignaciones(descuento.itemCode, asignaciones, { tipo: "reasignacion", grupo: g, descuentoId: id, hechoPor: aplicacion }, tx);
    await repo.corregirDescuento(id, { corregidoPor: aplicacion, corregidoEn: new Date(),
      anterior: textoAsignacion(resumirAsignacion(actual)) }, tx);
    return { data: { id, retirar } };
  }, { operacionId: entrada.operacionId, tipo: "reasignarDescuento", entrada, aplicacion, id });
}

// Conteo de la bodega pequeña (supervisor): deja el número contado.
export async function contarPequena(itemCode, entrada, { aplicacion }) {
  const { unidades } = entrada;
  return repo.conProducto(itemCode, async (tx) => {
    await estadoDe(itemCode, tx);
    await repo.activar(itemCode, tx);
    const estado = await repo.estadoProducto(itemCode, tx);
    const delta = unidades - estado.pequena;
    const partes = await contarLotes(itemCode, unidades, entrada.lotes, tx);
    if (delta !== 0) {
      await repo.cambiarPequena(itemCode, delta, tx);
    }
    const grupo = randomUUID();
    const movimientos = partes.map(p => ({ grupo, tipo: "conteo", itemCode, bodega: "pequena", ...p,
      hechoPor: aplicacion, observacion: `Contado: ${unidades}` }));
    if (estado.pequena < 0) movimientos.push({ grupo, tipo: "conteo", itemCode, bodega: "pequena",
      cantidad: -estado.pequena, hechoPor: aplicacion, observacion: "Conciliación del saldo negativo anterior al control por lotes" });
    await repo.registrarMovimientos(movimientos, tx);
    return { data: { itemCode, pequena: unidades, cambio: delta } };
  }, { operacionId: entrada.operacionId, tipo: "contarPequena", entrada, aplicacion, itemCode });
}

// Corrección de una caja (supervisor): deja las unidades que realmente tiene.
export async function corregirCaja(id, entrada, { aplicacion }) {
  const { unidades } = entrada;
  const caja = await repo.cajaPorId(id);
  if (!caja) throw sinCaja();
  return repo.conProducto(caja.itemCode, async (tx) => {
    const actual = await repo.cajaBloqueada(id, tx);
    const delta = unidades - actual.unidades;
    if (delta !== 0) {
      await repo.fijarUnidadesCaja(id, unidades, tx);
      await repo.registrarMovimientos([{ grupo: randomUUID(), tipo: "correccion", itemCode: caja.itemCode, bodega: "grande", cantidad: delta,
        cajaId: id, lote: caja.lote, hechoPor: aplicacion, observacion: `Caja con ${unidades} unidades` }], tx);
    }
    return { data: vistaCaja({ ...actual, unidades }) };
  }, { operacionId: entrada.operacionId, tipo: "corregirCaja", entrada, aplicacion, id });
}

// Al finalizar: exigir existencias físicas registradas y descontar los lotes elegidos en la misma transacción.
export async function descontarPorPicking({ pickingId, lineas, lotes = [], hechoPor = null }, tx) {
  const porProducto = new Map();
  for (const l of lineas) {
    const unidades = l.cantidadEscaneada ?? 0;
    if (!Number.isSafeInteger(unidades) || unidades < 0) throw falla("CANTIDAD_INVALIDA", 409, "El despacho requiere unidades individuales enteras.");
    if (unidades > 0) porProducto.set(l.itemCode, (porProducto.get(l.itemCode) ?? 0) + unidades);
  }
  const itemCodes = [...porProducto.keys()].sort();
  if (new Set(lotes.map(l => l.itemCode)).size !== lotes.length || lotes.some(l => !porProducto.has(l.itemCode))) {
    throw falla("ASIGNACION_LOTES_INVALIDA", 409, "La selección contiene productos repetidos o no escaneados.");
  }
  if (!porProducto.size) return [];
  await repo.bloquearProductos(itemCodes, tx);
  const movimientos = [];
  // Revisar todos antes de descontar el primero.
  for (const itemCode of itemCodes) {
    const estado = await repo.estadoProducto(itemCode, tx);
    const unidades = porProducto.get(itemCode);
    if ((estado?.pequena ?? 0) < unidades) throw falla("PEQUENA_INSUFICIENTE", 409,
      `${itemCode}: hay ${numero(estado?.pequena ?? 0)} unidades en la pequeña y se necesitan ${numero(unidades)}. Primero registrá la reposición desde la grande.`);
  }
  for (const itemCode of itemCodes) {
    const unidades = porProducto.get(itemCode);
    const partes = await retirarLotes(itemCode, unidades, lotes.find(l => l.itemCode === itemCode)?.lotes, tx);
    await repo.cambiarPequena(itemCode, -unidades, tx);
    movimientos.push(...partes.map(p => ({ grupo: `picking-${pickingId}-${itemCode}`, tipo: "picking", itemCode, bodega: "pequena", ...p, pickingId, hechoPor })));
  }
  await repo.registrarMovimientos(movimientos, tx);
  return movimientos;
}

// ---------- Almacenes de esta bodega (supervisor) ----------

// Qué almacén de SAP es cada bodega. Solo vale si el almacén sigue marcado como de esta bodega.
async function almacenesPorBodega(marcados = null) {
  const [guardado, vigentes] = await Promise.all([repo.opcion(OPCION_ALMACENES_POR_BODEGA),
    marcados ?? repo.almacenesDeEstaBodega()]);
  const vale = (codigo) => (typeof codigo === "string" && vigentes.includes(codigo) ? codigo : null);
  return { grande: vale(guardado?.grande), pequena: vale(guardado?.pequena) };
}

// Cada bodega con su almacén de SAP y el nombre que tiene en SAP ("01 · Almacén Principal"), o null sin asignar.
async function bodegasConNombre(marcados = null) {
  const porBodega = await almacenesPorBodega(marcados);
  const nombres = await repo.nombresDeAlmacenes([porBodega.grande, porBodega.pequena].filter(Boolean));
  const de = (codigo) => (codigo ? { almacen: codigo, nombre: nombres.get(codigo) ?? codigo } : null);
  return { grande: de(porBodega.grande), pequena: de(porBodega.pequena) };
}

// Traspasos de la 01 a la 02 que SAP ya registró y falta marcar en la bodega (qué cajas se pasaron). Hace falta que
// cada bodega tenga su almacén; quien llama se fija antes en que la comparación con SAP esté disponible.
async function pasesPendientes(itemCodes = null) {
  const porBodega = await almacenesPorBodega();
  if (!porBodega.grande || !porBodega.pequena) return [];
  const filas = await repo.pases(porBodega.grande, porBodega.pequena, { itemCodes });
  return filas.map((f) => ({ itemCode: f.itemCode, itemName: f.itemName, unidades: porPasar(f), cajas: f.cajas,
    sapGrande: Math.round(f.sapGrande), sapPequena: Math.round(f.sapPequena), grande: f.grande, pequena: f.pequena }))
    .filter((v) => v.unidades > 0);
}

export async function listarAlmacenes() {
  const [almacenes, filtrar] = await Promise.all([repo.almacenes(), repo.opcion(OPCION_FILTRAR_PEDIDOS)]);
  const porBodega = await almacenesPorBodega(almacenes.filter((a) => a.deEstaBodega).map((a) => a.warehouseCode));
  return { data: { almacenes, pedidosSoloDeEstaBodega: filtrar === true, almacenGrande: porBodega.grande, almacenPequena: porBodega.pequena } };
}

export async function elegirAlmacenes({ almacenes, pedidosSoloDeEstaBodega, almacenGrande, almacenPequena }, { aplicacion }) {
  const conocidos = new Set((await repo.almacenes()).map((a) => a.warehouseCode));
  const desconocidos = almacenes.filter((c) => !conocidos.has(c));
  if (desconocidos.length) throw falla("ALMACEN_DESCONOCIDO", 400, `Almacén desconocido: ${desconocidos.join(", ")}`);
  for (const [codigo, bodega] of [[almacenGrande, "grande"], [almacenPequena, "pequeña"]]) {
    if (codigo && !almacenes.includes(codigo)) throw falla("ALMACEN_NO_MARCADO", 400, `El almacén de la bodega ${bodega} (${codigo}) tiene que estar marcado`);
  }
  if (almacenGrande && almacenGrande === almacenPequena) throw falla("ALMACEN_REPETIDO", 400, "La bodega grande y la pequeña tienen que ser almacenes distintos");
  // Lo que no se envía queda como estaba, salvo que ese almacén se haya desmarcado.
  const anterior = await repo.opcion(OPCION_ALMACENES_POR_BODEGA);
  const elegir = (nuevo, previo) => { const c = nuevo !== undefined ? nuevo : previo ?? null; return c && almacenes.includes(c) ? c : null; };
  const porBodega = { grande: elegir(almacenGrande, anterior?.grande), pequena: elegir(almacenPequena, anterior?.pequena) };
  if (porBodega.grande && porBodega.grande === porBodega.pequena) porBodega.pequena = null;
  await repo.transaccion(async (tx) => {
    await repo.marcarAlmacenes(almacenes, tx);
    await repo.guardarOpcion(OPCION_FILTRAR_PEDIDOS, pedidosSoloDeEstaBodega, aplicacion, tx);
    await repo.guardarOpcion(OPCION_ALMACENES_POR_BODEGA, porBodega, aplicacion, tx);
  });
  return listarAlmacenes();
}

// Almacenes de SAP para elegir cuál ver: los marcados primero, después los que tienen existencia. Dice qué bodega es
// cada uno, si está asignado.
export async function listarAlmacenesSap() {
  const almacenes = await repo.almacenes();
  const porBodega = await almacenesPorBodega(almacenes.filter((a) => a.deEstaBodega).map((a) => a.warehouseCode));
  const bodega = (codigo) => (codigo === porBodega.grande ? "grande" : codigo === porBodega.pequena ? "pequena" : null);
  return { data: almacenes.filter((a) => a.deEstaBodega || a.productos > 0).map((a) => ({ warehouseCode: a.warehouseCode,
    warehouseName: a.warehouseName, inactive: a.inactive, deEstaBodega: a.deEstaBodega, bodega: bodega(a.warehouseCode),
    productos: a.productos, unidades: a.unidades })) };
}

// Los productos que SAP tiene en un almacén: en stock, comprometido (en pedidos), pedido (a proveedores) y disponible.
export async function listarProductosDeAlmacen(codigo, { buscar, pagina, limit }) {
  const { data: almacenes } = await listarAlmacenesSap();
  const almacen = almacenes.find((a) => a.warehouseCode === codigo)
    ?? (await repo.almacenes()).find((a) => a.warehouseCode === codigo);
  if (!almacen) throw falla("ALMACEN_DESCONOCIDO", 404, `Almacén desconocido: ${codigo}`);
  const [filas, existenciasSapAl] = await Promise.all([repo.productosDeAlmacen(codigo), repo.existenciasSapAl()]);
  const texto = buscar ? normalizar(buscar) : null;
  const redondo = (n) => Math.round((n ?? 0) * 1000) / 1000;
  const vistas = filas.map((f) => ({ itemCode: f.itemCode, itemName: f.itemName, enStock: redondo(f.enStock), comprometido: redondo(f.comprometido),
    pedido: redondo(f.pedido), disponible: redondo(f.enStock - f.comprometido + f.pedido) }));
  const resumen = { productos: vistas.filter((v) => v.enStock !== 0).length, unidades: redondo(vistas.reduce((t, v) => t + v.enStock, 0)) };
  const elegidas = vistas.filter(coincide(texto));
  return { data: elegidas.slice(pagina * limit, (pagina + 1) * limit), total: elegidas.length, resumen, existenciasSapAl,
    almacen: { warehouseCode: almacen.warehouseCode, warehouseName: almacen.warehouseName, deEstaBodega: almacen.deEstaBodega, bodega: almacen.bodega ?? null } };
}

// Lo que hay en la bodega grande o en la pequeña, producto por producto y lote por lote, con lo que SAP tiene en el
// almacén asignado a esa bodega (con la fecha de las existencias). Sin almacén asignado, sap es null.
export async function listarBodega(bodega, { buscar, filtro, pagina, limit }) {
  const porBodega = await almacenesPorBodega();
  const almacen = porBodega[bodega];
  const [filas, existenciasSapAl] = await Promise.all([repo.contenidoBodega(bodega, almacen), repo.existenciasSapAl()]);
  const texto = buscar ? normalizar(buscar) : null;
  const limite = Date.now() + DIAS_POR_VENCER * 86_400_000;
  const vistas = filas.map((f) => {
    const lotes = f.lotes.map((l) => ({ ...l, vencimiento: fechaIso(l.vencimiento) }));
    return { itemCode: f.itemCode, itemName: f.itemName, unidades: f.unidades, cajas: f.cajas, lotes, contado: f.contado === true,
      sap: almacen ? Math.round(f.sap ?? 0) : null, porVencer: lotes.some((l) => l.vencimiento && Date.parse(`${l.vencimiento}T00:00:00Z`) <= limite) };
  });
  const resumen = { productos: vistas.filter((v) => v.unidades !== 0).length, unidades: vistas.reduce((t, v) => t + v.unidades, 0),
    cajas: vistas.reduce((t, v) => t + v.cajas, 0) };
  const buscadas = vistas.filter(coincide(texto));
  const cumple = { todos: () => true, registrados: (v) => v.contado, sin_registrar: (v) => !v.contado && (v.sap ?? 0) > 0,
    por_vencer: (v) => v.porVencer };
  const conteos = Object.fromEntries(Object.entries(cumple).map(([nombre, f]) => [nombre, buscadas.filter(f).length]));
  const elegidas = buscadas.filter(cumple[filtro]);
  return { data: elegidas.slice(pagina * limit, (pagina + 1) * limit), total: elegidas.length, conteos, resumen,
    bodega, almacen, existenciasSapAl };
}

// Conteo de una bodega: los productos que SAP tiene en su almacén y si ya se contaron, con el avance.
export async function listarConteo(bodega, { buscar, estado, pagina, limit }) {
  const nombres = await bodegasConNombre();
  const asignada = nombres[bodega];
  if (!asignada) throw falla("BODEGA_SIN_ALMACEN", 409,
    `Falta elegir el almacén de SAP de la bodega ${bodega === "grande" ? "grande" : "pequeña"} (Panel del supervisor → Almacenes)`);
  const filas = await repo.conteoBodega(bodega, asignada.almacen);
  const vistas = filas.map((f) => ({ itemCode: f.itemCode, itemName: f.itemName, sap: Math.round(f.sap), unidades: f.unidades,
    cajas: f.cajas, contado: f.contado === true }));
  const texto = buscar ? normalizar(buscar) : null;
  const cumple = { falta: (v) => !v.contado, contados: (v) => v.contado, todos: () => true };
  const elegidas = vistas.filter(cumple[estado]).filter(coincide(texto));
  return { data: elegidas.slice(pagina * limit, (pagina + 1) * limit), total: elegidas.length, bodega, almacen: asignada,
    avance: { total: vistas.length, contados: vistas.filter((v) => v.contado).length } };
}

// "No hay" al contar: deja anotado que el producto se contó en esa bodega y no había ninguno.
export async function marcarSinExistencia(itemCode, entrada, { aplicacion }) {
  const { bodega } = entrada;
  return repo.conProducto(itemCode, async (tx) => {
    await estadoDe(itemCode, tx);
    const hay = bodega === "grande" ? (await repo.cajasDe(itemCode, {}, tx)).reduce((t, c) => t + c.unidades, 0)
      : (await repo.estadoProducto(itemCode, tx))?.pequena ?? 0;
    if (hay !== 0) throw falla("TIENE_EXISTENCIA", 409,
      `Hay ${numero(hay)} unidades registradas de este producto en la bodega ${bodega === "grande" ? "grande" : "pequeña"}: corregí las cajas o contá de nuevo.`);
    await repo.activar(itemCode, tx);
    await repo.registrarMovimientos([{ grupo: randomUUID(), tipo: "conteo", itemCode, bodega, cantidad: 0, hechoPor: aplicacion,
      observacion: "Contado: no hay" }], tx);
    return { data: { itemCode, bodega, unidades: 0 } };
  }, { operacionId: entrada.operacionId, tipo: "sinExistencia", entrada, aplicacion, itemCode });
}

// Para la lista de pedidos: los almacenes por los que filtrar, o null si no se filtra.
export async function almacenesParaPedidos() {
  if ((await repo.opcion(OPCION_FILTRAR_PEDIDOS)) !== true) return null;
  const almacenes = await repo.almacenesDeEstaBodega();
  return almacenes.length ? almacenes : null;
}
