// ══════════════════════════════════════════════════════════════════
// Extracto Bancolombia (.xlsx). Antes se leía por número de fila fijo
// (validado solo contra 1 archivo de muestra) — se detectó con 5
// extractos reales distintos (cuenta 6900009573, enero-mayo 2026) que
// la fila real queda desplazada según el archivo (p. ej. una fila de
// más/de menos antes del bloque "Resumen:"), lo que hacía que cliente,
// saldo anterior/actual e intereses se leyeran de celdas vacías y
// dieran $0 o "" en silencio. Ahora se ubican las filas BUSCANDO sus
// títulos ("CLIENTE", "DESDE", "SALDO ANTERIOR", "FECHA") en vez de
// contar filas — así no se rompe si un mes trae una fila de más o de
// menos en el encabezado.
//   fila "CLIENTE" (header) → fila siguiente, col A = cliente
//   fila "DESDE" (header)   → fila siguiente, col B = hasta, col D = cuenta
//   fila "SALDO ANTERIOR" (header) → fila siguiente:
//     col A=saldo_anterior, B=abonos, C=cargos, D=saldo_actual, G=intereses
//   fila "FECHA" (header de movimientos) → filas siguientes hasta "FIN..."
//     o fila vacía: col A=fecha, B=descripción, C=sucursal, E=valor, F=saldo
// ══════════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";
import { parseMonto } from "../utils/normalizacion";
import type { ExtractoNormalizado, Movimiento } from "../types/domain";

function cell(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
  return ws[addr]?.v ?? null;
}

/** Fila (1-index) donde la columna A tiene exactamente ese texto, o null si no aparece. */
function buscarFila(ws: XLSX.WorkSheet, textoColA: string): number | null {
  const rango = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  for (let r = rango.s.r + 1; r <= rango.e.r + 1; r++) {
    const v = String(cell(ws, r, 1) ?? "").trim();
    if (v === textoColA) return r;
  }
  return null;
}

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function parseExtractoBancolombia(wb: XLSX.WorkBook): ExtractoNormalizado {
  const ws = wb.Sheets[wb.SheetNames[0]];

  const filaCliente = buscarFila(ws, "CLIENTE");
  const filaDesde = buscarFila(ws, "DESDE");
  const filaResumen = buscarFila(ws, "SALDO ANTERIOR");
  const filaMovs = buscarFila(ws, "FECHA");

  if (!filaCliente || !filaDesde || !filaResumen || !filaMovs) {
    throw new Error(
      `No se encontró alguno de los encabezados esperados en el extracto Bancolombia ` +
      `(CLIENTE: ${filaCliente ?? "no encontrado"}, DESDE: ${filaDesde ?? "no encontrado"}, ` +
      `SALDO ANTERIOR: ${filaResumen ?? "no encontrado"}, FECHA: ${filaMovs ?? "no encontrado"}). ` +
      `Revisar manualmente el formato del archivo.`
    );
  }

  const cliente = String(cell(ws, filaCliente + 1, 1) ?? "").trim();
  const cuenta = String(cell(ws, filaDesde + 1, 4) ?? "").trim();

  const hastaRaw = String(cell(ws, filaDesde + 1, 2) ?? "").trim();
  let periodo = "";
  const mHasta = hastaRaw.match(/(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (mHasta) periodo = `${MESES[+mHasta[2]] ?? mHasta[2]} ${mHasta[1]}`;

  const saldoAnterior = parseMonto(cell(ws, filaResumen + 1, 1));
  const saldoActual = parseMonto(cell(ws, filaResumen + 1, 4));
  const intereses = parseMonto(cell(ws, filaResumen + 1, 7));

  const movimientos: Movimiento[] = [];
  let idx = 0;
  for (let r = filaMovs + 1; r <= filaMovs + 2000; r++) {
    const fechaRaw = cell(ws, r, 1);
    const descRaw = cell(ws, r, 2);
    if (descRaw && /FIN/i.test(String(descRaw))) break;
    if (!fechaRaw && !descRaw) break; // fila vacía: fin de la tabla
    if (!fechaRaw) continue;
    const fechaStr = String(fechaRaw).trim();
    if (!/^\d/.test(fechaStr)) continue;

    const descripcion = String(descRaw ?? "").trim();
    const valor = parseMonto(cell(ws, r, 5));
    const saldo = parseMonto(cell(ws, r, 6));
    movimientos.push({
      id: `E${idx++}`,
      fecha: fechaStr,
      descripcion,
      valor,
      saldo,
      matched: false,
      origen: "extracto",
    });
  }

  return {
    banco: "Bancolombia",
    cliente,
    cuenta,
    periodo,
    saldoAnterior,
    saldoActual,
    intereses,
    movimientos,
  };
}
