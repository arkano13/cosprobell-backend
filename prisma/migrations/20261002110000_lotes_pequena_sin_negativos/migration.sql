CREATE TABLE inventario_pequena_lotes (
  id SERIAL PRIMARY KEY,
  clave TEXT NOT NULL UNIQUE,
  "itemCode" TEXT NOT NULL REFERENCES productos("itemCode"),
  lote TEXT,
  vencimiento DATE,
  unidades INTEGER NOT NULL CHECK (unidades >= 0),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX inventario_pequena_lotes_producto_idx ON inventario_pequena_lotes("itemCode");

-- No inventar los lotes de existencias antiguas: conservar el saldo como lote desconocido.
INSERT INTO inventario_pequena_lotes (clave, "itemCode", unidades)
SELECT '[' || to_json("itemCode")::text || ',null,null]', "itemCode", pequena
FROM inventario_productos WHERE pequena > 0;

ALTER TABLE inventario_movimientos ADD COLUMN "pequenaLoteId" INTEGER
  REFERENCES inventario_pequena_lotes(id);
CREATE INDEX inventario_movimientos_pequena_lote_idx ON inventario_movimientos("pequenaLoteId");

-- Conservar negativos históricos para conteo, pero impedir cualquier nuevo saldo negativo.
ALTER TABLE inventario_productos ADD CONSTRAINT inventario_pequena_no_negativa
  CHECK (pequena >= 0) NOT VALID;
