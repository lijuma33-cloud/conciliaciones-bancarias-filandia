import { useEffect, useState, type FormEvent } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { useAuth } from "../firebase/AuthContext";
import { listarUsuarios, guardarUsuario } from "../firebase/datos";
import { app as appPrincipal } from "../firebase/config";
import type { Rol, Usuario } from "../types/domain";

function generarClaveTemporal(): string {
  // Solo se usa para crear la cuenta en Firebase Auth; el usuario nunca
  // la ve — de inmediato se le envía un correo para que ponga la suya.
  return crypto.randomUUID();
}

export function PaginaUsuarios() {
  const { perfil } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<Rol>("auxiliar_contable");

  useEffect(() => {
    (async () => {
      setUsuarios(await listarUsuarios());
      setCargando(false);
    })();
  }, []);

  async function crearUsuario(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreando(true);

    // Se usa una instancia SECUNDARIA de Firebase Auth para crear el
    // usuario nuevo sin cerrar la sesión del administrador actual
    // (createUserWithEmailAndPassword inicia sesión como el usuario creado
    // en la instancia que se use).
    const appSecundaria = initializeApp(appPrincipal.options, "app-crear-usuario");
    const authSecundaria = getAuth(appSecundaria);

    try {
      // Se crea con una clave temporal aleatoria que nadie conoce, y de
      // inmediato se envía un correo de restablecimiento para que el
      // propio usuario defina su contraseña — así nunca hay que
      // comunicarle una clave por WhatsApp/correo en texto plano.
      const cred = await createUserWithEmailAndPassword(authSecundaria, correo, generarClaveTemporal());
      await sendPasswordResetEmail(authSecundaria, correo);
      const nuevo: Usuario = {
        uid: cred.user.uid,
        nombre,
        correo,
        rol,
        estado: "activo",
      };
      await guardarUsuario(nuevo);
      setUsuarios((prev) => [...prev, nuevo]);
      setNombre(""); setCorreo("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await authSecundaria.signOut();
      await deleteApp(appSecundaria);
      setCreando(false);
    }
  }

  async function cambiarEstado(u: Usuario, estado: Usuario["estado"]) {
    const actualizado = { ...u, estado };
    await guardarUsuario(actualizado);
    setUsuarios((prev) => prev.map((x) => (x.uid === u.uid ? actualizado : x)));
  }

  if (perfil?.rol !== "administrador") return <p className="error">Solo el administrador puede gestionar usuarios.</p>;
  if (cargando) return <p className="cargando">Cargando…</p>;

  return (
    <div className="pagina-usuarios">
      <h1>Usuarios</h1>

      <table className="tabla-cuentas">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.uid}>
              <td>{u.nombre}</td>
              <td>{u.correo}</td>
              <td>{u.rol}</td>
              <td><span className={`badge ${u.estado === "activo" ? "badge-conciliada" : "badge-con_diferencias"}`}>{u.estado}</span></td>
              <td>
                <button onClick={() => cambiarEstado(u, u.estado === "activo" ? "inactivo" : "activo")}>
                  {u.estado === "activo" ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Crear usuario</h2>
      <p className="ayuda">
        Al crear el usuario le llega un correo para que defina su propia contraseña — tú no la ves ni la asignas.
        Cualquier usuario activo tiene acceso a las 63 cuentas (ya no se asignan cuentas una por una); lo único
        que un auxiliar contable no puede hacer es marcar una conciliación como "Verificado" — eso solo lo
        puede hacer el administrador.
      </p>
      <form onSubmit={crearUsuario} className="form-usuario">
        <label>Nombre <input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></label>
        <label>Correo <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required /></label>
        <label>
          Rol
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            <option value="auxiliar_contable">Auxiliar contable</option>
            <option value="administrador">Administrador</option>
          </select>
        </label>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={creando}>{creando ? "Creando…" : "Crear usuario y enviar correo"}</button>
      </form>
    </div>
  );
}
