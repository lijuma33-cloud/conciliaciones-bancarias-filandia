import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { sendPasswordResetEmail, createUserWithEmailAndPassword } from "firebase/auth";
import { useAuth } from "../firebase/AuthContext";
import { auth } from "../firebase/config";
import { guardarUsuario } from "../firebase/datos";

export function PaginaLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [modo, setModo] = useState<"login" | "registro">("login");

  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [claveConfirmar, setClaveConfirmar] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mensajeReset, setMensajeReset] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await login(correo, clave);
      navigate("/", { replace: true });
    } catch {
      setError("Usuario o contraseña incorrectos.");
    } finally {
      setCargando(false);
    }
  }

  async function onRegistrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave !== claveConfirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (clave.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    setCargando(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, correo, clave);
      // Queda ACTIVO de inmediato, con acceso completo a todas las
      // cuentas — ya no requiere que un administrador lo active a mano.
      await guardarUsuario({
        uid: cred.user.uid,
        nombre,
        correo,
        rol: "auxiliar_contable",
        estado: "activo",
      });
      navigate("/", { replace: true });
    } catch (err) {
      const codigo = (err as { code?: string }).code;
      if (codigo === "auth/email-already-in-use") setError("Ese correo ya tiene una cuenta — intenta iniciar sesión.");
      else setError("No se pudo crear la cuenta. Verifica el correo e inténtalo de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function onOlvideClave() {
    setError(null);
    setMensajeReset(null);
    if (!correo) {
      setError('Escribe tu correo arriba y luego haz clic en "Olvidé mi contraseña".');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, correo);
      setMensajeReset("Te enviamos un correo con el enlace para poner una contraseña nueva.");
    } catch {
      setMensajeReset("Si ese correo está registrado, te llegará un enlace para restablecer la contraseña.");
    }
  }

  return (
    <div className="pantalla-login">
      <form onSubmit={modo === "login" ? onSubmit : onRegistrar} className="tarjeta-login">
        <img src="/logo-filandia.png" alt="Municipio de Filandia" className="logo-login" />
        <h1>{modo === "login" ? "Conciliación Bancaria" : "Crear cuenta"}</h1>
        <p className="subtitulo">Alcaldía Municipal de Filandia</p>

        {modo === "registro" && (
          <label>
            Nombre completo
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
        )}

        <label>
          Correo
          <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required minLength={6} />
        </label>
        {modo === "registro" && (
          <label>
            Confirmar contraseña
            <input type="password" value={claveConfirmar} onChange={(e) => setClaveConfirmar(e.target.value)} required minLength={6} />
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {mensajeReset && <p className="ayuda">{mensajeReset}</p>}

        <button type="submit" disabled={cargando}>
          {cargando ? "Un momento..." : modo === "login" ? "Ingresar" : "Crear cuenta"}
        </button>

        {modo === "login" ? (
          <>
            <button type="button" className="link-olvide-clave" onClick={onOlvideClave}>
              Olvidé mi contraseña
            </button>
            <div className="separador-login">o</div>
            <button type="button" className="link-secundario" onClick={() => { setModo("registro"); setError(null); }}>
              Crear una cuenta nueva
            </button>
          </>
        ) : (
          <button type="button" className="link-secundario" onClick={() => { setModo("login"); setError(null); }}>
            Ya tengo cuenta — iniciar sesión
          </button>
        )}
      </form>
    </div>
  );
}
