import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getEmpresasCollection, getUsersCollection } from '../db/mongo';
import { User, UserRole, USER_ROLES } from '../types/user';
import { findEmpresa, findWhiteLabelByHost } from '../services/moodleTenant';
import { isWhiteLabel } from '../utils/whiteLabel';

/**
 * Reglas de rol por empresa:
 *  - Una empresa White Label no admite superusuarios.
 *  - El rol Administrador sólo existe en empresas White Label.
 * Devuelve el mensaje de error o null si la combinación es válida.
 */
async function roleEmpresaError(role: UserRole, empresa: number): Promise<string | null> {
  if (!USER_ROLES.includes(role)) return 'Rol inválido';
  const emp = await findEmpresa(empresa);
  const wl = isWhiteLabel(emp);
  if (wl && role === 'superAdmin') return 'Las empresas White Label no admiten superusuarios';
  if (!wl && role === 'admin') return 'El rol Administrador sólo existe en empresas White Label';
  return null;
}

function sanitizeUser(user: any): Omit<User, 'password'> & { _id: string } {
  return {
    _id: user._id?.toString(),
    username: user.username,
    role: user.role,
    empresa: user.empresa,
  };
}

async function getDefaultEmpresaCode(): Promise<number> {
  try {
    const col = await getEmpresasCollection();
    // Nunca una White Label: no admiten superusuarios.
    const first = await col.find({ whiteLabel: { $ne: true } } as any).sort({ code: 1 }).limit(1).toArray();
    const code = first[0]?.code;
    return typeof code === 'number' && !Number.isNaN(code) ? code : 0;
  } catch {
    return 0;
  }
}

async function ensureInitialSuperAdmin(): Promise<void> {
  const col = await getUsersCollection();
  const superAdminsCount = await col.countDocuments({ role: 'superAdmin' });

  if (superAdminsCount === 0) {
    const now = new Date();
    const empresa = await getDefaultEmpresaCode();
    await col.insertOne({
      username: 'superadmin',
      usernameLower: 'superadmin',
      role: 'superAdmin',
      empresa,
      password: '123456',
      createdAt: now,
      updatedAt: now,
    } as any);
  }
}

export class UsersController {
  // GET /api/users
  // GET /api/users?empresa=<code>  (el filtro lo usa el Administrador de un White Label)
  async list(req: Request, res: Response) {
    await ensureInitialSuperAdmin();
    const col = await getUsersCollection();
    const empresaQ = (req.query as any)?.empresa;
    const empresaNum = Number(empresaQ);
    const filter = empresaQ !== undefined && empresaQ !== '' && Number.isFinite(empresaNum) ? { empresa: empresaNum } : {};
    const items = await col.find(filter as any).toArray();
    const sanitized = items.map(sanitizeUser);
    res.json({ success: true, data: sanitized });
  }

  // POST /api/users
  async create(req: Request, res: Response) {
    const { username, role, password, empresa } = req.body as Partial<User>;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: { message: 'username y password son obligatorios' },
      });
      return;
    }

    const empresaRaw: any = (req.body as any).empresa;
    const empresaNum = Number(empresaRaw);
    if (empresaRaw === undefined || empresaRaw === null || empresaRaw === '' || !Number.isFinite(empresaNum)) {
      res.status(400).json({
        success: false,
        error: { message: 'empresa es obligatoria y debe ser numérica' },
      });
      return;
    }

    const finalRole: UserRole = (role as UserRole) || 'user';
    const roleError = await roleEmpresaError(finalRole, empresaNum);
    if (roleError) {
      res.status(400).json({ success: false, error: { message: roleError } });
      return;
    }

    const trimmedUsername = username.trim();
    const normalized = trimmedUsername.toLowerCase();
    const col = await getUsersCollection();

    const exists = await col.findOne({ usernameLower: normalized } as any);
    if (exists) {
      res.status(409).json({
        success: false,
        error: { message: 'El nombre de usuario ya existe' },
      });
      return;
    }

    const now = new Date();
    const doc: any = {
      username: trimmedUsername,
      usernameLower: normalized,
      role: finalRole,
      empresa: empresaNum,
      password,
      createdAt: now,
      updatedAt: now,
    };

    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId });

    res.status(201).json({ success: true, data: created ? sanitizeUser(created) : null });
  }

  // PUT /api/users/:id
  async update(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const { username, role, empresa } = req.body as Partial<User>;

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: { message: 'ID inválido' } });
      return;
    }

    const col = await getUsersCollection();
    const _id = new ObjectId(id);

    const updates: any = { updatedAt: new Date() };

    if (username) {
      const trimmedUsername = username.trim();
      const normalized = trimmedUsername.toLowerCase();

      const exists = await col.findOne({
        usernameLower: normalized,
        _id: { $ne: _id },
      } as any);

      if (exists) {
        res.status(409).json({
          success: false,
          error: { message: 'El nombre de usuario ya existe' },
        });
        return;
      }

      updates.username = trimmedUsername;
      updates.usernameLower = normalized;
    }

    if (role) {
      updates.role = role;
    }

    if (empresa !== undefined) {
      const empresaRaw: any = (req.body as any).empresa;
      const empresaNum = Number(empresaRaw);
      if (empresaRaw === null || empresaRaw === '' || !Number.isFinite(empresaNum)) {
        res.status(400).json({
          success: false,
          error: { message: 'empresa debe ser numérica' },
        });
        return;
      }
      updates.empresa = empresaNum;
    }

    const current = await col.findOne({ _id });
    if (!current) {
      res.status(404).json({ success: false, error: { message: 'Usuario no encontrado' } });
      return;
    }
    const roleError = await roleEmpresaError(
      (updates.role ?? current.role) as UserRole,
      Number(updates.empresa ?? current.empresa),
    );
    if (roleError) {
      res.status(400).json({ success: false, error: { message: roleError } });
      return;
    }
    if (current.role === 'superAdmin' && updates.role && updates.role !== 'superAdmin') {
      const superAdminsCount = await col.countDocuments({ role: 'superAdmin' });
      if (superAdminsCount <= 1) {
        res.status(400).json({ success: false, error: { message: 'No se puede quitar el rol al último Superadmin' } });
        return;
      }
    }

    await col.updateOne({ _id }, { $set: updates });
    const updated = await col.findOne({ _id });

    res.json({ success: true, data: updated ? sanitizeUser(updated) : null });
  }

  // POST /api/users/:id/password
  async changePassword(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const { password } = req.body as { password?: string };

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: { message: 'ID inválido' } });
      return;
    }

    if (!password) {
      res.status(400).json({ success: false, error: { message: 'password es obligatorio' } });
      return;
    }

    const col = await getUsersCollection();
    const _id = new ObjectId(id);

    await col.updateOne(
      { _id },
      { $set: { password, updatedAt: new Date() } },
    );

    const updated = await col.findOne({ _id });
    res.json({ success: true, data: updated ? sanitizeUser(updated) : null });
  }

  // POST /api/users/login
  async login(req: Request, res: Response) {
    const { username, password, host } = req.body as { username?: string; password?: string; host?: string };

    // Asegurar que exista al menos un superadmin por defecto
    await ensureInitialSuperAdmin();

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: { message: 'username y password son obligatorios' },
      });
      return;
    }

    const trimmedUsername = username.trim();
    const normalized = trimmedUsername.toLowerCase();
    const col = await getUsersCollection();

    const user = await col.findOne({ usernameLower: normalized } as any);

    if (!user || user.password !== password) {
      res.status(401).json({
        success: false,
        error: { message: 'Credenciales inválidas' },
      });
      return;
    }

    // White Label: el dominio desde el que se entra decide la empresa.
    //  - En el dominio de un White Label sólo entran sus usuarios y el
    //    Superadmin, y éste queda fijado a esa empresa.
    //  - En la plataforma principal no entran los usuarios de un White Label.
    const wl = await findWhiteLabelByHost(host);
    if (wl) {
      if (user.role === 'superAdmin') {
        res.json({ success: true, data: { ...sanitizeUser(user), empresa: wl.code } });
        return;
      }
      if (Number(user.empresa) !== Number(wl.code)) {
        res.status(401).json({ success: false, error: { message: 'Credenciales inválidas' } });
        return;
      }
    } else if (user.role !== 'superAdmin') {
      const emp = await findEmpresa(user.empresa);
      if (isWhiteLabel(emp)) {
        res.status(403).json({
          success: false,
          error: { message: `Este usuario debe ingresar por https://${emp!.wlDominio}` },
        });
        return;
      }
    }

    res.json({ success: true, data: sanitizeUser(user) });
  }

  // DELETE /api/users/:id
  async delete(req: Request, res: Response) {
    const { id } = req.params as { id: string };

    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: { message: 'ID inválido' } });
      return;
    }

    const col = await getUsersCollection();
    const _id = new ObjectId(id);

    const user = await col.findOne({ _id });
    if (!user) {
      res.status(404).json({ success: false, error: { message: 'Usuario no encontrado' } });
      return;
    }

    if (user.role === 'superAdmin') {
      const superAdminsCount = await col.countDocuments({ role: 'superAdmin' });
      if (superAdminsCount <= 1) {
        res.status(400).json({
          success: false,
          error: { message: 'No se puede eliminar el último Superadmin' },
        });
        return;
      }
    }

    await col.deleteOne({ _id });
    res.json({ success: true });
  }
}
