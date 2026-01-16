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

    const cacheCol = await getGradesReportsCollection();
    // If not reloading, return cached version if present
    if (!reload) {
      const cached = await cacheCol.findOne({ numeroInscripcion } as any);
      if (cached) {
        return res.json({ success: true, data: cached.data, updatedAt: cached.updatedAt });
      }
    }

    const insCol = await getInscripcionesCollection();
    const ins = await insCol.findOne({ numeroInscripcion } as any);
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
    const participantes = await partCol.find({ numeroInscripcion }).toArray();
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

    for (const it of items) {
      try {
        // @ts-ignore - access private via bracket for reuse
        const progress = await (this.finalCtrl as any).processSingleGrade(it.RutAlumno, it.IdCurso, it.correlative);
        if (progress) {
          // @ts-ignore - access private via bracket for reuse
          if (!(this.finalCtrl as any).shouldIgnoreProgress(progress)) {
            passed.push({ ...progress, Nombres: (it as any).Nombres || '', Apellidos: (it as any).Apellidos || '' });
          }
        } else {
          failed.push(it);
        }
      } catch (e) {
        failed.push(it);
      }
    }

    const payload = { passed, failed };
    const updatedAt = new Date();
    await cacheCol.updateOne(
      { numeroInscripcion } as any,
      { $set: { numeroInscripcion, data: payload, updatedAt } },
      { upsert: true }
    );
    return res.json({ success: true, data: payload, updatedAt });
  }
}
