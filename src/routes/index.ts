import { Router } from 'express';
import { CoursesController } from '../controllers/coursesController';
import { StudentProgressController } from '../controllers/studentProgressController';
import { StudentActivitiesController } from '../controllers/studentActivitiesController';
import { StudentFinalGradeController } from '../controllers/studentFinalGradeController';
import { asyncHandler } from '../middleware/errorHandler';
import inscripcionesRouter from './inscripciones';
import participantesRouter from './participantes';
import participantsGradesRouter from './participantsGrades';
import senceRouter from './sence';
import empresasRouter from './empresas';
import ejecutivosRouter from './ejecutivos';
import modalidadesRouter from './modalidades';
import usersRouter from './users';

const router = Router();
const coursesController = new CoursesController();
const studentProgressController = new StudentProgressController();
const studentActivitiesController = new StudentActivitiesController();
const studentFinalGradeController = new StudentFinalGradeController();

// Health check endpoint
router.get('/health', asyncHandler(coursesController.healthCheck));

// Student progress endpoint
router.get('/student-progress', asyncHandler(studentProgressController.getStudentProgress.bind(studentProgressController)));

// Student activities grades endpoint (temporary)
router.get('/grades/activities', asyncHandler(studentActivitiesController.getActivitiesGrades.bind(studentActivitiesController)));

// Student final grade endpoint (temporary)
router.get('/grades/final', asyncHandler(studentFinalGradeController.getFinalGrade.bind(studentFinalGradeController)));
router.post('/grades/final', asyncHandler(studentFinalGradeController.getFinalGradesBatch.bind(studentFinalGradeController)));

// Inscripciones endpoints
router.use('/inscripciones', inscripcionesRouter);
// Participantes endpoints
router.use('/participantes', participantesRouter);
router.use('/participantes', participantsGradesRouter);
// Sence configuration endpoints
router.use('/sence', senceRouter);
// Empresas configuration endpoints
router.use('/empresas', empresasRouter);
// Ejecutivos configuration endpoints
router.use('/ejecutivos', ejecutivosRouter);
// Modalidades configuration endpoints
router.use('/modalidades', modalidadesRouter);
// Users endpoints
router.use('/users', usersRouter);

// Category endpoints
router.get('/categorias', asyncHandler(coursesController.getCategories));
router.get('/categorias/raiz', asyncHandler(coursesController.getRootCategories));

// Courses endpoints
router.get('/cursos/categoria/:id', asyncHandler(coursesController.getCoursesByCategory));
router.get('/cursos/categoria/:id/simplificado', asyncHandler(coursesController.getSimplifiedCoursesByCategory));
router.get('/cursos/field/:field/:value', asyncHandler(coursesController.getCoursesByField));

// API info endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Moodle API Proxy Server',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      studentProgress: 'GET /api/student-progress?username=USERNAME&courseId=COURSE_ID',
      activitiesGrades: 'GET /api/grades/activities?username=USERNAME&courseId=COURSE_ID',
      finalGrade: 'GET /api/grades/final?username=USERNAME&courseId=COURSE_ID',
      finalGradeBatch: 'POST /api/grades/final - Body: [{"IdCurso":"ID","RutAlumno":"USER"},...]',
      inscripciones: 'CRUD /api/inscripciones',
      importInscripciones: 'POST /api/inscripciones/import',
      participantes: 'GET /api/participantes?numeroInscripcion=INS-0001',
      importParticipantes: 'POST /api/participantes/import',
      importParticipantesMoodle: 'POST /api/participantes/import/moodle',
      importParticipantesBulk: 'POST /api/participantes/import/bulk',
      sence: 'CRUD /api/sence',
      empresas: 'CRUD /api/empresas',
      ejecutivos: 'CRUD /api/ejecutivos',
      modalidades: 'CRUD /api/modalidades',
      categories: 'GET /api/categorias',
      rootCategories: 'GET /api/categorias/raiz',
      coursesByCategory: 'GET /api/cursos/categoria/:id',
      simplifiedCoursesByCategory: 'GET /api/cursos/categoria/:id/simplificado',
      coursesByField: 'GET /api/cursos/field/:field/:value'
    }
  });
});

export default router;
