export interface Inscripcion {
  numeroInscripcion: number;
  correlativo: number;
  codigoCurso: string;
  codigoSence?: string;
  ordenCompra?: string;
  idSence?: string;
  empresa: number;
  idMoodle: string;
  nombreCurso?: string;
  modalidad: number | string;
  inicio: string;
  termino?: string;
  ejecutivo: number | string;
  numAlumnosInscritos: number;
  valorInicial?: number;
  responsable?: string;
  valorFinal?: number;
  statusAlumnos: string;
  status?: string;
  status_vimica?: string;
  comentarios?: string;
}

export type InscripcionWithId = Inscripcion & { _id: string };
