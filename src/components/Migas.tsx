import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { obtenerCuenta } from "../firebase/datos";

export function Migas() {
  const location = useLocation();
  const { cuentaId } = useParams<{ cuentaId: string }>();
  const [nombreCuenta, setNombreCuenta] = useState<string | null>(null);

  useEffect(() => {
    if (!cuentaId) { setNombreCuenta(null); return; }
    obtenerCuenta(cuentaId).then((c) => setNombreCuenta(c?.enlace ?? cuentaId));
  }, [cuentaId]);

  const partes: { texto: string; to?: string }[] = [{ texto: "Inicio", to: "/" }];

  if (location.pathname.startsWith("/usuarios")) {
    partes.push({ texto: "Usuarios" });
  } else if (cuentaId) {
    partes.push({ texto: nombreCuenta ?? "…", to: `/cuentas/${cuentaId}` });
    if (location.pathname.endsWith("/historico")) {
      partes.push({ texto: "Histórico" });
    }
  }

  if (partes.length <= 1) return null;

  return (
    <nav className="migas-pan" aria-label="Ruta de navegación">
      {partes.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          {i > 0 && <span>›</span>}
          {p.to ? <Link to={p.to}>{p.texto}</Link> : <span className="actual">{p.texto}</span>}
        </span>
      ))}
    </nav>
  );
}
