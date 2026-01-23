export interface Participante {
  numeroInscripcion: number; // vinculado a Inscripcion
  nombres: string;
  apellidos: string;
  rut: string;
  mail: string;
  telefono?: string;
  franquiciaPorcentaje?: number; // e.g., 65 (%), store as number 0-100
  costoOtic?: number;
  costoEmpresa?: number;
  estadoInscripcion?: string;
  observacion?: string;
}

export type ParticipanteWithId = Participante & { _id: string };
