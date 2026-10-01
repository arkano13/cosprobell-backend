import { z } from "zod";
import { AppError } from "../../shared/errors/AppError.js";
import { identificador } from "./lote.schemas.js";
import { sincronizacionRepository as repo } from "./sincronizacion.repository.js";
import { TIPOS_DOCUMENTO } from "./documentos.schemas.js";

// actualizar: false cuando el modelo no guarda la fecha de recepción (o no es el de la entidad, como las
// existencias, que se comprueban contra los productos). filtro: condición fija del modelo. marcar: otra fecha
// que deja constancia del recorrido (las existencias sin cambios no tocan la fecha del producto).
const modelos = {
  clientes: { modelo: "cliente", clave: "cardCode" },
  productos: { modelo: "producto", clave: "itemCode" },
  pedidos: { modelo: "pedido", clave: "docEntry", numerica: true },
  unidades: { modelo: "unidadMedida", clave: "absEntry", numerica: true, actualizar: false },
  codigosBarras: { modelo: "productoCodigoBarras", clave: "sapAbsEntry", numerica: true },
  almacenes: { modelo: "bodega", clave: "warehouseCode" },
  existencias: { modelo: "producto", clave: "itemCode", actualizar: false,
    marcar: (tx, claves) => tx.productoExistencia.updateMany({ where: { itemCode: { in: claves } }, data: { actualizadoEn: new Date() } }) },
  ...Object.fromEntries(Object.entries(TIPOS_DOCUMENTO).map(([entidad, tipo]) =>
    [entidad, { modelo: "documentoStock", clave: "docEntry", numerica: true, filtro: { tipo } }])),
};
// Confirma presencia sin sobrescribir el contenido ni avanzar secuencias de lotes.
// Es necesario para que un registro sin cambios no parezca retirado o cerrado.
export async function observarRegistros(entidad, entrada, empresa) {
  const def = modelos[entidad];
  if (!Object.hasOwn(modelos, entidad)) throw new AppError({ code: "ENTIDAD_DESCONOCIDA", message: "Entidad desconocida", statusCode: 404 });
  const tipo = def.numerica ? z.number().int().min(0).max(2147483647) : identificador(50);
  const validacion = z.object({ claves: z.array(tipo).min(1).max(100).refine(a => new Set(a).size === a.length) }).strict().safeParse(entrada);
  if (!validacion.success) throw new AppError({ code: "SOLICITUD_INVALIDA", message: "Claves observadas inválidas", statusCode: 400 });
  if (!empresa) throw new AppError({ code: "EMPRESA_NO_AUTORIZADA", message: "Empresa no autorizada", statusCode: 403 });
  return repo.conBloqueo(async tx => {
    const estado = await repo.consultarEstado(entidad, tx);
    if (!estado || estado.empresa !== empresa || await repo.existeOtraEmpresa(empresa, tx)) {
      throw new AppError({ code: "REQUIERE_RECONCILIACION", message: "La entidad requiere reconciliación", statusCode: 409 });
    }
    const claves = validacion.data.claves;
    const where = { ...def.filtro, [def.clave]: { in: claves } };
    const cuenta = await tx[def.modelo].count({ where });
    if (cuenta !== claves.length) throw new AppError({ code: "REQUIERE_RECONCILIACION", message: "Faltan registros recibidos anteriormente", statusCode: 409 });
    if (def.actualizar !== false) await tx[def.modelo].updateMany({ where, data: {
      sincronizadoEn: new Date(), ...(entidad === "codigosBarras" ? { retiradoEnSap: false } : {}),
    } });
    if (def.marcar) await def.marcar(tx, claves);
    return { observados: claves.length };
  });
}
