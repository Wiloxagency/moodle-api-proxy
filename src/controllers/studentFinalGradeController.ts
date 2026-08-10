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
  Email?: string;
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

// Índice de los usuarios matriculados en un curso, construido con una sola
// llamada a core_enrol_get_enrolled_users y reutilizado para dos cosas:
//   1. resolver el usuario de Moodle de cada participante, y
//   2. obtener su último acceso.
//
// Resolver contra los matriculados (y no contra todo el sitio) evita además
// emparejar por error con un usuario homónimo que no está en el curso.
interface CourseUserIndex {
  lastAccessByUserId: Map<number, string>;
  byUsername: Map<string, any>;
  byEmail: Map<string, any>;
  byIdnumber: Map<string, any>;
  // Correos que aparecen en más de un matriculado (correos genéricos de
  // empresa). No sirven para identificar a nadie: se descartan al resolver.
  ambiguousEmails: Set<string>;
  users: any[];
}

export class StudentFinalGradeController {
  private moodleService: MoodleService;
  private courseUsersCache: Map<number, { expiresAt: number; index: CourseUserIndex }>;
  private diagnosticQuizCache: Map<number, { expiresAt: number; quiz: CourseQuizModule | null }>;

  constructor() {
    this.moodleService = new MoodleService();
    this.courseUsersCache = new Map();
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
          const progress = await this.processSingleGrade(item.RutAlumno, item.IdCurso, item.correlative, item.Email || item.email);
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

  // GET /api/grades/final?username=...&courseId=...[&email=...]
  //
  // `email` es opcional pero recomendable: permite resolver al alumno cuando la
  // matriculación en Moodle no usa el RUT como username.
  async getFinalGrade(req: Request, res: Response) {
    const { username, courseId, email } = req.query as { username?: string; courseId?: string; email?: string };

    try {
      if ((!username && !email) || !courseId) {
        res.status(400).json({ success: false, error: { message: 'courseId is required, plus username and/or email', code: 'MISSING_PARAMETERS' } });
        return;
      }

      const progress = await this.processSingleGrade(username || '', courseId, undefined, email);
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
  private async processSingleGrade(username: string, courseId: string, correlative?: string, email?: string): Promise<ProgressData | null> {
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return null;
    }

    // 1) Resolver el usuario de Moodle.
    //
    // Primero se busca entre los MATRICULADOS del curso, por correo y por
    // username. Muchas matriculaciones no usan el RUT como username (alumnos
    // extranjeros o sin RUT se dan de alta con el correo), y antes esos
    // participantes no se resolvían nunca: el reporte los mostraba en blanco
    // aunque tuvieran notas en Moodle. Buscar dentro del curso evita además
    // emparejar con un homónimo que no está matriculado.
    let user: any = await this.resolveEnrolledUser(courseIdNum, username, email);

    // 2) Si no está en el índice del curso, se recurre a la búsqueda global.
    if (!user) {
      user = await this.resolveUserGlobally(username, email);
    }

    if (!user || user.id == null) {
      return null;
    }

    const userId = Number(user.id);

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

  /**
   * Índice de los matriculados del curso. Una sola llamada a Moodle sirve para
   * resolver usuarios y para los últimos accesos, y se cachea 5 minutos por
   * curso (importante en cursos de cientos de alumnos).
   */
  private async getCourseUserIndex(courseId: number): Promise<CourseUserIndex> {
    const now = Date.now();
    const cached = this.courseUsersCache.get(courseId);
    if (cached && cached.expiresAt > now) return cached.index;

    const index: CourseUserIndex = {
      lastAccessByUserId: new Map<number, string>(),
      byUsername: new Map<string, any>(),
      byEmail: new Map<string, any>(),
      byIdnumber: new Map<string, any>(),
      ambiguousEmails: new Set<string>(),
      users: [],
    };

    try {
      const enrolledUsers = await this.moodleService.getEnrolledUsers(courseId);
      if (enrolledUsers.success && Array.isArray(enrolledUsers.data)) {
        for (const user of enrolledUsers.data) {
          const userId = Number((user as any).id);
          if (!Number.isFinite(userId)) continue;

          index.users.push(user);

          const lastAccessNum = Number((user as any).lastaccess);
          index.lastAccessByUserId.set(
            userId,
            Number.isFinite(lastAccessNum) && lastAccessNum > 0
              ? new Date(lastAccessNum * 1000).toISOString()
              : ''
          );

          const username = this.normalizeKey((user as any).username);
          if (username && !index.byUsername.has(username)) index.byUsername.set(username, user);

          const mail = this.normalizeKey((user as any).email);
          if (mail) {
            // Un correo repetido entre matriculados (correo genérico de la
            // empresa) no identifica a nadie: se marca como ambiguo.
            if (index.byEmail.has(mail)) index.ambiguousEmails.add(mail);
            else index.byEmail.set(mail, user);
          }

          const idnumber = this.normalizeKey((user as any).idnumber);
          if (idnumber && !index.byIdnumber.has(idnumber)) index.byIdnumber.set(idnumber, user);
        }
      }
    } catch (error) {
      console.error('Error building course user index:', error);
    }

    // Sólo se cachea un índice con contenido: si la llamada falló (timeout,
    // permisos), conviene reintentar en la siguiente petición en vez de
    // arrastrar un índice vacío durante 5 minutos.
    if (index.users.length) {
      this.courseUsersCache.set(courseId, { expiresAt: now + 5 * 60 * 1000, index });
    }

    return index;
  }

  private async getCourseLastAccessMap(courseId: number): Promise<Map<number, string>> {
    const index = await this.getCourseUserIndex(courseId);
    return index.lastAccessByUserId;
  }

  private normalizeKey(value: any): string {
    return String(value ?? '').trim().toLowerCase();
  }

  /**
   * Busca al participante entre los matriculados del curso.
   *
   * El correo es OPCIONAL y nunca tiene prioridad sobre el username: hay
   * empresas cuyos alumnos comparten un correo genérico en Moodle, y ese correo
   * no identifica a nadie. Por eso el orden va de la clave más estricta a la
   * más laxa, y los correos repetidos dentro del curso se descartan:
   *
   *   1. RUT    -> username exacto      (la clave que ya se usaba)
   *   2. RUT    -> idnumber exacto
   *   3. correo -> email, sólo si es único entre los matriculados
   *   4. correo -> username, sólo si es único    (matrícula dada de alta por correo)
   *   5. RUT sin puntos/guion o sin dígito verificador -> username / idnumber
   *   6. username que empieza por el RUT  ("12345678" vs "12345678-9")
   */
  private async resolveEnrolledUser(courseId: number, username: string, email?: string): Promise<any | undefined> {
    const index = await this.getCourseUserIndex(courseId);
    if (!index.users.length) return undefined;

    const userKey = this.normalizeKey(username);
    const mailKey = this.normalizeKey(email);

    // 1 y 2 — el username (RUT) es la clave primaria del sistema.
    if (userKey) {
      const exact = index.byUsername.get(userKey) || index.byIdnumber.get(userKey);
      if (exact) return exact;
    }

    // 3 y 4 — el correo sólo cuenta si no está repetido en el curso.
    if (mailKey && !index.ambiguousEmails.has(mailKey)) {
      const byMail = index.byEmail.get(mailKey) || index.byUsername.get(mailKey);
      if (byMail) return byMail;
    }

    if (!userKey) return undefined;

    // 5 — variantes del RUT: sin puntos/guion y sin dígito verificador.
    const compact = userKey.replace(/[.\-\s]/g, '');
    const withoutDv = compact.replace(/[0-9k]$/, '');
    const variants = [compact, withoutDv].filter((v) => v.length >= 5);

    for (const variant of variants) {
      const hit = index.byUsername.get(variant) || index.byIdnumber.get(variant);
      if (hit) return hit;
    }

    // 6 — coincidencia por prefijo. Sólo se acepta si es inequívoca: si el
    // prefijo encaja con más de un matriculado no se elige ninguno.
    for (const variant of [userKey, ...variants]) {
      if (variant.length < 5) continue;
      const prefixHits = index.users.filter((u: any) => {
        const uname = this.normalizeKey(u.username).replace(/[.\-\s]/g, '');
        return uname !== '' && uname.startsWith(variant);
      });
      if (prefixHits.length === 1) return prefixHits[0];
    }

    return undefined;
  }

  /**
   * Búsqueda en todo el sitio, para cuando el participante no aparece entre los
   * matriculados (índice no disponible, matrícula por grupo, etc.).
   */
  private async resolveUserGlobally(username: string, email?: string): Promise<any | undefined> {
    const pickBest = (users: any[]): any | undefined => {
      if (!users.length) return undefined;
      const exact = users.find((u: any) => this.normalizeKey(u.username) === this.normalizeKey(username));
      const startsWith = users.find(
        (u: any) => typeof u.username === 'string' && this.normalizeKey(u.username).startsWith(this.normalizeKey(username))
      );
      return exact || startsWith || users[0];
    };

    // El username (RUT) sigue siendo la clave primaria; el correo es el respaldo.
    if (username && String(username).trim()) {
      const lookup = await this.moodleService.getUserByUsername(username);
      const users = this.unwrapUsers(lookup.data);
      if (lookup.success && users.length) return pickBest(users);
    }

    // Correo: sólo se acepta si devuelve UN único usuario. Los correos
    // genéricos compartidos por varios alumnos no identifican a nadie.
    if (email && String(email).trim()) {
      const byEmail = await this.moodleService.getUsersByField('email', String(email).trim());
      const users = this.unwrapUsers(byEmail.data);
      if (byEmail.success && users.length === 1) return users[0];
    }

    if (username && String(username).trim()) {
      const lookup = await this.moodleService.searchUsersByPartialUsername(username);
      const users = this.unwrapUsers(lookup.data);
      if (lookup.success && users.length) return pickBest(users);
    }

    // Último recurso: mirar la ficha local del participante por si aporta un
    // username o un correo distintos a los recibidos.
    const participant = await this.findParticipantByPartialUsername(username);
    if (participant) {
      const altMail = String((participant as any).mail || '').trim();
      if (altMail && this.normalizeKey(altMail) !== this.normalizeKey(email)) {
        const byAltMail = await this.moodleService.getUsersByField('email', altMail);
        const users = this.unwrapUsers(byAltMail.data);
        if (byAltMail.success && users.length === 1) return users[0];
      }

      const altUsername = String(participant.rut || participant.numeroInscripcion || '').trim();
      if (altUsername && altUsername !== username) {
        let lookup = await this.moodleService.getUserByUsername(altUsername);
        let users = this.unwrapUsers(lookup.data);
        if (!lookup.success || users.length === 0) {
          lookup = await this.moodleService.searchUsersByPartialUsername(altUsername);
          users = this.unwrapUsers(lookup.data);
        }
        if (lookup.success && users.length) return pickBest(users);
      }
    }

    return undefined;
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
