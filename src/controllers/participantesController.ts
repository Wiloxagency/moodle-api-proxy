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
  const numeroInscripcion = toNumber(get('N° Inscripción') || get('Nº Inscripción') || get('N Inscripción') || get('N° Inscripcion') || get('Nº Inscripcion') || get('Inscripción') || '');
  if (!numeroInscripcion) return null;
  const nombres = String(get('Nombres') || '');
  const apellidos = String(get('Apellidos') || '');
  const rut = String(get('Rut') || get('RUT') || '');
  const mail = String(
    get('Mail') ||
    get('Email') ||
    get('Correo') ||
    get('Correo electrónico') ||
    get('Correo Electronico') ||
    ''
  );
  const telefono = String(get('TeléfFono') || get('Teléfono') || get('Telefono') || get('Tel') || '');
  const franquiciaPorcentaje = toPercent(get('% Franquicia'));
  const valorCobrado = toNumber(get('Valor Cobrado') || get('Valor cobrado') || get('ValorCobrado'));
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
    valorCobrado,
    costoOtic,
    costoEmpresa,
    estadoInscripcion,
    observacion,
  };
}


const normalizeRutKey = (rut: string): string => rut.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeText = (v: unknown): string => (v ?? '').toString().trim();

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const buildPlaceholderEmail = (rutKey: string): string => {
  const safe = rutKey.replace(/[^a-z0-9]/g, '') || `${Date.now()}`;
  return `alumno.${safe}@example.com`;
};

const buildTemporaryPassword = (): string => {
  const random = Math.random().toString(36).slice(2, 10);
  return `Tmp#${random}Aa1!`;
};


const sanitizeMoodleUsername = (value: string): string => value.toLowerCase().replace(/[^a-z0-9._@-]/g, '');

const buildMoodleUsername = (rutRaw: string, rutKey: string): string => {
  const base = sanitizeMoodleUsername(rutKey || rutRaw);
  const fallback = sanitizeMoodleUsername(`alumno_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
  const candidate = (base.length >= 3 ? base : (fallback || 'alumno')).slice(0, 100);
  return (/^[a-z]/.test(candidate) ? candidate : `u_${candidate}`).slice(0, 100);
};

const buildUniqueMoodleUsername = (baseUsername: string): string => {
  const safeBase = sanitizeMoodleUsername(baseUsername) || 'alumno';
  const prefixed = /^[a-z]/.test(safeBase) ? safeBase : `u_${safeBase}`;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${prefixed.slice(0, 95)}_${suffix}`;
};

const buildMoodleIdnumber = (rutRaw: string, rutKey: string): string => {
  const raw = normalizeText(rutRaw);
  if (rutKey) return rutKey;
  if (raw) return raw;
  return `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
};

const isUsernameConflictError = (message: string): boolean => {
  const m = message.toLowerCase();
  return m.includes('username') && (m.includes('exist') || m.includes('already') || m.includes('taken') || m.includes('ya existe'));
};


const isInvalidParameterError = (message: string): boolean => {
  const m = message.toLowerCase();
  return m.includes('invalid parameter') || m.includes('parámetro no válido') || m.includes('valor de parámetro no válido');
};

const extractMoodleErrorDetail = (error: any): string => {
  const msg = normalizeText(error?.message) || 'sin detalle';
  const debug = normalizeText(error?.details?.debuginfo);
  return debug ? `${msg} - ${debug}` : msg;
};

const parseNumeroInscripcion = (value: string | number): { raw: string; num: number } | null => {
  const raw = value?.toString().trim();
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return { raw, num };
};

const isAlreadyEnrolledError = (message: string): boolean => {
  const m = message.toLowerCase();
  return m.includes('already') || m.includes('ya') || m.includes('enrol') || m.includes('matric');
};

const toErrorMessage = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) return String((value as { message?: unknown }).message || 'Error');
  return 'Error';
};

async function resolveMoodleCourseId(moodle: MoodleService, providedCode: string): Promise<number | null> {
  let courseId: number | null = null;

  const digits = providedCode.replace(/[^0-9]/g, '');
  if (digits) {
    const n = Number(digits);
    if (!Number.isNaN(n) && n > 0) {
      courseId = n;
    }
  }

  if (!courseId) {
    let courseResp = await moodle.getCoursesByField('shortname', providedCode);
    if (!courseResp.success || !courseResp.data || (courseResp.data as any).courses?.length === 0) {
      courseResp = await moodle.getCoursesByField('idnumber', providedCode);
    }

    const courses = (courseResp && (courseResp as any).data && (courseResp as any).data.courses) || [];
    if (courses.length > 0) {
      const exact = courses.find((c: any) => c.shortname === providedCode || c.idnumber === providedCode) || courses[0];
      courseId = Number(exact.id);
    }
  }

  return courseId && Number.isFinite(courseId) ? courseId : null;
}

export class ParticipantesController {
  // GET /api/participantes?numeroInscripcion=INS-0001
  async list(req: Request, res: Response) {
    const { numeroInscripcion } = req.query as { numeroInscripcion?: string };
    const col = await getParticipantesCollection();
    const filter: any = {};
    if (numeroInscripcion) filter.numeroInscripcion = Number(numeroInscripcion);
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
      match.numeroInscripcion = { $in: list.map(Number) };
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
      numeroInscripcion: Number(payload.numeroInscripcion),
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
        mail, // si viene vacío desde el Excel, se guarda vacío
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
    const { numeroInscripcion } = req.body as { numeroInscripcion?: string | number };
    if (numeroInscripcion === undefined || numeroInscripcion === null || `${numeroInscripcion}`.trim() === '') {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion is required' } });
    }

    const parsed = parseNumeroInscripcion(numeroInscripcion);
    if (!parsed) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion inválido' } });
    }

    const insCol = await getInscripcionesCollection();
    const ins = await insCol.findOne({
      $or: [
        { numeroInscripcion: parsed.num },
        { numeroInscripcion: parsed.raw }
      ]
    } as any);
    if (!ins) {
      return res.status(404).json({ success: false, error: { message: 'Inscripción no encontrada' } });
    }

    // Determinar el identificador del curso en Moodle
    const idMoodleRaw = normalizeText((ins as any).idMoodle);
    const codigoCursoRaw = normalizeText((ins as any).codigoCurso);
    const providedCode = idMoodleRaw || codigoCursoRaw;
    if (!providedCode) {
      return res.status(400).json({ success: false, error: { message: 'La inscripción no tiene ID Moodle ni Código del Curso' } });
    }

    const moodle = new MoodleService();
    const courseId = await resolveMoodleCourseId(moodle, providedCode);
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
      const idnumber = normalizeText(u.idnumber);
      const username = normalizeText(u.username);
      return idnumber || username || String(u.id);
    };
    const toTelefono = (u: any): string | undefined => {
      const t = normalizeText(u.phone1 || u.phone || u.phone2 || '');
      return t || undefined;
    };

    const mapped: Participante[] = users.map((u: any) => ({
      numeroInscripcion: parsed.num,
      nombres: normalizeText(u.firstname),
      apellidos: normalizeText(u.lastname),
      rut: toRut(u),
      mail: normalizeText(u.email),
      telefono: toTelefono(u),
    }));

    const col = await getParticipantesCollection();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const r of mapped) {
      if (!r.rut) {
        skipped++;
        continue;
      }
      const resUp = await col.updateOne(
        { numeroInscripcion: r.numeroInscripcion, rut: r.rut },
        { $set: r },
        { upsert: true }
      );
      if (resUp.upsertedCount) inserted++;
      else if (resUp.modifiedCount) updated++;
      else skipped++;
    }

    const total = await col.countDocuments({ numeroInscripcion: parsed.num });
    return res.json({ success: true, data: { inserted, updated, skipped, total } });
  }

  // POST /api/participantes/enroll/moodle { numeroInscripcion }
  async enrollInMoodle(req: Request, res: Response) {
    const { numeroInscripcion } = req.body as { numeroInscripcion?: string | number };
    if (numeroInscripcion === undefined || numeroInscripcion === null || `${numeroInscripcion}`.trim() === '') {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion is required' } });
    }

    const parsed = parseNumeroInscripcion(numeroInscripcion);
    if (!parsed) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion inválido' } });
    }

    const insCol = await getInscripcionesCollection();
    const ins = await insCol.findOne({
      $or: [
        { numeroInscripcion: parsed.num },
        { numeroInscripcion: parsed.raw }
      ]
    } as any);

    if (!ins) {
      return res.status(404).json({ success: false, error: { message: 'Inscripción no encontrada' } });
    }

    const idMoodleRaw = normalizeText((ins as any).idMoodle);
    const codigoCursoRaw = normalizeText((ins as any).codigoCurso);
    const providedCode = idMoodleRaw || codigoCursoRaw;

    if (!providedCode) {
      return res.status(400).json({ success: false, error: { message: 'La inscripción no tiene ID Moodle ni Código del Curso' } });
    }

    const moodle = new MoodleService();
    const courseId = await resolveMoodleCourseId(moodle, providedCode);

    if (!courseId) {
      return res.status(404).json({ success: false, error: { message: 'No se encontró un curso en Moodle para el código proporcionado' } });
    }

    const participantesCol = await getParticipantesCollection();
    const rawParticipantes = await participantesCol.find({
      $or: [
        { numeroInscripcion: parsed.num },
        { numeroInscripcion: parsed.raw }
      ]
    } as any).toArray();

    if (rawParticipantes.length === 0) {
      return res.json({
        success: true,
        data: {
          processed: 0,
          total: 0,
          duplicateRows: 0,
          skipped: 0,
          createdUsers: 0,
          updatedUsers: 0,
          newlyEnrolled: 0,
          alreadyEnrolled: 0,
          failed: 0,
          message: 'No hay participantes para inscribir en Moodle'
        }
      });
    }

    const uniqueByRut = new Map<string, { rutKey: string; participante: any }>();
    let skippedNoRut = 0;
    for (const p of rawParticipantes) {
      const rutRaw = normalizeText((p as any).rut);
      if (!rutRaw) {
        skippedNoRut++;
        continue;
      }
      const rutKey = normalizeRutKey(rutRaw);
      const dedupeKey = rutKey || `raw:${rutRaw.toLowerCase()}`;
      uniqueByRut.set(dedupeKey, { rutKey, participante: p });
    }

    const uniqueParticipantes = Array.from(uniqueByRut.values());

    const duplicateRows = Math.max(0, rawParticipantes.length - uniqueParticipantes.length - skippedNoRut);

    if (uniqueParticipantes.length === 0) {
      return res.json({
        success: true,
        data: {
          processed: 0,
          total: rawParticipantes.length,
          duplicateRows,
          skipped: skippedNoRut,
          createdUsers: 0,
          updatedUsers: 0,
          newlyEnrolled: 0,
          alreadyEnrolled: 0,
          failed: 0,
          message: 'No hay participantes con RUT válido para inscribir en Moodle'
        }
      });
    }

    const enrolledUsersResp = await moodle.getEnrolledUsers(courseId);
    if (!enrolledUsersResp.success) {
      const msg = enrolledUsersResp.error?.message || 'Error consultando inscritos del curso en Moodle';
      const lower = msg.toLowerCase();
      if (lower.includes('course') || lower.includes('curso')) {
        return res.status(404).json({ success: false, error: { message: 'Curso no encontrado en Moodle' } });
      }
      return res.status(502).json({ success: false, error: { message: msg } });
    }

    const knownUsersByRutKey = new Map<string, any>();
    const enrolledUserIds = new Set<number>();

    const rememberUser = (u: any): void => {
      if (!u || typeof u !== 'object') return;

      const idnumber = normalizeText(u.idnumber);
      if (idnumber) {
        knownUsersByRutKey.set(normalizeRutKey(idnumber), u);
      }

      const username = normalizeText(u.username);
      if (username) {
        const key = normalizeRutKey(username);
        if (!knownUsersByRutKey.has(key)) {
          knownUsersByRutKey.set(key, u);
        }
      }
    };

    const initiallyEnrolled = Array.isArray(enrolledUsersResp.data) ? enrolledUsersResp.data : [];
    for (const u of initiallyEnrolled) {
      rememberUser(u);
      const userId = Number((u as any).id);
      if (Number.isFinite(userId) && userId > 0) {
        enrolledUserIds.add(userId);
      }
    }

    const pickExactByField = (users: any[] | undefined, field: 'idnumber' | 'username', expectedRutKey: string): any | null => {
      if (!Array.isArray(users) || users.length === 0) return null;
      const exact = users.find((u: any) => normalizeRutKey(normalizeText((u as any)[field])) === expectedRutKey);
      return exact || null;
    };

    const buildLookupValues = (rutRaw: string, rutKey: string, extraLookupValues: string[] = []): string[] => {
      const values = new Set<string>();
      const raw = normalizeText(rutRaw);
      const rawKey = normalizeRutKey(raw);

      if (raw) values.add(raw);
      if (rutKey) values.add(rutKey);
      if (rawKey) values.add(rawKey);

      for (const value of extraLookupValues) {
        const normalized = normalizeText(value);
        if (normalized) values.add(normalized);
      }

      return Array.from(values);
    };

    const findUserByRut = async (
      rutRaw: string,
      rutKey: string,
      extraLookupValues: string[] = [],
      emailCandidate?: string
    ): Promise<any | null> => {
      const cacheKeys = new Set<string>();
      if (rutKey) cacheKeys.add(rutKey);
      const rawKey = normalizeRutKey(rutRaw);
      if (rawKey) cacheKeys.add(rawKey);

      for (const key of cacheKeys) {
        const cached = knownUsersByRutKey.get(key);
        if (cached) return cached;
      }

      const lookupValues = buildLookupValues(rutRaw, rutKey, extraLookupValues);

      for (const value of lookupValues) {
        const expectedKey = normalizeRutKey(value);
        if (!expectedKey) continue;

        const byIdnumber = await moodle.getUsersByField('idnumber', value);
        if (byIdnumber.success) {
          const found = pickExactByField(byIdnumber.data as any[], 'idnumber', expectedKey);
          if (found) {
            rememberUser(found);
            return found;
          }
        }

        const byUsername = await moodle.getUsersByField('username', value);
        if (byUsername.success) {
          const found = pickExactByField(byUsername.data as any[], 'username', expectedKey);
          if (found) {
            rememberUser(found);
            return found;
          }
        }
      }

      const normalizedEmail = normalizeText(emailCandidate || '').toLowerCase();
      if (normalizedEmail && isValidEmail(normalizedEmail)) {
        const byEmail = await moodle.getUsersByField('email', normalizedEmail);
        if (byEmail.success && Array.isArray(byEmail.data) && byEmail.data.length > 0) {
          const exact = (byEmail.data as any[]).find((u: any) => normalizeText(u.email).toLowerCase() === normalizedEmail) || (byEmail.data as any[])[0];
          if (exact) {
            rememberUser(exact);
            return exact;
          }
        }
      }

      return null;
    };

    let createdUsers = 0;
    let updatedUsers = 0;
    let newlyEnrolled = 0;
    let alreadyEnrolled = 0;
    let failed = 0;
    const warnings: string[] = [];

    for (const { rutKey, participante } of uniqueParticipantes) {
      const rutRaw = normalizeText((participante as any).rut);
      if (!rutRaw) {
        skippedNoRut++;
        continue;
      }

      try {
        const mailRaw = normalizeText((participante as any).mail).toLowerCase();
        const validEmail = isValidEmail(mailRaw) ? mailRaw : '';

        let moodleUser = await findUserByRut(rutRaw, rutKey, [], validEmail);
        let wasCreated = false;

        const moodleIdnumber = buildMoodleIdnumber(rutRaw, rutKey);

        if (!moodleUser) {
          const baseUsername = buildMoodleUsername(rutRaw, rutKey);
          const firstname = normalizeText((participante as any).nombres) || 'SinNombre';
          const lastname = normalizeText((participante as any).apellidos) || 'SinApellido';
          const email = validEmail || buildPlaceholderEmail(rutKey || 'sinrut');

          let createResp = await moodle.createUser({
            username: baseUsername,
            firstname,
            lastname,
            email,
            password: buildTemporaryPassword(),
            idnumber: moodleIdnumber
          });

          if ((!createResp.success || !createResp.data || !Number.isFinite(Number((createResp.data as any).id))) && isUsernameConflictError(createResp.error?.message || '')) {
            const retryUsername = buildUniqueMoodleUsername(baseUsername);
            createResp = await moodle.createUser({
              username: retryUsername,
              firstname,
              lastname,
              email,
              password: buildTemporaryPassword(),
              idnumber: moodleIdnumber
            });
          }

          if ((!createResp.success || !createResp.data || !Number.isFinite(Number((createResp.data as any).id))) && isInvalidParameterError(createResp.error?.message || '')) {
            const strictUsername = buildUniqueMoodleUsername('alumno');
            const strictEmail = isValidEmail(mailRaw) ? mailRaw : `alumno.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}@example.com`;
            createResp = await moodle.createUser({
              username: strictUsername,
              firstname,
              lastname,
              email: strictEmail,
              password: buildTemporaryPassword()
            });
          }

          if (!createResp.success || !createResp.data || !Number.isFinite(Number((createResp.data as any).id))) {
            // Reintento de lookup por idnumber/username por si el usuario ya existía
            moodleUser = await findUserByRut(rutRaw, rutKey, [baseUsername, moodleIdnumber], validEmail);
            if (!moodleUser) {
              failed++;
              warnings.push(`RUT ${rutRaw}: no fue posible crear/ubicar usuario en Moodle (${extractMoodleErrorDetail(createResp.error)})`);
              continue;
            }
          } else {
            moodleUser = createResp.data;
            wasCreated = true;
            createdUsers++;
            rememberUser(moodleUser);
          }
        }

        const userId = Number((moodleUser as any).id);
        if (!Number.isFinite(userId) || userId <= 0) {
          failed++;
          warnings.push(`RUT ${rutRaw}: usuario Moodle inválido`);
          continue;
        }

        if (!wasCreated) {
          const firstName = normalizeText((participante as any).nombres);
          const lastName = normalizeText((participante as any).apellidos);
          const phone = normalizeText((participante as any).telefono);

          const updatePayload: {
            id: number;
            idnumber: string;
            firstname?: string;
            lastname?: string;
            email?: string;
            phone1?: string;
          } = {
            id: userId,
            idnumber: moodleIdnumber
          };

          if (firstName) updatePayload.firstname = firstName;
          if (lastName) updatePayload.lastname = lastName;
          if (validEmail) updatePayload.email = validEmail;
          if (phone) updatePayload.phone1 = phone;

          const updateResp = await moodle.updateUser(updatePayload);
          if (updateResp.success) {
            updatedUsers++;
          } else {
            warnings.push(`RUT ${rutRaw}: no se pudieron actualizar datos (${updateResp.error?.message || 'sin detalle'})`);
          }
        }

        if (enrolledUserIds.has(userId)) {
          alreadyEnrolled++;
          continue;
        }

        const enrollResp = await moodle.enrollUser(courseId, userId, 5);
        if (!enrollResp.success) {
          const enrollMsg = enrollResp.error?.message || 'Error inscribiendo en Moodle';
          if (isAlreadyEnrolledError(enrollMsg)) {
            alreadyEnrolled++;
            enrolledUserIds.add(userId);
            continue;
          }

          failed++;
          warnings.push(`RUT ${rutRaw}: ${enrollMsg}`);
          continue;
        }

        enrolledUserIds.add(userId);
        newlyEnrolled++;
      } catch (error: unknown) {
        failed++;
        warnings.push(`RUT ${rutRaw}: ${toErrorMessage(error)}`);
      }
    }

    const processed = uniqueParticipantes.length;
    return res.json({
      success: true,
      data: {
        processed,
        total: rawParticipantes.length,
        duplicateRows,
        skipped: skippedNoRut,
        createdUsers,
        updatedUsers,
        newlyEnrolled,
        alreadyEnrolled,
        failed,
        warnings: warnings.length > 0 ? warnings : undefined,
        message: `Inscripción en Moodle finalizada: procesados ${processed}, nuevos inscritos ${newlyEnrolled}, ya inscritos ${alreadyEnrolled}, usuarios creados ${createdUsers}, perfiles actualizados ${updatedUsers}, omitidos ${skippedNoRut}, errores ${failed}.`
      }
    });
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

    // Normalizar numeroInscripcion a número para ser consistente con el resto del sistema
    const numeroInscripcionNum = Number(numeroInscripcion);

    // Ensure unique index on (numeroInscripcion, rutKey) for deduplication inside an inscripción
    await col.createIndex({ numeroInscripcion: 1, rutKey: 1 }, { unique: true, name: 'uniq_numeroInscripcion_rutKey' }).catch(() => {/* ignore if exists */});

    const norm = (v?: string) => (v ?? '').toString().trim();
    const normalizeRutKey = (rut: string) => rut.toString().trim().replace(/[\.\s]/g, '').toLowerCase();
    const emailFor = (_rut: string, mail?: string) => {
      // No inventar correo: devolver tal cual (normalizado) o cadena vacía
      return norm(mail);
    };

    const ops = [] as import('mongodb').AnyBulkWriteOperation<any>[];

    for (const p of participantes) {
      const rutRaw = norm(p.rut || '');
      if (!rutRaw) continue; // skip rows without rut
      const rutKey = normalizeRutKey(rutRaw);

      const doc: any = {
        numeroInscripcion: numeroInscripcionNum,
        rut: rutRaw,
        rutKey,
        nombres: norm(p.nombres || ''),
        apellidos: norm(p.apellidos || ''),
        mail: emailFor(rutRaw, p.mail),
        telefono: norm(p.telefono || '') || null,
        franquiciaPorcentaje: p.franquiciaPorcentaje ?? undefined,
        valorCobrado: p.valorCobrado ?? undefined,
        costoOtic: p.costoOtic ?? undefined,
        costoEmpresa: p.costoEmpresa ?? undefined,
        estadoInscripcion: norm(p.estadoInscripcion || '' ) || undefined,
        observacion: norm(p.observacion || '') || undefined,
      };

      ops.push({
        updateOne: {
          filter: { numeroInscripcion: numeroInscripcionNum, rutKey },
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
    const total = await col.countDocuments({ numeroInscripcion: numeroInscripcionNum });
    return res.json({ success: true, data: { inserted, updated, total } });
  }
}
