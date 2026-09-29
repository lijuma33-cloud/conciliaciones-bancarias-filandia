// ══════════════════════════════════════════════════════════════════
// Motor de conciliación — puerto 1:1 de la lógica ya validada en los
// 3 HTML legado (Agrario/Davivienda/Bancolombia usan exactamente el
// mismo algoritmo; solo cambian los parsers de entrada).
//
// FASES:
//   1) Cruzar partidas anteriores (histórico) contra movimientos del
//      período actual.
//   2a) Cruce 1-a-1 exacto (tolerancia configurable, mismo signo).
//   2b) Cruce 1-a-N (un movimiento del extracto = suma de varios del
//       libro que no cruzaron en 2a).
//   3) Clasificar lo no cruzado: CBNL/PBNL (en banco, no en libro),
//      CLNB/PLNB (en libro, no en banco).
// ══════════════════════════════════════════════════════════════════
import type {
  Movimiento,
  PartidaAnterior,
  ReglasMatching,
  ResultadoConciliacion,
  EstadoConciliacion,
} from "../types/domain";
import { fmtCOP } from "../utils/normalizacion";

const REGLAS_DEFECTO: ReglasMatching = {
  toleranciaPesos: 1,
  permitirAgrupacion1aN: true,
  normalizarDescripcion: false,
};

export function reconciliar(params: {
  cuentaId: string;
  periodo: string;
  movimientosExtracto: Movimiento[];
  movimientosLibro: Movimiento[];
  saldoLibro: number;
  saldoExtracto: number;
  intereses: number;
  partidasAnteriores: PartidaAnterior[];
  reglas?: Partial<ReglasMatching>;
  creadoPor: string;
  version: number;
}): ResultadoConciliacion {
  const reglas = { ...REGLAS_DEFECTO, ...params.reglas };
  const tol = reglas.toleranciaPesos;

  // Copias mutables locales (no tocar los arreglos originales del caller).
  const extMov = params.movimientosExtracto
    .filter((m) => !/(INTERESES|RENDIMIENTO|ABONO INTERESES)/i.test(m.descripcion))
    .map((m) => ({ ...m, matched: false }));
  const libMov = params.movimientosLibro.map((m) => ({ ...m, matched: false }));
  const partidas = params.partidasAnteriores.map((p) => ({ ...p, matched: false }));

  // ── FASE 1: partidas anteriores contra movimientos actuales ──────
  const partidasCruzadas: {
    partidaId: string;
    partidaDescripcion: string;
    movimientoId: string;
    movimientoDescripcion: string;
    origen: "extracto" | "libro";
    valor: number;
  }[] = [];
  for (const pa of partidas) {
    const abs = pa.valorAbsoluto;
    const enLibro = pa.tipo === "CLNB" || pa.tipo === "PLNB";
    if (pa.tipo === "REND") {
      // Un rendimiento pendiente representa un interés que YA está en el
      // banco (extracto) pero todavía no se ha registrado en el libro.
      // Por eso se resuelve cuando por fin aparece como movimiento en el
      // LIBRO — no buscando de nuevo en el extracto.
      const hit = libMov.find((lm) => !lm.matched && Math.abs(Math.abs(lm.valor) - abs) < tol);
      if (hit) {
        hit.matched = true; pa.matched = true;
        partidasCruzadas.push({ partidaId: pa.id, partidaDescripcion: pa.descripcion, movimientoId: hit.id, movimientoDescripcion: hit.descripcion, origen: "libro", valor: hit.valor });
      }
    } else if (enLibro) {
      const hit = extMov.find((em) => !em.matched && Math.abs(Math.abs(em.valor) - abs) < tol);
      if (hit) {
        hit.matched = true; pa.matched = true;
        partidasCruzadas.push({ partidaId: pa.id, partidaDescripcion: pa.descripcion, movimientoId: hit.id, movimientoDescripcion: hit.descripcion, origen: "extracto", valor: hit.valor });
      }
    } else {
      const hit = libMov.find((lm) => !lm.matched && Math.abs(Math.abs(lm.valor) - abs) < tol);
      if (hit) {
        hit.matched = true; pa.matched = true;
        partidasCruzadas.push({ partidaId: pa.id, partidaDescripcion: pa.descripcion, movimientoId: hit.id, movimientoDescripcion: hit.descripcion, origen: "libro", valor: hit.valor });
      }
    }
  }

  // ── FASE 2a: cruce 1 a 1 exacto ───────────────────────────────────
  const cruzados: {
    extractoId: string;
    libroIds: string[];
    extractoFecha?: string;
    extractoDescripcion?: string;
    extractoValor?: number;
    libroDescripcion?: string;
  }[] = [];
  for (const em of extMov) {
    if (em.matched) continue;
    const hit = libMov.find(
      (lm) => !lm.matched && Math.abs(Math.abs(em.valor) - Math.abs(lm.valor)) < tol && Math.sign(em.valor) === Math.sign(lm.valor)
    );
    if (hit) {
      em.matched = true;
      hit.matched = true;
      cruzados.push({
        extractoId: em.id,
        libroIds: [hit.id],
        extractoFecha: em.fecha,
        extractoDescripcion: em.descripcion,
        extractoValor: em.valor,
        libroDescripcion: `${hit.fecha} — ${hit.descripcion} — ${fmtCOP(hit.valor)}`,
      });
    }
  }

  // ── FASE 2b: cruce 1 a N ───────────────────────────────────────────
  if (reglas.permitirAgrupacion1aN) {
    for (const em of extMov) {
      if (em.matched) continue;
      const absEm = Math.abs(em.valor);
      const sign = Math.sign(em.valor);
      const candidatos = libMov
        .filter((lm) => !lm.matched && Math.sign(lm.valor) === sign && Math.abs(lm.valor) <= absEm + tol)
        .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

      let acum = 0;
      const grupo: Movimiento[] = [];
      for (const lm of candidatos) {
        if (acum + Math.abs(lm.valor) <= absEm + tol) {
          acum += Math.abs(lm.valor);
          grupo.push(lm);
          if (Math.abs(acum - absEm) < tol) break;
        }
      }
      if (Math.abs(acum - absEm) < tol && grupo.length > 0) {
        em.matched = true;
        grupo.forEach((lm) => (lm.matched = true));
        cruzados.push({
          extractoId: em.id,
          libroIds: grupo.map((g) => g.id),
          extractoFecha: em.fecha,
          extractoDescripcion: em.descripcion,
          extractoValor: em.valor,
          libroDescripcion: grupo.map((g) => `${g.fecha} — ${g.descripcion} — ${fmtCOP(g.valor)}`).join(" + "),
        });
      }
    }
  }

  // ── FASE 3: clasificar pendientes ────────────────────────────────
  const pendientesExtracto = extMov.filter((m) => !m.matched);
  const pendientesLibro = libMov.filter((m) => !m.matched);
  const partidasNoCruzadas = partidas.filter((p) => !p.matched);

  // IMPORTANTE: estas sumas solo cuentan partidas YA CLASIFICADAS
  // (heredadas del mes anterior, ya revisadas). Los movimientos sin
  // cruzar de ESTE período (pendientesExtracto/pendientesLibro) NO se
  // incluyen aquí — antes se sumaban/restaban automáticamente solo por
  // su signo, lo que "explicaba" cualquier diferencia sin que nadie la
  // hubiera revisado (saldoPendiente daba $0 y quedaba CONCILIADA aunque
  // las sumas reales no cuadraran). Ahora quedan como diferencia real
  // hasta que el contador los clasifique manualmente (clasificarComoPartida
  // en la UI) o se hereden como partida al mes siguiente — igual que
  // recalcularSaldoPendiente(), que tampoco los cuenta.
  const sCBNL = partidasNoCruzadas.filter((p) => p.tipo === "CBNL").reduce((s, p) => s + p.valorAbsoluto, 0);
  const sPBNL = partidasNoCruzadas.filter((p) => p.tipo === "PBNL").reduce((s, p) => s + p.valorAbsoluto, 0);
  const sCLNB = partidasNoCruzadas.filter((p) => p.tipo === "CLNB").reduce((s, p) => s + p.valorAbsoluto, 0);
  const sPLNB = partidasNoCruzadas.filter((p) => p.tipo === "PLNB").reduce((s, p) => s + p.valorAbsoluto, 0);

  const rfPendientes = partidasNoCruzadas.filter((p) => p.tipo === "REND");
  const interesesCarryOver = rfPendientes.reduce((s, p) => s + p.valorAbsoluto, 0);
  const intereses = params.intereses + interesesCarryOver;

  // El interés del mes ACTUAL (params.intereses, tomado del extracto) se
  // agrega como una partida visible propia — antes solo quedaba sumado
  // "por dentro" del total de intereses sin aparecer como línea en
  // "partidasConciliatorias", así que en el formato impreso la categoría
  // "Rendimientos Financieros" no mostraba el interés del mes en curso,
  // solo el que quedó pendiente de meses anteriores. Ahora ambos aparecen
  // como líneas separadas bajo la misma categoría (igual que en el
  // formato original: "...período actual" + "...período <mes previo>"),
  // y su suma es la que se lleva al siguiente mes si tampoco cruza.
  const partidasFinal = [...partidasNoCruzadas];
  if (params.intereses > 0.5) {
    partidasFinal.push({
      id: `rend-actual-${params.periodo}`,
      descripcion: "Intereses acreditados en extracto bancario del período actual",
      tipo: "REND",
      valorAbsoluto: params.intereses,
      matched: false,
    });
  }

  // Rendimientos y Consignaciones en Bancos y no Libros SUMAN al saldo de
  // libros; Consignaciones en Libros y no Bancos y Pagos en Bancos y no
  // Libros RESTAN; Pagos en Libros y no Bancos SUMA (antes PLNB/PBNL
  // estaban con el signo invertido — corregido y verificado contra datos
  // reales de la Alcaldía).
  const sumaTeorica = params.saldoLibro + intereses - sCLNB + sCBNL + sPLNB - sPBNL;
  const saldoPendiente = Math.round((sumaTeorica - params.saldoExtracto) * 100) / 100;

  let estado: EstadoConciliacion;
  if (Math.abs(saldoPendiente) < tol) estado = "CONCILIADA";
  else if (pendientesExtracto.length + pendientesLibro.length + partidasNoCruzadas.length > 0) estado = "CON_DIFERENCIAS";
  else estado = "PENDIENTE_REVISION";

  return {
    cuentaId: params.cuentaId,
    periodo: params.periodo,
    saldoLibro: params.saldoLibro,
    saldoExtracto: params.saldoExtracto,
    intereses,
    cruzados,
    partidasCruzadas,
    crucesManuales: [],
    pendientesExtracto,
    pendientesLibro,
    partidasConciliatorias: partidasFinal,
    saldoPendiente,
    estado,
    version: params.version,
    creadoPor: params.creadoPor,
    creadoEn: new Date().toISOString(),
  };
}

/**
 * Recalcula saldoPendiente y estado a partir del estado ACTUAL de un
 * resultado ya generado (después de clasificar manualmente una
 * diferencia como partida, o de cualquier otro ajuste manual). Sin
 * esto, el saldo pendiente y el estado mostrados quedan desactualizados
 * después de una acción manual — la cuenta nunca pasa a "CONCILIADA"
 * aunque la diferencia real ya haya quedado explicada.
 */
export function recalcularSaldoPendiente(r: ResultadoConciliacion, tolerancia = 1): ResultadoConciliacion {
  const intereses = r.partidasConciliatorias
    .filter((p) => p.tipo === "REND")
    .reduce((s, p) => s + p.valorAbsoluto, 0);

  const ajuste = r.partidasConciliatorias.reduce((acc, p) => {
    const signo = p.tipo === "REND" || p.tipo === "CBNL" || p.tipo === "PLNB" ? 1 : -1;
    return acc + signo * p.valorAbsoluto;
  }, 0);

  const saldoPendiente = Math.round((r.saldoLibro + ajuste - r.saldoExtracto) * 100) / 100;

  let estado: EstadoConciliacion;
  if (Math.abs(saldoPendiente) < tolerancia) estado = "CONCILIADA";
  else if (r.pendientesExtracto.length + r.pendientesLibro.length + r.partidasConciliatorias.length > 0) estado = "CON_DIFERENCIAS";
  else estado = "PENDIENTE_REVISION";

  return { ...r, intereses, saldoPendiente, estado };
}
