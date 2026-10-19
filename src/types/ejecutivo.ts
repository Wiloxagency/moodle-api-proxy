export interface Ejecutivo {
  code: number;
  nombres: string;
  apellidos: string;
  rut?: string;
  direccion?: string;
  telefono_1?: string;
  telefono_2?: string;
  email?: string;
  status: string;
  /** Sólo en catálogos de un White Label (código de la empresa). Ausente = global. */
  empresa?: number;
}

export type EjecutivoWithId = Ejecutivo & { _id: string };
