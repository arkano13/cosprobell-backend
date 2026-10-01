// Administración de operadores de bodega (ingreso con nombre y PIN de 4 números elegido por el supervisor).
// Lo mismo se puede hacer desde el panel del supervisor de la app; el primer supervisor se crea con este script.
// Uso:
//   node scripts/operadores.js listar
//   node scripts/operadores.js crear "Nombre Apellido" 1234 [--supervisor]
//   node scripts/operadores.js pin "Nombre Apellido" 5678    cambia el PIN, desbloquea y cierra sus sesiones
//   node scripts/operadores.js desbloquear "Nombre Apellido"
//   node scripts/operadores.js desactivar "Nombre Apellido"  ya no puede ingresar; cierra sus sesiones
//   node scripts/operadores.js activar "Nombre Apellido"
//   node scripts/operadores.js rol "Nombre Apellido" supervisor|operador   cierra sus sesiones
import "dotenv/config";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { AppError } from "../src/shared/errors/AppError.js";
import {
  cambiarActivo, cambiarPin, cambiarRol, crearOperador, desbloquear, listarOperadoresAdmin,
  normalizarNombre, operadoresAdminRepository as repo, validarNombre,
} from "../src/modules/operadores/operadores.admin.js";

const USO = `Uso:
  node scripts/operadores.js listar
  node scripts/operadores.js crear "Nombre Apellido" 1234 [--supervisor]
  node scripts/operadores.js pin "Nombre Apellido" 5678
  node scripts/operadores.js desbloquear "Nombre Apellido"
  node scripts/operadores.js desactivar "Nombre Apellido"
  node scripts/operadores.js activar "Nombre Apellido"
  node scripts/operadores.js rol "Nombre Apellido" supervisor|operador`;

class ErrorUso extends Error {}

async function buscar(nombre) {
  const operador = await repo.buscarPorNombre(validarNombre(nombre));
  if (!operador) throw new ErrorUso(`No existe un operador llamado "${normalizarNombre(nombre)}". Revisá con: node scripts/operadores.js listar`);
  return operador;
}
const avisar = (texto) => texto && console.warn(`Aviso: ${texto}`);

const ESTADOS = { activo: "activo", inactivo: "desactivado", bloqueado: "bloqueado (necesita desbloqueo)" };

const acciones = {
  async listar() {
    const operadores = await listarOperadoresAdmin();
    if (!operadores.length) return console.log("No hay operadores. Crear con: node scripts/operadores.js crear \"Nombre\" 1234");
    for (const o of operadores) {
      const estado = ESTADOS[o.estado] ?? `en pausa hasta ${o.pausaHasta.toLocaleTimeString("es-HN")}`;
      console.log(`${o.nombre.padEnd(30)} ${o.rol.padEnd(11)} ${estado}`);
    }
  },
  async crear(nombre, pin, ...opciones) {
    if (opciones.some((o) => o !== "--supervisor")) throw new ErrorUso(USO);
    const { operador, advertencia } = await crearOperador({ nombre, pin, rol: opciones.includes("--supervisor") ? "supervisor" : "operador" });
    avisar(advertencia);
    console.log(`${operador.rol === "supervisor" ? "Supervisor" : "Operador"} "${operador.nombre}" creado. Ya puede ingresar con su PIN.`);
  },
  async pin(nombre, pin) {
    const { nombre: quien, advertencia } = await cambiarPin((await buscar(nombre)).id, pin);
    avisar(advertencia);
    console.log(`PIN de "${quien}" cambiado. Sus sesiones abiertas se cerraron.`);
  },
  async desbloquear(nombre) {
    console.log(`"${(await desbloquear((await buscar(nombre)).id)).nombre}" desbloqueado.`);
  },
  async desactivar(nombre) {
    console.log(`"${(await cambiarActivo((await buscar(nombre)).id, false)).nombre}" desactivado. Ya no puede ingresar.`);
  },
  async activar(nombre) {
    console.log(`"${(await cambiarActivo((await buscar(nombre)).id, true)).nombre}" activado.`);
  },
  async rol(nombre, rol) {
    const r = await cambiarRol((await buscar(nombre)).id, rol);
    console.log(`"${r.nombre}" ahora es ${r.rol}. Sus sesiones abiertas se cerraron.`);
  },
};

const [accion, ...argumentos] = process.argv.slice(2);
try {
  if (!Object.hasOwn(acciones, accion ?? "")) throw new ErrorUso(USO);
  await acciones[accion](...argumentos);
} catch (error) {
  console.error(error instanceof ErrorUso || error instanceof AppError ? error.message : `No se pudo completar: ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
