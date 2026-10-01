# Ingreso de operadores con PIN

Cada persona de bodega ingresa a la app de escritorio tocando su nombre y escribiendo un PIN de 4 números **asignado por el supervisor**. Así queda registrado quién prepara cada pedido, y nadie escribe direcciones ni claves largas.

## Cómo funciona

1. La app trae adentro una **clave de solo ingreso** (API key con alcance `ingreso`). Con ella solo puede ver la lista de nombres e intentar el PIN; no ve pedidos ni ningún otro dato.
2. Con el nombre y el PIN correctos, el backend entrega una **sesión** que dura 12 horas (un turno). La app la usa para pedidos y picking. Con una sesión de operador no se llega a productos, clientes, etiquetas, facturas, pagos ni bodegas.
4. Cada operador tiene un **rol**: `operador` (por defecto) o `supervisor`. El supervisor usa lo mismo que un operador y, además, las rutas `/supervisor/*` del panel de la app (ver [Panel del supervisor](#panel-del-supervisor)).
3. Al iniciar una preparación, el preparador (`usuarioId`) es el operador de la sesión. Cada lectura queda registrada con `aplicacion = operador:<nombre>`.

## Seguridad del PIN

- El PIN se guarda cifrado con scrypt y una sal propia; nunca en claro. El token de sesión solo se guarda como hash.
- Cada 5 PIN incorrectos seguidos, el operador queda en pausa 15 minutos. Durante la pausa no se prueba ningún PIN, ni siquiera el correcto.
- Al llegar a 10 incorrectos queda bloqueado hasta que el supervisor lo desbloquee.
- Un PIN correcto reinicia el conteo.
- Cambiar el PIN o desactivar a un operador cierra sus sesiones abiertas.

## Comandos del supervisor

El día a día se hace desde la app (**Menú → Panel del supervisor → Operadores**). Los comandos sirven para crear el **primer supervisor** y para cuando no hay nadie con ese rol a mano. Desde la carpeta del backend, con `DATABASE_URL` apuntando a la base (ver [DESPLEGAR_RAILWAY.md](DESPLEGAR_RAILWAY.md)):

| Comando | Qué hace |
|---|---|
| `node scripts/operadores.js listar` | Nombres y estado: activo, en pausa, bloqueado o desactivado |
| `node scripts/operadores.js crear "Ana López" 4827` | Crea el operador con su PIN |
| `node scripts/operadores.js crear "Carmen Díaz" 3141 --supervisor` | Lo crea con rol supervisor |
| `node scripts/operadores.js rol "Ana López" supervisor` | Cambia el rol (`supervisor` u `operador`) y cierra sus sesiones para que el cambio aplique al volver a ingresar |
| `node scripts/operadores.js pin "Ana López" 5093` | Cambia el PIN, desbloquea y cierra sus sesiones |
| `node scripts/operadores.js desbloquear "Ana López"` | Quita la pausa o el bloqueo |
| `node scripts/operadores.js desactivar "Ana López"` | Ya no puede ingresar; cierra sus sesiones |
| `node scripts/operadores.js activar "Ana López"` | Vuelve a habilitarlo |

Los nombres se escriben entre comillas y deben ser únicos. El comando avisa si el PIN es fácil de adivinar (`1111`, `1234`, `9876`…), pero lo acepta.

## Clave de la app (una sola vez)

```bash
node scripts/crear-api-key.js app-bodega --solo-ingreso
```

La clave se muestra una sola vez. Va como secreto `BODEGA_CLAVE_INGRESO` en el repositorio `cosprobell-bodega-escritorio` (**Settings → Secrets and variables → Actions**), para que GitHub Actions la incluya al armar el instalador. No se reparte a nadie más.

Si la clave se filtra, se crea otra, se actualiza el secreto, se arma una versión nueva de la app y se desactiva la anterior (`activa = false` en `api_keys`). Aun con esa clave, sin un nombre y su PIN no se accede a ningún dato.

## Rutas

| Método y ruta | Credencial | Uso |
|---|---|---|
| `GET /ingreso/operadores` | `X-API-Key` (cualquier alcance) | Operadores activos: `[{ id, nombre }]` |
| `POST /ingreso/sesion` | `X-API-Key` (cualquier alcance) | `{ "operadorId": 7, "pin": "4827" }` → `{ token, expiraEn, operador: { id, nombre, rol } }` |
| `DELETE /ingreso/sesion` | `Authorization: Bearer <token>` | Cierra la sesión |

Respuestas de error del ingreso: `PIN_INCORRECTO` (401), `OPERADOR_NO_DISPONIBLE` (401), `OPERADOR_EN_PAUSA` (429, con los minutos que faltan) y `OPERADOR_BLOQUEADO` (423). Una sesión vencida o cerrada responde 401 en cualquier ruta.

Las API keys existentes (alcance `completo`) siguen funcionando igual para las demás aplicaciones.

## Panel del supervisor

Rutas bajo `/supervisor`, solo con `Authorization: Bearer <token>` de un operador con rol `supervisor`. Sin sesión responden 401; un operador sin ese rol o una API key reciben 403.

| Método y ruta | Uso |
|---|---|
| `GET /supervisor/resumen` | Números de cada pestaña: etiquetas (`sinConfirmar`, `manualSinConfirmar`, `desactualizadas`, `confirmadas`), revisiones y operadores bloqueados |
| `GET /supervisor/etiquetas?estado=sin_confirmar&buscar=&cursor=&limit=50` | `estado`: `sin_confirmar`, `desactualizadas`, `confirmadas` o `todas`. `buscar`: código exacto, o parte del código o nombre del producto |
| `POST /supervisor/etiquetas/confirmacion-manual` | `{ "cantidadEsperada": 120 }`: confirma como unidad todos los códigos con unidad Manual sin confirmar. Si la cantidad cambió desde que se mostró, no confirma nada y responde `CANTIDAD_CAMBIO` (409) |
| `PUT` / `DELETE /supervisor/etiquetas/:id/confirmacion` | Igual que `/etiquetas/:id/confirmacion`; queda `confirmadaPor = operador:<nombre>` |
| `GET /supervisor/operadores` | Todos, con rol, estado (`activo`, `pausa`, `bloqueado`, `inactivo`) y último ingreso |
| `POST /supervisor/operadores` | `{ "nombre", "pin", "rol" }` → `{ operador, advertencia }` (advertencia si el PIN es fácil) |
| `PUT /supervisor/operadores/:id/pin` | `{ "pin" }`: cambia el PIN, desbloquea y cierra sus sesiones (si es el propio supervisor, menos la actual) |
| `POST /supervisor/operadores/:id/desbloqueo` | Quita la pausa o el bloqueo |
| `PUT /supervisor/operadores/:id/activo` | `{ "activo": false }` desactiva y cierra sus sesiones. No se puede desactivar uno mismo (`NO_DESACTIVAR_PROPIO`) |
| `GET /supervisor/revisiones` | `enRevision` (con lo que cambió en SAP por producto), `conDiferencias` (últimas 24 h) y `sinEntrega` (preparados hace 24 h o más con el pedido abierto en SAP) |
| `POST /supervisor/revisiones/:id/anulacion` | Pasa una preparación `requiere_revision` a `anulada`. Sus lecturas quedan en el historial y el pedido se puede volver a preparar con los datos actuales |
| `GET /supervisor/sincronizacion` | Última recepción y cantidad de registros por tipo de dato de SAP, y la sociedad |
