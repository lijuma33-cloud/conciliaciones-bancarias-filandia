import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../firebase/AuthContext";
import { cuentasVisiblesPara, historicoDeCuenta, guardarCuenta, listarCuentas, borrarCuenta, registrarTrazabilidad } from "../firebase/datos";
import { fmtCOP } from "../utils/normalizacion";
import type { Banco, Cuenta, FormatoExtracto, EstadoConciliacion } from "../types/domain";

interface RegistroHistorico {
  periodo: string;
  estado?: EstadoConciliacion;
  saldoPendiente?: number;
  saldoLibro?: number;
  saldoExtracto?: number;
  actualizadoEn?: unknown;
  verificado?: boolean;
}

interface FilaCuenta extends Cuenta {
  estadoUltimoPeriodo?: EstadoConciliacion;
  ultimoPeriodo?: string;
  saldoActual?: number;
  saldoPendienteActual?: number;
  verificada?: boolean;
  historico: RegistroHistorico[];
}

function slug(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function nombreMes(periodo: string): string {
  const [a, m] = periodo.split("-");
  const fecha = new Date(Number(a), Number(m) - 1, 1);
  return fecha.toLocaleDateString("es-CO", { month: "short", year: "numeric" }).replace(".", "");
}

function periodoOrdenado(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

function porcentaje(parte: number, total: number): string {
  if (!total) return "0%";
  return `${((parte / total) * 100).toFixed(1)}%`;
}

export function PaginaDashboard() {
  const { perfil } = useAuth();
  const [filas, setFilas] = useState<FilaCuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null);
  const [filtroBanco, setFiltroBanco] = useState<string>("");
  const [mostrarNuevaCuenta, setMostrarNuevaCuenta] = useState(false);
  const [creandoCuenta, setCreandoCuenta] = useState(false);
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null);
  const [nuevaBanco, setNuevaBanco] = useState<Banco>("Agrario");
  const [nuevaEnlace, setNuevaEnlace] = useState("");
  const [nuevaTipoRecurso, setNuevaTipoRecurso] = useState("");
  const [nuevaNumeroCuenta, setNuevaNumeroCuenta] = useState("");
  const [nuevaFormato, setNuevaFormato] = useState<FormatoExtracto>("xlsx");

  useEffect(() => {
    if (!perfil) return;
    let activo = true;
    setCargando(true);
    setErrorCarga(null);
    (async () => {
      try {
        const cuentas = await cuentasVisiblesPara(perfil);
        const conEstado = await Promise.all(
          cuentas.map(async (c) => {
            const hist = (await historicoDeCuenta(c.id)) as RegistroHistorico[];
            const ordenado = [...hist].sort((a, b) => periodoOrdenado(a.periodo, b.periodo));
            const ultimo = ordenado[0];
            return {
              ...c,
              estadoUltimoPeriodo: ultimo?.estado,
              ultimoPeriodo: ultimo?.periodo,
              saldoActual: ultimo?.saldoExtracto,
              saldoPendienteActual: ultimo?.saldoPendiente,
              verificada: ultimo?.verificado,
              historico: ordenado,
            };
          })
        );
        if (activo) setFilas(conEstado);
      } catch (e) {
        if (activo) setErrorCarga(e instanceof Error ? e.message : "No fue posible cargar el dashboard.");
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  }, [perfil]);

  async function crearCuenta() {
    setErrorCuenta(null);
    if (!nuevaEnlace.trim()) { setErrorCuenta("El nombre de la cuenta es obligatorio."); return; }
    const id = slug(nuevaEnlace);
    const existentes = await listarCuentas();
    if (existentes.some((c) => c.id === id)) { setErrorCuenta("Ya existe una cuenta con un nombre muy similar — revisa el listado."); return; }
    setCreandoCuenta(true);
    try {
      const nueva: Cuenta = {
        id,
        item: existentes.length + 1,
        banco: nuevaBanco,
        enlace: nuevaEnlace.trim(),
        tipoRecurso: nuevaTipoRecurso.trim(),
        numeroCuenta: nuevaNumeroCuenta.trim() || undefined,
        formatoExtracto: nuevaFormato,
        reglasMatching: { toleranciaPesos: 1, permitirAgrupacion1aN: true, normalizarDescripcion: false },
        saldoInicialPendiente: true,
      };
      await guardarCuenta(nueva);
      setFilas((prev) => [...prev, { ...nueva, historico: [] }]);
      setMostrarNuevaCuenta(false);
      setNuevaEnlace(""); setNuevaTipoRecurso(""); setNuevaNumeroCuenta("");
    } finally {
      setCreandoCuenta(false);
    }
  }

  async function eliminarCuenta(f: Cuenta) {
    if (!perfil || perfil.rol !== "administrador") return;
    const confirmado = window.confirm(
      `¿Seguro que quieres borrar la cuenta "${f.banco} — ${f.enlace}"? ` +
      `Esto borra TODO su histórico de conciliaciones (todos los períodos y versiones) y no se puede deshacer.`
    );
    if (!confirmado) return;
    await borrarCuenta(f.id);
    await registrarTrazabilidad({ uid: perfil.uid, accion: "borrar_cuenta", cuentaId: f.id, detalle: `${f.banco} — ${f.enlace}` });
    setFilas((prev) => prev.filter((x) => x.id !== f.id));
  }

  const pendientesCarga = filas.filter((f) => f.saldoInicialPendiente);
  const cuentasConPeriodo = filas.filter((f) => f.historico.length > 0);
  const conciliadas = filas.filter((f) => f.estadoUltimoPeriodo === "CONCILIADA").length;
  const conDiferencias = filas.filter((f) => f.estadoUltimoPeriodo === "CON_DIFERENCIAS").length;
  const pendientesRevision = filas.filter((f) => f.estadoUltimoPeriodo === "PENDIENTE_REVISION").length;
  const sinConciliar = filas.filter((f) => !f.estadoUltimoPeriodo && !f.saldoInicialPendiente).length;

  const periodos = useMemo(() => {
    const mapa = new Map<string, { periodo: string; conciliadas: number; diferencias: number; revision: number; cuentas: number; pendiente: number }>();
    filas.forEach((f) => f.historico.forEach((h) => {
      const actual = mapa.get(h.periodo) ?? { periodo: h.periodo, conciliadas: 0, diferencias: 0, revision: 0, cuentas: 0, pendiente: 0 };
      actual.cuentas += 1;
      if (h.estado === "CONCILIADA") actual.conciliadas += 1;
      if (h.estado === "CON_DIFERENCIAS") actual.diferencias += 1;
      if (h.estado === "PENDIENTE_REVISION") actual.revision += 1;
      actual.pendiente += h.saldoPendiente ?? 0;
      mapa.set(h.periodo, actual);
    }));
    return [...mapa.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [filas]);

  const ultimoPeriodoGlobal = periodos[periodos.length - 1]?.periodo;
  const periodoActual = ultimoPeriodoGlobal ? periodos.find((p) => p.periodo === ultimoPeriodoGlobal) : undefined;
  const totalConciliaciones = periodos.reduce((s, p) => s + p.cuentas, 0);
  const totalConciliadasHistoricas = periodos.reduce((s, p) => s + p.conciliadas, 0);
  const totalDiferenciasHistoricas = periodos.reduce((s, p) => s + p.diferencias, 0);
  const totalPendienteHistorico = periodos.reduce((s, p) => s + p.pendiente, 0);

  const conSaldo = filas.filter((f) => f.saldoActual != null);
  const totalGeneral = conSaldo.reduce((s, f) => s + (f.saldoActual ?? 0), 0);
  const porBanco = Object.entries(
    conSaldo.reduce<Record<string, number>>((acc, f) => {
      acc[f.banco] = (acc[f.banco] ?? 0) + (f.saldoActual ?? 0);
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);
  const maxBanco = Math.max(1, ...porBanco.map(([, v]) => v));

  const cuentasConDiferencia = filas
    .filter((f) => f.estadoUltimoPeriodo === "CON_DIFERENCIAS" || (f.saldoPendienteActual ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.saldoPendienteActual ?? 0) - Math.abs(a.saldoPendienteActual ?? 0))
    .slice(0, 6);

  const cobertura = filas.length ? cuentasConPeriodo.length / filas.length : 0;
  const tasaUltimoPeriodo = periodoActual?.cuentas ? periodoActual.conciliadas / periodoActual.cuentas : 0;

  const filasFiltradas = filas.filter((f) => {
    const texto = filtroTexto.toLowerCase();
    const coincideTexto = !texto || f.enlace.toLowerCase().includes(texto) || f.banco.toLowerCase().includes(texto) || (f.numeroCuenta ?? "").toLowerCase().includes(texto);
    const coincideEstado = !filtroEstado || (filtroEstado === "PENDIENTE_CARGA" ? f.saldoInicialPendiente : f.estadoUltimoPeriodo === filtroEstado);
    const coincideBanco = !filtroBanco || f.banco === filtroBanco;
    return coincideTexto && coincideEstado && coincideBanco;
  });
  const bancosDisponibles = [...new Set(filas.map((f) => f.banco))].sort();

  if (cargando) return <p className="cargando">Cargando dashboard…</p>;

  if (errorCarga) return (
    <div className="banner-advertencia">
      <strong>No fue posible cargar el dashboard.</strong><br />
      {errorCarga}
    </div>
  );

  const tarjeta = (titulo: string, valor: string | number, detalle: string, clase = "", accion?: () => void) => (
    <button
      type="button"
      className={`tarjeta-dashboard ${clase}`}
      onClick={accion}
      style={{ textAlign: "left", width: "100%", cursor: accion ? "pointer" : "default" }}
    >
      <span className="dashboard-kpi-titulo">{titulo}</span>
      <strong className="dashboard-kpi-valor">{valor}</strong>
      <span className="dashboard-kpi-detalle">{detalle}</span>
    </button>
  );

  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <div>
          <div className="dashboard-eyebrow">CONTROL DE CONCILIACIONES</div>
          <h1>Dashboard financiero</h1>
          <p className="ayuda">Vista ejecutiva de cuentas, saldos bancarios, avance de conciliaciones y diferencias pendientes.</p>
        </div>
        <div className="dashboard-hero-meta">
          <span className="dashboard-pill">{filas.length} cuentas</span>
          {ultimoPeriodoGlobal && <span className="dashboard-pill">Último período: {nombreMes(ultimoPeriodoGlobal)}</span>}
          {perfil?.rol === "administrador" && <button className="boton-primario" onClick={() => setMostrarNuevaCuenta(true)}>+ Nueva cuenta</button>}
        </div>
      </div>

      <div className="dashboard-kpis">
        {tarjeta("Saldo bancario", fmtCOP(totalGeneral), `${conSaldo.length} cuentas con saldo`, "kpi-azul")}
        {tarjeta("Conciliadas", conciliadas, `${porcentaje(conciliadas, filas.length)} del total · último período`, "kpi-verde", () => setFiltroEstado("CONCILIADA"))}
        {tarjeta("Con diferencias", conDiferencias, `${fmtCOP(Math.abs(filas.reduce((s, f) => s + (f.saldoPendienteActual ?? 0), 0)))} pendientes`, "kpi-rojo", () => setFiltroEstado("CON_DIFERENCIAS"))}
        {tarjeta("En revisión", pendientesRevision, "requieren análisis", "kpi-naranja", () => setFiltroEstado("PENDIENTE_REVISION"))}
        {tarjeta("Sin carga inicial", pendientesCarga.length, "requieren saldo inicial", "kpi-gris", () => setFiltroEstado("PENDIENTE_CARGA"))}
      </div>

      <div className="dashboard-grid-principal">
        <section className="dashboard-panel dashboard-panel-grande">
          <div className="dashboard-panel-cabecera">
            <div>
              <h2>Estado de conciliación</h2>
              <p className="ayuda">Distribución del último período disponible.</p>
            </div>
            <strong className="dashboard-gran-cifra">{porcentaje(conciliadas, filas.length)}</strong>
          </div>
          <div className="dashboard-progress">
            <div className="dashboard-progress-ok" style={{ width: `${filas.length ? (conciliadas / filas.length) * 100 : 0}%` }} />
            <div className="dashboard-progress-dif" style={{ width: `${filas.length ? (conDiferencias / filas.length) * 100 : 0}%` }} />
            <div className="dashboard-progress-rev" style={{ width: `${filas.length ? (pendientesRevision / filas.length) * 100 : 0}%` }} />
          </div>
          <div className="dashboard-leyenda">
            <span><i className="dot dot-ok" /> Conciliadas <b>{conciliadas}</b></span>
            <span><i className="dot dot-dif" /> Diferencias <b>{conDiferencias}</b></span>
            <span><i className="dot dot-rev" /> Revisión <b>{pendientesRevision}</b></span>
            <span><i className="dot dot-neutral" /> Sin datos <b>{sinConciliar}</b></span>
          </div>
          {periodoActual && (
            <div className="dashboard-mini-grid">
              <div><span>Período</span><strong>{nombreMes(periodoActual.periodo)}</strong></div>
              <div><span>Cuentas procesadas</span><strong>{periodoActual.cuentas}</strong></div>
              <div><span>Saldo pendiente</span><strong>{fmtCOP(periodoActual.pendiente)}</strong></div>
              <div><span>Tasa de conciliación</span><strong>{porcentaje(periodoActual.conciliadas, periodoActual.cuentas)}</strong></div>
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-cabecera">
            <div>
              <h2>Calidad de cobertura</h2>
              <p className="ayuda">Cuentas que ya tienen al menos un período registrado.</p>
            </div>
            <strong className="dashboard-gran-cifra">{(cobertura * 100).toFixed(0)}%</strong>
          </div>
          <div className="dashboard-circular-simple" style={{ ["--cobertura" as string]: cobertura * 100 }}>
            <div className="dashboard-circular-centro"><strong>{cuentasConPeriodo.length}</strong><span>con histórico</span></div>
          </div>
          <p className="ayuda" style={{ marginTop: ".75rem" }}>{pendientesCarga.length} pendientes de carga inicial y {sinConciliar} sin conciliación registrada.</p>
        </section>
      </div>

      <div className="dashboard-grid-principal">
        <section className="dashboard-panel">
          <div className="dashboard-panel-cabecera">
            <div>
              <h2>Saldo por banco</h2>
              <p className="ayuda">Saldo del último extracto disponible por cuenta.</p>
            </div>
            <strong>{fmtCOP(totalGeneral)}</strong>
          </div>
          {porBanco.length === 0 ? <p className="ayuda">Todavía no hay saldos registrados.</p> : porBanco.map(([banco, monto]) => (
            <div className="dashboard-banco" key={banco}>
              <div className="dashboard-banco-linea"><span>{banco}</span><strong>{fmtCOP(monto)}</strong></div>
              <div className="dashboard-barra"><div style={{ width: `${(monto / maxBanco) * 100}%` }} /></div>
              <small>{porcentaje(monto, totalGeneral)} del saldo total · {filas.filter((f) => f.banco === banco).length} cuentas</small>
            </div>
          ))}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-cabecera">
            <div>
              <h2>Actividad histórica</h2>
              <p className="ayuda">Períodos y conciliaciones registradas.</p>
            </div>
            <strong>{periodos.length} períodos</strong>
          </div>
          {periodos.length === 0 ? <p className="ayuda">Aún no hay conciliaciones registradas.</p> : (
            <div className="dashboard-periodos">
              {periodos.slice(-6).map((p) => (
                <div key={p.periodo} className="dashboard-periodo">
                  <div className="dashboard-periodo-label">{nombreMes(p.periodo)}</div>
                  <div className="dashboard-periodo-barra"><div style={{ width: `${p.cuentas ? (p.conciliadas / p.cuentas) * 100 : 0}%` }} /></div>
                  <div className="dashboard-periodo-datos"><span>{p.conciliadas}/{p.cuentas} conciliadas</span><span>{p.diferencias} diferencias</span></div>
                </div>
              ))}
            </div>
          )}
          <div className="dashboard-resumen-historico">
            <span><b>{totalConciliaciones}</b> registros de período</span>
            <span><b>{totalConciliadasHistoricas}</b> conciliadas</span>
            <span><b>{totalDiferenciasHistoricas}</b> con diferencias</span>
          </div>
        </section>
      </div>

      {cuentasConDiferencia.length > 0 && (
        <section className="dashboard-panel">
          <div className="dashboard-panel-cabecera">
            <div>
              <h2>Atención prioritaria</h2>
              <p className="ayuda">Cuentas con diferencias o saldo pendiente en el último período.</p>
            </div>
            <span className="dashboard-badge-rojo">{cuentasConDiferencia.length} cuentas</span>
          </div>
          <div className="dashboard-alertas-lista">
            {cuentasConDiferencia.map((f) => (
              <Link to={`/cuentas/${f.id}`} className="dashboard-alerta" key={f.id}>
                <div><strong>{f.enlace}</strong><span>{f.banco} · {f.ultimoPeriodo ? nombreMes(f.ultimoPeriodo) : "sin período"}</span></div>
                <div className="dashboard-alerta-derecha">
                  <strong>{fmtCOP(Math.abs(f.saldoPendienteActual ?? 0))}</strong>
                  <span>{f.estadoUltimoPeriodo === "CON_DIFERENCIAS" ? "Con diferencias" : "Pendiente"}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {pendientesCarga.length > 0 && (
        <div className="banner-advertencia">
          <strong>{pendientesCarga.length} cuentas</strong> no tienen saldo inicial migrado y requieren carga manual antes de su primera conciliación.
        </div>
      )}

      <section className="dashboard-panel dashboard-cuentas-panel">
        <div className="dashboard-panel-cabecera">
          <div>
            <h2>Control de cuentas</h2>
            <p className="ayuda">Filtra por banco, estado o nombre para abrir directamente una cuenta o su histórico.</p>
          </div>
          <span className="dashboard-pill">Mostrando {filasFiltradas.length} de {filas.length}</span>
        </div>
        <div className="dashboard-filtros">
          <input className="filtro-cuentas" type="text" placeholder="Buscar cuenta, banco o número…" value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} />
          <select className="filtro-cuentas" value={filtroBanco} onChange={(e) => setFiltroBanco(e.target.value)}>
            <option value="">Todos los bancos</option>
            {bancosDisponibles.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {(filtroTexto || filtroBanco || filtroEstado) && <button onClick={() => { setFiltroTexto(""); setFiltroBanco(""); setFiltroEstado(null); }}>Limpiar filtros</button>}
        </div>
        {filtroEstado && <div className="dashboard-filtro-activo">Filtro activo: <strong>{filtroEstado === "PENDIENTE_CARGA" ? "Pendiente de carga" : filtroEstado.replace(/_/g, " ")}</strong></div>}
        <div style={{ overflowX: "auto" }}>
          <table className="tabla-cuentas">
            <thead><tr><th>Banco</th><th>Cuenta</th><th>Último período</th><th>Saldo</th><th>Diferencia</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {filasFiltradas.map((f) => (
                <tr key={f.id}>
                  <td>{f.banco}</td>
                  <td><strong>{f.enlace}</strong>{f.numeroCuenta && <small style={{ display: "block", color: "var(--gris-500)" }}>{f.numeroCuenta}</small>}</td>
                  <td>{f.ultimoPeriodo ? nombreMes(f.ultimoPeriodo) : "—"}</td>
                  <td>{f.saldoActual != null ? fmtCOP(f.saldoActual) : "—"}</td>
                  <td>{f.saldoPendienteActual != null ? fmtCOP(f.saldoPendienteActual) : "—"}</td>
                  <td>{f.saldoInicialPendiente ? <span className="badge badge-advertencia">Carga pendiente</span> : <span className={`badge badge-${(f.estadoUltimoPeriodo ?? "sin_datos").toLowerCase()}`}>{f.estadoUltimoPeriodo ?? "Sin conciliar"}</span>}</td>
                  <td>
                    <Link to={`/cuentas/${f.id}`}>Abrir</Link> · <Link to={`/cuentas/${f.id}/historico`}>Histórico</Link>
                    {perfil?.rol === "administrador" && (
                      <> · <button className="boton-enlace boton-peligro" onClick={() => eliminarCuenta(f)}>Borrar</button></>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filasFiltradas.length === 0 && <p className="ayuda">No hay cuentas que coincidan con los filtros.</p>}
      </section>

      <div className="dashboard-footer-metricas">
        <span>Histórico pendiente acumulado: <strong>{fmtCOP(totalPendienteHistorico)}</strong></span>
        <span>Conciliación último período: <strong>{(tasaUltimoPeriodo * 100).toFixed(1)}%</strong></span>
        <span>Última cobertura: <strong>{cuentasConPeriodo.length}/{filas.length}</strong></span>
      </div>

      {mostrarNuevaCuenta && (
        <div className="overlay-modal" onClick={() => setMostrarNuevaCuenta(false)}>
          <div className="modal-vista-previa" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "460px" }}>
            <div className="modal-cabecera"><h3>Nueva cuenta bancaria</h3><button className="modal-cerrar" onClick={() => setMostrarNuevaCuenta(false)}>✕</button></div>
            <div className="modal-cuerpo">
              <p className="ayuda">Queda marcada como pendiente de carga manual hasta que hagas su primera conciliación.</p>
              {errorCuenta && <p className="error">{errorCuenta}</p>}
              <div className="form-usuario" style={{ boxShadow: "none", border: "none", padding: 0 }}>
                <label>Banco<select value={nuevaBanco} onChange={(e) => setNuevaBanco(e.target.value as Banco)}><option value="Agrario">Agrario</option><option value="Davivienda">Davivienda</option><option value="Bancolombia">Bancolombia</option></select></label>
                <label>Nombre de la cuenta<input type="text" placeholder="Ej. 1234-5 Fondo Nuevo" value={nuevaEnlace} onChange={(e) => setNuevaEnlace(e.target.value)} /></label>
                <label>Tipo de recurso<input type="text" placeholder="Ej. Propios" value={nuevaTipoRecurso} onChange={(e) => setNuevaTipoRecurso(e.target.value)} /></label>
                <label>Número de cuenta<input type="text" placeholder="Opcional" value={nuevaNumeroCuenta} onChange={(e) => setNuevaNumeroCuenta(e.target.value)} /></label>
                <label>Formato del extracto<select value={nuevaFormato} onChange={(e) => setNuevaFormato(e.target.value as FormatoExtracto)}><option value="xlsx">Excel (.xlsx)</option><option value="docx">Word (.docx)</option><option value="txt">Texto (.txt)</option></select></label>
              </div>
            </div>
            <div className="modal-pie"><button onClick={() => setMostrarNuevaCuenta(false)}>Cancelar</button><button className="boton-primario" onClick={crearCuenta} disabled={creandoCuenta}>{creandoCuenta ? "Creando…" : "Crear cuenta"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
