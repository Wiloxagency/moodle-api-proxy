export interface Inscripcion {
  numeroInscripcion: string; // N° Inscripción
  codigoSence?: string;      // Código Sence
  ordenCompra?: string;      // Orden de Compra
  idSence?: string;          // ID Sence
  idMoodle?: string;         // ID Moodle
  cliente: string;           // Cliente
  nombreCurso: string;       // Nombre Curso
  modalidad: string;         // Modalidad
  inicio: string;            // Inicio (ISO date string)
  termino: string;           // Termino (ISO date string)
  ejecutivo: string;         // Ejecutivo
  numAlumnosInscritos: number; // Num Alumnos Inscritos
  valorInicial: number;        // Valor INICIAL
  valorFinal: number;          // Valor FINAL
  statusAlumnos: string;       // Status de Alumnos
  comentarios?: string;        // Comentarios
}

export type InscripcionWithId = Inscripcion & { _id: string };
