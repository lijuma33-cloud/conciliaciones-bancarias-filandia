# Conciliación Bancaria — Alcaldía Municipal de Filandia

## Estado actual

Este scaffold ya **compila y hace build real** (`npm run build` verificado). Incluye:

- Motor de conciliación (3 fases) — puerto validado de la lógica de los 3 HTML legado.
- Parsers de extracto: Bancolombia (`.xlsx`), Davivienda (`.txt`), Agrario (`.docx`).
- Parser del Libro contable SIGAM (formato real A-L, validado contra las 3 muestras).
- Auth (Firebase Auth) + reglas de Firestore por rol (administrador / auxiliar contable).
- Dashboard, página de conciliación por cuenta, impresión, exportación a XLSX.
- **Partidas anteriores automáticas**: cada conciliación carga solas las partidas que quedaron pendientes en la última versión guardada del mes anterior (no hay que digitarlas a mano).
- **Conciliación manual**: seleccionar un movimiento del banco + uno o varios del libro y cruzarlos a mano, con usuario, fecha y justificación guardados en el propio resultado.
- **Gestión de usuarios** (solo administrador): crear usuario (Auth + Firestore sin cerrar la sesión del admin), activar/desactivar, asignar cuentas autorizadas.
- Script de migración del "Seguimiento 2026" (63 cuentas) ya ejecutado — ver `out/`.

## Pendiente de completar (no incluido aún)
- Historial de versiones anteriores de una misma conciliación dentro de la UI (hoy solo se ve/guarda la última; el modelo de datos ya las conserva todas en Firestore).
- **17 de 63 cuentas** quedaron con `saldoInicialPendiente: true` — ver `out/advertencias.json`. Se ven en el dashboard con badge "Pendiente de carga manual"; su saldo/partidas de arranque deben cargarse a mano la primera vez.

## Ejecutar localmente

```bash
npm install
cp .env.example .env.local   # completar con las credenciales del proyecto Firebase
npm run dev
```

## Configurar Firebase

1. Crear proyecto en https://console.firebase.google.com
2. Habilitar Authentication (Email/Password), Firestore y Storage.
3. Copiar la configuración web a `.env.local`.
4. Desplegar reglas: `firebase deploy --only firestore:rules,storage:rules`
5. Crear el primer usuario administrador manualmente en Firestore:
   `/usuarios/{uid}` → `{ uid, nombre, correo, rol: "administrador", estado: "activo", cuentasAutorizadas: [] }`
   (el `uid` debe existir primero en Authentication).

## Cargar las 63 cuentas migradas

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/service-account.json
npx tsx scripts/cargar-cuentas-firestore.ts
```

Antes de correrlo, revisa `out/advertencias.json` — ahí están las 43 líneas que señalan
qué cuentas necesitan confirmación manual (nombres ambiguos, formato antiguo, etc.).

## Volver a correr la migración (si actualizas el Seguimiento)

```bash
npm run migrar-seguimiento -- /ruta/al/Seguimiento_Conciliaciones_Bancarias.xlsx
```

## Publicar en Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

## Subir a GitHub

```bash
git init
git add .
git commit -m "Scaffold inicial: motor de conciliación, parsers, auth, dashboard"
git remote add origin <url-del-repo>
git push -u origin main
```

`node_modules`, `dist`, `.env.local` y `out/` (contiene saldos reales) ya deben ir en `.gitignore`.
