import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getEjecutivosCollection } from '../db/mongo';
import { Ejecutivo } from '../types/ejecutivo';

async function getNextCode(): Promise<number> {
  const col = await getEjecutivosCollection();
  const last = await col.find({}).sort({ code: -1 }).limit(1).toArray();
  if (!last.length) return 1;
  return (last[0].code || 0) + 1;
}

export class EjecutivosController {
  async list(_req: Request, res: Response): Promise<void> {
    const col = await getEjecutivosCollection();
    const items = await col.find({}).sort({ code: 1 }).toArray();
    res.json({ success: true, data: items });
  }

  async create(req: Request, res: Response): Promise<void> {
    const col = await getEjecutivosCollection();
    const payload = req.body as Omit<Ejecutivo, 'code'>;
    const code = await getNextCode();
    const doc: Ejecutivo = { code, ...payload };
    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  async update(req: Request, res: Response): Promise<void> {
    const col = await getEjecutivosCollection();
    const { id } = req.params as { id: string };
    const { code, ...rest } = req.body as Partial<Ejecutivo>;
    await col.updateOne({ _id: new ObjectId(id) } as any, { $set: rest });
    const updated = await col.findOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true, data: updated });
  }

  async remove(req: Request, res: Response): Promise<void> {
    const col = await getEjecutivosCollection();
    const { id } = req.params as { id: string };
    await col.deleteOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true });
  }
}