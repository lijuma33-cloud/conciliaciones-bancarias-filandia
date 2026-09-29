import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { useAuth } from "../firebase/AuthContext";
import {
  obtenerCuenta,
  obtenerUltimaConciliacion,
  guardarNuevaVersionConciliacion,
  guardarCuenta,
  borrarConciliacion,
  registrarTrazabilidad,
  periodoAnterior,
} from "../firebase/datos";
import { parseLibroSigam } from "../parsers/parseLibroSigam";
import { parseExtractoBancolombia } from "../parsers/parseExtractoBancolombia";
import { parseExtractoDavivienda, leerTxtLatin1 } from "../parsers/parseExtractoDavivienda";
import { parseExtractoAgrario } from "../parsers/parseExtractoAgrario";
import { reconciliar, recalcularSaldoPendiente } from "../engine/reconciliar";
import { derivarPartidasAnteriores } from "../engine/partidasAnteriores";
import { exportarConciliacionXlsx } from "../utils/exportarXlsx";
import { FormatoImpresion, type Firmante } from "../components/FormatoImpresion";
import { FIRMANTES_DEFECTO } from "../config/entidad";
import { fmtCOP, parseMonto } from "../utils/normalizacion";
import type { Cuenta, ExtractoNormalizado, LibroNormalizado, Movimiento, PartidaAnterior, ResultadoConciliacion } from "../types/domain";

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export function PaginaCuenta() {
  const { cuentaId } = useParams<{ cuentaId: string }>();
  const [searchParams] = useSearchParams();
  const { perfil } = useAuth();
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [anio, setAnio] = useState(() => +(searchParams.get("anio") ?? new Date().getFullYear()));
  const [mes, setMes] = useState(() => +(searchParams.get("mes") ?? new Date().getMonth() + 1));
  const [extracto, setExtracto] = useState<ExtractoNormalizado | null>(null);
  const [libro, setLibro] = useState<LibroNormalizado | null>(null);
  // Cuentas sin extracto bancario digital (cuenta.sinExtracto): en vez de
  // subir un archivo, el saldo del banco y los intereses del período se
  // digitan a mano.
  const [saldoExtractoManual, setSaldoExtractoManual] = useState("");
  const [interesesManual, setInteresesManual] = useState("");
  const [advertenciasParseo, setAdvertenciasParseo] = useState<string[]>([]);
  const [partidasAnteriores, setPartidasAnteriores] = useState<PartidaAnterior[]>([]);
  const [resultado, setResultado] = useState<ResultadoConciliacion | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Conciliación manual: selección en curso
  const [selExtracto, setSelExtracto] = useState<Set<string>>(new Set());
  const [selLibro, setSelLibro] = useState<Set<string>>(new Set());
  const [selPartidas, setSelPartidas] = useState<Set<string>>(new Set());
  const [justificacion, setJustificacion] = useState("");

  // Clasificación manual de una diferencia como partida conciliatoria
  const [claseTipo, setClaseTipo] = useState<Record<string, PartidaAnterior["tipo"]>>({});
  const [claseMotivo, setClaseMotivo] = useState<Record<string, string>>({});

  // Agregar a mano una partida conciliatoria de un mes anterior que por
  // algún motivo no quedó cargada automáticamente (p. ej. una diferencia
  // real de un período viejo que nunca se clasificó en su momento).
  const [nuevaPartidaTipo, setNuevaPartidaTipo] = useState<PartidaAnterior["tipo"] | "">("");
  const [nuevaPartidaDescripcion, setNuevaPartidaDescripcion] = useState("");
  const [nuevaPartidaValor, setNuevaPartidaValor] = useState("");

  // Formato impreso: firmantes editables
  const [firmantes, setFirmantes] = useState<Firmante[]>(FIRMANTES_DEFECTO.map((f) => ({ ...f })));
  const [mostrarVistaPrevia, setMostrarVistaPrevia] = useState(false);

  const periodo = `${anio}-${String(mes).padStart(2, "0")}`;

  useEffect(() => {
    if (!cuentaId) return;
    obtenerCuenta(cuentaId).then(setCuenta);
  }, [cuentaId]);

  // Al entrar a la cuenta o cambiar de año/mes: si ese período ya tiene
  // una conciliación guardada (hecha en el sistema o migrada del
  // Seguimiento 2026), se carga y se muestra directamente — antes había
  // que subir los archivos de nuevo aunque el mes ya estuviera hecho.
  useEffect(() => {
    if (!cuentaId) return;
    const periodoBuscado = `${anio}-${String(mes).padStart(2, "0")}`;
    obtenerUltimaConciliacion(cuentaId, periodoBuscado).then((r) => {
      setResultado(r);
      setExtracto(null);
      setLibro(null);
    });
    // Partidas anteriores: se cargan apenas se entra al período (no solo
    // al ejecutar), para que se puedan revisar y agregar otras a mano
    // ANTES de conciliar — así el motor también las intenta cruzar.
    obtenerUltimaConciliacion(cuentaId, periodoAnterior(periodoBuscado)).then((prev) => {
      setPartidasAnteriores(derivarPartidasAnteriores(prev));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentaId, anio, mes]);

  async function onArchivoExtracto(file: File) {
    if (!cuenta) return;
    setError(null);
    try {
      if (cuenta.formatoExtracto === "xlsx") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        setExtracto(parseExtractoBancolombia(wb));
        setAdvertenciasParseo([]);
      } else if (cuenta.formatoExtracto === "txt") {
        const texto = await leerTxtLatin1(file);
        setExtracto(parseExtractoDavivienda(texto));
        setAdvertenciasParseo([]);
      } else {
        const { extracto: ext, advertencias } = await parseExtractoAgrario(file);
        setExtracto(ext);
        setAdvertenciasParseo(advertencias.map((a) => a.mensaje));
      }
    } catch (e) {
      setError(`No se pudo leer el extracto: ${(e as Error).message}`);
    }
  }

  async function onArchivoLibro(file: File) {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setLibro(parseLibroSigam(wb));
    } catch (e) {
      setError(`No se pudo leer el libro contable: ${(e as Error).message}`);
    }
  }

  async function ejecutarConciliacion() {
    if (!cuenta || !libro || !perfil) return;
    if (cuenta.sinExtracto) {
      if (saldoExtractoManual.trim() === "") return;
    } else if (!extracto) {
      return;
    }
    setError(null);

    const anterior = await obtenerUltimaConciliacion(cuenta.id, periodo);
    const version = (anterior?.version ?? 0) + 1;

    const res = reconciliar({
      cuentaId: cuenta.id,
      periodo,
      movimientosExtracto: cuenta.sinExtracto ? [] : extracto!.movimientos,
      movimientosLibro: libro.movimientos,
      saldoLibro: libro.saldoFinal,
      saldoExtracto: cuenta.sinExtracto ? parseMonto(saldoExtractoManual) : extracto!.saldoActual,
      intereses: cuenta.sinExtracto ? parseMonto(interesesManual || "0") : extracto!.intereses,
      partidasAnteriores, // ya cargadas al entrar al período + las agregadas a mano
      reglas: cuenta.reglasMatching,
      creadoPor: perfil.uid,
      version,
    });
    setResultado(res);
  }

  /** Solo el administrador: marca/desmarca una cuenta como "sin extracto bancario digital". */
  async function toggleSinExtracto() {
    if (!cuenta || !perfil || perfil.rol !== "administrador") return;
    const actualizada: Cuenta = { ...cuenta, sinExtracto: !cuenta.sinExtracto };
    await guardarCuenta(actualizada);
    setCuenta(actualizada);
  }

  function toggleSelExtracto(id: string) {
    setSelExtracto((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelLibro(id: string) {
    setSelLibro((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelPartida(id: string) {
    setSelPartidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Cruza a mano cualquier combinación de movimientos pendientes
   * (banco y/o libro) con partidas anteriores que el sistema no cruzó
   * solo, o con otros pendientes del mismo lado — no solo banco contra
   * libro como antes. Si se incluye una partida anterior, se quita de
   * partidasConciliatorias (deja de contar en el saldo pendiente, igual
   * que si el motor la hubiera cruzado en FASE 1); los movimientos solo
   * dejan trazabilidad (no cambian el saldo, ya estaban en los totales).
   */
  function confirmarCruceManual() {
    if (!resultado || !perfil) return;
    const total = selExtracto.size + selLibro.size + selPartidas.size;
    if (total < 2) return;

    const movsExtracto = resultado.pendientesExtracto.filter((m) => selExtracto.has(m.id));
    const movsLibro = resultado.pendientesLibro.filter((m) => selLibro.has(m.id));
    const partidas = resultado.partidasConciliatorias.filter((p) => selPartidas.has(p.id));

    const elementos = [
      ...movsExtracto.map((m) => ({ texto: `Banco: ${m.fecha} — ${m.descripcion}`, valor: m.valor })),
      ...movsLibro.map((m) => ({ texto: `Libro: ${m.fecha} — ${m.descripcion}`, valor: m.valor })),
      ...partidas.map((p) => ({ texto: `Partida anterior (${p.tipo}): ${p.descripcion}`, valor: p.valorAbsoluto })),
    ];

    setResultado(
      recalcularSaldoPendiente({
        ...resultado,
        pendientesExtracto: resultado.pendientesExtracto.filter((m) => !selExtracto.has(m.id)),
        pendientesLibro: resultado.pendientesLibro.filter((m) => !selLibro.has(m.id)),
        partidasConciliatorias: resultado.partidasConciliatorias.filter((p) => !selPartidas.has(p.id)),
        crucesManuales: [
          ...resultado.crucesManuales,
          {
            id: `manual-cruce-${Date.now()}`,
            elementos,
            usuario: perfil.nombre,
            fecha: new Date().toISOString(),
            justificacion: justificacion.trim() || undefined,
          },
        ],
      })
    );
    setSelExtracto(new Set());
    setSelLibro(new Set());
    setSelPartidas(new Set());
    setJustificacion("");
  }

  /** Clasifica manualmente una diferencia pendiente como partida conciliatoria, con motivo. */
  function clasificarComoPartida(mov: Movimiento, origen: "extracto" | "libro") {
    if (!resultado) return;
    const tipoElegido = claseTipo[mov.id];
    if (!tipoElegido) return;
    const motivo = (claseMotivo[mov.id] ?? "").trim();

    const nuevaPartida: PartidaAnterior = {
      id: `manual-${mov.id}`,
      descripcion: motivo ? `${mov.descripcion} — ${motivo}` : mov.descripcion,
      tipo: tipoElegido,
      valorAbsoluto: Math.abs(mov.valor),
      matched: true, // ya resuelta por esta clasificación; no vuelve a ofrecerse para cruce manual
    };

    setResultado(
      recalcularSaldoPendiente({
        ...resultado,
        pendientesExtracto: origen === "extracto" ? resultado.pendientesExtracto.filter((m) => m.id !== mov.id) : resultado.pendientesExtracto,
        pendientesLibro: origen === "libro" ? resultado.pendientesLibro.filter((m) => m.id !== mov.id) : resultado.pendientesLibro,
        partidasConciliatorias: [...resultado.partidasConciliatorias, nuevaPartida],
      })
    );
    setClaseTipo((p) => { const n = { ...p }; delete n[mov.id]; return n; });
    setClaseMotivo((p) => { const n = { ...p }; delete n[mov.id]; return n; });
  }

  /**
   * Agrega manualmente una partida conciliatoria de un mes anterior que
   * por algún motivo no se cargó sola (mes anterior con un error, una
   * partida vieja que se quedó fuera, etc.) — ANTES de ejecutar la
   * conciliación, para que el motor también la tome en cuenta e intente
   * cruzarla contra los movimientos de este mes (igual que las demás
   * partidas anteriores). Si no cruza, queda como partida conciliatoria
   * pendiente para el mes siguiente.
   */
  function agregarPartidaAnteriorManual() {
    if (!nuevaPartidaTipo) return;
    const valor = Math.abs(parseMonto(nuevaPartidaValor));
    if (!valor) return;

    const nuevaPartida: PartidaAnterior = {
      id: `manual-anterior-${Date.now()}`,
      descripcion: nuevaPartidaDescripcion.trim() || "Partida anterior agregada manualmente",
      tipo: nuevaPartidaTipo,
      valorAbsoluto: valor,
      matched: false,
    };

    setPartidasAnteriores((prev) => [...prev, nuevaPartida]);
    setNuevaPartidaTipo("");
    setNuevaPartidaDescripcion("");
    setNuevaPartidaValor("");
  }

  /** Quita una partida anterior agregada a mano (antes de ejecutar la conciliación). */
  function quitarPartidaAnteriorManual(id: string) {
    setPartidasAnteriores((prev) => prev.filter((p) => p.id !== id));
  }

  const OPCIONES_TIPO: { value: PartidaAnterior["tipo"]; label: string }[] = [
    { value: "CLNB", label: "Consignaciones en libros y no bancos" },
    { value: "CBNL", label: "Consignaciones en bancos y no libros" },
    { value: "PLNB", label: "Pagos en libros y no bancos" },
    { value: "PBNL", label: "Pagos en bancos y no libros" },
  ];

  // Partidas anteriores que el motor no logró cruzar solo (matched:
  // false) — candidatas a cruzarse a mano con un movimiento pendiente.
  // Las que ya vienen de "Clasificar como partida" quedan con
  // matched: true (ya están resueltas) y no aparecen aquí.
  const partidasDisponibles = resultado?.partidasConciliatorias.filter((p) => !p.matched) ?? [];

  function marcarVerificado() {
    // Solo el administrador puede verificar — el botón ya está oculto
    // para los demás roles en el JSX, esta comprobación es el respaldo
    // en el código (la regla de Firestore es el respaldo real, ya que
    // esto solo protege la UI).
    if (!resultado || !perfil || perfil.rol !== "administrador") return;
    setResultado({
      ...resultado,
      verificado: !resultado.verificado,
      verificadoPor: !resultado.verificado ? perfil.nombre : undefined,
      verificadoEn: !resultado.verificado ? new Date().toISOString() : undefined,
    });
  }

  async function guardar() {
    if (!resultado || !perfil || !cuenta) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarNuevaVersionConciliacion(resultado);
      const cruceManuales = resultado.cruzados.filter((c) => c.manual);
      await registrarTrazabilidad({
        uid: perfil.uid,
        accion: "guardar_conciliacion",
        cuentaId: cuenta.id,
        periodo,
        detalle: `versión ${resultado.version}, estado ${resultado.estado}, ${cruceManuales.length} cruces manuales`,
      });
    } catch (e) {
      // Antes un fallo aquí era silencioso (el botón volvía a la normalidad sin avisar).
      setError(`No se pudo guardar la conciliación: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Borra por completo la conciliación de este período (todas las
   * versiones guardadas en Firestore, si las hay, más lo que esté
   * montado en pantalla) — para deshacer un montaje o guardado por
   * error. Solo administrador; pide confirmación porque es irreversible.
   */
  async function borrarConciliacionActual() {
    if (!cuenta || !perfil || perfil.rol !== "administrador") return;
    const confirmado = window.confirm(
      `¿Seguro que quieres borrar la conciliación de ${cuenta.banco} — ${periodo}? ` +
      `Esto borra TODAS las versiones guardadas de este período y no se puede deshacer.`
    );
    if (!confirmado) return;

    setBorrando(true);
    try {
      await borrarConciliacion(cuenta.id, periodo);
      await registrarTrazabilidad({
        uid: perfil.uid,
        accion: "borrar_conciliacion",
        cuentaId: cuenta.id,
        periodo,
      });
      setResultado(null);
      setExtracto(null);
      setLibro(null);
      setSaldoExtractoManual("");
      setInteresesManual("");
    } finally {
      setBorrando(false);
    }
  }

  if (!cuenta) return <p className="cargando">Cargando cuenta…</p>;

  return (
    <div className="pagina-cuenta">
      <h1>{cuenta.enlace}</h1>
      <p className="subtitulo">
        {cuenta.banco} · {cuenta.sinExtracto ? "sin extracto bancario digital (solo libro)" : `formato de extracto: ${cuenta.formatoExtracto}`} ·{" "}
        <Link to={`/cuentas/${cuenta.id}/historico`}>Ver histórico</Link>
        {perfil?.rol === "administrador" && (
          <>
            {" · "}
            <button className="boton-enlace" onClick={toggleSinExtracto}>
              {cuenta.sinExtracto ? "Esta cuenta sí tiene extracto (quitar modo manual)" : "Esta cuenta no tiene extracto bancario"}
            </button>
          </>
        )}
      </p>

      {cuenta.saldoInicialPendiente && (
        <div className="banner-advertencia">
          Esta cuenta no tiene saldo inicial migrado del Seguimiento 2026. La primera conciliación
          que guardes aquí no tendrá partidas anteriores de arrastre — verifica el saldo de apertura
          con el contador antes de considerarla definitiva.
        </div>
      )}

      <div className="selector-periodo">
        <label>
          Año
          <input type="number" value={anio} onChange={(e) => setAnio(+e.target.value)} />
        </label>
        <label>
          Mes
          <select value={mes} onChange={(e) => setMes(+e.target.value)}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="zona-carga">
        {cuenta.sinExtracto ? (
          <div className="dropzone">
            <p className="ayuda" style={{ marginTop: 0 }}>
              Esta cuenta no tiene extracto bancario digital — digita el saldo según el banco y
              los intereses del período (0 si no aplica). El sistema conciliará el libro SIGAM
              contra estos valores y las partidas anteriores.
            </p>
            <label>
              Saldo según banco al cierre del período
              <input type="text" placeholder="Ej: 1.234.567" value={saldoExtractoManual} onChange={(e) => setSaldoExtractoManual(e.target.value)} />
            </label>
            <label>
              Intereses del período
              <input type="text" placeholder="Ej: 0" value={interesesManual} onChange={(e) => setInteresesManual(e.target.value)} />
            </label>
          </div>
        ) : (
          <label className="dropzone">
            Extracto bancario ({cuenta.formatoExtracto})
            <input
              type="file"
              accept={cuenta.formatoExtracto === "docx" ? ".docx" : cuenta.formatoExtracto === "txt" ? ".txt" : ".xlsx,.xls"}
              onChange={(e) => e.target.files?.[0] && onArchivoExtracto(e.target.files[0])}
            />
          </label>
        )}
        <label className="dropzone">
          Libro contable (Excel SIGAM)
          <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onArchivoLibro(e.target.files[0])} />
        </label>
      </div>

      {advertenciasParseo.map((a, i) => (
        <p key={i} className="advertencia-linea">⚠ {a}</p>
      ))}
      {error && <p className="error">{error}</p>}

      <div className="partidas-anteriores-editor">
        <h3>Partidas anteriores</h3>
        <p className="ayuda">
          Se cargan automáticamente del cierre del mes previo. Al ejecutar la conciliación, el
          sistema intenta cruzarlas contra los movimientos de este mes — si cruzan, quedan
          resueltas; si no, siguen como partida conciliatoria pendiente para el mes siguiente. Si
          sabes de alguna partida anterior que por algún motivo no se cargó sola, agrégala aquí
          <strong> antes</strong> de ejecutar la conciliación.
        </p>
        {partidasAnteriores.length > 0 && (
          <table>
            <thead><tr><th>Tipo</th><th>Descripción</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              {partidasAnteriores.map((p) => (
                <tr key={p.id}>
                  <td>{p.tipo}</td><td>{p.descripcion}</td><td>{fmtCOP(p.valorAbsoluto)}</td>
                  <td>
                    {p.id.startsWith("manual-anterior-") && (
                      <button onClick={() => quitarPartidaAnteriorManual(p.id)}>Quitar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="clasificar-partida">
          <select
            value={nuevaPartidaTipo}
            onChange={(e) => setNuevaPartidaTipo(e.target.value as PartidaAnterior["tipo"])}
          >
            <option value="">Tipo…</option>
            {OPCIONES_TIPO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="text"
            placeholder="Descripción / motivo"
            value={nuevaPartidaDescripcion}
            onChange={(e) => setNuevaPartidaDescripcion(e.target.value)}
          />
          <input
            type="text"
            placeholder="Valor (ej: 500.000)"
            value={nuevaPartidaValor}
            onChange={(e) => setNuevaPartidaValor(e.target.value)}
          />
          <button disabled={!nuevaPartidaTipo || !nuevaPartidaValor} onClick={agregarPartidaAnteriorManual}>
            Agregar partida anterior
          </button>
        </div>
      </div>

      {libro && (cuenta.sinExtracto ? true : !!extracto) && (
        <div className="vista-previa">
          <h3>Vista previa</h3>
          <table>
            <tbody>
              {cuenta.sinExtracto ? (
                <tr><td>Saldo según banco (digitado)</td><td>{fmtCOP(parseMonto(saldoExtractoManual || "0"))}</td></tr>
              ) : (
                <>
                  <tr><td>Movimientos extracto</td><td>{extracto!.movimientos.length}</td></tr>
                  <tr><td>Saldo anterior / actual (extracto)</td><td>{fmtCOP(extracto!.saldoAnterior)} / {fmtCOP(extracto!.saldoActual)}</td></tr>
                </>
              )}
              <tr><td>Movimientos libro</td><td>{libro.movimientos.length}</td></tr>
              <tr><td>Saldo anterior / final (libro)</td><td>{fmtCOP(libro.saldoAnterior)} / {fmtCOP(libro.saldoFinal)}</td></tr>
            </tbody>
          </table>
          <button onClick={ejecutarConciliacion} disabled={cuenta.sinExtracto && saldoExtractoManual.trim() === ""}>
            Ejecutar conciliación
          </button>
        </div>
      )}

      {resultado && (
        <div className="resultado-conciliacion no-imprimir">
          <h3>Resultado — versión {resultado.version}</h3>
          {resultado.migrada && (
            <p className="banner-advertencia">
              📋 Esta conciliación viene migrada del Seguimiento 2026 (solo el resumen por categoría,
              sin el detalle de cada movimiento). Si subes el extracto y el libro de este mes y le das
              "Ejecutar conciliación", se reemplaza por una versión nueva con todo el detalle.
            </p>
          )}
          <p className={`estado-grande estado-${resultado.estado.toLowerCase()}`}>{resultado.estado}</p>

          <table className="tabla-resumen">
            <tbody>
              <tr><td>Saldo según libro</td><td>{fmtCOP(resultado.saldoLibro)}</td></tr>
              <tr><td>Saldo según extracto</td><td>{fmtCOP(resultado.saldoExtracto)}</td></tr>
              <tr><td>Intereses</td><td>{fmtCOP(resultado.intereses)}</td></tr>
              <tr><td>Movimientos cruzados</td><td>{resultado.cruzados.length} ({resultado.cruzados.filter(c=>c.manual).length} manuales)</td></tr>
              <tr><td>Pendientes banco</td><td>{resultado.pendientesExtracto.length}</td></tr>
              <tr><td>Pendientes libro</td><td>{resultado.pendientesLibro.length}</td></tr>
              <tr><td><strong>Saldo pendiente</strong></td><td><strong>{fmtCOP(resultado.saldoPendiente)}</strong></td></tr>
            </tbody>
          </table>

          {(resultado.cruzados.length > 0 || (resultado.partidasCruzadas ?? []).length > 0 || (resultado.crucesManuales ?? []).length > 0) && (
            <div className="informe-cruce">
              <h4>Informe del cruce</h4>

              {resultado.cruzados.length > 0 && (
                <>
                  <p className="ayuda">Movimientos del banco cruzados contra el libro:</p>
                  <table>
                    <thead><tr><th>Banco</th><th>Libro</th><th>Origen</th></tr></thead>
                    <tbody>
                      {resultado.cruzados.map((c, i) => {
                        // Datos guardados directamente en el momento del cruce (siempre
                        // correctos). Si la conciliación se guardó antes de este cambio
                        // y no los tiene, se busca por id en lo que haya cargado ahora
                        // (puede fallar si el navegador ya no tiene esos archivos).
                        const bancoTexto = c.extractoDescripcion
                          ? `${c.extractoFecha ?? ""} — ${c.extractoDescripcion} — ${fmtCOP(c.extractoValor ?? 0)}`
                          : (() => {
                              const em = extracto?.movimientos.find((m) => m.id === c.extractoId);
                              return em ? `${em.fecha} — ${em.descripcion} — ${fmtCOP(em.valor)}` : c.extractoId;
                            })();
                        const libroTexto = c.libroDescripcion ?? (() => {
                          const lms = c.libroIds
                            .map((id) => libro?.movimientos.find((m) => m.id === id))
                            .filter((m): m is Movimiento => !!m);
                          return lms.length > 0 ? lms.map((m) => `${m.fecha} — ${m.descripcion} — ${fmtCOP(m.valor)}`).join(" + ") : c.libroIds.join(", ");
                        })();
                        return (
                          <tr key={i}>
                            <td>{bancoTexto}</td>
                            <td>{libroTexto}</td>
                            <td>{c.manual ? `Manual (${c.usuario})` : "Automático"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {(resultado.partidasCruzadas ?? []).length > 0 && (
                <>
                  <p className="ayuda">Partidas anteriores que cruzaron con un movimiento de este mes:</p>
                  <table>
                    <thead><tr><th>Partida anterior</th><th>Cruzó con</th><th>Valor</th></tr></thead>
                    <tbody>
                      {(resultado.partidasCruzadas ?? []).map((pc, i) => (
                        <tr key={i}>
                          <td>{pc.partidaDescripcion}</td>
                          <td>{pc.origen === "extracto" ? "Banco" : "Libro"}: {pc.movimientoDescripcion}</td>
                          <td>{fmtCOP(pc.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {(resultado.crucesManuales ?? []).length > 0 && (
                <>
                  <p className="ayuda">Cruces manuales (banco / libro / partidas anteriores, mezclados a mano):</p>
                  <table>
                    <thead><tr><th>Elementos cruzados</th><th>Usuario</th><th>Justificación</th></tr></thead>
                    <tbody>
                      {(resultado.crucesManuales ?? []).map((cm) => (
                        <tr key={cm.id}>
                          <td>{cm.elementos.map((e) => `${e.texto} — ${fmtCOP(e.valor)}`).join("; ")}</td>
                          <td>{cm.usuario}<br /><small>{new Date(cm.fecha).toLocaleString("es-CO")}</small></td>
                          <td>{cm.justificacion ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {(resultado.pendientesExtracto.length > 0 || resultado.pendientesLibro.length > 0 || partidasDisponibles.length > 0) && (
                <p className="ayuda">
                  Quedaron {resultado.pendientesExtracto.length + resultado.pendientesLibro.length} movimiento(s) y{" "}
                  {partidasDisponibles.length} partida(s) anterior(es) sin cruzar — más abajo, en
                  "Conciliación manual", los puedes seleccionar y cruzar a mano (entre ellos o con partidas
                  anteriores), o clasificar los movimientos como partida.
                </p>
              )}
            </div>
          )}

          <div className="firmantes-editor">
            <h4>Firmantes (para el formato impreso)</h4>
            {firmantes.map((f, i) => (
              <div key={i} className="firmante-linea">
                <input
                  type="text"
                  placeholder={`Nombre (${f.rol})`}
                  value={f.nombre}
                  onChange={(e) => setFirmantes((prev) => prev.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))}
                />
                <span>{f.rol}</span>
              </div>
            ))}
          </div>

          <div className="acciones-resultado">
            <button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar conciliación"}</button>
            {perfil?.rol === "administrador" ? (
              <button onClick={marcarVerificado} className={resultado.verificado ? "boton-verificado-activo" : ""}>
                {resultado.verificado ? "✓ Verificado" : "Marcar como verificado"}
              </button>
            ) : (
              resultado.verificado && <span className="boton-verificado-activo">✓ Verificado (por {resultado.verificadoPor})</span>
            )}
            <button onClick={() => setMostrarVistaPrevia(true)}>Vista previa / imprimir</button>
            <button onClick={() => exportarConciliacionXlsx(cuenta, resultado, firmantes)}>Exportar XLSX</button>
            {perfil?.rol === "administrador" && (
              <button onClick={borrarConciliacionActual} disabled={borrando} className="boton-peligro">
                {borrando ? "Borrando…" : "Borrar conciliación"}
              </button>
            )}
          </div>

          {(resultado.pendientesExtracto.length > 0 || resultado.pendientesLibro.length > 0 || partidasDisponibles.length > 0) && (
            <div className="pendientes">
              <h4>Conciliación manual</h4>
              <p className="ayuda">
                <strong>Cruzar</strong> selecciona 2 o más elementos (movimientos pendientes del banco
                y/o del libro, y/o partidas anteriores que el sistema no cruzó solo) y confírmalos como
                la misma transacción — deja trazabilidad; si el cruce incluye una partida anterior,
                también ajusta el saldo pendiente al quitarla de la lista de partidas (igual que si el
                motor la hubiera cruzado solo). Si lo que quieres es que la diferencia baje a $0 sin
                relacionarla con nada más, usa <strong>"Clasificar como partida"</strong> en la tabla
                de abajo.
              </p>

              <h4>Movimientos pendientes del banco</h4>
              <table>
                <thead><tr><th></th><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Clasificar como partida</th></tr></thead>
                <tbody>
                  {resultado.pendientesExtracto.map((m: Movimiento) => (
                    <tr key={m.id} className={selExtracto.has(m.id) ? "fila-seleccionada" : ""}>
                      <td>
                        <input type="checkbox" checked={selExtracto.has(m.id)} onChange={() => toggleSelExtracto(m.id)} />
                      </td>
                      <td>{m.fecha}</td><td>{m.descripcion}</td><td>{fmtCOP(m.valor)}</td>
                      <td>
                        <div className="clasificar-partida">
                          <select
                            value={claseTipo[m.id] ?? ""}
                            onChange={(e) => setClaseTipo((p) => ({ ...p, [m.id]: e.target.value as PartidaAnterior["tipo"] }))}
                          >
                            <option value="">Tipo…</option>
                            {OPCIONES_TIPO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <input
                            type="text"
                            placeholder="Motivo"
                            value={claseMotivo[m.id] ?? ""}
                            onChange={(e) => setClaseMotivo((p) => ({ ...p, [m.id]: e.target.value }))}
                          />
                          <button disabled={!claseTipo[m.id]} onClick={() => clasificarComoPartida(m, "extracto")}>
                            Clasificar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4>Movimientos pendientes del libro</h4>
              <table>
                <thead><tr><th></th><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Clasificar como partida</th></tr></thead>
                <tbody>
                  {resultado.pendientesLibro.map((m: Movimiento) => (
                    <tr key={m.id} className={selLibro.has(m.id) ? "fila-seleccionada" : ""}>
                      <td>
                        <input type="checkbox" checked={selLibro.has(m.id)} onChange={() => toggleSelLibro(m.id)} />
                      </td>
                      <td>{m.fecha}</td><td>{m.descripcion}</td><td>{fmtCOP(m.valor)}</td>
                      <td>
                        <div className="clasificar-partida">
                          <select
                            value={claseTipo[m.id] ?? ""}
                            onChange={(e) => setClaseTipo((p) => ({ ...p, [m.id]: e.target.value as PartidaAnterior["tipo"] }))}
                          >
                            <option value="">Tipo…</option>
                            {OPCIONES_TIPO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <input
                            type="text"
                            placeholder="Motivo"
                            value={claseMotivo[m.id] ?? ""}
                            onChange={(e) => setClaseMotivo((p) => ({ ...p, [m.id]: e.target.value }))}
                          />
                          <button disabled={!claseTipo[m.id]} onClick={() => clasificarComoPartida(m, "libro")}>
                            Clasificar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {partidasDisponibles.length > 0 && (
                <>
                  <h4>Partidas anteriores que el sistema no cruzó solo</h4>
                  <table>
                    <thead><tr><th></th><th>Tipo</th><th>Descripción</th><th>Valor</th></tr></thead>
                    <tbody>
                      {partidasDisponibles.map((p) => (
                        <tr key={p.id} className={selPartidas.has(p.id) ? "fila-seleccionada" : ""}>
                          <td>
                            <input type="checkbox" checked={selPartidas.has(p.id)} onChange={() => toggleSelPartida(p.id)} />
                          </td>
                          <td>{p.tipo}</td><td>{p.descripcion}</td><td>{fmtCOP(p.valorAbsoluto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="form-cruce-manual">
                <input
                  type="text"
                  placeholder="Justificación (opcional)"
                  value={justificacion}
                  onChange={(e) => setJustificacion(e.target.value)}
                />
                <button
                  onClick={confirmarCruceManual}
                  disabled={selExtracto.size + selLibro.size + selPartidas.size < 2}
                >
                  Confirmar cruce manual ({selExtracto.size + selLibro.size + selPartidas.size} seleccionados)
                </button>
              </div>
            </div>
          )}

          {resultado.partidasConciliatorias.length > 0 && (
            <div className="partidas-registradas">
              <h4>Partidas conciliatorias registradas</h4>
              <table>
                <thead><tr><th>Tipo</th><th>Descripción</th><th>Valor</th></tr></thead>
                <tbody>
                  {resultado.partidasConciliatorias.map((p) => (
                    <tr key={p.id}><td>{p.tipo}</td><td>{p.descripcion}</td><td>{fmtCOP(p.valorAbsoluto)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {mostrarVistaPrevia && resultado && cuenta && (
        <div className="overlay-modal" onClick={() => setMostrarVistaPrevia(false)}>
          <div className="modal-vista-previa" onClick={(e) => e.stopPropagation()}>
            <div className="modal-cabecera">
              <h3>Vista previa de la conciliación</h3>
              <button className="modal-cerrar" onClick={() => setMostrarVistaPrevia(false)}>✕</button>
            </div>
            <div className="modal-cuerpo">
              {(resultado.pendientesExtracto.length > 0 || resultado.pendientesLibro.length > 0) && (
                <div className="aviso-vp">
                  El sistema no logró cruzar {resultado.pendientesExtracto.length + resultado.pendientesLibro.length}{" "}
                  movimiento(s) automáticamente. Puedes clasificarlos aquí mismo como partida conciliatoria
                  para que la conciliación quede cuadrada antes de imprimir — elige el tipo y escribe el motivo.
                </div>
              )}

              <div className="vista-previa-hoja">
                <FormatoImpresion cuenta={cuenta} resultado={resultado} firmantes={firmantes} />
              </div>

              {(resultado.pendientesExtracto.length > 0 || resultado.pendientesLibro.length > 0) && (
                <div className="pendientes" style={{ marginTop: "1.5rem" }}>
                  {resultado.pendientesExtracto.length > 0 && (
                    <>
                      <h4>Sin cruzar — banco</h4>
                      <table>
                        <thead><tr><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Clasificar</th></tr></thead>
                        <tbody>
                          {resultado.pendientesExtracto.map((m) => (
                            <tr key={m.id}>
                              <td>{m.fecha}</td><td>{m.descripcion}</td><td>{fmtCOP(m.valor)}</td>
                              <td>
                                <div className="clasificar-partida">
                                  <select value={claseTipo[m.id] ?? ""} onChange={(e) => setClaseTipo((p) => ({ ...p, [m.id]: e.target.value as PartidaAnterior["tipo"] }))}>
                                    <option value="">Tipo…</option>
                                    {OPCIONES_TIPO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                  <input type="text" placeholder="Motivo" value={claseMotivo[m.id] ?? ""} onChange={(e) => setClaseMotivo((p) => ({ ...p, [m.id]: e.target.value }))} />
                                  <button disabled={!claseTipo[m.id]} onClick={() => clasificarComoPartida(m, "extracto")}>Aplicar</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  {resultado.pendientesLibro.length > 0 && (
                    <>
                      <h4>Sin cruzar — libro</h4>
                      <table>
                        <thead><tr><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Clasificar</th></tr></thead>
                        <tbody>
                          {resultado.pendientesLibro.map((m) => (
                            <tr key={m.id}>
                              <td>{m.fecha}</td><td>{m.descripcion}</td><td>{fmtCOP(m.valor)}</td>
                              <td>
                                <div className="clasificar-partida">
                                  <select value={claseTipo[m.id] ?? ""} onChange={(e) => setClaseTipo((p) => ({ ...p, [m.id]: e.target.value as PartidaAnterior["tipo"] }))}>
                                    <option value="">Tipo…</option>
                                    {OPCIONES_TIPO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                  <input type="text" placeholder="Motivo" value={claseMotivo[m.id] ?? ""} onChange={(e) => setClaseMotivo((p) => ({ ...p, [m.id]: e.target.value }))} />
                                  <button disabled={!claseTipo[m.id]} onClick={() => clasificarComoPartida(m, "libro")}>Aplicar</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="modal-pie">
              <button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
              <button className="boton-primario" onClick={() => window.print()}>Imprimir / guardar PDF</button>
              <button onClick={() => setMostrarVistaPrevia(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

