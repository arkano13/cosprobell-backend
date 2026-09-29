# Instalar y ejecutar el puente en Windows

El puente es un programa pequeño que corre **dentro de la red de Cosprobell**. Cada 15 minutos lee clientes y productos del Service Layer de SAP (solo lectura) y los envía al backend por HTTPS. No abre puertos ni expone SAP a internet.

```text
Red de Cosprobell                                        Internet
SAP B1 ── Service Layer ── [equipo con el puente] ──HTTPS──► backend ──► PostgreSQL
           (solo GET)       tarea cada 15 min
```

## 1. Antes de empezar

**Backend de pruebas listo** (ver `INTEGRACION_PUENTE.md`): migraciones aplicadas y, en su entorno, `SAP_COMPANY_DB=XPRUEBAS2026` y `BRIDGE_API_KEY` (secreto de 64 caracteres). Guardar ese secreto: el puente usa el mismo.

**Equipo dentro de la red de Cosprobell**, autorizado por ellos. Puede ser el mismo servidor de SAP u otro equipo que:

- llegue a `SERVIDOR.COSPROBELL.COM` puerto 50000 (`Test-NetConnection SERVIDOR.COSPROBELL.COM -Port 50000` debe decir `TcpTestSucceeded : True`);
- tenga salida HTTPS a internet hacia el backend;
- tenga la hora sincronizada automáticamente;
- tenga **Node.js 22 LTS o superior** instalado con el instalador oficial `.msi` de nodejs.org (así queda disponible para la tarea programada). Comprobar con `node --version`.

**Usuario SAP propio del puente** (no `manager`) con acceso a Service Layer. No se necesita usuario de base de datos.

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

```powershell
.\ejecutar-puente.cmd
type logs\puente-(fecha de hoy).log
```

Una ejecución correcta termina así:

```json
{"evento":"ciclo","entidad":"clientes","completo":true,"lotes":2,"ultimaSecuencia":2}
{"evento":"ciclo","entidad":"productos","completo":true,"lotes":3,"ultimaSecuencia":3}
{"evento":"fin","codigo":0,"hora":"..."}
```

`codigo` 0 es éxito; 1 indica un problema (ver sección 7). Revisar después en el backend que llegaron los datos.

## 5. Programar la ejecución cada 15 minutos

Clic derecho sobre `instalar-tarea.cmd` → **Ejecutar como administrador**. Crea la tarea `Cosprobell\Puente`, que:

- corre cada 15 minutos con la cuenta SYSTEM, aunque nadie haya iniciado sesión, y sigue después de reiniciar el equipo;
- no inicia un ciclo nuevo si el anterior sigue en curso;
- ejecuta `ejecutar-puente.cmd`, que agrega la salida a `logs\puente-AAAA-MM-DD.log` y borra registros de más de 30 días.

Comandos útiles (PowerShell como administrador):

```powershell
schtasks /Run /TN "Cosprobell\Puente"                 # ejecutar ahora
schtasks /Query /TN "Cosprobell\Puente" /V /FO LIST   # estado, última ejecución y resultado
.\desinstalar-tarea.cmd                               # quitar la tarea (no borra configuración ni estado)
```

Si sistemas prefiere una cuenta de servicio en lugar de SYSTEM, cambiar en `instalar-tarea.cmd` `/RU SYSTEM` por `/RU DOMINIO\usuario /RP *` (pedirá la contraseña). Esa cuenta necesita permiso de lectura y escritura en la carpeta.

Sin el script, desde el Programador de tareas: Crear tarea → "Ejecutar tanto si el usuario inició sesión como si no" → Desencadenador diario, repetir cada 15 minutos indefinidamente → Acción: iniciar `C:\cosprobell\puente-cosprobell\ejecutar-puente.cmd` → Configuración: "Si la tarea ya se está ejecutando: no iniciar una nueva instancia".

## 6. Actualizar a una versión nueva

1. `.\desinstalar-tarea.cmd` (o deshabilitar la tarea) y esperar a que no haya un ciclo en curso. No ejecutar versiones antiguas y nuevas simultáneamente: las antiguas no respetan la guardia de recuperación.
2. Reemplazar los archivos con los del paquete nuevo, **conservando** `.env.puente`, `.bridge-state\`, `certificado\` y `logs\`.
3. `.\ejecutar-puente.cmd` una vez y revisar el registro.
4. `instalar-tarea.cmd` como administrador.

`VERSION.txt` indica la versión y el commit del paquete instalado.

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

Los scripts `.cmd` se escribieron para Windows pero no se pudieron ejecutar en Windows durante el desarrollo. El puente, el paquete y el certificado sí se probaron en Linux con Service Layer simulado y PostgreSQL. La primera instalación debe seguir esta guía paso a paso y revisar el registro de la primera ejecución.
