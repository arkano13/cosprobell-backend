-- AlterTable: los operadores existentes quedan como "operador".
ALTER TABLE "operadores" ADD COLUMN     "rol" TEXT NOT NULL DEFAULT 'operador';
