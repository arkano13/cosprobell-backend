# Emisor del puente: productos y clientes

## Qué incluye

Programa Node.js separado en puente/. Requiere Node 22 o superior (verificado con Node 22) y las dependencias del proyecto. No importa la conexión PostgreSQL ni necesita DATABASE_URL; comparte únicamente el contrato Zod del receptor. La entrega no instala un servicio de Windows ni ejecuta conexiones reales a SAP.

- config.js: configuración, URLs, TLS y vínculo de origen.
- sap.client.js: Login, cookies B1SESSION/ROUTEID, lectura de Items, renovación una vez ante 401 y Logout.
- productos.js: convierte ItemCode, ItemName, BarCode, Valid y Frozen al contrato del backend. Solo tYES/tNO se interpretan como booleanos. Código de barras vacío pasa a null; datos faltantes o inválidos detienen el envío.
- backend.client.js: consulta el avance y envía lotes con la credencial Bearer del puente. Comprueba la confirmación.
- estado.js: archivo local de avance y lote pendiente, escritura mediante archivo temporal + fsync + rename; candado con el PID del proceso para impedir dos ejecuciones usando la misma carpeta y recuperarse solo tras un cierre forzado.
- entidades.js: qué consulta y envía cada entidad (recurso SAP, campos, clave, filtro) y en qué orden: clientes y luego productos.
- clientes.js y lote.js: conversión de BusinessPartners (solo clientes) y armado común de lotes con detalle del registro inválido.
- sincronizar.js: persiste antes de enviar, confirma después de respuesta y recupera pendientes al reiniciar. Se ejecuta una vez por entidad en cada ciclo.
- ejecutar.js: ejecución única o periódica, espera creciente ante errores temporales y parada por señales.

## Instalación y configuración

En el equipo donde se ejecutará el puente debe existir Node 22 o superior, las dependencias del proyecto y acceso de red a SAP y al backend. Este paquete usa puente/ y src/modules/sincronizacion/productos.schemas.js; no copiar únicamente puente/ a otro equipo sin ese contrato y zod. Para instalarlo en Windows sin copiar el proyecto completo: `npm run empaquetar:puente` y la guía `INSTALAR_PUENTE_WINDOWS.md` (tarea programada cada 15 minutos con `--once`).

Copiar .env.puente.example a .env.puente sin sobrescribir una configuración existente. Completar localmente:

- SAP_SERVICE_LAYER_URL: URL terminada en /b1s/v1 o /b1s/v2.
- SAP_COMPANY_DB: XPRUEBAS2026 para la prueba acordada.
- SAP_USER y SAP_PASSWORD: acceso SAP proporcionado por el administrador.
- BACKEND_URL: raíz HTTPS del backend (sin /integracion).
- BRIDGE_API_KEY: misma clave configurada en el receptor, distinta de la contraseña SAP.
- BRIDGE_STATE_DIR: carpeta persistente, preferiblemente ruta absoluta al desplegar.
- BRIDGE_INTERVAL_SECONDS: intervalo entre recorridos terminados; predeterminado 900 segundos, mínimo 60. Es un valor inicial configurable, no una frecuencia aprobada para producción.

.env.puente y .bridge-state/ quedan ignorados por Git. Si se usa otra carpeta para el estado, ubicarla fuera del repositorio. Limitar acceso mediante permisos de Windows a la cuenta del servicio y administradores. Las credenciales quedan en el archivo de configuración; no se cifran automáticamente en esta versión. No introducirlas en comandos, repositorios, capturas ni chats.

Para certificados de CA privada, el administrador debe facilitar la cadena confiable en PEM. Definir NODE_EXTRA_CA_CERTS en el entorno del proceso antes de arrancar Node. No desactivar TLS: el programa rechaza NODE_TLS_REJECT_UNAUTHORIZED=0. Solo localhost/127.0.0.1/::1 admiten HTTP para pruebas locales; las otras direcciones requieren HTTPS. Los redireccionamientos HTTP se rechazan.

## Ejecución

Desde la raíz del proyecto, con el backend preparado y su migración aplicada:

```bash
node --env-file=.env.puente puente/ejecutar.js --once
```

Ese comando SÍ consulta el SAP configurado y SÍ envía productos a la base del backend. Comprobar empresa de pruebas y destino antes de ejecutarlo. Por defecto también se ejecuta una sola vez. No usar a la vez --once y --watch.

Después de revisar la primera carga y acordar el intervalo:

```bash
node --env-file=.env.puente puente/ejecutar.js --watch
```

El modo periódico sigue siendo un proceso de consola; no está registrado en el administrador de servicios de Windows. Ctrl+C solicita detenerse; una solicitud HTTP en curso tiene timeout de 30 segundos y se deja conservar su resultado. Logout puede consumir otros 30 segundos. No iniciar dos emisores con distintas carpetas para el mismo destino: el candado local protege una carpeta y la secuencia del backend detecta conflictos, pero no elige un emisor principal.

## Varias entidades

Cada ciclo recorre clientes y luego productos. Cada entidad tiene su archivo de estado (clientes.json, productos.json) y su secuencia en el backend; el candado ejecucion.lock es uno solo para el proceso. Un error de datos en una entidad se registra con `"entidad"` y no impide sincronizar las demás; el proceso termina con código 1. Un error de conexión corta el ciclo completo.

```json
{"evento":"ciclo","entidad":"clientes","completo":true,"lotes":2,"ultimaSecuencia":2}
{"evento":"fallo","entidad":"clientes","codigo":"CLIENTE_SAP_INVALIDO","temporal":false,"detalle":{"cardCode":"C0030","campo":"CardName"}}
```

## Recorrido y recuperación

Solicita hasta 50 productos por petición (`$top=50` y `Prefer: odata.maxpagesize=50`; sin ese encabezado Service Layer devuelve 20), ordenados por ItemCode, con filtro mayor al último código confirmado. Si SAP devuelve una página menor, continúa igualmente hasta recibir una página vacía. No sigue URLs nextLink externas: genera las consultas contra el origen configurado. La consulta usa `$` literal y espacios como `%20`, la misma forma que Service Layer aceptó desde el navegador; no se usa `URLSearchParams` porque enviaría `%24select` y `+`, sin confirmar con el SAP real. Este recorrido por clave debe validarse con la ordenación/collation y permisos reales del catálogo.

Cada página se valida y se guarda como lote pendiente ANTES de enviar. Si se pierde una respuesta, se reenvía el mismo contenido/número. El siguiente cursor solo se confirma después de que el backend acepte el lote. Al terminar se reinicia el cursor para recorrer el catálogo completo en el siguiente ciclo.

El archivo se vincula a empresa, URL SAP y URL backend, sin guardar contraseñas ni cookies. Al arrancar se compara la secuencia local con la remota; discrepancias inesperadas requieren reconciliación. No borrar el archivo para forzar el inicio ni adoptar automáticamente la secuencia remota. Si se cambia la dirección, restauran bases o pierde estado, detener y revisar ambos extremos.

ejecucion.lock contiene un archivo pid con el proceso que lo tomó. Ante interrupción normal se retira. Si una terminación forzada o un apagón lo deja, la siguiente ejecución comprueba ese PID: si el proceso ya no existe, aparta el candado huérfano (renombrado atómico con verificación) y continúa sin intervención. Si el proceso existe, responde PUENTE_YA_BLOQUEADO.

Casos que siguen requiriendo al administrador, todos poco frecuentes: un candado sin archivo pid (versión anterior del puente o corte justo entre crear la carpeta y escribir el PID) y un PID reutilizado por otro programa después de reiniciar el equipo. En ambos, verificar que no haya otro proceso del puente y retirar ÚNICAMENTE ejecucion.lock; conservar productos.json. `node scripts/comprobar-candado-puente.js` comprueba con procesos reales el cierre forzado y varias recuperaciones simultáneas; conviene ejecutarlo una vez en el equipo Windows del puente. El registro como servicio y el reinicio supervisado quedan para endurecimiento de despliegue.

Errores de conexión y HTTP 408/429/500/502/503/504 se reintentan en modo periódico con espera creciente hasta 60 segundos. Errores de datos, credenciales, configuración, disco o conflictos detienen el proceso con código de salida 1. Un producto que no cumple el contrato se informa con su código y el campo SAP, sin el valor: `{"evento":"fallo","codigo":"PRODUCTO_SAP_INVALIDO","temporal":false,"detalle":{"itemCode":"A-100","campo":"ItemName"}}`. Hay que corregirlo en SAP; mientras tanto, los productos posteriores de ese recorrido no se actualizan. No se imprimen respuestas remotas, cookies ni credenciales. Los errores de conexión/certificado se agrupan como CONEXION_O_TLS y requieren diagnóstico del administrador si persisten. No hay alertas externas ni rotación de registros configuradas aún.

## Límites

Recorre todo el catálogo: aún no es una sincronización incremental. El recorrido no es una instantánea transaccional de SAP; un alta con código anterior al cursor se recogerá en el siguiente ciclo. No detecta eliminaciones por ausencia ni sincroniza códigos adicionales, unidades, existencias, precios o pedidos. No garantiza funcionamiento sin internet en bodega.

Conservar el estado en disco evita pérdidas comunes por reinicio, pero no sustituye respaldos y supervisión del almacenamiento. La instalación como servicio y pruebas de corte eléctrico se planifican después del piloto.

## Evidencia

217/217 pruebas automatizadas aprobadas. Incluyen configuración, detalle del producto inválido, recuperación del candado huérfano, forma exacta de la consulta, transformación, estado persistente, candado, archivo corrupto, fallo de disco antes del envío, recuperación tras respuesta perdida, sesión SAP vencida, escape OData, confirmación incorrecta y recorrido HTTP con servidores locales simulados. No se contactó SAP ni se usaron credenciales reales.

Referencia de sesiones: [guía oficial SAP](https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf). Se usa el flujo clásico Login/B1SESSION disponible en la versión acordada; no se incorporan funciones recientes como webhooks.
