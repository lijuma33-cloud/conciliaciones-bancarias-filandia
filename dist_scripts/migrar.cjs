"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/migrar-seguimiento.ts
var XLSX = __toESM(require("xlsx"), 1);
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var REGLAS_DEFECTO = { toleranciaPesos: 1, permitirAgrupacion1aN: true, normalizarDescripcion: false };
function formatoPorBanco(banco) {
  const b = banco.trim().toLowerCase();
  if (b.startsWith("agrario")) return "docx";
  if (b.startsWith("davivienda")) return "txt";
  return "xlsx";
}
function slug(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function tipoDeCategoria(etiqueta) {
  const t = etiqueta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/^rendimientos?\s+financieros?$/.test(t)) return "REND";
  if (/^consignacion(es)?\s+en\s+libros?\s+y\s+no\s+bancos?$/.test(t)) return "CLNB";
  if (/^consignacion(es)?\s+en\s+bancos?\s+y\s+no\s+libros?$/.test(t)) return "CBNL";
  if (/^pagos?\s+en\s+libros?\s+y\s+no\s+bancos?$/.test(t)) return "PLNB";
  if (/^pagos?\s+en\s+bancos?\s+y\s+no\s+libros?$/.test(t)) return "PBNL";
  if (/^retenci[oó]n\s+en\s+la\s+fuente$/.test(t)) return "PBNL";
  return null;
}
function pareceCategoriaNoReconocida(etiqueta) {
  const t = etiqueta.toLowerCase();
  return /consignacion|^pago|rendimiento|retenci/.test(t);
}
var FIN_DE_BLOQUE = /^sumas iguales/i;
var ANIO_SEGUIMIENTO = 2026;
var MESES_TXT = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function esSoloGuion(v) {
  return typeof v === "string" && v.trim() !== "" && /^[\s\-\u2010-\u2015\u2212]+$/.test(v);
}
function comoMonto(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /\d/.test(v)) {
    const normalizado = v.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[$\s]/g, "");
    if (/^-?\d{1,3}(\.\d{3})+\.\d{1,2}$/.test(normalizado)) {
      const i = normalizado.lastIndexOf(".");
      const n2 = parseFloat(normalizado.slice(0, i).replace(/\./g, "") + "." + normalizado.slice(i + 1));
      return isNaN(n2) ? null : n2;
    }
    const n = parseFloat(normalizado.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }
  return null;
}
function primerMontoDerecha(row, colEtiqueta) {
  for (let c = colEtiqueta + 1; c < row.length; c++) {
    const m = comoMonto(row[c]);
    if (m != null) return m;
  }
  return null;
}
function dosSaldosDerecha(row, colEtiqueta) {
  const vals = [];
  for (let c = colEtiqueta + 1; c < row.length && vals.length < 2; c++) {
    const v = row[c];
    if (v == null || typeof v === "string" && v.trim() === "") continue;
    if (esSoloGuion(v)) {
      vals.push(0);
      continue;
    }
    const m = comoMonto(v);
    if (m != null) vals.push(m);
  }
  return [vals[0] ?? null, vals[1] ?? null];
}
function mesDeTexto(t) {
  const s = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const m = s.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/);
  if (!m) return null;
  const y = s.match(/\b(19|20)\d{2}\b/);
  if (y && Number(y[0]) !== ANIO_SEGUIMIENTO) return null;
  return MESES_TXT.indexOf(m[1] === "setiembre" ? "septiembre" : m[1]) + 1;
}
function detectarMes(filas, idxAnchor, limiteAbajo) {
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
var SIGNO_TIPO = { REND: 1, CBNL: 1, PLNB: 1, CLNB: -1, PBNL: -1 };
function armarPartidas(cuentaId, cats, saldoLibro, saldoExtracto, ubic, advertencias, avisos) {
  const TOL = 2;
  const desajustadas = cats.map((c, i) => Math.abs(c.detalleSuma - c.total) > TOL ? i : -1).filter((i) => i >= 0);
  const usarDetalle = cats.map((c) => Math.abs(c.detalleSuma - c.total) <= TOL);
  const construir = (uso) => {
    const out = [];
    cats.forEach((c, i) => {
      if (uso[i]) out.push(...c.detalle);
      else if (Math.abs(c.total) > TOL) {
        out.push({ cuentaId, descripcion: `${c.nombre} (total de categor\xEDa, sin desglose confiable \u2014 revisar hoja original)`, tipo: c.tipo, valorAbsoluto: Math.abs(c.total) });
      }
    });
    return out;
  };
  const dif = (ps) => saldoLibro == null || saldoExtracto == null ? 0 : saldoLibro + ps.reduce((a, p) => a + SIGNO_TIPO[p.tipo] * p.valorAbsoluto, 0) - saldoExtracto;
  let elegido = construir(usarDetalle);
  let usoFinal = usarDetalle;
  if (saldoLibro != null && saldoExtracto != null && Math.abs(dif(elegido)) > 1 && desajustadas.length > 0 && desajustadas.length <= 10) {
    let mejor = null;
    const n = desajustadas.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const uso = [...usarDetalle];
      let cambios = 0;
      for (let b = 0; b < n; b++) if (mask & 1 << b) {
        uso[desajustadas[b]] = !uso[desajustadas[b]];
        cambios++;
      }
      const ps = construir(uso);
      if (Math.abs(dif(ps)) <= 1 && (!mejor || cambios < mejor.cambios)) mejor = { uso, ps, cambios };
    }
    if (mejor) {
      const cambiadas = desajustadas.filter((i) => mejor.uso[i] !== usarDetalle[i]).map((i) => `"${cats[i].nombre}" (total digitado ${cats[i].total}, detalle suma ${cats[i].detalleSuma})`);
      advertencias.push(`[${cuentaId}] ${ubic}: el total digitado no coincid\xEDa con el detalle en ${cambiadas.join("; ")}. Se us\xF3 la alternativa con la que el mes cuadra a $0. Confirmar contra la hoja.`);
      elegido = mejor.ps;
      usoFinal = mejor.uso;
    }
  }
  cats.forEach((c, i) => {
    if (!usoFinal[i] && Math.abs(c.total) > TOL && Math.abs(c.detalleSuma - c.total) > TOL) {
      avisos.push(`[${cuentaId}] ${ubic}: categor\xEDa "${c.nombre}" total ${c.total} migrado sin desglose (detalle listado: ${c.detalleSuma}).`);
    }
  });
  return elegido;
}
function parsearBloquesNuevos(filas, cuentaId, advertencias, avisos) {
  const anclas = [];
  for (let i = 0; i < filas.length; i++) {
    for (let c = 0; c < Math.min(4, filas[i].length); c++) {
      if (typeof filas[i][c] === "string" && /^saldo del per[ií]odo$/i.test(filas[i][c].trim())) {
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
function parsearUnBloqueNuevo(filas, cuentaId, idxAnchor, col, limite, advertencias, avisos) {
  const h = { cuentaId, periodoCierre: "", saldoLibro: null, saldoExtracto: null, diferenciaOriginal: null, partidas: [] };
  const [sl, se] = dosSaldosDerecha(filas[idxAnchor], col);
  h.saldoLibro = sl;
  h.saldoExtracto = se;
  const cats = [];
  let actual = null;
  for (let i = idxAnchor + 1; i < limite; i++) {
    const row = filas[i];
    const etiqueta = typeof row[col] === "string" ? row[col].trim() : "";
    if (!etiqueta) continue;
    if (/^diferencia/i.test(etiqueta)) {
      h.diferenciaOriginal = primerMontoDerecha(row, col);
      break;
    }
    if (FIN_DE_BLOQUE.test(etiqueta)) {
      actual = null;
      continue;
    }
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
        `[${cuentaId}] Fila "${etiqueta}" (fila ${i + 1}) parece una categor\xEDa de partida pero no calz\xF3 con ninguna reconocida \u2014 revisar manualmente. Valor: ${primerMontoDerecha(row, col) ?? "no num\xE9rico"}.`
      );
    }
  }
  h.partidas = armarPartidas(cuentaId, cats, h.saldoLibro, h.saldoExtracto, `Bloque de la fila ${idxAnchor + 1}`, advertencias, avisos);
  return { h, mesDetectado: detectarMes(filas, idxAnchor, limite), esAnterior: false, fila: idxAnchor + 1, formato: "nuevo" };
}
function tipoDeCategoriaAntigua(etiqueta) {
  const t = etiqueta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/^rendimientos?\s+fin/.test(t)) return "REND";
  if (/^consignaci\w*\s+en\s+bancos?\s+(y\s+)?no\s+(en\s+)?libros?/.test(t)) return "CBNL";
  if (/^consignaci\w*\s+en\s+libros?\s+(y\s+)?no\s+(en\s+)?bancos?/.test(t)) return "CLNB";
  if (/^(tr|traslados?)\s+y\s+ce\b/.test(t) || /^pagos?\s+(en|de)\s+libros?(\s+(y\s+)?no\s+(en\s+)?bancos?)?\s*$/.test(t)) return "PLNB";
  if (/^gastos?\s+fin/.test(t) || /^pagos?\s+(en|de)\s+bancos?(\s+(y\s+)?no\s+(en\s+)?libros?)?\s*$/.test(t)) return "PBNL";
  if (/^retenci[oó]n\s+en\s+la\s+fuente$/.test(t)) return "PBNL";
  return null;
}
function parsearBloquesAntiguos(filas, cuentaId, advertencias, avisos) {
  const anclas = [];
  for (let i = 0; i < filas.length; i++) {
    const row = filas[i];
    if (row.some((c) => typeof c === "string" && /^\s*C?ONCEPTO\s*$/i.test(c))) continue;
    for (let c = 0; c < Math.min(4, row.length); c++) {
      if (typeof row[c] === "string" && /^saldo\s+seg[úu]n\s+libros?$/i.test(row[c].trim())) {
        let ok = false;
        for (let k = i + 1; k <= i + 3 && k < filas.length; k++) {
          if (typeof filas[k][c] === "string" && /^saldo\s+seg[úu]n\s+(extracto|bancos?)$/i.test(filas[k][c].trim())) {
            ok = true;
            break;
          }
        }
        if (ok) anclas.push({ i, col: c });
        break;
      }
    }
  }
  const bloques = [];
  for (const a of anclas) {
    const row = filas[a.i];
    const h = { cuentaId, periodoCierre: "", saldoLibro: primerMontoDerecha(row, a.col), saldoExtracto: null, diferenciaOriginal: null, partidas: [] };
    let iCat = a.i + 1;
    for (let k = a.i + 1; k <= a.i + 3 && k < filas.length; k++) {
      if (typeof filas[k][a.col] === "string" && /^saldo\s+seg[úu]n\s+(extracto|bancos?)$/i.test(filas[k][a.col].trim())) {
        h.saldoExtracto = primerMontoDerecha(filas[k], a.col);
        iCat = k + 1;
        break;
      }
    }
    const cats = [];
    let actual = null;
    let fin = Math.min(filas.length, a.i + 400);
    for (let i = iCat; i < fin; i++) {
      const r = filas[i];
      const et = typeof r[a.col] === "string" ? r[a.col].trim() : "";
      if (!et) continue;
      if (/^sumas/i.test(et)) {
        fin = i;
        break;
      }
      const tipo = tipoDeCategoriaAntigua(et);
      if (tipo && !(actual && actual.tipo === tipo)) {
        actual = { nombre: et, tipo, total: primerMontoDerecha(r, a.col) ?? 0, detalleSuma: 0, detalle: [] };
        cats.push(actual);
        continue;
      }
      if (actual) {
        const v = primerMontoDerecha(r, a.col);
        if (v != null) {
          actual.detalleSuma += v;
          actual.detalle.push({ cuentaId, descripcion: et, tipo: actual.tipo, valorAbsoluto: Math.abs(v) });
        }
      }
    }
    h.partidas = armarPartidas(cuentaId, cats, h.saldoLibro, h.saldoExtracto, `Bloque (formato antiguo) de la fila ${a.i + 1}`, advertencias, avisos);
    let mes = null;
    let anio = null;
    for (let i = a.i - 1; i >= Math.max(0, a.i - 10) && anio == null; i--) {
      for (const c of filas[i]) {
        if (typeof c === "number" && c > 4e4 && c < 6e4) {
          const d = XLSX.SSF.parse_date_code(c);
          if (d) {
            mes = d.m;
            anio = d.y;
          }
          break;
        }
        if (typeof c !== "string") continue;
        const t = c.trim();
        const y = t.match(/\b(19|20)\d{2}\b/);
        if (!y) continue;
        anio = Number(y[0]);
        if (anio === ANIO_SEGUIMIENTO) {
          mes = mesDeTexto(t);
          if (mes == null) {
            const dm = t.match(/(\d{1,2})\s*[\/\-.(]\s*(\d{1,2})/);
            if (dm && +dm[2] >= 1 && +dm[2] <= 12) mes = +dm[2];
          }
        }
        break;
      }
    }
    bloques.push({ h, mesDetectado: mes, esAnterior: anio != null && anio !== ANIO_SEGUIMIENTO, fila: a.i + 1, formato: "antiguo" });
  }
  return bloques;
}
function asignarMeses(det) {
  const n = det.length;
  if (n === 0) return [];
  const INF = 1e9;
  const f = Array.from({ length: n }, () => Array(13).fill(INF));
  const prev = Array.from({ length: n }, () => Array(13).fill(0));
  for (let m2 = 1; m2 <= 12; m2++) f[0][m2] = det[0] != null && det[0] !== m2 ? 1e3 : 0;
  for (let i = 1; i < n; i++) {
    for (let m2 = 1; m2 <= 12; m2++) {
      const costoMes = det[i] != null && det[i] !== m2 ? 1e3 : 0;
      for (let p = 1; p < m2; p++) {
        if (f[i - 1][p] >= INF) continue;
        const c = f[i - 1][p] + costoMes + (m2 - p - 1);
        if (c < f[i][m2]) {
          f[i][m2] = c;
          prev[i][m2] = p;
        }
      }
    }
  }
  let mejor = INF, mFin = 0;
  for (let m2 = 1; m2 <= 12; m2++) if (f[n - 1][m2] < mejor) {
    mejor = f[n - 1][m2];
    mFin = m2;
  }
  if (mejor >= INF) return null;
  const res = Array(n).fill(0);
  let m = mFin;
  for (let i = n - 1; i >= 0; i--) {
    res[i] = m;
    m = prev[i][m];
  }
  return res;
}
function migrarCuentaHoja(wb, cuenta, advertencias, avisos, hojasUsadas) {
  const normaliza = (s) => s.trim().toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ");
  let nombreHoja = Object.keys(wb.Sheets).find((n) => n.trim() === cuenta.enlace.trim());
  if (!nombreHoja) {
    nombreHoja = Object.keys(wb.Sheets).find((n) => normaliza(n) === normaliza(cuenta.enlace));
    if (nombreHoja) {
      advertencias.push(`[${cuenta.id}] El texto de "Enlace" en el \xCDndice ("${cuenta.enlace}") no calza exacto con la pesta\xF1a "${nombreHoja}"; se us\xF3 coincidencia aproximada. Confirmar que es la cuenta correcta.`);
    }
  }
  if (!nombreHoja) {
    const alias = ALIAS_HOJAS[normaliza(cuenta.enlace)];
    if (alias && wb.Sheets[alias]) {
      nombreHoja = alias;
      advertencias.push(`[${cuenta.id}] El "Enlace" del \xCDndice ("${cuenta.enlace}") no es el nombre de ninguna pesta\xF1a; se us\xF3 la pesta\xF1a "${alias}" (equivalencia fija definida en el script). Confirmar que es la cuenta correcta.`);
    }
  }
  const ws = nombreHoja ? wb.Sheets[nombreHoja] : void 0;
  const vacio = { cuentaId: cuenta.id, periodoCierre: "", saldoLibro: null, saldoExtracto: null, diferenciaOriginal: null, partidas: [] };
  if (!ws || !nombreHoja) {
    advertencias.push(`[${cuenta.id}] No se encontr\xF3 la hoja "${cuenta.enlace}" en el libro de Seguimiento \u2014 NING\xDAN dato migrado para esta cuenta, requiere carga 100% manual.`);
    return { ultimoCierre: vacio, mensuales: [] };
  }
  hojasUsadas.add(nombreHoja);
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let bloques = [
    ...parsearBloquesNuevos(filas, cuenta.id, advertencias, avisos),
    ...parsearBloquesAntiguos(filas, cuenta.id, advertencias, avisos)
  ].sort((a, b) => a.fila - b.fila);
  bloques = bloques.filter((b) => !b.esAnterior);
  if (bloques.length === 0) {
    advertencias.push(`[${cuenta.id}] La hoja "${nombreHoja}" no tiene ning\xFAn bloque mensual reconocible (ni formato nuevo ni antiguo). Requiere carga manual del saldo y partidas iniciales.`);
    return { ultimoCierre: vacio, mensuales: [] };
  }
  const sinDup = [];
  for (const b of bloques) {
    const p = sinDup[sinDup.length - 1];
    if (p && b.mesDetectado != null && p.mesDetectado === b.mesDetectado && b.h.saldoLibro === p.h.saldoLibro && b.h.saldoExtracto === p.h.saldoExtracto) {
      advertencias.push(`[${cuenta.id}] Bloque de la fila ${b.fila} es un duplicado exacto del de la fila ${p.fila} (mismo mes y saldos) \u2014 se ignor\xF3.`);
      continue;
    }
    sinDup.push(b);
  }
  bloques = sinDup;
  const meses = asignarMeses(bloques.map((b) => b.mesDetectado));
  if (!meses) {
    advertencias.push(`[${cuenta.id}] La hoja "${nombreHoja}" tiene ${bloques.length} bloques (m\xE1s de 12) \u2014 no se pudo asignar un mes a cada uno; revisar manualmente.`);
    return { ultimoCierre: vacio, mensuales: [] };
  }
  const mensuales = [];
  bloques.forEach((b, k) => {
    const mes = meses[k];
    const periodoIso = `${ANIO_SEGUIMIENTO}-${String(mes).padStart(2, "0")}`;
    if (b.mesDetectado !== mes) {
      advertencias.push(
        `[${cuenta.id}] Bloque de la fila ${b.fila}: el per\xEDodo escrito en la hoja ${b.mesDetectado ? `dice ${MESES_TXT[b.mesDetectado - 1]}` : "no se pudo leer"}; por su posici\xF3n entre los dem\xE1s meses se asign\xF3 a ${MESES_TXT[mes - 1]}. Confirmar.`
      );
    }
    if (b.h.saldoLibro == null || b.h.saldoExtracto == null) {
      advertencias.push(`[${cuenta.id}] Bloque de ${periodoIso} (fila ${b.fila}): no se pudo leer "Saldo del per\xEDodo" completo \u2014 no se migr\xF3 ese mes.`);
      return;
    }
    b.h.periodoCierre = `${MESES_TXT[mes - 1]} ${ANIO_SEGUIMIENTO}`;
    mensuales.push({ ...b.h, periodoCierre: b.h.periodoCierre, periodoIso });
  });
  const ultimo = bloques[bloques.length - 1];
  ultimo.h.periodoCierre = `${MESES_TXT[meses[meses.length - 1] - 1]} ${ANIO_SEGUIMIENTO}`;
  return { ultimoCierre: ultimo.h, mensuales };
}
var ALIAS_HOJAS = {
  "0230 1 avanza": "1339 - AVANZA",
  "0957 3 empretito": "0957-3 Emprestito",
  // "Empretito" es un error de digitación en el Índice
  "4382 6 hidrocarburos": "3826 Davivie",
  // la hoja dice "Impuesto Hidrocarburos" (cuenta 1380-0004-382-6)
  "4313 7 sobretasa a la gasolina": "4313-7 Sobretasa Gasolina",
  "regalias ssf": "SSF Regalias "
};
function main() {
  const rutaArchivo = process.argv[2];
  if (!rutaArchivo) {
    console.error("Uso: ts-node migrar-seguimiento.ts <ruta_seguimiento.xlsx>");
    process.exit(1);
  }
  const wb = XLSX.readFile(rutaArchivo);
  const wsIndice = wb.Sheets["Indice"];
  const filasIndice = XLSX.utils.sheet_to_json(wsIndice, { header: 1, defval: null });
  const cuentas = [];
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
      reglasMatching: REGLAS_DEFECTO
    });
  }
  console.log(`Cuentas encontradas en el \xCDndice: ${cuentas.length}`);
  const advertencias = [];
  const avisos = [];
  const hojasUsadas = /* @__PURE__ */ new Set();
  const resultados = cuentas.map((c) => ({ cuenta: c, ...migrarCuentaHoja(wb, c, advertencias, avisos, hojasUsadas) }));
  const auxiliares = /^(indice|rendimientos financieros|gastos bancarios)$/i;
  for (const nombre of wb.SheetNames) {
    if (hojasUsadas.has(nombre) || auxiliares.test(nombre.trim())) continue;
    advertencias.push(`[hoja-sin-cuenta] La pesta\xF1a "${nombre}" no corresponde a ninguna fila del \xCDndice \u2014 NO se migr\xF3. Si es una cuenta real, agr\xE9gala al \xCDndice.`);
  }
  const cuentasConEstado = resultados.map(({ cuenta: c, ultimoCierre: hist }) => {
    const saldoInicialPendiente = !hist || hist.saldoLibro == null || hist.saldoExtracto == null;
    return {
      ...c,
      saldoInicialPendiente,
      historicoMigrado: hist ? {
        periodoCierre: hist.periodoCierre,
        saldoLibro: hist.saldoLibro,
        saldoExtracto: hist.saldoExtracto,
        partidas: hist.partidas.map((p) => ({
          descripcion: p.descripcion,
          tipo: p.tipo,
          valorAbsoluto: p.valorAbsoluto
        }))
      } : void 0
    };
  });
  const historicoMensual = resultados.flatMap(
    ({ cuenta: c, mensuales }) => mensuales.map((m) => ({
      cuentaId: c.id,
      periodo: m.periodoIso,
      saldoLibro: m.saldoLibro,
      saldoExtracto: m.saldoExtracto,
      diferenciaOriginal: m.diferenciaOriginal,
      partidas: m.partidas
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
  console.log(`${historicoMensual.length} meses hist\xF3ricos encontrados en total across todas las cuentas.`);
  console.log(`${advertencias.length} advertencias \u2014 revisar out/advertencias.json.`);
  console.log(`${avisos.length} avisos informativos (total migrado sin desglose) \u2014 out/avisos-informativos.json.`);
}
main();
