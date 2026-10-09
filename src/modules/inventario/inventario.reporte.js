// Reporte de cuadre con SAP (panel del supervisor), sin acceso a la base (se prueba en tests/unit/inventario.reporte.test.js).
// Usa la misma diferencia que Pendientes (clasificar), así el reporte coincide con "Falta guardar" y "Falta marcar salida".
// Solo entran los productos ya contados en las dos bodegas: lo que falta contar todavía no es una diferencia, y lo
// recibido antes que SAP ("adelantado") no cuenta como sobrante mientras SAP no lo registre.
import { clasificar } from "./inventario.calculo.js";

const SIN_DATOS_SAP = { sapGrande: 0, sapPequena: 0, contadoGrande: false, contadoPequena: false };
const porNombre = (a, b) => a.itemName.localeCompare(b.itemName, "es") || a.itemCode.localeCompare(b.itemCode);

// filas: las de repo.estados(); porBodega: Map itemCode → fila de repo.cuadrePorBodega().
// diferencia = lo contado − SAP: negativa, en la bodega hay menos que en SAP; positiva, hay más.
export function armarCuadre({ filas, porBodega, ahora = Date.now() }) {
  const menos = [], mas = [];
  let cuadran = 0, pendientes = 0, actualizando = 0;
  for (const f of filas) {
    if (!f.activo) continue;
    const b = porBodega.get(f.itemCode) ?? SIN_DATOS_SAP;
    const faltaGrande = !(b.contadoGrande || f.grande > 0) && b.sapGrande > 0;
    const faltaPequena = !(b.contadoPequena || f.pequena !== 0) && b.sapPequena > 0;
    if (faltaGrande || faltaPequena) { pendientes += 1; continue; }
    const c = clasificar(f, ahora);
    if (c.estado === "actualizando") { actualizando += 1; continue; }
    const diferencia = -c.diferencia;
    if (diferencia === 0) { cuadran += 1; continue; }
    (diferencia < 0 ? menos : mas).push({
      itemCode: f.itemCode, itemName: f.itemName, diferencia,
      grande: { contado: f.grande, sap: b.sapGrande, diferencia: f.grande - b.sapGrande },
      pequena: { contado: f.pequena, sinEntrega: f.sinEntrega, sap: b.sapPequena, diferencia: f.pequena + f.sinEntrega - b.sapPequena },
    });
  }
  menos.sort((a, b) => a.diferencia - b.diferencia || porNombre(a, b));
  mas.sort((a, b) => b.diferencia - a.diferencia || porNombre(a, b));
  const unidades = (lista) => lista.reduce((t, x) => t + x.diferencia, 0);
  return {
    resumen: { contados: cuadran + menos.length + mas.length, cuadran,
      menos: { productos: menos.length, unidades: unidades(menos) }, mas: { productos: mas.length, unidades: unidades(mas) },
      pendientes, actualizando },
    menos, mas,
  };
}
