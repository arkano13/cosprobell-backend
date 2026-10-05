# Producción COSPROBELL: selección de almacenes

Actualización del 5 de octubre de 2026. Esta guía reemplaza la selección fija 01/02 de REDUCIR_CARGA_PUENTE.md. No se ha ejecutado ningún cambio en SAP ni en Railway desde el desarrollo local.

## Selección confirmada por el usuario

Sociedad: COSPROBELL. Almacenes solicitados: 01, 02, v01, v03, v05, v05-1 y 99. Antes de ejecutar, confirmar mayúsculas y minúsculas con los códigos devueltos por SAP. El cliente rechaza códigos inexistentes o con otro uso de mayúsculas; no convierte un error de selección en stock cero.

En .env.puente del servidor (conservar credenciales y configuración TLS):

```dotenv
SAP_COMPANY_DB=COSPROBELL
BRIDGE_STATE_DIR=.bridge-state-produccion
BRIDGE_INVENTORY_ENABLED=true
BRIDGE_STOCK_MODE=sql-almacenes
BRIDGE_WAREHOUSES=01,02,v01,v03,v05,v05-1,99
BRIDGE_FREQUENCIES_JSON={"pedidos":600,"existencias":3600,"productos":7200,"codigosBarras":7200,"clientes":14400,"unidades":86400,"almacenes":86400}
BRIDGE_MAX_REQUESTS=25
BRIDGE_MAX_SECONDS=120
BRIDGE_REQUEST_DELAY_MS=1500
BRIDGE_INTERVAL_SECONDS=300
```

No reutilizar estado ni datos de XPRUEBAS2026 para COSPROBELL. La carpeta de estado de producción debe ser nueva. Respaldar instalación y PostgreSQL, pausar el puente y detener escrituras del backend antes de limpiar los datos de pruebas con scripts/limpiar-datos-pruebas.sql. No ejecutar ese SQL en SAP. Conserva api_keys y migraciones; elimina operadores y configuración de pruebas. No ejecutar seed después.

Variables de Railway, con los mismos códigos exactos:

```dotenv
INVENTARIO_SAP_WAREHOUSES=01,02,v01,v03,v05,v05-1,99
INVENTARIO_SAP_MAX_AGE_MINUTES=120
```

120 permite comparar datos de hasta dos horas desde el inicio del recorrido. La comparación se bloquea durante recorridos incompletos o si se selecciona un almacén fuera del alcance. Reconfigurar la selección física en la app después de limpiar.

## Preparación manual

Con la tarea aún deshabilitada, desde PowerShell del servidor:

```powershell
cd C:\puente-cosprobell
if (Test-Path '.\certificado\service-layer.pem') {
  $env:NODE_EXTRA_CA_CERTS = (Resolve-Path '.\certificado\service-layer.pem').Path
}
node --env-file=.env.puente puente/preparar-existencias.js --comprobar
```

Si falta la definición y se ha verificado que SQLQueries está disponible, registrar explícitamente:

```powershell
node --env-file=.env.puente puente/preparar-existencias.js --registrar
```

Este comando crea una definición de consulta en SAP si falta; no modifica documentos ni cantidades. Cambiar la selección genera otro identificador de consulta; nunca sobrescribe la anterior. Se debe comprobar/registrar la nueva definición antes de reactivar. No cambia permisos ni allowlists ni reinicia SAP. Con errores 400/401/403 o ALMACEN_SAP_INVALIDO, revisar el error, no forzar.

Esperar consulta_existencias_lista, luego ejecutar --sondeo y una carga manual con ejecutar-puente.cmd, revisar logs y comparar con SAP. No se ha validado la sintaxis ni el rendimiento contra el Service Layer instalado; las pruebas locales no sustituyen este paso.

## Qué se filtra

Solo las cantidades por almacén: siete LEFT JOIN de OITW limitados a la selección dentro de SAP, hasta 20 artículos por página. Se recorren todos los códigos de artículo para reconocer saldos cero, filas ausentes y artículos no inventariables. Productos, códigos de barras y catálogo de almacenes permanecen completos; no se filtran los pedidos por esta variable.

No es lectura incremental por fecha. El envío al backend conserva el control de cambios existente. Cambiar la lista reinicia el recorrido conservando secuencia; si hay un lote pendiente, se bloquea el cambio hasta resolverlo. Reducir la lista retira de nuestra copia los saldos fuera de ella artículo por artículo. No altera el inventario físico local.

## Automatización

Editar el desencadenador existente a 5 minutos y No iniciar una nueva instancia si ya se ejecuta. BRIDGE_INTERVAL_SECONDS solo controla --watch, no la tarea de Windows. Mantener ejecutar-oculto.vbs y las credenciales de la instalación.

Habilitar solo después de validar saldos, recorrido completo y carga sobre SAP. La cuenta debe poder ejecutar sin sesión abierta para operación permanente; la configuración interactiva de usuario05 no cubre cierre de sesión.
