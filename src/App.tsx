import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./firebase/AuthContext";
import { PaginaLogin } from "./pages/PaginaLogin";
import { PaginaDashboard } from "./pages/PaginaDashboard";
import { PaginaCuenta } from "./pages/PaginaCuenta";
import { PaginaUsuarios } from "./pages/PaginaUsuarios";
import { PaginaHistorico } from "./pages/PaginaHistorico";
import { Migas } from "./components/Migas";

function RutaProtegida({ children }: { children: React.ReactNode }) {
  const { usuarioFirebase, perfil, cargando, errorPerfil, logout } = useAuth();
  if (cargando) return <p className="cargando">Cargando…</p>;
  if (!usuarioFirebase) return <Navigate to="/login" replace />;

  // Evita que un usuario de Firebase sin documento /usuarios/{uid}
  // deje la aplicación en un estado aparentemente bloqueado.
  if (!perfil) {
    return (
      <div className="pantalla-login">
        <div className="tarjeta-login">
          <img src="/logo-filandia.png" alt="Municipio de Filandia" className="logo-login" />
          <h1>Perfil no disponible</h1>
          <p className="ayuda">
            {errorPerfil ?? "La cuenta está autenticada, pero todavía no tiene un perfil configurado."}
          </p>
          <p className="ayuda">
            Si eres el administrador, crea en Firestore el documento <strong>usuarios/{usuarioFirebase.uid}</strong>
            con rol <strong>administrador</strong> y estado <strong>activo</strong>.
          </p>
          <button className="boton-primario" style={{ width: "100%", marginTop: "1rem" }} onClick={logout}>
            Cerrar sesión y volver al acceso
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function iniciales(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Layout({ children }: { children: React.ReactNode }) {
  const { perfil, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="layout">
      <header className="barra-superior">
        <Link to="/" className="marca">
          <img src="/logo-filandia.png" alt="Municipio de Filandia" />
          <span className="marca-texto">
            Conciliación Bancaria
            <small>Alcaldía Municipal de Filandia</small>
          </span>
        </Link>

        <nav className="nav-principal">
          <Link to="/" className={location.pathname === "/" ? "activo" : ""}>Dashboard</Link>
          {perfil?.rol === "administrador" && (
            <Link to="/usuarios" className={location.pathname === "/usuarios" ? "activo" : ""}>Usuarios</Link>
          )}
        </nav>

        {perfil && (
          <div className="usuario-actual">
            <span className="avatar">{iniciales(perfil.nombre)}</span>
            <span>{perfil.nombre}</span>
            <button onClick={logout}>Salir</button>
          </div>
        )}
      </header>
      <main>
        <Migas />
        {children}
      </main>
    </div>
  );
}

function AppRutas() {
  return (
    <Routes>
      <Route path="/login" element={<PaginaLogin />} />
      <Route
        path="/"
        element={
          <RutaProtegida>
            <Layout><PaginaDashboard /></Layout>
          </RutaProtegida>
        }
      />
      <Route
        path="/cuentas/:cuentaId"
        element={
          <RutaProtegida>
            <Layout><PaginaCuenta /></Layout>
          </RutaProtegida>
        }
      />
      <Route
        path="/usuarios"
        element={
          <RutaProtegida>
            <Layout><PaginaUsuarios /></Layout>
          </RutaProtegida>
        }
      />
      <Route
        path="/cuentas/:cuentaId/historico"
        element={
          <RutaProtegida>
            <Layout><PaginaHistorico /></Layout>
          </RutaProtegida>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRutas />
      </BrowserRouter>
    </AuthProvider>
  );
}
