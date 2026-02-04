export interface Participante {
  numeroInscripcion: number; // vinculado a Inscripcion
  nombres: string;
  apellidos: string;
  rut: string;
  rutkey?: string; // Generado automáticamente (normalizado de rut)
  mail: string;
  telefono?: string;
  valorCobrado?: number;
  franquiciaPorcentaje?: number; // e.g., 65 (%), store as number 0-100
  costoOtic?: number;
  costoEmpresa?: number;
  estadoInscripcion?: string;
  observacion?: string;
}

export type ParticipanteWithId = Participante & { _id: string };
