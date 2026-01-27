import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getSenceCollection } from '../db/mongo';
import { Sence } from '../types/sence';

async function getNextCode(): Promise<number> {
  const col = await getSenceCollection();
  const last = await col.find({}).sort({ code: -1 }).limit(1).toArray();
  if (!last.length) return 1;
  return (last[0].code || 0) + 1;
}

export class SenceController {
  async list(_req: Request, res: Response): Promise<void> {
    const col = await getSenceCollection();
    const items = await col.find({}).sort({ code: 1 }).toArray();
    res.json({ success: true, data: items });
  }

  async create(req: Request, res: Response): Promise<void> {
    const col = await getSenceCollection();
    const payload = req.body as Omit<Sence, 'code'>;
    const code = await getNextCode();
    const doc: Sence = { code, ...payload };
    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  async update(req: Request, res: Response): Promise<void> {
    const col = await getSenceCollection();
    const { id } = req.params as { id: string };
    const { code, ...rest } = req.body as Partial<Sence>;
    await col.updateOne({ _id: new ObjectId(id) } as any, { $set: rest });
    const updated = await col.findOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true, data: updated });
  }

  async remove(req: Request, res: Response): Promise<void> {
    const col = await getSenceCollection();
    const { id } = req.params as { id: string };
    await col.deleteOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true });
  }

  // POST /api/sence/import/bulk
  // Body: { cursos: Array<Partial<Sence>> }
  async importBulk(req: Request, res: Response): Promise<void> {
    const { cursos } = req.body as { cursos?: Array<Partial<Sence>> };

    if (!cursos || !Array.isArray(cursos)) {
      res.status(400).json({ success: false, error: { message: 'cursos[] es requerido' } });
      return;
    }

    const col = await getSenceCollection();

    // Obtener el próximo código secuencial para nuevas filas
    let nextCode = await getNextCode();

    const normStr = (v?: string) => (v ?? '').toString().trim();
    const toNum = (v: any): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const s = String(v).replace(/\s+/g, '').replace(',', '.');
      const n = Number(s.replace(/[^0-9.-]/g, ''));
      return Number.isNaN(n) ? undefined : n;
    };
    const toBool = (v: any): boolean | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const s = String(v).toString().trim().toLowerCase();
      if (!s) return undefined;
      if (['si', 'sí', 'yes', 'true', '1', 'x'].includes(s)) return true;
      if (['no', 'false', '0'].includes(s)) return false;
      return undefined;
    };

    const ops = [] as import('mongodb').AnyBulkWriteOperation<any>[];

    for (const c of cursos) {
      const codigo = normStr(c.codigo_sence || '');
      if (!codigo) continue; // ignorar filas sin Código Sence

      const base: any = {
        codigo_sence: codigo,
        nombre_sence: normStr(c.nombre_sence),
        horas_teoricas: c.horas_teoricas ?? toNum((c as any).horas_teoricas),
        horas_practicas: c.horas_practicas ?? toNum((c as any).horas_practicas),
        horas_elearning: c.horas_elearning ?? toNum((c as any).horas_elearning),
        horas_totales: c.horas_totales ?? toNum((c as any).horas_totales),
        numero_participantes: c.numero_participantes ?? toNum((c as any).numero_participantes),
        termino_vigencia: normStr(c.termino_vigencia),
        area: normStr(c.area),
        especialidad: normStr(c.especialidad),
        modalidad_instruccion: normStr(c.modalidad_instruccion),
        modo: normStr(c.modo),
        valor_efectivo_participante: c.valor_efectivo_participante ?? toNum((c as any).valor_efectivo_participante),
        valor_maximo_imputable: c.valor_maximo_imputable ?? toNum((c as any).valor_maximo_imputable),
        numero_solicitud: normStr(c.numero_solicitud),
        fecha_resolucion: normStr(c.fecha_resolucion),
        numero_resolucion: normStr(c.numero_resolucion),
        valor_hora_imputable: c.valor_hora_imputable ?? toNum((c as any).valor_hora_imputable),
        exclusivo_cliente: c.exclusivo_cliente ?? toBool((c as any).exclusivo_cliente),
        dirigido_por_relator: c.dirigido_por_relator ?? toBool((c as any).dirigido_por_relator),
        incluye_tablet: c.incluye_tablet ?? toBool((c as any).incluye_tablet),
        otec: normStr(c.otec),
        id_sence: normStr(c.id_sence),
        id_moodle: normStr(c.id_moodle),
      };

      ops.push({
        updateOne: {
          filter: { codigo_sence: codigo },
          update: {
            $set: base,
            $setOnInsert: { code: nextCode++ },
          },
          upsert: true,
        },
      });
    }

    if (ops.length === 0) {
      res.json({ success: true, data: { inserted: 0, updated: 0, total: 0 } });
      return;
    }

    const result = await col.bulkWrite(ops, { ordered: false });
    const inserted = result.upsertedCount || 0;
    const updated = result.modifiedCount || 0;
    const total = await col.countDocuments();

    res.json({ success: true, data: { inserted, updated, total } });
  }
}
