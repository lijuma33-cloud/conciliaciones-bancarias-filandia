// ══════════════════════════════════════════════════════════════════
// Migra Seguimeinto_Conciliaciones_Bancarias_2026.xlsx a un seed de
// Firestore: 68 cuentas (hoja "Índice") + partidas conciliatorias
// históricas de cierre (una hoja por cuenta) como saldo inicial de
// enero 2026 en el nuevo sistema.
//
// IMPORTANTE — la hoja de cada cuenta NO sigue un layout estricto
// (se construyó a mano mes a mes): la columna donde aparece el valor
// de "SALDO SEGÚN LIBRO"/"SALDO SEGÚN EXTRACTO" varía de una hoja a
// otra (columna D en una, columna E en otra, etc). Por eso este
// script busca las etiquetas por texto y toma el primer valor
// numérico a la derecha, en vez de asumir una columna fija.
//
// SALIDA:
//   out/cuentas.json              -> 68 documentos para /cuentas/{id}
//   out/historico-inicial.json    -> partidas anteriores por cuenta,
//                                     para precargar la conciliación
//                                     de enero 2026
//   out/advertencias.json         -> cuentas donde no se pudo leer
//                                     saldo_libro/saldo_extracto o
//                                     las partidas con certeza; ESTAS
//                                     REQUIEREN REVISIÓN MANUAL antes
//                                     de dar por buena la migración.
//
// Uso:  npx ts-node scripts/migrar-seguimiento.ts <ruta_seguimiento.xlsx>
// ══════════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

interface CuentaSeed {
  id: string;
  item: number;
  banco: string;
  enlace: string;
  tipoRecurso: string;
  formatoExtracto: "docx" | "xlsx" | "txt";
  reglasMatching: { toleranciaPesos: number; permitirAgrupacion1aN: boolean; normalizarDescripcion: boolean };
}

interface PartidaSeed {
  cuentaId: string;
  descripcion: string;
  tipo: "CLNB" | "CBNL" | "PLNB" | "PBNL" | "REND";
  valorAbsoluto: number;
}

interface HistoricoSeed {
  cuentaId: string;
  periodoCierre: string; // "2025-12"
  saldoLibro: number | null;
  saldoExtracto: number | null;
  /** Diferencia ya calculada y certificada en el propio Excel (fila "DIFERENCIA"). */
  diferenciaOriginal: number | null;
  partidas: PartidaSeed[];
}

const REGLAS_DEFECTO = { toleranciaPesos: 1, permitirAgrupacion1aN: true, normalizarDescripcion: false };

function formatoPorBanco(banco: string): "docx" | "xlsx" | "txt" {
  const b = banco.trim().toLowerCase();
  if (b.startsWith("agrario")) return "docx";
  if (b.startsWith("davivienda")) return "txt";
  return "xlsx"; // Bancolombia y cualquier otro por defecto
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Categorías del formato estándar de reporte — reconocimiento TOLERANTE
// a variaciones reales encontradas en las 63 hojas (singular/plural,
// mayúsculas/minúsculas, "Consignacion" sin "es", etc.). Antes se
// comparaba el texto exacto y una sola hoja con "Consignacion en bancos
// y no libros" (sin "es") hizo que $53.793.773 se perdieran en
// silencio — con regex esto ya no puede volver a pasar.
function tipoDeCategoria(etiqueta: string): PartidaSeed["tipo"] | null {
  const t = etiqueta
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (/^rendimientos?\s+financieros?$/.test(t)) return "REND";
  if (/^consignacion(es)?\s+en\s+libros?\s+y\s+no\s+bancos?$/.test(t)) return "CLNB";
  if (/^consignacion(es)?\s+en\s+bancos?\s+y\s+no\s+libros?$/.test(t)) return "CBNL";
  if (/^pagos?\s+en\s+libros?\s+y\s+no\s+bancos?$/.test(t)) return "PLNB";
  if (/^pagos?\s+en\s+bancos?\s+y\s+no\s+libros?$/.test(t)) return "PBNL";
  // Retención en la fuente que el banco ya descontó pero aún no está
  // registrada en el libro (visto en la cuenta Fiduexcedente): mismo
  // efecto que un pago en bancos y no libros.
  if (/^retenci[oó]n\s+en\s+la\s+fuente$/.test(t)) return "PBNL";
  return null;
}
// Red de seguridad: si una fila "suena" a categoría (contiene estas
// palabras clave) pero no calzó con ningún patrón de arriba, NUNCA se
// descarta en silencio — se marca como advertencia explícita.
function pareceCategoriaNoReconocida(etiqueta: string): boolean {
  const t = etiqueta.toLowerCase();
  return /consignacion|^pago|rendimiento|retenci/.test(t);
}

const FIN_DE_BLOQUE = /^sumas iguales/i;
const ANIO_SEGUIMIENTO = 2026;
const MESES_TXT = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

/** Solo guiones/espacios (p. ej. " -", "−", "—"): en el Excel significa "cero". */
function esSoloGuion(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "" && /^[\s\-\u2010-\u2015\u2212]+$/.test(v);
}

function comoMonto(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /\d/.test(v)) {
    // El Excel usa a veces el signo "−" Unicode (U+2212) u otras variantes
    // de guion en vez del "-" normal — parseFloat devolvería NaN y la
    // partida se perdería en silencio. Se normaliza antes de parsear.
    const normalizado = v.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[$\s]/g, "");
    // Formato mixto mal digitado, p. ej. "35.708.571.03" (puntos de miles
    // y un punto decimal): si termina en .NN tras grupos de miles, el
    // último punto es el decimal.
    if (/^-?\d{1,3}(\.\d{3})+\.\d{1,2}$/.test(normalizado)) {
      const i = normalizado.lastIndexOf(".");
      const n = parseFloat(normalizado.slice(0, i).replace(/\./g, "") + "." + normalizado.slice(i + 1));
      return isNaN(n) ? null : n;
    }
    const n = parseFloat(normalizado.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }
  return null;
}

/** Primer monto numérico a la derecha de la columna de etiqueta (ignora "—" y celdas vacías). */
function primerMontoDerecha(row: unknown[], colEtiqueta: number): number | null {
  for (let c = colEtiqueta + 1; c < row.length; c++) {
    const m = comoMonto(row[c]);
    if (m != null) return m;
  }
  return null;
}

/**
 * Los dos primeros valores a la derecha de la etiqueta en la fila
 * "Saldo del período" (libros, extracto). Aquí un guion suelto (" -")
 * cuenta como 0, y NO se asume una columna fija: en algunas hojas el
 * extracto está en D y en otras en E.
 */
function dosSaldosDerecha(row: unknown[], colEtiqueta: number): [number | null, number | null] {
  const vals: (number | null)[] = [];
  for (let c = colEtiqueta + 1; c < row.length && vals.length < 2; c++) {
    const v = row[c];
    if (v == null || (typeof v === "string" && v.trim() === "")) continue;
    if (esSoloGuion(v)) { vals.push(0); continue; }
    const m = comoMonto(v);
    if (m != null) vals.push(m);
  }
  return [vals[0] ?? null, vals[1] ?? null];
}

/** Mes (1-12) que nombra un texto; null si no lo hay o si trae un año distinto al del seguimiento (dato poco confiable). */
function mesDeTexto(t: string): number | null {
  const s = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const m = s.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/);
  if (!m) return null;
  const y = s.match(/\b(19|20)\d{2}\b/);
  if (y && Number(y[0]) !== ANIO_SEGUIMIENTO) return null;
  return MESES_TXT.indexOf(m[1] === "setiembre" ? "septiembre" : m[1]) + 1;
}

interface BloqueLeido {
  h: HistoricoSeed;
  mesDetectado: number | null;
  /** Bloque de un año distinto al del seguimiento (p. ej. el saldo inicial a dic-2025): no es un mes conciliado. */
  esAnterior: boolean;
  fila: number;
  formato: "nuevo" | "antiguo";
}

/** Busca el período de un bloque: "Período: …" en las filas de arriba; si no, el pie "Sistema de Conciliación Bancaria …" de abajo. */
function detectarMes(filas: unknown[][], idxAnchor: number, limiteAbajo: number): number | null {
  for (let i = idxAnchor - 1; i >= Math.max(0, idxAnchor - 10); i--) {
    const cel = filas[i].find((c) => typeof c === "string" && /per[ií]odo\s*:/i.test(c));
    if (typeof cel === "string") {
      const m = mesDeTexto(cel);
      if (m != null) return m;
      break;
    }
  }
  for (let i = idxAnchor; i < Math.min(filas.length, limiteAbajo, idxAnchor + 45); i++) {
    const cel = filas[i].find((c) => typeof c === "string" && /Conciliaci[oó]n Banca/i.test(c) && /(19|20)\d{2}/.test(c));
    if (typeof cel === "string") {
      const m = mesDeTexto(cel);
      if (m != null) return m;
      break;
    }
  }
  return null;
}


interface CategoriaLeida {
  nombre: string;
  tipo: PartidaSeed["tipo"];
  total: number;        // total digitado en la fila de la categoría
  detalleSuma: number;  // suma (con signo) de las líneas de detalle
  detalle: PartidaSeed[];
}
const SIGNO_TIPO: Record<PartidaSeed["tipo"], number> = { REND: 1, CBNL: 1, PLNB: 1, CLNB: -1, PBNL: -1 };

/**
 * Convierte las categorías leídas en partidas. Por defecto se usa el
 * DETALLE cuando suma lo mismo que el total, y el TOTAL (sin desglose)
 * cuando no coinciden. Si con esa elección el mes no cuadra, se prueba
 * cambiar, categoría por categoría, entre "total" y "detalle" y se toma
 * la combinación que sí cuadra a $0 — así se absorben errores de
 * digitación del Excel (p. ej. un total de "45.2" cuyo detalle suma
 * 45.200) sin tocar los meses que ya cuadraban.
 */
function armarPartidas(
  cuentaId: string,
  cats: CategoriaLeida[],
  saldoLibro: number | null,
  saldoExtracto: number | null,
  ubic: string,
  advertencias: string[],
  avisos: string[]
): PartidaSeed[] {
  const TOL = 2;
  const desajustadas = cats.map((c, i) => (Math.abs(c.detalleSuma - c.total) > TOL ? i : -1)).filter((i) => i >= 0);
  const usarDetalle = cats.map((c) => Math.abs(c.detalleSuma - c.total) <= TOL);

  const construir = (uso: boolean[]): PartidaSeed[] => {
    const out: PartidaSeed[] = [];
    cats.forEach((c, i) => {
      if (uso[i]) out.push(...c.detalle);
      else if (Math.abs(c.total) > TOL) {
        out.push({ cuentaId, descripcion: `${c.nombre} (total de categoría, sin desglose confiable — revisar hoja original)`, tipo: c.tipo, valorAbsoluto: Math.abs(c.total) });
      }
    });
    return out;
  };
  const dif = (ps: PartidaSeed[]) =>
    saldoLibro == null || saldoExtracto == null ? 0 : saldoLibro + ps.reduce((a, p) => a + SIGNO_TIPO[p.tipo] * p.valorAbsoluto, 0) - saldoExtracto;

  let elegido = construir(usarDetalle);
  let usoFinal = usarDetalle;

  if (saldoLibro != null && saldoExtracto != null && Math.abs(dif(elegido)) > 1 && desajustadas.length > 0 && desajustadas.length <= 10) {
    let mejor: { uso: boolean[]; ps: PartidaSeed[]; cambios: number } | null = null;
    const n = desajustadas.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const uso = [...usarDetalle];
      let cambios = 0;
      for (let b = 0; b < n; b++) if (mask & (1 << b)) { uso[desajustadas[b]] = !uso[desajustadas[b]]; cambios++; }
      const ps = construir(uso);
      if (Math.abs(dif(ps)) <= 1 && (!mejor || cambios < mejor.cambios)) mejor = { uso, ps, cambios };
    }
    if (mejor) {
      const cambiadas = desajustadas.filter((i) => mejor!.uso[i] !== usarDetalle[i]).map((i) => `"${cats[i].nombre}" (total digitado ${cats[i].total}, detalle suma ${cats[i].detalleSuma})`);
      advertencias.push(`[${cuentaId}] ${ubic}: el total digitado no coincidía con el detalle en ${cambiadas.join("; ")}. Se usó la alternativa con la que el mes cuadra a $0. Confirmar contra la hoja.`);
      elegido = mejor.ps;
      usoFinal = mejor.uso;
    }
  }
  cats.forEach((c, i) => {
    if (!usoFinal[i] && Math.abs(c.total) > TOL && Math.abs(c.detalleSuma - c.total) > TOL) {
      avisos.push(`[${cuentaId}] ${ubic}: categoría "${c.nombre}" total ${c.total} migrado sin desglose (detalle listado: ${c.detalleSuma}).`);
    }
  });
  return elegido;
}

/** Formato NUEVO: cada mes es un bloque anclado en la fila "Saldo del período". */
function parsearBloquesNuevos(
  filas: unknown[][],
  cuentaId: string,
  advertencias: string[],
  avisos: string[]
): BloqueLeido[] {
  const anclas: { i: number; col: number }[] = [];
  for (let i = 0; i < filas.length; i++) {
    for (let c = 0; c < Math.min(4, filas[i].length); c++) {
      if (typeof filas[i][c] === "string" && /^saldo del per[ií]odo$/i.test((filas[i][c] as string).trim())) {
        anclas.push({ i, col: c });
        break;
      }
    }
  }
  return anclas.map((a, k) => {
    const limite = k + 1 < anclas.length ? anclas[k + 1].i : filas.length;
    return parsearUnBloqueNuevo(filas, cuentaId, a.i, a.col, limite, advertencias, avisos);
  });
}

function parsearUnBloqueNuevo(
  filas: unknown[][],
  cuentaId: string,
  idxAnchor: number,
  col: number,
  limite: number,
  advertencias: string[],
  avisos: string[]
): BloqueLeido {
  const h: HistoricoSeed = { cuentaId, periodoCierre: "", saldoLibro: null, saldoExtracto: null, diferenciaOriginal: null, partidas: [] };
  const [sl, se] = dosSaldosDerecha(filas[idxAnchor], col);
  h.saldoLibro = sl;
  h.saldoExtracto = se;

  const cats: CategoriaLeida[] = [];
  let actual: CategoriaLeida | null = null;

  for (let i = idxAnchor + 1; i < limite; i++) {
    const row = filas[i];
    const etiqueta = typeof row[col] === "string" ? (row[col] as string).trim() : "";
    if (!etiqueta) continue;

    if (/^diferencia/i.test(etiqueta)) {
      // Diferencia ya calculada y certificada en el propio Excel (fila
      // DIFERENCIA, última del bloque). Se guarda para compararla luego
      // con la fórmula real, nunca se confía ciegamente en ella.
      h.diferenciaOriginal = primerMontoDerecha(row, col);
      break;
    }
    if (FIN_DE_BLOQUE.test(etiqueta)) { actual = null; continue; }
    if (/^partidas conciliatorias$/i.test(etiqueta)) continue;

    const tipoDetectado = tipoDeCategoria(etiqueta);
    if (tipoDetectado) {
      actual = { nombre: etiqueta, tipo: tipoDetectado, total: primerMontoDerecha(row, col) ?? 0, detalleSuma: 0, detalle: [] };
      cats.push(actual);
      continue;
    }
    if (actual) {
      const valor = primerMontoDerecha(row, col);
      if (valor != null) {
        actual.detalleSuma += valor;
        actual.detalle.push({ cuentaId, descripcion: etiqueta, tipo: actual.tipo, valorAbsoluto: Math.abs(valor) });
      }
    } else if (pareceCategoriaNoReconocida(etiqueta)) {
      advertencias.push(
        `[${cuentaId}] Fila "${etiqueta}" (fila ${i + 1}) parece una categoría de partida pero no calzó con ninguna reconocida — revisar manualmente. Valor: ${primerMontoDerecha(row, col) ?? "no numérico"}.`
      );
    }
  }
  h.partidas = armarPartidas(cuentaId, cats, h.saldoLibro, h.saldoExtracto, `Bloque de la fila ${idxAnchor + 1}`, advertencias, avisos);

  return { h, mesDetectado: detectarMes(filas, idxAnchor, limite), esAnterior: false, fila: idxAnchor + 1, formato: "nuevo" };
}

// Categorías del formato ANTIGUO (hoja de trabajo mes a mes, previa al
// formato estándar): etiquetas más libres — "Consignaciones en bancos no
// libros" (sin "y"), "TR y CE pendientes de cobro", "Gastos financieros".
function tipoDeCategoriaAntigua(etiqueta: string): PartidaSeed["tipo"] | null {
  const t = etiqueta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/^rendimientos?\s+fin/.test(t)) return "REND";
  if (/^consignaci\w*\s+en\s+bancos?\s+(y\s+)?no\s+(en\s+)?libros?/.test(t)) return "CBNL";
  if (/^consignaci\w*\s+en\s+libros?\s+(y\s+)?no\s+(en\s+)?bancos?/.test(t)) return "CLNB";
  if (/^(tr|traslados?)\s+y\s+ce\b/.test(t) || /^pagos?\s+(en|de)\s+libros?(\s+(y\s+)?no\s+(en\s+)?bancos?)?\s*$/.test(t)) return "PLNB";
  if (/^gastos?\s+fin/.test(t) || /^pagos?\s+(en|de)\s+bancos?(\s+(y\s+)?no\s+(en\s+)?libros?)?\s*$/.test(t)) return "PBNL";
  if (/^retenci[oó]n\s+en\s+la\s+fuente$/.test(t)) return "PBNL";
  return null;
}

/** Formato ANTIGUO: bloque anclado en una fila "SALDO SEGÚN LIBRO(S)" sin encabezado CONCEPTO. */
function parsearBloquesAntiguos(
  filas: unknown[][],
  cuentaId: string,
  advertencias: string[],
  avisos: string[]
): BloqueLeido[] {
  const anclas: { i: number; col: number }[] = [];
  for (let i = 0; i < filas.length; i++) {
    const row = filas[i];
    if (row.some((c) => typeof c === "string" && /^\s*C?ONCEPTO\s*$/i.test(c))) continue; // encabezado del formato nuevo
    for (let c = 0; c < Math.min(4, row.length); c++) {
      if (typeof row[c] === "string" && /^saldo\s+seg[úu]n\s+libros?$/i.test((row[c] as string).trim())) {
        // la fila siguiente (o la de más abajo) debe ser "saldo según extracto/bancos"
        let ok = false;
        for (let k = i + 1; k <= i + 3 && k < filas.length; k++) {
          if (typeof filas[k][c] === "string" && /^saldo\s+seg[úu]n\s+(extracto|bancos?)$/i.test((filas[k][c] as string).trim())) { ok = true; break; }
        }
        if (ok) anclas.push({ i, col: c });
        break;
      }
    }
  }

  const bloques: BloqueLeido[] = [];
  for (const a of anclas) {
    const row = filas[a.i];
    const h: HistoricoSeed = { cuentaId, periodoCierre: "", saldoLibro: primerMontoDerecha(row, a.col), saldoExtracto: null, diferenciaOriginal: null, partidas: [] };
    let iCat = a.i + 1;
    for (let k = a.i + 1; k <= a.i + 3 && k < filas.length; k++) {
      if (typeof filas[k][a.col] === "string" && /^saldo\s+seg[úu]n\s+(extracto|bancos?)$/i.test((filas[k][a.col] as string).trim())) {
        h.saldoExtracto = primerMontoDerecha(filas[k], a.col);
        iCat = k + 1;
        break;
      }
    }

    const cats: CategoriaLeida[] = [];
    let actual: CategoriaLeida | null = null;
    let fin = Math.min(filas.length, a.i + 400);
    for (let i = iCat; i < fin; i++) {
      const r = filas[i];
      const et = typeof r[a.col] === "string" ? (r[a.col] as string).trim() : "";
      if (!et) continue;
      if (/^sumas/i.test(et)) { fin = i; break; } // la 2.ª lista (tras SUMAS) repite las categorías: no se lee
      const tipo = tipoDeCategoriaAntigua(et);
      // Una fila del MISMO tipo que la categoría abierta es una línea de su
      // detalle ("Gastos Financieros-Comisión" bajo "Gastos financieros"),
      // no una categoría nueva.
      if (tipo && !(actual && actual.tipo === tipo)) {
        actual = { nombre: et, tipo, total: primerMontoDerecha(r, a.col) ?? 0, detalleSuma: 0, detalle: [] };
        cats.push(actual);
        continue;
      }
      if (actual) {
        const v = primerMontoDerecha(r, a.col);
        if (v != null) { actual.detalleSuma += v; actual.detalle.push({ cuentaId, descripcion: et, tipo: actual.tipo, valorAbsoluto: Math.abs(v) }); }
      }
    }
    h.partidas = armarPartidas(cuentaId, cats, h.saldoLibro, h.saldoExtracto, `Bloque (formato antiguo) de la fila ${a.i + 1}`, advertencias, avisos);

    // Período del bloque: la fecha de cierre viene escrita de muchas formas
    // ("Periodo: enero de 2026", una serie de Excel como 46053, "30/12(2025",
    // "Diciembre 31 de 2025"...). Se busca en las filas de arriba; lo
    // importante es distinguir los meses de 2026 del saldo inicial de 2025.
    let mes: number | null = null;
    let anio: number | null = null;
    for (let i = a.i - 1; i >= Math.max(0, a.i - 10) && anio == null; i--) {
      for (const c of filas[i]) {
        if (typeof c === "number" && c > 40000 && c < 60000) {
          const d = XLSX.SSF.parse_date_code(c);
          if (d) { mes = d.m; anio = d.y; }
          break;
        }
        if (typeof c !== "string") continue;
        const t = c.trim();
        const y = t.match(/\b(19|20)\d{2}\b/);
        if (!y) continue;
        anio = Number(y[0]);
        if (anio === ANIO_SEGUIMIENTO) {
          mes = mesDeTexto(t);
          if (mes == null) { const dm = t.match(/(\d{1,2})\s*[\/\-.(]\s*(\d{1,2})/); if (dm && +dm[2] >= 1 && +dm[2] <= 12) mes = +dm[2]; }
        }
        break;
      }
    }
    bloques.push({ h, mesDetectado: mes, esAnterior: anio != null && anio !== ANIO_SEGUIMIENTO, fila: a.i + 1, formato: "antiguo" });
  }
  return bloques;
}

/**
 * Asigna un mes (1-12) a cada bloque, EN ORDEN de aparición en la hoja,
 * de forma estrictamente creciente y coincidiendo lo más posible con el
 * mes que el propio bloque dice tener. Corrige lo que se ve en el Excel
 * real: encabezados con año equivocado ("Septiembre 2001"), períodos
 * repetidos (dos "Febrero"), textos sin mes o con formato distinto.
 * Devuelve el mes asignado y si fue INFERIDO (distinto del detectado).
 */
function asignarMeses(det: (number | null)[]): number[] | null {
  const n = det.length;
  if (n === 0) return [];
  const INF = 1e9;
  // f[i][m]: costo mínimo de asignar meses a los bloques 0..i con el bloque i en el mes m.
  const f: number[][] = Array.from({ length: n }, () => Array(13).fill(INF));
  const prev: number[][] = Array.from({ length: n }, () => Array(13).fill(0));
  for (let m = 1; m <= 12; m++) f[0][m] = det[0] != null && det[0] !== m ? 1000 : 0;
  for (let i = 1; i < n; i++) {
    for (let m = 1; m <= 12; m++) {
      const costoMes = det[i] != null && det[i] !== m ? 1000 : 0;
      for (let p = 1; p < m; p++) {
        if (f[i - 1][p] >= INF) continue;
        const c = f[i - 1][p] + costoMes + (m - p - 1); // saltar meses cuesta poco: se prefieren meses seguidos
        if (c < f[i][m]) { f[i][m] = c; prev[i][m] = p; }
      }
    }
  }
  let mejor = INF, mFin = 0;
  for (let m = 1; m <= 12; m++) if (f[n - 1][m] < mejor) { mejor = f[n - 1][m]; mFin = m; }
  if (mejor >= INF) return null; // más de 12 bloques: no cabe
  const res = Array(n).fill(0);
  let m = mFin;
  for (let i = n - 1; i >= 0; i--) { res[i] = m; m = prev[i][m]; }
  return res;
}

function migrarCuentaHoja(
  wb: XLSX.WorkBook,
  cuenta: CuentaSeed,
  advertencias: string[],
  avisos: string[],
  hojasUsadas: Set<string>
): { ultimoCierre: HistoricoSeed; mensuales: (HistoricoSeed & { periodoIso: string })[] } {
  const normaliza = (s: string) => s.trim().toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ");
  let nombreHoja = Object.keys(wb.Sheets).find((n) => n.trim() === cuenta.enlace.trim());
  if (!nombreHoja) {
    nombreHoja = Object.keys(wb.Sheets).find((n) => normaliza(n) === normaliza(cuenta.enlace));
    if (nombreHoja) {
      advertencias.push(`[${cuenta.id}] El texto de "Enlace" en el Índice ("${cuenta.enlace}") no calza exacto con la pestaña "${nombreHoja}"; se usó coincidencia aproximada. Confirmar que es la cuenta correcta.`);
    }
  }
  if (!nombreHoja) {
    const alias = ALIAS_HOJAS[normaliza(cuenta.enlace)];
    if (alias && wb.Sheets[alias]) {
      nombreHoja = alias;
      advertencias.push(`[${cuenta.id}] El "Enlace" del Índice ("${cuenta.enlace}") no es el nombre de ninguna pestaña; se usó la pestaña "${alias}" (equivalencia fija definida en el script). Confirmar que es la cuenta correcta.`);
    }
  }
  const ws = nombreHoja ? wb.Sheets[nombreHoja] : undefined;
  const vacio = { cuentaId: cuenta.id, periodoCierre: "", saldoLibro: null, saldoExtracto: null, diferenciaOriginal: null, partidas: [] as PartidaSeed[] };

  if (!ws || !nombreHoja) {
    advertencias.push(`[${cuenta.id}] No se encontró la hoja "${cuenta.enlace}" en el libro de Seguimiento — NINGÚN dato migrado para esta cuenta, requiere carga 100% manual.`);
    return { ultimoCierre: vacio, mensuales: [] };
  }
  hojasUsadas.add(nombreHoja);

  const filas: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let bloques = [
    ...parsearBloquesNuevos(filas, cuenta.id, advertencias, avisos),
    ...parsearBloquesAntiguos(filas, cuenta.id, advertencias, avisos),
  ].sort((a, b) => a.fila - b.fila);

  // Los bloques de otro año (el saldo inicial a diciembre de 2025) no son un mes conciliado.
  bloques = bloques.filter((b) => !b.esAnterior);

  if (bloques.length === 0) {
    advertencias.push(`[${cuenta.id}] La hoja "${nombreHoja}" no tiene ningún bloque mensual reconocible (ni formato nuevo ni antiguo). Requiere carga manual del saldo y partidas iniciales.`);
    return { ultimoCierre: vacio, mensuales: [] };
  }

  // Bloques repetidos tal cual (mismo mes y mismos saldos que el anterior): se descarta el duplicado.
  const sinDup: BloqueLeido[] = [];
  for (const b of bloques) {
    const p = sinDup[sinDup.length - 1];
    if (p && b.mesDetectado != null && p.mesDetectado === b.mesDetectado &&
        b.h.saldoLibro === p.h.saldoLibro && b.h.saldoExtracto === p.h.saldoExtracto) {
      advertencias.push(`[${cuenta.id}] Bloque de la fila ${b.fila} es un duplicado exacto del de la fila ${p.fila} (mismo mes y saldos) — se ignoró.`);
      continue;
    }
    sinDup.push(b);
  }
  bloques = sinDup;

  const meses = asignarMeses(bloques.map((b) => b.mesDetectado));
  if (!meses) {
    advertencias.push(`[${cuenta.id}] La hoja "${nombreHoja}" tiene ${bloques.length} bloques (más de 12) — no se pudo asignar un mes a cada uno; revisar manualmente.`);
    return { ultimoCierre: vacio, mensuales: [] };
  }

  const mensuales: (HistoricoSeed & { periodoIso: string })[] = [];
  bloques.forEach((b, k) => {
    const mes = meses[k];
    const periodoIso = `${ANIO_SEGUIMIENTO}-${String(mes).padStart(2, "0")}`;
    if (b.mesDetectado !== mes) {
      advertencias.push(
        `[${cuenta.id}] Bloque de la fila ${b.fila}: el período escrito en la hoja ${b.mesDetectado ? `dice ${MESES_TXT[b.mesDetectado - 1]}` : "no se pudo leer"}; por su posición entre los demás meses se asignó a ${MESES_TXT[mes - 1]}. Confirmar.`
      );
    }
    if (b.h.saldoLibro == null || b.h.saldoExtracto == null) {
      advertencias.push(`[${cuenta.id}] Bloque de ${periodoIso} (fila ${b.fila}): no se pudo leer "Saldo del período" completo — no se migró ese mes.`);
      return;
    }
    b.h.periodoCierre = `${MESES_TXT[mes - 1]} ${ANIO_SEGUIMIENTO}`;
    mensuales.push({ ...b.h, periodoCierre: b.h.periodoCierre, periodoIso });
  });

  const ultimo = bloques[bloques.length - 1];
  ultimo.h.periodoCierre = `${MESES_TXT[meses[meses.length - 1] - 1]} ${ANIO_SEGUIMIENTO}`;
  return { ultimoCierre: ultimo.h, mensuales };
}

// Equivalencias fijas entre el texto de la columna "Enlace" del Índice y
// el nombre REAL de la pestaña, para los casos en que no calzan ni con
// tolerancia de espacios/guiones (verificado contra el archivo real,
// comparando el número de cuenta y el nombre en el encabezado de cada hoja).
const ALIAS_HOJAS: Record<string, string> = {
  "0230 1 avanza": "1339 - AVANZA",
  "0957 3 empretito": "0957-3 Emprestito", // "Empretito" es un error de digitación en el Índice
  "4382 6 hidrocarburos": "3826 Davivie",   // la hoja dice "Impuesto Hidrocarburos" (cuenta 1380-0004-382-6)
  "4313 7 sobretasa a la gasolina": "4313-7 Sobretasa Gasolina",
  "regalias ssf": "SSF Regalias ",
};


function main() {
  const rutaArchivo = process.argv[2];
  if (!rutaArchivo) {
    console.error("Uso: ts-node migrar-seguimiento.ts <ruta_seguimiento.xlsx>");
    process.exit(1);
  }

  const wb = XLSX.readFile(rutaArchivo);
  const wsIndice = wb.Sheets["Indice"];
  const filasIndice: unknown[][] = XLSX.utils.sheet_to_json(wsIndice, { header: 1, defval: null });

  const cuentas: CuentaSeed[] = [];
  // NOTA: la columna A de la hoja "Índice" está vacía en todo el archivo;
  // SheetJS la omite del arreglo (a diferencia de librerías que sí la
  // representan como null), así que las columnas reales quedan corridas
  // una posición a la izquierda: row[0]=Item, row[1]=Banco, row[2]=Enlace,
  // row[3]=Tipo de Recurso. Verificado contra el archivo real.
  // El encabezado está en la fila 6 (índice 5); los datos empiezan en la fila 7 (índice 6).
  for (let i = 6; i < filasIndice.length; i++) {
    const row = filasIndice[i];
    const item = row[0];
    const banco = row[1];
    const enlace = row[2];
    const tipoRecurso = row[3];
    if (item == null || !enlace) continue;

    const banco2 = String(banco ?? "").trim();
    const enlace2 = String(enlace).trim();
    cuentas.push({
      id: `${slug(enlace2)}`,
      item: Number(item),
      banco: banco2,
      enlace: enlace2,
      tipoRecurso: String(tipoRecurso ?? "").trim(),
      formatoExtracto: formatoPorBanco(banco2),
      reglasMatching: REGLAS_DEFECTO,
    });
  }

  console.log(`Cuentas encontradas en el Índice: ${cuentas.length}`);

  const advertencias: string[] = [];
  const avisos: string[] = []; // informativos: total migrado sin desglose (no falta ningún dato)
  const hojasUsadas = new Set<string>();
  const resultados = cuentas.map((c) => ({ cuenta: c, ...migrarCuentaHoja(wb, c, advertencias, avisos, hojasUsadas) }));

  // Pestañas del libro que NO quedaron asignadas a ninguna cuenta del Índice
  // (las auxiliares "Indice", "Rendimientos financieros" y "Gastos bancarios" no cuentan).
  const auxiliares = /^(indice|rendimientos financieros|gastos bancarios)$/i;
  for (const nombre of wb.SheetNames) {
    if (hojasUsadas.has(nombre) || auxiliares.test(nombre.trim())) continue;
    advertencias.push(`[hoja-sin-cuenta] La pestaña "${nombre}" no corresponde a ninguna fila del Índice — NO se migró. Si es una cuenta real, agrégala al Índice.`);
  }

  // Cuentas sin saldo inicial confiable quedan marcadas explícitamente
  // (no se bloquean ni se ocultan): el usuario las ve en el dashboard
  // como "pendiente de carga manual" y puede completar el saldo/partidas
  // desde la propia UI antes de correr su primera conciliación.
  //
  // El histórico migrado (saldo y partidas del último cierre en el
  // Seguimiento 2026) se incrusta en la propia cuenta como referencia
  // de solo lectura, consultable desde la app — así no queda solo en
  // este archivo JSON local.
  const cuentasConEstado = resultados.map(({ cuenta: c, ultimoCierre: hist }) => {
    const saldoInicialPendiente = !hist || hist.saldoLibro == null || hist.saldoExtracto == null;
    return {
      ...c,
      saldoInicialPendiente,
      historicoMigrado: hist
        ? {
            periodoCierre: hist.periodoCierre,
            saldoLibro: hist.saldoLibro,
            saldoExtracto: hist.saldoExtracto,
            partidas: hist.partidas.map((p) => ({
              descripcion: p.descripcion,
              tipo: p.tipo,
              valorAbsoluto: p.valorAbsoluto,
            })),
          }
        : undefined,
    };
  });

  // TODOS los meses ya conciliados según el Excel original (no solo el
  // último) — esto es lo que permite que el Histórico de cada cuenta en
  // la app muestre los meses reales como "conciliado" en vez de "sin
  // conciliar", y que las partidas anteriores se carguen automáticamente
  // de un mes real al siguiente.
  const historicoMensual = resultados.flatMap(({ cuenta: c, mensuales }) =>
    mensuales.map((m) => ({
      cuentaId: c.id,
      periodo: m.periodoIso,
      saldoLibro: m.saldoLibro,
      saldoExtracto: m.saldoExtracto,
      diferenciaOriginal: m.diferenciaOriginal,
      partidas: m.partidas,
    }))
  );

  const outDir = path.join(__dirname, "..", "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "cuentas.json"), JSON.stringify(cuentasConEstado, null, 2));
  fs.writeFileSync(path.join(outDir, "historico-inicial.json"), JSON.stringify(resultados.map((r) => r.ultimoCierre), null, 2));
  fs.writeFileSync(path.join(outDir, "historico-mensual.json"), JSON.stringify(historicoMensual, null, 2));
  fs.writeFileSync(path.join(outDir, "advertencias.json"), JSON.stringify(advertencias, null, 2));
  fs.writeFileSync(path.join(outDir, "avisos-informativos.json"), JSON.stringify(avisos, null, 2));

  const pendientes = cuentasConEstado.filter((c) => c.saldoInicialPendiente).length;
  console.log(`Listo. ${cuentasConEstado.length} cuentas (${pendientes} pendientes de carga manual).`);
  console.log(`${historicoMensual.length} meses históricos encontrados en total across todas las cuentas.`);
  console.log(`${advertencias.length} advertencias — revisar out/advertencias.json.`);
  console.log(`${avisos.length} avisos informativos (total migrado sin desglose) — out/avisos-informativos.json.`);
}

main();
