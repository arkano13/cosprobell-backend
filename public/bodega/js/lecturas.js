import { nuevoUuid } from "./uuid.js";

// Cola de lecturas del escáner. Las envía de a una y en orden de llegada.
// Cada lectura recibe su operacionId al entrar en la cola y lo conserva en todos los reintentos: si una
// respuesta se pierde, el servidor reconoce la operación y no cuenta la unidad dos veces.
// La cola se guarda (guardar) para que una recarga de la página no pierda lecturas pendientes.
//
// Eventos de alCambiar: en_cola, enviando, reintentando, aceptada, rechazada, detenida.
// detenida: sin conexión o clave rechazada; la lectura queda en la cola hasta reanudar().
export function crearColaLecturas({
  enviar,
  guardar = () => {},
  alCambiar = () => {},
  esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  reintentos = 4,
  pendientes = [],
}) {
  const cola = pendientes.filter((l) => typeof l?.codigo === "string" && typeof l?.operacionId === "string")
    .map(({ codigo, operacionId }) => ({ codigo, operacionId }));
  let detenida = false;
  let enCurso = null;

  const persistir = () => guardar(cola.map(({ codigo, operacionId }) => ({ codigo, operacionId })));
  const avisar = (evento) => alCambiar({ ...evento, enCola: cola.length });

  async function enviarPrimera() {
    const lectura = cola[0];
    for (let intento = 0; ; intento++) {
      avisar({ tipo: "enviando", lectura });
      try {
        const respuesta = await enviar(lectura);
        cola.shift(); persistir();
        avisar({ tipo: "aceptada", lectura, respuesta });
        return true;
      } catch (error) {
        if (error?.temporal && intento < reintentos) {
          avisar({ tipo: "reintentando", lectura, intento: intento + 1, error });
          await esperar(Math.min(8000, 500 * 2 ** intento));
          continue;
        }
        // Sin conexión persistente o clave rechazada: no se descarta una lectura física.
        if (error?.temporal || error?.status === 401) {
          detenida = true;
          avisar({ tipo: "detenida", lectura, error });
          return false;
        }
        cola.shift(); persistir();
        avisar({ tipo: "rechazada", lectura, error });
        return true;
      }
    }
  }

  async function ciclo() {
    while (cola.length && !detenida) {
      if (!(await enviarPrimera())) return;
    }
  }

  function procesar() {
    if (!enCurso && !detenida && cola.length) enCurso = ciclo().finally(() => { enCurso = null; });
    return enCurso ?? Promise.resolve();
  }

  return {
    agregar(codigo) {
      const lectura = { codigo, operacionId: nuevoUuid() };
      cola.push(lectura); persistir();
      avisar({ tipo: "en_cola", lectura });
      procesar();
      return lectura;
    },
    reanudar() { detenida = false; return procesar(); },
    procesar,
    get pendientes() { return cola.length; },
    get detenida() { return detenida; },
  };
}
