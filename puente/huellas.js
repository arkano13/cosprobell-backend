import { createHash } from "node:crypto";
export const claveHuella = valor => `k:${valor}`;
export const huella = registro => createHash("sha256").update(JSON.stringify(registro)).digest("hex");
export function separarCambios(registros, entidad, anteriores = {}) {
  const cambios = [], observados = [], huellas = {};
  for (const registro of registros) {
    const clave = registro[entidad.claveLocal];
    const hash = huella(registro);
    huellas[claveHuella(clave)] = hash;
    if (anteriores[claveHuella(clave)] === hash) observados.push(clave);
    else cambios.push(registro);
  }
  return { cambios, observados, huellas };
}
