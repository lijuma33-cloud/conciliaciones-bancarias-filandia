// ══════════════════════════════════════════════════════════════════
// Genera el XLSX de evidencia con la MISMA estructura que el formato
// impreso RE-GF-07: membrete, tabla CONCEPTO/LIBROS/EXTRACTO por
// categoría de partida, sumas iguales, diferencia, firmas.
//
// Limitación real: la librería SheetJS (xlsx) en su versión gratuita
// no soporta negrita ni bordes al escribir — solo la versión de pago
// (Pro) los permite. El contenido y el orden de las filas son
// idénticos al formato impreso; el PDF (botón "Imprimir / evidencia")
// es el que sí reproduce la tipografía y los estilos exactos.
// ══════════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";
import { ENTIDAD } from "../config/entidad";
import type { Cuenta, PartidaAnterior, ResultadoConciliacion } from "../types/domain";
import type { Firmante } from "../components/FormatoImpresion";
import { fmtCOP } from "./normalizacion";

const ETIQUETA_TIPO: Record<PartidaAnterior["tipo"], string> = {
  REND: "Rendimientos Financieros",
  CLNB: "Consignaciones en Libros y no Bancos",
  CBNL: "Consignaciones en Bancos y no Libros",
  PLNB: "Pagos en Libros y no Bancos",
  PBNL: "Pagos en Bancos y no Libros",
};
const ORDEN_TIPO: PartidaAnterior["tipo"][] = ["REND", "CLNB", "CBNL", "PLNB", "PBNL"];
const SIGNO_TIPO: Record<PartidaAnterior["tipo"], 1 | -1> = {
  REND: 1, CBNL: 1, PLNB: 1, CLNB: -1, PBNL: -1,
};

export function exportarConciliacionXlsx(
  cuenta: Cuenta,
  resultado: ResultadoConciliacion,
  firmantes: Firmante[] = []
) {
  const porTipo = (tipo: PartidaAnterior["tipo"]) => resultado.partidasConciliatorias.filter((p) => p.tipo === tipo);
  const totalTipo = (tipo: PartidaAnterior["tipo"]) => porTipo(tipo).reduce((s, p) => s + p.valorAbsoluto, 0);
  const sumasIgualesLibros =
    resultado.saldoLibro + ORDEN_TIPO.reduce((acc, t) => acc + SIGNO_TIPO[t] * totalTipo(t), 0);

  const filas: (string | number)[][] = [
    [ENTIDAD.encabezado1],
    [ENTIDAD.encabezado2 + " · " + ENTIDAD.encabezado3],
    [],
    [ENTIDAD.nombre],
    [`NIT. ${ENTIDAD.nit}`],
    ["CONCILIACIÓN BANCARIA"],
    [`Cuenta No. ${cuenta.numeroCuenta ?? "—"} · ${cuenta.enlace}`, "", `Período: ${resultado.periodo}`],
    resultado.verificado ? [`VERIFICADO por ${resultado.verificadoPor ?? ""} el ${resultado.verificadoEn ? new Date(resultado.verificadoEn).toLocaleDateString("es-CO") : ""}`] : [],
    [],
    ["CONCEPTO", "SALDO SEGÚN LIBROS", "SALDO SEGÚN EXTRACTO"],
    ["Saldo del período", fmtCOP(resultado.saldoLibro), fmtCOP(resultado.saldoExtracto)],
    ["PARTIDAS CONCILIATORIAS"],
  ];

  for (const tipo of ORDEN_TIPO) {
    filas.push([ETIQUETA_TIPO[tipo], fmtCOP(totalTipo(tipo)), "—"]);
    for (const p of porTipo(tipo)) {
      filas.push([`   ${p.descripcion}`, fmtCOP(p.valorAbsoluto), ""]);
    }
  }

  filas.push(
    ["SUMAS IGUALES", fmtCOP(sumasIgualesLibros), fmtCOP(resultado.saldoExtracto)],
    ["DIFERENCIA (debe ser $ 0,00)", fmtCOP(resultado.saldoPendiente), fmtCOP(resultado.saldoPendiente)],
    [],
    []
  );

  if (firmantes.length > 0) {
    filas.push(firmantes.map((f) => f.nombre || "___________________"));
    filas.push(firmantes.map((f) => f.rol));
    filas.push([]);
  }

  filas.push(
    [`Filandia, Quindío · Sistema de Conciliación Bancaria · ${resultado.periodo}`],
    [],
    [`NIT ${ENTIDAD.nit}`, "", `Código: ${ENTIDAD.formatoCodigo}`],
    [`Dirección: ${ENTIDAD.direccion}`, "", `Versión: ${ENTIDAD.formatoVersion}`],
    [ENTIDAD.web, "", `Fecha: ${new Date().toLocaleDateString("es-CO")}`]
  );

  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws["!cols"] = [{ wch: 45 }, { wch: 20 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conciliación");
  XLSX.writeFile(wb, `Conciliacion_${cuenta.id}_${resultado.periodo}_v${resultado.version}.xlsx`);
}
