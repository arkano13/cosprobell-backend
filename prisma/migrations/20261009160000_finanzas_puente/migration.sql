-- Aditiva: no cambia ni borra tablas del scanner ni los modelos históricos Float.
CREATE TABLE "finanzas_control" (
  "entidad" TEXT PRIMARY KEY, "empresa" TEXT NOT NULL, "recorridoId" UUID NOT NULL,
  "configuracion" JSONB NOT NULL, "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadoEn" TIMESTAMP(3), "secuencia" INTEGER NOT NULL DEFAULT 0,
  "ultimoHash" TEXT, "cantidad" INTEGER NOT NULL DEFAULT 0, "activoId" UUID, "publicadoEn" TIMESTAMP(3), "lecturaPublicadaDesde" TIMESTAMP(3)
);
CREATE TABLE "finanzas_registros" (
  "entidad" TEXT NOT NULL, "version" TEXT NOT NULL, "clave" TEXT NOT NULL,
  "cardCode" TEXT, "fecha" DATE, "vencimiento" DATE, "datos" JSONB NOT NULL,
  "debe" DECIMAL(24,6), "haber" DECIMAL(24,6), "saldo" DECIMAL(24,6),
  "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("entidad", "version", "clave")
);
CREATE INDEX "finanzas_registros_entidad_version_cardCode_fecha_idx"
  ON "finanzas_registros" ("entidad", "version", "cardCode", "fecha");
