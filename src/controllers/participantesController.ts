import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { ObjectId } from 'mongodb';
import { getParticipantesCollection, getInscripcionesCollection } from '../db/mongo';
import { MoodleService } from '../services/moodleService';
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
    const normalizeRutKey = (rut: string) => rut.toString().trim().replace(/[\.\s]/g, '').toLowerCase();
    const doc: any = {
      ...payload,
      rutKey: normalizeRutKey(payload.rut)
    };
    const result = await col.insertOne(doc);
    const created = await col.findOne({ _id: result.insertedId });
    res.status(201).json({ success: true, data: created });
  }

  // PUT /api/participantes/:id
  async update(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const payload = req.body as Partial<Participante>;
    const col = await getParticipantesCollection();
    const toSet: any = { ...payload };
    if (payload.rut) {
      const normalizeRutKey = (rut: string) => rut.toString().trim().replace(/[\.\s]/g, '').toLowerCase();
      toSet.rutKey = normalizeRutKey(payload.rut);
    }
    await col.updateOne({ _id: new ObjectId(id) }, { $set: toSet });
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

    // Ensure unique index on (numeroInscripcion, rutKey)
    await col.createIndex({ numeroInscripcion: 1, rutKey: 1 }, { unique: true, name: 'uniq_numeroInscripcion_rutKey' }).catch(() => {});
    const normalizeRutKey = (rut: string) => rut.toString().trim().replace(/[\.\s]/g, '').toLowerCase();
    // Upsert by (numeroInscripcion, rutKey)
    for (const r of mapped) {
      const rut = (r.rut || '').toString().trim();
      const mail = (r.mail || '').toString().trim();
      const rutKey = normalizeRutKey(rut);
      const doc: any = {
        ...r,
        rut,
        rutKey,
        mail: mail || `sincorreo_${rut.toLowerCase()}@edutecno.com`,
        telefono: (r as any).telefono ? String((r as any).telefono) : null,
      };
      await col.updateOne(
        { numeroInscripcion: r.numeroInscripcion, rutKey },
        { $set: doc },
        { upsert: true }
      );
    }

    const total = await col.countDocuments();
    res.json({ success: true, data: { insertedOrUpdated: mapped.length, total } });
  }


  // POST /api/participantes/import/moodle { numeroInscripcion }
  async importFromMoodle(req: Request, res: Response) {
    const { numeroInscripcion } = req.body as { numeroInscripcion?: string };
    if (!numeroInscripcion) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion is required' } });
    }

    const insCol = await getInscripcionesCollection();
    const ins = await insCol.findOne({ numeroInscripcion } as any);
    if (!ins) {
      return res.status(404).json({ success: false, error: { message: 'Inscripción no encontrada' } });
    }

    // Determinar el identificador del curso en Moodle
    const idMoodleRaw = (ins as any).idMoodle as string | undefined;
    const codigoCursoRaw = (ins as any).codigoCurso as string | undefined;
    const providedCode = (idMoodleRaw && idMoodleRaw.trim()) || (codigoCursoRaw && codigoCursoRaw.trim()) || '';
    if (!providedCode) {
      return res.status(400).json({ success: false, error: { message: 'La inscripción no tiene ID Moodle ni Código del Curso' } });
    }

    const moodle = new MoodleService();

    // Resolver courseId: si es numérico directo, usarlo; si no, resolver por shortname o idnumber
    let courseId: number | null = null;
    const digits = providedCode.replace(/[^0-9]/g, '');
    if (digits) {
      const n = Number(digits);
      if (!Number.isNaN(n) && n > 0) courseId = n;
    }

    if (!courseId) {
      // Intentar shortname
      let courseResp = await moodle.getCoursesByField('shortname', providedCode);
      if (!courseResp.success || !courseResp.data || (courseResp.data as any).courses?.length === 0) {
        // Intentar idnumber
        courseResp = await moodle.getCoursesByField('idnumber', providedCode);
      }
      const courses = (courseResp && (courseResp as any).data && (courseResp as any).data.courses) || [];
      if (courses.length > 0) {
        // Elegir el primero que coincida exactamente por shortname o idnumber; si no, el primero
        const exact = courses.find((c: any) => c.shortname === providedCode || c.idnumber === providedCode) || courses[0];
        courseId = exact.id;
      }
    }

    if (!courseId) {
      return res.status(404).json({ success: false, error: { message: 'No se encontró un curso en Moodle para el código proporcionado' } });
    }

    const result = await moodle.getEnrolledUsers(courseId);
    if (!result.success) {
      const msg = result.error?.message || 'Error consultando Moodle';
      const lower = msg.toLowerCase();
      if (lower.includes('course') || lower.includes('curso')) {
        return res.status(404).json({ success: false, error: { message: 'Curso no encontrado en Moodle' } });
      }
      return res.status(502).json({ success: false, error: { message: msg } });
    }

    const users = (result.data || []) as any[];
    if (users.length === 0) {
      return res.json({ success: true, data: { inserted: 0, updated: 0, skipped: 0, total: 0, message: 'El curso no tiene alumnos matriculados' } });
    }

    // Map Moodle users a Participante
    const toRut = (u: any): string => {
      const idnumber = (u.idnumber ?? '').toString().trim();
      const username = (u.username ?? '').toString().trim();
      return idnumber || username || String(u.id);
    };
    const toTelefono = (u: any): string | undefined => {
      const t = (u.phone1 || u.phone || u.phone2 || '').toString().trim();
      return t || undefined;
    };
    const mapped = users.map(u => ({
      numeroInscripcion,
      nombres: (u.firstname ?? '').toString(),
      apellidos: (u.lastname ?? '').toString(),
      rut: toRut(u),
      mail: (u.email ?? '').toString(),
      telefono: toTelefono(u),
    })) as Participante[];

    const col = await getParticipantesCollection();
    let inserted = 0, updated = 0, skipped = 0;
    for (const r of mapped) {
      if (!r.rut) { skipped++; continue; }
      const resUp = await col.updateOne(
        { numeroInscripcion: r.numeroInscripcion, rut: r.rut },
        { $set: r },
        { upsert: true }
      );
      if (resUp.upsertedCount) inserted++; else if (resUp.modifiedCount) updated++; else skipped++;
    }
    const total = await col.countDocuments({ numeroInscripcion });
    return res.json({ success: true, data: { inserted, updated, skipped, total } });
  }


  // POST /api/participantes/import/bulk
  // Upsert a client-provided list of participantes (e.g., parsed from Excel in frontend)
  // Body: { numeroInscripcion: string, participantes: Array<Partial<Participante>> }
  async importBulk(req: Request, res: Response) {
    const { numeroInscripcion, participantes } = req.body as {
      numeroInscripcion?: string;
      participantes?: Array<Partial<Participante>>;
    };

    if (!numeroInscripcion || !participantes || !Array.isArray(participantes)) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion and participantes[] are required' } });
    }

    const col = await getParticipantesCollection();

    // Ensure unique index on (numeroInscripcion, rutKey) for deduplication inside an inscripción
    await col.createIndex({ numeroInscripcion: 1, rutKey: 1 }, { unique: true, name: 'uniq_numeroInscripcion_rutKey' }).catch(() => {/* ignore if exists */});

    const norm = (v?: string) => (v ?? '').toString().trim();
    const normalizeRutKey = (rut: string) => rut.toString().trim().replace(/[\.\s]/g, '').toLowerCase();
    const emailFor = (rut: string, mail?: string) => {
      const m = norm(mail);
      if (m) return m;
      const rutEmail = rut.replace(/\s/g, '').toLowerCase();
      return `sincorreo_${rutEmail}@edutecno.com`;
    };

    const ops = [] as import('mongodb').AnyBulkWriteOperation<any>[];

    for (const p of participantes) {
      const rutRaw = norm(p.rut || '');
      if (!rutRaw) continue; // skip rows without rut
      const rutKey = normalizeRutKey(rutRaw);

      const doc: any = {
        numeroInscripcion,
        rut: rutRaw,
        rutKey,
        nombres: norm(p.nombres || ''),
        apellidos: norm(p.apellidos || ''),
        mail: emailFor(rutRaw, p.mail),
        telefono: norm(p.telefono || '') || null,
        franquiciaPorcentaje: p.franquiciaPorcentaje ?? undefined,
        costoOtic: p.costoOtic ?? undefined,
        costoEmpresa: p.costoEmpresa ?? undefined,
        estadoInscripcion: norm(p.estadoInscripcion || '' ) || undefined,
        observacion: norm(p.observacion || '') || undefined,
      };

      ops.push({
        updateOne: {
          filter: { numeroInscripcion, rutKey },
          update: { $set: doc },
          upsert: true,
        }
      });
    }

    if (ops.length === 0) {
      return res.json({ success: true, data: { inserted: 0, updated: 0, total: 0 } });
    }

    const result = await col.bulkWrite(ops, { ordered: false });
    const inserted = (result.upsertedCount) || 0;
    const updated = (result.modifiedCount) || 0;
    const total = await col.countDocuments({ numeroInscripcion });
    return res.json({ success: true, data: { inserted, updated, total } });
  }
}
