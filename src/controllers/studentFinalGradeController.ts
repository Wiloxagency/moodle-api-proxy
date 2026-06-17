import { Request, Response } from 'express';
import { MoodleService } from '../services/moodleService';
import { Participante } from '../types/participante';
import { getParticipantesCollection } from '../db/mongo';

interface ProgressData {
  IdCurso: string;
  RutAlumno: string;
  PorcentajeAvance: string;
  PorcentajeAsistenciaAlumno: string;
  NotaTeorica: string;
  EstadoTeorica: string;
  NotaPractica: string;
  EstadoPractica: string;
  NotaFinal: string;
  NotaDiagnostica?: string;
  UltimoAcceso?: string;
  EstadoCurso: string;
  Observacion: string;
}

interface BatchRequestItem {
  IdCurso: string;
  RutAlumno: string;
  correlative: string;
}

interface BatchResponseData {
  passed: ProgressData[];
  failed: BatchRequestItem[];
}

interface FinalGradeResponseData {
  found: boolean;
  progress?: ProgressData;
}

interface SimpleGradeItem {
  itemtype?: string;
  itemname?: string;
  itemmodule?: string;
  iteminstance?: number | null;
  graderaw?: number | null;
}

export class StudentFinalGradeController {
  private moodleService: MoodleService;
  private courseLastAccessCache: Map<number, { expiresAt: number; byUserId: Map<number, string> }>;

  constructor() {
    this.moodleService = new MoodleService();
    this.courseLastAccessCache = new Map();
  }

  // POST /api/grades/final - Batch processing
  async getFinalGradesBatch(req: Request, res: Response) {
    const requestData = req.body;

    try {
      if (!Array.isArray(requestData)) {
        res.status(400).json({ 
          success: false, 
          error: { 
            message: 'Request body must be an array of objects with IdCurso, RutAlumno, and correlative', 
            code: 'INVALID_REQUEST_FORMAT' 
          } 
        });
        return;
      }

      const passed: ProgressData[] = [];
      const failed: BatchRequestItem[] = [];

      // Process each item in the batch
      for (const item of requestData) {
        if (!item.IdCurso || !item.RutAlumno || !item.correlative) {
          failed.push({ IdCurso: item.IdCurso || '', RutAlumno: item.RutAlumno || '', correlative: item.correlative || '' });
          continue;
        }

        try {
          const progress = await this.processSingleGrade(item.RutAlumno, item.IdCurso, item.correlative);
          if (progress) {
            // Ignore entries with Avance=100, Asistencia=0, NotaFinal=0
            if (this.shouldIgnoreProgress(progress)) {
              continue; // skip adding to passed or failed
            }
            passed.push(progress);
          } else {
            failed.push({ IdCurso: item.IdCurso, RutAlumno: item.RutAlumno, correlative: item.correlative });
          }
        } catch (error) {
          console.error(`Error processing ${item.RutAlumno} in course ${item.IdCurso}:`, error);
          failed.push({ IdCurso: item.IdCurso, RutAlumno: item.RutAlumno, correlative: item.correlative });
        }
      }

      const response: BatchResponseData = { passed, failed };
      res.json(response);

    } catch (error) {
      console.error('Error in getFinalGradesBatch:', error);
      res.status(500).json({ 
        success: false, 
        error: { 
          message: 'Internal server error while processing batch grades', 
          code: 'INTERNAL_ERROR', 
          details: error instanceof Error ? error.message : error 
        } 
      });
    }
  }

  // GET /api/grades/final?username=...&courseId=... (keeping the original single endpoint)
  async getFinalGrade(req: Request, res: Response) {
    const { username, courseId } = req.query as { username?: string; courseId?: string };

    try {
      if (!username || !courseId) {
        res.status(400).json({ success: false, error: { message: 'Both username and courseId parameters are required', code: 'MISSING_PARAMETERS' } });
        return;
      }

      const progress = await this.processSingleGrade(username, courseId);
      if (progress) {
        const data: FinalGradeResponseData = {
          found: true,
          progress
        };
        res.json({ success: true, data });
      } else {
        const data: FinalGradeResponseData = { found: false };
        res.json({ success: true, data });
      }

    } catch (error) {
      console.error('Error in getFinalGrade:', error);
      res.status(500).json({ success: false, error: { message: 'Internal server error while retrieving final grade', code: 'INTERNAL_ERROR', details: error instanceof Error ? error.message : error } });
    }
  }

  // Process a single grade (extracted from the original logic)
  private async processSingleGrade(username: string, courseId: string, correlative?: string): Promise<ProgressData | null> {
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return null;
    }

    // 1) Resolve user via Moodle (exact then partial), fallback to local DB to enhance username
    let userLookup = await this.moodleService.getUserByUsername(username);
    let users = this.unwrapUsers(userLookup.data);
    if (!userLookup.success || users.length === 0) {
      userLookup = await this.moodleService.searchUsersByPartialUsername(username);
      users = this.unwrapUsers(userLookup.data);
    }

    if (!userLookup.success || users.length === 0) {
      const participant = await this.findParticipantByPartialUsername(username);
      if (participant) {
        const altUsername = String(participant.rut || participant.numeroInscripcion);
        userLookup = await this.moodleService.getUserByUsername(altUsername);
        users = this.unwrapUsers(userLookup.data);
        if (!userLookup.success || users.length === 0) {
          userLookup = await this.moodleService.searchUsersByPartialUsername(altUsername);
          users = this.unwrapUsers(userLookup.data);
        }
      }
    }

    if (!userLookup.success || users.length === 0) {
      return null;
    }

    // Choose best match
    let user = users[0];
    const exactMatch = users.find((u: any) => u.username === username);
    const startsWithMatch = users.find((u: any) => typeof u.username === 'string' && u.username.startsWith(username));
    user = exactMatch || startsWithMatch || user;

    const userId = user.id;

    // 2) Fetch grades for user & course
    const gradesResult = await this.moodleService.getUserGrades(courseIdNum, userId);
    if (!gradesResult.success) {
      return null;
    }

    // 3) Map grades into a common list we can search
    const items = this.mapGradesToSimpleItems(gradesResult.data);

    // 4) Find itemtype="mod" and itemname that includes "Evaluación Final" (ignore accents/case)
    const targetPhrase = this.normalize('Evaluación Final');
    const match = items.find(it => {
      if (!it) return false;
      const typeOk = (it.itemtype || '').toLowerCase() === 'mod';
      const nameOk = it.itemname ? this.normalize(it.itemname).includes(targetPhrase) : false;
      return typeOk && nameOk;
    });

    if (!match) {
      return null;
    }

    // 5) Find "Evaluación/Prueba Diagnóstica" anywhere in the course (accent/case tolerant,
    //    sin importar la posición de la actividad dentro del curso)
    const diagnosticaMatch = this.findDiagnosticaActivity(items);

    // Normalize graderaw to a number when possible
    const gradeVal: number | null = typeof match.graderaw === 'number'
      ? match.graderaw
      : (match.graderaw != null ? Number(match.graderaw) : null);

    const diagnosticaGradeVal: number | null = typeof diagnosticaMatch?.graderaw === 'number'
      ? diagnosticaMatch.graderaw
      : (diagnosticaMatch?.graderaw != null ? Number(diagnosticaMatch.graderaw) : null);
    const notaDiagnostica = diagnosticaMatch
      ? (diagnosticaGradeVal != null ? diagnosticaGradeVal.toFixed(1) : '0.0')
      : '';

    // Determine EstadoCurso: 0 if no grade or grade is 0, 1 if grade >= 5, 2 if grade < 5
    let approved: number;
    if (gradeVal == null || gradeVal === 0) {
      approved = 0; // Student has not started
    } else if (gradeVal >= 5) {
      approved = 1; // Student passed
    } else {
      approved = 2; // Student failed
    }

    // Calculate quiz progress
    let quizProgress = this.calculateQuizProgress(items);
    let attendanceQuiz = this.calculateAttendanceQuiz(items);

    // If approved = 1, set both quiz metrics to 100
    if (approved === 1) {
      quizProgress = 100;
      attendanceQuiz = 100;
    }

    const courseLastAccessMap = await this.getCourseLastAccessMap(courseIdNum);
    const ultimoAcceso = courseLastAccessMap.get(userId) || '';

    // Format the response according to the structure
    const progress: ProgressData = {
      IdCurso: correlative || courseId,  // Use correlative if provided, otherwise use courseId
      RutAlumno: username,
      PorcentajeAvance: quizProgress.toString(),
      PorcentajeAsistenciaAlumno: attendanceQuiz.toString(),
      NotaTeorica: "0",
      EstadoTeorica: "0",
      NotaPractica: "0",
      EstadoPractica: "0",
      NotaFinal: gradeVal != null ? gradeVal.toFixed(1) : "0.0",
      NotaDiagnostica: notaDiagnostica,
      UltimoAcceso: ultimoAcceso,
      EstadoCurso: approved.toString(),
      Observacion: "Curso iniciado sin observación"
    };

    return progress;
  }

  private async getCourseLastAccessMap(courseId: number): Promise<Map<number, string>> {
    const now = Date.now();
    const cached = this.courseLastAccessCache.get(courseId);
    if (cached && cached.expiresAt > now) return cached.byUserId;

    const byUserId = new Map<number, string>();
    try {
      const enrolledUsers = await this.moodleService.getEnrolledUsers(courseId);
      if (enrolledUsers.success && Array.isArray(enrolledUsers.data)) {
        for (const user of enrolledUsers.data) {
          const userId = Number((user as any).id);
          if (!Number.isFinite(userId)) continue;
          const lastAccessRaw = (user as any).lastaccess;
          const lastAccessNum = Number(lastAccessRaw);
          if (Number.isFinite(lastAccessNum) && lastAccessNum > 0) {
            byUserId.set(userId, new Date(lastAccessNum * 1000).toISOString());
          } else {
            byUserId.set(userId, '');
          }
        }
      }
    } catch (error) {
      console.error('Error getting course last access map:', error);
    }

    this.courseLastAccessCache.set(courseId, {
      expiresAt: now + 5 * 60 * 1000,
      byUserId,
    });

    return byUserId;
  }

  private shouldIgnoreProgress(progress: ProgressData): boolean {
    const avance = Number(progress.PorcentajeAvance);
    const asistencia = Number(progress.PorcentajeAsistenciaAlumno);
    const notaFinal = Number(progress.NotaFinal);
    // Ignore only when all three are exactly 0
    return avance === 0 && asistencia === 0 && notaFinal === 0;
  }

  // --- helpers ---
  private unwrapUsers(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any).users)) return (data as any).users;
    if (data && typeof data === 'object' && (data as any).users && typeof (data as any).users === 'object') {
      return Object.values((data as any).users);
    }
    return [];
  }

  private normalize(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip accents
      .toLowerCase()
      .trim();
  }

  private async findParticipantByPartialUsername(username: string): Promise<Participante | null> {
    try {
      const col = await getParticipantesCollection();
      let participant = await col.findOne({ $or: [ { rut: username }, { numeroInscripcion: username } ] });
      if (participant) return participant as Participante;

      const regexPattern = new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      participant = await col.findOne({ $or: [ { rut: { $regex: regexPattern } }, { numeroInscripcion: { $regex: regexPattern } } ] });
      if (participant) return participant as Participante;

      const containsPattern = new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      participant = await col.findOne({ $or: [ { rut: { $regex: containsPattern } }, { numeroInscripcion: { $regex: containsPattern } } ] });
      return participant as Participante | null;
    } catch (e) {
      console.error('Error finding participant by partial username:', e);
      return null;
    }
  }

  private mapGradesToSimpleItems(rawData: any): SimpleGradeItem[] {
    const items: SimpleGradeItem[] = [];

    // Shape A: gradereport_user_get_grade_items
    if (rawData && rawData.usergrades && Array.isArray(rawData.usergrades) && rawData.usergrades.length > 0) {
      const ug = rawData.usergrades[0];
      if (Array.isArray(ug.gradeitems)) {
        for (const gi of ug.gradeitems) {
          const gr = (typeof gi.graderaw === 'number') ? gi.graderaw : (gi.graderaw != null ? Number(gi.graderaw) : null);
          const instanceNum = gi.iteminstance != null ? Number(gi.iteminstance) : NaN;
          items.push({
            itemtype: gi.itemtype,
            itemname: gi.itemname,
            itemmodule: gi.itemmodule,
            iteminstance: Number.isFinite(instanceNum) ? instanceNum : null,
            graderaw: gr,
          });
        }
      }
      return items;
    }

    // Shape B: core_grades_get_grades (best-effort mapping)
    if (rawData && Array.isArray(rawData.items)) {
      const indexById: Record<number, any> = {};
      for (const it of rawData.items) {
        if (typeof it.id === 'number') indexById[it.id] = it;
      }
      if (rawData.grades) {
        for (const itemIdStr of Object.keys(rawData.grades)) {
          const itemId = Number(itemIdStr);
          const meta = indexById[itemId] || {};
          const userGrades = rawData.grades[itemIdStr];
          const ug = Array.isArray(userGrades) ? userGrades[0] : userGrades;
          const gradeNum: number | null = (ug && typeof ug.grade === 'number') ? ug.grade : (ug && ug.grade != null ? Number(ug.grade) : null);
          const instanceNum = meta.iteminstance != null ? Number(meta.iteminstance) : NaN;
          items.push({
            itemtype: meta.itemtype,
            itemname: meta.itemname,
            itemmodule: meta.itemmodule,
            iteminstance: Number.isFinite(instanceNum) ? instanceNum : null,
            graderaw: gradeNum,
          });
        }
      } else {
        // Sometimes items[].calculation or other forms exist; we can't infer grades reliably without grades mapping
        for (const it of rawData.items) {
          const instanceNum = it.iteminstance != null ? Number(it.iteminstance) : NaN;
          items.push({
            itemtype: it.itemtype,
            itemname: it.itemname,
            itemmodule: it.itemmodule,
            iteminstance: Number.isFinite(instanceNum) ? instanceNum : null,
            graderaw: null,
          });
        }
      }
      return items;
    }

    return items; // empty
  }

  private isDiagnosticActivityName(name?: string): boolean {
    if (!name) return false;
    // El criterio es que el nombre esté compuesto por la combinación de
    // una palabra de tipo ("Evaluación" | "Prueba") y una palabra de
    // diagnóstico ("Diagnóstica" | "Diagnóstico"), en cualquier orden,
    // sin importar mayúsculas/minúsculas ni acentos, y sin importar en qué
    // parte del curso esté ubicada la actividad.
    // normalize() ya pasa a minúsculas y elimina los acentos.
    const words = this.normalize(name).split(/[^a-z]+/).filter(Boolean);
    const hasTypeWord = words.some((w) => w === 'evaluacion' || w === 'prueba');
    const hasDiagnosticWord = words.some((w) => w === 'diagnostica' || w === 'diagnostico');
    return hasTypeWord && hasDiagnosticWord;
  }

  private findDiagnosticaActivity(items: SimpleGradeItem[]): SimpleGradeItem | undefined {
    const modItems = items.filter((it) => (it.itemtype || '').toLowerCase() === 'mod');
    if (!modItems.length) return undefined;

    // Devuelve la primera actividad de tipo módulo cuyo nombre cumpla el
    // criterio de evaluación diagnóstica, sin importar su posición dentro
    // del curso (ya no se exige que esté en el primer módulo).
    return modItems.find((it) => this.isDiagnosticActivityName(it.itemname));
  }

  private calculateQuizProgress(items: SimpleGradeItem[]): number {
    // Count items where itemmodule === "quiz"
    const quizItems = items.filter(item => {
      // Check if itemtype is "mod" and itemname contains quiz indicators
      const isModType = (item.itemtype || '').toLowerCase() === 'mod';
      const itemName = (item.itemname || '').toLowerCase();
      // Look for common quiz indicators in Spanish
      const isQuiz = itemName.includes('quiz') || 
                     itemName.includes('cuestionario') || 
                     itemName.includes('examen') || 
                     itemName.includes('evaluacion') ||
                     itemName.includes('evaluación') ||
                     itemName.includes('test');
      return isModType && isQuiz;
    });

    const totalQuiz = quizItems.length;
    if (totalQuiz === 0) return 0;

    // Count quizzes with grade >= 5
    const totalApprovedQuiz = quizItems.filter(item => {
      const grade = typeof item.graderaw === 'number' ? item.graderaw : 
                   (item.graderaw != null ? Number(item.graderaw) : null);
      return grade != null && grade >= 5;
    }).length;

    return Math.round((totalApprovedQuiz / totalQuiz) * 100);
  }

  private calculateAttendanceQuiz(items: SimpleGradeItem[]): number {
    // Count items where itemmodule === "quiz"
    const quizItems = items.filter(item => {
      // Check if itemtype is "mod" and itemname contains quiz indicators
      const isModType = (item.itemtype || '').toLowerCase() === 'mod';
      const itemName = (item.itemname || '').toLowerCase();
      // Look for common quiz indicators in Spanish
      const isQuiz = itemName.includes('quiz') || 
                     itemName.includes('cuestionario') || 
                     itemName.includes('examen') || 
                     itemName.includes('evaluacion') ||
                     itemName.includes('evaluación') ||
                     itemName.includes('test');
      return isModType && isQuiz;
    });

    const totalQuiz = quizItems.length;
    if (totalQuiz === 0) return 0;

    // Count quizzes with grade >= 0
    const totalAttendedQuiz = quizItems.filter(item => {
      const grade = typeof item.graderaw === 'number' ? item.graderaw : 
                   (item.graderaw != null ? Number(item.graderaw) : null);
      return grade != null && grade >= 0;
    }).length;

    return Math.round((totalAttendedQuiz / totalQuiz) * 100);
  }
}
