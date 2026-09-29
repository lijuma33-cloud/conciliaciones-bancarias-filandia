// ══════════════════════════════════════════════════════════════════
// Configuración de Firebase. Las credenciales reales se inyectan por
// variables de entorno (.env.local, no versionado) — ver .env.example.
// ══════════════════════════════════════════════════════════════════
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// ignoreUndefinedProperties: campos opcionales vacíos (p. ej. la
// justificación de un cruce manual, o el número de cuenta) llegan como
// undefined y, sin esta opción, Firestore rechaza TODO el guardado con
// "Unsupported field value: undefined".
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const storage = getStorage(app);
