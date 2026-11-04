# Normalización detenida por una factura sin cabecera

Caso comprobado el 3 de noviembre: facturas terminó de importarse el 28 de octubre; facturaLineas terminó el 30.
La tanda posterior a 36,250 líneas incluye las facturas DocEntry 17235–17245, que todavía no estaban en el snapshot
de cabeceras. El problema no se arregla repitiendo la normalización de esa misma carga.

La corrección actualiza **solo las cabeceras de facturas**, mediante GET nativo de Service Layer. Hace otro recorrido
completo de esa entidad (no solo de los 11 documentos); no vuelve a cargar las otras once entidades. La versión anterior
permanece publicada hasta completar la nueva. No borra archivos de estado ni modifica SAP.

## 1. En el equipo del puente

Copiar el nuevo archivo `puente/actualizar-finanzas-get.js` dentro de `C:\puente-cosprobell\puente`.
El ZIP de esta corrección contiene solo ese archivo y estas instrucciones.

Si está corriendo `importar-finanzas.js --cargar`, detener esa consola con Ctrl+C y esperar a que termine: su avance
de movimientos queda guardado. El puente operativo puede permanecer habilitado; comparten el candado y el actualizador
esperará cuando lo encuentre ocupado.

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/actualizar-finanzas-get.js --entidad=facturas
```

Respeta `BRIDGE_FINANCE_MAX_REQUESTS`, `BRIDGE_FINANCE_MAX_SECONDS`, la demora entre solicitudes y las pausas entre
tandas (15 a 600 segundos). Consulta `Invoices` mediante GET y usa el login/logout habitual de Service Layer.
No registra consultas SQL ni usa `ejecutar-finanzas.js` (el importador SQL anterior).

Esperar hasta:

```json
{"evento":"actualizacion_completa","entidad":"facturas"}
```

Si se interrumpe, el mismo comando retoma el recorrido pendiente. Repetirlo **después de completarlo** inicia otra
actualización de cabeceras; basta una carga completa para resolver este caso. No hay que editar `.env` ni reinstalar
el puente ni registrar una tarea adicional.

## 2. En tu computadora, en el repositorio del backend

La versión de cabeceras cambió: convertirla primero a la tabla de facturas.

```bash
node scripts/normalizar-finanzas.js --aplicar --entidad=facturas --lote=50
```

Después continuar el resto:

```bash
node scripts/normalizar-finanzas.js --aplicar --lote=50
```

`facturaLineas` retoma su cursor confirmado; las 36,250 líneas anteriores no se vuelven a procesar. Las entidades ya
convertidas de la misma versión se omiten. Si vuelve a aparecer una relación faltante, identificar su entidad/documentos:
el conversor actualizado informa el modelo y los identificadores faltantes, sin omitir líneas ni fabricar cabeceras.

## 3. Retomar la importación de movimientos, si seguía pendiente

En el equipo del puente:

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --cargar
```

Este importador detecta que facturas ya terminó y continúa las entidades pendientes. El estado local de todas las
entidades se mantiene compatible con el backend. No borrar ni renombrar los archivos `finanzas-*.json`.

También puede usarse el actualizador nuevo para `notasCredito`, `pagos`, `clientes`, `vendedores` y `condicionesPago`
si se confirma el mismo desfase en esas entidades. No programa actualizaciones periódicas.
