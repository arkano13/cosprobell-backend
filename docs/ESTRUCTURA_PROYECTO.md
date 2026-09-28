# Estructura del backend

## Organización actual

```text
src/
  app.js                         Configura Express y monta las rutas
  server.js                      Abre el puerto HTTP y conecta el cierre ordenado
  index.js                       Entrada compatible con comandos anteriores
  config/
    env.schema.js                Validación de variables de entorno
    env.js                       Carga la configuración validada
  infrastructure/
    database/prisma.js           Instancia compartida de Prisma
    logging/logger.js            Registro de eventos con ocultación de claves y firmas
    shutdown.js                  Cierre HTTP y desconexión de PostgreSQL
  shared/
    errors/AppError.js           Errores conocidos con código y estado HTTP
    security/hash.js             Hash de las API keys
    security/firma.js            Firma HMAC del sincronizador
    validation/safeString.js     Validación común de texto
  middleware/
    authenticate.js              API key de aplicaciones y firma del sincronizador
    validate.js                  Validación HTTP con Zod
    errorHandler.js              Respuesta central a errores
  modules/
    productos/                   Separado por capas
    picking/                     Separado por capas, con transacción de sesión
    sincronizacion/              Recepción de lotes desde SAP
    bodegas/ clientes/ facturas/ pagos/ health/   Lógica todavía en sus rutas
sincronizador/                   Agente que corre en la red de Cosprobell (ver SINCRONIZACION.md)
tests/
  unit/                          Reglas, servicios, esquemas y middleware
  integration/                   HTTP con persistencia simulada
prisma/                          Esquema, migraciones y datos sintéticos
scripts/                         Comprobaciones manuales contra la base configurada
docs/                            Contexto y decisiones
```

## Capas de un módulo

| Archivo | Responsabilidad |
|---|---|
| `*.routes.js` | URL, autenticación, validación y controlador |
| `*.schemas.js` | Entradas admitidas |
| `*.controller.js` | Peticiones y respuestas HTTP |
| `*.service.js` | Reglas y operaciones; no recibe `req` ni `res` |
| `*.repository.js` | Consultas a PostgreSQL mediante Prisma |

`picking.transaction.js` bloquea la sesión de picking dentro de una transacción para coordinar escaneo y cierre. La transacción de sincronización está en `sincronizacion.repository.js`.

Bodegas, clientes, facturas y pagos mantienen sus consultas en las rutas; se separarán cuando haya que modificarlos.

## Rutas y autenticación

- `/health`: pública.
- `/sync/lotes`: firma HMAC del sincronizador (`BRIDGE_SECRET`); no usa API key.
- Las demás: API key de aplicación en `X-API-Key`.

## Comandos

Desde la raíz del proyecto:

```powershell
npm run dev
npm test
node scripts/probar-codigo-de-barras.js 0012345678905
node scripts/comprobar-sincronizacion.js
```

- `npm test` ejecuta las pruebas del backend y del agente sin consultar una base real.
- Los scripts de `scripts/` sí usan la base configurada en `.env`. Los de comprobación de picking y sincronización crean datos temporales y los eliminan.
- El seed no funciona en una base nueva: el bloque de facturas y pagos quedó fuera de `main()`.

## Qué verifican las pruebas

`npm test`: 133 pruebas (102 del backend y 31 del agente). Cubren validación, errores, autenticación, picking, contrato de lotes, servicio de sincronización y cliente de Service Layer contra servidores simulados.

No certifican el SAP real ni el comportamiento bajo carga. La concurrencia de picking y de sincronización se comprueba con los scripts contra PostgreSQL.
