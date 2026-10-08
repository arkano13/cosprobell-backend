# Mapa de datos y trabajo pendiente

Fecha: 27 de septiembre de 2026.
Ampliación del alcance financiero: 6 de octubre de 2026 (sección 7). Las secciones anteriores conservan el contexto histórico; no describen el estado actual del despliegue.
Estado: propuesta basada en el ZIP, el esquema Prisma y el alcance acordado en la conversación.

Complementa [el contexto del proyecto](CONTEXTO_PROYECTO_COSPROBELL.md). No es una migración ni un contrato definitivo de integración. “Existe en el modelo” significa que hay una estructura local para guardarlo; no demuestra que ya esté sincronizado ni que cubra todos los casos reales.

## 1. Resultado esperado

- **Bodega:** verificar productos preparados antes del despacho por transporte externo, trabajando con unidades y cajas. Se propone usar órdenes de venta; falta confirmar su correspondencia con el proceso de SAP.
- **Dueños:** consultar por WhatsApp toda la información de negocio disponible en la base propia, incluyendo relaciones y resúmenes cuando los datos permitan responder.
- **Integración:** lectura de SAP y almacenamiento propio de verificaciones. Los códigos de barras se mantienen en SAP.

## 2. Datos para verificar órdenes

| Necesidad | Fuente observada en SAP | Estado local | Trabajo pendiente |
|---|---|---|---|
| Identificar producto | `Items`: `ItemCode`, `ItemName`, estado | `Producto` existe | Sincronizar y acordar tratamiento de inactivos |
| Resolver etiqueta escaneada | `BarCode`, `ItemBarCodeCollection`; entidad `BarCodes` declarada | `Producto.barCode` y `ProductoCodigoBarras.codigo` existen | Elegir fuente, guardar asociación con unidad y resolver código al escanear |
| Diferenciar caja y unidad | `ItemBarCode.UoMEntry`; unidades y grupos declarados en XML | Falta asociación del código con unidad y modelo de equivalencias | Obtener ejemplo real y validar conversión por producto; conservar códigos como texto |
| Identificar orden | `Orders`: `DocEntry`, `DocNum`, `CardCode`, fechas y estados | `Pedido` existe | Lectura/listado de órdenes para la app, sincronización y reglas de elegibilidad |
| Mostrar cliente de la orden | `BusinessPartners` y `Orders.CardCode` | `Cliente` y relación del pedido existen | Obtener clientes relacionados con las órdenes de prueba |
| Identificar línea | `DocumentLines`: `LineNum`, `ItemCode`, descripción | `PedidoLinea` existe | Conservar identidad por orden y línea, incluso si un producto se repite |
| Conocer lo pendiente | `Quantity`, `RemainingOpenQuantity`, `LineStatus` | Cantidad original y estado; falta cantidad pendiente | Incorporar pendientes y definir qué cantidad debe verificarse en esta salida |
| Interpretar cantidades | `UoMEntry`, `UoMCode`, `InventoryQuantity`, `RemainingOpenInventoryQuantity` | No conservados en `PedidoLinea` | Definir una unidad de comparación y conversiones trazables |
| Identificar bodega | `WarehouseCode` y catálogo `Warehouses` | Está en `PedidoLinea`, no en `PickingPedidoLinea` | Conservar contexto de bodega en la verificación y completar catálogo |
| Detectar cambios | Estados, cancelación, `UpdateDate`, `UpdateTime` | Estados y fecha parcial; falta política de versiones | Detectar una orden modificada durante su revisión y acordar respuesta |
| Registrar revisión | Datos propios de la app | Sesión y cantidades por línea existentes | Identidad del encargado, eventos de escaneo, correcciones y cierre consistente |

### Dos decisiones aplazadas

1. **Cajas:** confirmar códigos distintos y equivalencias. Si una etiqueta es ambigua, el programa no debe escoger automáticamente una presentación sin una regla acordada.
2. **Faltantes:** confirmar si permiten salidas parciales y quién las autoriza. La cantidad pendiente en SAP no demuestra por sí sola qué parte se autorizó enviar en esta salida.

La verificación debe comparar producto y cantidad con la orden vigente. No equivale a registrar una entrega en SAP ni demuestra por sí sola que el transportista recibió la mercadería.

## 3. Datos para consultas por WhatsApp

El acceso abarcará toda la información de negocio de la base. La cobertura se habilitará conforme se sincronice y valide cada conjunto; tener una tabla no basta para prometer una respuesta correcta.

| Tema | Fuentes de la muestra o XML | Cobertura local actual | Pendiente principal |
|---|---|---|---|
| Productos y grupos | `Items`, `ItemGroups` | Modelos y consultas de productos | Sincronización, búsqueda por etiquetas y datos completos |
| Existencias por bodega | `ItemWarehouseInfoCollection`, `Warehouses` | Modelos y consulta por producto | Completar bodegas, definir disponibilidad y actualización de existencias |
| Precios | `ItemPrices`, `PriceLists` | Modelos y precios en detalle de producto | Validar lista, moneda y alcance; no asumir que una lista es el precio final de cada cliente |
| Clientes | `BusinessPartners` | Modelo y consultas | Catálogo completo autorizado, significado de campos y relaciones |
| Órdenes | `Orders` y líneas | Modelos, usados al iniciar picking | Consultas de órdenes, pendientes y estados; aún no hay integración real |
| Entregas | `DeliveryNotes` y líneas | Modelos | Consulta, sincronización y enlaces por línea con documentos de origen |
| Facturas | `Invoices` y líneas | Modelos y consultas | Monedas, cancelaciones, precisión de importes y definición de ventas |
| Notas de crédito | `CreditNotes` y líneas | Modelos | Consulta y relación por línea; no asumir una única factura base para todos los casos |
| Cobros y aplicaciones | `IncomingPayments`, `PaymentInvoices` | Modelos y consulta de pagos | Validar medios de pago, importes, moneda y tipos de documento aplicados |
| Saldos y vencimientos | Saldos de cliente, facturas, pagos; `InternalReconciliations` y `PaymentTermsTypes` declarados | Cobertura parcial | Caso validado por contabilidad; decidir necesidad de cuotas y conciliaciones |
| Vendedores | `SalesPersons`, códigos en clientes/documentos | Catálogo y códigos en modelos | Consulta y vínculos para agrupaciones fiables |
| Entradas y proveedores | `PurchaseDeliveryNotes`; tipo `cSupplier` declarado | Entrada y proveedor mínimo | Muestra de proveedores, sincronización y consultas |
| Traslados | `StockTransfers` y líneas | Modelos | Sincronización y consultas; mantener origen y destino por línea |
| Verificaciones de bodega | Datos propios | Sesiones y líneas | Identidad y auditoría suficientes para responder quién verificó y con qué resultado |

La combinación de entradas y traslados de la muestra no constituye un historial completo de movimientos de inventario. No se deben sumar estos movimientos a las existencias ya consolidadas para calcular el stock actual.

### Definiciones necesarias para responder con precisión

- **“Disponible”:** acordar cómo intervienen existencias, compromisos y bodegas excluidas.
- **“Ventas”:** acordar documento, período, fecha, impuestos, notas de crédito, cancelaciones y moneda.
- **“Debe un cliente”:** distinguir saldo total, facturas abiertas y saldo vencido; verificar el resultado con contabilidad.
- **“Pendiente”:** distinguir pendiente en SAP, pendiente de verificación y pendiente de entrega al transportista.
- **“Hoy”:** acordar zona horaria y fecha de corte, y mostrar la antigüedad de la última sincronización cuando afecte la respuesta.

Estos puntos son definiciones del programa, no asesoría contable. Se validarán con quien conoce la operación.

## 4. Orden de trabajo propuesto

1. **Contexto y mapa:** esta versión recoge usuarios, propósito, fuentes, diferencias del modelo y decisiones pendientes.
2. **Validación con Cosprobell:** confirmar el documento operativo, códigos/unidades, parciales y acceso a SAP. Pedir ejemplos conectados, no solamente archivos independientes.
3. **Ajustes del backend:** adaptar etiquetas y unidades, cantidades pendientes, estados, identificación del encargado y precisión de datos. Diseñar recepción y seguimiento de la sincronización.
4. **Primera integración comprobable:** cargar clientes y catálogos necesarios, una orden abierta y sus líneas; comparar la copia con SAP. Verificar actualizaciones y recuperación tras fallos antes de ampliar la carga.
5. **Primera verificación completa:** seleccionar orden, escanear productos reales, detectar diferencias y registrar el cierre según las reglas acordadas.
6. **Consultas de los dueños:** incorporar y validar los conjuntos comerciales restantes, identidad de los dueños y herramientas de consulta. Cada respuesta debe basarse en datos disponibles y reglas explícitas.

Este orden es una propuesta técnica; no establece fechas ni reduce el alcance de consulta solicitado.

## 5. Evidencia que falta conseguir

- Una orden abierta con su cliente, productos y bodegas correspondientes.
- Un producto vendido por unidad y caja, con sus códigos cargados y equivalencia conocida; si el comportamiento varía, un ejemplo por modalidad.
- Un caso parcial, si se permite, y un caso cancelado o modificado para verificar la respuesta del programa.
- Una factura con su cliente y pago aplicado, y una nota de crédito relacionada para validar consultas comerciales.
- Catálogos completos dentro del alcance, histórico autorizado y reglas para actualizar datos.
- Interfaz SAP disponible, versión, permisos, ambiente de pruebas, conectividad y responsable operativo.

## 6. Qué no se ha hecho en esta etapa

No se modificó el esquema Prisma, no se ejecutaron migraciones, no se cargaron las muestras a una base ni se conectó a SAP. Los cambios de implementación dependerán de las reglas y ejemplos que faltan. Las tablas anteriores describen fuentes observadas y trabajo pendiente, no funcionalidades certificadas en producción.

## 7. Alcance financiero acordado — 6 de octubre de 2026

El usuario pidió incorporar a la lista de trabajo futuro los requisitos de cartera y estado de cuenta que no estuvieran contemplados. Este cambio es de planificación: no implementa nuevas consultas, migraciones ni sincronización en SAP o Railway. La ampliación se hará sobre el mismo puente, con lectura de SAP y procesamiento en nuestra base; no escribirá cobros ni conciliaciones en SAP.

### 7.1 Lista consolidada que debe cubrir la ampliación

| Conjunto | Datos y resultado requerido |
|---|---|
| Clientes | Código, nombre, saldo actual, estado activo/inactivo, vendedor, condiciones de pago y zona/ruta cuando exista en SAP. Confirmar significado de campos personalizados; no asumir que U_ZONA equivale a ruta. |
| Facturas | Identificador interno y número visible, cliente, fecha, vencimiento, total, saldo pendiente, estado y cancelación/anulación. Conservar moneda e identidad suficiente para no confundir documentos con igual número de distintas series. |
| Pagos recibidos | Número/documento, cliente, fecha, monto total, facturas/documentos a los que se aplicó y monto aplicado por factura/documento. Conservar pagos sin aplicar, aplicaciones parciales y cancelaciones. |
| Notas de crédito | Número, cliente, fecha, monto y aplicación real: documento y monto aplicado, saldo sin aplicar si corresponde y cancelación. La relación de documento base no sustituye una aplicación o conciliación posterior. |
| Cartera abierta | Documentos y partidas abiertas, saldo pendiente real, vencimientos, antigüedad y distinción entre saldo total, vencido y a favor. Incluir conciliaciones/aplicaciones necesarias para justificar exactamente qué queda pendiente. |
| Vendedores y condiciones de pago | Código y nombre del vendedor y de la condición del cliente, más datos necesarios para interpretar vencimientos. Diferenciar valores actuales del cliente de los que correspondían al documento. |
| Estado de cuenta | Movimientos del período, saldo inicial del período, cargos, abonos y saldo final explicable, enlazados con documentos y aplicaciones. Definir fecha de corte y profundidad del histórico antes de implementar. |

### 7.2 Qué se agrega y qué se hace obligatorio

**Requisitos que ahora quedan explícitos y no estaban detallados como entregables:**

1. Zona/ruta del cliente, si existe el dato, con su diccionario de negocio.
2. Cartera por antigüedad y vencimientos, con fecha de corte y rangos acordados; no solo consultar un saldo agregado.
3. Estado de cuenta completo y trazable de cada cliente: saldo inicial, movimientos y saldo final.
4. Comprobación de que el saldo pendiente y el estado de cuenta coinciden con los reportes de SAP, para la misma fecha, moneda y criterios. Una diferencia pendiente de explicar no se presentará como dato definitivo.

**Ya mencionados, pero ahora se convierten en parte necesaria del alcance cuando afecten al saldo:**

- Conciliaciones internas y aplicaciones posteriores, parciales o canceladas. Antes se dejaba abierta la decisión de si eran necesarias.
- Cuotas y sus vencimientos individuales.
- Importe aplicado de cada pago y nota de crédito, importes no aplicados y su efecto en el saldo a favor.
- Estados, cancelaciones, monedas y precisión de importes. Los catálogos/documentos ya estaban previstos; ahora se exige su efecto correcto en cartera.
- Condiciones de pago del cliente: ya figuraba PaymentTermsTypes como fuente; se formaliza como dato consultable junto al vendedor.

Facturas, pagos, notas de crédito, vendedores y saldo del cliente no son entidades recién añadidas al plan: ya estaban en la sección 3. Código, nombre y estado del cliente también estaban contemplados. La lista del usuario precisa los campos mínimos de cada una.

### 7.3 Datos de apoyo necesarios para reconstruir correctamente

Como parte del pedido de incluir otros datos necesarios, se investigarán e incorporarán cuando existan y afecten a la cuenta:

- Saldos iniciales y asientos contables manuales del cliente.
- Pagos a cuenta, anticipos y otros créditos pendientes, sin asignarlos ficticiamente a facturas.
- Anulaciones y reversos de documentos, pagos y conciliaciones.
- Moneda del documento, moneda local/sistema y tipos de cambio pertinentes, evitando sumar importes de monedas distintas.
- Identificadores de sociedad, tipo/documento, línea contable y aplicación necesarios para enlazar sin duplicar.
- Fecha de corte y momento de sincronización. No confundir el saldo actual con un saldo reconstruido a una fecha pasada.

No se promete una entidad o endpoint concreto sin verificar su disponibilidad, campos y permisos en el SAP B1 FP 2111 instalado. No se descargará toda la contabilidad si basta el subconjunto de cuentas de clientes necesario.

### 7.4 Orden y criterio de terminación

1. Confirmar reporte de SAP de referencia, fecha/moneda, histórico requerido y significado de zona/ruta.
2. Verificar datos accesibles por Service Layer y consultas oficiales, incluyendo saldos abiertos y conciliaciones.
3. Ampliar clientes y catálogos; después documentos, aplicaciones y partidas necesarias. Revisar almacenamiento decimal de importes antes de calcular cartera.
4. Sincronizar con presupuestos y frecuencias propios; detectar cambios en documentos antiguos que reciben pagos o conciliaciones nuevas. No basta traer documentos recién creados.
5. Validar factura abierta, pago parcial/total, pago a cuenta, nota de crédito parcial/no aplicada, cancelación, conciliación posterior/anulada, cuotas, saldo inicial y moneda extranjera cuando apliquen.
6. Habilitar consultas de cartera/estado de cuenta, incluidas las futuras de WhatsApp, solo cuando el resultado cuadre con SAP y se informe su fecha de actualización.

El filtro de los siete almacenes de inventario no se aplicará automáticamente a cartera: podría omitir documentos o aplicaciones necesarios para cuadrar el saldo del cliente. El alcance financiero se determina por sociedad/clientes y los criterios contables acordados.
