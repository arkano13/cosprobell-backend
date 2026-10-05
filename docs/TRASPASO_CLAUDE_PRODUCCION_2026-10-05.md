# Traspaso a Claude — Cosprobell: backend, scanner y puente SAP

Actualizado: **5 de octubre de 2026**, zona horaria America/Tegucigalpa.

Este documento resume la conversación y el estado observado del repositorio. Las confirmaciones del servidor vienen de resultados que el usuario pegó en el chat; no hubo acceso remoto directo por parte de Codex. Distinguir siempre lo confirmado, lo preparado localmente y lo pendiente.

## 1. Empezar aquí: estado y bloqueo actual

Estamos pasando el puente de la sociedad de pruebas **XPRUEBAS2026** a la sociedad real que el usuario identificó como **COSPROBELL**, usando la misma base PostgreSQL de Railway.

**Bloqueo actual: el Login de SAP Service Layer devuelve HTTP 401.** Ya se aisló el fallo; ocurre antes de consultar SQLQueries, almacenes o enviar datos al backend.

Última salida de diagnóstico:

```text
INICIO_SESION 401
RESULTADO HTTP_401
```

La configuración local sí pasó la validación (`CONFIGURACION_OK`). El problema de certificado que impedía validar configuración se resolvió usando la huella fijada. No asumir que el 401 es necesariamente contraseña incorrecta: comprobar usuario SAP, contraseña, sociedad, estado de cuenta, lectura del archivo y configuración de autenticación de Service Layer.

Última pregunta del usuario: si CompanyDB puede tener espacios, por ejemplo `DISTRIBUCIONES COSPROBELL`. Respuesta: el archivo .env admite espacios entre comillas, pero CompanyDB debe ser el **nombre técnico exacto de la base de la sociedad**, no el nombre comercial visible. Capturas anteriores de SQL Server mostraban una base `COSPROBELL`; el usuario también confirmó antes `"CompanyDB": "COSPROBELL"`. No cambiarlo por un nombre comercial sin verificar.

**Siguiente acción útil:** confirmar con Sistemas el nombre técnico de la sociedad y si el mismo usuario puede iniciar sesión en esa sociedad desde SAP. Aún no recibimos confirmación de una entrada exitosa en el cliente SAP con las credenciales nuevas. No pedir que pegue contraseñas.

## 2. Qué se completó en el servidor durante este cambio

1. Usuario deshabilitó la tarea `\Cosprobell\Puente` y confirmó `Disabled`.
2. Copió toda la instalación a:

   `C:\puente-cosprobell-respaldo-20261005-104439`

   Mostró un listado que contiene `.env.puente`, `.bridge-state`, `logs`, `puente`, `scripts`, `src`, `node_modules`, los CMD y `ejecutar-oculto.vbs`.
3. Confirmó que necesita existencias de **01, 02, v01, v03, v05, v05-1, 99**. Dijo que todos están bien y activos; no pegó el resultado exacto con mayúsculas/minúsculas. El código nuevo exige coincidencia exacta con lo que devuelva SAP.
4. **Rechazó explícitamente respaldar PostgreSQL** y autorizó limpiar los datos de pruebas. No volver a exigir ese respaldo como si faltara consentimiento: explicó varias veces que son pruebas y quiere usar la misma base.
5. Se le entregó `scripts/limpiar-datos-pruebas.sql`. Confirmó ejecución y después dijo: **“listo todo borrado”** tras indicar la verificación con COUNT. No hay salida SQL pegada en el chat, así que se considera confirmado por el usuario, no comprobado remotamente por el agente.
6. Se le indicó reemplazar el código con `dist/puente-produccion-almacenes.zip`, manteniendo configuración y archivos de ejecución. La conversación continuó con la configuración y los scripts nuevos existen en su servidor. No hubo verificación de hash del paquete remoto.
7. Configuró producción y confirmó que `Test-Path 'C:\puente-cosprobell\.bridge-state-produccion'` devolvió **False**. La nueva carpeta de avance estaba sin usar.
8. Configuración TLS inicialmente falló porque solo tenía la excepción para pruebas. Cambió a `SAP_TLS_TEST_EXCEPTION=false` y `SAP_TLS_PINNED_CERTIFICATE=true`; después apareció `CONFIGURACION_OK`.
9. El usuario consiguió credenciales SAP nuevas, las guardó, pero el Login sigue respondiendo 401.

**No hemos completado:** registro exitoso de la consulta en COSPROBELL, sondeo exitoso de producción, carga inicial real, creación del supervisor definitivo ni reactivación de la tarea. No asumir que Railway ya tiene desplegados los cambios locales ni sus variables nuevas. Tampoco quedó confirmación explícita de que el servicio backend se detuvo: se le indicó hacerlo para limpiar, pero solo confirmó el borrado.

## 3. Proyecto y objetivos

Backend Node.js para sincronizar información de SAP Business One a PostgreSQL en Railway y operar una aplicación de scanner/picking e inventario propio.

Arquitectura prevista:

```text
SAP B1 / Service Layer dentro de Cosprobell
             ↓ consultas HTTPS
Puente Node.js en Windows Server
             ↓ lotes HTTPS autenticados
Backend Railway + PostgreSQL
             ↓
App scanner / supervisor / inventario
```

- El puente consulta SAP periódicamente; la app trabaja contra nuestra copia.
- No se escriben movimientos, pedidos o inventario operativo de vuelta a SAP.
- Registrar la nueva definición SQLQueries SÍ es una escritura de configuración en SAP: explicarlo con precisión, sin decir que absolutamente todas las acciones son de solo lectura.
- La operación propia distingue bodega grande (cajas/lotes) y pequeña (unidades individuales y despacho). El scanner está en la pequeña. Siempre se despachan unidades individuales.
- El usuario pidió exigir reposición desde la grande antes de descontar unidades inexistentes en la pequeña; no permitir negativos como solución operativa.
- Los movimientos internos de esas bodegas físicas solo existen en nuestra aplicación; no equivalen automáticamente a los códigos de almacén SAP.
- Futuro: clientes, facturas y agente de WhatsApp. No distraer del puente/producción con ese desarrollo ahora.
- El usuario quiere pasos cortos, un bloque de comandos por vez y confirmar resultados. Se pierde con instrucciones largas o muchos lugares de ejecución mezclados.

## 4. Entornos y ubicaciones

### PC del usuario

Repositorio: `C:\Users\gelsy\IA\cosprobell-backend`.

Git usa `main`. Último commit observado:

```text
14368b2 fix(inventario): fecha de las existencias de SAP según el último recorrido completo
```

**Hay cambios importantes sin commit y archivos nuevos sin seguimiento.** No hacer reset, limpiar ni asumir que origin/main contiene lo preparado. Codex no hizo commit ni push de estas mejoras.

### Servidor de Cosprobell

- Windows Server 2022 Standard, versión 10.0.20348, según salida del usuario.
- Node instalado y ejecutándose; el paquete requiere Node >=22.13.0 por SQLite del estado/cache. No afirmar la versión exacta del servidor sin consultarla.
- Instalación: `C:\puente-cosprobell`.
- Configuración: `C:\puente-cosprobell\.env.puente`.
- Avance anterior: `.bridge-state`, de pruebas.
- Avance nuevo previsto: `.bridge-state-produccion`, para COSPROBELL.
- Registros: `logs\puente-YYYY-MM-DD.log`.
- Tarea: ruta `\Cosprobell\`, nombre `Puente`.
- Service Layer: `https://SERVIDOR.COSPROBELL.COM:50000/b1s/v1`.
- SAP observado: Business One 10.0 (10.00.180), FP 2111, 64-bit; SQL Server 2019 según configuración mostrada.

### Railway

- Backend: `https://cosprobell-backend-production.up.railway.app`.
- Salud: `/health`, se ha visto responder `status=ok`, `db=ok` antes de esta transición.
- PostgreSQL; mantener el destino actual por decisión del usuario.
- El repo usa `prisma7.config.js` y Prisma 7.10.0. No actualizar a una versión mayor/RC por un aviso del CLI.
- No incluir DATABASE_URL, claves API ni passwords en este documento, logs o respuestas.

## 5. Seguridad TLS acordada y realmente implementada

El certificado de SAP está vencido y su nombre no coincide con el FQDN. El diagnóstico anterior mostró vencimiento en julio de 2024, emitido para SERVIDOR, y nombres DNS:SERVIDOR / IP interna. El usuario insistió en continuar sin renovarlo/instalar un PEM.

Solución implementada: **fijar la huella SHA-256 del certificado**. El puente mantiene HTTPS y verifica la huella antes de enviar credenciales; omite vigencia, nombre y CA exclusivamente para SAP. No se desactiva TLS globalmente ni se afecta Railway.

Configuración actual prevista:

```dotenv
SAP_TLS_TEST_EXCEPTION=false
SAP_TLS_PINNED_CERTIFICATE=true
SAP_TLS_CERT_SHA256=CONSERVAR_LA_HUELLA_EXISTENTE_VERIFICADA
```

El marcador no debe copiarse como huella real. La huella real está en la configuración del servidor. No necesita `certificado\service-layer.pem` en este modo.

- `SAP_TLS_TEST_EXCEPTION=true` era legado restringido a XPRUEBAS2026.
- `SAP_TLS_PINNED_CERTIFICATE=true` permite explícitamente ese mismo mecanismo para otras sociedades.
- No usar `NODE_TLS_REJECT_UNAUTHORIZED=0`: config.js lo rechaza.
- No describirlo como conexión “sin ningún certificado”: el servidor sigue presentando uno y se valida su huella.

Archivos: `puente/sap-tls.js`, `puente/config.js`, `puente/ejecutar.js`, `tests/unit/sap-tls.test.js`, `docs/CERTIFICADO_FIJADO_PUENTE.md`.

## 6. Configuración de producción preparada

Conservar credenciales, URL y clave real del archivo existente. Perfil propuesto al usuario:

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
SAP_TLS_TEST_EXCEPTION=false
SAP_TLS_PINNED_CERTIFICATE=true
```

Respetar el caso exacto de los códigos de SAP. Si SAP dice V01, corregir tanto BRIDGE_WAREHOUSES como INVENTARIO_SAP_WAREHOUSES con ese caso. Reordenar la lista no cambia la identidad de consulta; cambiar un código sí.

Variables propuestas del backend Railway:

```dotenv
INVENTARIO_SAP_WAREHOUSES=01,02,v01,v03,v05,v05-1,99
INVENTARIO_SAP_MAX_AGE_MINUTES=120
```

La antigüedad de 120 minutos es una tolerancia explícita: puede aceptar datos de hasta dos horas desde inicio del recorrido; no significa inventario en tiempo real. El default del código sigue en 30 minutos. Se bloquea comparación con recorridos incompletos, filas no observadas o almacenes seleccionados fuera del alcance.

Intervalos propuestos: pedidos 10 min; existencias 1 h; productos y códigos 2 h; clientes 4 h; unidades y almacenes 24 h. Son mínimos entre recorridos; presupuesto y programación pueden agregar retraso. Nuevos productos/clientes podrían tardar hasta su catálogo antes de que pueda aceptarse un pedido dependiente.

**BRIDGE_INTERVAL_SECONDS no cambia el Programador de tareas.** Solo regula --watch. El desencadenador Windows debe editarse aparte para repetir cada 5 minutos, sin nuevas instancias simultáneas. Esa edición todavía no está confirmada en esta transición.

## 7. Optimización nueva de existencias

Antes: existencias recorría Items con ItemWarehouseInfoCollection, cinco artículos por página, trayendo todas las colecciones de almacenes. El usuario se quejó de lentitud de SAP y pidió reducir frecuencia y alcance.

Ahora se agregó modo `sql-almacenes`:

- Variable BRIDGE_WAREHOUSES: de 1 a 10 códigos, 1–8 caracteres alfanuméricos, guion o guion bajo. Rechaza vacíos, duplicados y duplicados que solo difieren en mayúsculas. Preserva caso.
- Consulta SQL de lectura por el endpoint oficial SQLQueries de Service Layer. No conexión directa a SQL Server.
- Una fila por artículo, TOP 20, keyset `ItemCode > :after`, ORDER BY ItemCode.
- OITM como tabla base y un LEFT JOIN a OITW por código seleccionado; siete JOIN para la lista actual.
- Solo trae cantidades de esos almacenes. Aún recorre los códigos de TODOS los artículos para limpiar saldos que pasan a cero, artículos no inventariables o filas ausentes.
- Conserva catálogos completos de productos, códigos de barras y almacenes. No filtra pedidos con BRIDGE_WAREHOUSES.
- No es incremental por fecha en SAP. El control de huellas evita reenviar lotes de datos sin cambios cuando corresponde.
- Cada selección tiene un SqlCode `COSPROBELL_STOCK_<hash de 20 hex>` y fuente `sql-almacenes-v1-<hash>`; la lista se ordena antes del hash.
- Cliente verifica los códigos exactos usando Warehouses antes de leer las páginas.
- Valida tipos, cantidades y definición SqlText. No sigue enlaces externos ni vuelve automáticamente a Items ante error.
- Cambiar el alcance reinicia cursor conservando secuencia. Si hay un lote pendiente sin confirmar, falla con CAMBIO_FUENTE_CON_PENDIENTE; no borrar estado para esquivarlo.
- El modo fijo anterior `sql-01-02` sigue disponible por compatibilidad, pero NO es el elegido para producción.
- Registrar es una acción manual explícita: no se crean consultas automáticamente durante cada ejecución.
- Si la definición existente no coincide, no la sobrescribe.

**No se validó todavía esta consulta en el SAP real de Cosprobell.** La suite y la prueba relacional SQLite no demuestran aceptación por el parser FP2111, permisos/allowlist ni rendimiento de SQL Server. La carga y el sondeo reales son imprescindibles antes de afirmar que resuelve la lentitud. No modificar allowlists ni reiniciar SAP automáticamente ante un error.

## 8. Estado de pruebas y artefactos

Última suite local completa: **465 pruebas, 465 aprobadas, 0 fallidas**.

Salida conservada en `dist/pruebas-almacenes-produccion.log` (dist está ignorado por Git).

Pruebas nuevas cubren:

- Alcance de siete almacenes, stock cero, negativo SAP, ausencia de fila y no inventariables.
- Rechazo de códigos ajenos, valores incompletos y definiciones distintas.
- Inyección/validación de selección y estabilidad del identificador al reordenar.
- Cursor, presupuesto, no fallback, registro idempotente.
- Consulta ejecutada en SQLite local adaptando TOP a LIMIT: valida los JOIN, NO el dialecto/servicio SAP.
- Históricamente también se comprobó el comparador con PostgreSQL LOCAL en transacción y tablas temporales (fuera de alcance, datos viejos, recorrido incompleto). El clúster local de esa prueba se detuvo; no tocó Railway.

Paquete actual:

`C:\Users\gelsy\IA\cosprobell-backend\dist\puente-produccion-almacenes.zip`

Carpeta fuente del ZIP: `dist/puente-produccion-almacenes`. Verificado que carga módulos independientemente y contiene la guía nueva, SQL y preparador. Verificado que no incluye .env.puente real, estados, logs ni certificados privados.

Paquete anterior `dist/puente-almacenes-01-02.zip` está obsoleto para esta selección. No volver a enviarlo al usuario.

No se deben reemplazar `.env.puente`, carpetas de estado, logs ni ejecutar-oculto.vbs al actualizar código.

## 9. Diagnóstico de autenticación que YA se hizo

1. `--comprobar` devolvió HTTP_404 inicialmente; nunca se confirmó un registro exitoso.
2. Tras editar configuración hubo REVISAR_CONFIGURACION.
3. Validación aislada mostró: `En producción active SAP_TLS_PINNED_CERTIFICATE explícitamente`.
4. Tras corregir flags: CONFIGURACION_OK.
5. `--comprobar` devuelve HTTP_401 con las credenciales nuevas.
6. Diagnóstico separó Login de acceso a SQLQueries: **INICIO_SESION 401**.

No insistir en registrar la consulta mientras el Login falla. Un 401 aquí no lo causan los almacenes ni el backend.

Diagnóstico ya utilizado (preserva pinning y no imprime password/cookies):

```powershell
cd C:\puente-cosprobell
@'
import { configurar } from "./puente/config.js";
import { crearClienteSap } from "./puente/sap.client.js";
import { crearTransporteSap } from "./puente/sap-tls.js";
const config = configurar(process.env);
const transporte = config.huellaSap
  ? crearTransporteSap(config.sapUrl, config.huellaSap) : fetch;
const diagnostico = async (url, opciones) => {
  const respuesta = await transporte(url, opciones);
  const paso = url.includes("/Login") ? "INICIO_SESION"
    : url.includes("/Logout") ? "CIERRE_SESION" : "ACCESO_CONSULTA";
  console.log(paso, respuesta.status);
  return respuesta;
};
const sap = crearClienteSap({ ...config, huellaSap: null }, diagnostico);
try {
  await sap.prepararConsultaExistencias(false);
  console.log("CONSULTA_OK");
} catch (error) {
  console.log("RESULTADO", error.code ?? "ERROR");
} finally {
  await sap.cerrar().catch(() => console.log("CIERRE_NO_CONFIRMADO"));
}
'@ | node --env-file=.env.puente --input-type=module
```

La asignación huellaSap:null solo evita que crearClienteSap sustituya el wrapper diagnóstico; transporte ya usa crearTransporteSap con la huella original. No es desactivación del pinning.

Posibles siguientes verificaciones, aún NO hechas:

- Nombre técnico de sociedad, servidor y acceso del usuario en SAP cliente.
- Variables de entorno de Windows heredadas que prevalezcan sobre --env-file: comprobar solo PRESENCIA, nunca imprimir los valores secretos.
- Duplicados en el archivo, archivo realmente guardado, codificación y caracteres de contraseña. El formato con dobles comillas y puntos es válido; no inventar que esos caracteres explican el error.
- Obtener de forma controlada código/mensaje de error del cuerpo de Login: http.js hoy lo descarta salvo callback. No loguear cuerpo de login ni cookies/tokens.
- Consultar a Sistemas sobre cuenta bloqueada, permisos de sociedad/autenticación del Service Layer. No atribuirlo automáticamente a licencia.

## 10. Pasos restantes después de resolver Login

### A. Preparar SQLQueries

En servidor:

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/preparar-existencias.js --comprobar
```

Si falta la definición y se confirmó disponibilidad/permisos:

```powershell
node --env-file=.env.puente puente/preparar-existencias.js --registrar
```

Debe salir `consulta_existencias_lista` con los almacenes. Revisar errores 400, 401, 403, SQL incompatible o almacén inválido antes de continuar. No hacer loop de reintentos de Login.

### B. Backend

- Confirmar despliegue del código nuevo (los cambios locales no están necesariamente en GitHub/Railway).
- Configurar INVENTARIO_SAP_WAREHOUSES y MAX_AGE según arriba.
- Revisar `npx prisma migrate status --config=prisma7.config.js`; esta optimización no agregó migraciones nuevas. No hacer migrate reset.
- Levantar el servicio si está detenido y comprobar salud:

```powershell
Invoke-RestMethod -Uri 'https://cosprobell-backend-production.up.railway.app/health'
```

### C. Sondeo y carga

```powershell
cd C:\puente-cosprobell
.\ejecutar-puente.cmd --sondeo
Get-Content ('.\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

Esperar código 0. Luego:

```powershell
.\ejecutar-puente.cmd
Get-Content ('.\logs\puente-{0}.log' -f (Get-Date -Format yyyy-MM-dd)) -Encoding UTF8 -Tail 25
```

No suele imprimir nada directo: el CMD redirige a logs. Esperar regreso al prompt. Pausa_por_presupuesto es normal; repetir manualmente de forma secuencial o continuar con tarea controlada, sin aumentar carga a ciegas. No usar --forzar rutinariamente. No hay ETA fiable de carga inicial real; medir consultasSap y duracionMs.

### D. Supervisor y app

Desde el repositorio en la PC, con su .env apuntando al PostgreSQL correcto:

```powershell
node scripts/operadores.js crear "NOMBRE REAL" PIN_DE_4_DIGITOS --supervisor
node scripts/operadores.js listar
```

Los valores en mayúsculas son marcadores, no credenciales. Usuario pidió borrar su único operador anterior para crear uno definitivo. Recrear selección de almacenes en app: la limpieza eliminó configuración y bodegas anteriores. Comparar pedidos, cantidades, productos y stock cero con datos reales sin generar movimientos ficticios en producción.

### E. Tarea automática y carga

Con recorrido completo y carga de SAP aceptable, configurar desencadenador cada 5 minutos; opción No iniciar nueva instancia si ya se ejecuta. Mantener acción oculta. Después:

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Start-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTaskInfo -TaskPath '\Cosprobell\' -TaskName 'Puente' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

Comprobar resultado 0 y logs recientes después de terminar, no solo State Ready. Validar otro recorrido automático completo. Pausar si se reproduce la lentitud.

## 11. Problema pendiente de cuenta Windows

La cuenta dedicada original `COSPROBELL\blc` no tenía permiso **Iniciar sesión como proceso por lotes**. Eventos Windows 101/104 con error **2147943785**. Usuario no pudo editar la política; botones grises/permisos de dominio. No solucionarlo agregando la cuenta a Administradores o usando SYSTEM por comodidad.

Se dejó temporalmente como usuario05 con ejecución interactiva. El usuario sospecha que alguien cerró esa sesión y el puente se detuvo; coincide con la configuración pero NO quedó confirmado por eventos recientes. El panel mostró última recepción de pedidos/existencias hace 23h: eso no demuestra la hora exacta de parada (puede mostrar última recepción de cambios).

Para operación permanente, Sistemas debe asignar el permiso adecuado a una cuenta autorizada y configurar Ejecutar tanto si el usuario inició sesión como si no, con credenciales correctas. Desconectar RDP no siempre cierra sesión; Cerrar sesión sí. Políticas del servidor pueden terminar sesiones desconectadas.

Acción oculta actual:

```text
Programa: C:\Windows\System32\wscript.exe
Argumentos: //B //NoLogo "C:\puente-cosprobell\ejecutar-oculto.vbs"
Iniciar en: C:\puente-cosprobell
```

Contenido del VBS preservado:

```vbscript
Option Explicit
Dim shell, resultado
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\puente-cosprobell"
resultado = shell.Run("cmd.exe /d /c C:\puente-cosprobell\ejecutar-puente.cmd", 0, True)
WScript.Quit resultado
```

Oculta ventana, espera final y devuelve código real. No elimina dependencia del usuario. No reemplazarlo con un lanzador que termine inmediatamente y devuelva éxito antes que Node.

## 12. Lentitud y expectativas

Durante pruebas, capturas mostraron ~92–93% de RAM del servidor (15.6 GB disponibles en total), CPU 12–16%, numerosos procesos SAP/SQL/Apache y otras apps. Node apareció una vez con ~36.6 MB y 2.3% CPU. Esto no cuantifica el coste indirecto sobre SAP/SQL y no permite culpar o exonerar al puente.

Un recorrido anterior de existencias se registró en ~26.47 minutos. Había paginación, presupuestos y pausas; la carga manual inicial necesitó varias ejecuciones. No prometer que el nuevo será instantáneo ni que solo traerá cambios desde SAP.

Comparar operaciones iguales de SAP con puente pausado y durante el nuevo recorrido. La consulta de siete almacenes debe probarse realmente: menos datos transferidos no garantiza por sí mismo menos CPU en SQL.

Fallo de backend: se conserva lote pendiente, secuencia y reintentos con idempotencia; no avanza como confirmado sin respuesta válida. Errores permanentes requieren intervención. Si backend está caído, scanner tampoco podrá consultar/registrar normalmente. No confundir copia local en Railway con operación offline de la app.

## 13. Archivos clave y estado Git

Leer primero:

- `docs/PRODUCCION_ALMACENES.md`: guía vigente de siete almacenes.
- `docs/REDUCIR_CARGA_PUENTE.md`: diseño inicial 01/02; sus valores fijos quedan superados por la guía de producción.
- `docs/CERTIFICADO_FIJADO_PUENTE.md`.
- `docs/INVENTARIO.md` y `docs/Bitacora_Proyecto_Cosprobell_SAP_B1.md` para historia (no asumir totalmente actualizadas sobre cada evento remoto).
- `scripts/limpiar-datos-pruebas.sql`: YA ejecutado según usuario. **No volver a ejecutarlo.** Su comentario exige respaldo, pero el usuario omitió explícitamente el de PostgreSQL; guardar ese contexto, no reabrir la limpieza.

Código principal:

- `puente/config.js`: valida .env, modos, selección, TLS y presupuestos.
- `puente/existencias.sql.js`: genera SQL, identidad por selección, valida definición y filas.
- `puente/sap.client.js`: Login/cookie/GET, registro manual, páginas, validación de almacenes.
- `puente/preparar-existencias.js`: CLI --comprobar / --registrar, no envío al backend.
- `puente/sincronizar.js`, `estado.js`, `cache.js`, `control.js`: secuencias, reintentos, recorridos, caché y presupuesto.
- `puente/entidades.js`: qué recursos se leen y dependencias.
- `puente/http.js`: errores HTTP; oculta cuerpo salvo extracción opcional.
- `src/config/env.schema.js`: alcance y antigüedad del comparador.
- `src/modules/inventario/inventario.repository.js`: comparación segura de SAP contra inventario local.
- `scripts/empaquetar-puente.js`: paquete autónomo, no incluye credenciales/estado.
- `scripts/operadores.js`: crea supervisor.

Último git status observado: modificados .env.puente.example, bitácora, INVENTARIO.md, config/control/ejecutar/entidades/estado/sap.client/sincronizar del puente, empaquetador, esquema env, repositorio inventario y tests env/sap-tls. Nuevos sin seguimiento: guías TLS/producción/reducción, existencias.sql.js, preparar-existencias.js, SQL limpieza, pruebas SQL y selección, y output/ (documentos anteriores del usuario). Preservar todo. Este documento también será nuevo.

No hay autorización nueva de commit/push implícita por este traspaso. Si se necesita desplegar, revisar cambios y usar el flujo autorizado para producción. Nunca incluir .env ni respaldos con credenciales en Git.

## 14. Documentación oficial de referencia

- Service Layer, Login y SQLQueries:
  https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf
- SAP distingue nombre de compañía y de base de datos al seleccionar sociedad:
  https://help.sap.com/docs/SAP_BUSINESS_ONE_IAM/548d6202b2b6491b824a488cfc447343/3ce292c560a841a0bb341b6e3293b9c5.html

La documentación actual puede describir funcionalidades posteriores a FP2111. Verificar aplicabilidad antes de recomendar autenticación IAM/Windows o nuevas características.

## 15. Mensaje sugerido para retomar con el usuario

> Ya revisé el traspaso. El puente está pausado, la base de pruebas ya fue limpiada y la conexión se detiene en el Login de SAP con 401. No voy a repetir la limpieza. Primero confirmaremos el nombre técnico de la sociedad y el acceso del usuario a esa sociedad; luego seguimos con la consulta y la carga de producción, un paso a la vez.

**No hacer ahora:** borrar más datos, reutilizar estado de pruebas, activar tarea, ejecutar seed, compartir secretos, volver al ZIP fijo 01/02, registrar consultas sin Login válido ni asegurar que producción está lista.
