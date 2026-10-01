// Inventario de la bodega: cajas por lote en la grande, unidades sueltas en la pequeña, y la diferencia con lo
// que SAP tiene en los almacenes de esta bodega. Nada se escribe en SAP.
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import { inventarioRepository as repo } from "./inventario.repository.js";
import { clasificar, codigoCaja, repartirEnCajas, cajaParaUsarAntes, textoAsignacion } from "./inventario.calculo.js";

const OPCION_FILTRAR_PEDIDOS = "pedidosSoloDeEstaBodega";
const falla = (code, statusCode, message) => new AppError({ code, statusCode, message });
const sinProducto = () => falla("PRODUCTO_NO_ENCONTRADO", 404, "Producto no encontrado");
const sinCaja = () => falla("CAJA_NO_ENCONTRADA", 404, "No hay una caja con ese código");
const numero = (n) => Number(n).toLocaleString("es-HN");
const fechaIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function vistaEstado(f, ahora = Date.now()) {
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
  const [bodegas, estados, porVencer, movimientos] = await Promise.all([
    repo.resumenBodegas(), almacenes.length ? repo.estados() : [], repo.porVencer(60), repo.movimientos({ limite: 8 })]);
  const vistas = estados.map((f) => vistaEstado(f));
  const contar = (estado) => vistas.filter((v) => v.estado === estado).length;
  return { data: { almacenes, ...bodegas,
    pendientes: { porUbicar: contar("por_ubicar"), porDescontar: contar("por_descontar"), actualizando: contar("actualizando"),
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
  const [estado, cajas, movimientos, documentos, ultima] = await Promise.all([
    almacenes.length ? estadoDe(itemCode) : null, repo.cajasDe(itemCode), repo.movimientos({ itemCode, limite: 15 }),
    repo.documentosRecientes([itemCode], { dias: 60, porProducto: 8 }), repo.ultimaRecepcion(itemCode)]);
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
    itemCode: producto.itemCode, itemName: producto.itemName, almacenes, estado,
    pequena: producto.inventario?.pequena ?? 0, enInventario: Boolean(producto.inventario),
    codigos: producto.codigosBarras.map((c) => ({ id: c.id, codigo: c.codigo, origen: c.origen, confirmado: c.confirmacionPicking?.esUnidadIndividual === true })),
    lotes: [...lotes.values()], movimientos, documentos,
    sugerencia: ultima ? { unidadesPorCaja: ultima.unidadesIniciales } : null,
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
    porDescontar: porDescontar.map((v) => ({ ...v, documentos: docs(v.itemCode) })),
    actualizando: de("actualizando"),
    faltaEnSap: vistas.filter((v) => v.faltaEnSap > 0),
    conteoInicial: { productos: inicial.length, unidades: inicial.reduce((t, v) => t + v.diferencia, 0) },
  } };
}

// Productos que todavía no entraron al inventario y SAP dice que hay: la lista del conteo inicial.
export async function listarConteoInicial({ buscar, pagina, limit }) {
  await exigirAlmacenes();
  const texto = buscar?.toLowerCase();
  const todos = (await repo.estados()).map((f) => vistaEstado(f)).filter((v) => v.estado === "conteo_inicial")
    .filter((v) => !texto || v.itemCode.toLowerCase().includes(texto) || v.itemName.toLowerCase().includes(texto));
  return { data: todos.slice(pagina * limit, (pagina + 1) * limit), total: todos.length };
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
    const clave = m.bodega === "pequena" ? "pequena" : `caja:${m.cajaId}`;
    const actual = netos.get(clave) ?? { tipo: m.bodega === "pequena" ? "pequena" : "lote", lote: m.lote, cajaId: m.cajaId, codigo: m.caja?.codigo ?? null, unidades: 0 };
    actual.unidades -= m.cantidad;
    netos.set(clave, actual);
  }
  return [...netos.values()].filter((a) => a.unidades > 0);
}
function resumirAsignacion(asignacion) {
  const porLote = new Map();
  for (const a of asignacion) {
    const clave = a.tipo === "pequena" ? "pequena" : `lote:${a.lote ?? ""}`;
    const actual = porLote.get(clave) ?? { tipo: a.tipo, lote: a.tipo === "pequena" ? null : a.lote, unidades: 0, cajas: [] };
    actual.unidades += a.unidades;
    if (a.codigo) actual.cajas.push(a.codigo);
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
export async function recibir(entrada, { aplicacion }) {
  await exigirAlmacenes();
  const { itemCode, modo, lote = null, vencimiento = null, adelantar = false } = entrada;
  const cajas = modo === "cajas" ? entrada.cajas : 1;
  const porCaja = modo === "cajas" ? entrada.unidadesPorCaja : entrada.unidades;
  const total = cajas * porCaja;
  const destino = modo === "cajas" ? "grande" : entrada.destino;
  return repo.conProducto(itemCode, async (tx) => {
    const estado = await estadoDe(itemCode, tx);
    const porUbicar = Math.max(0, estado.diferencia);
    const excede = total - porUbicar;
    if (excede > 0 && !adelantar) throw falla("EXCEDE_POR_UBICAR", 409, porUbicar === 0
      ? `SAP todavía no registró mercadería por ubicar de este producto. Si llegó antes que SAP, confirmá que se reciba igual.`
      : `SAP tiene ${numero(porUbicar)} por ubicar y estás recibiendo ${numero(total)}. Si llegó más de lo que SAP registró, confirmá que se reciba igual.`);
    await repo.activar(itemCode, tx);
    if (excede > 0) await repo.sumarAdelantado(itemCode, excede, tx);
    const g = randomUUID();
    let creadas = [];
    if (destino === "grande") {
      const ids = await repo.reservarIdsCajas(cajas, tx);
      const ahora = new Date();
      creadas = ids.map(({ id }) => ({ id, codigo: codigoCaja(id), itemCode, lote, suelto: modo === "suelto",
        vencimiento: vencimiento ? new Date(`${vencimiento}T00:00:00.000Z`) : null, unidadesIniciales: porCaja, unidades: porCaja,
        recibidaEn: ahora, recibidaPor: aplicacion }));
      await repo.crearCajas(creadas, tx);
      await repo.registrarMovimientos(creadas.map((c) => ({ grupo: g, tipo: "recepcion", itemCode, bodega: "grande", cantidad: porCaja,
        cajaId: c.id, lote, hechoPor: aplicacion, observacion: excede > 0 ? "Recibido antes que SAP" : null })), tx);
    } else {
      await repo.cambiarPequena(itemCode, total, tx);
      await repo.registrarMovimientos([{ grupo: g, tipo: "recepcion", itemCode, bodega: "pequena", cantidad: total, lote,
        hechoPor: aplicacion, observacion: excede > 0 ? "Recibido antes que SAP" : null }], tx);
    }
    return { data: { cajas: creadas.map(vistaCaja), unidades: total, destino, adelantado: Math.max(0, excede) } };
  });
}

// De una caja de la grande a la pequeña.
export async function reponer({ caja: codigo, unidades }, { aplicacion }) {
  const caja = await repo.cajaPorCodigo(codigo);
  if (!caja) throw sinCaja();
  return repo.conProducto(caja.itemCode, async (tx) => {
    const actual = await repo.cajaBloqueada(caja.id, tx);
    if (unidades > actual.unidades) throw falla("CAJA_INSUFICIENTE", 409, `La caja ${codigo} tiene ${numero(actual.unidades)} unidades`);
    await repo.activar(caja.itemCode, tx);
    await repo.cambiarUnidadesCaja(caja.id, -unidades, tx);
    await repo.cambiarPequena(caja.itemCode, unidades, tx);
    const g = randomUUID();
    await repo.registrarMovimientos([
      { grupo: g, tipo: "reposicion", itemCode: caja.itemCode, bodega: "grande", cantidad: -unidades, cajaId: caja.id, lote: caja.lote, hechoPor: aplicacion },
      { grupo: g, tipo: "reposicion", itemCode: caja.itemCode, bodega: "pequena", cantidad: unidades, cajaId: caja.id, lote: caja.lote, hechoPor: aplicacion },
    ], tx);
    const estado = await repo.estadoProducto(caja.itemCode, tx);
    return { data: { caja: vistaCaja({ ...actual, unidades: actual.unidades - unidades }), pequena: estado.pequena } };
  });
}

// Resta las unidades asignadas (de cajas de un lote o de la pequeña) dentro de la transacción del producto.
async function aplicarAsignaciones(itemCode, asignaciones, { tipo, grupo, descuentoId, hechoPor }, tx) {
  const movimientos = [], retirar = [];
  for (const a of asignaciones) {
    if (a.tipo === "pequena") {
      const estado = await repo.estadoProducto(itemCode, tx);
      if ((estado?.pequena ?? 0) < a.unidades) throw falla("PEQUENA_INSUFICIENTE", 409,
        `La bodega pequeña tiene ${numero(estado?.pequena ?? 0)} unidades de este producto`);
      await repo.cambiarPequena(itemCode, -a.unidades, tx);
      movimientos.push({ grupo, tipo, itemCode, bodega: "pequena", cantidad: -a.unidades, descuentoId, hechoPor });
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
export async function descontar({ itemCode, unidades, asignaciones }, { aplicacion }) {
  await exigirAlmacenes();
  if (sumar(asignaciones) !== unidades) throw falla("ASIGNACION_INCOMPLETA", 400, `Hay que asignar exactamente ${numero(unidades)} unidades`);
  return repo.conProducto(itemCode, async (tx) => {
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
  });
}

// "Cambiar lote": devuelve lo restado a sus cajas (o a la pequeña) y lo resta según la nueva elección.
export async function reasignarDescuento(id, { asignaciones }, { aplicacion }) {
  const previo = await repo.descuento(id);
  if (!previo) throw falla("DESCUENTO_NO_ENCONTRADO", 404, "Descuento no encontrado");
  if (sumar(asignaciones) !== previo.unidades) throw falla("ASIGNACION_INCOMPLETA", 400, `Hay que asignar exactamente ${numero(previo.unidades)} unidades`);
  return repo.conProducto(previo.itemCode, async (tx) => {
    const descuento = await repo.descuento(id, tx);
    const actual = asignacionDe(descuento.movimientos);
    const g = randomUUID();
    const devolver = [];
    for (const a of actual) {
      if (a.tipo === "pequena") await repo.cambiarPequena(descuento.itemCode, a.unidades, tx);
      else await repo.cambiarUnidadesCaja(a.cajaId, a.unidades, tx);
      devolver.push({ grupo: g, tipo: "reasignacion", itemCode: descuento.itemCode, bodega: a.tipo === "pequena" ? "pequena" : "grande",
        cantidad: a.unidades, cajaId: a.cajaId ?? null, lote: a.lote ?? null, descuentoId: id, hechoPor: aplicacion, observacion: "Devuelto al cambiar el lote" });
    }
    await repo.registrarMovimientos(devolver, tx);
    const retirar = await aplicarAsignaciones(descuento.itemCode, asignaciones, { tipo: "reasignacion", grupo: g, descuentoId: id, hechoPor: aplicacion }, tx);
    await repo.corregirDescuento(id, { corregidoPor: aplicacion, corregidoEn: new Date(),
      anterior: textoAsignacion(resumirAsignacion(actual)) }, tx);
    return { data: { id, retirar } };
  });
}

// Conteo de la bodega pequeña (supervisor): deja el número contado.
export async function contarPequena(itemCode, { unidades }, { aplicacion }) {
  await exigirAlmacenes();
  return repo.conProducto(itemCode, async (tx) => {
    await estadoDe(itemCode, tx);
    await repo.activar(itemCode, tx);
    const estado = await repo.estadoProducto(itemCode, tx);
    const delta = unidades - estado.pequena;
    if (delta !== 0) {
      await repo.cambiarPequena(itemCode, delta, tx);
      await repo.registrarMovimientos([{ grupo: randomUUID(), tipo: "conteo", itemCode, bodega: "pequena", cantidad: delta,
        hechoPor: aplicacion, observacion: `Contado: ${unidades}` }], tx);
    }
    return { data: { itemCode, pequena: unidades, cambio: delta } };
  });
}

// Corrección de una caja (supervisor): deja las unidades que realmente tiene.
export async function corregirCaja(id, { unidades }, { aplicacion }) {
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
  });
}

// Al finalizar un picking: lo escaneado sale de la bodega pequeña. Solo productos que ya están en el inventario;
// el resto entra con su conteo inicial. Corre dentro de la transacción que cierra la preparación.
export async function descontarPorPicking({ pickingId, lineas, hechoPor = null }, tx) {
  const porProducto = new Map();
  for (const l of lineas) {
    const unidades = Math.round(l.cantidadEscaneada ?? 0);
    if (unidades > 0) porProducto.set(l.itemCode, (porProducto.get(l.itemCode) ?? 0) + unidades);
  }
  if (!porProducto.size) return [];
  const itemCodes = [...porProducto.keys()].sort();
  await repo.bloquearProductos(itemCodes, tx);
  const movimientos = [];
  for (const itemCode of itemCodes) {
    if (!(await repo.estadoProducto(itemCode, tx))) continue;
    const unidades = porProducto.get(itemCode);
    await repo.cambiarPequena(itemCode, -unidades, tx);
    movimientos.push({ grupo: `picking-${pickingId}-${itemCode}`, tipo: "picking", itemCode, bodega: "pequena", cantidad: -unidades, pickingId, hechoPor });
  }
  await repo.registrarMovimientos(movimientos, tx);
  return movimientos;
}

// ---------- Almacenes de esta bodega (supervisor) ----------

export async function listarAlmacenes() {
  const [almacenes, filtrar] = await Promise.all([repo.almacenes(), repo.opcion(OPCION_FILTRAR_PEDIDOS)]);
  return { data: { almacenes, pedidosSoloDeEstaBodega: filtrar === true } };
}

export async function elegirAlmacenes({ almacenes, pedidosSoloDeEstaBodega }, { aplicacion }) {
  const conocidos = new Set((await repo.almacenes()).map((a) => a.warehouseCode));
  const desconocidos = almacenes.filter((c) => !conocidos.has(c));
  if (desconocidos.length) throw falla("ALMACEN_DESCONOCIDO", 400, `Almacén desconocido: ${desconocidos.join(", ")}`);
  await repo.transaccion(async (tx) => {
    await repo.marcarAlmacenes(almacenes, tx);
    await repo.guardarOpcion(OPCION_FILTRAR_PEDIDOS, pedidosSoloDeEstaBodega, aplicacion, tx);
  });
  return listarAlmacenes();
}

// Para la lista de pedidos: los almacenes por los que filtrar, o null si no se filtra.
export async function almacenesParaPedidos() {
  if ((await repo.opcion(OPCION_FILTRAR_PEDIDOS)) !== true) return null;
  const almacenes = await repo.almacenesDeEstaBodega();
  return almacenes.length ? almacenes : null;
}
