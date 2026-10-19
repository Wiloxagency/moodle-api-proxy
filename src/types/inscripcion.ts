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
  // Archivada: la inscripción se conserva (no se elimina) pero queda fuera de
  // los reportes, del dashboard, del cron de actualización y de VMICA. Se usa
  // para fichas anuladas o duplicadas. Es reversible (Desarchivar).
  archivada?: boolean;
  archivadaAt?: string | null;
}

// Filtro Mongo para excluir las inscripciones archivadas. Los documentos
// anteriores al cambio no tienen el campo, por eso es `$ne: true`.
export const NO_ARCHIVADA = { archivada: { $ne: true } } as const;

export type InscripcionWithId = Inscripcion & { _id: string };
