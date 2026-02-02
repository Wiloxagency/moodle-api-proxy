import { Request, Response } from 'express';
import { getDashboardCacheCollection, getEmpresasCollection, getGradesReportsCollection, getInscripcionesCollection, getParticipantesCollection } from '../db/mongo';

interface Metrics {
  becados: number;
  empresa: number;
  sence: number;
  senceEmpresa: number;
}

interface DashboardInscripcionCache {
  numeroInscripcion: number | string;
  idMoodle?: string;
  correlativo?: number;
  empresa?: number;
  nombreCurso?: string;
  modalidad?: string;
  inicio?: string;
  termino?: string;
  numAlumnosInscritos?: number;
  participantCount: number;
  totalByCategory: Metrics;
  zeroByCategory: Metrics;
}

interface DashboardCacheDoc {
  _id: string;
  updatedAt: string;
  inscripciones: DashboardInscripcionCache[];
}

const emptyMetrics = (): Metrics => ({ becados: 0, empresa: 0, sence: 0, senceEmpresa: 0 });

const normalizeRut = (v?: string): string => {
  return String(v || '').replace(/[^0-9kK]/g, '').toLowerCase();
};

const toNum = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const classifyParticipant = (p: any): keyof Metrics => {
  const vc = Number(p?.valorCobrado ?? 0);
  const f = Number(p?.franquiciaPorcentaje ?? 0);
  if (vc === 0) return 'becados';
  if (f === 100) return 'sence';
  if (f === 0) return 'empresa';
  return 'senceEmpresa';
};

async function buildCache(): Promise<DashboardCacheDoc> {
  const [insCol, partCol, gradesCol, empCol] = await Promise.all([
    getInscripcionesCollection(),
    getParticipantesCollection(),
    getGradesReportsCollection(),
    getEmpresasCollection(),
  ]);

  const [inscripciones, empresas] = await Promise.all([
    insCol.find({}).toArray(),
    empCol.find({}).toArray(),
  ]);
  const updatedAt = new Date().toISOString();

  const empresaByName = new Map<string, number>();
  const empresaByCode = new Map<string, number>();
  for (const e of empresas) {
    if (e && typeof (e as any).code === 'number') {
      empresaByCode.set(String((e as any).code), (e as any).code);
    }
    const nombre = String((e as any).nombre || '').trim().toLowerCase();
    if (nombre) empresaByName.set(nombre, (e as any).code);
  }

  const normalizeEmpresa = (value: any): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value).trim();
    if (!raw) return undefined;
    const num = Number(raw);
    if (Number.isFinite(num)) return num;
    const mapped = empresaByName.get(raw.toLowerCase());
    if (mapped !== undefined) return mapped;
    const mappedByCode = empresaByCode.get(raw);
    if (mappedByCode !== undefined) return mappedByCode;
    return undefined;
  };

  const numerosSet = new Set<any>();
  for (const ins of inscripciones) {
    const n = (ins as any).numeroInscripcion;
    if (n === null || n === undefined) continue;
    numerosSet.add(n);
    const asNum = Number(n);
    if (!Number.isNaN(asNum)) numerosSet.add(asNum);
    numerosSet.add(String(n));
  }
  const numeros = Array.from(numerosSet);

  const [participantes, grades] = await Promise.all([
    partCol.find({ numeroInscripcion: { $in: numeros } }).toArray(),
    gradesCol.find({ numeroInscripcion: { $in: numeros }, RutAlumno: { $exists: true } }).toArray(),
  ]);

  const participantesPorInscripcion = new Map<string, any[]>();
  for (const p of participantes) {
    const key = String((p as any).numeroInscripcion ?? '');
    if (!key) continue;
    const arr = participantesPorInscripcion.get(key) || [];
    arr.push(p);
    participantesPorInscripcion.set(key, arr);
  }

  const gradesPorInscripcion = new Map<string, Map<string, any>>();
  for (const g of grades) {
    const key = String((g as any).numeroInscripcion ?? '');
    if (!key) continue;
    const rutKey = normalizeRut((g as any).RutAlumno || '');
    if (!rutKey) continue;
    const map = gradesPorInscripcion.get(key) || new Map<string, any>();
    map.set(rutKey, g);
    gradesPorInscripcion.set(key, map);
  }

  const cacheItems: DashboardInscripcionCache[] = [];
  for (const ins of inscripciones) {
    const key = String((ins as any).numeroInscripcion ?? '');
    if (!key) continue;
    const parts = participantesPorInscripcion.get(key) || [];
    const gradesMap = gradesPorInscripcion.get(key);

    const totals = emptyMetrics();
    const zeroes = emptyMetrics();

    for (const p of parts) {
      const category = classifyParticipant(p);
      totals[category] += 1;
      const rutKey = normalizeRut((p as any).rut || '');
      const grade = rutKey ? gradesMap?.get(rutKey) : undefined;
      if (grade) {
        const avance = toNum((grade as any).PorcentajeAvance);
        if (avance === null || avance === 0) {
          zeroes[category] += 1;
        }
      }
    }

    cacheItems.push({
      numeroInscripcion: (ins as any).numeroInscripcion ?? '',
      idMoodle: (ins as any).idMoodle,
      correlativo: (ins as any).correlativo,
      empresa: normalizeEmpresa((ins as any).empresa),
      nombreCurso: (ins as any).nombreCurso,
      modalidad: (ins as any).modalidad,
      inicio: (ins as any).inicio,
      termino: (ins as any).termino,
      numAlumnosInscritos: (ins as any).numAlumnosInscritos,
      participantCount: parts.length,
      totalByCategory: totals,
      zeroByCategory: zeroes,
    });
  }

  return {
    _id: 'dashboard_cache',
    updatedAt,
    inscripciones: cacheItems,
  };
}

export class DashboardController {
  async getCache(req: Request, res: Response): Promise<void> {
    const refresh = String(req.query.refresh || '').toLowerCase();
    const shouldRefresh = refresh === '1' || refresh === 'true' || refresh === 'yes';
    const cacheCol = await getDashboardCacheCollection();

    if (!shouldRefresh) {
      const existing = await cacheCol.findOne({ _id: 'dashboard_cache' } as any);
      if (existing) {
        res.json({ success: true, data: existing });
        return;
      }
    }

    const doc = await buildCache();
    await cacheCol.updateOne({ _id: doc._id } as any, { $set: doc } as any, { upsert: true });
    res.json({ success: true, data: doc });
  }
}
