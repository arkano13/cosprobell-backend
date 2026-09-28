# Estructura del backend

## Organización actual

```text
src/
  app.js                         Configura Express y monta las rutas
  server.js                      Abre el puerto HTTP
  index.js                       Entrada compatible con comandos anteriores
  config/env.js                  Lee configuración del entorno
  infrastructure/
    database/prisma.js           Instancia compartida de Prisma
    logging/logger.js            Registro de eventos con ocultación de claves
  shared/
    security/hash.js             Hash de las API keys
    validation/safeString.js     Validación común de texto
  middleware/
    authenticate.js              Autenticación de aplicaciones
    validate.js                  Validación HTTP con Zod
    errorHandler.js              Respuesta central a errores
  modules/
    productos/                   Primer módulo separado por capas
    bodegas/                     Rutas existentes por área
    clientes/
    facturas/
    pagos/
    picking/
    health/
tests/
  unit/productos.service.test.js Reglas de búsqueda por código
  integration/app.test.js        HTTP y middleware con persistencia simulada
prisma/                          Esquema, migraciones y datos sintéticos
scripts/                         Comandos manuales
docs/                            Contexto y decisiones
```

## Capas de productos

| Archivo | Responsabilidad |
|---|---|
| `productos.routes.js` | URLs, validadores y controladores |
| `productos.schemas.js` | Entradas admitidas |
| `productos.controller.js` | Peticiones y respuestas HTTP |
| `productos.service.js` | Operaciones y reglas del módulo |
| `productos.repository.js` | Consultas a PostgreSQL mediante Prisma |

El servicio no recibe `req` ni `res`: se puede reutilizar desde otra aplicación o proceso. El repositorio desconoce HTTP. Se conservaron las consultas y respuestas existentes al redistribuirlas.

La búsqueda que antes estaba en `lib/buscarProductoPorCodigo.js` ahora está en `src/modules/productos/productos.service.js`. Su consulta pasó al repositorio. Todavía no está conectada al escaneo de picking.

Los otros módulos mantienen por ahora sus manejadores y consultas dentro de sus archivos `.routes.js`. Se separarán durante las siguientes sesiones guiadas. No se crearon archivos vacíos para funcionalidades que aún no se han implementado.

## Comandos

Desde la raíz del proyecto:

```powershell
npm run dev
npm test
node scripts/probar-codigo-de-barras.js 0012345678905
```

- `npm run dev` inicia `src/server.js` con observación de cambios.
- `npm start` inicia el mismo servidor sin observación.
- `npm test` ejecuta pruebas de reglas y HTTP sin consultar una base real. Se usan repositorios/métodos simulados y una URL ficticia de prueba.
- El script de código de barras sí consulta la base configurada en `.env`.
- `node src/index.js` se conserva como entrada compatible.
- Seed y creación de API keys mantienen sus comandos y sus efectos anteriores sobre la base configurada. No ejecutarlos como verificación de una redistribución.

## Qué se verificó

Doce pruebas: entradas inválidas, ceros iniciales, código desconocido, ambigüedad, propagación de fallos técnicos, protección de rutas, listado HTTP de productos, límite inválido, detalle inexistente, respuesta 500 y salud pública con éxito/fallo simulado.

Estas pruebas no certifican SQL, datos reales, concurrencia de picking ni conectividad con SAP. No se cambiaron el esquema, las migraciones o las reglas de preparación en esta redistribución.

## Próximos pasos guiados

1. Clase de errores y manejo central con códigos estables.
2. Diferenciar errores de validación de errores internos.
3. Completar pruebas de códigos de barras contra una base de desarrollo.
4. Separar picking y conectar identificación, unidades y reglas acordadas.
5. Validar configuración al arrancar y cerrar el servidor/conexiones de forma ordenada.

Los cambios de formato de error, identidad de personas, sincronización y WhatsApp siguen pendientes; mover archivos no implementa esas capacidades.
