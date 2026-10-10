# Segunda etapa del puente: cartera y estado de cuenta

**Actualización del 9 de octubre:** se implementó el receptor y emisor financiero
separado, con contratos decimales, recorridos recuperables y consultas de cartera.
Instalación y alcance real en [INSTALAR_FINANZAS.md](INSTALAR_FINANZAS.md).
Confirmado: todo el historial y `U_ZONA` como ruta del cliente.
Pendientes de entorno: monedas, zona independiente si existe, permisos y
sondeo de SAP FP2111, y comparación contable. El dictamen siguiente documenta la
revisión anterior; no es la lista actual de archivos implementados.

Revisión del 8 de octubre de 2026. Código revisado: `0b21b1c` y archivos locales presentes.
Este documento consolida el alcance solicitado y la preparación necesaria; no declara
implementada ni validada en SAP la integración financiera.

## Dictamen

La arquitectura del puente es reutilizable. El modelo financiero y sus consultas siguen
siendo preliminares y deben ampliarse antes de presentar saldos como una cartera fiable.
La lista financiera del usuario queda incluida completa. El alcance comercial original
también se conserva, aunque su implementación se divide en entregas.

Se revisaron el arranque y las rutas, autenticación, esquema y migraciones, recepción de
lotes, emisor SAP, estado local, presupuestos, clientes/facturas/pagos, reglas transaccionales
del inventario y picking, documentación y pruebas. No se consultó SAP ni la base de Railway.
Esta revisión de arquitectura y preparación no equivale a certificar cada flujo de producción.

## 1. Cobertura completa acordada

| Conjunto | Información que se debe conservar y consultar | Situación encontrada |
|---|---|---|
| Clientes | Código, nombre, activo/inactivo, saldo actual con moneda y fecha, vendedor, condición de pago, zona/ruta si existe | El puente trae código, nombre, Valid y Frozen. El modelo tiene otros campos opcionales que todavía no se sincronizan |
| Facturas | Identificador interno, número y serie, cliente, fechas de documento/contabilización/vencimiento, total, pendiente, moneda, estado, anulación, vendedor, detalle y referencias | Modelos y GET básicos; sin emisor ni contrato receptor financiero |
| Pagos recibidos | Identificador, número, cliente, fecha, total, moneda, medios, cancelación, importe aplicado por documento/cuota y remanente sin aplicar | Modelo parcial; efectivo y transferencia no representan todos los medios; no se sincroniza |
| Notas de crédito | Identificador, número, cliente, fechas, importe, moneda, estado/anulación, líneas de origen, aplicaciones y saldo a favor disponible | Modelo parcial con factura base opcional; falta la aplicación financiera real |
| Cartera abierta | Partidas abiertas, saldo deudor/acreedor real, vencimiento, días y tramos de antigüedad, moneda, fecha de corte y referencias | Sin modelo ni servicio de cartera |
| Conciliaciones | Identificador, fecha, documentos/asientos y líneas vinculados, importes conciliados, cancelaciones/reversiones | No modeladas ni sincronizadas |
| Cuotas | Número de cuota, vencimiento, importe, aplicación y pendiente por cuota | Hay installmentId en una aplicación, pero no un catálogo de cuotas ni sus saldos |
| Vendedores | Código, nombre, estado; distinguir vendedor actual del cliente y vendedor del documento | Modelo de vendedor y códigos sueltos; falta integración y relaciones de consulta |
| Condiciones de pago | Código, nombre y reglas/cuotas necesarias; condiciones reales de cada documento | Solo código del cliente, sin catálogo |
| Zona/ruta | Código, descripción y relación correctos según la configuración de Cosprobell | U_ZONA aparece documentado, pero su significado comercial no está confirmado |
| Estado de cuenta | Saldo inicial, cargos, abonos, referencias y saldo final por cliente y moneda, a una fecha de corte | Falta implementar y contrastar contra SAP |
| Soporte contable | Saldos de apertura, anticipos, pagos a cuenta, ajustes/asientos manuales, diferencias de cambio y otras partidas que afecten a clientes | Incluir cuando existan y afecten el resultado; no asumir que las facturas contienen todo |

La disponibilidad exacta de cada campo/servicio debe verificarse contra los metadatos,
permisos y ejemplos del Service Layer instalado. Una referencia actual de SAP no garantiza
que un endpoint concreto funcione igual en el FP de Cosprobell.

## 2. Lo original y lo que se amplía

El plan original ya incluía clientes, facturas, cobros/aplicaciones, notas de crédito,
vendedores, saldos y vencimientos. Ya nombraba condiciones de pago y conciliaciones,
pero dejaba su integración y las cuotas pendientes de validar.

Quedan explícitos ahora:

- Zona/ruta con significado confirmado por el negocio.
- Antigüedad de cartera por fecha de corte y tramos acordados.
- Estado de cuenta completo con saldo inicial y final.
- Comparación documentada contra reportes SAP, con discrepancias visibles.
- Cuotas, conciliaciones, aplicaciones parciales/canceladas y saldos a favor como parte
  necesaria de la solución cuando influyan en el saldo, no como extras opcionales.
- Monedas, precisión, apertura y ajustes suficientes para explicar el saldo.

El resto del alcance original sigue vigente: grupos de productos, listas y precios,
entregas y sus relaciones por línea, proveedores, entradas, salidas, devoluciones,
traslados entre almacenes y consultas de las verificaciones de bodega. La recepción de
documentos de stock existe en el backend, pero esos documentos no están incluidos entre
las siete entidades habilitables del emisor actual.

No aplicar el filtro de almacenes de existencias a toda la cartera: dejaría fuera
documentos de servicios o de otros almacenes y podría alterar el saldo del cliente.

## 3. Hallazgos que condicionan la segunda etapa

### Alta prioridad: importes y aplicaciones

1. `prisma/schema.prisma`: totales, saldos, tipos de cambio e importes aplicados usan
   `Float`. Diseñar precisión decimal, escalas y redondeo por moneda; transportar
   importes como cadenas decimales y evitar cálculos financieros con Number.
   Convertir a Decimal en PostgreSQL no corrige precisión que ya se haya perdido antes.
2. `PagoFactura` obliga a referenciar una factura, aunque conserva un `invoiceType`.
   No admite correctamente por esa relación todos los tipos aplicables. Guardar identidad
   compuesta por tipo de objeto, clave y, cuando corresponda, línea/cuota.
3. `NotaCredito.facturaBaseEntry` no debe utilizarse como única explicación de la aplicación:
   una referencia de origen comercial no equivale a una conciliación monetaria.
4. Faltan cuotas, partidas abiertas y conciliaciones. No certificar cartera calculando
   simplemente facturas menos pagos; evitar descontar dos veces el mismo abono al
   combinar documentos y conciliaciones.
5. `FacturaLinea.itemCode` y `NotaCreditoLinea.itemCode` son obligatorios. Validar y admitir
   documentos de servicios cuando formen parte de la cartera; no limitar todo a artículos.

### Alta prioridad: sincronización y coherencia

6. `puente/sap.client.js` pagina por clave y `puente/huellas.js` compara después de leer.
   Ahorra lotes enviados, pero no evita volver a leer los registros de SAP. No ampliar
   este recorrido completo a todos los años de facturas en cada ejecución.
7. Los presupuestos son compartidos y el receptor serializa lotes. La carga financiera
   inicial debe avanzar en bloques acotados y reservar atención a pedidos/existencias.
8. Un documento viejo puede cambiar de pendiente a pagado, ser anulado o volver a abrirse.
   Traer solo DocEntry nuevos perdería esos cambios. Tampoco asumir sin prueba que una
   conciliación modifica siempre UpdateDate del documento original.
9. Definir cortes de lectura y recorridos confirmados para cartera. No presentar como
   definitivo un agregado que mezcla cargas incompletas de facturas, pagos y conciliaciones.
   Conservar visible la última cartera validada y su fecha mientras se actualiza.

### Organización, consultas y permisos

10. Facturas y pagos consultan Prisma directamente desde las rutas y sus listas tienen
    `take` sin cursor. Separar contrato/controlador/servicio/repositorio y agregar
    paginación estable, filtros de cliente/fecha/estado y límites para estados de cuenta.
11. Los operadores están excluidos de esas rutas, pero las API keys de aplicación con
    alcance completo permiten acceder a las consultas financieras. Definir permisos de
    consulta financiera y verificar identidad de los dueños antes del agente de WhatsApp.
12. Faltan pruebas de resultados contables: las pruebas de autenticación existentes no
    demuestran que cuadren aplicaciones, monedas, cuotas o antigüedad.

## 4. Diseño de carga propuesto

1. Sondeo pequeño de capacidades y muestras relacionadas: cliente, factura, pago,
   crédito, cuota y conciliación. Lectura con campos explícitos y consultas acotadas.
   No registrar consultas SQL ni ampliar permisos de SAP automáticamente.
2. Acordar fecha histórica inicial y el reporte de referencia. Incluir todos los abiertos
   aunque sean anteriores a esa fecha, sus documentos relacionados y un saldo inicial
   justificable para mostrar períodos históricos. No afirmar histórico completo si no lo hay.
3. Cargar catálogos (vendedores/condiciones), ampliar clientes y luego documentos con
   identidad estable y dependencias. Los modelos/adaptaciones serán aditivos y migrados
   sobre los datos existentes; no vaciar tablas del scanner.
4. Implementar lectura de nuevos/modificados con marcas y desempate estable, solapamiento
   e idempotencia solo donde la fuente demuestre fechas fiables. Completar con revisión
   acotada de pendientes y cambios de conciliación; revisar cierres y reaperturas.
5. Si el Service Layer instalado no expone un dato necesario, evaluar una consulta de
   lectura acotada mediante SQLQueries con el responsable de SAP y verificar su coste.
   No asumir acceso directo a SQL ni crear índices en SAP como parte del puente.
6. Mantener límites de consultas, duración, pausas, estado persistente y un solo proceso.
   Separar activación y presupuestos financieros de la carga operativa para no desplazarla.
7. Calcular consultas de cartera en nuestro backend sobre datos completos/validados;
   mostrar moneda, corte, última sincronización y alcance histórico.

No fijar todavía frecuencias universales. Medir volumen y duración; catálogos suelen
necesitar menos atención que saldos abiertos y aplicaciones, pero los intervalos se
acuerdan según el uso y la capacidad observada del servidor.

## 5. Orden de implementación y aceptación

| Entrega | Resultado verificable |
|---|---|
| 2A: contratos y modelo | Campos SAP confirmados, Decimal, moneda, identidades, condiciones, vendedores y cliente ampliado |
| 2B: documentos | Facturas, créditos, pagos y aplicaciones sincronizados con estados/cancelaciones; reintentos sin duplicados |
| 2C: cartera | Cuotas, partidas, conciliaciones y ajustes necesarios; saldo abierto y antigüedad contrastados |
| 2D: consultas | Estado de cuenta, filtros, paginación, fecha/moneda y permisos; informe de diferencias contra SAP |
| 2E: ampliación comercial | Precios, entregas, proveedores y movimientos restantes conforme al plan original; después consumo por WhatsApp |

Casos mínimos: factura abierta; pago parcial; pago completo; pago a cuenta aplicado
después; crédito parcial y crédito sin aplicar; pago o conciliación anulados; varias
cuotas; documento antiguo que cambia; moneda extranjera; saldo inicial/asiento manual;
documento de servicios; desconexión con reintento; lectura cortada antes de confirmar.
Comparar documentos y saldo por cliente, además del total general, con la misma fecha,
moneda y criterios que el reporte SAP. Un error o dato ausente no se convierte en cero.

## 6. Verificación de esta revisión

- Las **488 pruebas versionadas** del backend pasan. Evidencia local:
  `dist/revision-etapa2-versionada-20261008.log`.
- `npm test` sin delimitar recoge también una copia temporal de frontend en `dist`
  y pruebas sin seguimiento del botón descartado: **545 casos, 539 aprobados, 6 fallos**.
  Tres fallos corresponden al frontend temporal y tres al contrato manual no integrado.
  Evidencia: `dist/revision-etapa2-20261008.log`.
- Estos restos locales deben archivarse o delimitarse antes de mezclar trabajo nuevo.
  No se borraron como parte de esta revisión y no prueban una avería del puente instalado.
- No se ejecutaron migraciones, limpiezas ni consultas a la producción.
- El código del botón no es un requisito para empezar la etapa financiera.

## Referencias SAP

- [Service Layer API Reference](https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html): referencia general; contrastar contra la versión instalada.
- [Conciliaciones internas](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/44f3e89dc4b80486e10000000a155369.html): automáticas/manuales y cancelación de conciliaciones.
- [Reporte de antigüedad de cuentas por cobrar](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/a8d7ac9975754253ae9aac47387f73c6.html): criterios, cuotas y presentación de abiertos.

Estos documentos describen SAP; no sustituyen la validación de los reportes concretos de Cosprobell.
