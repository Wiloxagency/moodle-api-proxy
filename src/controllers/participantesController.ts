import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { ObjectId } from 'mongodb';
import { getParticipantesCollection } from '../db/mongo';
import { Participante } from '../types/participante';

function toNumber(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? undefined : n;
}

function toPercent(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).toString().trim();
  if (s.endsWith('%')) return toNumber(s);
  const n = Number(s);
  if (isNaN(n)) return undefined;
  // If appears as 0-1 decimal, convert to percentage
  return n <= 1 ? Math.round(n * 100) : n;
}

function mapExcelRow(row: Record<string, any>): Participante | null {
  const get = (k: string) => row[k] ?? row[k.trim()];
  const numeroInscripcion = String(get('N° Inscripción') || get('Nº Inscripción') || get('N Inscripción') || get('N° Inscripcion') || get('Nº Inscripcion') || get('Inscripción') || '');
  if (!numeroInscripcion) return null;
  const nombres = String(get('Nombres') || '');
  const apellidos = String(get('Apellidos') || '');
  const rut = String(get('Rut') || get('RUT') || '');
  const mail = String(get('Mail') || get('Email') || get('Correo') || '');
  const telefono = String(get('TeléfFono') || get('Teléfono') || get('Telefono') || get('Tel') || '');
  const franquiciaPorcentaje = toPercent(get('% Franquicia'));
  const costoOtic = toNumber(get('Costo OTIC'));
  const costoEmpresa = toNumber(get('Costo Empresa'));
  const estadoInscripcion = String(get('Estado inscripción') || get('Estado Inscripción') || get('Estado') || '') || undefined;
  const observacion = String(get('Observación') || get('Observaciones') || '') || undefined;

  return {
    numeroInscripcion,
    nombres,
    apellidos,
    rut,
    mail,
    telefono: telefono || undefined,
    franquiciaPorcentaje,
    costoOtic,
    costoEmpresa,
    estadoInscripcion,
    observacion,
  };
}

export class ParticipantesController {
  // GET /api/participantes?numeroInscripcion=INS-0001
  async list(req: Request, res: Response) {
    const { numeroInscripcion } = req.query as { numeroInscripcion?: string };
    const col = await getParticipantesCollection();
    const filter: any = {};
    if (numeroInscripcion) filter.numeroInscripcion = String(numeroInscripcion);
    const items = await col.find(filter).toArray();
    res.json({ success: true, data: items });
  }

  // GET /api/participantes/counts?inscripciones=INS-0001,INS-0002
  async counts(req: Request, res: Response) {
    const col = await getParticipantesCollection();
    const { inscripciones } = req.query as { inscripciones?: string };
    const match: any = {};
    if (inscripciones) {
      const list = inscripciones.split(',').map(s => s.trim()).filter(Boolean);
      match.numeroInscripcion = { $in: list };
    }
    const agg = await col.aggregate([
      { $match: match },
      { $group: { _id: '$numeroInscripcion', count: { $sum: 1 } } }
    ]).toArray();
    const map: Record<string, number> = {};
    for (const r of agg) map[r._id] = r.count;
    res.json({ success: true, data: map });
  }

  // POST /api/participantes
  async create(req: Request, res: Response) {
    const payload = req.body as Participante;
    if (!payload || !payload.numeroInscripcion || !payload.rut) {
      res.status(400).json({ success: false, error: { message: 'numeroInscripcion and rut are required' } });
      return;
    }
    const col = await getParticipantesCollection();
    const result = await col.insertOne(payload);
    const created = await col.findOne({ _id: result.insertedId });
    res.status(201).json({ success: true, data: created });
  }

  // PUT /api/participantes/:id
  async update(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const payload = req.body as Partial<Participante>;
    const col = await getParticipantesCollection();
    await col.updateOne({ _id: new ObjectId(id) }, { $set: payload });
    const updated = await col.findOne({ _id: new ObjectId(id) });
    res.json({ success: true, data: updated });
  }

  // DELETE /api/participantes/:id
  async delete(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const col = await getParticipantesCollection();
    await col.deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true });
  }

  // POST /api/participantes/import { path, sheetName? }
  async importFromExcel(req: Request, res: Response) {
    const { path, sheetName } = req.body as { path: string; sheetName?: string };
    if (!path) {
      res.status(400).json({ success: false, error: { message: 'path is required' } });
      return;
    }
    const wb = XLSX.readFile(path);
    const wsName = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : (wb.SheetNames.find(n => n.toLowerCase().includes('particip')) || wb.SheetNames[0]);
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

    const mapped = rows.map(mapExcelRow).filter((r): r is Participante => !!r);

    const col = await getParticipantesCollection();

    // Upsert by (numeroInscripcion, rut) combination
    for (const r of mapped) {
      await col.updateOne(
        { numeroInscripcion: r.numeroInscripcion, rut: r.rut },
        { $set: r },
        { upsert: true }
      );
    }

    const total = await col.countDocuments();
    res.json({ success: true, data: { insertedOrUpdated: mapped.length, total } });
  }
}
