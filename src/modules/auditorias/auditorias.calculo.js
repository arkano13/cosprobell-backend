// Resultado de una auditoría, sin acceso a la base (se prueba en tests/unit/auditorias.calculo.test.js).
// Entran los productos escaneados y los que la app o SAP dicen que hay en ese almacén: lo que no se escaneó cuenta como 0.
// app y sap son Map itemCode → unidades, o null cuando no hay contra qué comparar (un almacén que la app no lleva, o
// del que el puente no manda existencias). diferencia = escaneado − el otro: negativa, faltan; positiva, sobran.
const porNombre = (a, b) => a.itemName.localeCompare(b.itemName, "es") || a.itemCode.localeCompare(b.itemCode);

export function armarResultado({ escaneado, app = null, sap = null, nombres = new Map() }) {
  const codigos = new Set([...escaneado.keys(), ...(app?.keys() ?? []), ...(sap?.keys() ?? [])]);
  const filas = [...codigos].map((itemCode) => {
    const unidades = escaneado.get(itemCode) ?? 0;
    const enApp = app ? app.get(itemCode) ?? 0 : null;
    const enSap = sap ? Math.round(sap.get(itemCode) ?? 0) : null;
    return { itemCode, itemName: nombres.get(itemCode) ?? itemCode, escaneado: unidades, app: enApp, sap: enSap,
      diferenciaApp: enApp === null ? null : unidades - enApp, diferenciaSap: enSap === null ? null : unidades - enSap };
  }).filter((f) => f.escaneado !== 0 || f.app || f.sap);
  // Primero lo que no cumple (lo que más falta arriba), después lo que sobra y al final lo que cumple.
  const clave = (f) => f.diferenciaApp ?? f.diferenciaSap ?? 0;
  const grupo = (f) => (clave(f) < 0 ? 0 : clave(f) > 0 ? 1 : 2);
  filas.sort((a, b) => grupo(a) - grupo(b) || (grupo(a) === 1 ? clave(b) - clave(a) : clave(a) - clave(b)) || porNombre(a, b));
  const contra = (campo) => {
    const faltan = filas.filter((f) => f[campo] < 0), sobran = filas.filter((f) => f[campo] > 0);
    const suma = (lista) => lista.reduce((t, f) => t + Math.abs(f[campo]), 0);
    return { cumplen: filas.length - faltan.length - sobran.length,
      faltan: { productos: faltan.length, unidades: suma(faltan) }, sobran: { productos: sobran.length, unidades: suma(sobran) } };
  };
  return {
    resumen: { productos: filas.length, escaneado: filas.reduce((t, f) => t + f.escaneado, 0),
      contraApp: app ? contra("diferenciaApp") : null, contraSap: sap ? contra("diferenciaSap") : null },
    filas,
  };
}

// Corrige lo escaneado de un producto en un resultado ya terminado y lo recalcula con los mismos números de la app y de
// SAP que había al terminar (un producto que no figuraba tenía 0 en los dos). En cada fila corregida queda original: lo
// que se escaneó de verdad. Devuelve el resultado nuevo y cuánto tenía el producto antes de esta corrección.
export function corregirResultado(resultado, { itemCode, itemName = itemCode, escaneado }) {
  const conApp = resultado.resumen.contraApp !== null, conSap = resultado.resumen.contraSap !== null;
  const unidades = new Map(), app = conApp ? new Map() : null, sap = conSap ? new Map() : null;
  const nombres = new Map(), originales = new Map();
  for (const f of resultado.filas) {
    unidades.set(f.itemCode, f.escaneado); app?.set(f.itemCode, f.app ?? 0); sap?.set(f.itemCode, f.sap ?? 0);
    nombres.set(f.itemCode, f.itemName);
    if (f.original !== undefined) originales.set(f.itemCode, f.original);
  }
  const antes = unidades.get(itemCode) ?? 0;
  if (!originales.has(itemCode)) originales.set(itemCode, antes);
  if (!nombres.has(itemCode)) nombres.set(itemCode, itemName);
  unidades.set(itemCode, escaneado);
  const nuevo = armarResultado({ escaneado: unidades, app, sap, nombres });
  for (const f of nuevo.filas) {
    const original = originales.get(f.itemCode);
    if (original !== undefined && original !== f.escaneado) f.original = original;
  }
  return { resultado: { ...resultado, ...nuevo }, antes };
}
