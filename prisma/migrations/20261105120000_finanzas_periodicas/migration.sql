CREATE TABLE "finanzas_actualizaciones" (
  "operacionId" UUID NOT NULL,
  "empresa" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "respuesta" JSONB NOT NULL,
  "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finanzas_actualizaciones_pkey" PRIMARY KEY ("operacionId")
);
