# Sincronización con SAP Business One

Primera versión: carga completa de catálogos (grupos, bodegas y productos con códigos de barras y existencias). Probada con un Service Layer simulado y PostgreSQL real; **todavía no se ejecutó contra el SAP de Cosprobell**.

## Cómo funciona

```text
RED DE COSPROBELL                                  RAILWAY
SAP B1 ── Service Layer ── sincronizador/ ──HTTPS──► POST /sync/lotes ──► PostgreSQL
            (solo GET)      (Node, sin dependencias)  firma HMAC + validación
```

- El agente corre dentro de la red de Cosprobell y solo abre conexiones salientes. No se abren puertos ni se expone SAP a internet.
- Hacia SAP solo usa `Login`, `Logout` y consultas `GET`. No crea ni modifica nada en SAP.
- Envía los datos con los nombres de SAP; el backend valida, descarta los campos no permitidos y convierte al modelo local.

## Qué se sincroniza

| Entidad SAP | Tabla local | Regla |
|---|---|---|
| `ItemGroups` | `grupos_productos` | Alta o actualización por `Number` |
| `Warehouses` | `bodegas` | Alta o actualización por `WarehouseCode` |
| `Items` | `productos` | Alta o actualización por `ItemCode` |
| `ItemBarCodeCollection` | `productos_codigos_barras` | Se reemplaza la colección completa del producto; conserva `uomEntry` (unidad de SAP) sin interpretarla todavía |
| `ItemWarehouseInfoCollection` | `productos_existencias` | Se reemplaza la colección completa; las bodegas con existencia, comprometido y pedido en cero no se guardan (sin fila = cero) |

El orden es obligatorio: grupos → bodegas → productos. Si un producto referencia una bodega o un grupo que no existe en la base, el lote se rechaza con `DEPENDENCIAS_FALTANTES`; no se inventan bodegas.

## Garantías

- **Idempotencia:** cada lote lleva un `loteId`. Reenviar el mismo lote responde `duplicado` y no vuelve a escribir. Comprobado también con dos envíos simultáneos.
- **Todo o nada:** un lote se guarda completo en una transacción o no se guarda. Un registro inválido rechaza el lote e indica el campo exacto.
- **Autenticación:** firma HMAC-SHA256 de marca de tiempo, método, ruta y cuerpo, con ventana de 5 minutos. No usa la API key de las aplicaciones.
- **Registro de fallos:** los lotes rechazados por el servicio quedan en `errores_sincronizacion`; cada entidad registra su última ejecución en `sincronizaciones`.

## Puesta en marcha

### Backend

1. Aplicar la migración `20260928070000_sincronizacion_catalogos`.
2. Generar un secreto y configurarlo como `BRIDGE_SECRET` (mínimo 32 caracteres):
   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
   Sin `BRIDGE_SECRET`, `/sync/lotes` responde 503 y no acepta datos.

### Agente en la red de Cosprobell

Requisitos: Node.js 20.6 o superior, acceso a Service Layer y salida HTTPS hacia el backend. Requiere autorización de Cosprobell y un usuario SAP de solo lectura.

1. Copiar la carpeta `sincronizador/`. No necesita `npm install`.
2. Crear `sincronizador/.env` a partir de `.env.example`. El archivo contiene credenciales: no se sube al repositorio.
3. Si Service Layer usa un certificado autofirmado, exportarlo y declararlo antes de ejecutar:
   ```powershell
   $env:NODE_EXTRA_CA_CERTS = "C:\cosprobell\service-layer.pem"
   ```
   Nunca usar `NODE_TLS_REJECT_UNAUTHORIZED=0`.
4. Ejecutar desde `sincronizador/`:
   ```powershell
   npm run diagnostico   # solo lectura, no envía nada al backend
   npm run sincronizar   # carga completa hacia el backend
   ```

Conviene ejecutar primero el diagnóstico: informa conteos de bodegas, artículos, códigos de barras, unidades y órdenes abiertas, muestra las últimas órdenes y artículos con sus códigos por unidad, y advierte si faltan códigos o no hay órdenes abiertas.

## Verificación realizada

| Prueba | Resultado |
|---|---|
| `npm test` (backend y agente) | 133 aprobadas |
| `scripts/comprobar-sincronizacion.js` contra PostgreSQL | 5 de 5: carga, duplicado, envío simultáneo, dependencia faltante, reemplazo de colecciones |
| Punta a punta: SAP simulado (30 grupos, 100 bodegas, 250 productos) → agente → backend → PostgreSQL | Datos completos; productos divididos en 3 lotes por tamaño; segunda ejecución sin cambios en los datos |
| Secreto equivocado / contraseña SAP equivocada / configuración incompleta | Errores claros sin revelar secretos |

`scripts/comprobar-sincronizacion.js` escribe datos temporales, los elimina al terminar y se niega a correr con `NODE_ENV=production`.

## Pendiente

- Primera ejecución contra el SAP de Cosprobell: confirmar nombres de campos, paginación real y tiempos.
- Ejecución programada (Programador de tareas de Windows o servicio) y alertas si falla.
- Carga incremental por fecha de modificación; hoy cada ejecución es completa.
- Productos o bodegas eliminados en SAP: hoy no se retiran de la base.
- Existencias: definir con qué frecuencia refrescarlas y cómo comparar con SAP.
- Precios, clientes, órdenes y documentos comerciales.
- Interpretar `uomEntry`: equivalencias entre caja y unidad.
