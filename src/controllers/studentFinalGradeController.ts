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
  hidden?: boolean;
}

// Actividad de tipo cuestionario detectada directamente en la estructura del
// curso (core_course_get_contents). Se usa como respaldo cuando el ítem no
// aparece en el libro de notas (por ejemplo, si está oculto en el gradebook).
interface CourseQuizModule {
  cmid: number;
  instance: number;
  name: string;
}

export class StudentFinalGradeController {
  private moodleService: MoodleService;
  private courseLastAccessCache: Map<number, { expiresAt: number; byUserId: Map<number, string> }>;
  private diagnosticQuizCache: Map<number, { expiresAt: number; quiz: CourseQuizModule | null }>;

  constructor() {
    this.moodleService = new MoodleService();
    this.courseLastAccessCache = new Map();
    this.diagnosticQuizCache = new Map();
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
    const items = this.mapGradesToSimpleItems(gradesResult.data, userId);

    // 4) Buscar la "Evaluación/Prueba Diagnóstica" en cualquier parte del curso
    //    (tolerante a acentos/mayúsculas/plurales y sin importar la posición de
    //    la actividad dentro del curso).
    //
    //    IMPORTANTE: esto se calcula ANTES de exigir la "Evaluación Final". Antes
    //    el método salía con `return null` cuando el curso no tenía Evaluación
    //    Final y, con ello, se perdía también la nota diagnóstica.
    const diagnosticaMatch = this.findDiagnosticaActivity(items);

    const diagnosticaGradeVal: number | null = typeof diagnosticaMatch?.graderaw === 'number'
      ? diagnosticaMatch.graderaw
      : (diagnosticaMatch?.graderaw != null ? Number(diagnosticaMatch.graderaw) : null);

    // Cadena vacía = "no rindió la evaluación" (el reporte lo muestra como "-").
    // Un "0.0" real significa que la rindió y obtuvo cero. Antes ambos casos se
    // guardaban como 0 y eran indistinguibles.
    let notaDiagnostica = diagnosticaMatch && diagnosticaGradeVal != null
      ? diagnosticaGradeVal.toFixed(1)
      : '';

    // 4b) Respaldo: si la actividad diagnóstica no aparece en el libro de notas
    //     (ítem oculto en el gradebook, sin permiso `moodle/grade:viewhidden`,
    //     nombre de ítem distinto al de la actividad, etc.) se busca el
    //     cuestionario directamente en la estructura del curso y se consulta la
    //     mejor nota del alumno vía mod_quiz. Es best-effort: si el WS no está
    //     habilitado simplemente se mantiene el valor vacío.
    let diagnosticaEncontrada = Boolean(diagnosticaMatch);
    if (!diagnosticaMatch) {
      const fallbackGrade = await this.findDiagnosticaGradeFallback(courseIdNum, userId);
      if (fallbackGrade !== undefined) {
        diagnosticaEncontrada = true;
        notaDiagnostica = fallbackGrade != null ? fallbackGrade.toFixed(1) : '';
      }
    }

    // 5) Find itemtype="mod" and itemname that includes "Evaluación Final" (ignore accents/case)
    const targetPhrase = this.normalize('Evaluación Final');
    const match = items.find(it => {
      if (!it) return false;
      const typeOk = (it.itemtype || '').toLowerCase() === 'mod';
      const nameOk = it.itemname ? this.normalize(it.itemname).includes(targetPhrase) : false;
      return typeOk && nameOk;
    });

    // Sin Evaluación Final sólo devolvemos null cuando tampoco existe una
    // actividad diagnóstica; así los cursos que sólo tienen diagnóstica siguen
    // apareciendo en el reporte (aunque el alumno todavía no la haya rendido).
    if (!match && !diagnosticaEncontrada) {
      return null;
    }

    // Normalize graderaw to a number when possible
    const gradeVal: number | null = match
      ? (typeof match.graderaw === 'number'
        ? match.graderaw
        : (match.graderaw != null ? Number(match.graderaw) : null))
      : null;

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
      // Cadena vacía = "no rindió la Evaluación Final" (el reporte lo muestra
      // como "-"); "0.0" = la rindió y obtuvo cero.
      //
      // Esto NO altera el envío a VMICA: `buildVimicaPayload` convierte el
      // valor nulo/vacío en '' y `normalizeVimicaPayload` lo reemplaza por el
      // default '0', igual que antes. El cálculo de EstadoCurso también usa un
      // toNum que trata null/'' como 0.
      NotaFinal: gradeVal != null ? gradeVal.toFixed(1) : "",
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

  private mapGradesToSimpleItems(rawData: any, userId?: number): SimpleGradeItem[] {
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
            hidden: gi.hidden === true || gi.hidden === 1,
          });
        }
      }
      return items;
    }

    // Shape B: core_grades_get_grades
    //
    // Esta función devuelve `{ items: [ { id, itemname|name, itemtype,
    // itemmodule, iteminstance, activityid, grades: [ { userid, grade } ] } ] }`:
    // las notas van ANIDADAS dentro de cada item, no en un `rawData.grades`
    // de primer nivel. El mapeo anterior sólo contemplaba la forma de primer
    // nivel y, cuando se usaba este fallback, todos los ítems quedaban con
    // graderaw = null (notas en blanco / 0 en el reporte).
    if (rawData && Array.isArray(rawData.items)) {
      const pickUserGrade = (gradeList: any): number | null => {
        if (!gradeList) return null;
        const arr = Array.isArray(gradeList) ? gradeList : [gradeList];
        const forUser = userId != null
          ? arr.find((g: any) => Number(g?.userid) === Number(userId))
          : undefined;
        const chosen = forUser || arr[0];
        if (!chosen) return null;
        const raw = chosen.grade !== undefined ? chosen.grade : chosen.graderaw;
        if (raw === null || raw === undefined || raw === '') return null;
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      };

      // Notas en primer nivel (formato alternativo): { grades: { <itemid>: [...] } }
      const topLevelGrades = rawData.grades && !Array.isArray(rawData.grades) ? rawData.grades : null;

      for (const it of rawData.items) {
        const instanceNum = it.iteminstance != null
          ? Number(it.iteminstance)
          : (it.activityid != null ? Number(it.activityid) : NaN);

        const gradeFromItem = pickUserGrade(it.grades);
        const gradeFromTop = topLevelGrades && it.id != null ? pickUserGrade(topLevelGrades[String(it.id)]) : null;

        items.push({
          // core_grades_get_grades no siempre informa itemtype; si el ítem
          // pertenece a una actividad lo tratamos como "mod".
          itemtype: it.itemtype || (it.itemmodule || it.activityid ? 'mod' : undefined),
          itemname: it.itemname || it.name,
          itemmodule: it.itemmodule,
          iteminstance: Number.isFinite(instanceNum) ? instanceNum : null,
          graderaw: gradeFromItem != null ? gradeFromItem : gradeFromTop,
          hidden: it.hidden === true || it.hidden === 1,
        });
      }
      return items;
    }

    return items; // empty
  }

  // Palabras que indican que la actividad es una evaluación (cualquier variante).
  private isEvaluationWord(word: string): boolean {
    return (
      word.startsWith('evaluacion') ||   // evaluacion, evaluaciones
      word.startsWith('evaluativ') ||    // evaluativa, evaluativo
      word.startsWith('prueba') ||       // prueba, pruebas
      word.startsWith('examen') ||       // examen
      word.startsWith('examenes') ||
      word.startsWith('test') ||         // test, tests
      word.startsWith('cuestionario') || // cuestionario, cuestionarios
      word.startsWith('quiz')            // quiz, quizes
    );
  }

  // "diagnostic" cubre diagnóstico/diagnóstica/diagnósticos/diagnósticas y
  // compuestos como autodiagnóstico. normalize() ya quitó acentos y mayúsculas.
  private isDiagnosticWord(word: string): boolean {
    return word.includes('diagnostic');
  }

  private isDiagnosticActivityName(name?: string): boolean {
    if (!name) return false;
    // Antes se exigía la coincidencia EXACTA de dos palabras
    // ("evaluacion"|"prueba" + "diagnostica"|"diagnostico"), lo que dejaba
    // fuera nombres reales como "Evaluaciones Diagnósticas", "Autodiagnóstico
    // inicial" o "Diagnóstico de entrada". La palabra "diagnóstic*" ya es
    // suficientemente discriminante dentro de un curso, así que basta con ella.
    const words = this.normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
    return words.some((w) => this.isDiagnosticWord(w));
  }

  // Puntaje para elegir el mejor candidato cuando hay más de una actividad con
  // "diagnóstic*" en el nombre: se prefiere un cuestionario y un nombre que
  // además contenga una palabra de evaluación.
  private scoreDiagnosticCandidate(item: SimpleGradeItem): number {
    const words = this.normalize(item.itemname || '').split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    if (words.some((w) => this.isEvaluationWord(w))) score += 2;
    if ((item.itemmodule || '').toLowerCase() === 'quiz') score += 1;
    if (item.graderaw != null) score += 1;
    return score;
  }

  private findDiagnosticaActivity(items: SimpleGradeItem[]): SimpleGradeItem | undefined {
    if (!items.length) return undefined;

    // Se buscan primero los ítems de actividad ("mod"); si el WS devolviera el
    // itemtype vacío o con otro valor, se reintenta sobre la lista completa
    // para no perder la actividad.
    const modItems = items.filter((it) => (it.itemtype || '').toLowerCase() === 'mod');
    const pools = modItems.length ? [modItems, items] : [items];

    for (const pool of pools) {
      const candidates = pool.filter((it) => this.isDiagnosticActivityName(it.itemname));
      if (!candidates.length) continue;
      // Orden estable: mayor puntaje primero, respetando el orden original ante empates.
      return candidates
        .map((item, index) => ({ item, index, score: this.scoreDiagnosticCandidate(item) }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0].item;
    }

    return undefined;
  }

  /**
   * Respaldo cuando la actividad diagnóstica no está en el libro de notas.
   *
   * Devuelve:
   *   - number  -> nota obtenida por el alumno
   *   - null    -> la actividad existe pero el alumno no tiene nota
   *   - undefined -> no se pudo determinar (no hay actividad diagnóstica o el
   *                  WS no está disponible); el llamador deja el valor vacío.
   */
  private async findDiagnosticaGradeFallback(courseIdNum: number, userId: number): Promise<number | null | undefined> {
    const quiz = await this.getDiagnosticQuizModule(courseIdNum);
    if (!quiz) return undefined;

    try {
      const best = await this.moodleService.getQuizUserBestGrade(quiz.instance, userId);
      if (!best.success) return null;
      const data: any = best.data;
      if (data && data.hasgrade === true) {
        const grade = typeof data.grade === 'number' ? data.grade : Number(data.grade);
        return Number.isFinite(grade) ? grade : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getDiagnosticQuizModule(courseIdNum: number): Promise<CourseQuizModule | null> {
    const cacheTtlMs = 5 * 60 * 1000;
    const now = Date.now();
    const cached = this.diagnosticQuizCache.get(courseIdNum);
    if (cached && cached.expiresAt > now) return cached.quiz;

    // 1º intento: listado de cuestionarios del curso (mod_quiz_get_quizzes_by_courses).
    //    Se prueba antes que core_course_get_contents porque en algunas
    //    instalaciones el token tiene habilitado el WS de quiz pero no el de
    //    contenidos del curso (que responde `accessexception`).
    let quiz: CourseQuizModule | null = await this.findDiagnosticQuizViaQuizWs(courseIdNum);

    // 2º intento: estructura completa del curso.
    if (!quiz) {
      try {
        const contents = await this.moodleService.getCourseGradeItems(courseIdNum);
        if (contents.success && Array.isArray(contents.data)) {
          const candidates: CourseQuizModule[] = [];
          for (const section of contents.data as any[]) {
            const modules = Array.isArray(section?.modules) ? section.modules : [];
            for (const m of modules) {
              const modname = String(m?.modname || '').toLowerCase();
              if (modname !== 'quiz') continue;
              const name = String(m?.name || '');
              if (!this.isDiagnosticActivityName(name)) continue;
              const instance = Number(m?.instance);
              if (!Number.isFinite(instance)) continue;
              candidates.push({ cmid: Number(m?.id) || 0, instance, name });
            }
          }
          quiz = candidates[0] || null;
        }
      } catch {
        quiz = null;
      }
    }

    this.diagnosticQuizCache.set(courseIdNum, { expiresAt: now + cacheTtlMs, quiz });
    return quiz;
  }

  private async findDiagnosticQuizViaQuizWs(courseIdNum: number): Promise<CourseQuizModule | null> {
    try {
      const result = await this.moodleService.getCourseQuizzes(courseIdNum);
      if (!result.success) return null;
      const quizzes = Array.isArray((result.data as any)?.quizzes) ? (result.data as any).quizzes : [];
      for (const q of quizzes) {
        const name = String(q?.name || '');
        if (!this.isDiagnosticActivityName(name)) continue;
        const instance = Number(q?.id); // en mod_quiz, `id` ES el quizid (instance)
        if (!Number.isFinite(instance)) continue;
        return { cmid: Number(q?.coursemodule) || 0, instance, name };
      }
      return null;
    } catch {
      return null;
    }
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
