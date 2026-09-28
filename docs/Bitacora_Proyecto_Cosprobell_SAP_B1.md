# Bitácora del proyecto — Cosprobell · SAP Business One

Última actualización: 28 de septiembre de 2026.

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
