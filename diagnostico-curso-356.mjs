/**
 * Diagnóstico SOLO-LECTURA para el reporte de avances de un curso de Moodle.
 *
 * No escribe nada: solo hace .find() en Mongo y llamadas GET de lectura a los
 * WebServices de Moodle. Reproduce exactamente las condiciones que aplica
 * reportesController.getReporteAvances + el pipeline de notas
 * (studentFinalGradeController.processSingleGrade) para identificar por qué un
 * curso no muestra resultados en /reporte-avances.
 *
 * Uso (desde la carpeta moodle-api-proxy, donde están .env y node_modules):
 *   node diagnostico-curso-356.mjs            # usa 356 por defecto
 *   node diagnostico-curso-356.mjs 356        # o el idMoodle que quieras revisar
 */
import { MongoClient } from 'mongodb';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const TARGET = String(process.argv[2] || '356').trim();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
const COL = {
  ins: process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones',
  part: process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes',
  grades: process.env.MONGODB_GRADES_REPORTS_COLLECTION || 'grades_reports',
};
const MOODLE_URL = process.env.MOODLE_BASE_URL || '';
const MOODLE_TOKEN = process.env.MOODLE_WS_TOKEN || '';

const line = (s = '') => console.log(s);
const ok = (s) => console.log('  ✅ ' + s);
const bad = (s) => console.log('  ❌ ' + s);
const warn = (s) => console.log('  ⚠️  ' + s);

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

async function ws(wsfunction, params = {}) {
  const url = new URL('/webservice/rest/server.php', MOODLE_URL);
  url.searchParams.append('wstoken', MOODLE_TOKEN);
  url.searchParams.append('moodlewsrestformat', 'json');
  url.searchParams.append('wsfunction', wsfunction);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  const r = await axios.get(url.toString(), { timeout: 15000, headers: { Accept: 'application/json' } });
  return r.data;
}

async function main() {
const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  const insCol = db.collection(COL.ins);
  const partCol = db.collection(COL.part);
  const gradesCol = db.collection(COL.grades);

  line('============================================================');
  line(` DIAGNÓSTICO reporte-avances — curso Moodle idMoodle=${TARGET}`);
  line('============================================================');

  // ---- PASO 1: ¿existe inscripción que referencie el curso? ----
  line('\n[1] Inscripción(es) vinculada(s) al curso (campo idMoodle / codigoCurso)');
  const insMatches = await insCol.find({
    $or: [
      { idMoodle: TARGET },
      { idMoodle: { $regex: `(^|[^0-9])${TARGET}([^0-9]|$)` } },
      { codigoCurso: { $regex: `(^|[^0-9])${TARGET}([^0-9]|$)` } },
    ],
  }).toArray();

  if (!insMatches.length) {
    bad(`No existe ninguna inscripción con idMoodle/codigoCurso = ${TARGET}.`);
    bad('CAUSA: el reporte se arma desde "inscripciones". Sin inscripción, el curso NO aparece.');
    line('\n   → Verifica en el módulo de Inscripciones que exista una con idMoodle=' + TARGET + '.');
    return;
  }
  ok(`Encontradas ${insMatches.length} inscripción(es).`);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const ins of insMatches) {
    const n = ins.numeroInscripcion;
    line('\n------------------------------------------------------------');
    line(` Inscripción N° ${n}  |  empresa=${ins.empresa}  |  status=${ins.status || '(sin status)'}`);
    line(` idMoodle="${ins.idMoodle}"  codigoCurso="${ins.codigoCurso}"  correlativo=${ins.correlativo}`);
    line(` nombreCurso="${ins.nombreCurso || ''}"`);
    line(` inicio=${ins.inicio}  termino=${ins.termino || '(sin término)'}`);

    // idMoodle numérico
    const providedCode = (String(ins.idMoodle || '').trim()) || (String(ins.codigoCurso || '').trim());
    const courseId = providedCode.replace(/[^0-9]/g, '');
    line('\n[2] IdCurso numérico para consultar notas');
    if (!courseId) {
      bad('idMoodle/codigoCurso no contiene dígitos → grades-numeric responde 400 y NO genera notas.');
    } else ok(`courseId numérico = ${courseId}`);

    // empresa
    line('\n[3] Empresa (filtro del frontend)');
    if (ins.empresa === undefined || ins.empresa === null || ins.empresa === '') {
      warn('La inscripción no tiene empresa asignada → no aparece al filtrar por empresa.');
    } else {
      ok(`empresa=${ins.empresa}. El curso solo es visible para usuarios de esa empresa (o admin multi/holding).`);
    }

    // active vs historic
    line('\n[4] Modo de la vista (por defecto = "Activos")');
    const end = ins.termino ? new Date(String(ins.termino).substring(0, 10)) : null;
    if (end && !isNaN(end.getTime())) {
      end.setHours(0, 0, 0, 0);
      if (end.getTime() < today.getTime()) {
        warn(`termino (${ins.termino}) ya pasó → en modo "Activos" se OCULTA. Aparece solo en "Histórico"/"Todos".`);
      } else ok('El curso está vigente: visible en modo "Activos".');
    } else warn('Sin fecha de término válida: se trata como activo (visible).');

    // participantes
    line('\n[5] Participantes (si no hay, el reporte salta el curso entero: "if (!parts.length) continue")');
    const byNumero = { numeroInscripcion: { $in: [n, Number(n), String(n)] } };
    const parts = await partCol.find(byNumero).toArray();
    if (!parts.length) {
      bad('0 participantes → el curso NO genera NINGUNA fila en el reporte. CAUSA MUY PROBABLE.');
    } else {
      ok(`${parts.length} participante(s).`);
    }

    // grades en BD espejo
    line('\n[6] Notas en la BD espejo (grades_reports)');
    const grades = await gradesCol.find(byNumero).toArray();
    const realGrades = grades.filter((g) => g.RutAlumno && g.scope !== 'legacy');
    if (!realGrades.length) {
      bad('0 documentos de notas → columnas Nota/Avance/Asistencia vacías. ¿Nunca corrió grades-numeric o falló Moodle?');
    } else {
      const vacios = realGrades.filter((g) => g.PorcentajeAvance == null && g.PorcentajeAsistenciaAlumno == null && g.NotaFinal == null);
      ok(`${realGrades.length} documento(s) de notas.`);
      if (vacios.length === realGrades.length) {
        bad(`TODOS (${vacios.length}) vienen sin datos (avance/asistencia/nota = null).`);
        warn('Típico cuando processSingleGrade devuelve null: el gradebook del curso no tiene una actividad "mod" cuyo nombre contenga "Evaluación Final".');
      } else {
        ok(`${realGrades.length - vacios.length} con datos, ${vacios.length} vacíos.`);
      }
    }

    // cruce rut participante <-> grade
    if (parts.length && realGrades.length) {
      line('\n[7] Cruce RUT participante ↔ RUT en notas (el reporte une por rut en minúsculas)');
      const gRuts = new Set(realGrades.map((g) => String(g.RutAlumno).trim().toLowerCase()));
      const pRuts = parts.map((p) => String(p.rut || '').trim().toLowerCase());
      const matched = pRuts.filter((r) => gRuts.has(r));
      if (matched.length === pRuts.length) ok(`Coinciden ${matched.length}/${pRuts.length}.`);
      else {
        bad(`Solo coinciden ${matched.length}/${pRuts.length}. Las filas sin match muestran columnas de notas vacías.`);
        warn('Posible diferencia de formato de RUT (ej. "12345678-9" vs "12345678").');
        line('    ruts participante: ' + JSON.stringify(pRuts.slice(0, 5)));
        line('    ruts en notas:     ' + JSON.stringify([...gRuts].slice(0, 5)));
      }
    }
  }

  // ---- Verificación contra Moodle (solo lectura) ----
  if (MOODLE_URL && MOODLE_TOKEN) {
    line('\n============================================================');
    line(' VERIFICACIÓN EN MOODLE (WebServices, solo lectura)');
    line('============================================================');
    const courseId = TARGET.replace(/[^0-9]/g, '');
    try {
      line('\n[8] ¿El curso existe en Moodle?');
      const byField = await ws('core_course_get_courses_by_field', { field: 'id', value: courseId });
      const courses = byField?.courses || [];
      if (!courses.length) bad(`Moodle no devuelve curso con id=${courseId} (¿id equivocado o sin permiso?).`);
      else ok(`Curso: "${courses[0].fullname}"  (shortname=${courses[0].shortname}, visible=${courses[0].visible}).`);

      line('\n[9] Usuarios matriculados (para "Último acceso" y para tomar una muestra de notas)');
      const enrolled = await ws('core_enrol_get_enrolled_users', { courseid: courseId });
      if (Array.isArray(enrolled)) {
        ok(`${enrolled.length} usuario(s) matriculado(s).`);
        const student = enrolled.find((u) => Array.isArray(u.roles) && u.roles.some((r) => r.roleid === 5)) || enrolled[0];
        if (student) {
          line('\n[10] Gradebook del curso (clave del cálculo de notas)');
          const gi = await ws('gradereport_user_get_grade_items', { courseid: courseId, userid: student.id });
          const ug = gi?.usergrades?.[0];
          const items = (ug?.gradeitems || []).filter((it) => (it.itemtype || '').toLowerCase() === 'mod');
          if (!items.length) {
            bad('El gradebook no devuelve actividades tipo "mod" (¿permisos del WS o sin actividades calificables?).');
          } else {
            line('    Actividades "mod" en el gradebook:');
            for (const it of items) line('      - ' + it.itemname);
            const tieneFinal = items.some((it) => normalize(it.itemname).includes(normalize('Evaluación Final')));
            if (tieneFinal) ok('Existe una actividad cuyo nombre contiene "Evaluación Final" → processSingleGrade puede calcular nota.');
            else {
              bad('NINGUNA actividad contiene "Evaluación Final".');
              bad('CAUSA: processSingleGrade exige un item mod con ese nombre; si no existe devuelve null → notas vacías en el reporte.');
            }
          }
        }
      } else {
        warn('No se pudo listar matriculados: ' + JSON.stringify(enrolled).slice(0, 200));
      }
    } catch (e) {
      warn('Error consultando Moodle: ' + (e?.response?.data?.message || e.message));
    }
  } else {
    warn('\nNo se ejecutó la verificación de Moodle (faltan MOODLE_BASE_URL / MOODLE_WS_TOKEN).');
  }

  line('\n============================================================');
  line(' RESUMEN: revisa los ❌ de arriba en orden. El primero que aparezca');
  line(' es, con alta probabilidad, la causa por la que el curso no muestra');
  line(' resultados en /reporte-avances.');
  line('============================================================');
} catch (e) {
  console.error('ERROR de conexión/ejecución:', e.message);
} finally {
  await client.close();
}
}

await main();
