# Publicar la normalización financiera junto con los conteos

La rama `codex/finanzas-normalizacion-completa` parte del `main` que incluye el conteo con nombre (#57). Integra los
14 archivos de `respaldo/cambios-locales` más los módulos, migración, scripts y pruebas nuevos que ese respaldo no incluía.

## Alcance de esta actualización

- Convierte los snapshots financieros GET ya recibidos a tablas de la misma base, por tandas verificadas y reanudables.
- Conserva el origen JSON, versiones anteriores, nulos e importes de seis decimales.
- Usa las tablas convertidas al terminar cada entidad; durante la conversión `/finanzas` mantiene la versión JSON publicada.
- Restringe también las rutas anteriores de facturas y pagos a aplicaciones autorizadas para finanzas.
- Permite refrescar una sola entidad de cabeceras por GET para resolver el desfase entre documentos y sus líneas.
- Incluye la corrección de residuos decimales de importes grandes y los diagnósticos de soporte usados durante la carga.
- El endpoint del botón manual acepta una selección de entidades operativas y conserva el comportamiento de los clientes
  anteriores que envían `{}`. No solicita datos financieros ni implementa el selector visual del frontend.
- Conserva el conteo y sus lecturas. No cambia sus rutas, la preparación, el inventario ni sus cantidades.

La actualización **no implementa aún** el módulo financiero periódico integrado al puente operativo, conciliaciones ni
partidas abiertas verificadas. Tampoco crea la base de pruebas en Railway ni el agente de Telegram.

## Antes de publicar

Desde el backend:

```powershell
npm run prisma:generate
```

Para las pruebas, instalar también las dependencias de desarrollo. Las pruebas de PostgreSQL usan una base WASM efímera
local, sin consultar SAP ni Railway:

```powershell
npm test
```

Preparar el commit de esta rama y publicar un PR a `main`. Revisar el PR completo, incluidos los archivos nuevos.
La rama de respaldo por sí sola no es desplegable: importa módulos que deben estar incluidos en el mismo cambio.

## Despliegue

Railway ejecuta `npx prisma migrate deploy --config=prisma7.config.js` antes de arrancar. Se corrigió la configuración
para que use el nombre real del archivo de Prisma 7. El cliente también se genera con ese archivo durante `postinstall`.

La migración `20261103120000_normalizar_finanzas` ya se aplicó manualmente en la instalación que usamos para la carga.
Se incluye **sin modificar su SQL** para que Prisma la reconozca y una base nueva pueda reproducirla. `migrate deploy`
omite las migraciones que ya están aplicadas. Conserva también la migración posterior `20261104090000_conteos` de `main`.

Configurar `FINANZAS_APPS_AUTORIZADAS` en el backend con los nombres de las aplicaciones que podrán consultar importes.
Las demás aplicaciones conservan la ficha básica de clientes, pero reciben 403 en facturas/pagos. Los importes convertidos
se serializan como cadenas decimales; las interfaces consumidoras deben contemplarlo.

El despliegue no ejecuta automáticamente la normalización. Si ya está en curso, conserva el avance confirmado en la base.
Después de publicar, puede consultarse con:

```powershell
node scripts/normalizar-finanzas.js --estado
```

Para completar lo pendiente:

```powershell
node scripts/normalizar-finanzas.js --aplicar --lote=50
```

Si una entidad informa `RELACION_FINANCIERA_FALTANTE`, seguir [COMPLETAR_CABECERAS_FINANCIERAS.md](COMPLETAR_CABECERAS_FINANCIERAS.md).
La guía completa de conversión está en [NORMALIZAR_FINANZAS.md](NORMALIZAR_FINANZAS.md).

## Archivos privados

El commit no incluye `.env`, `.env.puente`, estados, logs, `node_modules`, `generated`, paquetes de `dist` ni diagnósticos
con resultados de producción. Los scripts de diagnóstico sí se versionan como código de soporte; no contienen credenciales.
