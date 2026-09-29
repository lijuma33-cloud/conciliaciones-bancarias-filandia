// ══════════════════════════════════════════════════════════════════
// Capa de acceso a Firestore. Toda escritura de conciliación crea una
// nueva versión en vez de sobrescribir (sección 13 del proyecto: "NO
// quiero que una nueva conciliación destruya silenciosamente la
// anterior").
// ══════════════════════════════════════════════════════════════════
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "./config";
import type { Cuenta, ResultadoConciliacion, Usuario } from "../types/domain";

export async function listarCuentas(): Promise<Cuenta[]> {
  const snap = await getDocs(collection(db, "cuentas"));
  return snap.docs.map((d) => d.data() as Cuenta);
}

export async function obtenerCuenta(cuentaId: string): Promise<Cuenta | null> {
  const snap = await getDoc(doc(db, "cuentas", cuentaId));
  return snap.exists() ? (snap.data() as Cuenta) : null;
}

export async function guardarCuenta(cuenta: Cuenta): Promise<void> {
  await setDoc(doc(db, "cuentas", cuenta.id), cuenta);
}

/** Última versión guardada de la conciliación de un período (o null si no existe). */
export async function obtenerUltimaConciliacion(
  cuentaId: string,
  periodo: string
): Promise<ResultadoConciliacion | null> {
  const ref = collection(db, "cuentas", cuentaId, "conciliaciones", periodo, "versiones");
  const q = query(ref, orderBy("version", "desc"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data() as ResultadoConciliacion;
}

/** Guarda una NUEVA versión — nunca sobrescribe una existente. */
export async function guardarNuevaVersionConciliacion(
  resultado: ResultadoConciliacion
): Promise<void> {
  const ref = collection(
    db,
    "cuentas",
    resultado.cuentaId,
    "conciliaciones",
    resultado.periodo,
    "versiones"
  );
  await addDoc(ref, { ...resultado, guardadoEn: serverTimestamp() });

  // Puntero de "estado actual" del período, para listados rápidos del dashboard.
  await setDoc(
    doc(db, "cuentas", resultado.cuentaId, "conciliaciones", resultado.periodo),
    {
      estado: resultado.estado,
      version: resultado.version,
      saldoPendiente: resultado.saldoPendiente,
      saldoLibro: resultado.saldoLibro,
      saldoExtracto: resultado.saldoExtracto,
      actualizadoEn: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function historicoDeCuenta(cuentaId: string) {
  const snap = await getDocs(collection(db, "cuentas", cuentaId, "conciliaciones"));
  return snap.docs.map((d) => ({ periodo: d.id, ...d.data() }));
}

/** "2026-08" -> "2026-07"; "2026-01" -> "2025-12". */
export function periodoAnterior(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export async function obtenerUsuario(uid: string): Promise<Usuario | null> {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? (snap.data() as Usuario) : null;
}

export async function listarUsuarios(): Promise<Usuario[]> {
  const snap = await getDocs(collection(db, "usuarios"));
  return snap.docs.map((d) => d.data() as Usuario);
}

export async function guardarUsuario(usuario: Usuario): Promise<void> {
  await setDoc(doc(db, "usuarios", usuario.uid), usuario);
}

/** Cuentas visibles para un usuario: cualquier usuario activo ve todas. */
export async function cuentasVisiblesPara(_usuario: Usuario): Promise<Cuenta[]> {
  return listarCuentas();
}

export async function registrarTrazabilidad(evento: {
  uid: string;
  accion: string;
  cuentaId?: string;
  periodo?: string;
  detalle?: string;
}) {
  await addDoc(collection(db, "trazabilidad"), { ...evento, fecha: serverTimestamp() });
}

/**
 * Borra POR COMPLETO una conciliación: todas sus versiones guardadas y el
 * puntero de estado actual. Solo lo puede hacer un administrador (regla
 * de Firestore) — es la única forma de deshacer un montaje/prueba
 * equivocada, ya que normalmente las versiones son inmutables. Se
 * registra en /trazabilidad quién borró qué y cuándo, aunque el dato en
 * sí ya no quede.
 */
export async function borrarConciliacion(cuentaId: string, periodo: string): Promise<void> {
  const refVersiones = collection(db, "cuentas", cuentaId, "conciliaciones", periodo, "versiones");
  const snap = await getDocs(refVersiones);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "cuentas", cuentaId, "conciliaciones", periodo));
}

/**
 * Borra una cuenta bancaria por completo: todas sus conciliaciones (cada
 * período), todas las versiones de cada una, y la ficha de la cuenta.
 * Firestore no borra subcolecciones solo al borrar el documento padre,
 * así que hay que recorrerlas a mano. Solo administrador (regla de
 * Firestore). Irreversible — se recomienda confirmar antes de llamarla.
 */
export async function borrarCuenta(cuentaId: string): Promise<void> {
  const refConciliaciones = collection(db, "cuentas", cuentaId, "conciliaciones");
  const periodos = await getDocs(refConciliaciones);
  await Promise.all(
    periodos.docs.map(async (periodoDoc) => {
      const refVersiones = collection(db, "cuentas", cuentaId, "conciliaciones", periodoDoc.id, "versiones");
      const versiones = await getDocs(refVersiones);
      await Promise.all(versiones.docs.map((v) => deleteDoc(v.ref)));
      await deleteDoc(periodoDoc.ref);
    })
  );
  await deleteDoc(doc(db, "cuentas", cuentaId));
}
