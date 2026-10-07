# Desplegar el backend en Railway

El backend corre en Railway como un servicio web, junto al servicio de PostgreSQL del mismo proyecto. La app de escritorio de bodega se conecta a su dominio público por HTTPS. El puente con SAP es opcional y se configura después.

## Qué hace el repositorio solo

- `npm install` genera el cliente de Prisma (`postinstall`).
- `railway.json`, en cada despliegue:
  1. Aplica las migraciones pendientes antes de arrancar (`npx prisma migrate deploy`). Si ya están todas, no hace nada.
  2. Arranca con `npm start`.
  3. Comprueba `/health`, que responde bien solo si hay conexión con la base. Si no responde, Railway no pasa el tráfico a esa versión.
  4. Si el proceso se cae, lo reinicia (hasta 5 veces).

## Crear el servicio

1. En el proyecto de Railway que ya tiene PostgreSQL: **New → GitHub Repo → `arkano13/cosprobell-backend`**, rama `main`.
2. En el servicio nuevo, **Variables → Raw Editor**:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   NODE_ENV=production
   ```

   `Postgres` es el nombre del servicio de la base en el proyecto; si tiene otro nombre, usar ese. La referencia usa la conexión interna de Railway: la contraseña no se copia a mano y se actualiza sola si se regenera. **No** poner `PORT`: Railway la asigna.
3. **Settings → Networking → Generate Domain**. Ese `https://…` es la dirección del servidor para la app de escritorio.
4. Esperar el despliegue. En los registros deben aparecer `All migrations have been successfully applied` y `Servidor iniciado`. Abrir `https://<dominio>/health`: debe responder `{"status":"ok","db":"ok"}`.

## Variables opcionales (más adelante)

| Variable | Para qué |
|---|---|
| `BRIDGE_API_KEY` y `SAP_COMPANY_DB` | Puente con SAP. Sin ellas, `/integracion` responde 503 y el registro dice "Integración no disponible"; el resto funciona. |
| `ETIQUETAS_APPS_AUTORIZADAS` | Nombres de las API keys que pueden confirmar etiquetas (por ejemplo `supervisor-etiquetas`). Sin ella, nadie confirma etiquetas. |
| `ACTUALIZACIONES_GITHUB_TOKEN` | Actualización automática de la app de escritorio. Token *fine-grained* de GitHub con acceso solo al repositorio `cosprobell-bodega-escritorio` y permiso **Contents: Read-only** (cómo crearlo: README de la app, "Actualización automática"). El backend lo usa para traer las versiones de **Releases** y pasárselas a la app en `/actualizaciones`; nunca lo manda a la app. Sin él, `/actualizaciones` responde 503 y las apps siguen funcionando sin actualizarse. Vence: renovarlo antes de la fecha. |
| `ACTUALIZACIONES_REPO` | Repositorio de la app (`dueño/nombre`). Por defecto `arkano13/cosprobell-bodega-escritorio`; cambiarlo solo si se mueve el repositorio. |

## Probar sin SAP

Solo con una base **de pruebas**: los datos de demostración son ficticios.

Desde la PC, en la carpeta del backend con `main` actualizado y `npm install`. La dirección se toma de **servicio Postgres → Variables → `DATABASE_PUBLIC_URL`** (la interna solo funciona dentro de Railway). Se usa como variable de la terminal, para no guardar la contraseña en un archivo.

En PowerShell:

```powershell
$env:DATABASE_URL = "valor de DATABASE_PUBLIC_URL"
node scripts/datos-demo-bodega.js
```

En la terminal de Git (Git Bash), para que la dirección no quede en el historial: `read -rs DATABASE_URL` (pegar y Enter, no se ve) y luego `export DATABASE_URL`.

Para ingresar a la app hacen falta operadores con PIN y la clave de solo ingreso de la app: ver [INGRESO_OPERADORES.md](INGRESO_OPERADORES.md). `node scripts/datos-demo-bodega.js --borrar` elimina los datos de demostración.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `/health` responde `db: unreachable` | `DATABASE_URL` no apunta a la base: revisar el nombre del servicio en la referencia |
| El despliegue falla antes de arrancar | Error al aplicar una migración: ver el registro del paso previo al despliegue |
| La app dice "No se pudo conectar con el servidor" | Dominio mal escrito o servicio detenido: probar `/health` en el navegador |
| La app dice "La clave no es válida" | La clave se creó en otra base, o está desactivada (`activa = false` en `api_keys`) |
| Las apps no se actualizan | En los registros, `ACTUALIZACIONES_SIN_CONFIGURAR` (falta el token), `ACTUALIZACIONES_NO_DISPONIBLES` con 401 (token vencido o mal copiado) o 404 (el token no tiene acceso al repositorio), o `ARCHIVO_NO_ENCONTRADO` (la última versión publicada no tiene `latest.yml`) |

## Seguridad

- La contraseña de la base solo vive en Railway. No se copia en la app ni en archivos del repositorio.
- Si una dirección de la base con contraseña se compartió por error, regenerarla en **servicio Postgres → Database → Credentials** y volver a desplegar el backend. No editar `POSTGRES_PASSWORD` a mano: eso no cambia la contraseña real de la base.
