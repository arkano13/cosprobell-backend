# Instalar y ejecutar el puente en Windows

El puente es un programa pequeño que corre **dentro de la red de Cosprobell**. Lee clientes, productos, unidades, códigos de barras y pedidos de artículos del Service Layer de SAP y envía al backend únicamente el contenido nuevo o modificado. Las frecuencias por entidad quedan pendientes de definir; no se activa una repetición automática por defecto. No abre puertos ni expone SAP a internet. Antes de programarlo, completar la guía `PRUEBAS_PEDIDOS_SCANNER.md` y medir la duración del recorrido.

```text
Red de Cosprobell                                        Internet
SAP B1 ── Service Layer ── [equipo con el puente] ──HTTPS──► backend ──► PostgreSQL
           (lectura)        ejecución limitada
```

## 1. Antes de empezar

**Backend de pruebas listo** (ver `INTEGRACION_PUENTE.md`): migraciones aplicadas y, en su entorno, `SAP_COMPANY_DB=XPRUEBAS2026` y `BRIDGE_API_KEY` (secreto de 64 caracteres). Guardar ese secreto: el puente usa el mismo.

**Equipo dentro de la red de Cosprobell**, autorizado por ellos. Puede ser el mismo servidor de SAP u otro equipo que:

- llegue a `SERVIDOR.COSPROBELL.COM` puerto 50000 (`Test-NetConnection SERVIDOR.COSPROBELL.COM -Port 50000` debe decir `TcpTestSucceeded : True`);
- tenga salida HTTPS a internet hacia el backend;
- tenga la hora sincronizada automáticamente;
- tenga **Node.js 22.13.0 o superior** (desarrollo verificado con Node 24) instalado con el instalador oficial `.msi` de nodejs.org (así queda disponible para la tarea programada). Comprobar con `node --version`.

**Usuario SAP con acceso a Service Layer**. En la sociedad de pruebas se usará el usuario disponible autorizado por sistemas; para producción, preparar una cuenta exclusiva con permisos mínimos. No se necesita usuario de base de datos.

## 2. Armar el paquete (en tu PC, desde el proyecto)

```powershell
git pull origin main
npm install
npm run empaquetar:puente
```

Crea la carpeta `dist\puente-cosprobell` con el puente, sus contratos, `zod` y los scripts de Windows. No incluye el backend ni credenciales. Comprimirla (clic derecho → Enviar a → Carpeta comprimida) y copiarla al equipo de Cosprobell.

## 3. Instalar en el equipo de Cosprobell

1. Descomprimir en `C:\cosprobell\puente-cosprobell`.
2. Copiar `.env.puente.example` como `.env.puente` y completarlo con el Bloc de notas:

   | Variable | Valor |
   |---|---|
   | `SAP_SERVICE_LAYER_URL` | `https://SERVIDOR.COSPROBELL.COM:50000/b1s/v1` (el nombre, no la IP: el certificado está emitido para el nombre) |
   | `SAP_COMPANY_DB` | `XPRUEBAS2026` para las pruebas |
   | `SAP_USER`, `SAP_PASSWORD` | usuario SAP del puente |
   | `BACKEND_URL` | dirección HTTPS del backend, sin `/integracion` |
   | `BRIDGE_API_KEY` | el mismo secreto configurado en el backend |
   | `BRIDGE_STATE_DIR` | dejar `.bridge-state` |

   `.env.puente` contiene contraseñas: no enviarlo por chat ni correo, no sacarle capturas. Conviene que solo administradores puedan leer la carpeta.

3. Abrir PowerShell en la carpeta (`cd C:\cosprobell\puente-cosprobell`) y revisar el certificado de SAP:

   ```powershell
   node --env-file=.env.puente scripts/ver-certificado.js
   ```

   | Resultado | Qué hacer |
   |---|---|
   | `Confiable aquí: sí` | Nada |
   | Certificado autofirmado o autoridad desconocida | Pedir a sistemas el certificado/CA aprobado o confirmar su huella SHA-256 por un canal independiente. El script no guarda ni instala certificados |
   | Cadena de confianza pendiente | Instalar en `certificado\service-layer.pem` únicamente el PEM aprobado por sistemas |
   | `ERR_TLS_CERT_ALTNAME_INVALID` | Usar en `SAP_SERVICE_LAYER_URL` uno de los "Nombres válidos" |

   Si una versión anterior del diagnóstico guardó un certificado automáticamente, confirmar su procedencia con sistemas antes de usarlo. La existencia del archivo no demuestra que sea confiable.

   Nunca desactivar la validación TLS: el puente se niega a arrancar con `NODE_TLS_REJECT_UNAUTHORIZED=0`.

4. Comprobar el candado local una vez (no usa SAP ni el backend):

   ```powershell
   node scripts/comprobar-candado-puente.js
   ```

## 4. Primera ejecución manual

Primero desplegar el backend actualizado: esta versión necesita las rutas `/integracion/:entidad/observados`. No necesita una migración nueva. Usar un backend de pruebas separado de los datos demo.

```powershell
.\ejecutar-puente.cmd --sondeo
```

El sondeo inicia sesión, solicita como máximo un registro de cada entidad, valida sus campos y cierra sesión. No contacta al backend ni modifica el avance local. Revisar el log antes de iniciar la carga:

```powershell
.\ejecutar-puente.cmd
```

Cada ejecución inicia o continúa la carga pendiente. Una entidad completada no vuelve a recorrerse si no tiene frecuencia configurada. Los registros sin cambios envían solo sus identificadores para confirmar su presencia; no se sobrescribe su contenido. Las huellas se guardan en archivos SQLite locales, sin instalar otro servicio ni tocar SQL Server.

| Variable | Valor inicial | Función |
|---|---|---|
| `BRIDGE_FREQUENCIES_JSON` | `{}` | Sin repetición automática tras completar la carga inicial |
| `BRIDGE_MAX_REQUESTS` | `25` | Máximo de solicitudes SAP por ejecución, incluyendo login y reintentos; logout queda fuera para liberar sesión |
| `BRIDGE_MAX_SECONDS` | `120` | Deja de iniciar consultas al alcanzar este tiempo; una solicitud en curso, confirmaciones y logout pueden prolongarlo |
| `BRIDGE_REQUEST_DELAY_MS` | `500` | Separación mínima entre inicios de solicitudes SAP |

`pausa_por_presupuesto` es una pausa normal: conserva el avance para la próxima ejecución. Un código de salida 0 no significa que todas las entidades terminaron; comprobar `completo:true` por entidad. Se alternan las entidades menos atendidas y se esperan los catálogos iniciales que requieren los pedidos y códigos de barras.

Para solicitar otro recorrido manual: `.\ejecutar-puente.cmd --forzar`. Para reenviar contenido aunque coincidan las huellas: `--reconciliar`. Ambos respetan los límites; repetir el mismo comando si queda trabajo. `--reconciliar` **no repara** discrepancias entre secuencias locales y remotas.

**Límite actual:** cuando corresponde un recorrido, se siguen consultando las páginas de SAP (en pedidos, los abiertos y la revisión de cierres). Las huellas reducen transferencias al backend, no convierten esas lecturas en consultas incrementales de SAP. Los filtros por fecha de modificación requieren validar su comportamiento real, las líneas y los cierres. No considerar esta etapa como sincronización incremental completa desde SAP.

## 5. Programar cuando se acuerden las frecuencias

No instalar una tarea todavía. Tras medir la prueba, definir `BRIDGE_FREQUENCIES_JSON`: un objeto con segundos por entidad (`clientes`, `productos`, `unidades`, `codigosBarras`, `pedidos`). Las entidades omitidas solo realizan la carga inicial y sus continuaciones. Cada frecuencia se cuenta desde el último recorrido completo.

La frecuencia de arranque de Windows es independiente: cada arranque revisa qué entidades están pendientes. `BRIDGE_INTERVAL_SECONDS` solo controla la espera del modo `--watch`; no configura Windows. Usar un único mecanismo. `--watch` exige frecuencias explícitas y no permite `--forzar` ni `--reconciliar`.

En una consola elevada, ejecutar `instalar-tarea.cmd` con dos argumentos: cuenta de Windows autorizada y minutos entre arranques. El script solicita su contraseña y rechaza SYSTEM; no reemplaza tareas existentes. La cuenta necesita leer el programa y la configuración y escribir estado y logs, sin privilegios administrativos permanentes.

La tarea se llama `Cosprobell\Puente`. El candado del programa impide dos sincronizaciones locales simultáneas. Comprobar además en el Programador: «Si la tarea ya se está ejecutando: no iniciar una nueva instancia». Los logs se conservan 30 días.

```powershell
schtasks /Query /TN "Cosprobell\Puente" /V /FO LIST
.\desinstalar-tarea.cmd
```

## 6. Actualizar a una versión nueva

1. `.\desinstalar-tarea.cmd` (o deshabilitar la tarea) y esperar a que no haya un ciclo en curso. No ejecutar versiones antiguas y nuevas simultáneamente: las antiguas no respetan la guardia de recuperación.
2. Reemplazar los archivos con los del paquete nuevo, **conservando** `.env.puente`, `.bridge-state\`, `certificado\` y `logs\`.
3. `.\ejecutar-puente.cmd` una vez y revisar el registro.
4. Rehabilitar la tarea con la cuenta y frecuencia previamente acordadas.

`VERSION.txt` indica la versión y el commit base del paquete. Conservar los archivos JSON y SQLite de `.bridge-state`; no copiar estado entre sociedades o backends diferentes.

## 7. Problemas frecuentes

Cada error aparece en el registro como `{"evento":"fallo","entidad":...,"codigo":...}`.

| Código | Causa probable | Qué hacer |
|---|---|---|
| `CONEXION_O_TLS` | Sin red hacia SAP o el backend, o certificado no confiable | Probar `Test-NetConnection`, revisar el certificado (sección 3) |
| `HTTP_401` | Usuario o contraseña SAP incorrectos, o `BRIDGE_API_KEY` distinta a la del backend | Revisar `.env.puente` |
| `HTTP_403` | `SAP_COMPANY_DB` distinta de la configurada en el backend | Igualar la empresa en ambos lados |
| `HTTP_503` | El backend no tiene configurado el puente | Configurar `SAP_COMPANY_DB` y `BRIDGE_API_KEY` en el backend |
| `CLIENTE_SAP_INVALIDO`, `PRODUCTO_SAP_INVALIDO` | Un registro de SAP no cumple el contrato; `detalle` indica código y campo | Corregir ese dato en SAP; las demás entidades siguen sincronizándose |
| `PUENTE_YA_BLOQUEADO` | Otro ciclo en curso, candado incompleto o guardia de recuperación abandonada | Deshabilitar la tarea y verificar que no hay procesos del puente. Solo entonces retirar `ejecucion.lock.guard` y, si corresponde, `ejecucion.lock`. Conservar todos los JSON de avance |
| `REQUIERE_RECONCILIACION` | El avance local no coincide con el del backend (se borró `.bridge-state` o se restauró la base) | No borrar nada más: revisar ambos lados antes de continuar |
| `inicio_fallido` / `REVISAR_CONFIGURACION` | Falta una variable o tiene un valor inválido | Revisar `.env.puente` |

Si la red de Cosprobell obliga a usar un proxy para salir a internet, avisar: Node no toma automáticamente el proxy de Windows.

## Qué no está probado

La caché utiliza `node:sqlite`, disponible sin bandera desde Node 22.13.0; en Node 24 puede mostrar un aviso experimental. Mantener la versión de Node probada durante la instalación. Referencia: [documentación de Node.js](https://nodejs.org/api/sqlite.html).

Las pruebas automatizadas usan SAP simulado y archivos locales temporales. No verifican la carga real del servidor de Cosprobell, sus certificados ni los permisos de la cuenta de Windows. La instalación de la tarea y la sincronización contra la sociedad de pruebas siguen pendientes. No se ha contactado SAP ni modificado su base durante estos cambios.
