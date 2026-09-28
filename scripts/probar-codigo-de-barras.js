import { buscarProductoPorCodigo } from "../src/modules/productos/productos.service.js";
import { prisma } from "../src/infrastructure/database/prisma.js";

async function main() {
  const codigo = process.argv[2];

  if (!codigo) {
    console.log(
      "Uso: node scripts/probar-codigo-de-barras.js CODIGO"
    );
    process.exitCode = 1;
    return;
  }

  const resultado = await buscarProductoPorCodigo(codigo);

  console.log(JSON.stringify(resultado, null, 2));
}

main()
  .catch((error) => {
    console.error("Falló la búsqueda:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });