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

  const textoPlano = Array.from(doc.querySelectorAll("p"))
    .map((p) => (p.textContent ?? "").replace(/\u00a0/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  const periodo = extraerPeriodo(textoPlano);

  let saldoAnterior = 0;
  let saldoActualResumen: number | null = null;
  let totalAbonos: number | null = null;
  let totalCargos: number | null = null;
  let resumenEncontrado = false;

  if (tablas.length >= 2 && pareceTablaResumen(filasDeTabla(tablas[0]))) {
    const filasResumen = filasDeTabla(tablas[0]);
    saldoAnterior = parseMonto(filasResumen[0]?.[1]);
    totalAbonos = parseMonto(filasResumen[1]?.[1]);
    totalCargos = parseMonto(filasResumen[2]?.[1]);
    resumenEncontrado = true;
  } else {
    const resumen = extraerResumenDesdeTexto(textoPlano);
    if (resumen) {
      saldoAnterior = resumen.saldoAnterior;
      saldoActualResumen = resumen.saldoActual;
      totalAbonos = resumen.totalAbonos;
      totalCargos = resumen.totalCargos;
      resumenEncontrado = true;
    }
  }

  if (!tablas.length) {
    throw new Error("No se encontraron tablas en el .docx.");
  }

  const tablasMovimientos = tablas.filter((tabla) => {
    const filas = filasDeTabla(tabla);
    return filas.some((fila) => esFilaMovimiento(fila));
  });

  if (!tablasMovimientos.length) {
    throw new Error(
      "No se encontró una tabla de movimientos válida en el .docx. " +
      "Se requiere una tabla con día, descripción, oficina/sucursal, valor y saldo."
    );
  }

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
      if (!esFilaMovimiento(fila)) continue;

      const [dia, descripcion, sucursal, valorStr, saldoStr] = fila;
      const valorAbsoluto = Math.abs(parseMonto(valorStr));
      const saldo = parseMonto(saldoStr);

      movimientos.push({
        id: `E${idx++}`,
        fecha: dia.trim(),
        descripcion: `${descripcion.trim()}${
          sucursal?.trim() ? " · " + sucursal.trim() : ""
        }`,
        valor: valorAbsoluto,
        saldo,
        matched: false,
        origen: "extracto",
      });
    }
  }

  const yaVistos = new Set(
    movimientos.map(
      (m) => `${m.fecha}|${m.descripcion}|${Math.abs(m.valor)}|${m.saldo}`
    )
  );

  for (const p of Array.from(doc.querySelectorAll("p"))) {
    const texto = (p.textContent ?? "").trim();
    if (!texto.includes("\t")) continue;

    const partes = texto
      .split("\t")
      .map((s) => s.trim())
      .filter((s) => s !== "");

    if (partes.length < 5) continue;

    const [dia, descripcion, sucursal, valorStr, saldoStr] = partes.slice(-5);

    if (!/^\d{1,2}$/.test(dia)) continue;
    if (!/^[\d.,-]+$/.test(valorStr)) continue;
    if (!/^[\d.,-]+$/.test(saldoStr)) continue;

    const descripcionCompleta = `${descripcion}${sucursal ? " · " + sucursal : ""}`;
    const valor = Math.abs(parseMonto(valorStr));
    const saldo = parseMonto(saldoStr);
    const clave = `${dia}|${descripcionCompleta}|${valor}|${saldo}`;

    if (yaVistos.has(clave)) continue;

    yaVistos.add(clave);

    movimientos.push({
      id: `E${idx++}`,
      fecha: dia,
      descripcion: descripcionCompleta,
      valor,
      saldo,
      matched: false,
      origen: "extracto",
    });

    advertencias.push({
      mensaje: `Se encontró un movimiento fuera de la tabla y se agregó: ${dia} — ${descripcionCompleta} — ${valorStr}.`,
    });
  }

  if (!movimientos.length) {
    throw new Error("La tabla de movimientos no contiene filas válidas.");
  }

  let saldoAnteriorCalculado = saldoAnterior;
  let anterior = saldoAnteriorCalculado;

  for (const movimiento of movimientos) {
    const saldo = movimiento.saldo ?? 0;
    const delta = saldo - anterior;
    const valorAbsoluto = Math.abs(movimiento.valor);

    if (Math.abs(delta) > 0.005) {
      movimiento.valor = Math.abs(delta);
      if (delta < 0) movimiento.valor *= -1;
    } else {
      movimiento.valor = valorAbsoluto;
    }

    anterior = saldo;
  }

  const saldoValido = resumenEncontrado && Number.isFinite(saldoAnterior) && saldoAnterior !== 0;
  if (!saldoValido) {
    const primero = movimientos[0];
    saldoAnteriorCalculado = (primero.saldo ?? 0) - primero.valor;
    saldoAnterior = saldoAnteriorCalculado;
  }

  const saldoActualPorUltimoMov =
    movimientos[movimientos.length - 1].saldo ?? saldoAnterior;

  const sumaMovimientos = movimientos.reduce((s, m) => s + m.valor, 0);
  const saldoCalculado = saldoAnterior + sumaMovimientos;
  const diferenciaCuadre = saldoCalculado - saldoActualPorUltimoMov;

  if (Math.abs(diferenciaCuadre) > 1) {
    advertencias.push({
      mensaje:
        `Alerta de cuadre: saldo anterior (${saldoAnterior}) + suma de movimientos ` +
        `(${sumaMovimientos}) = ${saldoCalculado}, pero el último saldo del ` +
        `extracto es ${saldoActualPorUltimoMov}. Diferencia: ${diferenciaCuadre}. ` +
        "El extracto NO se descarta; revise manualmente la diferencia.",
    });
  }

  if (
    saldoActualResumen !== null &&
    Math.abs(saldoActualResumen - saldoActualPorUltimoMov) > 1
  ) {
    advertencias.push({
      mensaje:
        `El saldo actual indicado en el resumen (${saldoActualResumen}) no coincide ` +
        `con el último saldo de movimientos (${saldoActualPorUltimoMov}).`,
    });
  }

  const abonosCalculados = movimientos
    .filter((m) => m.valor > 0)
    .reduce((s, m) => s + m.valor, 0);

  const cargosCalculados = movimientos
    .filter((m) => m.valor < 0)
    .reduce((s, m) => s + Math.abs(m.valor), 0);

  if (totalAbonos === null) totalAbonos = abonosCalculados;
  if (totalCargos === null) totalCargos = cargosCalculados;

  if (Math.abs(totalAbonos - abonosCalculados) > 1) {
    advertencias.push({
      mensaje:
        `El total de abonos del resumen (${totalAbonos}) difiere de la suma ` +
        `de movimientos (${abonosCalculados}).`,
    });
  }

  if (Math.abs(totalCargos - cargosCalculados) > 1) {
    advertencias.push({
      mensaje:
        `El total de cargos del resumen (${totalCargos}) difiere de la suma ` +
        `de movimientos (${cargosCalculados}).`,
    });
  }

  const intereses = movimientos
    .filter((m) => {
      const descripcion = normalizarTexto(m.descripcion);

      const esInteres =
        /\bINTERES(?:ES)?\b/.test(descripcion) &&
        !/SALDO\s+PROMEDIO/.test(descripcion);

      return esInteres;
    })
    .reduce((total, m) => total + Math.abs(m.valor), 0);

  return {
    extracto: {
      banco: "Agrario",
      cliente: "",
      cuenta: "",
      periodo,
      saldoAnterior,
      saldoActual: saldoActualPorUltimoMov,
      intereses,
      movimientos,
    },
    advertencias,
  };
}

function normalizarTexto(texto: string): string {
  if (!texto) return "";
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function filasDeTabla(tabla: HTMLTableElement): string[][] {
  return Array.from(tabla.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td, th")).map(
      (td) => td.textContent ?? ""
    )
  );
}

function pareceTablaResumen(filas: string[][]): boolean {
  return filas.length >= 3 && !filas.some((fila) => esFilaMovimiento(fila));
}

function esFilaMovimiento(fila: string[]): boolean {
  if (fila.length < 5) return false;

  const dia = fila[0]?.trim() ?? "";
  const descripcion = fila[1]?.trim() ?? "";
  const valor = fila[3]?.trim() ?? "";
  const saldo = fila[4]?.trim() ?? "";

  if (!/^\d{1,2}$/.test(dia)) return false;
  if (!descripcion) return false;
  if (!/^[\d.,-]+$/.test(valor)) return false;
  if (!/^[\d.,-]+$/.test(saldo)) return false;

  return true;
}

function extraerResumenDesdeTexto(texto: string): {
  saldoAnterior: number;
  saldoActual: number | null;
  totalAbonos: number | null;
  totalCargos: number | null;
} | null {
  const t = texto.replace(/\s+/g, " ").trim();

  const saldoAnteriorMatch = t.match(
    /SALDO\s*ANTERIOR\s*([\d.,-]+)/i
  );

  const saldoActualMatch = t.match(
    /SALDO\s*ACTUAL\s*([\d.,-]+)/i
  );

  if (!saldoAnteriorMatch && !saldoActualMatch) return null;

  const saldoAnterior = saldoAnteriorMatch
    ? parseMonto(saldoAnteriorMatch[1])
    : 0;

  const saldoActual = saldoActualMatch
    ? parseMonto(saldoActualMatch[1])
    : null;

  let totalAbonos: number | null = null;
  let totalCargos: number | null = null;

  const resumenMatch = t.match(
    /TOTAL\s*ABONOS\s*\d*\s*TOTAL\s*CARGOS\s*\d*\s*([\d.,-]+)\s+([\d.,-]+)/i
  );

  if (resumenMatch) {
    totalAbonos = parseMonto(resumenMatch[1]);
    totalCargos = parseMonto(resumenMatch[2]);
  } else {
    const desdeAbonos =
      t.match(/TOTAL\s*ABONOS([\s\S]*)/i)?.[1] ?? "";

    const importes =
      desdeAbonos.match(/\d[\d.,]*,\d{2}/g) ?? [];

    if (importes.length >= 2) {
      totalAbonos = parseMonto(importes[0]);
      totalCargos = parseMonto(importes[1]);
    }
  }

  return {
    saldoAnterior,
    saldoActual,
    totalAbonos,
    totalCargos,
  };
}

function extraerPeriodo(texto: string): string | undefined {
  const meses: Record<string, string> = {
    ENERO: "01",
    FEBRERO: "02",
    MARZO: "03",
    ABRIL: "04",
    MAYO: "05",
    JUNIO: "06",
    JULIO: "07",
    AGOSTO: "08",
    SEPTIEMBRE: "09",
    SETIEMBRE: "09",
    OCTUBRE: "10",
    NOVIEMBRE: "11",
    DICIEMBRE: "12",
  };

  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const match = normalizado.match(
    /\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*(20\d{2})\b/
  );

  if (!match) return undefined;

  return `${match[2]}-${meses[match[1]]}`;
}