# Reducir consultas del puente para almacenes 01 y 02

## Alcance

Confirmado por el usuario: 01 Almacén y 02 Despacho. El modo `sql-01-02` consulta sus saldos desde SAP con SQLQueries, por Service Layer. No se conecta directamente a SQL Server. Los JOIN a OITW se restringen a esos dos códigos; se devuelve una fila por artículo, hasta 20 por consulta, en lugar de descargar la colección completa de almacenes por cada artículo.

Se recorren los códigos de TODOS los artículos para retirar saldos de los que pasan a cero, dejan de ser inventariables o ya no tienen filas de existencias. Solo se obtienen cantidades de 01 y 02. No es una consulta incremental por fecha. Productos y códigos de barras mantienen su catálogo completo para no romper referencias de pedidos; el catálogo de almacenes también se conserva, pero con intervalo de 24 horas. La copia de existencias de otros almacenes se retira en el backend artículo por artículo durante el primer recorrido; no se altera el inventario físico local ni SAP.

La reducción de datos y solicitudes es una expectativa de diseño, no una garantía de menor carga: medir SAP con el modo nuevo antes de reactivar la tarea permanentemente. Las pruebas locales no reemplazan comprobar la sintaxis, permisos y rendimiento en el Service Layer instalado.

## 1 Mantener la tarea pausada

En PowerShell del servidor:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Si figura Running, esperar a que termine. Conservar .env.puente, .bridge-state, logs, certificado y ejecutar-oculto.vbs. Respaldar toda la instalación antes de reemplazar código. No borrar ni editar el avance para acelerar el cambio.

## 2 Actualizar el backend

Desplegar el código nuevo en Railway. Esta ampliación no agrega una migración. En las variables del backend configurar:

```dotenv
INVENTARIO_SAP_WAREHOUSES=01,02
INVENTARIO_SAP_MAX_AGE_MINUTES=120
```

120 minutos es una tolerancia propuesta para un recorrido cada hora más el tiempo necesario para completarlo. Significa aceptar información de hasta dos horas desde el inicio del recorrido; no significa stock en tiempo real. El valor predeterminado sigue siendo 30. La comparación sigue bloqueada durante recorridos incompletos, con filas no observadas o si el supervisor selecciona almacenes ajenos a 01/02. Antes de cargar, dejar seleccionados solo 01 y 02 (o el subconjunto realmente utilizado) en la app.

## 3 Actualizar el paquete y las frecuencias

En la PC de desarrollo:

```powershell
npm test
npm run empaquetar:puente -- --destino=puente-almacenes-01-02
```

Copiar el paquete al servidor con la tarea pausada, conservando todos los elementos citados en el paso 1. No sobrescribir .env.puente con la plantilla. Cambiar o agregar UNA sola línea de cada variable en el archivo existente:

```dotenv
BRIDGE_INVENTORY_ENABLED=true
BRIDGE_STOCK_MODE=sql-01-02
BRIDGE_FREQUENCIES_JSON={"pedidos":600,"existencias":3600,"productos":7200,"codigosBarras":7200,"clientes":14400,"unidades":86400,"almacenes":86400}
BRIDGE_MAX_REQUESTS=25
BRIDGE_MAX_SECONDS=120
BRIDGE_REQUEST_DELAY_MS=1500
BRIDGE_INTERVAL_SECONDS=300
```

La pausa entre inicios de consultas sube a 1,5 segundos. No se realizan consultas en paralelo. BRIDGE_INTERVAL_SECONDS solo regula el modo --watch: NO cambia la tarea de Windows. En Propiedades de Puente, Desencadenadores, editar el existente para repetir cada 5 minutos; conservar usuario, acción oculta y otras opciones. En Configuración, elegir No iniciar una nueva instancia si ya se ejecuta. Conservar la tarea pausada durante la preparación.

Pedidos cada 10 minutos es el intervalo mínimo entre recorridos completos; los presupuestos y la programación pueden sumar retraso. Cargas pendientes se retoman cada 5 minutos. Un cliente o artículo nuevo puede requerir primero su catálogo; si urge, programar una carga controlada, no aumentar todos los intervalos a ciegas ni usar --forzar habitualmente.

## 4 Preparar la consulta oficial de lectura

La consulta fija está en puente/existencias.sql.js. SQLQueries está documentado desde SAP B1 10.0 FP 2011. Requiere acceso autorizado a OITM y OITW y permiso para ejecutar la consulta. No modificar allowlists ni reiniciar servicios como solución automática a un error.

En el servidor, desde la instalación:

```powershell
cd C:\puente-cosprobell
if (Test-Path '.\certificado\service-layer.pem') {
  $env:NODE_EXTRA_CA_CERTS = (Resolve-Path '.\certificado\service-layer.pem').Path
}
node --env-file=.env.puente puente/preparar-existencias.js --comprobar
```

--comprobar no escribe nada: valida que la definición exista y consulta una fila. Si devuelve HTTP_404, revisar con el administrador que SQLQueries esté disponible y que falte la definición. Para registrar por primera vez la definición revisada:

```powershell
node --env-file=.env.puente puente/preparar-existencias.js --registrar
```

--registrar crea únicamente el objeto SQLQueries COSPROBELL_STOCK_0102_V1 si no existe. Es una escritura de configuración en SAP, no de artículos, stock ni documentos. Nunca reemplaza otra definición ni modifica permisos. Repetirlo con la misma definición no crea duplicados. Requiere una cuenta autorizada para registrar consultas; si falla con 400, 401 o 403, conservar el error y revisar antes de seguir. El puente automático solo ejecuta consultas y no registra definiciones.

Esperar el evento consulta_existencias_lista. Esto verifica una fila; todavía se debe completar y comparar el recorrido. Si la consulta falla, no hay retorno automático al modo masivo anterior.

## 5 Sondeo y primer recorrido

```powershell
.\ejecutar-puente.cmd --sondeo
Get-Content ('.\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

Debe terminar con código 0. Después ejecutar un ciclo manual y revisar el log. Al detectar el modo nuevo, existencias reinicia su cursor desde el principio, conservando la secuencia y la caché. El primer recorrido retira de nuestra copia los saldos de otros almacenes. La comparación se habilita únicamente al completar los controles del backend.

Si aparece CAMBIO_FUENTE_CON_PENDIENTE, no borrar el estado: hay un lote anterior sin confirmar. Revisar antes de migrar, confirmar ese lote con el modo anterior de forma controlada y luego volver a sql-01-02. Una respuesta final perdida también requiere revisión si el backend y el estado difieren. Nunca alternar modos para ocultar errores.

## 6 Medir antes de dejar automático

Comparar los saldos de 01 y 02 con SAP, incluido un cambio a cero. Comprobar que otras filas de stock no se suman ni aparecen como stock disponible de esta bodega. Comparar el tiempo de una misma operación de SAP con el puente detenido y durante el sondeo y recorrido nuevos. Registrar consultasSap y duracionMs; una captura aislada de CPU no demuestra ausencia de impacto.

Solo si la prueba no reproduce la lentitud, habilitar la tarea a 5 minutos y medir un recorrido automático completo. Mantenerla pausada si vuelve la lentitud. No atribuir una reducción porcentual de carga a las pruebas simuladas.

## Referencia oficial

SAP Working with SAP Business One Service Layer, capítulo SQL Query: parámetros, paginación, TOP, ORDER BY, LEFT JOIN y tablas permitidas. Validar contra FP 2111 instalado antes de producción.

https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf
