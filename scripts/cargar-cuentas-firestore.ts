// ══════════════════════════════════════════════════════════════════
// Carga out/cuentas.json a la colección /cuentas de Firestore usando
// el Admin SDK. Requiere una service account (ver README, sección
// "Configurar Firebase") en GOOGLE_APPLICATION_CREDENTIALS.
//
// Uso:  npx ts-node scripts/cargar-cuentas-firestore.ts
// ══════════════════════════════════════════════════════════════════
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// __dirname no existe en este modo de ejecución (ESM) — se reconstruye así.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const credencialesPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credencialesPath) {
  console.error("Define GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON de la service account.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credencialesPath, "utf-8")) as ServiceAccount;
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
// Algunos antivirus/firewalls/redes corporativas bloquean el protocolo
// gRPC que usa Firestore por defecto y producen errores confusos
// ("NOT_FOUND" / "not classified as transient") aunque todo esté bien
// configurado. Forzar REST evita ese problema.
db.settings({ preferRest: true });

async function main() {
  const cuentas = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", "cuentas.json"), "utf-8"));
  const batch = db.batch();
  for (const c of cuentas) {
    batch.set(db.collection("cuentas").doc(c.id), c, { merge: true });
  }
  await batch.commit();
  console.log(`${cuentas.length} cuentas cargadas a Firestore.`);
}

main().catch((err) => {
  console.error("\n❌ FALLÓ LA CARGA. Mensaje del error:\n");
  console.error(err.message ?? err);
  process.exit(1);
});
