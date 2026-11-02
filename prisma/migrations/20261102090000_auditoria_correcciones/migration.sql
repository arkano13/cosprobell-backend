-- Correcciones del supervisor a lo escaneado en una auditoría ya terminada: cuántas unidades tenía el producto antes y
-- cuántas después, quién y por qué. El resultado de la auditoría se recalcula con los mismos números de la app y de SAP.
CREATE TABLE "auditoria_correcciones" (
  "id" SERIAL NOT NULL,
  "auditoriaId" INTEGER NOT NULL,
  "itemCode" TEXT NOT NULL,
  "antes" INTEGER NOT NULL,
  "despues" INTEGER NOT NULL,
  "motivo" TEXT,
  "hechoPor" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auditoria_correcciones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auditoria_correcciones_auditoriaId_fkey" FOREIGN KEY ("auditoriaId") REFERENCES "auditorias"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "auditoria_correcciones_auditoria_idx" ON "auditoria_correcciones"("auditoriaId");
