-- La conversión de datos se ejecuta después, por tandas, con el comando documentado.
-- La migración conserva finanzas_registros y no modifica pedidos/picking/inventario.
BEGIN;

-- El esquema previo declaraba estas columnas, pero faltaban en el historial SQL.
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "almacenDestino" TEXT;
ALTER TABLE "entregas" ADD COLUMN IF NOT EXISTS "almacenDestino" TEXT;

-- DropForeignKey
ALTER TABLE "pagos_facturas" DROP CONSTRAINT "pagos_facturas_facturaDocEntry_fkey";

-- AlterTable
ALTER TABLE "vendedores" ADD COLUMN     "finActivo" TEXT,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finNombre" TEXT,
ADD COLUMN     "finVersion" UUID;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "finActivo" TEXT,
ADD COLUMN     "finBloqueado" TEXT,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finNombre" TEXT,
ADD COLUMN     "finVersion" UUID,
ADD COLUMN     "saldoFC" DECIMAL(24,6),
ADD COLUMN     "saldoSC" DECIMAL(24,6),
ADD COLUMN     "zonaFinanciera" TEXT,
ALTER COLUMN "creditLimit" SET DATA TYPE DECIMAL(24,6),
ALTER COLUMN "currentAccountBalance" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "facturas" ADD COLUMN     "canceladoSap" TEXT,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finVersion" UUID,
ADD COLUMN     "pagadoFC" DECIMAL(24,6),
ADD COLUMN     "pagadoSC" DECIMAL(24,6),
ADD COLUMN     "payTermsGrpCode" INTEGER,
ADD COLUMN     "serie" INTEGER,
ADD COLUMN     "totalFC" DECIMAL(24,6),
ADD COLUMN     "totalSC" DECIMAL(24,6),
ADD COLUMN     "transId" INTEGER,
ALTER COLUMN "docTotal" SET DATA TYPE DECIMAL(24,6),
ALTER COLUMN "paidToDate" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "facturas_lineas" ADD COLUMN     "cardCode" TEXT,
ADD COLUMN     "fecha" DATE,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finVersion" UUID,
ALTER COLUMN "itemCode" DROP NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,6),
ALTER COLUMN "price" SET DATA TYPE DECIMAL(24,6),
ALTER COLUMN "lineTotal" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "notas_credito" ADD COLUMN     "canceladoSap" TEXT,
ADD COLUMN     "docDueDate" DATE,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finVersion" UUID,
ADD COLUMN     "pagadoFC" DECIMAL(24,6),
ADD COLUMN     "pagadoSC" DECIMAL(24,6),
ADD COLUMN     "paidToDate" DECIMAL(24,6),
ADD COLUMN     "payTermsGrpCode" INTEGER,
ADD COLUMN     "serie" INTEGER,
ADD COLUMN     "taxDate" DATE,
ADD COLUMN     "totalFC" DECIMAL(24,6),
ADD COLUMN     "totalSC" DECIMAL(24,6),
ADD COLUMN     "transId" INTEGER,
ALTER COLUMN "docTotal" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "notas_credito_lineas" ADD COLUMN     "cardCode" TEXT,
ADD COLUMN     "fecha" DATE,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finVersion" UUID,
ADD COLUMN     "price" DECIMAL(24,6),
ALTER COLUMN "itemCode" DROP NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(24,6),
ALTER COLUMN "lineTotal" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "canceladoSap" TEXT,
ADD COLUMN     "cheques" DECIMAL(24,6),
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finVersion" UUID,
ADD COLUMN     "serie" INTEGER,
ADD COLUMN     "sinAplicarOriginal" DECIMAL(24,6),
ADD COLUMN     "tarjetas" DECIMAL(24,6),
ADD COLUMN     "total" DECIMAL(24,6),
ADD COLUMN     "totalFC" DECIMAL(24,6),
ADD COLUMN     "totalSC" DECIMAL(24,6),
ADD COLUMN     "transId" INTEGER,
ALTER COLUMN "cashSum" SET DATA TYPE DECIMAL(24,6),
ALTER COLUMN "transferSum" SET DATA TYPE DECIMAL(24,6);

-- AlterTable
ALTER TABLE "pagos_facturas" ADD COLUMN     "aplicadoFC" DECIMAL(24,6),
ADD COLUMN     "aplicadoSC" DECIMAL(24,6),
ADD COLUMN     "cancelado" TEXT,
ADD COLUMN     "cardCode" TEXT,
ADD COLUMN     "documentoSap" INTEGER,
ADD COLUMN     "fecha" DATE,
ADD COLUMN     "finClave" TEXT,
ADD COLUMN     "finVersion" UUID,
ALTER COLUMN "facturaDocEntry" DROP NOT NULL,
ALTER COLUMN "sumApplied" SET DATA TYPE DECIMAL(24,6);

-- CreateTable
CREATE TABLE "empresa_financiera" (
    "codigo" TEXT NOT NULL,
    "monedaLocal" TEXT NOT NULL,
    "monedaSistema" TEXT NOT NULL,
    "finVersion" UUID,
    "finClave" TEXT,

    CONSTRAINT "empresa_financiera_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "condiciones_pago" (
    "codigo" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "meses" INTEGER NOT NULL,
    "cuotas" INTEGER,
    "finVersion" UUID,
    "finClave" TEXT,

    CONSTRAINT "condiciones_pago_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "facturas_cuotas" (
    "docEntry" INTEGER NOT NULL,
    "cuota" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "vencimiento" DATE NOT NULL,
    "total" DECIMAL(24,6) NOT NULL,
    "totalFC" DECIMAL(24,6),
    "totalSC" DECIMAL(24,6),
    "pagado" DECIMAL(24,6),
    "pagadoFC" DECIMAL(24,6),
    "pagadoSC" DECIMAL(24,6),
    "estado" TEXT,
    "finVersion" UUID,
    "finClave" TEXT,

    CONSTRAINT "facturas_cuotas_pkey" PRIMARY KEY ("docEntry","cuota")
);

-- CreateTable
CREATE TABLE "movimientos_contables" (
    "transId" INTEGER NOT NULL,
    "linea" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "vencimiento" DATE,
    "fechaDocumento" DATE,
    "tipo" TEXT NOT NULL,
    "documento" INTEGER,
    "referencia" TEXT,
    "monedaFC" TEXT,
    "debe" DECIMAL(24,6) NOT NULL,
    "haber" DECIMAL(24,6) NOT NULL,
    "debeFC" DECIMAL(24,6) NOT NULL,
    "haberFC" DECIMAL(24,6) NOT NULL,
    "debeSC" DECIMAL(24,6) NOT NULL,
    "haberSC" DECIMAL(24,6) NOT NULL,
    "finVersion" UUID,
    "finClave" TEXT,

    CONSTRAINT "movimientos_contables_pkey" PRIMARY KEY ("transId","linea")
);

-- CreateTable
CREATE TABLE "finanzas_normalizacion" (
    "entidad" TEXT NOT NULL,
    "version" UUID NOT NULL,
    "cursor" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "finalizadoEn" TIMESTAMP(3),
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finanzas_normalizacion_pkey" PRIMARY KEY ("entidad")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresa_financiera_finClave_key" ON "empresa_financiera"("finClave");

-- CreateIndex
CREATE INDEX "empresa_financiera_finVersion_finClave_idx" ON "empresa_financiera"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "condiciones_pago_finClave_key" ON "condiciones_pago"("finClave");

-- CreateIndex
CREATE INDEX "condiciones_pago_finVersion_finClave_idx" ON "condiciones_pago"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_cuotas_finClave_key" ON "facturas_cuotas"("finClave");

-- CreateIndex
CREATE INDEX "facturas_cuotas_finVersion_finClave_idx" ON "facturas_cuotas"("finVersion", "finClave");

-- CreateIndex
CREATE INDEX "facturas_cuotas_finVersion_cardCode_fecha_idx" ON "facturas_cuotas"("finVersion", "cardCode", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_contables_finClave_key" ON "movimientos_contables"("finClave");

-- CreateIndex
CREATE INDEX "movimientos_contables_finVersion_finClave_idx" ON "movimientos_contables"("finVersion", "finClave");

-- CreateIndex
CREATE INDEX "movimientos_contables_finVersion_cardCode_fecha_idx" ON "movimientos_contables"("finVersion", "cardCode", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "vendedores_finClave_key" ON "vendedores"("finClave");

-- CreateIndex
CREATE INDEX "vendedores_finVersion_finClave_idx" ON "vendedores"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_finClave_key" ON "clientes"("finClave");

-- CreateIndex
CREATE INDEX "clientes_finVersion_finClave_idx" ON "clientes"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_finClave_key" ON "facturas"("finClave");

-- CreateIndex
CREATE INDEX "facturas_finVersion_finClave_idx" ON "facturas"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_lineas_finClave_key" ON "facturas_lineas"("finClave");

-- CreateIndex
CREATE INDEX "facturas_lineas_finVersion_finClave_idx" ON "facturas_lineas"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "notas_credito_finClave_key" ON "notas_credito"("finClave");

-- CreateIndex
CREATE INDEX "notas_credito_finVersion_finClave_idx" ON "notas_credito"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "notas_credito_lineas_finClave_key" ON "notas_credito_lineas"("finClave");

-- CreateIndex
CREATE INDEX "notas_credito_lineas_finVersion_finClave_idx" ON "notas_credito_lineas"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_finClave_key" ON "pagos"("finClave");

-- CreateIndex
CREATE INDEX "pagos_finVersion_finClave_idx" ON "pagos"("finVersion", "finClave");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_facturas_finClave_key" ON "pagos_facturas"("finClave");

-- CreateIndex
CREATE INDEX "pagos_facturas_finVersion_finClave_idx" ON "pagos_facturas"("finVersion", "finClave");

-- AddForeignKey
ALTER TABLE "pagos_facturas" ADD CONSTRAINT "pagos_facturas_facturaDocEntry_fkey" FOREIGN KEY ("facturaDocEntry") REFERENCES "facturas"("docEntry") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "facturas_finVersion_cardCode_docDate_idx" ON "facturas"("finVersion", "cardCode", "docDate");
CREATE INDEX "facturas_lineas_finVersion_cardCode_fecha_idx" ON "facturas_lineas"("finVersion", "cardCode", "fecha");
CREATE INDEX "notas_credito_finVersion_cardCode_docDate_idx" ON "notas_credito"("finVersion", "cardCode", "docDate");
CREATE INDEX "notas_credito_lineas_finVersion_cardCode_fecha_idx" ON "notas_credito_lineas"("finVersion", "cardCode", "fecha");
CREATE INDEX "pagos_finVersion_cardCode_docDate_idx" ON "pagos"("finVersion", "cardCode", "docDate");

COMMIT;
