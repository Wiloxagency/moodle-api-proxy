/**
 * - superAdmin: administra todo. Nunca pertenece a una empresa White Label.
 * - admin:      administrador de UNA empresa White Label (sólo existe ahí).
 * - user:       consulta los reportes de su empresa.
 */
export type UserRole = 'superAdmin' | 'admin' | 'user';
export const USER_ROLES: UserRole[] = ['superAdmin', 'admin', 'user'];

export interface User {
  username: string;
  role: UserRole;
  empresa: number;
  password: string; // NOTE: demo only; considerar hashing en producción
  createdAt?: Date;
  updatedAt?: Date;
}
