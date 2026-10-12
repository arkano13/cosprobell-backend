# Combos de SAP: preparación pendiente de publicar

Preparado el 11 de octubre de 2026. Sin commit, push, migración aplicada ni consultas
a SAP/producción. Se incorporó el trabajo de las ramas de combos de backend y frontend
al directorio local, con correcciones adicionales. No instalar este paquete sobre el
backend anterior: necesita sus rutas, modelos y migraciones.

## Resultado

Para ER10474 (Conjunto), receta base 1 con ER10028, ER10030 y ER10032, un pedido de
2 combos genera 2 unidades de cada componente. Conserva el código de la promoción
y su línea original. El pedido SAP no se modifica; se calcula la preparación local.
La app muestra nombre/código del componente y «Del combo…».

El puente lee ProductTrees con TreeCode, TreeType, Quantity y ProductTreeLines
(ItemCode, Quantity, ItemType). Lee hasta 20 recetas por página, usando los límites
de consultas y pausas existentes. Omite recursos/textos; no presupone cantidades.
Los conjuntos se expanden; ventas, producción y plantillas no se expanden por receta.
Los códigos de barras de los componentes deben estar disponibles y confirmados.

Referencia oficial:
https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html
(ProductTrees). La compatibilidad y permisos de la versión instalada se comprueban en el sondeo.

## Controles añadidos

- Activación explícita BRIDGE_BOM_ENABLED; desactivada por defecto.
- Pedidos espera a que listasMateriales termine su primera carga, aunque se agote el presupuesto.
- Los recorridos confirman también recetas sin cambios. Retira las ausentes solo al finalizar.
- Una receta retirada bloquea la preparación de ese combo hasta revisión.
- Cambiar una receta marca las preparaciones activas afectadas para revisión; conserva sus escaneos.
- Rechaza cantidades no enteras por combo y desbordamientos. La receta puede tener cantidad base distinta de 1.
- Rechaza componentes anidados/autorreferencias; no se expanden recursivamente en esta entrega.
- Si el pedido incluye componentes SAP iIngredient junto con un combo que se pretende expandir,
  pide revisión para evitar duplicarlos. No infiere relaciones por nombres o posición.
- Si SAP informa iAssemblyTree en una línea y falta su receta, se bloquea con COMBO_SIN_RECETA.
  En pedidos antiguos sin TreeType conviene completar otro recorrido antes de iniciar picking.

## 1. Publicar después de revisar los cambios

No hacer commit todavía: revisar backend y frontend localmente. Cuando se autorice
la instalación, comprobar el destino de Prisma y aplicar las migraciones pendientes:

```powershell
npx prisma migrate status --config=prisma7.config.js
npx prisma migrate deploy --config=prisma7.config.js
```

Migraciones incluidas: 20261010090000_combos y 20261011090000_combos_guardas.
Agregan listas_materiales, referencias de combo en picking y TreeType en líneas del
pedido. La primera conserva el SQL de la rama original; los controles van en la segunda.
No vaciar la base ni modificar manualmente tablas. Después desplegar el backend
con estos cambios y comprobar health y el commit de Railway.

## 2. Servidor: desactivar y respaldar

```powershell
Disable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
Get-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente' | Select-Object State
```

Esperar que deje de estar Running y que no haya ejecuciones manuales activas.

```powershell
$respaldoCombos = 'C:\puente-respaldo-combos-' + (Get-Date -Format yyyyMMdd-HHmmss)
Copy-Item -LiteralPath 'C:\puente-cosprobell' -Destination $respaldoCombos -Recurse
```

## 3. Copiar el paquete parcial

ZIP: puente-combos-preparacion.zip. Contiene seis archivos de código:

- puente/listasMateriales.js (nuevo)
- puente/entidades.js
- puente/config.js
- puente/pedidos.js
- src/modules/sincronizacion/listasMateriales.schemas.js (nuevo)
- src/modules/sincronizacion/pedidos.schemas.js

Extraer en una carpeta temporal y copiar respetando esas rutas dentro de
C:\puente-cosprobell. Reemplazar solo esos seis archivos. Conservar .env.puente,
toda la carpeta BRIDGE_STATE_DIR, logs, certificados y scripts de la tarea.
Este paquete no activa ni instala finanzas y conserva el botón manual.

## 4. Configurar y sondear

Agregar en .env.puente:

```dotenv
BRIDGE_BOM_ENABLED=true
```

En el JSON existente de BRIDGE_FREQUENCIES_JSON agregar `"listasMateriales":3600`.
Conservar el resto de claves y frecuencias; no crear una segunda variable del mismo nombre.
Eso permite actualizar recetas cada hora después de completarlas. Los recorridos
pendientes continúan en los disparos de la tarea sin esperar otra hora.

```powershell
cd C:\puente-cosprobell
node --env-file=.env.puente puente/ejecutar.js --once --sondeo
$LASTEXITCODE
```

Esperado: sondeo de listasMateriales con registros:1 (si hay recetas) y salida 0.
No envía datos al backend. Ante HTTP_403, HTTP_400 o LISTA_MATERIALES_SAP_INVALIDA,
guardar el código/detalle y resolverlo antes de continuar. No retirar validaciones.

## 5. Cargar y comprobar

```powershell
node --env-file=.env.puente puente/ejecutar.js --once
$LASTEXITCODE
```

Repetir mientras haya pausas normales. Buscar ciclo de listasMateriales completo:true.
Después completar pedidos para que llegue TreeType. Para solicitar un recorrido
actualizado de pedidos puede usarse el botón manual existente; no necesita otro cambio.

El botón sigue pidiendo solo productos, pedidos y existencias. No fuerza recetas.
Para una receta recién modificada, esperar su frecuencia o hacer una ejecución
manual con --once --forzar (fuerza todas las entidades habilitadas, respetando presupuesto).

## 6. App y prueba del caso real

Publicar el frontend preparado y distribuir su versión cuando se autorice.
Probar un pedido sin preparación iniciada de dos ER10474:

1. Debe mostrar ER10028, ER10030 y ER10032, dos unidades de cada uno.
2. Cada tarjeta identifica la promoción original.
3. Escanear un componente suma solo a ese producto; un artículo ajeno se rechaza.
4. Comprobar que un pedido normal sigue igual.
5. En pruebas, cambiar una receta con preparación iniciada: debe requerir revisión,
   sin borrar lo escaneado. Probar también eliminación y restauración de una receta.

Si aparecen cantidades/componentes diferentes a SAP, detener esa preparación y
comparar la receta y las líneas reales. Las pruebas locales no sustituyen este contraste.

```powershell
Enable-ScheduledTask -TaskPath '\Cosprobell\' -TaskName 'Puente'
```

La tarea, usuario, almacenes y límites se conservan. La tarea Interactive requiere
mantener iniciada la sesión Windows. No hace falta registrar una SQLQuery: ProductTrees
se consulta mediante GET del Service Layer.
