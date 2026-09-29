// ══════════════════════════════════════════════════════════════════
// Carga out/historico-mensual.json (TODOS los meses ya conciliados
// según el Excel de Seguimiento 2026) como conciliaciones REALES en
// Firestore — cada mes queda como si se hubiera hecho en el sistema,
// marcado "migrada" en vez de calculada por el motor. Esto hace que:
//   1) El Histórico de cada cuenta muestre esos meses como conciliados.
//   2) Las partidas anteriores del mes siguiente se carguen solas
//      (el sistema busca el mes previo real en Firestore).
//
// IMPORTANTE: el estado (CONCILIADA / CON_DIFERENCIAS) SIEMPRE se
// calcula con la fórmula real de conciliación — nunca se asume
// "conciliado" solo porque el Excel original decía diferencia $0,00
// en un mes. Se detectaron casos reales (ej. cuenta 0021-5 Salud
// Pública, julio 2026) donde el Excel certificaba diferencia cero
// pero los saldos + partidas no cuadraban — error humano de
// clasificación en el Seguimiento. Esos casos quedan marcados
// CON_DIFERENCIAS para que el contador los ajuste manualmente en el
// sistema; ese ajuste correcto es el que se hereda al mes siguiente.
//
// Requiere GOOGLE_APPLICATION_CREDENTIALS (misma llave que
// cargar-cuentas-firestore.ts).
//
// Uso:  npx tsx scripts/cargar-historico-firestore.ts
// ══════════════════════════════════════════════════════════════════
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const credencialesPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credencialesPath) {
  console.error("Define GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON de la service account.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credencialesPath, "utf-8")) as ServiceAccount;
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
db.settings({ preferRest: true });

type Tipo = "REND" | "CLNB" | "CBNL" | "PLNB" | "PBNL";
// Rendimientos y Consignaciones en Bancos y no Libros SUMAN; Consignaciones
// en Libros y no Bancos y Pagos en Bancos y no Libros RESTAN; Pagos en
// Libros y no Bancos SUMA (corregido — antes estaba invertido con PBNL).
const SIGNO: Record<Tipo, 1 | -1> = { REND: 1, CBNL: 1, PLNB: 1, CLNB: -1, PBNL: -1 };

interface MesSeed {
  cuentaId: string;
  periodo: string; // "2026-03"
  saldoLibro: number;
  saldoExtracto: number;
  diferenciaOriginal: number | null;
  partidas: { descripcion: string; tipo: Tipo; valorAbsoluto: number }[];
}

async function main() {
  const meses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "out", "historico-mensual.json"), "utf-8")
  ) as MesSeed[];

  console.log(`${meses.length} meses a cargar…`);

  const TAMANO_LOTE = 200; // 2 escrituras por mes (pointer + versión 0); límite real de Firestore es 500 por batch
  let cargados = 0;
  // Casos donde el Excel decía "conciliado / diferencia $0" pero al
  // recalcular con la fórmula real (saldo libro + partidas) el resultado
  // NO da cero — es decir, hay un error humano de clasificación en el
  // Seguimiento original. Estos NO se asumen como conciliados: quedan
  // marcados CON_DIFERENCIAS para que el contador los ajuste manualmente
  // en el sistema (clasificando la partida correcta); una vez guardados
  // así, ese ajuste correcto sí se hereda al mes siguiente.
  const discrepancias: { cuentaId: string; periodo: string; diferenciaExcel: number; diferenciaCalculada: number }[] = [];

  for (let i = 0; i < meses.length; i += TAMANO_LOTE) {
    const lote = meses.slice(i, i + TAMANO_LOTE);
    const batch = db.batch();

    for (const m of lote) {
      const intereses = m.partidas.filter((p) => p.tipo === "REND").reduce((s, p) => s + p.valorAbsoluto, 0);

      // SIEMPRE se recalcula con la fórmula real — nunca se asume
      // conciliado solo porque el Excel original decía "$0,00" en la
      // fila DIFERENCIA. Ese valor certificado por el contador se usa
      // únicamente para DETECTAR y reportar discrepancias (errores de
      // clasificación humana en el Seguimiento), no para decidir el
      // estado de la cuenta.
      const ajuste = m.partidas.reduce((acc, p) => acc + SIGNO[p.tipo] * p.valorAbsoluto, 0);
      const saldoPendiente = Math.round((m.saldoLibro + ajuste - m.saldoExtracto) * 100) / 100;
      const estado = Math.abs(saldoPendiente) < 1 ? "CONCILIADA" : "CON_DIFERENCIAS";

      if (m.diferenciaOriginal != null && Math.abs(m.diferenciaOriginal - saldoPendiente) > 1) {
        discrepancias.push({
          cuentaId: m.cuentaId,
          periodo: m.periodo,
          diferenciaExcel: m.diferenciaOriginal,
          diferenciaCalculada: saldoPendiente,
        });
      }

      const partidasConciliatorias = m.partidas.map((p, idx) => ({
        id: `migrada-${idx}`,
        descripcion: p.descripcion,
        tipo: p.tipo,
        valorAbsoluto: p.valorAbsoluto,
        matched: false,
      }));

      const refPeriodo = db.doc(`cuentas/${m.cuentaId}/conciliaciones/${m.periodo}`);
      batch.set(refPeriodo, {
        estado,
        version: 0,
        saldoPendiente,
        saldoLibro: m.saldoLibro,
        saldoExtracto: m.saldoExtracto,
        migrada: true,
        actualizadoEn: Timestamp.now(),
      });

      const refVersion = db.doc(`cuentas/${m.cuentaId}/conciliaciones/${m.periodo}/versiones/0`);
      batch.set(refVersion, {
        cuentaId: m.cuentaId,
        periodo: m.periodo,
        saldoLibro: m.saldoLibro,
        saldoExtracto: m.saldoExtracto,
        intereses,
        cruzados: [],
        partidasCruzadas: [],
        crucesManuales: [],
        pendientesExtracto: [],
        pendientesLibro: [],
        partidasConciliatorias,
        saldoPendiente,
        estado,
        version: 0,
        creadoPor: "Migración automática — Seguimiento 2026",
        creadoEn: new Date().toISOString(),
        migrada: true,
      });
    }

    await batch.commit();
    cargados += lote.length;
    console.log(`  ${cargados}/${meses.length}…`);
  }

  const outPath = path.join(__dirname, "..", "out", "discrepancias-migracion.json");
  fs.writeFileSync(outPath, JSON.stringify(discrepancias, null, 2));

  console.log("Listo.");
  console.log(
    `${discrepancias.length} meses donde el Excel decía una diferencia distinta a la calculada — revisar out/discrepancias-migracion.json y ajustar manualmente en el sistema.`
  );
}

main().catch((err) => {
  console.error("\n❌ FALLÓ LA CARGA. Mensaje del error:\n");
  console.error(err.message ?? err);
  process.exit(1);
});
