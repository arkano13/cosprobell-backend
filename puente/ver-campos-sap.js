import { configurar } from "./config.js";
import { crearControl } from "./control.js";
import { crearClienteSap } from "./sap.client.js";

// Muestra los nombres de los campos que publica Service Layer para los documentos financieros. Solo GET de $metadata:
// no muestra datos de clientes ni documentos, solo nombres de campos.
const TIPOS = ["Document", "Document_Line", "DocumentInstallment", "Payment", "PaymentInvoice", "BusinessPartner",
  "SalesPerson", "PaymentTermsType"];
let sap;
try {
  const config = configurar(process.env); config.control = crearControl(config);
  sap = crearClienteSap(config);
  const xml = await sap.metadata();
  for (const tipo of TIPOS) {
    const bloque = new RegExp(`<(EntityType|ComplexType) Name="${tipo}"[^>]*>([\\s\\S]*?)</\\1>`).exec(xml);
    const campos = bloque ? [...bloque[2].matchAll(/<(?:Property|NavigationProperty) Name="([^"]+)"/g)].map((m) => m[1]) : null;
    console.log(`${tipo}: ${campos ? campos.join(",") : "NO ENCONTRADO"}`);
  }
} catch (error) {
  console.error(JSON.stringify({ evento: "metadata_fallida", codigo: error.code ?? "REVISAR_CONFIGURACION", detalle: error.detalle }));
  process.exitCode = 1;
} finally { if (sap) await sap.cerrar().catch(() => {}); }
