export interface Inscripcion {
  numeroInscripcion: number;
  correlativo: number;
  codigoCurso: string;
  codigoSence?: string;
  ordenCompra?: string;
  idSence?: string;
  empresa: string;
  idMoodle: string;
  nombreCurso?: string;
  modalidad: string;
  inicio: string;
  termino?: string;
  ejecutivo: string;
  numAlumnosInscritos: number;
  valorInicial?: number;
  responsable?: string;
  valorFinal?: number;
  statusAlumnos: string;
  comentarios?: string;
}

export type InscripcionWithId = Inscripcion & { _id: string };
