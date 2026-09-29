# Pantalla de bodega

Página web para quien prepara los pedidos. La sirve el mismo backend en `/bodega/` y funciona en una PC con lector USB o en un equipo Android con lector integrado, en cualquier navegador actual (Chrome recomendado). No necesita instalar nada.

## Qué hace

1. **Configurar el equipo** (una sola vez): la clave (API key) del equipo y el nombre de quien escanea. La clave queda guardada solo en ese navegador.
2. **Pedidos abiertos**: lista con número, cliente, fechas y hace cuánto llegaron los datos de SAP. Buscador por número o cliente.
3. **Detalle del pedido**: productos y cantidades pendientes a preparar. Si el pedido no se puede preparar (cerrado, cancelado, unidad "Manual", etc.), lo explica y no deja empezar.
4. **Escaneo**: cada lectura responde en grande, en verde con ícono de aceptada (producto y cuántas lleva) o en rojo con ícono de rechazada (motivo), con sonido distinto y vibración en los errores. Las líneas pendientes quedan arriba; las completas, en verde al final. En PC la lectura queda a la izquierda y las líneas a la derecha.
5. **Ver lecturas**: historial de la preparación (aceptadas y rechazadas).
6. **Finalizar**: si faltan productos, muestra cuáles y pide confirmar "Finalizar con diferencias".

Si se sale de una preparación sin finalizarla, la lista ofrece **Continuar** donde quedó.

## El lector de códigos

- El lector debe funcionar **como teclado** y terminar cada lectura con **Enter** (configuración habitual de fábrica).
- El campo de lectura tiene siempre el foco; si se toca un botón, vuelve solo.
- En Android el teclado en pantalla no aparece al escanear. El botón con ícono de **teclado** lo muestra para escribir un código a mano. En una PC con mouse ese botón no se muestra: se escribe con el teclado físico.

## Sin conexión y reintentos

- Cada lectura recibe un identificador propio (operacionId) al escanearse. Si la respuesta no llega, se reintenta con el **mismo** identificador: el servidor no cuenta la unidad dos veces.
- Si la red no vuelve, la pantalla avisa "Sin conexión. N lecturas pendientes" y las guarda en el equipo. Se envían solas al volver la red (o con **Reintentar ahora**), en el mismo orden, incluso si se recargó la página.
- Sin conexión no se pueden consultar pedidos ni empezar preparaciones: la pantalla no trabaja desconectada.

## Puesta en marcha

1. Aplicar las migraciones y desplegar el backend.
2. Crear una clave por equipo de bodega (cada una se puede desactivar por separado):

   ```powershell
   node scripts/crear-api-key.js escaner-bodega-1
   ```

   Esta clave **no** debe estar en `ETIQUETAS_APPS_AUTORIZADAS`: el escáner no confirma etiquetas.
3. En el equipo, abrir `https://<dominio-del-backend>/bodega/` y configurar la clave y el nombre.
4. En Android, "Agregar a la pantalla principal" deja un acceso directo.

## Probar sin SAP (en tu PC)

Con la base de **desarrollo** (nunca producción):

```powershell
node scripts/datos-demo-bodega.js            # crea 2 pedidos, productos y códigos ficticios
node scripts/crear-api-key.js bodega-demo    # anota la clave que muestra
npm run dev
```

Abrir `http://localhost:3000/bodega/`, configurar la clave y preparar el pedido 90001. El script muestra los códigos: dos válidos (shampoo y jabón) y tres que se rechazan (crema sin confirmar, caja de shampoo y un producto fuera del pedido). Se pueden escribir y presionar Enter si no hay lector. `--reiniciar` vuelve a crear los datos y `--borrar` los elimina.

## Diseño

Identidad de Cosprobell en tono formal: morado de referencia (**#362F44**) en la barra y el panel del lector, acciones en violeta **#5B3FA0**, números en letra condensada y códigos en letra monoespaciada.

- **Pedidos**: tarjetas con cabecera (número grande), cliente y fechas.
- **Panel del lector** (oscuro): indica "Listo para leer" cuando el campo tiene el foco y "Tocá el campo para leer" cuando no. El resultado de cada lectura ocupa un recuadro verde o rojo con ícono.
- **Líneas**: una casilla por unidad (hasta 24) e insignia "Completa" al terminar.
- **Resumen al finalizar**: estado (Completa o Con diferencias), unidades preparadas, líneas completas, operador y horas de inicio y fin; debajo, los faltantes.
- **Avisos**: franja de color con ícono y texto.
- **Accesibilidad**: verde y rojo solo para aceptado y rechazado, siempre con ícono y texto; contraste de texto de al menos 4.5:1 (WCAG AA); botones de 48 px o más; foco visible; respeta "reducir movimiento".
- **Letras**: Barlow y Barlow Condensed y JetBrains Mono, alojadas en `fuentes/` con su licencia SIL OFL 1.1. No se descargan de internet: funcionan en la red interna.
- **Íconos**: SVG de Lucide (licencia ISC) dentro de `js/iconos.js`.

## Seguridad

- Los archivos de la pantalla son públicos y no contienen datos ni claves. Todos los datos se piden con la clave del equipo.
- La clave queda en el navegador del equipo: cualquiera con acceso a ese navegador puede usarla. Si un equipo se pierde, desactivar su clave (`activa = false` en `api_keys`).
- La clave identifica al equipo, no a la persona. El nombre del operador se guarda como texto al iniciar cada preparación.

## Verificación

Prueba en Chromium real contra PostgreSQL con los datos de demostración: configuración con clave equivocada y correcta, lista, detalle, lectura válida, cuatro rechazos, respuesta del servidor perdida y reintento sin doble conteo, corte de red con reenvío automático, recarga con lecturas pendientes (enviadas una sola vez), exceso, historial, vista de celular (375 px, sin desplazamiento horizontal, sin teclado en pantalla y botones de 44 px o más) y finalización con diferencias. Sin errores de página ni de la política de seguridad (CSP). Auditoría automática de accesibilidad (axe-core, WCAG 2.2 A/AA) de cada vista en PC y celular, sin problemas detectados.

No probado: un lector físico y equipos Android reales.

## Pendiente (reglas de Cosprobell)

- Qué hacer con una preparación en `requiere_revision`: hoy la pantalla la bloquea y pide avisar al supervisor.
- Cuánto tiempo sin actualizar se acepta: hoy solo avisa si los datos del pedido tienen más de una hora.
- Quién puede finalizar con diferencias: hoy cualquier equipo con clave puede hacerlo.
