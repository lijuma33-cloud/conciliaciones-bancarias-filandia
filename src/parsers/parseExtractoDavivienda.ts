// ══════════════════════════════════════════════════════════════════
// Extracto Davivienda (.txt, ISO-8859-1/latin1) — formato columnar de
// ancho fijo. Validado contra 8371-4_Daviveinda_Extracto.txt.
//
//   Cuenta:          "DDDD DDDD DDDD"
//   Período:         "INFORME DEL MES: MES /AAAA"
//   Cliente:         línea siguiente a "Apreciado Cliente", sin "@"
//   Saldo Anterior / Nuevo Saldo:  "$N,NNN,NNN.NN" (formato americano)
//   Movimientos:     "  dd   mm   $valor+/-  doc   Descripción"
//     signo al FINAL del valor: + = abono, - = cargo
//     línea de continuación: siguiente línea sin fecha, muy indentada
//   Intereses:       descripción con "Interés"/"Ganancia Interés"
// ══════════════════════════════════════════════════════════════════
import { parseMonto } from "../utils/normalizacion";
import type { ExtractoNormalizado, Movimiento } from "../types/domain";

const RE_MOV = /^\s{10,20}(\d{2})\s+(\d{2})\s+\$\s*([\d,]+\.\d+)([-+])\s+(\d+)\s+(.*)/;

export function parseExtractoDavivienda(texto: string): ExtractoNormalizado {
  const lines = texto.split(/\r?\n/);
  let cuenta = "";
  let cliente = "";
  let periodo = "";
  let saldoAnterior = 0;
  let saldoActual = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    const mCta = l.match(/(\d{4}\s+\d{4}\s+\d{4})/);
    if (mCta && !cuenta) cuenta = mCta[1].replace(/\s+/g, "");

    const mPer = l.match(/INFORME DEL MES:\s*(.+)/);
    if (mPer) periodo = mPer[1].trim();

    if (/Apreciado Cliente/i.test(l)) {
      for (let j = i + 1; j < i + 5; j++) {
        const c = (lines[j] ?? "").trim();
        if (c && !c.includes("@")) {
          cliente = c;
          break;
        }
      }
    }

    if (/Saldo Anterior/i.test(l)) {
      const m = l.match(/\$\s*([\d,]+\.\d+)/);
      if (m) saldoAnterior = parseFloat(m[1].replace(/,/g, ""));
    }
    if (/Nuevo Saldo/i.test(l)) {
      const m = l.match(/\$\s*([\d,]+\.\d+)/);
      if (m) saldoActual = parseFloat(m[1].replace(/,/g, ""));
    }
  }

  const movimientos: Movimiento[] = [];
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? "").replace(/\r/, "");
    const m = l.match(RE_MOV);
    if (!m) continue;

    const [, dd, mm, valorStr, sig, , descRaw] = m;
    const valorAbs = parseFloat(valorStr.replace(/,/g, ""));
    const valor = sig === "+" ? valorAbs : -valorAbs;
    let desc = (descRaw ?? "").trim();

    const nextL = (lines[i + 1] ?? "").replace(/\r/, "");
    const esContinuacion =
      !RE_MOV.test(nextL) &&
      nextL.trim().length > 0 &&
      nextL.trim().length < 120 &&
      /^\s{30,}[A-Za-z]/.test(nextL) &&
      !/(Este producto|favor comuni|Defensor|Banco Davi|Recuerde)/i.test(nextL);
    if (esContinuacion) {
      desc = `${desc} ${nextL.trim()}`;
      i++;
    }

    movimientos.push({
      id: `E${idx++}`,
      fecha: `${dd}/${mm}`,
      descripcion: desc.trim(),
      valor,
      matched: false,
      origen: "extracto",
    });
  }

  const intereses = movimientos
    .filter((m) => /[Ii]nter[eé]s|[Gg]anancia [Ii]nter/i.test(m.descripcion))
    .reduce((s, m) => s + m.valor, 0);

  return {
    banco: "Davivienda",
    cliente,
    cuenta,
    periodo,
    saldoAnterior,
    saldoActual,
    intereses,
    movimientos,
  };
}

export function leerTxtLatin1(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (e) => res(e.target?.result as string);
    reader.onerror = rej;
    reader.readAsText(file, "latin1");
  });
}
