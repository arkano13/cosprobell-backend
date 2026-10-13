// Fechas de los reportes de bodega: los días se cortan en la hora de Honduras, no en UTC (la base guarda UTC).
export const ZONA = "America/Tegucigalpa";
const DIA_MS = 86_400_000;

const formatoFecha = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
const formatoHora = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hourCycle: "h23" });
const formatoOffset = new Intl.DateTimeFormat("en-US", { timeZone: ZONA, timeZoneName: "longOffset" });

// "2026-10-13": el día en Honduras de un instante.
export const fechaLocal = (instante) => formatoFecha.format(new Date(instante));
// Hora del día (0 a 23) en Honduras.
export const horaLocal = (instante) => Number(formatoHora.format(new Date(instante)));

// Inicio (00:00 en Honduras) de un día "YYYY-MM-DD", como instante UTC.
export function inicioDelDia(fecha) {
  const mediodia = new Date(`${fecha}T12:00:00Z`);
  const nombre = formatoOffset.formatToParts(mediodia).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = nombre === "GMT" ? "+00:00" : nombre.slice(3);
  return new Date(`${fecha}T00:00:00${offset}`);
}

export const sumarDias = (fecha, dias) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
export const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);
// 0 = domingo … 6 = sábado.
export const diaDeSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay();

// Semana ISO ("2026-W42") de un día.
export function semanaIso(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicioAnio = Date.UTC(d.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((d - inicioAnio) / DIA_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}
// Lunes de la semana del día.
export const lunesDe = (fecha) => sumarDias(fecha, -((diaDeSemana(fecha) + 6) % 7));

export const PERIODOS = ["hoy", "7d", "30d", "60d", "90d", "mes"];

// Rango de un período hasta ahora: desde el inicio del primer día (hora de Honduras). dias = días de calendario que abarca.
export function rangoPeriodo(periodo, ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  let primerDia;
  if (periodo === "hoy") primerDia = hoy;
  else if (periodo === "mes") primerDia = `${hoy.slice(0, 8)}01`;
  else primerDia = sumarDias(hoy, -(Number.parseInt(periodo, 10) - 1));
  return { periodo, primerDia, ultimoDia: hoy, desde: inicioDelDia(primerDia), hasta: new Date(ahora), dias: diasEntre(primerDia, hoy) + 1 };
}

// Un día completo (para Actividad por operador).
export function rangoDia(fecha) {
  return { primerDia: fecha, ultimoDia: fecha, desde: inicioDelDia(fecha), hasta: inicioDelDia(sumarDias(fecha, 1)), dias: 1 };
}

// Días de calendario del rango, del primero al último.
export function diasDelRango({ primerDia, ultimoDia }) {
  const dias = [];
  for (let f = primerDia; f <= ultimoDia; f = sumarDias(f, 1)) dias.push(f);
  return dias;
}

// Días hábiles (lunes a sábado: la bodega trabaja los sábados) del rango. Al menos 1, para dividir.
export const diasHabiles = (rango) => Math.max(1, diasDelRango(rango).filter((f) => diaDeSemana(f) !== 0).length);
