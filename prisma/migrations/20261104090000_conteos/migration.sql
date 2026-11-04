-- Conteo con nombre: cualquier operador le pone un nombre (por ejemplo "Devolución cliente X" o "Estante 4"), escanea
-- unidad por unidad lo que tiene delante y al finalizar sale la lista de productos con sus cantidades. No compara con
-- existencias ni mueve inventario.
CREATE TABLE "conteos" (
  "id" SERIAL NOT NULL,
  "nombre" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'en_curso',
  "operadorId" INTEGER,
  "iniciadoPor" TEXT,
  "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "terminadoEn" TIMESTAMP(3),
  CONSTRAINT "conteos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conteos_estado" CHECK ("estado" IN ('en_curso', 'terminado', 'anulado'))
);
CREATE INDEX "conteos_estado_idx" ON "conteos"("estado", "iniciadoEn");
CREATE INDEX "conteos_operador_idx" ON "conteos"("operadorId", "iniciadoEn");

CREATE TABLE "conteo_lecturas" (
  "id" SERIAL NOT NULL,
  "conteoId" INTEGER NOT NULL,
  "operacionId" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL,
  "hechoPor" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conteo_lecturas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conteo_lecturas_conteoId_fkey" FOREIGN KEY ("conteoId") REFERENCES "conteos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Un reintento de la misma lectura no cuenta dos veces.
CREATE UNIQUE INDEX "conteo_lecturas_operacion_key" ON "conteo_lecturas"("conteoId", "operacionId");
CREATE INDEX "conteo_lecturas_item_idx" ON "conteo_lecturas"("conteoId", "itemCode");
