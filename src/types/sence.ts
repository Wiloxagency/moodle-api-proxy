export interface Sence {
  code: number;
  codigo_sence?: string;
  id_sence?: string;
  id_moodle?: string;
}

export type SenceWithId = Sence & { _id: string };
