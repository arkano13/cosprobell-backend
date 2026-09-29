// Administración de operadores de bodega (ingreso con nombre y PIN de 4 números elegido por el supervisor).
// Uso:
//   node scripts/operadores.js listar
//   node scripts/operadores.js crear "Nombre Apellido" 1234
//   node scripts/operadores.js pin "Nombre Apellido" 5678    cambia el PIN, desbloquea y cierra sus sesiones
//   node scripts/operadores.js desbloquear "Nombre Apellido"
//   node scripts/operadores.js desactivar "Nombre Apellido"  ya no puede ingresar; cierra sus sesiones
//   node scripts/operadores.js activar "Nombre Apellido"
import "dotenv/config";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { hashPin, pinValido } from "../src/shared/security/pin.js";

const USO = `Uso:
  node scripts/operadores.js listar
  node scripts/operadores.js crear "Nombre Apellido" 1234
  node scripts/operadores.js pin "Nombre Apellido" 5678
  node scripts/operadores.js desbloquear "Nombre Apellido"
  node scripts/operadores.js desactivar "Nombre Apellido"
  node scripts/operadores.js activar "Nombre Apellido"`;

class ErrorUso extends Error {}
const normalizarNombre = (texto) => String(texto ?? "").trim().replace(/\s+/g, " ");

function validarNombre(texto) {
  const nombre = normalizarNombre(texto);
  if (nombre.length < 2 || nombre.length > 60) throw new ErrorUso("El nombre debe tener entre 2 y 60 caracteres.");
  return nombre;
}

function validarPin(pin) {
  if (!pinValido(pin)) throw new ErrorUso("El PIN debe tener exactamente 4 números, por ejemplo 4827.");
  // Se permite, pero se avisa: son los primeros que alguien probaría.
  if (/^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    console.warn(`Aviso: ${pin} es un PIN fácil de adivinar. Conviene elegir otro.`);
  }
  return pin;
}

async function buscar(nombre) {
  const operador = await prisma.operador.findUnique({ where: { nombre: validarNombre(nombre) } });
  if (!operador) throw new ErrorUso(`No existe un operador llamado "${normalizarNombre(nombre)}". Revisá con: node scripts/operadores.js listar`);
  return operador;
}

const cerrarSesiones = (operadorId) => prisma.sesionOperador.updateMany({ where: { operadorId, cerradaEn: null }, data: { cerradaEn: new Date() } });

function estado(o, ahora) {
  if (!o.activo) return "desactivado";
  if (o.bloqueadoHasta && o.bloqueadoHasta > ahora) {
    return o.bloqueadoHasta.getUTCFullYear() >= 9999 ? "bloqueado (necesita desbloqueo)" : `en pausa hasta ${o.bloqueadoHasta.toLocaleTimeString("es-HN")}`;
  }
  return "activo";
}

const acciones = {
  async listar() {
    const operadores = await prisma.operador.findMany({ orderBy: { nombre: "asc" } });
    if (!operadores.length) return console.log("No hay operadores. Crear con: node scripts/operadores.js crear \"Nombre\" 1234");
    const ahora = new Date();
    for (const o of operadores) console.log(`${o.nombre.padEnd(30)} ${estado(o, ahora)}`);
  },
  async crear(nombre, pin) {
    const datos = { nombre: validarNombre(nombre), pinHash: hashPin(validarPin(pin)) };
    if (await prisma.operador.findUnique({ where: { nombre: datos.nombre } })) throw new ErrorUso(`Ya existe un operador llamado "${datos.nombre}".`);
    await prisma.operador.create({ data: datos });
    console.log(`Operador "${datos.nombre}" creado. Ya puede ingresar con su PIN.`);
  },
  async pin(nombre, pin) {
    const operador = await buscar(nombre);
    await prisma.$transaction([
      prisma.operador.update({ where: { id: operador.id }, data: { pinHash: hashPin(validarPin(pin)), intentosFallidos: 0, bloqueadoHasta: null } }),
      cerrarSesiones(operador.id),
    ]);
    console.log(`PIN de "${operador.nombre}" cambiado. Sus sesiones abiertas se cerraron.`);
  },
  async desbloquear(nombre) {
    const operador = await buscar(nombre);
    await prisma.operador.update({ where: { id: operador.id }, data: { intentosFallidos: 0, bloqueadoHasta: null } });
    console.log(`"${operador.nombre}" desbloqueado.`);
  },
  async desactivar(nombre) {
    const operador = await buscar(nombre);
    await prisma.$transaction([prisma.operador.update({ where: { id: operador.id }, data: { activo: false } }), cerrarSesiones(operador.id)]);
    console.log(`"${operador.nombre}" desactivado. Ya no puede ingresar.`);
  },
  async activar(nombre) {
    const operador = await buscar(nombre);
    await prisma.operador.update({ where: { id: operador.id }, data: { activo: true, intentosFallidos: 0, bloqueadoHasta: null } });
    console.log(`"${operador.nombre}" activado.`);
  },
};

const [accion, ...argumentos] = process.argv.slice(2);
try {
  if (!Object.hasOwn(acciones, accion ?? "")) throw new ErrorUso(USO);
  await acciones[accion](...argumentos);
} catch (error) {
  console.error(error instanceof ErrorUso ? error.message : `No se pudo completar: ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
