// ══════════════════════════════════════════════════════════════════
// Datos institucionales para el formato impreso de conciliación,
// tomados del formato RE-GF-07 "Registro Conciliaciones Bancarias".
// Si cambia el NIT, la dirección, o la versión del formato, se edita
// solo aquí.
// ══════════════════════════════════════════════════════════════════
export const ENTIDAD = {
  nombre: "MUNICIPIO DE FILANDIA — QUINDÍO",
  nit: "890001339-5",
  encabezado1: "Alcaldía Municipal - Filandia Quindío",
  encabezado2: "Gestión Financiera",
  encabezado3: "Registro Conciliaciones Bancarias",
  direccion: "Carrera 2 No. 7-54",
  direccionExtra: "Alcaldía Campestre Municipal",
  codigoPortalCAM: "634001",
  web: "www.filandia-quindio.gov.co",
  correo: "contactenos@filandia-quindio.gov.co",
  formatoCodigo: "RE-GF-07",
  formatoVersion: "06",
} as const;

export const FIRMANTES_DEFECTO = [
  { nombre: "", rol: "Contador Público" },
  { nombre: "", rol: "Auxiliar Contable Contratista" },
  { nombre: "", rol: "Secretario(a) de Hacienda" },
];
