# Puente operativo 2026.10.26.1

Primera entrega de mejora general, preparada sobre el proyecto actual y comparada con la copia recibida del servidor. No es una actualización del software SAP Service Layer.

## Qué mejora

1. **Almacenes:** conserva por recorrido los códigos ya comprobados. Si se agota el presupuesto durante la comprobación, retoma el resto. Al terminar el recorrido vuelve a validarlos en el siguiente; un cambio de empresa/origen/lista no reutiliza una verificación de otro alcance.
2. **Reparto:** cada entidad cede el turno entre páginas, por defecto después de 8 consultas. Vuelve a la cola mientras quede presupuesto total. No se corta una lectura compuesta por este límite suave; el límite global y el tiempo máximo siguen siendo obligatorios.
3. **Actualización dirigida:** se puede pedir solo clientes, facturas, existencias u otras entidades habilitadas. Si falta su primera carga de una dependencia, también la atiende. La selección de consola no cambia solicitudes del botón.
4. **Pausa explícita:** permite pausar una entidad aunque tenga un recorrido pendiente, conservando su estado. Mientras esté pausada, su copia puede estar desactualizada.
5. **Estado local:** permite comprobar la última carga completa y si queda trabajo pendiente sin consultar SAP ni el backend.
6. **Configuración visible:** el log identifica esta versión y los límites efectivos, pausas, frecuencias y selección, sin credenciales. Conserva mediciones por entidad y las mejoras del botón que ya estaban instaladas.
7. **Errores de acceso:** un 401/403 detiene esa ejecución para evitar volver a probar las mismas credenciales o permisos por cada entidad.

No resuelve automáticamente las líneas del traslado 5015 ni promete una reducción concreta de RAM. El consumo de facturas sigue dependiendo de cabeceras, notas de crédito y revisiones de pendientes. Su optimización de lecturas requiere medir esos componentes y preservar los cambios financieros; no se omitieron créditos ni documentos antiguos por suposición.

## Instalar sin cambiar la configuración actual

Hacerlo sin otra ejecución activa. Primero:

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-Process node -ErrorAction SilentlyContinue
```

Deshabilitar no termina un envío actual. Si aparece Node, esperar o identificarlo antes de continuar. No matar procesos de otras aplicaciones.

Con el Explorador, respaldar los archivos que se reemplazan. Copiar el contenido del parche a `C:\puente-cosprobell`, reemplazando solo los archivos incluidos en `puente`, el verificador de `scripts` y `MEJORA_OPERATIVA.json`.

Conservar `.env.puente`, estados, caches, logs, certificados, lanzadores y tus herramientas como `ver-traslado-entry.js`. No contiene datos ni credenciales y no necesita migraciones, cambios del backend o release de frontend para estas mejoras operativas. La parte financiera tiene otro paquete y sí requiere publicar su receptor.

Comprobar que se copiaron todos los archivos correctos:

```powershell
cd C:\puente-cosprobell
node scripts/verificar-mejora-operativa.js
```

Esperado: `correcto:true` y versión `2026.10.26.1`. Si faltan archivos, terminar de copiarlos antes de ejecutar. El manifiesto identifica los archivos del parche, no certifica todos los demás archivos de la instalación.

## Configuración opcional

No hace falta cambiar la configuración para activar el reparto: por defecto usa turnos de 8 consultas. Conservar por ahora límite total, pausas y frecuencias actuales para comparar una sola mejora.

Para fijar el turno explícitamente, actualizar/agregar una sola entrada en `.env.puente`:

```dotenv
BRIDGE_MAX_REQUESTS_PER_ENTITY=8
```

Para pausar únicamente existencias:

```dotenv
BRIDGE_PAUSED_ENTITIES=existencias
```

Para quitar la pausa:

```dotenv
BRIDGE_PAUSED_ENTITIES=
```

La copia de stock queda al último recorrido recibido mientras esté pausada. Pausar una entidad que pertenece a una solicitud de la app puede finalizar esa solicitud con `ENTIDADES_DESHABILITADAS`, porque se anuncia que no está disponible. No se declara completa. Si se pausa una dependencia sin primera carga, los documentos que la necesitan esperarán.

## Comandos nuevos

Ver estado local sin enviar información:

```powershell
node --env-file=.env.puente puente/ejecutar.js --estado
```

Actualizar solo documentos de preparación y traslados:

```powershell
node --env-file=.env.puente puente/ejecutar.js --once --forzar --entidades=facturasPreparacion,trasladosPreparacion,trasladosEntrada
```

Usar únicamente las entidades que tenga habilitadas esa instalación. Para recuperar un cliente que bloquea documentos:

```powershell
node --env-file=.env.puente puente/ejecutar.js --once --forzar --entidades=clientes
```

Para pedir únicamente existencias, si no está pausada:

```powershell
node --env-file=.env.puente puente/ejecutar.js --once --forzar --entidades=existencias
```

Si hay una pausa por presupuesto total, continuar con `--once --entidades=...` sin `--forzar`. El parámetro con entidades debe ser el mismo hasta completar ese trabajo. Si ya terminó, `--forzar` inicia otro recorrido, por eso no repetirlo indefinidamente para continuar uno pendiente.

El comando antiguo sin selección conserva su alcance amplio: `--forzar` por sí solo puede forzar todas las entidades no pausadas.

## Cómo comprobar la mejora

1. Antes de enviar, revisar `--estado` y la configuración que imprime.
2. Probar una ejecución normal con `node --env-file=.env.puente puente/ejecutar.js --once` cuando sea adecuado atender el trabajo pendiente.
3. Revisar `pausa_por_entidad`: significa que cedió el turno y puede continuar en la misma ejecución. `pausa_por_presupuesto` indica que terminó su presupuesto global.
4. Revisar eventos `ciclo` con `completo:true`. Una salida 0 no significa que todo el catálogo esté al día.
5. Comparar número de consultas y duración de recorridos completos de existencias, junto con la rapidez de SAP. No confundir menos consultas con menos RAM de forma automática.
6. Si todo responde correctamente, reactivar la tarea con `Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'`. Conserva su horario existente.

Rollback: detener nuevas ejecuciones, esperar el fin actual y restaurar los archivos respaldados. Mantener los estados; la información adicional de validación es compatible con el lector anterior y no requiere borrar progreso.

## Próximas entregas de la mejora general

- Medir y optimizar cabeceras, créditos y revisión de facturas pendientes con garantías de frescura y límites de tamaño.
- Mejorar diagnóstico y recuperación de documentos incompatibles sin omitir líneas ni marcar cargas incompletas como completas.
- Estado visible en la app con última carga completa, error y pausa por entidad.
- Terminar la importación financiera puntual en su carpeta y receptor correspondientes, tras sondear SAP.
