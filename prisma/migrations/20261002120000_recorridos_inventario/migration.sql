CREATE TABLE sincronizacion_recorridos (
  entidad TEXT PRIMARY KEY,
  empresa TEXT NOT NULL,
  "recorridoId" UUID NOT NULL,
  "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadoEn" TIMESTAMP(3),
  secuencia INTEGER
);
