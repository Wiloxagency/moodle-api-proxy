export type UserRole = 'superAdmin' | 'user';

export interface User {
  username: string;
  role: UserRole;
  password: string; // NOTE: demo only; considerar hashing en producción
  createdAt?: Date;
  updatedAt?: Date;
}
