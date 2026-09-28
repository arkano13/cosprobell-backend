// El backend acepta hasta 500 registros y 1 MB por petición; se deja margen.
export const LIMITES_LOTE = Object.freeze({ maxRegistros: 500, maxBytes: 700_000 });

export function dividirEnLotes(registros, { maxRegistros, maxBytes } = LIMITES_LOTE) {
  const lotes = [];
  let actual = [];
  let bytes = 0;

  for (const registro of registros) {
    const tamano = Buffer.byteLength(JSON.stringify(registro)) + 1;

    if (tamano > maxBytes) {
      throw new Error(`Un registro ocupa ${tamano} bytes y supera el máximo por lote`);
    }

    if (actual.length > 0 && (actual.length >= maxRegistros || bytes + tamano > maxBytes)) {
      lotes.push(actual);
      actual = [];
      bytes = 0;
    }

    actual.push(registro);
    bytes += tamano;
  }

  if (actual.length > 0) {
    lotes.push(actual);
  }

  return lotes;
}
