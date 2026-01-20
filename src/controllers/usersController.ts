import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getUsersCollection } from '../db/mongo';
import { User, UserRole } from '../types/user';

function sanitizeUser(user: any): Omit<User, 'password'> & { _id: string } {
  return {
    _id: user._id?.toString(),
    username: user.username,
    role: user.role,
  };
}

export class UsersController {
  // GET /api/users
  async list(req: Request, res: Response) {
    const col = await getUsersCollection();
    const items = await col.find({}).toArray();
    const sanitized = items.map(sanitizeUser);
    res.json({ success: true, data: sanitized });
  }

  // POST /api/users
  async create(req: Request, res: Response) {
    const { username, role, password } = req.body as Partial<User>;

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
      role: (role as UserRole) || 'user',
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
    const { username, role } = req.body as Partial<User>;

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
