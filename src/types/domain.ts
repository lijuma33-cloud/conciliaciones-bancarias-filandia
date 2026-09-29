// ══════════════════════════════════════════════════════════════════
// Tipos de dominio — Conciliación Bancaria Municipio de Filandia
// ══════════════════════════════════════════════════════════════════

export type Banco = "Agrario" | "Davivienda" | "Bancolombia";

export type FormatoExtracto = "docx" | "xlsx" | "txt";

/** Movimiento normalizado, sin importar de qué banco/libro venga */
export interface Movimiento {
  id: string;
  fecha: string;          // ISO yyyy-mm-dd cuando se pueda resolver; si no, dd/mm
  descripcion: string;
  detalle?: string;
  valor: number;           // + = abono/débito contable, - = cargo/crédito contable
  saldo?: number;
  matched: boolean;
  origen: "extracto" | "libro";
}

export interface ExtractoNormalizado {
  banco: Banco;
  cliente: string;
  cuenta: string;
  periodo?: string;
  saldoAnterior: number;
  saldoActual: number;
  intereses: number;
  movimientos: Movimiento[];
}

export interface LibroNormalizado {
  saldoAnterior: number;
  saldoFinal: number;
  totalDebito: number;
  totalCredito: number;
  movimientos: Movimiento[];
}

/** Partida conciliatoria arrastrada de un período anterior (histórico) */
export type TipoPartidaAnterior = "CLNB" | "CBNL" | "PLNB" | "PBNL" | "REND";

export interface PartidaAnterior {
  id: string;
  descripcion: string;
  tipo: TipoPartidaAnterior;
  valorAbsoluto: number;
  matched: boolean;
}

export interface ReglasMatching {
  toleranciaPesos: number;      // legado usa 1
  permitirAgrupacion1aN: boolean;
  normalizarDescripcion: boolean;
}

export type EstadoConciliacion = "CONCILIADA" | "CON_DIFERENCIAS" | "PENDIENTE_REVISION";

export interface ResultadoConciliacion {
  cuentaId: string;
  periodo: string; // "2026-08"
  saldoLibro: number;
  saldoExtracto: number;
  intereses: number;
  cruzados: {
    extractoId: string;
    libroIds: string[];
    /** Dato del movimiento en el momento del cruce (no depende de que el navegador siga teniendo cargado el archivo original). */
    extractoFecha?: string;
    extractoDescripcion?: string;
    extractoValor?: number;
    libroDescripcion?: string; // resumen legible de los libroIds (unidos con " + " si son varios)
    manual?: boolean;
    usuario?: string;
    fecha?: string;
    justificacion?: string;
  }[];
  /** Partidas anteriores (de meses previos) que sí lograron cruzar contra un movimiento de este mes. */
  partidasCruzadas: {
    partidaId: string;
    partidaDescripcion: string;
    movimientoId: string;
    movimientoDescripcion: string;
    origen: "extracto" | "libro";
    valor: number;
  }[];
  /**
   * Cruces manuales flexibles: el usuario puede cruzar cualquier
   * combinación de movimientos pendientes (banco y/o libro) con partidas
   * anteriores que el sistema no cruzó solo, o con otros pendientes del
   * mismo lado. Solo trazabilidad — no cambia el saldo por sí mismo
   * (salvo cuando incluye una partida, que al quitarla de
   * partidasConciliatorias sí ajusta el saldo, igual que si el motor la
   * hubiera cruzado en FASE 1).
   */
  crucesManuales: {
    id: string;
    elementos: { texto: string; valor: number }[];
    usuario: string;
    fecha: string;
    justificacion?: string;
  }[];
  pendientesExtracto: Movimiento[];
  pendientesLibro: Movimiento[];
  partidasConciliatorias: PartidaAnterior[];
  saldoPendiente: number;
  estado: EstadoConciliacion;
  version: number;
  creadoPor: string;
  creadoEn: string; // ISO datetime
  verificado?: boolean;
  verificadoPor?: string;
  verificadoEn?: string; // ISO datetime
  migrada?: boolean; // true = viene del Seguimiento 2026, sin detalle de movimientos
}

export interface Cuenta {
  id: string;              // slug, ej. "8371-4-alumbrado-publico"
  item: number;             // orden en el Índice original
  banco: Banco;
  enlace: string;           // nombre tal como aparece en "Seguimiento"
  tipoRecurso: string;
  numeroCuenta?: string;
  formatoExtracto: FormatoExtracto;
  /** true = esta cuenta no tiene extracto bancario digital — solo libro SIGAM; el saldo del banco y los intereses se digitan a mano al conciliar. */
  sinExtracto?: boolean;
  reglasMatching: ReglasMatching;
  saldoInicialPendiente: boolean; // true = requiere carga manual de saldo/partidas antes de conciliar
  /** Referencia de solo lectura: lo que trajo la migración del Seguimiento 2026 (último cierre registrado ahí). */
  historicoMigrado?: {
    periodoCierre: string;
    saldoLibro: number | null;
    saldoExtracto: number | null;
    partidas: { descripcion: string; tipo: string; valorAbsoluto: number }[];
  };
}

export type Rol = "administrador" | "auxiliar_contable";

export interface Usuario {
  uid: string;
  nombre: string;
  correo: string;
  rol: Rol;
  estado: "activo" | "inactivo"; // activo = acceso completo a todas las cuentas
}
