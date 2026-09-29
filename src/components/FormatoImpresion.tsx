import { ENTIDAD } from "../config/entidad";
import { fmtCOP } from "../utils/normalizacion";
import type { Cuenta, PartidaAnterior, ResultadoConciliacion } from "../types/domain";

const ETIQUETA_TIPO: Record<PartidaAnterior["tipo"], string> = {
  REND: "Rendimientos Financieros",
  CLNB: "Consignaciones en Libros y no Bancos",
  CBNL: "Consignaciones en Bancos y no Libros",
  PLNB: "Pagos en Libros y no Bancos",
  PBNL: "Pagos en Bancos y no Libros",
};
const ORDEN_TIPO: PartidaAnterior["tipo"][] = ["REND", "CLNB", "CBNL", "PLNB", "PBNL"];
// Signo de cada categoría al pasar del saldo de libros al saldo de bancos:
// REND y CBNL suman; CLNB y PBNL restan; PLNB suma (corregido — antes
// PLNB/PBNL estaban invertidos).
const SIGNO_TIPO: Record<PartidaAnterior["tipo"], 1 | -1> = {
  REND: 1, CBNL: 1, PLNB: 1, CLNB: -1, PBNL: -1,
};

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function nombrePeriodo(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  return `${MESES[m - 1]?.replace(/^./, (c) => c.toUpperCase()) ?? m} ${a}`;
}

export interface Firmante {
  nombre: string;
  rol: string;
}

export function FormatoImpresion({
  cuenta,
  resultado,
  firmantes,
}: {
  cuenta: Cuenta;
  resultado: ResultadoConciliacion;
  firmantes: Firmante[];
}) {
  const porTipo = (tipo: PartidaAnterior["tipo"]) => resultado.partidasConciliatorias.filter((p) => p.tipo === tipo);
  const totalTipo = (tipo: PartidaAnterior["tipo"]) => porTipo(tipo).reduce((s, p) => s + p.valorAbsoluto, 0);

  const sumasIgualesLibros =
    resultado.saldoLibro +
    ORDEN_TIPO.reduce((acc, t) => acc + SIGNO_TIPO[t] * totalTipo(t), 0);

  return (
    <div className="formato-impresion">
      <div className="formato-encabezado">
        <div className="formato-lineas-decorativas">
          <span></span><span></span><span></span><span></span>
        </div>
        <img src="/logo-filandia.png" alt="Escudo Municipio de Filandia" className="formato-logo" />
        <div className="formato-membrete-texto">
          <strong>{ENTIDAD.encabezado1}</strong>
          <div>{ENTIDAD.encabezado2}</div>
          <div>{ENTIDAD.encabezado3}</div>
        </div>
      </div>
      <div className="formato-linea-horizontal"></div>

      <h2 className="formato-titulo-entidad">{ENTIDAD.nombre}</h2>
      <p className="formato-nit">NIT. {ENTIDAD.nit}</p>
      <h3 className="formato-titulo">CONCILIACIÓN BANCARIA</h3>

      <div className="formato-subtitulos">
        <span>Cuenta No. {cuenta.numeroCuenta ?? "—"} · {cuenta.enlace}</span>
        <span>Período: {nombrePeriodo(resultado.periodo)}</span>
      </div>

      {resultado.verificado && (
        <div className="sello-verificado">
          ✓ VERIFICADO — {resultado.verificadoPor}, {resultado.verificadoEn ? new Date(resultado.verificadoEn).toLocaleDateString("es-CO") : ""}
        </div>
      )}

      <table className="tabla-formato">
        <thead>
          <tr>
            <th className="col-concepto">CONCEPTO</th>
            <th>SALDO SEGÚN LIBROS</th>
            <th>SALDO SEGÚN EXTRACTO</th>
          </tr>
        </thead>
        <tbody>
          <tr className="fila-fuerte">
            <td>Saldo del período</td>
            <td>{fmtCOP(resultado.saldoLibro)}</td>
            <td>{fmtCOP(resultado.saldoExtracto)}</td>
          </tr>
          <tr className="fila-fuerte">
            <td colSpan={3}>PARTIDAS CONCILIATORIAS</td>
          </tr>
          {ORDEN_TIPO.map((tipo) => (
            <>
              <tr key={tipo} className="fila-fuerte">
                <td>{ETIQUETA_TIPO[tipo]}</td>
                <td>{fmtCOP(totalTipo(tipo))}</td>
                <td>—</td>
              </tr>
              {porTipo(tipo).map((p) => (
                <tr key={p.id} className="fila-detalle">
                  <td>{p.descripcion}</td>
                  <td>{fmtCOP(p.valorAbsoluto)}</td>
                  <td></td>
                </tr>
              ))}
            </>
          ))}
          <tr className="fila-sumas">
            <td>SUMAS IGUALES</td>
            <td>{fmtCOP(sumasIgualesLibros)}</td>
            <td>{fmtCOP(resultado.saldoExtracto)}</td>
          </tr>
          <tr className="fila-diferencia">
            <td>DIFERENCIA (debe ser $ 0,00)</td>
            <td>{fmtCOP(resultado.saldoPendiente)}</td>
            <td>{fmtCOP(resultado.saldoPendiente)}</td>
          </tr>
        </tbody>
      </table>

      <div className="formato-firmas">
        {firmantes.map((f, i) => (
          <div className="firma-bloque" key={i}>
            <strong>{f.nombre || "___________________"}</strong>
            <span>{f.rol}</span>
          </div>
        ))}
      </div>

      <p className="formato-pie-firma">
        Filandia, Quindío · Sistema de Conciliación Bancaria · {nombrePeriodo(resultado.periodo)}
      </p>

      <div className="formato-linea-horizontal formato-linea-pie"></div>
      <div className="formato-pie-pagina">
        <div className="pie-izquierda">
          <div>NIT {ENTIDAD.nit}</div>
          <div>Dirección: {ENTIDAD.direccion}</div>
          <div>{ENTIDAD.direccionExtra}</div>
          <div>Código portal C.A.M N° {ENTIDAD.codigoPortalCAM}</div>
          <div>Página WEB institucional: <span className="formato-link">{ENTIDAD.web}</span></div>
          <div>Correo electrónico: <span className="formato-link">{ENTIDAD.correo}</span></div>
        </div>
        <div className="pie-divisor"></div>
        <div className="pie-derecha">
          <div>Código: {ENTIDAD.formatoCodigo}</div>
          <div>Versión: {ENTIDAD.formatoVersion}</div>
          <div>Página 1 de 1</div>
          <div>Fecha: {new Date().toLocaleDateString("es-CO")}</div>
        </div>
      </div>
    </div>
  );
}
