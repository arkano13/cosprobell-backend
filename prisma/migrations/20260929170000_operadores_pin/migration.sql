-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "alcance" TEXT NOT NULL DEFAULT 'completo';

-- CreateTable
CREATE TABLE "operadores" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_operador" (
    "id" SERIAL NOT NULL,
    "operadorId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "aplicacion" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "cerradaEn" TIMESTAMP(3),

    CONSTRAINT "sesiones_operador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operadores_nombre_key" ON "operadores"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_operador_tokenHash_key" ON "sesiones_operador"("tokenHash");

-- CreateIndex
CREATE INDEX "sesiones_operador_operadorId_idx" ON "sesiones_operador"("operadorId");

-- AddForeignKey
ALTER TABLE "sesiones_operador" ADD CONSTRAINT "sesiones_operador_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "operadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
