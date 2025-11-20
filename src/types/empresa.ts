export interface Empresa {
  code: number;
  nombre: string;
  holding?: string;
  rut?: string;
  nombre_responsable?: string;
  email_responsable?: string;
  telefono_1?: string;
  telefono_2?: string;
  email_empresa?: string;
  status: string;
}

export type EmpresaWithId = Empresa & { _id: string };
