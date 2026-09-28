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
| Pruebas automatizadas | 61 de 61 aprobadas mediante ejecución de `npm test` por el asistente al cerrar la reorganización de picking; persistencia simulada |
| Picking por capas | Completada la separación en rutas, schemas, controlador, servicio y repositorio; conservado el comportamiento anterior |
| Concurrencia de picking | Transacción con bloqueo de sesión y retirada de `SKIP LOCKED`; seis escenarios contra PostgreSQL aprobados según resultados compartidos y confirmación del usuario; detalle en sección 11 |
| Búsqueda por código de barras | Código principal, adicional, inexistente y ambiguo comprobados manualmente por el usuario contra su base configurada |
| Conexión de búsqueda con escaneo | Pendiente; picking todavía compara el código recibido con `itemCode` y suma uno |
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

**Punto actual:** reorganización de picking terminada y ronda de concurrencia completada por el usuario. La sección 11 registra los resultados posteriores al cierre de estructura.

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
