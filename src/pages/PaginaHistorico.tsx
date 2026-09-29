import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { obtenerCuenta, historicoDeCuenta } from "../firebase/datos";
import { fmtCOP } from "../utils/normalizacion";
import type { Cuenta } from "../types/domain";

const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

interface PeriodoGuardado {
  periodo: string;
  estado?: string;
  version?: number;
  saldoPendiente?: number;
}

export function PaginaHistorico() {
  const { cuentaId } = useParams<{ cuentaId: string }>();
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [periodos, setPeriodos] = useState<PeriodoGuardado[]>([]);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!cuentaId) return;
    (async () => {
      const [c, hist] = await Promise.all([obtenerCuenta(cuentaId), historicoDeCuenta(cuentaId)]);
      setCuenta(c);
      setPeriodos(hist as PeriodoGuardado[]);
      setCargando(false);
    })();
  }, [cuentaId]);

  if (cargando) return <p className="cargando">Cargando histórico…</p>;
  if (!cuenta) return <p className="error">Cuenta no encontrada.</p>;

  const porMes = (mes: number) => periodos.find((p) => p.periodo === `${anio}-${String(mes).padStart(2, "0")}`);
  const aniosConDatos = [...new Set(periodos.map((p) => +p.periodo.split("-")[0]))].sort();

  return (
    <div className="pagina-historico">
      <h1>Histórico — {cuenta.enlace}</h1>
      <p className="subtitulo">{cuenta.banco}</p>

      {cuenta.historicoMigrado && (
        <div className="historico-migrado">
          <h3>Cifras migradas del Seguimiento 2026 (referencia)</h3>
          <p className="ayuda">
            Último cierre registrado ahí antes de usar este sistema: <strong>{cuenta.historicoMigrado.periodoCierre || "—"}</strong>.
            Esto es solo de consulta — no reemplaza una conciliación hecha en el sistema.
          </p>
          <table className="tabla-resumen">
            <tbody>
              <tr><td>Saldo según libro</td><td>{cuenta.historicoMigrado.saldoLibro != null ? fmtCOP(cuenta.historicoMigrado.saldoLibro) : "No migrado — cargar manualmente"}</td></tr>
              <tr><td>Saldo según extracto</td><td>{cuenta.historicoMigrado.saldoExtracto != null ? fmtCOP(cuenta.historicoMigrado.saldoExtracto) : "No migrado — cargar manualmente"}</td></tr>
            </tbody>
          </table>
          {cuenta.historicoMigrado.partidas.length > 0 && (
            <details>
              <summary>{cuenta.historicoMigrado.partidas.length} partidas conciliatorias migradas</summary>
              <table>
                <thead><tr><th>Tipo</th><th>Descripción</th><th>Valor</th></tr></thead>
                <tbody>
                  {cuenta.historicoMigrado.partidas.map((p, i) => (
                    <tr key={i}><td>{p.tipo}</td><td>{p.descripcion}</td><td>{fmtCOP(p.valorAbsoluto)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <div className="selector-anio">
        <label>
          Año
          <select value={anio} onChange={(e) => setAnio(+e.target.value)}>
            {[...new Set([...aniosConDatos, new Date().getFullYear()])].sort().map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>

      <h3>Meses conciliados en {anio}</h3>
      <div className="grid-meses">
        {MESES.map((nombre, i) => {
          const mes = i + 1;
          const p = porMes(mes);
          return (
            <div key={mes} className={`mes-celda ${p ? `estado-${(p.estado ?? "").toLowerCase()}` : "mes-vacio"}`}>
              <span className="mes-nombre">{nombre}</span>
              {p ? (
                <>
                  <span className="mes-estado">{p.estado ?? "guardado"}</span>
                  {p.saldoPendiente != null && <span className="mes-saldo">{fmtCOP(p.saldoPendiente)}</span>}
                  <Link to={`/cuentas/${cuenta.id}?anio=${anio}&mes=${mes}`}>Ver</Link>
                </>
              ) : (
                <span className="mes-sin-hacer">Sin conciliar</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
