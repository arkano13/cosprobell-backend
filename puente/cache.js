import { DatabaseSync } from "node:sqlite";
import { ErrorPuente } from "./http.js";

// Caché local de huellas, no copia de los documentos. SQLite evita reescribir
// todo el catálogo en cada página. Cada llamada cierra el archivo, también en Windows.
export function crearCache(archivo) {
  function usar(operacion) {
    let db;
    try {
      db = new DatabaseSync(archivo);
      db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS huellas (clave TEXT PRIMARY KEY, hash TEXT NOT NULL)");
      return operacion(db);
    } catch { throw new ErrorPuente("CACHE_HUELLAS_INVALIDA"); }
    finally { db?.close(); }
  }
  return {
    leer(claves) {
      return usar(db => {
        const consultar = db.prepare("SELECT hash FROM huellas WHERE clave = ?");
        const resultado = {};
        for (const clave of claves) {
          const fila = consultar.get(clave);
          if (fila) {
            if (!/^[a-f0-9]{64}$/.test(fila.hash)) throw new Error("Huella inválida");
            resultado[clave] = fila.hash;
          }
        }
        return resultado;
      });
    },
    confirmar(huellas) {
      return usar(db => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const guardar = db.prepare("INSERT INTO huellas(clave, hash) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET hash=excluded.hash");
          for (const [clave, hash] of Object.entries(huellas)) guardar.run(clave, hash);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      });
    },
  };
}
