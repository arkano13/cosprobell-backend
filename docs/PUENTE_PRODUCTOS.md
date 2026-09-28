# Emisor de productos — primera versión

## Qué incluye

Programa Node.js separado en puente/. Requiere Node 24 y las dependencias del proyecto. No importa la conexión PostgreSQL ni necesita DATABASE_URL; comparte únicamente el contrato Zod del receptor. La entrega no instala un servicio de Windows ni ejecuta conexiones reales a SAP.

- config.js: configuración, URLs, TLS y vínculo de origen.
- sap.client.js: Login, cookies B1SESSION/ROUTEID, lectura de Items, renovación una vez ante 401 y Logout.
- productos.js: convierte ItemCode, ItemName, BarCode, Valid y Frozen al contrato del backend. Solo tYES/tNO se interpretan como booleanos. Código de barras vacío pasa a null; datos faltantes o inválidos detienen el envío.
- backend.client.js: consulta el avance y envía lotes con la credencial Bearer del puente. Comprueba la confirmación.
- estado.js: archivo local de avance y lote pendiente, escritura mediante archivo temporal + fsync + rename; candado para impedir dos ejecuciones usando la misma carpeta.
- sincronizar.js: persiste antes de enviar, confirma después de respuesta y recupera pendientes al reiniciar.
- ejecutar.js: ejecución única o periódica, espera creciente ante errores temporales y parada por señales.

## Instalación y configuración

En el equipo donde se ejecutará el puente debe existir Node 24, las dependencias del proyecto y acceso de red a SAP y al backend. Este paquete usa puente/ y src/modules/sincronizacion/productos.schemas.js; no copiar únicamente puente/ a otro equipo sin ese contrato y zod. El empaquetado como servicio de Windows se hará después de validar la conexión.

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

## Recorrido y recuperación

Solicita hasta 50 productos por petición, ordenados por ItemCode, con filtro mayor al último código confirmado. Si SAP devuelve una página menor, continúa igualmente hasta recibir una página vacía. No sigue URLs nextLink externas: genera las consultas contra el origen configurado. Este recorrido por clave debe validarse con la ordenación/collation y permisos reales del catálogo.

Cada página se valida y se guarda como lote pendiente ANTES de enviar. Si se pierde una respuesta, se reenvía el mismo contenido/número. El siguiente cursor solo se confirma después de que el backend acepte el lote. Al terminar se reinicia el cursor para recorrer el catálogo completo en el siguiente ciclo.

El archivo se vincula a empresa, URL SAP y URL backend, sin guardar contraseñas ni cookies. Al arrancar se compara la secuencia local con la remota; discrepancias inesperadas requieren reconciliación. No borrar el archivo para forzar el inicio ni adoptar automáticamente la secuencia remota. Si se cambia la dirección, restauran bases o pierde estado, detener y revisar ambos extremos.

Ante interrupción normal se retira ejecucion.lock. Una terminación forzada o apagón puede dejar el directorio de candado. En ese caso el programa se detiene con PUENTE_YA_BLOQUEADO: el administrador debe verificar que no quede otro proceso y retirar ÚNICAMENTE ese directorio vacío; conservar productos.json. No hay desbloqueo automático ni garantía de recuperación desatendida tras apagón en esta versión. El registro como servicio, reinicio supervisado y recuperación del candado quedan para endurecimiento de despliegue.

Errores de conexión y HTTP 408/429/500/502/503/504 se reintentan en modo periódico con espera creciente hasta 60 segundos. Errores de datos, credenciales, configuración, disco o conflictos detienen el proceso con código de salida 1. No se imprimen respuestas remotas, cookies ni credenciales. Los errores de conexión/certificado se agrupan como CONEXION_O_TLS y requieren diagnóstico del administrador si persisten. No hay alertas externas ni rotación de registros configuradas aún.

## Límites

Recorre todo el catálogo: aún no es una sincronización incremental. El recorrido no es una instantánea transaccional de SAP; un alta con código anterior al cursor se recogerá en el siguiente ciclo. No detecta eliminaciones por ausencia ni sincroniza códigos adicionales, unidades, existencias, precios o pedidos. No garantiza funcionamiento sin internet en bodega.

Conservar el estado en disco evita pérdidas comunes por reinicio, pero no sustituye respaldos y supervisión del almacenamiento. La instalación como servicio y pruebas de corte eléctrico se planifican después del piloto.

## Evidencia

211/211 pruebas automatizadas aprobadas. Incluyen configuración, transformación, estado persistente, candado, archivo corrupto, fallo de disco antes del envío, recuperación tras respuesta perdida, sesión SAP vencida, escape OData, confirmación incorrecta y recorrido HTTP con servidores locales simulados. No se contactó SAP ni se usaron credenciales reales.

Referencia de sesiones: [guía oficial SAP](https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf). Se usa el flujo clásico Login/B1SESSION disponible en la versión acordada; no se incorporan funciones recientes como webhooks.
