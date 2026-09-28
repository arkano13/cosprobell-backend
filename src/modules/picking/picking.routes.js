import { Router } from "express";
import { prisma } from "../../infrastructure/database/prisma.js";
import { validate } from "../../middleware/validate.js";

import {
  iniciarBodySchema,
  idParamsSchema,
  escanearBodySchema,
} from "./picking.schemas.js";

import { pickingRepository } from "./picking.repository.js";

const router = Router();

// Iniciar una sesión de verificación.
router.post(
  "/picking",
  validate({ body: iniciarBodySchema }),
  async (req, res, next) => {
    try {
      const { pedidoDocEntry, usuarioId } = req.body;

      const pedido =
        await pickingRepository.buscarPedidoConLineas(pedidoDocEntry);

      if (!pedido) {
        return res.status(404).json({
          error: "Pedido no encontrado",
        });
      }

      if (pedido.lineas.length === 0) {
        return res.status(400).json({
          error: "El pedido no tiene lineas",
        });
      }
      const picking = await pickingRepository.crearSesion({
        pedidoDocEntry: pedido.docEntry,
        usuarioId,
        lineas: pedido.lineas.map((linea) => ({
          pedidoLineNum: linea.lineNum,
          itemCode: linea.itemCode,
          cantidadPedida: linea.quantity,
        })),
      });

      return res.status(201).json({
        data: picking,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Consultar una sesión de verificación.
router.get(
  "/picking/:id",
  validate({ params: idParamsSchema }),
  async (req, res, next) => {
    try {
    const picking =
  await pickingRepository.buscarSesionConLineas(req.params.id);

      if (!picking) {
        return res.status(404).json({
          error: "Sesion de picking no encontrada",
        });
      }

      return res.json({
        data: picking,
      });
    } catch (error) {
      next(error);
    }
  },
);


router.post(
  "/picking/:id/escanear",
  validate({
    params: idParamsSchema,
    body: escanearBodySchema,
  }),
  async (req, res, next) => {
    try {
      const pickingId = req.params.id;
      const { codigo } = req.body;

      const picking = await prisma.pickingPedido.findUnique({
        where: {
          id: pickingId,
        },
        select: {
          estado: true,
        },
      });

      if (!picking) {
        return res.status(404).json({
          error: "Sesion de picking no encontrada",
        });
      }

      if (picking.estado !== "en_proceso") {
        return res.status(400).json({
          error: `El picking ya esta en estado '${picking.estado}'`,
        });
      }

      const filas = await prisma.$queryRaw`
        UPDATE picking_pedidos_lineas
        SET "cantidadEscaneada" = "cantidadEscaneada" + 1,
            "codigoBarrasEscaneado" = ${codigo},
            "timestampEscaneo" = now()
        WHERE id = (
          SELECT id
          FROM picking_pedidos_lineas
          WHERE "pickingId" = ${pickingId}
            AND "itemCode" = ${codigo}
            AND "cantidadEscaneada" < "cantidadPedida"
          ORDER BY id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *;
      `;

      if (filas.length === 0) {
        const lineaExistente = await prisma.pickingPedidoLinea.findFirst({
          where: {
            pickingId,
            itemCode: codigo,
          },
        });

        const mensaje = lineaExistente
          ? "Ese producto ya completo su cantidad pedida"
          : "Ese producto no pertenece a este pedido";

        return res.status(409).json({
          error: mensaje,
        });
      }

      return res.json({
        data: filas[0],
      });
    } catch (error) {
      next(error);
    }
  },
);

// Finalizar una sesión de verificación.
router.post(
  "/picking/:id/finalizar",
  validate({ params: idParamsSchema }),
  async (req, res, next) => {
    try {
      const pickingId = req.params.id;

      const picking = await prisma.pickingPedido.findUnique({
        where: {
          id: pickingId,
        },
        include: {
          lineas: true,
        },
      });

      if (!picking) {
        return res.status(404).json({
          error: "Sesion de picking no encontrada",
        });
      }

      const hayDiferencias = picking.lineas.some(
        (linea) => linea.cantidadEscaneada !== linea.cantidadPedida,
      );

      const pickingFinal = await prisma.pickingPedido.update({
        where: {
          id: pickingId,
        },
        data: {
          estado: hayDiferencias ? "con_diferencias" : "completo",
          fechaFin: new Date(),
        },
        include: {
          lineas: true,
        },
      });

      return res.json({
        data: pickingFinal,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
