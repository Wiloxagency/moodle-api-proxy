export type MoodleMajorVersion = 4 | 5;

export interface EmpresaLogo {
  mime: string;
  /** Imagen en base64 (sin el prefijo data:). */
  data: string;
  updatedAt: string;
}

export interface Empresa {
  code: number;
  nombre: string;
  holding?: string;
  rut?: string;
  nombre_responsable?: string;
  email_responsable?: string;
  telefono_1?: string;
  telefono_2?: string;
  email_empresa?: string;
  status: string;

  // --- White Label -------------------------------------------------------
  // Una empresa White Label tiene su propio Moodle y se entra a ella por su
  // propio dominio. Todo lo que se haga desde ese dominio queda acotado a la
  // empresa. Ver services/moodleTenant.ts y utils/whiteLabel.ts.
  whiteLabel?: boolean;
  /** Host del reporte, normalizado (ej. "reportes.cliente.cl"). */
  wlDominio?: string;
  /** URL base del Moodle del cliente, sin barra final. */
  wlMoodleUrl?: string;
  /** Token de Web Services. NUNCA sale por la API (ver toPublicEmpresa). */
  wlMoodleToken?: string;
  wlMoodleVersion?: MoodleMajorVersion;
  /** Logo. Se sirve en GET /api/empresas/:code/logo, no dentro del listado. */
  wlLogo?: EmpresaLogo;
}

export type EmpresaWithId = Empresa & { _id: string };
