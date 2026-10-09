# Bitácora del proyecto — Cosprobell · SAP Business One

Última actualización: 30 de septiembre de 2026.

## Procedencia

Esta bitácora continúa el seguimiento dentro del repositorio. El archivo original se leyó al inicio de la conversación en `C:/Users/gelsy/OneDrive/Escritorio/Bitacora_Proyecto_Cosprobell_SAP_B1.md`, pero ya no estaba disponible en esa ruta al solicitarse esta actualización. No se sobrescribió el original ni se recuperó aquí su historial completo.

Los hitos anteriores se resumen como antecedentes de aquella bitácora. Se distinguen de lo verificado en esta sesión.

Documentos de referencia:

- [Contexto del proyecto](CONTEXTO_PROYECTO_COSPROBELL.md).
- [Mapa de datos y trabajo pendiente](MAPA_DATOS_COSPROBELL.md).
- [Estructura del backend](ESTRUCTURA_PROYECTO.md).

## 1. Estado actual

| Área | Estado y evidencia |
|---|---|
| Backend Express, Prisma y PostgreSQL | Base existente; funcionamiento inicial documentado en septiembre de 2026 en la bitácora anterior |
| Revisión de metadatos y muestras | ZIP revisado: XML de metadatos y 13 archivos JSON |
| Contexto funcional | Bodega y consulta por WhatsApp para los dueños definidos; quedan reglas operativas pendientes |
| Organización del código | Redistribución autorizada y aplicada; productos separado por capas |
| Pruebas automatizadas | Usuario confirmó funcionamiento de reintentos e historial; nueva entrega de inicio con 162 de 162 aprobadas por el asistente en copia temporal; secciones 13 y 14 |
| Picking por capas | Completada la separación en rutas, schemas, controlador, servicio y repositorio; conservado el comportamiento anterior |
| Concurrencia de picking | Transacción con bloqueo de sesión y retirada de `SKIP LOCKED`; seis escenarios contra PostgreSQL aprobados según resultados compartidos y confirmación del usuario; detalle en sección 11 |
| Búsqueda por código de barras | Código principal, adicional, inexistente y ambiguo comprobados manualmente por el usuario contra su base configurada |
| Conexión de búsqueda con escaneo | Integración incorporada al proyecto; suite y demo aprobadas según salida del usuario: etiqueta confirmada, unidades compatibles y código leído persistido; sección 12 |
| Errores con `AppError` | Clase y manejador central implementados y probados; falta migrar las respuestas directas de las rutas |
| Validación de peticiones | Distingue errores de Zod de fallos internos; 4 pruebas adicionales aprobadas |
| Validación de configuración | Implementada en `env.schema.js`, utilizada por `env.js` y Prisma; seis pruebas adicionales aprobadas por el usuario |
| Cierre ordenado | Implementado en `shutdown.js`, con cinco casos de prueba; confirmación general del usuario, sin verificación manual de señales reportada |
| Integración real con SAP | Pendiente de accesos, infraestructura, reglas y construcción del sincronizador |
| WhatsApp | Alcance definido, integración no implementada |

## 2. Antecedentes resumidos

La bitácora anterior documentó la construcción inicial del backend el 16 y 17 de septiembre: endpoints de productos, bodegas, clientes, facturas, pagos y picking; datos sintéticos; validación con Zod; API keys con hash; y actualización atómica de cantidades durante el escaneo.

Ese antecedente no certifica todas las condiciones de concurrencia ni la preparación para producción. La revisión actual identifica trabajo pendiente en unidades, códigos, parciales, cierre de picking, identidad de personas y sincronización.

La arquitectura anterior se usa como referencia, no como restricción definitiva. El usuario pidió revisar la solución para que sea mantenible y aclaró que su aplicación no modificará información de SAP.

## 3. Acuerdos funcionales de esta sesión

- **Bodega:** reducir confusiones entre productos mediante escaneo de la mercadería preparada antes del despacho.
- **Transporte:** el envío se realiza mediante un servicio externo. Una verificación local no equivale a confirmar la recepción por el transportista.
- **Documento propuesto:** orden de venta. Falta validar su correspondencia con el documento operativo que utiliza Cosprobell en SAP.
- **Presentaciones:** unidades individuales y cajas completas.
- **Códigos de barras:** se mantendrán en SAP y nuestra plataforma los consultará.
- **Pendiente:** confirmar si caja y unidad tienen etiquetas diferentes y cómo se define la equivalencia por producto.
- **Pendiente:** confirmar si se permiten despachos parciales y quién los autoriza. El usuario aplazó estas respuestas para consultar con Cosprobell.
- **WhatsApp:** los dueños podrán consultar toda la información de negocio disponible en nuestra base mediante lenguaje natural: clientes, productos, facturas, pagos, órdenes y demás datos gestionados. No implica acceso a secretos técnicos ni autorización de escritura.

## 4. Hallazgos de los archivos

Los detalles y sus implicaciones están en el contexto y mapa de datos. Los puntos principales son:

- Los cinco productos de la muestra tienen vacíos sus códigos de barras. El XML sí declara campos y entidades para códigos y su asociación con unidades; esto no implica necesidad de crear campos nuevos en SAP.
- Los cinco pedidos recibidos están cerrados. Hace falta una orden abierta para validar el flujo.
- Los productos referencian 100 códigos de bodega; el catálogo recibido contiene 20.
- Pedidos, clientes, productos y aplicaciones de pago no forman un conjunto conectado dentro del ZIP.
- El modelo de líneas de pedido aún no conserva cantidades pendientes ni los campos de unidades observados en SAP.
- Se corrigió la interpretación de la bitácora anterior: `BaseType = 15` no identifica un pedido de venta; el pedido corresponde a `17`. La muestra no demuestra un flujo pedido-entrega completo. Véase la fuente oficial enlazada en el contexto.

## 5. Redistribución del proyecto

El usuario autorizó expresamente al asistente a redistribuir el código. Se conservaron las reglas existentes y se actualizaron imports y comandos.

| Antes | Ahora |
|---|---|
| `src/index.js` configuraba e iniciaba Express | `src/app.js` configura y `src/server.js` inicia; `src/index.js` conserva compatibilidad |
| `src/routes/*.js` | `src/modules/<modulo>/<modulo>.routes.js` |
| `lib/prisma.js` | `src/infrastructure/database/prisma.js` |
| `lib/hash.js` | `src/shared/security/hash.js` |
| `lib/zodHelpers.js` | `src/shared/validation/safeString.js` |
| `lib/buscarProductoPorCodigo.js` | Función en `src/modules/productos/productos.service.js`, consulta en `productos.repository.js` |
| `src/middleware/auth.js` | `src/middleware/authenticate.js` |

Productos tiene cinco capas/archivos: rutas, schemas, controlador, servicio y repositorio. Los demás módulos siguen con sus manejadores dentro de las rutas; se separarán conforme avancemos en las sesiones guiadas.

Se añadió `src/infrastructure/logging/logger.js` y se mantuvo la ocultación de encabezados de autenticación. Se actualizaron los scripts y el seed para utilizar las nuevas rutas.

No se modificaron el esquema Prisma, las migraciones ni la base de datos durante la redistribución. La configuración estricta, el cierre ordenado y el manejador de errores se implementaron posteriormente en el trabajo guiado descrito en la sección 8.

## 6. Búsqueda por código de barras

La función consulta:

- `Producto.barCode` como código principal.
- `ProductoCodigoBarras.codigo` como código adicional.

Devuelve `codigo_invalido`, `no_encontrado`, `codigo_ambiguo` o `encontrado` con el producto. Conserva ceros iniciales y elimina espacios exteriores. No decide todavía si el código corresponde a una caja o a una unidad ni cuánto debe sumar un escaneo.

Durante el trabajo guiado se detectó y corrigió `barcode` por `barCode`, respetando el nombre real del campo Prisma. Se unificó el resultado ambiguo como `codigo_ambiguo`.

### Comprobaciones manuales reportadas por el usuario

Script: `scripts/probar-codigo-de-barras.js`.

| Comando | Resultado observado |
|---|---|
| `node scripts/probar-codigo-de-barras.js 0012345678905` | `encontrado`: `PROD-001`, Agua embotellada 600ml |
| `node scripts/probar-codigo-de-barras.js CODIGO-INEXISTENTE` | `no_encontrado` |
| `node scripts/probar-codigo-de-barras.js 0098765432105` | `encontrado`: código adicional asociado a `PROD-001` |
| `node scripts/probar-codigo-de-barras.js TEST-AMBIGUO-001` | `codigo_ambiguo`: etiqueta ficticia asociada a `PROD-001` y `PROD-002` |

Estas salidas confirman los cuatro casos ejecutados contra la base configurada por el usuario. No constituyen una prueba de conexión con SAP.

**Incidencia al preparar los datos:** inicialmente no había códigos adicionales persistidos para `PROD-001`, confirmado por una consulta de lectura. Studio mostró `Failed to fetch`; no se estableció su causa. Al continuar en HeidiSQL, la tabla no aparecía porque esa sesión usaba la base `postgres`, mientras el programa usaba `railway`. Tras corregir la conexión y preparar el registro, la búsqueda adicional funcionó. No se atribuye el fallo de Studio a la conexión de HeidiSQL sin evidencia.

Se entregó SQL limitado al código ficticio `TEST-AMBIGUO-001` para retirar las asociaciones de la prueba. El usuario respondió «listo» después de esa instrucción; no se ejecutó una consulta independiente para verificar la limpieza.

**Seguridad:** se compartió una credencial de conexión en la conversación y se indicó rotarla y actualizar las conexiones. No se reproduce aquí; la rotación no está confirmada.

**Conclusión funcional:** varios códigos pueden identificar un producto. Un código que identifica productos distintos debe producir ambigüedad. El modelo actual no distingue presentaciones del mismo producto: esta prueba no demuestra identificación de cajas ni conversiones correctas.

**Pendiente manual:** ejecutar el script sin argumento y confirmar que muestra el mensaje de uso. No se ha recibido esa salida. La validación de entradas vacías de la función sí se cubrió con una prueba automatizada, pero es una comprobación distinta del script completo.

## 7. Verificación automatizada de la redistribución

`npm test`: 12 pruebas aprobadas con persistencia simulada.

- Entrada vacía o no textual sin consulta a la base.
- Búsqueda conservando ceros iniciales.
- Código desconocido.
- Código ambiguo.
- Propagación de un fallo técnico sin confundirlo con producto inexistente.
- Autenticación requerida en rutas de negocio.
- Listado HTTP de productos con búsqueda y límite.
- Rechazo de límite inválido antes de consultar productos.
- Detalle inexistente con respuesta 404.
- Fallo interno con respuesta 500 sin exponer detalles.
- Health público con éxito simulado.
- Health con indisponibilidad simulada y respuesta 503.

También se verificó sintaxis de 27 archivos JavaScript y resolución de 48 imports relativos. Estas comprobaciones no ejecutaron consultas contra SAP ni PostgreSQL real.

## 8. Forma de trabajo acordada

### Avance posterior: errores y validación

El usuario construyó y probó los siguientes módulos:

- `src/shared/errors/AppError.js`: valida código, mensaje y estado HTTP; cuatro pruebas aprobadas.
- `src/middleware/errorHandler.js`: reconoce errores conocidos, oculta detalles internos, registra fallos y delega si los encabezados ya se enviaron; cuatro pruebas nuevas aprobadas. Se adaptó la prueba HTTP del error 500 al nuevo formato.
- `src/middleware/validate.js`: responde 400 únicamente ante `ZodError`, delega excepciones inesperadas y aplica los datos transformados después de validar todas las partes; cuatro pruebas nuevas aprobadas.

Se corrigieron durante el aprendizaje el nombre de archivo `AppErrors.js`, el nombre de clase `AppErrror` y un `!` sobrante en la comprobación de tipo de `code`.

**Resultado acumulado:** el usuario compartió la salida de 20 pruebas aprobadas y luego confirmó las 24 aprobadas al incorporar `validate.test.js`. Este último resultado se registra como confirmación del usuario, no como una nueva ejecución del asistente.

El formato estructurado de errores ya se aplica a los errores enviados al manejador central. Autenticación, validación y algunas rutas todavía responden directamente con su formato anterior; su uniformización es progresiva. Las pruebas no prueban conexión con SAP ni las condiciones reales de concurrencia de bodega.

### Avance posterior: configuración y cierre

- `src/config/env.schema.js`: validación de entorno, puerto y URL PostgreSQL mediante una función comprobable sin leer secretos reales. Mensajes de error limitados a nombres de variables.
- `src/config/env.js`: carga y valida la configuración; Prisma utiliza `env.databaseUrl`.
- `tests/unit/env.test.js`: seis pruebas nuevas. El usuario confirmó explícitamente 30 pruebas aprobadas.
- `src/infrastructure/shutdown.js`: evita cierres duplicados, espera el cierre HTTP, desconecta Prisma y establece un tiempo máximo.
- `src/server.js`: conecta el cierre a las señales y al error del servidor.
- `tests/unit/shutdown.test.js`: cinco pruebas nuevas. El usuario respondió que todo funcionaba; no compartió la salida completa de 35 pruebas ni el resultado manual de Ctrl+C. No confundir pruebas simuladas con validación del cierre bajo carga real.

### Método de colaboración y criterio técnico

El usuario quiere aprender y construir módulo por módulo: explicación breve, código para copiar y pegar, casos correctos y errores, con resultados esperados. La autorización para redistribuir el proyecto fue explícita; no se interpreta como una solicitud de implementar autónomamente todas las funcionalidades futuras.

Cada módulo debe documentar lo que valida, cómo trata fallos y qué queda pendiente. Un comportamiento no se declara comprobado solo porque se entregó el código.

El usuario pide conservar orden y escalabilidad, y evaluar sus propuestas con criterio técnico independiente. Se explicarán los desacuerdos, sus motivos y una alternativa concreta cuando corresponda.

Principios de trabajo:

- Mantener el monolito modular y separar HTTP, reglas de negocio y persistencia conforme se trabaja cada módulo.
- Crear abstracciones cuando resuelvan una necesidad concreta; no añadir infraestructura por una expectativa genérica de crecimiento.
- Aplicar cambios pequeños, con pruebas de errores y compatibilidad relevantes para el cambio.
- Diferenciar identificación de producto, presentación y cantidad. No asumir que una etiqueta adicional representa una caja ni que cada escaneo suma uno.
- Las decisiones desconocidas de SAP u operación quedan explícitas; no se sustituyen por reglas inventadas.
- Revisar integridad, concurrencia, reintentos y transacciones al conectar operaciones que modifican el estado de picking.
- Mantener documentación y código alineados, sin registrar secretos y distinguiendo evidencia observada de resultados reportados.

## 9. Próxima acción

**Punto actual:** integración de etiquetas incorporada por el usuario. Reintentos e historial terminados y verificados en una entrega externa lista para copiar, descrita en la sección 13. El usuario pidió terminar esos dos puntos y parar; no iniciar otro bloque al cerrar esta entrega.

Al retomar:

1. Revisar los contratos y riesgos pendientes del escaneo antes de cambiar su comportamiento. La separación por responsabilidades ya quedó terminada.
2. Definir el contrato del escaneo: código, producto resuelto, presentación, cantidad e identificador de operación para controlar reintentos. Para un piloto de unidades, exigir una configuración explícita y rechazar presentaciones no resueltas.
3. Confirmar con Cosprobell unidades/cajas, equivalencias, documento operativo y parciales; integrar después las reglas correspondientes.
4. Conectar búsqueda y escaneo con errores coherentes. Los casos de cierre simultáneo y límite descritos en la sección 11 ya fueron comprobados; quedan reintentos duplicados, presentaciones y cobertura HTTP de escanear/finalizar.
5. Mantener pendientes la prueba manual del script sin argumento, cierre por señal y rotación de credencial; no marcarlos como completados sin evidencia.
6. Retomar la reunión sobre acceso a SAP y muestras conectadas a partir de las dudas documentadas. La preparación de esa reunión no depende de terminar toda la aplicación.

## 10. Cierre de la reorganización de picking

El usuario incorporó el código de forma guiada. El asistente revisó los archivos guardados y ejecutó `npm test`: **61 pruebas, 61 aprobadas, 0 fallidas**.

### Estructura comprobada

- `picking.routes.js`: conecta las cuatro rutas con validadores y controladores; no contiene SQL ni pruebas.
- `picking.schemas.js`: entradas de inicio, identificador de sesión y código escaneado.
- `picking.controller.js`: adapta HTTP, conserva temporalmente el formato anterior de errores conocidos y delega fallos internos al manejador central.
- `picking.service.js`: inicio, consulta, escaneo y finalización; utiliza `AppError` para los errores conocidos.
- `picking.repository.js`: consulta de pedido, creación de sesión, consulta con líneas, consulta de estado, incremento SQL, búsqueda de línea y persistencia de finalización.

### Cobertura incorporada durante el bloque

Se añadieron pruebas de schemas, creación de sesión en el repositorio y respuestas HTTP de inicio/consulta. El último paso añadió ocho pruebas de servicio para escaneo exitoso, sesión inexistente, sesión cerrada, producto ajeno, cantidad completa, fallo técnico y finalización con/sin diferencias.

Durante el aprendizaje, se corrigió un repositorio vacío en disco y se retiraron pruebas pegadas accidentalmente dentro de las rutas. Los archivos de aplicación y pruebas quedaron separados.

### Alcance real del resultado

La reorganización conserva las URLs y respuestas anteriores. No se modificaron el esquema Prisma ni las migraciones en este cierre y no se ejecutaron escrituras sobre una base real. La suite utiliza persistencia simulada: no valida el SQL bajo concurrencia ni el circuito real de SAP.

Limitaciones identificadas al cerrar la reorganización (estado histórico; la sección 11 actualiza las corregidas):

1. Escaneo por `itemCode` con incremento fijo de uno; búsqueda por etiquetas y presentaciones aún sin conectar.
2. Cantidades originales al iniciar, sin reglas completas de pendientes, elegibilidad o sesiones duplicadas.
3. Consulta del estado e incremento separados; cierre y escaneo todavía pueden competir.
4. `SKIP LOCKED` puede omitir una línea bloqueada; el mensaje actual de cantidad completa no es una prueba de que realmente esté completa bajo concurrencia.
5. No hay idempotencia por evento de escaneo ni historial individual completo.
6. Finalización conserva las reglas anteriores, incluida la posibilidad de finalizar con diferencias y de volver a finalizar una sesión; no representa autorización de despacho parcial.
7. Falta identidad personal fiable, reglas de cambios/cancelaciones de SAP y pruebas de PostgreSQL de desarrollo para concurrencia.

**Conclusión:** bloque de estructura terminado; picking todavía no está certificado para operación real. El siguiente trabajo será definir unidades y contrato de escaneo y corregir la consistencia transaccional con pruebas apropiadas.

## 11. Consistencia transaccional y pruebas en PostgreSQL

### Cambios incorporados

- Se retiró `SKIP LOCKED` del incremento de líneas.
- `picking.transaction.js` ejecuta la operación en una transacción `ReadCommitted` y bloquea la sesión mediante `SELECT ... FOR UPDATE`.
- Escanear y finalizar comprueban el estado dentro de esa transacción y utilizan la misma conexión para sus consultas y escrituras.
- Una operación que encuentra la sesión cerrada se rechaza con `PICKING_NO_ACTIVO`; también se impide volver a finalizarla.

Esto corrige las limitaciones históricas 3 y 4 de la sección 10 y la repetición del cierre descrita en la 6. Finalizar con diferencias sigue permitido por el código; no equivale a una autorización operativa de despacho parcial.

### Evidencia reportada por el usuario

Las pruebas se ejecutaron en la base PostgreSQL que el usuario identificó y autorizó como base de pruebas. Los scripts crean sesiones temporales con códigos únicos y eliminan sus propios datos al terminar.

| Script | Caso y resultado |
|---|---|
| `scripts/comprobar-concurrencia-picking.js` | Dos escaneos aceptados; cantidad final 2 de 5. Salida compartida: sesión 6 eliminada. |
| `scripts/comprobar-limite-picking.js` | Dos escaneos para una unidad: uno aceptado y otro rechazado con `CANTIDAD_COMPLETADA`; final 1 de 1. Salida compartida: sesión 7 eliminada. |
| `scripts/comprobar-bloqueo-picking.js` | PostgreSQL confirmó mediante `pg_blocking_pids` que el escaneo esperaba; después de liberar el bloqueo se registró una unidad. Salida compartida: sesión 8 eliminada. |
| `scripts/comprobar-cierre-picking.js`, caso 1 | El cierre espera al escaneo y conserva la unidad registrada; sesión completa. |
| `scripts/comprobar-cierre-picking.js`, caso 2 | El escaneo espera al cierre y se rechaza con `PICKING_NO_ACTIVO`; cantidad y fecha de cierre permanecen sin cambios. |
| `scripts/comprobar-cierre-picking.js`, caso 3 | Cuatro escaneos para el mismo producto en dos líneas de cantidades 1 y 2: tres aceptados, uno rechazado y cantidades finales 1 y 2. |

El usuario confirmó «aprobó los 3» para el último script. Los dos primeros casos de ese script controlan el orden y comprueban la espera en PostgreSQL. Lanzar varias promesas en los otros casos no demuestra por sí solo que todas hayan coincidido en el bloqueo.

Estos resultados se registran como ejecuciones del usuario; el asistente no volvió a ejecutar los scripts contra la base al actualizar esta sección. Son seis escenarios de base real separados de `npm test`: no se suman al contador de esa suite. La fila de 61 pruebas conserva la última ejecución del asistente documentada al cierre de estructura; no representa un recuento actualizado de la suite tras estos cambios.

### Próximo bloque y límites pendientes

La ronda acordada de concurrencia queda cerrada. El siguiente bloque es definir y conectar el contrato del escaneo con la búsqueda por código de barras: conservar el código leído, resolver el producto y determinar explícitamente la cantidad correspondiente a su presentación.

Siguen pendientes las equivalencias unidad/caja, idempotencia para reintentos, trazabilidad individual de escaneos, elegibilidad y duplicidad de sesiones, cobertura HTTP de escanear/finalizar, uniformización de errores, identidad de operadores y reglas de sincronización con SAP. Las pruebas actuales trabajan con `itemCode` e incremento de uno; no validan etiquetas reales, carga sostenida ni todo el flujo de despacho.


## 12. Integración del escaneo por etiquetas — 28 de septiembre de 2026

### Alcance operativo confirmado

El usuario aclaró que el picking verifica siempre unidades individuales. La zona grande almacena cajas y abastece a la pequeña; las cajas tienen etiquetas distintas de las individuales. No está confirmado que sean bodegas independientes en SAP. Los traslados entre zonas no se implementan en este bloque.

Se localizaron los metadatos originales descomprimidos en el Escritorio, carpeta `XML COSPROBELL`. El XML declara `ItemBarCode.AbsEntry`, `UoMEntry`, `Barcode` y el catálogo `UnitOfMeasurement`. La línea de pedido revisada usa `UoMEntry = -1` y `UoMCode = Manual`: eso no certifica una equivalencia con una unidad individual.

### Preparación incorporada por el usuario

- Referencias SAP y unidades en códigos de barras; unidad y cantidades pendientes en líneas de pedido.
- Catálogo `UnidadMedida` y confirmaciones locales `ConfirmacionEtiquetaPicking`.
- Copia de `uomEntry` y `uomCode` en cada línea de picking al iniciar la sesión. Las sesiones antiguas conservan valores desconocidos; no se rellenan por suposición.
- Resolución de etiquetas, comprobación de confirmación vigente y compatibilidad de cantidades. El usuario confirmó 104 pruebas aprobadas antes de esta integración.
- Existe una migración vacía anterior al catálogo; se conservó y posteriormente se generó la que crea la tabla.

### Entrega preparada para copiar

El asistente preparó archivos completos fuera del repositorio en `entrega-picking-integrado`, dentro de su carpeta de artefactos. No sustituyó los archivos de aplicación del usuario durante la preparación. El copiador incluido comprueba hashes, guarda respaldo y solo copia los archivos declarados; la aplicación de la entrega queda a cargo del usuario.

El flujo de `escanearPicking` queda así:

1. Bloquear la sesión y comprobar que sigue activa.
2. Resolver la etiqueta y su confirmación usando la misma transacción.
3. Obtener las líneas del producto y validar unidades y cantidades enteras.
4. Elegir la primera línea pendiente por id; incrementar exactamente esa línea.
5. Guardar el código de barras normalizado, conservando ceros iniciales, en `codigoBarrasEscaneado`.

El SQL exige la misma sesión, producto, unidad e identificador de línea, además de impedir superar la cantidad pedida. Si no actualiza una fila, se responde `LINEA_MODIFICADA`, sin confundirlo con cantidad completada.

La URL y el cuerpo `{ codigo }` se conservan; el valor pasa a significar una etiqueta de barras registrada, no un código interno de producto. Se conserva temporalmente el formato HTTP de errores conocidos `{ error: mensaje }`. La comprobación actual exige que todas las líneas del mismo producto sean compatibles con esa unidad; se rechazan presentaciones mezcladas. No se implementan conversiones ni se interpreta `Manual` como unidad individual.

### Evidencia de esta entrega

- `npm test` ejecutado por el asistente en la copia temporal: **128 pruebas, 128 aprobadas, 0 fallidas**. Incluye HTTP de escaneo/finalización; su persistencia está simulada.
- `node scripts/comprobar-picking-integrado.js` ejecutado por el asistente contra la base autorizada de pruebas: demo y seis escenarios de concurrencia aprobados.
- Sesión 13: demo del servicio real; rechazó etiqueta desconocida, caja, producto ajeno, etiqueta sin confirmar, unidad incompatible/manual, exceso y sesión cerrada. Registró tres unidades y comprobó el código de barras persistido.
- Sesiones 14–16: dos escaneos para cinco unidades, límite de una unidad y espera real de bloqueo confirmada por PostgreSQL.
- Sesiones 17–19: escaneo antes del cierre, cierre antes del escaneo y producto repetido en dos líneas. Todos aprobados.
- Los scripts informaron eliminación de los datos temporales de cada escenario. La preparación y limpieza están limitadas a los identificadores propios de cada ejecución.

Estas ejecuciones del asistente verificaron inicialmente la entrega externa. Posteriormente, el usuario compartió la salida completa de `npm test` desde su proyecto: **128 aprobadas, 0 fallidas**, y de `node scripts/demo-picking.js`: **DEMO APROBADA**, sesión temporal **20** eliminada. La demo registró tres unidades con sus etiquetas y rechazó los ocho casos previstos sin cambios. Esto confirma el funcionamiento de la integración en su proyecto con datos ficticios; no representa una conexión a SAP ni una prueba con mercadería real.

### Pendientes después de incorporar la entrega

Idempotencia por lectura, historial de eventos y operador autenticado; gestión autorizada de confirmaciones; elegibilidad de órdenes y sesiones duplicadas; cantidades pendientes/entregas parciales; cancelaciones y modificaciones en SAP; uniformización de errores. El bloqueo actual coordina operaciones de la sesión de picking, no cambios concurrentes del catálogo o de confirmaciones: el futuro sincronizador deberá coordinar o versionar esos cambios.

Con los metadatos actuales, una referencia manual o desconocida impide escanear. Falta obtener ejemplos reales y definir su interpretación con Cosprobell. Una confirmación local tampoco demuestra la identidad de quien la registró: esa autenticación sigue pendiente.


## 13. Reintentos sin doble conteo e historial de lecturas

### Contrato y comportamiento

El cuerpo de `POST /picking/:id/escanear` ahora exige `codigo` y `operacionId` (UUID). La aplicación debe crear y conservar ese UUID antes del primer envío de una lectura. Un reintento de red reutiliza la misma pareja; una lectura física nueva utiliza otro UUID. No se genera una clave alternativa en el servidor cuando falta el identificador.

La clave es única por sesión: `(pickingId, operacionId)`. El código se normaliza quitando espacios exteriores, conservando ceros; el UUID se normaliza a minúsculas. Mismo UUID y código devuelven la respuesta guardada sin incrementar ni crear otro evento. Mismo UUID con otro código produce `OPERACION_REUTILIZADA` y conserva el evento original. La misma clave puede existir en sesiones distintas.

La búsqueda del resultado previo ocurre bajo el bloqueo de sesión y antes de comprobar su estado actual. Así se puede recuperar una respuesta perdida después del cierre. Se devuelve el resultado histórico de aquella lectura, no el total actual; para actualizar el avance de pantalla debe consultarse la sesión.

### Persistencia

Nueva tabla `picking_escaneos`, modelo `PickingEscaneo`, enum `ResultadoEscaneoPicking`, clave única e índice por sesión/id. Guarda código, operación, resultado, fecha, aplicación autenticada cuando existe, y producto/línea/unidad/cantidades antes y después para aceptados. Conserva la respuesta original o el error de negocio para reproducirlos.

El incremento y el evento aceptado se confirman en la misma transacción. Un fallo técnico al guardar el evento revierte el incremento. Los rechazos de negocio se guardan sin sumar; el error se entrega después de confirmar el evento. Reintentar un rechazo devuelve ese mismo rechazo, incluso si los datos se corrigieron después; reevaluarlo requiere una operación nueva.

El historial contiene una entrada por operación válida resuelta en una sesión existente, no una entrada por intento de transporte. No registra peticiones sin autenticar, datos inválidos rechazados antes del servicio, sesiones inexistentes, conflictos al reutilizar una clave ni fallos técnicos revertidos. No reconstruye escaneos anteriores a esta implementación.

Las relaciones restringen el borrado accidental de sesiones o líneas con historial. No se creó un endpoint para editar o borrar eventos. Los scripts de prueba eliminan explícitamente sus propios eventos antes de retirar sus sesiones.

### Consulta HTTP

`GET /picking/:id/escaneos?limit=50&despuesDe=123`, protegido por la autenticación existente. `limit` admite de 1 a 100 y vale 50 por defecto; se omite `despuesDe` en la primera página. Devuelve `{ data, siguienteCursor }` ordenado por id ascendente; cursor null indica última página. No incluye la copia completa de la respuesta de cada lectura.

La aplicación se toma de `req.appNombre`, establecido por autenticación, no del cuerpo. No identifica todavía al operador individual. Se conserva el formato HTTP anterior de errores conocidos de picking.

### Verificación y entrega

- **144 pruebas automatizadas aprobadas**, ejecutadas por el asistente en la copia temporal: reglas anteriores, UUID obligatorio, respuesta estable, conflicto de clave, reintento tras cierre, persistencia de rechazo, fallo al guardar historial, paginación y HTTP.
- Migración `20260928120000_historial_escaneos_idempotentes` generada comparando esquemas, revisada y **aplicada en la base de pruebas autorizada**. Solo añade el tipo, tabla, índices y relaciones; no modifica cantidades existentes. La aplicación en el checkout del usuario sigue pendiente de copiar los archivos y regenerar Prisma.
- Sesión 21: demo integrada aprobada y limpiada.
- Sesión 22: mismo UUID concurrente deja una unidad/un evento; nueva lectura suma; otro código con la misma clave se rechaza; el rechazo sigue estable tras corregir la etiqueta; fallo SQL intencionado revierte cantidades e historial; reintento posterior funciona; respuesta aceptada se recupera después del cierre. Historial paginado con cinco aceptados y dos rechazos, sin duplicados. Limpieza completada.
- Sesión 23: comprobación adicional de alcance por sesión, limpiada. La prueba se reforzó después manteniendo dos sesiones simultáneamente.
- Sesiones 24–29: los seis escenarios anteriores de concurrencia volvieron a aprobarse con historial activado; limpieza completada.
- Sesiones 30 y 31: mismo UUID presente al mismo tiempo en dos sesiones distintas, ambos aceptados una vez; comprobación aprobada y datos eliminados.
- Hubo un fallo inicial al iniciar la transacción de preparación del script. Se amplió únicamente `maxWait` del helper de datos ficticios a 10 segundos; los límites de la transacción de aplicación no cambiaron. Las comprobaciones posteriores aprobaron.

La entrega `entrega-escaneos-historial` contiene los archivos completos, migración, guía y copiador con respaldo. No incluye credenciales ni modifica el checkout hasta ejecutar el copiador. La migración ya está aplicada en la base de pruebas: `migrate deploy` desde el checkout actualizado comprobará ese estado sin repetirla.

### Punto de pausa

Los dos objetivos de esta entrega están implementados y comprobados con datos de prueba. Tras incorporar la entrega, regenerar Prisma y confirmar la suite local, parar según lo solicitado por el usuario. No empezar hoy otra funcionalidad.

Siguen fuera de estos dos objetivos: operador autenticado, gestión de confirmaciones, elegibilidad/duplicidad de sesiones, pendientes/parciales, cambios concurrentes del catálogo, integración SAP y resolución de referencias Manual con ejemplos reales. El historial no convierte la API key de una aplicación en identidad personal.


## 14. Inicio y reanudación de picking — entrega preparada

El usuario confirmó que la entrega anterior funciona y pidió continuar. Esta sección actualiza el punto de pausa de la sección 13. Los archivos de esta nueva entrega se verificaron en una copia; su incorporación al checkout depende de ejecutar el copiador.

### Comportamiento

- Solo iniciar o retomar pedidos con `documentStatus = bost_Open` y `cancelled = false`. `cancelStatus` admite `csNo` o ausencia; si informa `csYes` o `csCancellation`, se rechaza. Valores desconocidos se rechazan. El sincronizador futuro debe convertir correctamente tNO/tYES y no sustituir estados ausentes por false.
- Los cinco pedidos del archivo local `Orders.json` tienen `DocumentStatus = bost_Close`, `Cancelled = tNO`, `CancelStatus = csNo`: no son ejemplos elegibles para iniciar.
- Una sesión activa se devuelve con HTTP 200, conservando id, usuario, cantidades, líneas e historial. Una nueva se devuelve con HTTP 201. Ambos conservan `{ data: sesion }`.
- Dos solicitudes del mismo pedido se serializan bloqueando su cabecera en PostgreSQL. Todas las lecturas y la creación usan una transacción ReadCommitted.
- Se bloquean también las sesiones existentes para coordinar con la finalización. Más de una activa produce `SESIONES_DUPLICADAS`; no se escoge arbitrariamente ni se elimina información.
- Si no hay activa y existe historial de sesiones, se rechaza un nuevo inicio con `PEDIDO_CON_PICKING_FINALIZADO`. Es una regla provisional para evitar repetir todas las cantidades hasta definir parciales y reapertura. No hay una operación de reapertura en este cambio.
- Si hay una única activa junto con sesiones antiguas, se retoma la activa. No se modifica `usuarioId` usando el dato de quien retoma.

### Archivos y verificación

- `picking.pedido.js`: comprueba el estado de la cabecera local.
- Repositorio: bloqueo del pedido, lectura bloqueada de sesiones y uso del cliente transaccional.
- Servicio: valida elegibilidad y decide crear, retomar o rechazar.
- Controlador: distingue HTTP 201 y 200 sin cambiar el cuerpo de respuesta.
- **162 de 162 pruebas aprobadas** en la copia preparada, incluyendo casos HTTP y reglas de estado, duplicados, finalizadas y uso de la misma transacción.
- `comprobar-inicio-picking.js` aprobado contra PostgreSQL de pruebas: cerrado/cancelado/desconocido no crean; fallo tras INSERT revierte; dos inicios concurrentes crean una sola sesión; retomar conserva usuario y 2 de 5; cancelación impide retomar; finalizada impide repetir. Cliente, pedido, líneas y sesiones temporales eliminados.
- No se modifica el esquema ni se necesita migración o regeneración del cliente Prisma. La exclusión está garantizada para inicios que pasan por este servicio; no se añade un índice único que impida inserciones directas desde otros programas.

### Límites y siguiente paso

La comprobación usa la copia local del pedido; no consulta SAP en tiempo real. Este cambio no vuelve a validar su cabecera en cada escaneo de una sesión ya abierta. Sigue copiando `quantity`; falta definir y aplicar cantidades pendientes, líneas cerradas, parciales y modificaciones de SAP durante la preparación. Por ello todavía no debe considerarse completo el flujo para pedidos reales parcialmente despachados.

Siguiente bloque: acordar con ejemplos reales cómo se representan las unidades pendientes y las líneas abiertas; después implementar ese contrato antes de conectar el flujo a pedidos reales de SAP.


## 15. Corrección de codificación en picking

Se confirmó texto UTF-8 interpretado como Windows-1252 en cuatro archivos: controlador, repositorio, servicio de picking y pruebas HTTP. Se corrigieron mensajes, comentarios y nombres de pruebas directamente en el checkout, conservando UTF-8 explícito. La herramienta concreta que originó el daño no se determinó.

Tres pruebas adicionales comprueban los cuatro mensajes completos: LINEA_MODIFICADA, DATOS_ESCANEO_INVALIDOS, OPERACION_REUTILIZADA y PAGINACION_INVALIDA. También verifican el texto enviado al repositorio de historial y recuperado al reintentar LINEA_MODIFICADA. Suite: **165 de 165 aprobadas**.

De estos cuatro errores, solo LINEA_MODIFICADA se persiste en el flujo actual. No se modificaron eventos existentes: si alguno ya contiene un mensaje dañado, el reintento conserva ese mensaje histórico. No se ejecutó ninguna reparación de datos ni migración.


## 16. Primer receptor de datos del puente — entrega preparada

Se acordó un programa de sincronización que consulte Service Layer desde el entorno autorizado y envíe información al backend. Empresa de pruebas informada por el usuario: XPRUEBAS2026. No se intentó conectar con SAP ni se incorporaron sus credenciales a los archivos.

Entrega en copia externa, pendiente de copiar al proyecto. Añade POST /integracion/productos y GET /integracion/productos/estado, autenticación Bearer separada de las API keys de aplicaciones y configuración SAP_COMPANY_DB. Se reemplaza el marcador requireBridgeAuth que anteriormente no verificaba nada. La integración permanece cerrada si falta configuración segura.

Contrato inicial: hasta 100 productos con código, nombre, código principal nullable y estados valid/frozen obligatorios. Inserta o actualiza por itemCode. No toca relaciones, escaneos, historial ni confirmaciones. Las existencias y códigos adicionales aún no se sincronizan.

Migración aditiva 20260928160000_estado_sincronizacion_productos: una tabla para empresa, secuencia, hash, cantidad y fecha de recepción. No se aplicó al esquema público de la base del usuario. Un único origen por base, lotes consecutivos, reconocimiento del último lote repetido, rechazo de cambios de contenido/saltos/lotes antiguos y commit conjunto de productos y avance.

Verificación: esquema Prisma válido y 190 de 190 pruebas aprobadas en copia externa; comprobación real en esquema temporal PostgreSQL aprobada: dos envíos concurrentes, upsert, ceros iniciales, rechazo de lote antiguo/conflictivo, fallo SQL con rollback y reintento exitoso. Esquema temporal eliminado. No se modificó el cambio local existente en tests/unit/picking.cantidades.test.js.

El copiador compara hashes y crea respaldo. La guía INTEGRACION_PUENTE.md explica la configuración, contrato y límites. El próximo bloque es el programa emisor: acceso a SAP, lectura paginada, conversión de campos y conservación duradera de lotes pendientes. La fecha de recepción no certifica actualidad en SAP; la secuencia no sustituye la futura estrategia de detección de cambios.


## 17. Emisor de productos — entrega preparada

Se comprobó que los archivos del receptor ya están presentes en el checkout; no se deduce de ello que la migración o configuración estén aplicadas. Se preparó en copia externa el emisor puente/: cliente Service Layer, cliente backend, transformación, archivo persistente de avance y pendiente, candado local y ejecución única/periódica.

Las muestras locales Items.json confirman los campos ItemCode, ItemName, BarCode, Valid=tYES y Frozen=tNO. Se utiliza el contrato v1 del receptor. El programa guarda cada lote antes de enviarlo, verifica confirmación y recupera el mismo lote tras pérdida de respuesta. Mantiene cookies de sesión solo en memoria y renueva una vez ante 401. URLs remotas HTTPS y redireccionamientos rechazados.

**211/211 pruebas aprobadas** en la copia de entrega, con HTTP simulado y pruebas reales del archivo de estado local. No se conectó a SAP, no se utilizaron sus credenciales y no se instalaron servicios ni se aplicaron migraciones. Configuración de ejemplo sin secretos; nuevos archivos de configuración y estado excluidos de Git.

La primera versión recorre el catálogo completo por ItemCode y reenvía páginas en cada ciclo. Incrementales, eliminaciones, códigos adicionales, unidades, stock y pedidos siguen pendientes. El modo --watch no equivale a un servicio Windows instalado. Tras apagón o terminación forzada puede requerir retirar el candado vacío después de verificar que no existe otro proceso; no borrar el estado. Despliegue, alertas y recuperación desatendida se completarán tras la prueba de conexión.

Siguiente paso: incorporar entrega, configurar .env.puente localmente en equipo autorizado y ejecutar un solo ciclo contra XPRUEBAS2026, con backend de pruebas confirmado. Guía en PUENTE_PRODUCTOS.md.


## 18. Emisor de productos — mejoras tras la revisión

Revisión del commit 7f7f814 con PostgreSQL real y un Service Layer simulado (125 productos: 5 muestras del ZIP y 120 sintéticos). La carga, la repetición y la comprobación del receptor funcionaron. Se corrigieron tres puntos:

- Producto inválido: el error indica el código del producto y el campo SAP (`detalle: { itemCode, campo }`), nunca el valor. Antes solo decía PRODUCTO_SAP_INVALIDO y el recorrido quedaba detenido en esa página sin saber por qué. Se mantiene la política de detener; queda por decidir si conviene saltar y reportar.
- Candado local: ejecucion.lock guarda el PID. Tras un cierre forzado o un apagón, la siguiente ejecución aparta el candado huérfano y continúa sola. Un candado de proceso vivo o sin PID se respeta. Comprobado con procesos reales: kill -9 y 100 rondas de 6 procesos simultáneos sin que dos tomaran el candado. La prueba detecta la mutación que omite la verificación tras renombrar.
- Consulta a Service Layer: `$` literal, espacios `%20` y `Prefer: odata.maxpagesize=50`. URLSearchParams enviaba `%24select` y `+`, forma no confirmada con el SAP real; sin Prefer las páginas eran de 20.

Suite: **217 de 217 aprobadas**. No se conectó a SAP ni se aplicaron migraciones fuera de bases temporales, que se eliminaron junto con las muestras del ZIP. Pendiente sin cambios: reconciliación asistida cuando la secuencia local y la remota no coinciden, carga incremental, códigos adicionales, unidades, existencias y pedidos.


## 19. Clientes y paquete del puente para Windows

**Clientes.** El receptor pasó a ser genérico por entidad (`sincronizacion.service/repository/controller`, `lote.schemas.js`) con rutas fijas `/integracion/productos` y `/integracion/clientes`; cada entidad lleva su propia secuencia y la base admite una sola empresa SAP para todas. Contrato mínimo de clientes: `cardCode`, `cardName`, `valid`, `frozen`, desde `BusinessPartners` con `CardType eq 'cCustomer'` (campos y valores verificados en `response.xml` y en las 5 muestras del ZIP). Saldos, contactos y datos personales quedan fuera hasta que una función los requiera. Motivo del orden: los pedidos (próximo contrato) exigen un cliente existente.

El emisor recorre clientes y luego productos en cada ciclo, con un archivo de estado por entidad y un solo candado. Un error de datos en una entidad se registra con su código y campo y no frena a las demás; un error de conexión corta el ciclo. Sin migraciones nuevas.

**Instalación.** `npm run empaquetar:puente` arma una carpeta autónoma; `ejecutar-puente.cmd` aplica el certificado de `certificado\service-layer.pem`, guarda registros diarios y conserva 30 días; `instalar-tarea.cmd` programa `--once` cada 15 minutos con `schtasks`. Se comprobó que `NODE_EXTRA_CA_CERTS` dentro de `--env-file` no tiene efecto en Node 22: debe definirse en el entorno antes de iniciar Node. `scripts/ver-certificado.js` lee el certificado del Service Layer configurado y guarda la raíz.

**Verificación.** 232 pruebas; comprobación real del receptor; punta a punta con PostgreSQL y Service Layer simulado (65 clientes y 75 productos, proveedores excluidos, un cliente inválido identificado sin frenar productos); el paquete copiado fuera del proyecto sincronizó ambas entidades y pasó la comprobación del candado. Los `.cmd` no se ejecutaron en Windows. Pendiente: pedidos abiertos con sus líneas, códigos de barras con unidad, bodegas y existencias.


## Corrección de concurrencia del candado y diagnóstico TLS

El usuario pidió continuar sin depender del encargado de SAP. Se corrigió directamente el checkout, conservando el cambio preexistente en package-lock.json. Nuevo módulo puente/candado.js: guardia atómica durante creación/recuperación/liberación, PID y token de propiedad por adquisición, cierre idempotente y tratamiento conservador de errores. estado.js conserva la persistencia de lotes y delega el candado.

Una regresión determinista pausa la recuperación mientras otros dos intentos compiten y comprueba que ninguno puede entrar. Suite completa: 237/237 aprobadas. Script de procesos reales ejecutado en Windows: recuperación tras cierre forzado y 10 rondas con 6 procesos aprobadas. La carpeta temporal se eliminó.

Límite explícito: si hay apagón mientras se mantiene ejecucion.lock.guard, se requiere deshabilitar la tarea y verificar ausencia de procesos antes de retirar la guardia. No se intenta recuperarla automáticamente. Conservar archivos JSON. Desplegar sin procesos de versiones anteriores ejecutándose.

scripts/ver-certificado.js ahora es exclusivamente diagnóstico: muestra huella SHA-256 sin instalar ni sobrescribir confianza. Prueba con TLS simulado confirma conservación de un PEM existente. No se contactó SAP, no se utilizaron credenciales y no se registró una tarea en el servidor. El certificado aprobado sigue pendiente del administrador.

### 2026-09-28 — Contrato de pedidos para el puente

- Revisados los metadatos locales y los cinco documentos de Orders.json. Los cinco están cerrados; no sirven como validación de un despacho abierto real.
- Añadidos pedidos.schemas.js y puente/pedidos.js: contrato estricto y conversión de cabecera y líneas de SAP. Conserva cantidades de venta e inventario por separado, pendientes nulos y unidades Manual sin inferir equivalencias.
- Rechaza estados desconocidos, fechas inválidas, cantidades negativas y números de línea/documentos duplicados. Ordena las líneas sin modificar el documento original.
- Verificación: npm test, 243/243 aprobadas (seis nuevas); los cinco pedidos del archivo de referencia pasan la conversión. Sin conexiones a SAP ni escrituras en la base.
- Alcance: contrato preparado, todavía NO registrado en el ciclo del puente ni en las rutas receptoras. No requiere migración. Tampoco modifica las reglas de picking.
- Sigue: receptor transaccional de cabecera y líneas, paginación por DocEntry numérico y activación del emisor. Antes de habilitar pedidos para picking, tratar líneas cerradas, cantidades pendientes, documentos de servicio y cambios de SAP durante sesiones activas. Las pruebas reales con Service Layer quedan pendientes para cuando se tenga acceso.

### 2026-09-28 — Pedidos conectados al puente y preparación de pruebas del escáner

- Activada la entidad pedidos después de clientes y productos. Consulta Orders de artículos con DocEntry numérico, incluye cerrados/cancelados y conserva todas las líneas. Un pedido por lote; máximo 1000 líneas y sin paginación anidada de líneas.
- Receptor transaccional: cabecera, líneas y checkpoint se confirman juntos. Exige cliente existente, conserva identificadores de líneas y retira únicamente líneas ausentes del espejo SAP. No elimina historial ni cantidades de picking.
- Actualizaciones operativas de SAP bloquean sesiones activas como requiere_revision. Se bloquea primero el pedido y después sus sesiones; escaneo/finalización ya bloquean la sesión. La recepción idéntica también detecta sesiones antiguas preparadas con cantidades distintas. Esta coordinación aún debe comprobarse con conexiones PostgreSQL reales.
- Inicio de picking usa cantidades pendientes de líneas abiertas. Exige tipo artículo, unidad conocida y equivalencia uno a uno entre cantidades de venta e inventario. Manual, cantidades ambiguas o fraccionarias quedan bloqueadas. Retomar verifica que la sesión coincida con los datos actuales.
- Nuevo módulo pedidos con rutas, schemas, controlador, servicio y repositorio. GET /pedidos pagina por DocEntry; GET /pedidos/:docEntry muestra detalle y diagnóstico local. Ambas rutas requieren autenticación de aplicación.
- Verificación final: npm test, 275/275 aprobadas. Incluye recuperación de un lote cuya respuesta se perdió, cursor numérico, recepción HTTP, filtros, cambios operativos, revisión y conservación de comportamiento previo. git diff --check sin errores de espacios.
- Paquete autónomo generado y comprobado en dist/puente-cosprobell. No contiene credenciales ni fue instalado en Windows Server. No se conectó a SAP ni a PostgreSQL real.
- Preparados docs/PRUEBAS_PEDIDOS_SCANNER.md y scripts/comprobar-recepcion-pedidos.js. Este último queda SIN EJECUTAR hasta retomar pruebas; usa datos sintéticos y ROLLBACK. La sintaxis fue comprobada con node --check.
- No requiere nueva migración. Desplegar primero backend y luego puente, conservando estados locales y secretos.
- Pendiente: validar proyección DocumentLines y certificado en SAP real, pruebas de persistencia y concurrencia real, importación de asociaciones de barras/unidades y confirmación de etiquetas, pantalla de bodega, lector físico, política de antigüedad de datos y revisión supervisada. No se declara el escáner listo para producción.


## 20. Pedidos solo abiertos; códigos de barras y unidades desde SAP

**Pedidos.** La versión anterior recorría todo el historial de Orders en cada ciclo, una consulta por pedido. Ahora el recorrido filtra `DocumentStatus eq 'bost_Open'`. Al empezar se anota la hora del backend; al terminar, los pedidos que el backend tiene abiertos y no se actualizaron desde esa hora se piden por clave (`Orders(DocEntry)`) para registrar su cierre o cancelación. Nueva ruta `GET /integracion/pedidos/abiertos`. Punta a punta con PostgreSQL y SAP simulado: con 20 pedidos históricos y 10 abiertos, el historial no se consulta; al cerrar pedidos en SAP solo esos se piden por clave y sus sesiones pasan a `requiere_revision`, sin afectar sesiones de pedidos sin cambios.

**Códigos de barras y unidades.** Nuevas entidades `unidades` (UnitOfMeasurements) y `codigosBarras` (BarCodes), campos verificados en `response.xml`. Migración aditiva `20260929090000_codigos_barras_sap`: `sapAbsEntry` único, `sincronizadoEn`, `retiradoEnSap`, índice por `codigo` y `confirmadaPor` en confirmaciones. Los códigos se actualizan por `AbsEntry` sin borrar confirmaciones; una asociación manual equivalente se vincula a SAP; los que SAP deja de listar se marcan retirados (no se borran) y el picking y la búsqueda los ignoran. Punta a punta: 70 códigos importados, la asociación manual confirmada se vinculó sin duplicarse, dos códigos retirados y uno reactivado al reaparecer, con su confirmación intacta.

El puente muestra ahora el código de error del backend (`detalle.codigoBackend`, p. ej. `PRODUCTO_NO_SINCRONIZADO`). 290 pruebas aprobadas. Sin conexión a SAP real.

**Confirmación de etiquetas.** Nuevo módulo `src/modules/etiquetas`: `GET /etiquetas` (pendientes, confirmadas o todas, con estado `sin_confirmar`, `desactualizada`, `unidad_individual` o `no_es_unidad`) y `PUT`/`DELETE /etiquetas/:id/confirmacion`. Confirmar bloquea la fila del código durante la transacción y guarda la foto actual, la hora y la aplicación (`confirmadaPor`). Solo pueden confirmar las API keys listadas en `ETIQUETAS_APPS_AUTORIZADAS`; sin configurar, la función queda cerrada. No se confirma como unidad un código con unidad Manual o sin unidad.

Recorrido completo con PostgreSQL y SAP simulado: códigos y pedidos importados por el puente → el supervisor confirmó un código (el escáner recibió 403) → se inició el picking de un pedido abierto → el código confirmado sumó 1 unidad, uno sin confirmar respondió `ETIQUETA_SIN_CONFIRMAR` y uno retirado en SAP no se encontró → al cambiar el código en SAP, la etiqueta volvió a pendientes como `desactualizada` y el escaneo respondió `CONFIRMACION_DESACTUALIZADA`. 301 pruebas aprobadas.


## 21. Pantalla de bodega

Página web servida por el backend en `/bodega/` (archivos en `public/bodega/`, sin compilación). Funciona en PC con lector USB y en Android con lector integrado. Flujo: configurar el equipo (API key y nombre del operador, guardados en el navegador), pedidos abiertos, detalle con diagnóstico de preparación, escaneo con resultado grande en verde o rojo, sonido y vibración, historial de lecturas y finalización con o sin diferencias. El detalle de pedido agrega el nombre de cada producto (`pedidosRepository.obtener`).

Lecturas: cola en orden, de a una; cada lectura recibe su `operacionId` al escanearse y lo conserva en los reintentos. Sin respuesta se reintenta con el mismo identificador; sin red se guarda en el equipo y se envía al volver la conexión o tras recargar la página. El foco vuelve de inmediato al campo de lectura para que el Enter del lector no active un botón. `crypto.randomUUID` no se usa porque no existe en HTTP de red interna.

Verificación: 310 pruebas (incluye cola, cliente de la API y servicio estático). Prueba en Chromium real contra PostgreSQL con `scripts/datos-demo-bodega.js`: lecturas válidas y rechazadas, respuesta perdida sin doble conteo, corte de red, recarga con lecturas pendientes, exceso, historial, vista de celular y finalización con diferencias, sin errores de página ni de CSP. La prueba encontró y se corrigieron: el mensaje de error que no llegaba a la pantalla, el foco que tardaba en volver y elementos que el estilo mostraba aunque estuvieran ocultos. No probado con lector físico ni equipos Android reales.

### 2026-09-29 — Rediseño morado de la pantalla

Nuevo diseño a pedido de Cosprobell, con el morado de referencia **#362F44** (medido de la imagen enviada) en la barra superior y violeta **#5B3FA0** en las acciones. Íconos SVG (Lucide, ISC) en lugar de los caracteres ✓/✗; el resultado de cada lectura ocupa un recuadro sólido verde o rojo con ícono y un destello breve, para notar dos rechazos iguales seguidos. En PC la lectura queda fija a la izquierda y las líneas a la derecha; en celular, el botón de teclado es solo ícono y en PC con mouse no aparece. Sin cambios de funcionamiento ni de API.

Verificación: 310 pruebas; prueba completa en Chromium (PC 1280 px y celular 375 px) y auditoría axe-core WCAG 2.2 A/AA de todas las vistas, sin problemas detectados. Contrastes calculados: texto blanco sobre la barra 12.7:1, sobre los botones 7.9:1, texto secundario 6.2:1.

### 2026-09-29 — Identidad "etiqueta de despacho"

El primer rediseño se sentía genérico. Se le dio identidad propia a partir del trabajo en bodega: tinta morada sobre papel con sombras sólidas, pedidos como etiquetas de envío (perforado y código de barras decorativo), panel oscuro del lector con indicador de foco, una casilla por unidad, sellos "Listo", "Completo" y "Con faltantes", y cinta de advertencia en las alertas. Tipografías Barlow, Barlow Condensed y JetBrains Mono alojadas en el servidor (SIL OFL 1.1, unos 200 KB). No se encontró un logo ni colores oficiales publicados de Cosprobell; se mantiene el morado de referencia enviado.

Verificación: 310 pruebas; prueba completa en Chromium (PC y celular) y auditoría axe-core WCAG 2.2 A/AA de todas las vistas, sin problemas detectados.

### 2026-09-29 — Tono formal

A pedido de Cosprobell, la identidad se llevó a un tono más serio: se quitaron los sellos rotados, las sombras sólidas desplazadas, la trama de puntos, las muescas y el código de barras decorativo de las tarjetas y la cinta de advertencia. Se conservan el morado, el panel oscuro del lector, las letras y las casillas por unidad. El cierre pasa a ser un resumen con estado, unidades preparadas, líneas completas, operador y horas de inicio y fin. Verificación: 310 pruebas, prueba completa en Chromium y auditoría axe-core sin problemas.

## 22. Pantalla de bodega como app de escritorio

La pantalla se usará en PC, no en celulares. Se convirtió en una app de Windows (Electron) en un repositorio aparte, `cosprobell-bodega-escritorio`, y se quitó de este backend: ya no existen `public/bodega/` ni la ruta `/bodega`. Sus pruebas y su guía se movieron a ese repositorio. Se conservan aquí el nombre de producto en el detalle del pedido y `scripts/datos-demo-bodega.js`.

La app trae la pantalla dentro y se conecta por HTTPS a la dirección del servidor configurada en cada equipo, desde el origen `app://bodega`. Depende de que `cors()` siga aceptando sus solicitudes; la seguridad sigue estando en la API key de cada equipo. Cambios en la pantalla ahora requieren publicar una versión nueva del instalador.

### 2026-09-29 — Instalador de Windows verificado

GitHub Actions armó `Bodega-Cosprobell-1.0.0-instalador.exe` en una máquina Windows: 13 pruebas aprobadas y el programa armado abrió la configuración sin acceso a Node ("PRUEBA RÁPIDA APROBADA"). El instalador no está firmado: Windows muestra el aviso de SmartScreen. Falta probarlo en una PC de bodega con el lector físico.

## 23. Despliegue en Railway

Prioridad: ver funcionar la app contra un backend en Railway. El puente con SAP queda para después; sin sus variables, `/integracion` responde 503 y el resto funciona.

- `railway.json`: migraciones antes de cada despliegue, `npm start`, comprobación en `/health` y reinicio si el proceso cae.
- `prisma` pasó a dependencias de ejecución y `npm install` genera el cliente (`postinstall`): el cliente generado no está en el repositorio y en producción no se instalan dependencias de desarrollo.
- Variables mínimas del servicio: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (referencia a la base, sin copiar la contraseña) y `NODE_ENV=production`. Guía en `DESPLEGAR_RAILWAY.md`.

Verificación: instalación limpia con `NODE_ENV=production` y sin `DATABASE_URL` (el cliente se generó), migraciones sobre una base vacía, arranque, `/health` con `{"status":"ok","db":"ok"}`, `/pedidos` sin clave 401 y `/integracion` sin configurar 503. 302 pruebas aprobadas. No probado en Railway real.

Observaciones:
- Un error 503 de `/integracion` sin configurar llega al cliente como `INTERNAL_ERROR` genérico, porque el manejador de errores oculta los 5xx; el motivo solo se ve en el registro. Revisar cuando se retome el puente.
- Se compartió por chat una dirección de la base de pruebas con su contraseña. Se recomendó regenerarla en Railway (Postgres → Database → Credentials) y volver a desplegar el backend. No se registra el valor.
- En discusión, sin implementar: dirección del servidor fija dentro de la app de escritorio e ingreso de cada bodeguero con un PIN de 4 números elegido por él.

## 24. Ingreso de operadores con PIN

Decisión de Cosprobell: cada persona de bodega ingresa con su nombre y un PIN de 4 números que asigna el supervisor; la app ya no pide dirección ni clave. El backend quedó desplegado en Railway (`cosprobell-backend-production.up.railway.app`) sin el puente.

- Modelos `Operador` y `SesionOperador` y columna `alcance` en `api_keys` (migración `20260929170000_operadores_pin`, solo agrega; las claves existentes quedan con alcance `completo`).
- Rutas `/ingreso`: lista de operadores y sesión con PIN usando una clave de alcance `ingreso`, que viaja dentro de la app y no ve datos. La sesión dura 12 horas y solo llega a pedidos y picking; el preparador es el operador de la sesión.
- PIN con scrypt y sal; token de sesión guardado como hash. Cada 5 PIN incorrectos, pausa de 15 minutos (sin evaluar ningún PIN); a los 10, bloqueo hasta que el supervisor lo quite. Cambiar el PIN o desactivar cierra las sesiones.
- `scripts/operadores.js` (listar, crear, pin, desbloquear, desactivar, activar) y `crear-api-key.js --solo-ingreso`. Guía en `INGRESO_OPERADORES.md`.

Verificación: 316 pruebas (PIN, bloqueo con reloj controlado, sesiones, rutas por alcance). Contra PostgreSQL: comandos del supervisor, lista con la clave de ingreso (y 403 en pedidos), PIN incorrecto, sesión, pedidos con sesión, productos 403, preparación iniciada a nombre del operador, cierre de sesión (401 después), pausa al quinto error, desbloqueo y cambio de PIN. Falta la parte de la app de escritorio y probar en Railway.

## 25. Pedidos preparados en la lista

Diseño aprobado por el usuario a partir de una maqueta: un pedido ya preparado sigue en la lista hasta que SAP registra la entrega y lo cierra, marcado en verde ("Preparado") o en ámbar ("Preparado con diferencias"). No se quita por tiempo: si pasan más de 24 horas sin cierre en SAP, la app de escritorio muestra un aviso para revisar la entrega.

- `GET /pedidos` agrega a cada pedido `preparado`: la última preparación finalizada (`completo` o `con_diferencias`) con `pickingId`, `estado`, `operador`, `fechaFin`, `unidadesPreparadas` y `unidadesPedidas`, o `null`. Una sola consulta por página; si la página está vacía no consulta.
- Sin migración. Las preparaciones en curso o en revisión no se informan en la lista.
- Corregido el mensaje "Ese producto ya completó su cantidad pedida" (faltaba la tilde).
- `scripts/datos-demo-belleza.js` (13 productos de belleza, 4 clientes y 6 pedidos ficticios) se entregó al usuario para copiar; después el usuario lo agregó al repositorio.

Verificación: 319 pruebas (lista con y sin preparaciones, la más reciente por pedido, consulta del repositorio). Recorrido real con la app de escritorio 1.2.0 contra PostgreSQL y este backend, con los datos de belleza: sin preparaciones no aparece la sección; un pedido preparado completo y otro con diferencias pasan a "Preparados" en verde y ámbar con operador y unidades; el que lleva 26 horas muestra el aviso; "Ver resumen" abre el resumen; el buscador filtra ambas secciones; al cerrarse en SAP el pedido sale de la lista. Auditoría axe-core WCAG 2.2 A/AA sin problemas.

## 26. Puente con control de carga y envío de cambios (2026-09-29)

Se eliminó la repetición automática de todos los catálogos cada 15 minutos. La frecuencia queda pendiente de acordar y se configura por entidad, preparada para incorporar otros documentos posteriormente. La carga inicial y sus continuaciones siguen disponibles sin configurar frecuencias.

- Límites iniciales por ejecución: 25 solicitudes SAP, 120 segundos antes de dejar de iniciar consultas y 500 ms entre solicitudes. Logout queda fuera del presupuesto; las peticiones en curso pueden prolongar la duración. Las pausas conservan el avance.
- Cada registro se compara con una huella de contenido confirmada por el backend. Se envían documentos nuevos/modificados; los que no cambiaron solo confirman presencia mediante identificadores, evitando falsos retiros y revisiones de cierre innecesarias. La presencia sí actualiza fechas en PostgreSQL.
- Caché SQLite local por entidad y origen, sin servicio adicional ni acceso directo a SQL Server. Avance y lote pendiente continúan en JSON; las huellas solo se confirman después de recibir las respuestas del backend.
- Las entidades menos atendidas tienen prioridad y se respetan las dependencias de carga inicial. Se añadieron sondeo sin envíos, recorrido manual forzado y reenvío completo de contenido para reconciliación. Este último no corrige diferencias de secuencia.
- La instalación de la tarea exige cuenta Windows e intervalo explícitos; ya no usa SYSTEM. No se instaló ninguna tarea.
- Desplegar el backend actualizado antes del puente: nuevas rutas autenticadas de observación. Sin migración de base de datos. Conservar estado JSON/SQLite al actualizar.

Verificación: 335/335 pruebas automatizadas. Incluyen respuesta perdida, página con cambios parciales, presencia de códigos sin cambios, límites, avance conservado, alternancia de entidades y sondeo HTTP simulado sin contactos al backend ni creación de estado. No se contactó SAP ni la base real.

Pendiente: medir carga y validar certificados, cuenta y datos en Cosprobell; elegir frecuencias. Cada recorrido todavía lee las páginas correspondientes de SAP. Consultar solo cambios desde SAP requiere validar filtros de fecha/hora y sus efectos sobre líneas, cancelaciones y cierres; no se afirma que esa etapa esté resuelta. Las facturas aún no están implementadas. Usar una base receptora de pruebas separada de los datos demo.

## 27. Unidad Manual como unidad y panel del supervisor (2026-10-01)

Con el puente ya cargando datos reales, un pedido real no se pudo preparar: "La línea requiere un producto y una unidad de medida confirmados". Cosprobell usa en SAP la unidad **Manual** (`UoMEntry` -1, factor 1) en todos los artículos y líneas, y la regla anterior la bloqueaba. Decisión del usuario: Manual cuenta como la unidad del artículo, y por ahora se maneja todo por unidad, con confirmación humana de las etiquetas.

- `unidadConocida` acepta -1 (`UNIDAD_MANUAL`). Se sigue exigiendo que la cantidad de inventario coincida con la de venta; no hay conversión. Las etiquetas con unidad Manual se pueden confirmar como unidad individual.
- Rol de operador: columna `rol` (`operador` por defecto o `supervisor`), migración `20261001090000_operadores_rol` (solo agrega). El ingreso y la sesión devuelven `rol`. `scripts/operadores.js` suma `crear ... --supervisor` y `rol`.
- Rutas `/supervisor/*` (middleware `soloSupervisor`: sesión con PIN y rol supervisor; las API keys reciben 403):
  - Etiquetas: lista con filtros y búsqueda, conteos, confirmación individual a nombre del supervisor y **confirmación masiva** de los códigos Manual sin confirmar. La masiva recibe la cantidad que vio el supervisor y no confirma nada si cambió (`CANTIDAD_CAMBIO`).
  - Operadores: alta, cambio de PIN, desbloqueo, activar y desactivar (nadie se desactiva a sí mismo).
  - Revisiones: preparaciones `requiere_revision` con lo que cambió en SAP por producto, finalizadas con diferencias (24 h) y preparadas sin entrega en SAP (24 h o más). Nuevo estado `anulada`: el supervisor reinicia una preparación en revisión, las lecturas quedan en el historial y el pedido se vuelve a preparar con los datos actuales. `iniciarPicking` ignora las anuladas.
  - Sincronización: última recepción y registros por tipo de dato.
- Finalizar con diferencias sigue igual: lo puede hacer cualquier operador (decisión del usuario).
- App de escritorio 1.3.0: panel del supervisor en el menú con cuatro pestañas y aviso al operador cuando el supervisor reinició su preparación.

Desplegar primero el backend (tiene migración: en Railway no hay comando previo al despliegue, hay que aplicarla con `npx prisma migrate deploy`) y después la app 1.4.0. Luego, el supervisor marca los almacenes. El inventario compara con SAP cuando el puente envíe las existencias por almacén.

Verificación: 351/351 pruebas del backend (12 nuevas de integración del panel) y 21/21 de la interfaz de la app. Recorrido real con Electron contra PostgreSQL y este backend: un operador no ve el panel y recibe 403; confirmación masiva de 2 códigos Manual a nombre de la supervisora; búsqueda con el código y confirmación individual; etiqueta que cambió en SAP; desbloqueo, alta con aviso de PIN fácil, cambio de PIN que cierra sesiones y desactivación; revisión con el cambio de cantidad (6 → 8), reinicio y nueva preparación con los datos actuales; aviso de códigos con más de 24 h sin datos; pedido con unidad Manual escaneado hasta completar la línea. Auditoría axe-core WCAG 2.2 A/AA sin problemas en las cuatro pestañas.

Pendiente: saber cuántos códigos de barras trae SAP de Cosprobell (la ficha de producto revisada no tenía); sin códigos no hay nada que escanear. Frecuencias del puente y consultas por fecha de actualización, con recorrido completo nocturno a las 2:00 a. m., a decidir con las mediciones.

## 28. Inventario de dos bodegas y códigos de barras desde la app (2026-10-01)

SAP de Cosprobell no trae códigos de barras en los artículos (solo uno, de prueba), así que no había nada que escanear; y la bodega quería ordenar su inventario. Decisiones del usuario:

- **Códigos: "las dos"**. El supervisor registra códigos desde la app (quedan con la unidad Manual y ya confirmados como unidad) y también se usa el código de la ficha del artículo de SAP (`Items.BarCode`).
- **Dos bodegas**: la grande guarda las cajas por lote (cada caja con su etiqueta CJ-000123 impresa por la app); la pequeña, las unidades sueltas de donde salen los pedidos. SAP manda y la app nunca escribe en SAP; SAP no tiene lotes ni cajas. Sin "dar de baja": lo vencido o dañado se registra en SAP y aparece en "Por descontar", donde se elige de qué lote salió (lista de lotes).
- **Varios almacenes en SAP** (el catálogo recibido tenía 20 de los ~100 códigos que usan los artículos: la Service Layer pagina de a 20 y el puente recorre todas las páginas). El supervisor marca los almacenes de esta bodega y el inventario compara solo contra ellos. Opción para ver en Pedidos solo los de esos almacenes.

Backend:

- Migración `20261002090000_inventario_bodegas` (solo agrega): `inventario_productos`, `inventario_cajas` (con CHECK de unidades no negativas), `inventario_movimientos`, `inventario_descuentos`, `documentos_stock` y sus líneas, `configuracion`; `bodegas.deEstaBodega` y `sincronizadoEn`; `productos_codigos_barras.origen`, `registradoPor` y `creadoEn`.
- Rutas `/inventario/*` (operador o aplicación; cambiar lote, contar la pequeña y corregir una caja, solo supervisor) y `/supervisor/almacenes` y `/supervisor/codigos`. Detalle y reglas en `docs/INVENTARIO.md`.
- Ecuación por producto: SAP (almacenes marcados) = grande + pequeña + preparado sin entregar + diferencia. Diferencia positiva: por ubicar (o sin contar); negativa: por descontar. Lo recibido antes que SAP se anota y se cierra solo. 15 minutos de espera tras un cambio en SAP.
- Al finalizar una preparación, lo escaneado sale de la pequeña en la misma transacción.
- Sincronización de almacenes, existencias por almacén y cinco tipos de documentos de stock (entradas por compra, entradas y salidas de mercancías, devoluciones a proveedor y de clientes). La existencia que cambia en los almacenes marcados avisa al inventario. El panel de Sincronización los muestra.
- Candado por producto en cada operación; la reposición concurrente sobre una caja solo deja pasar una.

Puente: sin cambios. El backend ya recibe almacenes, existencias y documentos de stock (contratos en `INTEGRACION_PUENTE.md`); el envío desde el puente lo define el usuario. Los cambios al puente que se habían incluido en el PR #10 se retiraron después, a pedido del usuario: el puente queda como estaba antes.

App de escritorio 1.4.0: secciones Pedidos, Inventario y Panel; inicio del inventario con lector, recibir/ubicar/contar con etiquetas Code 128 e impresión, reponer, producto por lote y caja, por descontar con elección de lote y cambio de lote, por vencer, sin contar y movimientos; en el panel, Almacenes y Registrar un código.

Desplegar primero el backend (tiene migración: en Railway no hay comando previo al despliegue, hay que aplicarla con `npx prisma migrate deploy`), después el puente nuevo y por último la app 1.4.0. Luego, el supervisor marca los almacenes.

Verificación: 391/391 pruebas del backend (385 después de retirar las del puente) y 26/26 de la app. Recorrido contra PostgreSQL real del backend completo (sincronización, conteo inicial, recepción con adelanto que SAP cierra después, reposición, picking con entrega en SAP, descuento con espera y cantidad exacta, cambio de lote, conteo, corrección, consultas, códigos, filtro de pedidos y cinco reposiciones simultáneas sobre una caja). Encontró y se corrigió un `BigInt` de una consulta que impedía responder la ficha del producto. Recorrido con la app Electron contra este backend: elegir almacenes, contar en cajas con 4 etiquetas cuyo código de barras se leyó con un decodificador (zxing), impresión solo de etiquetas, ubicar con confirmación de lo que excede, reponer con sugerencia de la caja que vence antes, descontar el lote vencido, cambiar lote, por vencer, registrar un código y su rechazo en otro producto, y el operador sin correcciones. Auditoría axe-core WCAG 2.2 A/AA sin problemas en todas las pantallas nuevas.

Pendiente: el permiso "Iniciar sesión como proceso por lotes" de la cuenta del puente (lo gestiona sistemas por GPO). Elegir las frecuencias del puente. Probar la impresión con la impresora real de la bodega. Cuando se pase a la sociedad de producción de SAP, usar una base nueva.

## 29. Correcciones de la revisión del backend (2026-10-01)

- Recepciones, reposiciones, descuentos, reasignaciones, conteos y correcciones requieren `operacionId`. El resultado se guarda junto al movimiento en una transacción: reintentar con el mismo UUID y contenido no duplica cantidades. Reutilizarlo con otros datos o usuario produce conflicto. Los conteos antiguos no vuelven a sobrescribir el inventario al reintentarlos.
- Recepciones y conteos funcionan sin almacenes ni existencias de SAP. El resumen y la ficha indican `comparacionDisponible`; no se interpretan datos ausentes como cero. Los descuentos basados en diferencias requieren almacenes elegidos y datos recibidos en los últimos 30 minutos. El puente actual no envía esas entidades, por lo que la comparación queda deshabilitada. Antes de habilitar esas entidades falta una señal de recorrido completo: la antigüedad de un lote no acredita que todo esté sincronizado.
- Migración `20261002100000_operaciones_inventario_y_codigos_ficha`: agrega `inventario_operaciones` y recupera asociaciones del código principal de productos que ya estaban sincronizados. Conserva asociaciones activas equivalentes y no confirma etiquetas automáticamente.
- La confirmación masiva de etiquetas comprueba cantidad y versión del conjunto revisado. Cambiar un código manteniendo el mismo número de etiquetas ahora produce `ETIQUETAS_CAMBIARON`.
- Contrato de la app: conservar UUID y cuerpo por acción al reintentar; en confirmación masiva enviar `versionEsperada` desde `versionManual` del resumen. Coordinar la actualización del frontend: una versión que omita estos campos recibirá 400. Detalle en `docs/INVENTARIO.md`.

Verificado: **404/404 pruebas**, validación del esquema Prisma y prueba con PostgreSQL 18 temporal en localhost. Se aplicaron todas las migraciones sobre una base vacía; se verificaron recuperación de códigos, ausencia de duplicados y de confirmaciones automáticas, recepción/reposición simultáneas, conflicto por reutilización y repetición de conteo después de otro movimiento. No se aplicaron migraciones en Railway ni se cambió el servidor de SAP.

Pendiente de decisión funcional: permitir o bloquear existencias negativas al finalizar picking, y conservar lotes separados dentro de la bodega pequeña. No se cambian esas reglas en esta corrección. Los cambios del puente recuperados del stash se conservaron.

## 30. Despacho sin negativos y lotes en la pequeña (2026-10-01)

Decisiones confirmadas por el usuario: si faltan unidades en la pequeña, exigir reposición desde la grande antes de finalizar; conservar los lotes también en la pequeña.

- El cierre verifica todos los productos, incluidos los que todavía no tienen inventario. Un faltante devuelve `PEQUENA_INSUFICIENTE` y conserva la preparación abierta. La salida y el cierre ocurren en una sola transacción con candados por producto.
- Nueva tabla `inventario_pequena_lotes`; reposición conserva lote y vencimiento de la caja. Recepciones, conteos, descuentos, reasignaciones y picking mantienen los saldos por lote. Los movimientos guardan el identificador del lote y las consultas muestran el detalle.
- Varios lotes disponibles requieren selección explícita al finalizar: el código de barras del producto no permite adivinar el lote físico. Con un único lote se puede conservar el cierre sin selección adicional. Se rechazan lotes ajenos, duplicados, insuficientes o cuya suma no coincide.
- Conteos por lote pueden corregir la distribución sin alterar el total. Un descuento reasignado devuelve al lote original. Los vencimientos también incluyen existencias de la pequeña.
- Migración `20261002110000_lotes_pequena_sin_negativos`: saldos anteriores positivos quedan sin lote identificado; negativos anteriores se conservan para conteo. No se borran ni se convierten en cero. Se impiden nuevos negativos y se exige conciliar los antiguos antes de reponer.

Verificado: **419/419 pruebas**. PostgreSQL 18 temporal local: todas las migraciones, saldos antiguos, corrección de negativos, reposición idempotente, selección física de lote, dos pedidos compitiendo por existencias, rollback de un pedido con faltantes, conteos, vencimientos, descuentos y reasignaciones con rollback. Se generó el cliente Prisma actualizado. No se modificaron Railway ni SAP.

Antes de desplegar: aplicar migraciones en la base del backend y actualizar la app para enviar `operacionId`, `versionEsperada`, selección de lotes al finalizar y conteos por lote. Contratos en `docs/INVENTARIO.md`. El frontend no se modificó en esta sesión.

Puente: se conserva versionado; sus cambios locales previos quedan fuera del commit sugerido del backend. Separarlo en un repositorio propio requiere trasladar también los contratos compartidos, pruebas y empaquetado; ignorar solo su carpeta dejaría referencias rotas en un clon nuevo.

## Ampliación del puente: almacenes y existencias (2026-10-02)

Se incorporaron almacenes y existencias por artículo/almacén, activables con BRIDGE_INVENTORY_ENABLED. Conserva el estado anterior y el inventario físico local. SAP se consulta por páginas; al backend se envían cambios y se confirman códigos sin cambios. Se transmite correctamente la transición a cero y se conserva el presupuesto compartido.

Se registran inicio y fin de recorridos para impedir comparaciones sobre cargas parciales. Requiere la migración 20261002120000_recorridos_inventario antes de desplegar el backend. Documentos de movimientos quedan pendientes.

Verificado: 443/443 pruebas y esquema Prisma válido. Muestras locales de SAP: 20 almacenes y 5 artículos. PostgreSQL temporal local: pausa/reanudación, actualización sin cambios, transición de 12 a cero, conservación de la pequeña y caducidad de comparación. No se desplegó en Railway ni se consultó SAP real en esta sesión.

Paquete independiente: dist/puente-inventario. Procedimiento completo en docs/ACTUALIZAR_ALMACENES_EXISTENCIAS.md. Antes de activar, actualizar backend y paquete del servidor preservando configuración y estado; verificar sondeo y primera carga de ambas entidades.

## Certificado fijado también en producción 2026-10-03

A petición del usuario, se añadió SAP_TLS_PINNED_CERTIFICATE como activación explícita independiente de la sociedad. Mantiene HTTPS, exige huella SHA-256 y conserva el rechazo antes de enviar credenciales cuando la huella difiere. Omite vencimiento, nombre y CA; no modifica TLS de Railway ni habilita desactivación global. La excepción antigua de pruebas conserva su restricción si no se activa el modo nuevo. No se cambió la sociedad ni se desplegó en el servidor. Guía: docs/CERTIFICADO_FIJADO_PUENTE.md. Parche distribuible con config.js y ejecutar.js; conserva el lanzador oculto existente.

## Reducción de consultas para almacenes 01 y 02 2026-10-03

El usuario reportó lentitud percibida en SAP, sin una causalidad medida, y confirmó los códigos 01 Almacén y 02 Despacho. Se preparó BRIDGE_STOCK_MODE=sql-01-02: consulta parametrizada de Service Layer SQLQueries con JOIN restringidos a esos dos almacenes, hasta 20 artículos por página. Recorre códigos para conservar ceros y retirar saldos antiguos; no descarga los saldos de todos los almacenes ni vuelve al modo masivo ante errores. El modo anterior sigue siendo predeterminado hasta instalar y probar la definición de consulta.

El registro manual crea solo la definición fija SQLQueries si no existe; no cambia stock, documentos, tablas ni permisos. La tarea normal no crea definiciones. Cambio de modo reinicia cursor conservando secuencias, rechaza lotes pendientes y conserva el inventario físico local. El catálogo de productos y almacenes se mantiene completo por las referencias de pedidos; se espacian sus recorridos mediante configuración.

Perfil propuesto: pedidos 10 min, existencias 60 min, productos/códigos 2 h, clientes 4 h, unidades/almacenes 24 h; tarea cada 5 min, pausa entre inicios de consultas 1,5 s y presupuesto original. Backend admite alcance explícito 01/02 y antigüedad configurable (predeterminado 30 min, perfil propuesto 120 min, con aceptación explícita de menor frescura). No se aplicaron variables, permisos, consultas ni despliegues en SAP/Railway.

Verificado: 461/461 pruebas. SQL relacional de JOIN y cursor comprobado con SQLite local adaptando TOP a LIMIT; no es una validación del analizador SAP. PostgreSQL temporal local verificó alcance, datos de 60 minutos permitidos con límite 120, rechazo de 121 minutos, recorridos parciales y filas antiguas. Falta sondeo en FP 2111 y medición de impacto real antes de reactivar. Procedimiento: docs/REDUCIR_CARGA_PUENTE.md.

## Códigos con unidad Manual confirmados al llegar de SAP (2026-10-06)

El usuario confirmó que en SAP todo se vende por unidad. Los códigos con unidad Manual (ficha del artículo o `BarCodes`) quedan confirmados como unidad al llegar, sin pasar por el panel del supervisor. No se pisa una confirmación existente: un "no es una unidad" se conserva y un código confirmado que cambió en SAP sigue como desactualizado. Los de otras unidades siguen esperando al supervisor. Solo cambia el backend; la app no necesita versión nueva. Los pendientes anteriores se confirman con "Confirmar todos como unidad".

Verificado: 476/476 pruebas y PostgreSQL local con producto con ficha, código de SAP Manual, código de SAP en caja y nueva llegada tras marcar "no es una unidad".

## Foto de cuadre al contar (2026-10-07)

El usuario quiere armar por su cuenta un reporte de descuadres (más o menos en físico que en SAP) y saber si cada producto cuadró la primera vez. Como las existencias de SAP se pisan en cada recorrido, cada recepción, conteo de la pequeña y "no hay" deja una foto en `inventario_cuadres`: lo registrado en la bodega, lo que SAP tenía en su almacén y de cuándo, lo preparado sin entregar, la diferencia y si fue el primer registro del producto en esa bodega. Solo backend; la app no cambia. Migración `20261007090000_inventario_cuadres`, que solo agrega la tabla: Prisma propuso además rehacer dos claves foráneas existentes por una diferencia previa con migraciones escritas a mano; se dejó fuera.

Verificado: 476/476 pruebas y PostgreSQL local con recepciones en cajas y por lotes, conteo de la pequeña, "no hay", una recepción posterior (no primera) y la consulta de primer conteo: sobra, cuadró, falta y cuadró en 0.

## Editar el conteo de la grande (2026-10-07)

En la bodega cerraron el conteo de un producto antes de contar todos los lotes y no había forma de agregarlos. Ahora el supervisor edita el conteo: `PUT /inventario/productos/:itemCode/grande` con el mismo cuerpo que recibir por grupos dice cómo queda todo lo de ese producto en la grande. Se conservan las cajas que coinciden (lote, vencimiento, unidades y si es bulto; sus etiquetas siguen valiendo), las que sobran quedan en 0 con un movimiento de corrección y las que faltan se crean con etiqueta nueva. Solo si el producto ya estaba contado y ninguna caja se usó; lo que pasa de lo que SAP tiene por ubicar queda como recibido antes que SAP. Deja una foto de cuadre con `accion: "edicion"`, y en `docs/INVENTARIO.md` está la consulta del resultado final del conteo (primero más sus ediciones). App 1.9.0: botón **Editar conteo** en el conteo y en la ficha, con el formulario precargado; en la 02 abre el conteo por lotes que ya existía. Sin migraciones.

Verificado: 478/478 pruebas del backend, 41/41 de la app, PostgreSQL local (conteo de 40, edición a 80 con un lote y un bulto nuevos, corrección de fecha que anula y recrea una caja) y prueba real con Electron (precarga, agregar lote, corregir lote con el diálogo de etiquetas a retirar, ficha, caja usada y operador sin el botón; axe sin problemas).

## Actualización automática de la app de escritorio (2026-10-07)

Hasta ahora cada versión nueva de la app se instalaba a mano en cada PC. Desde la 1.9.0 la app se actualiza sola con electron-updater: busca al abrir y cada 2 horas, descarga en segundo plano y muestra **Actualizar a X.Y.Z** en la barra; al confirmar se reinicia con la versión nueva, y si nadie lo toca se instala al cerrar la app. Como el repositorio de la app es privado, la app no habla con GitHub: pide `latest.yml` y el instalador a `GET /actualizaciones/:archivo` del backend (con su clave de solo ingreso) y el backend los trae de **Releases** con `ACTUALIZACIONES_GITHUB_TOKEN`, un token de solo lectura que no sale del servidor (en la redirección al almacenamiento de GitHub no se manda). Solo cuentan las versiones publicadas: borradores y pre-release se ignoran. El workflow de la app revisa que `latest.yml` tenga la versión de `package.json` (y de la etiqueta) y el sha512 del instalador, y lo sube al release. Las PCs con versiones anteriores a la 1.9.0 se actualizan una vez a mano. Sin migraciones.

Verificado: 481/481 pruebas del backend (incluye un GitHub de mentira: latest.yml del release más nuevo, instalador de cualquier release, sin token en la redirección, caché de un minuto, 401/404/502/503), 46/46 de la app y prueba real con Electron 1.9.0 contra el backend local y un GitHub de mentira con un release 1.9.1: descarga, sha512 correcto, botón en la barra (también después de recargar y de ingresar), diálogo de confirmación y axe sin problemas. No probado todavía: la instalación en Windows (cerrar, instalar y reabrir), que se verá con la primera versión publicada.

## Conteo de la 01 frenado por una diferencia de la 02 (2026-10-07)

Al contar 78 en la 01 con SAP en 78 en la 01, la app avisó "Contaste más de lo que SAP tiene". El control de lo que se puede guardar en la grande usaba el total del producto (SAP de los dos almacenes menos la 01, la 02 y lo preparado sin entregar): si la 02 tenía registrado más que SAP en la 02, eso le quitaba lugar a la 01. Además, "Guardar igual" anotaba la diferencia como recibida antes que SAP y el producto quedaba "al día", escondiendo la diferencia real de la 02. Ahora, con el almacén de la grande asignado, alcanza con que el conteo entre en lo que SAP tiene en ese almacén menos lo que ya está en cajas (o en lo que falta ubicar en el total, si es más, para no frenar una recepción con un traspaso sin aceptar). Vale también para editar el conteo. El aviso dice los números del almacén ("Estás guardando 84 y SAP tiene 78 en el almacén 01: sobran 6.") y la app 1.9.1 lo muestra tal cual. Sin migraciones.

Verificado: 483/483 pruebas (el caso de la foto: 78 en la 01 con la 02 cinco de más se guarda sin preguntar y sin anotar nada; 84 avisa con los números de la 01; recepción con traspaso sin aceptar), 46/46 de la app y la consulta nueva contra PostgreSQL local.

## Fechas de vencimiento editables en la 02 y años inválidos (2026-10-07)

En la bodega apareció un lote de la 02 con vencimiento "09/8": quedó guardado con el año 8, porque ni la app ni el backend controlaban el año. Además, en **Editar conteo de la 02** la fecha de cada lote se mostraba como texto y no se podía corregir. Ahora el backend rechaza vencimientos con el año fuera de 2000–2099 (en recepciones, conteo de la pequeña y edición de la grande) y la app 1.9.2 avisa antes de mandar ("el año va completo, por ejemplo 2028"). En Editar conteo de la 02 cada fila tiene la fecha precargada y editable; si no se cambia el mes, vuelve la fecha guardada tal cual. Las filas en 0 no se mandan. Sin migraciones.

Verificado: 484/484 pruebas del backend, 46/46 de la app y prueba real con Electron (fecha precargada, año "0008" rechazado, fecha corregida que queda en la base, lote nuevo, y el resto del recorrido de lotes: despacho, por descontar, cambiar lote y por vencer).

## Pasar cajas a la 02 escaneando (2026-10-08)

En la bodega quieren controlar las cajas que pasan de la 01 a la 02. Las etiquetas CJ que imprime la app no se usan; lo que tienen las cajas es el código de barras del proveedor (igual para todas las cajas de un producto, distinto del de la unidad) y, impresos aparte, el lote y la fecha. Decisiones del usuario: se escanea la caja y se elige el lote que dice; si se elige uno que vence después que el recomendado, se avisa y se deja pasar; solo cajas enteras (si no cuadra, lo resuelve el supervisor); aceptar sin escanear, solo el supervisor. El código de la caja se registra al contar la 01 (apartado del formulario) o la primera vez que se escanea al pasar. Tabla nueva `inventario_codigos_caja` (migración `20261008090000_codigos_caja`, solo agrega la tabla); `POST /inventario/codigos-caja`, `DELETE /supervisor/codigos-caja/:id`; `POST /inventario/traspasos` acepta `cajas: [{ lote, vencimiento }]` y sin cajas responde 403 a un operador. App 1.10.0.

Verificado: 488/488 pruebas del backend, 47/47 de la app, la migración contra PostgreSQL local y prueba real con Electron (código de unidad rechazado como caja y registro del de la caja al contar; traspaso de 40 escaneando: recomendado primero, aviso al elegir uno que vence después, quitar la última, otro lote, 2 cajas enteras; traspaso de 30 que no cuadra; el supervisor sin escanear; ficha con el código de caja y quitarlo). Las pruebas reales anteriores (lotes y despacho, conteo, editar conteo) pasan.

## Reportes: cuadre con SAP en el panel del supervisor (2026-10-09)

Durante el conteo físico se armó a mano, con consultas en la base, un PDF de lo que cuadró con SAP y lo que no. Comparándolo con **Pendientes** aparecieron dos diferencias de criterio: "Falta guardar" incluía productos que todavía no se habían contado en la 01, y cuatro productos contados de más en la 02 no aparecían en "Falta marcar salida" porque, al confirmar el aviso de "contaste más de lo que SAP tiene", quedaron anotados como recibidos antes que SAP. Decisiones del usuario: un módulo de reportes solo para el supervisor, en pantalla y en PDF, empezando por el cuadre; sin la sección de lo que falta contar y sin los recibidos antes que SAP.

`GET /supervisor/reportes/cuadre` (`reporteCuadre` en `inventario.service.js`, cálculo en `inventario.reporte.js`, consulta `cuadrePorBodega`): usa `clasificar` igual que Pendientes, deja afuera lo no contado en alguna bodega (cuenta en `resumen.pendientes`) y lo que SAP cambió hace menos de 15 minutos (`resumen.actualizando`), y devuelve `menos` y `mas` con lo contado, lo de SAP y la diferencia de cada bodega. Exige las dos bodegas asignadas (`409 BODEGAS_SIN_ALMACEN`). App 1.11.0: pestaña **Reportes** del panel y **Descargar PDF** (`printToPDF` de la propia ventana con la hoja que la página arma en su zona de impresión; la app pregunta dónde guardar, propone Documentos y lo abre). Nada cambia en la base.

Verificado: 496/496 pruebas del backend (incluye el cálculo: pendientes, actualizando, recibido antes que SAP, preparado sin entregar, orden; y la ruta: 403 al operador, 409 sin bodegas, la respuesta completa), la consulta nueva contra PostgreSQL local, 50/50 de la app y prueba real con Electron: cifras, frases, tablas y nota de la pantalla contra datos sembrados, axe sin problemas, PDF guardado de 3 hojas con fondo blanco y otro de 73 productos (encabezado repetido en cada hoja, sin filas cortadas), y el recorrido de cajas de la 1.10.0 sin cambios.

## Comparar con SAP mientras el puente actualiza existencias (2026-10-09)

Al abrir Reportes apareció "Faltan datos recientes de almacenes y existencias de SAP". Los registros de Railway muestran que cada hora el puente hace un recorrido de existencias que dura unos 20 minutos (lo retoma cada 5 minutos hasta terminarlo), y durante ese rato la comparación se cortaba: exigía el recorrido terminado y todas las existencias observadas desde su inicio. Pendientes y Reportes quedaban sin comparación unos 20 minutos por hora. Decisión del usuario: comparar con los datos que ya hay, sin esperar los más nuevos.

`comparacionDisponible` ahora pide que cada existencia esté confirmada por SAP hace menos de `INVENTARIO_SAP_MAX_AGE_MINUTES` (la edad es la de la confirmación más vieja) y que algún recorrido de existencias haya terminado alguna vez (en el primero todavía faltan productos). Mientras dura un recorrido nuevo se compara con lo del anterior y lo ya actualizado; cada producto se actualiza entero, y lo que SAP acaba de cambiar sigue esperando 15 minutos ("actualizando"). Sin migración.

Verificado: 496/496 pruebas y la consulta contra PostgreSQL local en ocho casos (recorrido terminado; recorrido nuevo en curso, con y sin parte actualizada; lo más viejo pasando el máximo; primer recorrido en curso y terminado; sin recorrido de almacenes o de más de 48 horas).
