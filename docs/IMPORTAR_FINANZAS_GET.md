# Importación financiera puntual de Cosprobell

Preparada el 26 de octubre de 2026 sobre el backend actual. El paquete no incluye credenciales ni datos reales de SAP. La validación final del mapeo requiere el sondeo en el servidor.

## Qué hará

Leer mediante GET del Service Layer todo el historial disponible desde 1900 y enviarlo al backend, que lo guarda en nuestra BD. Trabaja por tandas; al terminar, sale. No crea una tarea financiera periódica.

Incluye empresa (monedas configuradas manualmente), clientes con ruta U_ZONA, vendedores, condiciones de pago, facturas y líneas, cuotas, notas de crédito y líneas, pagos, aplicaciones de pagos y movimientos contables. Las lecturas de movimientos incluyen líneas de mayor además de clientes: consultar por código de cliente para un estado de cuenta. No filtra esta carga por almacén 02 ni por la ventana reciente de preparación.

Excluye conciliaciones y partidas abiertas verificadas. No declara cartera conciliada ni antigüedad exacta. Los campos no obtenidos se guardan como null: saldos FC/SC de clientes; importes pagados, total SC y estado por cuota; total completo y desgloses no expuestos de pagos; referencia numérica de documento en movimientos. Se conserva el importe aplicado por documento disponible en PaymentInvoices, pero no se reconstruyen todas las aplicaciones manuales de notas de crédito.

El catálogo de monedas comprueba que existen los códigos, no que sean la moneda local o del sistema. Esa asignación fue confirmada manualmente por el usuario: LPS local, USD sistema.

Login y Logout conservan su POST de autenticación habitual. Las lecturas financieras son GET. Este ejecutor no registra SQLQueries ni modifica documentos, tablas, permisos o configuración de SAP. El POST al backend es necesario para guardar los datos en nuestra BD.

## 1. Publicar primero el backend actualizado

Esta entrega modifica el receptor y contratos para admitir null y distinguir `get_parcial`. Es necesario publicar ese código antes de cargar. Usa las tablas existentes `finanzas_control` y `finanzas_registros`; no añade una migración nueva. Comprobar y aplicar las migraciones pendientes del proyecto por el procedimiento habitual, si las hubiera. No borrar tablas ni datos de bodega.

Revisar archivos y pruebas antes de hacer commit/push. La importación se guarda en `FinanzaRegistro` y se consulta con `/finanzas`, no en las tablas tradicionales que consultan `/facturas` y `/pagos`. Para importar sirve la clave del puente existente; consultar `/finanzas` después requiere una aplicación autorizada en `FINANZAS_APPS_AUTORIZADAS`.

## 2. Copiar a una carpeta aparte del servidor

Con el Explorador, extraer el ZIP y colocar su contenido en:

`C:\importacion-finanzas-cosprobell`

No reemplazar `C:\puente-cosprobell`. El paquete incluye módulos compartidos para funcionar por sí solo; su único punto de entrada para esta operación es `puente/importar-finanzas.js`. No ejecutar los antiguos scripts de registro financiero ni instalar tareas de Windows de este paquete.

Copiar de manera privada el `.env.puente` operativo a la carpeta nueva. No enviarlo al chat ni subirlo a Git. Conservar sus credenciales, URL del backend y configuración TLS.

El servidor debe usar Node 22.13 o posterior; se recomienda conservar el Node 24 ya utilizado. Comprobar:

```powershell
node --version
```

## 3. Ajustar la copia de .env.puente

Actualizar estas entradas sin duplicarlas:

```dotenv
BRIDGE_FINANCE_ENABLED=true
BRIDGE_FINANCE_SINCE=1900-01-01
BRIDGE_FINANCE_LOCAL_CURRENCY=LPS
BRIDGE_FINANCE_SYSTEM_CURRENCY=USD
BRIDGE_FINANCE_ROUTE_FIELD=U_ZONA
BRIDGE_FINANCE_ZONE_FIELD=
BRIDGE_FINANCE_FREQUENCIES_JSON={}
BRIDGE_FINANCE_MAX_REQUESTS=10
BRIDGE_FINANCE_MAX_SECONDS=60
BRIDGE_FINANCE_IMPORT_PAUSE_SECONDS=30
BRIDGE_STATE_DIR=C:\puente-cosprobell\.bridge-state-produccion
```

El último valor debe ser la **ruta absoluta de la carpeta de estado que usa el puente operativo**. En la instalación conversada era `.bridge-state-produccion`; confirmar que sigue siendo esa. Ambos ejecutores deben usar la misma carpeta para compartir el candado y no consultar SAP simultáneamente. No crear otro estado financiero para saltarse una discrepancia con el backend. No cambiar empresa ni URL del backend durante una carga.

Si existe un certificado configurado con una ruta relativa o un lanzador externo que define NODE_EXTRA_CA_CERTS, conservar esa configuración también para esta ejecución. La instalación que revisamos utilizaba la huella TLS existente en `.env.puente`.

## 4. Ejecutar la prueba pequeña

Coordinar la prueba cuando el puente operativo no esté ejecutándose. Si el candado está ocupado, esperar a que termine esa ejecución. Para sondear todos los conjuntos, sin enviar registros al backend:

```powershell
cd C:\importacion-finanzas-cosprobell
node --env-file=.env.puente puente/importar-finanzas.js --sondeo
$LASTEXITCODE
```

Esperado: `sondeo_financiero` por entidad, mostrando cantidad de muestra y campos no disponibles; salida 0. Se pausa entre muestras. Una muestra vacía no comprueba el mapeo de registros reales de esa entidad. Si aparece un error, guardar esa salida y resolverlo antes de cargar. El sondeo no certifica todos los documentos del historial.

Para repetir solo una muestra:

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --sondeo --entidad=facturas
```

El informe sin valores de clientes queda en la carpeta de estado como `sondeo-importacion-finanzas.json`. No usar `--registrar` ni `--forzar` con este importador.

## 5. Cargar hasta terminar

Cuando el backend esté publicado y todas las muestras hayan pasado:

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --cargar
```

El comando continúa solo por tandas de hasta 10 solicitudes y 60 segundos, con al menos 1,5 segundos entre inicios de consultas. Libera el candado y la sesión SAP entre tandas y espera 30 segundos. Puede esperar también a que termine el puente operativo. Los límites del puente de bodega no cambian. La duración total depende del historial y de SAP; no hay una estimación confirmada.

Para interrumpir, presionar Ctrl+C una vez y dejar terminar la consulta/confirmación actual. Para continuar otro día, repetir exactamente `--cargar`. Conservar todos los archivos de estado. Cada lote solo avanza después del acuse del backend; un acuse perdido se reintenta sin duplicar.

Para hacer únicamente una tanda y salir:

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --tanda
```

`pausa_por_presupuesto` no es una carga completa. Un conjunto terminado no se vuelve a recorrer por repetir `--cargar`. Una segunda importación deliberada para actualizar datos futuros requiere acordar un nuevo recorrido; este comando no reinicia automáticamente el histórico terminado.

## 6. Confirmar el resultado

```powershell
node --env-file=.env.puente puente/importar-finanzas.js --estado
```

Muestra el estado local sin consultar SAP ni el backend. Revisar además el informe `informe-importacion-finanzas.json` en la carpeta de estado: debe indicar `completo:true` y las 12 entidades completas. Guarda cantidades confirmadas, inicio/fin por conjunto y limitaciones. Este informe acredita el avance local confirmado; contrastar también el estado del receptor y documentos conocidos antes de usar los resultados.

Comparar con SAP clientes con factura pagada, pago parcial, crédito, cancelación, servicio y moneda extranjera. Comparar documentos e importes por moneda, no solo el total general. Los conjuntos se leyeron en momentos diferentes; el proceso no toma una instantánea contable de toda SAP.

No hace falta crear una tarea financiera ni seguir ejecutándolo al terminar. Los datos quedarán a la fecha de lectura. El puente operativo de bodega conserva su programación.

## Errores que requieren detenerse y revisar

- `HTTP_401`: revisar credenciales/permisos, sin repetir intentos automáticamente.
- `HTTP_400`, `FINANZA_SAP_INVALIDA` o `COLECCION_FINANCIERA_INCOMPLETA`: revisar recurso, campo o colección; no guardar una respuesta truncada.
- `FINANZAS_CONTRATO_INVALIDO` al iniciar: puede faltar publicar el receptor compatible; revisar los logs del backend.
- `LECTOR_FINANCIERO_DISTINTO`, `FALTA_ESTADO_FINANCIERO_LOCAL` o `REQUIERE_RECONCILIACION`: hay una carga anterior o un estado que no coincide. No significa que haya que traer conciliaciones SAP; es una discrepancia técnica. No borrar estado ni registros para resolverla.
- `STATE_DIR_ABSOLUTO_REQUERIDO`: indicar la ruta completa de la carpeta de estado compartida.
- `espera_puente_operativo`: espera normal del modo continuo. Los modos de una sola tanda/sondeo informan `PUENTE_YA_BLOQUEADO` si está ocupado.

## Corrección operativa incluida en el código fuente

Se recuperó el manejo del documento de cancelación 17065 sin `Cancelled` en `puente/facturasPreparacion.js`, conservando que no pueda prepararse. Es una corrección separada: este importador instalado en otra carpeta no actualiza por sí mismo el archivo del puente operativo. Si se necesita allí, publicar el parche operativo actual por separado.
