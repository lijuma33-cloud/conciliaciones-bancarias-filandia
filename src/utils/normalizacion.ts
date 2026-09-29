// ══════════════════════════════════════════════════════════════════
// Normalización de valores — puerto directo de la lógica ya validada
// en los 3 aplicativos HTML legado (parseCOP), con soporte dual
// formato colombiano / americano.
// ══════════════════════════════════════════════════════════════════

/** Convierte "1.276.000,00" o "1,276,000.00" o número nativo a number. */
export function parseMonto(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  // SIGAM a veces exporta negativos con el signo "−" Unicode (U+2212,
  // MINUS SIGN) u otras variantes de guion en vez del guion ASCII normal
  // ("-", U+002D). parseFloat de JavaScript no reconoce esos caracteres
  // y devuelve NaN → el movimiento se perdía en silencio y quedaba en
  // $0 (bug detectado en el Libro SIGAM de Bancolombia; ya se había
  // corregido solo en el script de migración, ahora también aquí).
  s = s.replace(/[\u2010-\u2015\u2212]/g, "-");
  if (!s || s === "-") return 0;

  const neg = s.startsWith("-");
  s = s.replace(/^-/, "");

  let n = 0;
  const pareceAmericano =
    (/\.\d{2}$/.test(s) && s.includes(",") && !s.includes(".")) ||
    (/,\d{3}/.test(s) && /\.\d{1,2}$/.test(s));
  const pareceColombiano = /,\d{2}$/.test(s);

  if (pareceAmericano) {
    n = parseFloat(s.replace(/,/g, "")) || 0;
  } else if (pareceColombiano) {
    n = parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  } else {
    const limpio = s.replace(/[.,](?=\d{3}(?:[.,]|$))/g, "").replace(",", ".");
    n = parseFloat(limpio) || 0;
  }
  return neg ? -n : n;
}

export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(64 + ((n % 26) || 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function fmtCOP(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "0,00";
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Normaliza descripción para comparación tolerante (mayúsculas, espacios, tildes). */
export function normalizarDescripcion(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Parseo de fecha dd/mm (sin año, como llega en extractos) a comparable dentro de un período. */
export function diaMesA(fecha: string): { dia: number; mes: number } | null {
  const m = fecha.match(/^(\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return { dia: +m[1], mes: +m[2] };
}
