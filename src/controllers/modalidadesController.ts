import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getModalidadesCollection } from '../db/mongo';
import { Modalidad } from '../types/modalidad';

async function getNextCode(): Promise<number> {
  const col = await getModalidadesCollection();
  const last = await col.find({}).sort({ code: -1 }).limit(1).toArray();
  if (!last.length) return 1;
  return (last[0].code || 0) + 1;
}

export class ModalidadesController {
  async list(_req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const items = await col.find({}).sort({ code: 1 }).toArray();
    res.json({ success: true, data: items });
  }

  async create(req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const payload = req.body as Omit<Modalidad, 'code'>;
    const code = await getNextCode();
    const doc: Modalidad = { code, ...payload };
    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  async update(req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const { id } = req.params as { id: string };
    const { code, ...rest } = req.body as Partial<Modalidad>;
    await col.updateOne({ _id: new ObjectId(id) } as any, { $set: rest });
    const updated = await col.findOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true, data: updated });
  }

  async remove(req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const { id } = req.params as { id: string };
    await col.deleteOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true });
  }
}