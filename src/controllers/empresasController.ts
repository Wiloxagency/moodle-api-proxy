import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getEmpresasCollection } from '../db/mongo';
import { Empresa } from '../types/empresa';

async function getNextCode(): Promise<number> {
  const col = await getEmpresasCollection();
  const last = await col.find({}).sort({ code: -1 }).limit(1).toArray();
  if (!last.length) return 1;
  return (last[0].code || 0) + 1;
}

export class EmpresasController {
  async list(_req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const items = await col.find({}).sort({ code: 1 }).toArray();
    res.json({ success: true, data: items });
  }

  async create(req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const payload = req.body as Omit<Empresa, 'code'>;
    const code = await getNextCode();
    const doc: Empresa = { code, ...payload };
    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  async update(req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const { id } = req.params as { id: string };
    const { code, ...rest } = req.body as Partial<Empresa>;
    await col.updateOne({ _id: new ObjectId(id) } as any, { $set: rest });
    const updated = await col.findOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true, data: updated });
  }

  async remove(req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const { id } = req.params as { id: string };
    await col.deleteOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true });
  }
}