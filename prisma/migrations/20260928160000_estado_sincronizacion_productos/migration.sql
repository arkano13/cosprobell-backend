CREATE TABLE "sincronizacion_estados" (
    "entidad" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "secuencia" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sincronizacion_estados_pkey" PRIMARY KEY ("entidad")
);
