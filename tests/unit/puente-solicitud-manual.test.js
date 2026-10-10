import test from "node:test";
import assert from "node:assert/strict";
import { prepararSolicitud, confirmarSolicitudLocal, faltaSolicitud } from "../../puente/solicitud-manual.js";
import { sincronizar } from "../../puente/sincronizar.js";
import { PRODUCTOS } from "../../puente/entidades.js";
import { crearClienteBackend } from "../../puente/backend.client.js";

const id = "7791b6dc-b747-462d-936e-34c5879d410a";
function almacen(estado = {}) {
  return { estado: { secuencia: 0, cursor: null, pendiente: null, ...estado },
    async guardar(e) { this.estado = structuredClone(e); } };
}
const config = { empresa: "SAP", soloCambios: false };
const backend = { estado: async () => 0 };

test("recorrido anterior al clic no satisface la solicitud; exige uno nuevo completo", async () => {
  const a = almacen({ cursor: "P99" });
  await prepararSolicitud(a, id);
  assert.equal(a.estado.solicitudManualId, undefined);
  await sincronizar({ config, almacen: a, backend, sap: { pagina: async () => [] }, entidad: PRODUCTOS });
  assert.equal(a.estado.solicitudManualCompletaId, undefined);
  await prepararSolicitud(a, id);
  assert.equal(a.estado.solicitudManualId, id);
  await sincronizar({ config, almacen: a, backend, sap: { pagina: async () => [] }, entidad: PRODUCTOS });
  assert.equal(a.estado.solicitudManualCompletaId, id);
});

test("presupuesto agotado conserva solicitud y cursor sin confirmar éxito", async () => {
  const a = almacen(); await prepararSolicitud(a, id);
  const error = Object.assign(new Error(), { code: "PRESUPUESTO_AGOTADO" });
  await assert.rejects(sincronizar({ config, almacen: a, backend,
    sap: { pagina: async () => { throw error; } }, entidad: PRODUCTOS }), { code: error.code });
  assert.equal(a.estado.solicitudManualId, id);
  assert.equal(a.estado.solicitudManualCompletaId, undefined);
  await prepararSolicitud(a, id);
  await sincronizar({ config, almacen: a, backend, sap: { pagina: async () => [] }, entidad: PRODUCTOS });
  assert.equal(a.estado.solicitudManualCompletaId, id);
});

test("confirmación perdida se reenvía desde estado durable sin consultar SAP otra vez", async () => {
  const a = almacen({ solicitudManualCompletaId: id });
  const solicitud = { id, entidades: ["productos"], completas: [] };
  await assert.rejects(confirmarSolicitudLocal(solicitud, [PRODUCTOS], [a], {
    progresoSolicitud: async () => { throw new Error("sin red"); },
  }));
  assert.deepEqual(solicitud.completas, []);
  let llamadas = 0;
  const receptor = { progresoSolicitud: async (recibido, completas) => {
    llamadas++; assert.equal(recibido, id); assert.deepEqual(completas, ["productos"]);
  } };
  await confirmarSolicitudLocal(solicitud, [PRODUCTOS], [a], receptor);
  await confirmarSolicitudLocal(solicitud, [PRODUCTOS], [a], receptor);
  assert.equal(llamadas, 1);
  assert.equal(faltaSolicitud(solicitud, "productos"), false);
});

test("cliente manual usa autenticación del puente y valida entidades recibidas", async () => {
  const peticiones = [];
  const cliente = crearClienteBackend({ backendUrl: "https://backend.example", clave: "secreto" }, async (url, opciones) => {
    peticiones.push({ url, ...opciones });
    return new Response(JSON.stringify({ data: { id, entidades: ["productos"], completas: [] } }));
  });
  assert.equal((await cliente.solicitud([PRODUCTOS])).id, id);
  assert.equal(peticiones[0].headers.Authorization, "Bearer secreto");
  assert.deepEqual(JSON.parse(peticiones[0].body), { entidades: ["productos"] });
  const malo = crearClienteBackend({ backendUrl: "https://backend.example" }, async () =>
    new Response(JSON.stringify({ data: { id, entidades: ["facturas"], completas: [] } })));
  await assert.rejects(malo.solicitud([PRODUCTOS]), { code: "SOLICITUD_MANUAL_INVALIDA" });
});
