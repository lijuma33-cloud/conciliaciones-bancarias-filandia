// ══════════════════════════════════════════════════════════════════
// Partidas anteriores del período actual = lo que quedó pendiente en
// la ÚLTIMA versión guardada del mes anterior: movimientos del banco
// sin cruzar (CBNL/PBNL), movimientos del libro sin cruzar (CLNB/PLNB)
// y las partidas conciliatorias de arrastre que ya venían del mes
// anterior a ese y tampoco cruzaron (REND y demás).
//
// Esto reemplaza el "partidasAnteriores: []" fijo de la primera
// versión de PaginaCuenta — ahora se cargan automáticamente.
// ══════════════════════════════════════════════════════════════════
import type { PartidaAnterior, ResultadoConciliacion } from "../types/domain";

export function derivarPartidasAnteriores(previo: ResultadoConciliacion | null): PartidaAnterior[] {
  if (!previo) return [];

  const deExtracto: PartidaAnterior[] = previo.pendientesExtracto.map((m) => ({
    id: `prev-ext-${m.id}`,
    descripcion: m.descripcion,
    tipo: m.valor >= 0 ? "CBNL" : "PBNL",
    valorAbsoluto: Math.abs(m.valor),
    matched: false,
  }));

  const deLibro: PartidaAnterior[] = previo.pendientesLibro.map((m) => ({
    id: `prev-lib-${m.id}`,
    descripcion: m.descripcion,
    tipo: m.valor >= 0 ? "CLNB" : "PLNB",
    valorAbsoluto: Math.abs(m.valor),
    matched: false,
  }));

  const deArrastre: PartidaAnterior[] = previo.partidasConciliatorias.map((p) => ({
    ...p,
    id: `prev-arr-${p.id}`,
    matched: false,
  }));

  return [...deArrastre, ...deExtracto, ...deLibro];
}
