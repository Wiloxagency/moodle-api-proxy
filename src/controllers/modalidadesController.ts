import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { catalogScopeFilter, resolveCatalogScope } from '../utils/catalogScope';
import { getModalidadesCollection } from '../db/mongo';
import { Modalidad } from '../types/modalidad';

async function getNextCode(): Promise<number> {
  const col = await getModalidadesCollection();
  const last = await col.find({}).sort({ code: -1 }).limit(1).toArray();
  if (!last.length) return 1;
  return (last[0].code || 0) + 1;
}

export class ModalidadesController {
  // GET ?empresa=<code>: catálogo propio de un White Label; sin él, el global.
  async list(req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const scope = await resolveCatalogScope((req.query as any)?.empresa);
    const items = await col.find(catalogScopeFilter(scope) as any).sort({ code: 1 }).toArray();
    res.json({ success: true, data: items });
  }

  async create(req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const { empresa: empresaRaw, ...payload } = req.body as Omit<Modalidad, 'code'> & { empresa?: unknown };
    const scope = await resolveCatalogScope(empresaRaw ?? (req.query as any)?.empresa);
    const code = await getNextCode();
    const doc: Modalidad = { code, ...payload, ...(scope !== null ? { empresa: scope } : {}) };
    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  async update(req: Request, res: Response): Promise<void> {
    const col = await getModalidadesCollection();
    const { id } = req.params as { id: string };
    // `empresa` no se edita: un registro no cambia de ámbito (global / White Label).
    const { code, empresa: _empresa, ...rest } = req.body as Partial<Modalidad> & { empresa?: unknown };
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