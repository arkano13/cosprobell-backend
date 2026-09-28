import { setTimeout as pausa } from "node:timers/promises";
import { firmar } from "./firma.js";

export class ErrorBackend extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ErrorBackend";
    this.status = status;
  }
}

async function describirError(respuesta) {
  try {
    const cuerpo = await respuesta.json();
    const error = cuerpo.error;
    const detalles = (cuerpo.detalles ?? [])
      .slice(0, 5)
      .map((detalle) => `${detalle.campo}: ${detalle.mensaje}`);

    const principal = typeof error === "string" ? error : `${error?.code}: ${error?.message}`;
    return [principal, ...detalles].join(" | ");
  } catch {
    return "respuesta sin detalle";
  }
}

export function crearClienteBackend({
  url,
  secreto,
  reintentos = 4,
  esperar = (ms) => pausa(ms),
  tiempoMaximoMs = 120_000,
}) {
  const destino = new URL("/sync/lotes", url);

  return {
    // El mismo loteId en cada reintento: el backend no aplica dos veces un lote.
    async enviarLote(lote) {
      const cuerpo = JSON.stringify(lote);

      for (let intento = 1; ; intento++) {
        const marcaTiempo = String(Date.now());
        let respuesta;

        try {
          respuesta = await fetch(destino, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Bridge-Timestamp": marcaTiempo,
              "X-Bridge-Signature": firmar(secreto, {
                marcaTiempo,
                metodo: "POST",
                ruta: destino.pathname,
                cuerpo,
              }),
            },
            body: cuerpo,
            signal: AbortSignal.timeout(tiempoMaximoMs),
          });
        } catch (error) {
          if (intento > reintentos) {
            throw new ErrorBackend(`No se pudo contactar al backend: ${error.message}`, null);
          }

          await esperar(1000 * 2 ** intento);
          continue;
        }

        if (respuesta.ok) {
          return (await respuesta.json()).data;
        }

        if (respuesta.status >= 500 && intento <= reintentos) {
          await esperar(1000 * 2 ** intento);
          continue;
        }

        throw new ErrorBackend(
          `El backend rechazó el lote de ${lote.entidad} (${respuesta.status}): ${await describirError(respuesta)}`,
          respuesta.status
        );
      }
    },
  };
}
