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
      Apellidos: (p as any).apellidos || ''
    }));

    const passed: any[] = [];
    const failed: any[] = [];

    const now = new Date();
    const termino = (ins as any).termino ? new Date((ins as any).termino) : null;
    const courseEnded = termino != null && termino.getTime() <= now.getTime();

    for (const it of items) {
      try {
        // @ts-ignore - access private via bracket for reuse
        const progress = await (this.finalCtrl as any).processSingleGrade(it.RutAlumno, it.IdCurso, it.correlative);
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
  // Devuelve y persiste registros normalizados (valores numéricos) por participante
  async getNumericReport(req: Request, res: Response) {
    const { numeroInscripcion } = req.params as { numeroInscripcion?: string };
    if (!numeroInscripcion) {
      return res.status(400).json({ success: false, error: { message: 'numeroInscripcion is required' } });
    }

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
    const participantes = await partCol.find(byNumero).toArray();

    const cacheCol = await getGradesReportsCollection();
    const normalizedNumero = Number.isFinite(numeroInscripcionNum) ? numeroInscripcionNum : Number(numeroInscripcion) || numeroInscripcion;

    const toNum = (v: any): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    const output: Array<{ numeroInscripcion: number; IdCurso: string; RutAlumno: string; PorcentajeAvance: number | null; PorcentajeAsistenciaAlumno: number | null; NotaFinal: number | null }> = [];

    for (const p of participantes) {
      const rut = (p as any).rut || '';
      let avance: number | null = null;
      let asistencia: number | null = null;
      let notaFinal: number | null = null;
      try {
        // @ts-ignore - reuse internal method
        const progress = await (this.finalCtrl as any).processSingleGrade(rut, courseId, rut);
        if (progress) {
          avance = toNum((progress as any).PorcentajeAvance);
          asistencia = toNum((progress as any).PorcentajeAsistenciaAlumno);
          notaFinal = toNum((progress as any).NotaFinal);
        }
      } catch {}

      const doc = {
        numeroInscripcion: typeof normalizedNumero === 'number' ? normalizedNumero : Number(normalizedNumero) || 0,
        IdCurso: courseId,
        RutAlumno: rut,
        PorcentajeAvance: avance,
        PorcentajeAsistenciaAlumno: asistencia,
        NotaFinal: notaFinal,
      };

      // Persistir por participante (upsert)
      await cacheCol.updateOne(
        { numeroInscripcion: doc.numeroInscripcion, RutAlumno: doc.RutAlumno } as any,
        { $set: doc } as any,
        { upsert: true }
      );
      output.push(doc);
    }

    return res.json({ success: true, data: output });
  }

}
