export interface Inscripcion {
  // Autogenerado por el API; almacenado como string numérica para compatibilidad
  numeroInscripcion: string; // N° Inscripción (secuencial desde 100000)

  // Nuevos campos solicitados
  correlativo: number;       // N° Correlativo (obligatorio)
  codigoCurso: string;       // Código del Curso (obligatorio)
  empresa: string;           // Empresa (valor fijo: "Mutual")

  // Campos existentes
  codigoSence?: string;      // Código Sence
  ordenCompra?: string;      // Orden de Compra
  idSence?: string;          // ID Sence
  idMoodle: string;          // ID Moodle (obligatorio)
  nombreCurso?: string;      // Nombre del Curso (opcional)
  modalidad: string;         // Modalidad ("e-learning" | "sincrónico")
  inicio: string;            // Fecha de Inicio (ISO)
  termino?: string;          // Fecha Final (ISO) (opcional)
  ejecutivo: string;         // Ejecutivo (obligatorio)
  numAlumnosInscritos: number; // Num Alumnos Inscritos (obligatorio)
  valorInicial?: number;        // Valor INICIAL (opcional)
  valorFinal?: number;          // Valor FINAL (opcional)
  statusAlumnos: string;        // Status de Alumnos
  comentarios?: string;         // Comentarios
}

export type InscripcionWithId = Inscripcion & { _id: string };
