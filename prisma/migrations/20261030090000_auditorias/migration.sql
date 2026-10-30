-- Auditoría de una bodega: se escanea todo lo que hay, unidad por unidad, y al terminar se compara con la app y con SAP.
-- Solo informa: no mueve inventario. resultado = la comparación congelada al terminar.
CREATE TABLE "auditorias" (
  "id" SERIAL NOT NULL,
  "almacen" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'en_curso',
  "iniciadaPor" TEXT,
  "iniciadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "terminadaPor" TEXT,
  "terminadaEn" TIMESTAMP(3),
  "resultado" JSONB,
  CONSTRAINT "auditorias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auditorias_estado" CHECK ("estado" IN ('en_curso', 'terminada', 'anulada'))
);
-- Una sola auditoría en curso por almacén.
CREATE UNIQUE INDEX "auditorias_una_en_curso" ON "auditorias"("almacen") WHERE "estado" = 'en_curso';
CREATE INDEX "auditorias_almacen_idx" ON "auditorias"("almacen", "iniciadaEn");

CREATE TABLE "auditoria_lecturas" (
  "id" SERIAL NOT NULL,
  "auditoriaId" INTEGER NOT NULL,
  "operacionId" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL,
  "hechoPor" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auditoria_lecturas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auditoria_lecturas_auditoriaId_fkey" FOREIGN KEY ("auditoriaId") REFERENCES "auditorias"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Un reintento de la misma lectura no cuenta dos veces.
CREATE UNIQUE INDEX "auditoria_lecturas_operacion_key" ON "auditoria_lecturas"("auditoriaId", "operacionId");
CREATE INDEX "auditoria_lecturas_item_idx" ON "auditoria_lecturas"("auditoriaId", "itemCode");
