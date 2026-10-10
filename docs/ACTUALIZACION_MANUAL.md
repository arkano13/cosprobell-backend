# Actualización solicitada desde la app

## Alcance

El supervisor solicita actualizar todas las entidades habilitadas en el puente.
El backend guarda la solicitud en `configuracion`, separada por empresa SAP.
No requiere migración ni borrar datos. La solicitud sobrevive a reinicios del backend.
El puente la consulta al iniciar cada ejecución normal; `--sondeo` no consulta solicitudes.

No se envían comandos arbitrarios ni credenciales SAP desde la app. Solo un supervisor
con sesión puede pedir o consultar la actualización; solo la credencial del puente
puede confirmar el progreso. Los clics repetidos reciben la misma solicitud activa.
Tras terminar o fallar, hay una espera mínima de un minuto desde su creación para otra solicitud.

## Contrato para el frontend

Autenticación: `Authorization: Bearer <sesión del supervisor>`.

- `GET /supervisor/sincronizacion/solicitud`: devuelve `{ data: { solicitud, ultimaConexion, entidades } }`.
- `POST /supervisor/sincronizacion/solicitud`, cuerpo `{}`: devuelve `{ data: solicitud }`.

`solicitud` es `null` si todavía no se pidió ninguna. En caso contrario contiene:

```json
{
  "id": "UUID",
  "estado": "sincronizando",
  "creadaEn": "fecha ISO",
  "iniciadaEn": "fecha ISO o null",
  "actualizadoEn": "fecha ISO",
  "finalizadaEn": null,
  "operadorId": 9,
  "entidades": ["clientes", "productos", "unidades", "codigosBarras", "pedidos", "almacenes", "existencias"],
  "completas": ["productos"],
  "error": null
}
```

Mostrar el botón **Actualizar todo** en la pantalla de sincronización. Deshabilitarlo
mientras se envía la petición o el estado sea `pendiente` / `sincronizando`.
Consultar el estado cada 5–10 segundos mientras la pantalla esté abierta; detener
el temporizador al salir o cerrar sesión. No repetir automáticamente el POST al fallar.

Textos:

- `pendiente`: «Solicitud guardada. Esperando al puente».
- `sincronizando`: «Actualizando: N de M entidades completas. Puede continuar en varias ejecuciones».
- `completado`: «Actualización completada», con su fecha, y refrescar la tabla de sincronización.
- `error`: «La actualización no terminó», mostrar el código y permitir solicitar otra vez.
- Si `entidades` está vacío: «Falta actualizar y ejecutar el puente para habilitar esta función».

La última conexión indica cuándo el puente consultó al backend; no prueba que todas
las consultas a SAP hayan funcionado. Mostrarla incluso con la solicitud en curso:
si el puente no vuelve, no convertir el trabajo en completado por tiempo transcurrido.
Un error de red al consultar estado tampoco significa que el puente haya fallado.

## Comportamiento del puente

- Conserva el candado, el presupuesto de consultas, las pausas y los intervalos normales.
- Prioriza las entidades pendientes de la solicitud manual e ignora su frecuencia.
- Guarda el progreso local antes de confirmarlo al backend; una confirmación perdida se reenvía.
- No repite entidades ya confirmadas durante esa solicitud.
- Si había un recorrido anterior al clic, lo termina y luego inicia uno nuevo.
- Las pausas por presupuesto dejan la solicitud en curso. Cada ejecución retoma el avance.
- Un error se informa con un código, sin credenciales ni respuestas completas de SAP.
- Un backend anterior sin estas rutas no impide la sincronización habitual: se registra
  `solicitud_no_disponible`. Desplegar el backend antes del paquete del puente.

## Instalación

1. Desplegar este backend en Railway. No ejecutar limpiezas ni reiniciar secuencias.
2. En el servidor, deshabilitar la tarea y esperar a que la ejecución actual termine.
3. Respaldar la instalación y reemplazar el código por el paquete actualizado.
   Conservar `.env.puente`, **toda la carpeta de estado configurada**, certificados,
   registros y `ejecutar-oculto.vbs`. No sobrescribirlos con ejemplos del paquete.
4. Ejecutar una vez desde `C:\puente-cosprobell`:

```powershell
node --env-file=.env.puente puente/ejecutar.js --once
```

5. Publicar el frontend que use el contrato anterior.
6. Habilitar la tarea y probar el botón. Verificar un cambio conocido de SAP, la
   progresión de entidades y la finalización; comprobar también un doble clic.

Con la tarea actual de cinco minutos, el inicio puede tardar hasta cinco minutos,
y las continuaciones esperan al siguiente disparo. El botón no promete inmediatez.
Cambiar la tarea a un minuto también acelera las continuaciones de recorridos normales
y aumenta las consultas de control al backend. Medir la carga antes de ese cambio;
este desarrollo no cambia automáticamente la frecuencia ni los límites del servidor.

La tarea en modo `Interactive` sigue dependiendo de que la cuenta Windows mantenga
la sesión iniciada. Una solicitud queda pendiente si el puente está apagado.

## Verificación local

Pruebas automatizadas: solicitudes duplicadas y persistentes, aislamiento de empresa,
progreso idempotente, permisos del supervisor, presupuesto agotado, recorrido anterior
al clic y reenvío de confirmaciones. No sustituyen la prueba del paquete en el servidor.
