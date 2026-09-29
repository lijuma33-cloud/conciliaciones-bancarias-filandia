import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "../firebase/config";
import { obtenerUsuario } from "../firebase/datos";
import type { Usuario } from "../types/domain";

interface AuthState {
  usuarioFirebase: User | null;
  perfil: Usuario | null;
  cargando: boolean;
  errorPerfil: string | null;
  login: (correo: string, clave: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuarioFirebase, setUsuarioFirebase] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);

  useEffect(() => {
    // onAuthStateChanged es asíncrono. Es importante que SIEMPRE terminemos
    // el estado de carga, incluso si Firestore falla o el perfil fue borrado.
    return onAuthStateChanged(auth, async (u) => {
      setUsuarioFirebase(u);
      setPerfil(null);
      setErrorPerfil(null);

      if (!u) {
        setCargando(false);
        return;
      }

      try {
        const p = await obtenerUsuario(u.uid);
        if (p) {
          setPerfil(p);
        } else {
          setErrorPerfil(
            "Tu cuenta de Firebase existe, pero no tiene un perfil en la colección usuarios. Debes crear o restaurar el perfil del usuario."
          );
        }
      } catch (error) {
        console.error("Error cargando el perfil de usuario:", error);
        setErrorPerfil(
          "No fue posible consultar tu perfil en Firebase. Verifica la conexión y las reglas de Firestore."
        );
      } finally {
        setCargando(false);
      }
    });
  }, []);

  const login = async (correo: string, clave: string) => {
    setErrorPerfil(null);
    await signInWithEmailAndPassword(auth, correo, clave);
  };

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ usuarioFirebase, perfil, cargando, errorPerfil, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
