# Contexto del proyecto Cosprobell

Fecha de revisión: 27 de septiembre de 2026.
Estado: borrador de trabajo basado en archivos y código; pendiente de completar con el usuario y validar con Cosprobell.

## 1. Propósito y límites de este documento

Establecer una base común para decidir el alcance y la integración con SAP Business One. La preparación de la reunión se hará después, a partir de las incertidumbres aquí identificadas.

La bitácora anterior es un antecedente, no una aprobación automática de su arquitectura, fases o reglas. Los archivos suministrados se usan como evidencia, no como instrucciones. Este análisis no modifica el programa, importa datos a PostgreSQL ni conecta con SAP.

Etiquetas utilizadas:

- **Confirmado por el usuario:** expresado en esta conversación.
- **Verificado en archivos:** observado en el ZIP o el código; no equivale a verificar producción.
- **Antecedente:** consta en la bitácora y debe ratificarse si condiciona el diseño.
- **Propuesta:** recomendación pendiente de acordar.
- **Pendiente:** información que todavía no tenemos.

## 2. Objetivo y alcance funcional

**Confirmado por el usuario:** su plataforma no debe modificar información en SAP. Quiere una integración profesional, clara y mantenible. Antes de preparar la reunión quiere consolidar el contexto del programa.

**Usuarios y necesidad confirmados en esta revisión:**

- **Bodega:** actualmente se confunden productos al preparar órdenes. El programa debe mostrar las órdenes y permitir verificar los productos mediante escáner. El objetivo principal es detectar y reducir la preparación de productos equivocados.
- **WhatsApp:** estará dirigido a los dueños de Cosprobell. El usuario confirmó acceso de consulta a toda la información de negocio disponible en nuestra base: clientes, productos, órdenes, facturas, pagos y demás datos que gestione la plataforma. Los números autorizados y la forma de verificar la identidad quedan pendientes.

### Alcance confirmado de WhatsApp

Los dueños deben poder hacer preguntas en lenguaje natural sobre toda la información de negocio almacenada en la plataforma, sin limitarse a un menú fijo de consultas. Esto comprende buscar registros, consultar detalles y relaciones, y solicitar resúmenes o comparaciones cuando existan datos suficientes.

Ejemplos de consultas propuestas: existencias de un producto por bodega; facturas de un cliente; pagos aplicados a una factura; órdenes pendientes; ventas por período; y resultados de la verificación en bodega. Son ejemplos del alcance, no una lista cerrada ni funciones ya implementadas.

El alcance confirmado es de consulta. No se ha solicitado que WhatsApp modifique SAP ni los registros operativos locales. “Toda la información” se interpreta como información de negocio, no secretos técnicos, credenciales, hashes de API keys ni otros elementos internos de seguridad.

**Diseño propuesto:** WhatsApp se comunica con el backend, que verifica al dueño y ejecuta consultas de lectura controladas sobre la base propia. El asistente interpreta la pregunta y presenta los resultados; las credenciales y las reglas de acceso permanecen en el backend. No se debe exponer un ejecutor de SQL arbitrario al usuario o al modelo.

Para responder de forma fiable, cada consulta debe respetar la moneda, las unidades, los estados y las cancelaciones definidos para el negocio. Si faltan datos o el significado de una métrica no está acordado, debe explicarlo o pedir precisión. Debe informar la antigüedad de los datos cuando sea relevante y evitar presentar información sincronizada como si fuera una lectura actual de SAP.

**Pendientes técnicos:** selección de la integración de WhatsApp, identificación de los dueños, diccionario de métricas, límites de consultas y forma de entregar resultados extensos. No se presupone que tener acceso a todos los datos implique copiar todas las entidades de SAP; la cobertura dependerá de lo que efectivamente se sincronice y gestione en la plataforma.

**Aclaraciones posteriores del usuario:**

- La verificación se hará sobre los productos preparados, antes del despacho mediante un servicio externo de transporte.
- Se manejan tanto unidades individuales como cajas completas.
- El usuario propone trabajar por orden de venta. Su correspondencia con el documento operativo de SAP debe confirmarse con Cosprobell.
- Los códigos de barras se mantendrán en SAP; nuestra plataforma deberá consultarlos y utilizarlos. No se propone crear un catálogo independiente para mantener esos códigos.

**Pendientes expresamente aplazados por el usuario:**

1. Confirmar si la caja tiene un código distinto al de la unidad y cuál es la equivalencia por producto y presentación. No asumir que un escaneo siempre representa una unidad ni una cantidad fija por caja.
2. Confirmar si se permiten despachos parciales y quién los autoriza. No decidir todavía que una orden con faltantes puede despacharse o que necesariamente debe bloquearse.

Estos pendientes se conservarán para consultar con Cosprobell. No impiden completar el contexto de las otras funciones. Como propuesta de estados, la verificación física y la entrega al transportista deben distinguirse; registrar esta última requiere definir su alcance y responsable.

**Comportamiento propuesto para validar con bodega:** seleccionar una orden vigente, escanear cada producto, resolver su código real y mostrar si corresponde a una línea pendiente. Un código desconocido o ajeno a la orden debe generar una advertencia y no avanzar la preparación. Cantidades por empaque, faltantes, sustituciones y excepciones necesitan reglas explícitas. Debe distinguirse un código desconocido de un producto conocido que no corresponde a la orden.

**Criterios de aceptación propuestos:** detectar un producto ajeno; reconocer un producto correcto por su etiqueta; impedir completar cantidades de más; identificar lo pendiente; y dejar claro si la orden quedó verificada o con diferencias. Estos criterios requieren pruebas con las etiquetas y unidades que utiliza realmente bodega. El escaneo aporta una verificación; también hay que acordar que el personal escanee cada producto físico preparado.

**Antecedentes funcionales de la bitácora:**

| Función | Propósito | Datos que podría necesitar |
|---|---|---|
| Inventario | Consultar existencias por producto y bodega | Productos, bodegas, existencias y definición de disponibilidad |
| Verificación con escáner | Comparar productos preparados con el documento de despacho | Documento y líneas vigentes, cantidades pendientes, códigos y unidades |
| WhatsApp | Responder consultas autorizadas | Subconjunto de datos definido según quién consulta |
| Reportes | Consultar la operación comercial | Ventas, clientes, cobros y demás fuentes exigidas por cada reporte |
| Semáforo de crédito | Apoyar una evaluación con criterios aprobados por el negocio | Cartera y su composición, vencimientos, pagos, ajustes e historial |

El semáforo se planteó como una fase posterior. Los usuarios iniciales de bodega y WhatsApp están confirmados arriba; el orden de entregas y las métricas de éxito siguen pendientes de ratificación. No se asume que haya que sincronizar todas las entidades del ZIP desde el primer despliegue.

**Distinción de datos propuesta:** SAP es la fuente de los datos comerciales que se consultan. La plataforma guarda sus propios escaneos, sesiones, usuarios y auditoría. Finalizar una verificación local no crea una entrega, no reserva existencias ni actualiza el pedido en SAP.

## 3. Fuentes y alcance de la revisión

- ZIP: `C:/Users/gelsy/OneDrive/Escritorio/XML COSPROBELL.zip`.
- Bitácora: `C:/Users/gelsy/OneDrive/Escritorio/Bitacora_Proyecto_Cosprobell_SAP_B1.md`.
- Repositorio: `C:/Users/gelsy/IA/cosprobell-backend`.
- Se leyeron el esquema Prisma, las rutas de picking y productos, el montaje de rutas, la autenticación y las declaraciones de las demás rutas de negocio.
- No se ejecutaron pruebas funcionales ni se verificó el estado de una base de datos o despliegue. Los hitos de ejecución de la bitácora son antecedentes.
- No se dispone todavía del DOCX de contexto original ni del documento independiente de campos permitidos.

No se reproducen nombres de clientes, teléfonos, documentos, precios ni credenciales en este contexto.

## 4. Qué contiene el ZIP

El ZIP contiene un XML de metadatos y 13 respuestas JSON, todas legibles en esta revisión. No es una copia completa de la empresa.

| Archivo | Registros de primer nivel |
|---|---:|
| BusinessPartners.json | 5 |
| Items.json | 5 |
| ItemGroups.json | 20 |
| Warehouses.json | 20 |
| PriceLists.json | 4 |
| SalesPersons.json | 20 |
| Orders.json | 5 |
| DeliveryNotes.json | 5 |
| Invoices.json | 5 |
| CreditNotes.json | 5 |
| IncomingPayments.json | 5 |
| PurchaseDeliveryNotes.json | 5 |
| StockTransfers.json | 5 |

Los JSON contienen una referencia `odata.metadata` y una colección `value`. Sus referencias de entidad coinciden con los nombres de archivo. No incluyen un enlace de página siguiente; su ausencia no demuestra que la extracción sea completa.

`response.xml` es un documento EDMX con versión declarada 1.0, 303 declaraciones EntitySet y 272 EntityType. Describe la estructura expuesta por la API en el momento de la extracción. Esa versión EDMX no es la versión de SAP Business One.

Entre las entidades declaradas están `BarCodes`, `UnitOfMeasurements`, `UnitOfMeasurementGroups`, `PickLists`, `BinLocations`, `BatchNumberDetails`, `SerialNumberDetails`, `InternalReconciliations` y `PaymentTermsTypes`. No hay muestras separadas de ellas en el ZIP. Que aparezcan declaradas no demuestra permisos efectivos, datos existentes o uso en Cosprobell.

Los archivos no permiten confirmar disponibilidad actual del servicio, versión y patch de SAP, licencia, autorización, capacidad, red ni funcionamiento de Insitu.

## 5. Hallazgos que condicionan el programa

### 5.1 Códigos de barras y unidades

**Verificado:** los cinco productos tienen `BarCode` vacío y sus colecciones `ItemBarCodeCollection` están vacías. El XML declara tanto esa colección como la entidad `BarCodes`. El tipo `ItemBarCode` incluye `Barcode` y `UoMEntry`.

**Implicación:** la muestra no permite validar el reconocimiento de etiquetas reales. No se debe concluir que la empresa carece de códigos de barras. Hay que confirmar dónde se mantienen y cómo se relacionan con productos, unidades, cajas y paquetes.

Las líneas de pedido incluyen `UoMEntry`, `UoMCode`, `InventoryQuantity`, `RemainingOpenQuantity` y `RemainingOpenInventoryQuantity`. Su interpretación operativa debe acordarse antes de decidir cuánto suma cada escaneo.

### 5.2 Pedidos y preparación

**Verificado:** los cinco pedidos están en `bost_Close`. Sus diez líneas no tienen `RemainingOpenQuantity` mayor que cero.

**Implicación:** hace falta una muestra de un pedido abierto y otra de un despacho parcial para validar la preparación. La cantidad original del pedido no debe asumirse automáticamente como la cantidad pendiente de preparar.

**Pendiente:** confirmar si la operación parte de `Orders`, de `PickLists` o de otro documento; cuándo un pedido está autorizado para preparación; cómo se manejan modificaciones, cancelaciones y varias sesiones de preparación.

### 5.3 Catálogo de bodegas incompleto

**Verificado:** cada producto incluye 99 o 100 registros de existencias por bodega. En conjunto aparecen 100 códigos de bodega, pero el catálogo contiene 20. Hay 80 códigos referenciados ausentes del catálogo recibido.

**Implicación:** completar las dependencias antes de importar. No crear nombres de bodegas ficticios para hacer pasar la carga. Definir qué bodegas son relevantes para venta, despacho, tránsito o mercadería no disponible.

### 5.4 Muestras sin relaciones completas

**Verificado:** los cinco pedidos referencian clientes ausentes de los cinco BusinessPartners recibidos; sus diez líneas referencian productos ausentes de los cinco Items. Las once aplicaciones de cobro referencian facturas ausentes de las cinco Invoices recibidas.

**Implicación:** no es un juego de datos integral para cargar directamente respetando todas las relaciones. Esto no prueba errores en SAP: puede ser consecuencia de muestras independientes. Hace falta un conjunto conectado de cliente, productos, bodegas, pedido y documentos relacionados.

### 5.5 Documentos base y cancelaciones

**Verificado:** las 14 líneas de factura tienen `BaseType = -1`. En entregas hay 21 líneas con `-1` y seis con `15`; ninguna tiene `17`. No queda demostrado un flujo pedido-entrega con esta muestra.

La bitácora interpretó incorrectamente `15` como pedido. En SAP Business One, `15` identifica entrega y `17` pedido de venta. Fuente: [guía oficial de Service Layer, ejemplo de entrega basada en pedido](https://help.sap.com/doc/0d2533ad95ba4ad7a702e83570a21c32/9.3/en-US/Working_with_SAP_Business_One_Service_Layer.pdf).

La muestra de entregas incluye los estados `csNo`, `csYes` y `csCancellation` en `CancelStatus`; una tiene `Cancelled` nulo. También hay estados de cancelación en entradas de mercancía. Debe conservarse su significado antes de derivar indicadores o totales; no convertir ciegamente un nulo en un documento vigente.

### 5.6 Clientes, proveedores y cobros

**Verificado:** los cinco socios de negocio recibidos son `cCustomer`. El XML también declara `cSupplier`, pero el ZIP no aporta socios de ese tipo. Falta resolver la fuente de proveedores si las entradas de mercancía entran en alcance.

Uno de los cinco pagos no tiene aplicaciones; los otros reúnen once aplicaciones de tipo `it_Invoice`. No se debe exigir que todo pago esté aplicado. El XML declara otros tipos de documentos aplicables: el modelo actual pago-factura no debe generalizarse sin revisar el alcance real.

Las facturas de la muestra sí incluyen `PaidToDate`. Eso no basta para certificar una reconstrucción completa de cartera o del historial de pago: faltan reglas de moneda, conciliaciones, cuotas, notas de crédito, cancelaciones y validación de contabilidad según los reportes pedidos.

### 5.7 Campos personalizados

Hay campos `U_*`, entre ellos `U_RTN`, `U_TIPOCLIENTE`, `U_ZONA`, `U_munilist`, `U_TIPO`, `U_TIPOFACTURA`, `U_GIRA`, `U_CAI`, `U_credito` y `U_Vendedor`, según la entidad.

Sus nombres no prueban su significado ni que deban copiarse. Se necesita un diccionario de negocio y una selección de campos justificada por cada función.

## 6. Estado comprobable del backend

**Actualización de estructura:** posteriormente a la revisión inicial, el usuario autorizó redistribuir el proyecto. Las rutas se agruparon en `src/modules`, productos se separó por capas y la conexión/utilidades pasaron a `src/infrastructure` y `src/shared`. Se separaron `app.js` y `server.js`, y pasaron 12 pruebas con persistencia simulada. Consultar [la estructura actual](ESTRUCTURA_PROYECTO.md). Esto no valida una base real ni cambia los pendientes funcionales descritos abajo.

**Verificado en código:**

- Node.js con módulos ESM, Express, Prisma y PostgreSQL; hay 31 modelos Prisma, incluido `ApiKey`.
- Rutas para productos, bodegas, clientes, facturas, pagos y sesiones de picking.
- Autenticación de aplicaciones mediante API keys con hash, y validación de entradas.
- Modelos para registrar sincronizaciones, lotes y errores.
- No hay un conector SAP ni rutas de recepción de lotes montadas en el servidor revisado.
- `requireBridgeAuth` es un placeholder que llama a `next()`; no implementa autenticación y no está montado como una ruta de sincronización.

**Diferencias relevantes entre el prototipo y la operación propuesta:**

| Área | Comportamiento actual | Decisión o trabajo pendiente |
|---|---|---|
| Escaneo | Compara el código recibido con `itemCode` y suma uno | Resolver código de barras, unidad y cantidad correspondiente |
| Inicio de picking | Copia todas las líneas y su cantidad original | Seleccionar líneas elegibles, pendientes, bodega y unidad |
| Estado del pedido | No comprueba si está cerrado o cancelado al iniciar | Definir y aplicar elegibilidad del documento |
| Persona responsable | `usuarioId` llega como texto del solicitante | Identidad autenticada si se requiere trazabilidad personal |
| Evolución del pedido | Guarda una copia de líneas al iniciar | Decidir qué ocurre si SAP cambia el pedido durante el trabajo |
| Concurrencia | Hay actualización atómica de cantidades por línea | Validar también cierre simultáneo, reintentos y sesiones duplicadas |
| Auditoría de escaneo | Guarda el último código y momento por línea | Definir si se necesita un historial individual de eventos |
| Unidades y pendientes | `PedidoLinea` no conserva los campos citados en 5.1 | Ajustar el modelo al flujo acordado |
| Importes | Los campos monetarios usan `Float` | Proponer decimal y reglas de precisión antes de usar resultados contables |
| Sincronización | Existen tablas, sin implementación del flujo | Diseñar contrato, identidad, reintentos, orden y recuperación |

Esto confirma que existe una base de implementación. No certifica que esté lista para operar con SAP real. La revisión inicial fue de lectura; la posterior redistribución y sus pruebas se documentan al principio de esta sección.

## 7. Arquitectura candidata

**Propuesta, no decisión cerrada:** usar Service Layer como interfaz, un servicio independiente de sincronización y la base propia para atender las aplicaciones.

Recorrido de datos:

`SAP → Service Layer → servicio de sincronización → API del backend → PostgreSQL → API de consulta → aplicaciones`

El sincronizador inicia las lecturas a SAP y los envíos al backend. Si se instala dentro de la red de Cosprobell, necesita conexión interna con SAP y salida HTTPS hacia el backend. El acceso de instalación y soporte se acuerda por separado. Railway es una elección previa del proyecto, pendiente de ratificar con la propiedad y operación del despliegue.

La ubicación del servicio depende de la infraestructura disponible: equipo de integración local, nube con conectividad privada o servicio administrado por el proveedor. Antes de desarrollar uno nuevo, evaluar qué ofrece y mantiene ya el proveedor.

La documentación de Service Layer lo describe como una interfaz HTTP/OData para objetos de negocio: [SAP Help](https://help.sap.com/docs/SAP_BUSINESS_ONE/f110a154dd0f4c20bf7f3ebca9eeb794/60c7a0b745bd486589f05a1da77041f3.html?locale=en-US&state=PRODUCTION&version=10.0). La compatibilidad concreta se debe confirmar en la instalación.

### Requisitos de funcionamiento propuestos

- Usuario exclusivo, permisos mínimos verificados y autenticación independiente para el envío al backend.
- Selección explícita de datos y comunicación cifrada con validación de certificados.
- Carga inicial y actualización posterior, con páginas y carga controlada.
- Estrategia por entidad para detectar modificaciones, cierres, cancelaciones y bajas.
- No asumir que `UpdateDate` del producto detecta todos los cambios de existencias. Validarlo y definir cómo contrastar periódicamente la copia con SAP.
- Reintentos que no dupliquen registros ni sobrescriban datos nuevos con versiones antiguas.
- Confirmar un lote y avanzar su punto de recuperación solo después de persistirlo correctamente.
- Definir qué significa una colección anidada: completa o parcial; cómo actualizar o retirar líneas, precios y existencias sin dejar restos ni borrar información válida.
- Registrar última sincronización exitosa, antigüedad de datos y fallos, con responsable de atención.
- Acordar cuánto retraso tolera cada función y qué hacer si la información queda desactualizada.
- Si hay varias empresas SAP, incluir la empresa en las claves de origen; los identificadores actuales asumen un solo ámbito por entidad.

La cola local, el programador, la firma de solicitudes y el gestor de procesos se elegirán después de definir estos requisitos. Las herramientas mencionadas en la bitácora son opciones, no requisitos confirmados.

## 8. Insitu: evidencia y límites

**Confirmado por el usuario:** Cosprobell utiliza una plataforma llamada Insitu, asociada a su proveedor de SAP.

**Pendiente:** confirmar que sea inSitu Sales y conocer su instalación concreta.

La guía pública de inSitu Sales describe un instalador local y referencias a DI API y componentes HANA. Es evidencia sobre ese producto, no sobre cómo está configurado en Cosprobell: [guía del proveedor](https://insitusales.zendesk.com/hc/en-us/articles/360049279071-How-to-set-up-your-SAP-Integration).

Conocer el conector existente puede ayudar a identificar infraestructura y responsables. No supone reutilizar sus credenciales, modificar su servicio ni asumir que nuestra plataforma debe depender de su copia de datos.

## 9. Decisiones abiertas para completar el contexto

### Con el usuario y responsables de operación

1. Detalle del flujo de bodega: selección de órdenes, escaneo, correcciones y responsable que autoriza finalizar. Usuarios y problema principal ya confirmados en la sección 2.
2. Alcance inicial: inventario, verificación de pedidos y consultas WhatsApp; qué entra primero.
3. WhatsApp: acceso a toda la información de negocio de la base confirmado. Falta definir cómo autenticar a los dueños, las métricas de negocio y la presentación de respuestas extensas.
4. Documento que inicia la preparación y reglas de faltantes, parciales, cambios y finalización.
5. Definición de inventario disponible y bodegas que participan.
6. Criterios de éxito: errores que se pretende reducir, tiempo de preparación y retraso aceptable de datos.
7. Responsables y propiedad de infraestructura, datos, soporte y costos.

### Con el administrador de SAP y el proveedor

1. Versión, patch, motor de base de datos, empresa o empresas e interfaz soportada.
2. Entorno de pruebas, acceso, permisos, condiciones de licencia y certificados.
3. Infraestructura de integración existente, incluida Insitu.
4. Muestras conectadas: pedido abierto, parcial y cancelado con sus catálogos y documentos relacionados.
5. Códigos reales, unidades, lotes, series, ubicaciones y campos personalizados usados.
6. Volumen, histórico, frecuencia, selección de campos y mecanismo de cambios por entidad.

## 10. Siguiente paso

El usuario ya definió la verificación en bodega antes del despacho, el manejo de unidades y cajas y la consulta de toda la información de negocio por los dueños mediante WhatsApp. Se preparó el [mapa de datos y trabajo pendiente](MAPA_DATOS_COSPROBELL.md), que contrasta esas necesidades con las fuentes SAP y el modelo actual.

El siguiente paso es validar con Cosprobell las decisiones abiertas y obtener ejemplos conectados: documento operativo, códigos y equivalencias, parciales, estados y acceso a SAP. Estos puntos formarán la agenda de reunión. Después se ajustará el modelo y se probará una primera sincronización y verificación de orden antes de ampliar la cobertura.
