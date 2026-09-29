// ══════════════════════════════════════════════════════════════════
// Extracto Banco Agrario (.docx nativo) — decisión tomada con el
// usuario: se usa el .docx del banco directamente, NO la conversión
// manual a .xlsx que se hacía antes (esa conversión era la causa
// del desalineamiento del parser legado).
//
// Estructura validada contra 2259_Extracto_Agrario.docx:
//   Tabla 1 (resumen), fila 1 = saldo_anterior/abonos/cargos vacíos o
//     con encabezado; en la práctica se lee así:
//       fila 1: ['', saldo_anterior, saldo_actual_o_similar]  <- ver nota
//       fila 2: [num_movs_abono, total_abonos, saldo_intermedio]
//       fila 3: [num_movs_cargo, total_cargos, saldo_final_o_intereses]
//   Tabla 2 (movimientos), cada fila = [día, descripción, sucursal, valor, saldo]
//
// NOTA: el resumen de Tabla 1 en la muestra real no traía etiquetas de
// columna (a diferencia de Bancolombia/Davivienda) — es una tabla de
// solo datos. Por eso el saldo_anterior/saldo_actual se toman de forma
// posicional y se validan por consistencia contra el primer y último
// saldo corrido de la Tabla 2 (ver validarConsistencia). Si un mes
// trae una fila adicional o el orden cambia, esa validación lo señala
// como advertencia en vez de fallar en silencio.
// ══════════════════════════════════════════════════════════════════
import * as mammoth from "mammoth/mammoth.browser";
import { parseMonto } from "../utils/normalizacion";
import type { ExtractoNormalizado, Movimiento } from "../types/domain";

interface AdvertenciaParseo {
  mensaje: string;
}

export interface ResultadoParseoAgrario {
  extracto: ExtractoNormalizado;
  advertencias: AdvertenciaParseo[];
}

export async function parseExtractoAgrario(file: File): Promise<ResultadoParseoAgrario> {
  const buffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer });

  const doc = new DOMParser().parseFromString(html, "text/html");
  const tablas = Array.from(doc.querySelectorAll("table"));
  const advertencias: AdvertenciaParseo[] = [];

  if (tablas.length < 2) {
    throw new Error(
      `Se esperaban 2 tablas en el .docx (resumen + movimientos), se encontraron ${tablas.length}.`
    );
  }

  const filasResumen = filasDeTabla(tablas[0]);

  // Tabla resumen: 3 filas de datos, sin encabezado propio en la muestra real.
  // fila0 = [_, saldo_anterior, X]; fila1 = [_, abonos, Y]; fila2 = [_, cargos, Z]
  const saldoAnterior = parseMonto(filasResumen[0]?.[1]);
  const totalAbonos = parseMonto(filasResumen[1]?.[1]);
  const totalCargos = parseMonto(filasResumen[2]?.[1]);

  // Movimientos: cuando el extracto tiene varias páginas, Word genera UNA
  // TABLA DE MOVIMIENTOS POR PÁGINA (no una sola tabla larga) — antes solo
  // se leía tablas[1] (la primera página) y se perdían todos los
  // movimientos de la página 2 en adelante. Ahora se recorren y concatenan
  // TODAS las tablas después de la de resumen.
  const tablasMovimientos = tablas.slice(1);
  if (tablasMovimientos.length > 1) {
    advertencias.push({
      mensaje: `Extracto de varias páginas: se combinaron ${tablasMovimientos.length} tablas de movimientos.`,
    });
  }

  const movimientos: Movimiento[] = [];
  let idx = 0;
  for (const tabla of tablasMovimientos) {
    const filasMov = filasDeTabla(tabla);
    for (const fila of filasMov) {
      if (fila.length < 5) continue;
      const [dia, descripcion, sucursal, valorStr, saldoStr] = fila;
      if (!dia || !descripcion) continue;
      // Cada página repite la fila de encabezado de columnas ("Fecha",
      // "Descripción", ...) al inicio de su tabla — se salta para no
      // registrarla como un movimiento falso.
      if (/^fecha$/i.test(dia.trim()) || /^descripci/i.test(descripcion.trim())) continue;
      movimientos.push({
        id: `E${idx++}`,
        fecha: dia.trim(),
        descripcion: `${descripcion.trim()}${sucursal?.trim() ? " · " + sucursal.trim() : ""}`,
        valor: parseMonto(valorStr),
        saldo: parseMonto(saldoStr),
        matched: false,
        origen: "extracto",
      });
    }
  }

  // Fallback: a veces una fila de movimiento queda FUERA de la tabla —
  // como párrafo suelto con el mismo patrón "día \t descripción \t
  // sucursal \t valor \t saldo" — porque una imagen de fondo (marca de
  // agua / logo de página) rompe la tabla justo en el salto de página.
  // Caso real detectado: el .docx de agosto de la cuenta 0021-5 perdía
  // así su ÚLTIMO movimiento (interés de $1.524,00), y por eso el saldo
  // final y el total de intereses del extracto no cuadraban aunque
  // todas las tablas se hubieran leído bien. Se busca este patrón en
  // TODOS los párrafos del documento y se agrega si no está ya incluido.
  const yaVistos = new Set(movimientos.map((m) => `${m.fecha}|${m.descripcion}|${m.valor}`));
  for (const p of Array.from(doc.querySelectorAll("p"))) {
    const texto = (p.textContent ?? "").trim();
    if (!texto.includes("\t")) continue;
    const partes = texto.split("\t").map((s) => s.trim()).filter((s) => s !== "");
    if (partes.length < 5) continue;
    const [dia, descripcion, sucursal, valorStr, saldoStr] = partes.slice(-5);
    if (!/^\d{1,2}$/.test(dia)) continue; // debe empezar con un día (01-31)
    if (!/^[\d.,-]+$/.test(valorStr) || !/^[\d.,-]+$/.test(saldoStr)) continue; // valor/saldo deben ser numéricos
    const descripcionCompleta = `${descripcion}${sucursal ? " · " + sucursal : ""}`;
    const valor = parseMonto(valorStr);
    const clave = `${dia}|${descripcionCompleta}|${valor}`;
    if (yaVistos.has(clave)) continue;
    yaVistos.add(clave);
    movimientos.push({
      id: `E${idx++}`,
      fecha: dia,
      descripcion: descripcionCompleta,
      valor,
      saldo: parseMonto(saldoStr),
      matched: false,
      origen: "extracto",
    });
    advertencias.push({
      mensaje: `Se encontró un movimiento fuera de la tabla de movimientos (probablemente por un salto de página) y se agregó: ${dia} — ${descripcionCompleta} — ${valorStr}.`,
    });
  }
  // Si hubo movimientos fuera de tabla, el orden por saldo corrido puede
  // haberse alterado — se reordenan por saldo ascendente si es coherente
  // con la secuencia esperada (saldo siempre creciente o decreciente de
  // forma monótona respecto al anterior no aplica aquí porque hay
  // abonos y cargos mezclados; se deja el orden de aparición y se confía
  // en la validación de consistencia de abajo para avisar si algo no
  // cuadra).

  const saldoActualPorSuma = saldoAnterior + totalAbonos - totalCargos;
  const saldoActualPorUltimoMov = movimientos.length
    ? movimientos[movimientos.length - 1].saldo!
    : saldoActualPorSuma;

  if (Math.abs(saldoActualPorSuma - saldoActualPorUltimoMov) > 1) {
    advertencias.push({
      mensaje:
        `Inconsistencia: saldo_anterior + abonos - cargos (${saldoActualPorSuma}) ` +
        `no coincide con el último saldo corrido de movimientos (${saldoActualPorUltimoMov}). ` +
        `Revisar manualmente la tabla de resumen del .docx.`,
    });
  }

  const intereses = movimientos
    .filter((m) => /INTERESES DE AHORROS/i.test(m.descripcion))
    .reduce((s, m) => s + m.valor, 0);

  return {
    extracto: {
      banco: "Agrario",
      cliente: "",
      cuenta: "",
      saldoAnterior,
      saldoActual: saldoActualPorUltimoMov,
      intereses,
      movimientos,
    },
    advertencias,
  };
}

function filasDeTabla(tabla: HTMLTableElement): string[][] {
  return Array.from(tabla.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td, th")).map((td) => td.textContent ?? "")
  );
}
