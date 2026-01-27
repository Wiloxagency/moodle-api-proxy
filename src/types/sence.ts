export interface Sence {
  code: number;
  // Código Sence
  codigo_sence?: string;
  // Nombre_SENCE
  nombre_sence?: string;
  // Horas Teóricas
  horas_teoricas?: number;
  // Horas Practicas
  horas_practicas?: number;
  // Horas E-learning
  horas_elearning?: number;
  // Horas Totales
  horas_totales?: number;
  // Número de Participantes
  numero_participantes?: number;
  // Término Vigencia
  termino_vigencia?: string;
  // Área
  area?: string;
  // Especialidad
  especialidad?: string;
  // Modalidad de instrucción
  modalidad_instruccion?: string;
  // Modo
  modo?: string;
  // Valor efectivo por participante
  valor_efectivo_participante?: number;
  // Valor máximo imputable
  valor_maximo_imputable?: number;
  // N° Solicitud
  numero_solicitud?: string;
  // Fecha Resolución
  fecha_resolucion?: string;
  // Número Resolución
  numero_resolucion?: string;
  // Valor Hora Imputable
  valor_hora_imputable?: number;
  // Exclusivo cliente
  exclusivo_cliente?: boolean;
  // Dirigido por relator
  dirigido_por_relator?: boolean;
  // Incluye Tablet
  incluye_tablet?: boolean;
  // OTEC
  otec?: string;
  // IDs externos opcionales
  id_sence?: string;
  id_moodle?: string;
}

export type SenceWithId = Sence & { _id: string };
