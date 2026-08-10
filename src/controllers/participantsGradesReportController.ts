import { Request, Response } from 'express';
import { getInscripcionesCollection, getParticipantesCollection, getGradesReportsCollection } from '../db/mongo';
import { StudentFinalGradeController } from './studentFinalGradeController';

export class ParticipantsGradesReportController {
  private finalCtrl: StudentFinalGradeController;
  constructor() {
    this.finalCtrl = new StudentFinalGradeController();
  }

  // GET /api/participantes/:numeroInscripcion/grades
  async getReport(req: Request, res: Response) {
    const { numeroInscripcion } = req.params as { numeroInscripcion?: string };
    const { reload } = req.query as { reload?: string };
    if (!numeroInscripcion) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion is required' } });
    }

    const numeroInscripcionNum = Number(numeroInscripcion);
    const byNumero = Number.isFinite(numeroInscripcionNum)
      ? ({ $or: [ { numeroInscripcion: numeroInscripcionNum }, { numeroInscripcion } ] } as any)
      : ({ numeroInscripcion } as any);

    const cacheCol = await getGradesReportsCollection();
    // If not reloading, return cached version if present
    if (!reload) {
      const cached = await cacheCol.findOne({ ...byNumero, scope: 'legacy' } as any);
      if (cached) {
        return res.json({ success: true, data: cached.data, updatedAt: cached.updatedAt });
      }
    }

    const insCol = await getInscripcionesCollection();
    const ins = await insCol.findOne(byNumero);
    if (!ins) {
      return res.status(404).json({ success: false, error: { message: 'Inscripción no encontrada' } });
    }

    const idMoodleRaw = (ins as any).idMoodle as string | undefined;
    const codigoCursoRaw = (ins as any).codigoCurso as string | undefined;
    const providedCode = (idMoodleRaw && idMoodleRaw.trim()) || (codigoCursoRaw && codigoCursoRaw.trim()) || '';
    const courseId = providedCode.replace(/[^0-9]/g, '');
    if (!courseId) {
      return res.status(400).json({ success: false, error: { message: 'La inscripción no tiene un IdCurso numérico para calcular notas' } });
    }

    const partCol = await getParticipantesCollection();
    const participantes = await partCol.find(byNumero).toArray();
    // Include participant names so the frontend can display Nombres/Apellidos in the report
    const items = participantes.map(p => ({
      IdCurso: courseId,
      RutAlumno: (p as any).rut || '',
      correlative: (p as any).rut || '',
      Nombres: (p as any).nombres || '',
      Apellidos: (p as any).apellidos || '',
      // El correo es necesario para resolver al alumno en Moodle cuando la
      // matriculación no usa el RUT como username (alumnos extranjeros).
      Email: (p as any).mail || ''
    }));

    const passed: any[] = [];
    const failed: any[] = [];

    const now = new Date();
    const termino = (ins as any).termino ? new Date((ins as any).termino) : null;
    const courseEnded = termino != null && termino.getTime() <= now.getTime();

    for (const it of items) {
      try {
        // @ts-ignore - access private via bracket for reuse
        const progress = await (this.finalCtrl as any).processSingleGrade(it.RutAlumno, it.IdCurso, it.correlative, (it as any).Email);
        if (progress && !(this.finalCtrl as any).shouldIgnoreProgress(progress)) {
          // Regla: antes de la fecha de término no mostrar "Reprobado" (EstadoCurso '2')
          const estado = (progress as any).EstadoCurso;
          const adjusted = { ...progress } as any;
          if (estado === '2' && !courseEnded) {
            adjusted.EstadoCurso = '';
          }
          passed.push({ ...adjusted, Nombres: (it as any).Nombres || '', Apellidos: (it as any).Apellidos || '' });
        } else {
          // Sin notas/avance: incluir igualmente
          passed.push({
            IdCurso: it.IdCurso,
            RutAlumno: it.RutAlumno,
            Nombres: (it as any).Nombres || '',
            Apellidos: (it as any).Apellidos || '',
            PorcentajeAvance: '',
            PorcentajeAsistenciaAlumno: '',
            NotaFinal: '',
            EstadoCurso: courseEnded ? '2' : ''
          } as any);
        }
      } catch (e) {
        // Error real al consultar Moodle: los contamos como fallidos (banner)
        failed.push(it);
      }
    }

    const payload = { passed, failed };
    const updatedAt = new Date();
    const numeroInscripcionNormalized = Number.isFinite(numeroInscripcionNum) ? numeroInscripcionNum : numeroInscripcion;
    await cacheCol.updateOne(
      { numeroInscripcion: numeroInscripcionNormalized, scope: 'legacy' } as any,
      { $set: { numeroInscripcion: numeroInscripcionNormalized, scope: 'legacy', data: payload, updatedAt } } as any,
      { upsert: true }
    );
    return res.json({ success: true, data: payload, updatedAt });
  }

  // GET /api/participantes/:numeroInscripcion/grades-numeric
  // Devuelve y persiste registros normalizados (valores numéricos) por participante.
  //
  // Soporta procesamiento por lotes para evitar timeouts (504) en cursos con
  // muchos alumnos. Parámetros de query opcionales:
  //   - offset: índice del primer participante a procesar (default 0)
  //   - limit:  cantidad máxima de participantes a procesar en esta llamada
  //             (default: todos). El frontend/cron debe iterar mientras hasMore=true.
  // Dentro del lote los participantes se procesan en paralelo con un límite de
  // concurrencia para acelerar sin saturar los WebServices de Moodle.
  async getNumericReport(req: Request, res: Response) {
    const { numeroInscripcion } = req.params as { numeroInscripcion?: string };
    if (!numeroInscripcion) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion is required' } });
    }

    // --- Parseo de paginación (offset/limit) ---
    const { offset: offsetRaw, limit: limitRaw } = req.query as { offset?: string; limit?: string };
    const offset = Math.max(0, Number.isFinite(Number(offsetRaw)) ? parseInt(String(offsetRaw), 10) || 0 : 0);
    const limitParsed = parseInt(String(limitRaw), 10);
    const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : null; // null = sin límite

    // Concurrencia máxima de llamadas a Moodle dentro del lote
    const CONCURRENCY = 6;

    const numeroInscripcionNum = Number(numeroInscripcion);
    const byNumero = Number.isFinite(numeroInscripcionNum)
      ? ({ $or: [ { numeroInscripcion: numeroInscripcionNum }, { numeroInscripcion } ] } as any)
      : ({ numeroInscripcion } as any);

    const insCol = await getInscripcionesCollection();
    const ins = await insCol.findOne(byNumero);
    if (!ins) {
      return res.status(404).json({ success: false, error: { message: 'Inscripción no encontrada' } });
    }

    const idMoodleRaw = (ins as any).idMoodle as string | undefined;
    const codigoCursoRaw = (ins as any).codigoCurso as string | undefined;
    const providedCode = (idMoodleRaw && idMoodleRaw.trim()) || (codigoCursoRaw && codigoCursoRaw.trim()) || '';
    const courseId = providedCode.replace(/[^0-9]/g, '');
    if (!courseId) {
      return res.status(400).json({ success: false, error: { message: 'La inscripción no tiene un IdCurso numérico para calcular notas' } });
    }

    const partCol = await getParticipantesCollection();
    // Orden estable para que offset/limit sean deterministas entre llamadas
    const allParticipantes = await partCol.find(byNumero).sort({ _id: 1 }).toArray();
    const total = allParticipantes.length;

    // Recorte del lote a procesar en esta llamada
    const end = limit == null ? total : Math.min(total, offset + limit);
    const participantes = allParticipantes.slice(offset, end);
    const hasMore = end < total;

    const cacheCol = await getGradesReportsCollection();
    const normalizedNumero = Number.isFinite(numeroInscripcionNum) ? numeroInscripcionNum : Number(numeroInscripcion) || numeroInscripcion;
    const normalizedNumeroValue = typeof normalizedNumero === 'number' ? normalizedNumero : Number(normalizedNumero) || 0;

    const toNum = (v: any): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    type NumericDoc = { numeroInscripcion: number; IdCurso: string; RutAlumno: string; PorcentajeAvance: number | null; PorcentajeAsistenciaAlumno: number | null; NotaFinal: number | null; NotaDiagnostica: number | null; UltimoAcceso: string | null };

    // Procesa un único participante: consulta Moodle y persiste el resultado
    const processParticipant = async (p: any): Promise<NumericDoc> => {
      const rut = (p as any).rut || '';
      // Necesario para resolver al alumno cuando la matriculación en Moodle no
      // usa el RUT como username (alumnos extranjeros dados de alta por correo).
      const mail = (p as any).mail || '';
      let avance: number | null = null;
      let asistencia: number | null = null;
      let notaFinal: number | null = null;
      let notaDiagnostica: number | null = null;
      let ultimoAcceso: string | null = null;
      try {
        // @ts-ignore - reuse internal method
        const progress = await (this.finalCtrl as any).processSingleGrade(rut, courseId, rut, mail);
        if (progress) {
          avance = toNum((progress as any).PorcentajeAvance);
          asistencia = toNum((progress as any).PorcentajeAsistenciaAlumno);
          notaFinal = toNum((progress as any).NotaFinal);
          notaDiagnostica = toNum((progress as any).NotaDiagnostica);
          const ultimoAccesoRaw = String((progress as any).UltimoAcceso || '').trim();
          ultimoAcceso = ultimoAccesoRaw || null;
        }
      } catch {}

      const doc: NumericDoc = {
        numeroInscripcion: normalizedNumeroValue,
        IdCurso: courseId,
        RutAlumno: rut,
        PorcentajeAvance: avance,
        PorcentajeAsistenciaAlumno: asistencia,
        NotaFinal: notaFinal,
        NotaDiagnostica: notaDiagnostica,
        UltimoAcceso: ultimoAcceso,
      };

      // Persistir por participante (upsert)
      await cacheCol.updateOne(
        { numeroInscripcion: doc.numeroInscripcion, RutAlumno: doc.RutAlumno } as any,
        { $set: doc } as any,
        { upsert: true }
      );
      return doc;
    };

    // Ejecuta processParticipant sobre el lote con concurrencia limitada,
    // preservando el orden de salida.
    const output: NumericDoc[] = new Array(participantes.length);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= participantes.length) break;
        output[i] = await processParticipant(participantes[i]);
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, participantes.length) }, () => worker());
    await Promise.all(workers);

    return res.json({
      success: true,
      data: output,
      total,
      offset,
      limit: limit == null ? total : limit,
      processed: participantes.length,
      hasMore,
    });
  }

}
