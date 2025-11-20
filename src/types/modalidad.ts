export interface Modalidad {
  code: number;
  sincronico?: boolean;
  asincronico?: boolean;
  sincronico_online?: boolean;
  sincronico_presencial_moodle?: boolean;
  sincronico_presencial_no_moodle?: boolean;
}

export type ModalidadWithId = Modalidad & { _id: string };
