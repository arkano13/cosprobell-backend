-- Traslados de SAP de la bodega grande a la pequeña (la 01 a la 02): cada línea se pasa en la bodega escaneando las
-- cajas. aceptadas: lo que ya se pasó; cerradaPor: el supervisor la dio por pasada sin mover nada (ya se había pasado).
CREATE TABLE "traslados_entrada" (
  "docEntry" INTEGER NOT NULL,
  "docNum" INTEGER NOT NULL,
  "docDate" DATE NOT NULL,
  "sincronizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "traslados_entrada_pkey" PRIMARY KEY ("docEntry")
);
CREATE TABLE "traslados_entrada_lineas" (
  "id" SERIAL NOT NULL,
  "docEntry" INTEGER NOT NULL,
  "lineNum" INTEGER NOT NULL,
  "itemCode" TEXT NOT NULL,
  "unidades" INTEGER NOT NULL,
  "aceptadas" INTEGER NOT NULL DEFAULT 0,
  "aceptadoEn" TIMESTAMP(3),
  "aceptadoPor" TEXT,
  "cerradaPor" TEXT,
  CONSTRAINT "traslados_entrada_lineas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "traslados_entrada_lineas_unidades" CHECK ("unidades" > 0 AND "aceptadas" >= 0 AND "aceptadas" <= "unidades"),
  CONSTRAINT "traslados_entrada_lineas_docEntry_fkey" FOREIGN KEY ("docEntry") REFERENCES "traslados_entrada"("docEntry") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "traslados_entrada_lineas_docEntry_lineNum_key" ON "traslados_entrada_lineas"("docEntry", "lineNum");
CREATE INDEX "traslados_entrada_lineas_itemCode_idx" ON "traslados_entrada_lineas"("itemCode");
