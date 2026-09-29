# Ingreso de operadores con PIN

Cada persona de bodega ingresa a la app de escritorio tocando su nombre y escribiendo un PIN de 4 números **asignado por el supervisor**. Así queda registrado quién prepara cada pedido, y nadie escribe direcciones ni claves largas.

## Cómo funciona

1. La app trae adentro una **clave de solo ingreso** (API key con alcance `ingreso`). Con ella solo puede ver la lista de nombres e intentar el PIN; no ve pedidos ni ningún otro dato.
2. Con el nombre y el PIN correctos, el backend entrega una **sesión** que dura 12 horas (un turno). La app la usa para pedidos y picking. Con una sesión de operador no se llega a productos, clientes, etiquetas, facturas, pagos ni bodegas.
3. Al iniciar una preparación, el preparador (`usuarioId`) es el operador de la sesión. Cada lectura queda registrada con `aplicacion = operador:<nombre>`.

## Seguridad del PIN

- El PIN se guarda cifrado con scrypt y una sal propia; nunca en claro. El token de sesión solo se guarda como hash.
- Cada 5 PIN incorrectos seguidos, el operador queda en pausa 15 minutos. Durante la pausa no se prueba ningún PIN, ni siquiera el correcto.
- Al llegar a 10 incorrectos queda bloqueado hasta que el supervisor lo desbloquee.
- Un PIN correcto reinicia el conteo.
- Cambiar el PIN o desactivar a un operador cierra sus sesiones abiertas.

## Comandos del supervisor

Desde la carpeta del backend, con `DATABASE_URL` apuntando a la base (ver [DESPLEGAR_RAILWAY.md](DESPLEGAR_RAILWAY.md)):

| Comando | Qué hace |
|---|---|
| `node scripts/operadores.js listar` | Nombres y estado: activo, en pausa, bloqueado o desactivado |
| `node scripts/operadores.js crear "Ana López" 4827` | Crea el operador con su PIN |
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
| `POST /ingreso/sesion` | `X-API-Key` (cualquier alcance) | `{ "operadorId": 7, "pin": "4827" }` → `{ token, expiraEn, operador }` |
| `DELETE /ingreso/sesion` | `Authorization: Bearer <token>` | Cierra la sesión |

Respuestas de error del ingreso: `PIN_INCORRECTO` (401), `OPERADOR_NO_DISPONIBLE` (401), `OPERADOR_EN_PAUSA` (429, con los minutos que faltan) y `OPERADOR_BLOQUEADO` (423). Una sesión vencida o cerrada responde 401 en cualquier ruta.

Las API keys existentes (alcance `completo`) siguen funcionando igual para las demás aplicaciones.
