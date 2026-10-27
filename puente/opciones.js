import { ErrorPuente } from "./http.js";

export function opcionesPuente(args, entidades, pausadas = []) {
  const banderas = ["--once", "--watch", "--sondeo", "--forzar", "--reconciliar", "--estado"];
  if (args.some(a => !banderas.includes(a) && !a.startsWith("--entidades=")) ||
    args.filter(a => a.startsWith("--entidades=")).length > 1 ||
    args.includes("--watch") && args.some(a => ["--once", "--forzar", "--reconciliar", "--sondeo", "--estado"].includes(a)) ||
    args.includes("--estado") && args.some(a => a !== "--estado" && !a.startsWith("--entidades=")) ||
    args.includes("--sondeo") && args.some(a => ["--forzar", "--reconciliar"].includes(a))) throw new ErrorPuente("ARGUMENTOS_INVALIDOS");
  const entrada = args.find(a => a.startsWith("--entidades="));
  const seleccion = entrada ? entrada.slice(12).split(",") : null;
  if (seleccion && (!seleccion.length || new Set(seleccion).size !== seleccion.length ||
    seleccion.some(n => !entidades.some(e => e.nombre === n)))) throw new ErrorPuente("ENTIDADES_INVALIDAS");
  if (seleccion && !args.includes("--estado") && seleccion.some(n => pausadas.includes(n))) throw new ErrorPuente("ENTIDAD_PAUSADA");
  return { seleccion: seleccion ? new Set(seleccion) : null, estado: args.includes("--estado") };
}

export function alcanceSeleccion(seleccion, entidades, almacenes) {
  if (!seleccion) return null;
  const resultado = new Set(seleccion);
  const agregarDependencias = nombre => {
    for (const dep of entidades.find(e => e.nombre === nombre)?.dependencias ?? []) {
      const i = entidades.findIndex(e => e.nombre === dep);
      if (i >= 0 && !almacenes[i].estado.ultimoCompleto && !resultado.has(dep)) {
        resultado.add(dep); agregarDependencias(dep);
      }
    }
  };
  for (const nombre of seleccion) agregarDependencias(nombre);
  return resultado;
}
