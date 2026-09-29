// ══════════════════════════════════════════════════════════════════
// Parser del "Libro" contable exportado desde SIGAM.
//
// FORMATO REAL (validado contra 2259_Libro_Agario.xlsx,
// 8371_Libro_Davivienda.xlsx, 0482_Libro_Bancolombia.xlsx —
// idéntico en los 3 bancos, NO el formato ancho S..AJ del legado):
//
//   Fila "encabezado de cuenta":
//     A = código contable de la cuenta bancaria
//     B = nombre/detalle de la cuenta
//     G = saldo anterior
//     K = saldo actual (= saldo anterior si aún no hay movimientos)
//     L = "D" (débito/deudora) o "H" (haber) — signo del saldo
//
//   Cada movimiento ocupa 2 filas:
//     Fila principal: A = NIT/cédula del tercero, B = nombre tercero,
//                      D = doc, E = fuente, F = comprobante,
//                      H = fecha (dd/mm/aaaa), I = débito, J = crédito,
//                      K = saldo corrido, L = "D"/"H"
//     Fila de detalle: solo B = descripción libre (o "SIN TERCERO"
//                      en la fila principal cuando no hay tercero,
//                      en cuyo caso la fila de detalle trae la
//                      descripción real).
//
// Una hoja puede contener VARIAS cuentas contables seguidas (varias
// filas "encabezado"); se procesan todas y se concatenan sus
// movimientos, tomando saldo_anterior de la primera y saldo_final de
// la última.
// ══════════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";
import { parseMonto } from "../utils/normalizacion";
import type { LibroNormalizado, Movimiento } from "../types/domain";

function cell(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
  return ws[addr]?.v ?? null;
}

const COL = { A: 1, B: 2, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12 };

function signo(indicador: unknown): 1 | -1 {
  return String(indicador ?? "D").trim().toUpperCase() === "H" ? -1 : 1;
}

export function parseLibroSigam(wb: XLSX.WorkBook): LibroNormalizado {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  const maxRow = ref ? ref.e.r + 1 : 2000;

  let saldoAnterior: number | null = null;
  let saldoFinal: number | null = null;
  let totalDebito = 0;
  let totalCredito = 0;
  const movimientos: Movimiento[] = [];
  let idx = 0;

  for (let r = 1; r <= maxRow; r++) {
    const a = cell(ws, r, COL.A);
    const g = cell(ws, r, COL.G);
    const h = cell(ws, r, COL.H);
    const i = cell(ws, r, COL.I);
    const j = cell(ws, r, COL.J);
    const k = cell(ws, r, COL.K);
    const l = cell(ws, r, COL.L);

    // Fila "encabezado de cuenta": A trae el código y G el saldo anterior
    // como NÚMERO. Se exige typeof "number" en vez de solo "no nulo"
    // porque la fila 1 (títulos de columna: "Cuenta", "Saldo Anterior"...)
    // también tiene texto no nulo en A y G, y sin este chequeo se
    // confundía con una cuenta real, dejando el saldo anterior en cero.
    const esEncabezado = a != null && typeof g === "number" && h == null;
    if (esEncabezado) {
      const sAnt = parseMonto(g) * signo(l);
      const sFin = k != null ? parseMonto(k) * signo(l) : sAnt;
      if (saldoAnterior === null) saldoAnterior = sAnt;
      saldoFinal = sFin; // se sobreescribe con cada nueva cuenta; queda el de la última
      continue;
    }

    // Fila de movimiento: tiene fecha en H.
    if (h != null) {
      const debito = parseMonto(i);
      const credito = parseMonto(j);
      const saldo = k != null ? parseMonto(k) * signo(l) : undefined;

      // El saldo final del libro es el ÚLTIMO saldo corrido real (columna
      // K de la última fila de movimiento), no el saldo del encabezado
      // inicial — antes se quedaba pegado en el saldo de apertura.
      if (saldo !== undefined) saldoFinal = saldo;

      let nombre = String(a === "0" || a == null ? "" : cell(ws, r, COL.B) ?? "").trim();
      nombre = String(cell(ws, r, COL.B) ?? "").trim();

      // Fila de detalle: la siguiente fila, sin fecha propia, con solo texto en B.
      let detalle = "";
      const nextH = cell(ws, r + 1, COL.H);
      const nextB = cell(ws, r + 1, COL.B);
      if (nextH == null && nextB) {
        const t = String(nextB).trim();
        if (t && !/^SIN\s+TERCERO$/i.test(t)) detalle = t;
      }

      let descFinal = nombre;
      if (/^SIN\s+TERCERO$/i.test(nombre)) {
        descFinal = detalle || nombre;
        detalle = "";
      }

      totalDebito += debito;
      totalCredito += credito;
      movimientos.push({
        id: `L${idx++}`,
        fecha: fechaAIso(String(cell(ws, r, COL.H))),
        descripcion: descFinal,
        detalle,
        valor: debito - credito,
        saldo,
        matched: false,
        origen: "libro",
      });
    }
  }

  return {
    saldoAnterior: saldoAnterior ?? 0,
    saldoFinal: saldoFinal ?? saldoAnterior ?? 0,
    totalDebito,
    totalCredito,
    movimientos,
  };
}

/** "24/08/2026" -> "2026-08-24". Si no matchea el patrón, devuelve el texto original. */
function fechaAIso(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
