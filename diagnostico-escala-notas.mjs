/**
 * Diagnóstico SOLO-LECTURA de la ESCALA de las notas que devuelve Moodle.
 *
 * Responde a: ¿la "Evaluación Diagnóstica" está sobre 100, sobre 10 o sobre 7?
 * ¿El número que sale en el Excel viene así de Moodle o lo transformamos nosotros?
 *
 * Para cada ítem del libro de notas imprime graderaw / grademin / grademax /
 * gradeformatted / percentageformatted, y para cada cuestionario del curso la
 * "Calificación máxima" (quiz.grade) frente a la suma de puntuaciones de las
 * preguntas (quiz.sumgrades). Si grademax = 100 el número del reporte es fiel a
 * Moodle y lo que hay que corregir es la configuración de la actividad.
 *
 * No escribe nada en Moodle ni en Mongo.
 *
 * Uso (desde la carpeta moodle-api-proxy, con el .env configurado):
 *
 *   node diagnostico-escala-notas.mjs --curso=356 12164794-K 16163582-0
 *   node diagnostico-escala-notas.mjs --sence=6857888 12164794-K
 *   node diagnostico-escala-notas.mjs --inscripcion=102175
 *
 * Si no se pasan RUTs se toman los primeros 3 alumnos matriculados.
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const MOODLE_URL = process.env.MOODLE_BASE_URL || '';
const MOODLE_TOKEN = process.env.MOODLE_WS_TOKEN || '';

if (!MOODLE_URL || !MOODLE_TOKEN) {
  console.error('Faltan MOODLE_BASE_URL o MOODLE_WS_TOKEN en el .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const getFlag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : '';
};
let COURSE = getFlag('curso').replace(/[^0-9]/g, '');
const SENCE = getFlag('sence').trim();
const INSCRIPCION = getFlag('inscripcion').trim();
const RUTS = args.filter((a) => !a.startsWith('--'));

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const words = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const isDiag = (name) => words(name).some((x) => x.includes('diagnostic'));
const isFinal = (name) => norm(name).includes('evaluacion final');

async function ws(wsfunction, params = {}) {
  const url = new URL('/webservice/rest/server.php', MOODLE_URL);
  url.searchParams.append('wstoken', MOODLE_TOKEN);
  url.searchParams.append('moodlewsrestformat', 'json');
  url.searchParams.append('wsfunction', wsfunction);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  const r = await axios.get(url.toString(), { timeout: 25000, headers: { Accept: 'application/json' } });
  return r.data;
}

const isError = (d) => d && typeof d === 'object' && 'exception' in d;
const line = (c = '-') => console.log(c.repeat(78));
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const num = (v) => (v === null || v === undefined || v === '' ? 'null' : String(v));

// --- 0) Resolver el curso desde Mongo (--sence / --inscripcion) -------------
async function resolverCursoDesdeMongo() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
  const colName = process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones';
  if (!uri) {
    console.log('  MONGODB_URI no está definido en el .env; usa --curso=<id>.');
    return '';
  }
  let mongo;
  try {
    mongo = await import('mongodb');
  } catch {
    console.log('  El paquete "mongodb" no está instalado en esta carpeta (npm install).');
    return '';
  }
  const client = new mongo.MongoClient(uri);
  try {
    await client.connect();
    const col = client.db(dbName).collection(colName);
    const or = [];
    if (SENCE) or.push({ idSence: SENCE }, { idSence: Number(SENCE) });
    if (INSCRIPCION) {
      or.push({ numeroInscripcion: INSCRIPCION });
      const n = Number(INSCRIPCION);
      if (Number.isFinite(n)) or.push({ numeroInscripcion: n });
    }
    if (!or.length) return '';
    const docs = await col.find({ $or: or }).toArray();
    if (!docs.length) {
      console.log('  No se encontró ninguna inscripción con ese ID Sence / número.');
      return '';
    }
    const ids = new Set();
    for (const d of docs) {
      const raw = String(d.idMoodle || d.codigoCurso || '').replace(/[^0-9]/g, '');
      console.log(
        `  Inscripción ${d.numeroInscripcion} | Sence ${d.idSence} | ${String(d.nombreCurso || '').slice(0, 50)} | idMoodle=${raw || '(vacío)'}`
      );
      if (raw) ids.add(raw);
    }
    if (ids.size > 1) console.log(`  ⚠️  Varios cursos distintos: ${[...ids].join(', ')}. Uso el primero.`);
    return [...ids][0] || '';
  } catch (e) {
    console.log('  Error consultando Mongo: ' + e.message);
    return '';
  } finally {
    await client.close().catch(() => {});
  }
}

if (!COURSE && (SENCE || INSCRIPCION)) {
  console.log('\n[0] Resolviendo el curso desde la colección de inscripciones...');
  COURSE = await resolverCursoDesdeMongo();
}

if (!COURSE) {
  console.error('\nIndica --curso=<idCursoMoodle>, --sence=<idSence> o --inscripcion=<numero>.');
  process.exit(1);
}

line('=');
console.log(` ESCALA DE NOTAS — curso Moodle ${COURSE}`);
line('=');

// --- 1) Configuración de los cuestionarios del curso ------------------------
console.log('\n[A] Cuestionarios del curso (mod_quiz_get_quizzes_by_courses)');
console.log('    quiz.grade   = "Calificación máxima" configurada en la actividad');
console.log('    quiz.sumgrades = suma de las puntuaciones de las preguntas\n');
try {
  const qs = await ws('mod_quiz_get_quizzes_by_courses', { 'courseids[0]': COURSE });
  if (isError(qs)) {
    console.log(`  ERROR: ${qs.message} (${qs.errorcode})`);
    console.log('  (habilita mod_quiz_get_quizzes_by_courses en el External Service para ver esto)');
  } else {
    const quizzes = Array.isArray(qs?.quizzes) ? qs.quizzes : [];
    if (!quizzes.length) console.log('  (sin cuestionarios visibles para este token)');
    console.log(`  ${pad('actividad', 46)} ${pad('quizid', 8)} ${pad('grade', 8)} ${pad('sumgrades', 10)}`);
    for (const q of quizzes) {
      const flag = isDiag(q.name) ? '  <<< DIAGNÓSTICA' : isFinal(q.name) ? '  <<< FINAL' : '';
      console.log(
        `  ${pad(q.name, 46)} ${pad(q.id, 8)} ${pad(q.grade, 8)} ${pad(q.sumgrades, 10)}${flag}`
      );
    }
  }
} catch (e) {
  console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
}

// --- 2) Alumnos a revisar ---------------------------------------------------
console.log('\n[B] Alumnos (core_enrol_get_enrolled_users)');
let alumnos = [];
try {
  const enrolled = await ws('core_enrol_get_enrolled_users', { courseid: COURSE });
  if (isError(enrolled)) {
    console.log(`  ERROR: ${enrolled.message} (${enrolled.errorcode})`);
  } else if (Array.isArray(enrolled)) {
    console.log(`  Total matriculados: ${enrolled.length}`);
    if (RUTS.length) {
      for (const rut of RUTS) {
        const key = norm(rut);
        const u = enrolled.find(
          (x) => norm(x.username) === key || norm(x.username).startsWith(key) || norm(x.idnumber) === key
        );
        if (u) alumnos.push(u);
        else console.log(`  ⚠️  No se encontró "${rut}" entre los matriculados.`);
      }
    } else {
      alumnos = enrolled.slice(0, 3);
    }
  }
} catch (e) {
  console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
}

// --- 3) Libro de notas con la escala de cada ítem ---------------------------
const resumen = [];

for (const u of alumnos) {
  line();
  console.log(`ALUMNO: ${u.fullname}  (username=${u.username}, id=${u.id})`);
  line();
  try {
    const g = await ws('gradereport_user_get_grade_items', { courseid: COURSE, userid: u.id });
    if (isError(g)) {
      console.log(`  ERROR: ${g.message} (${g.errorcode})`);
      continue;
    }
    const gradeitems = g?.usergrades?.[0]?.gradeitems || [];
    console.log(
      `  ${pad('ítem', 42)} ${pad('mod', 7)} ${pad('graderaw', 10)} ${pad('min', 6)} ${pad('max', 7)} ${pad('formateada', 12)} %`
    );
    for (const gi of gradeitems) {
      const tag = isDiag(gi.itemname)
        ? '  <<< DIAGNÓSTICA'
        : isFinal(gi.itemname)
        ? '  <<< FINAL'
        : '';
      console.log(
        `  ${pad(gi.itemname, 42)} ${pad(gi.itemmodule || '-', 7)} ${pad(num(gi.graderaw), 10)} ` +
          `${pad(num(gi.grademin), 6)} ${pad(num(gi.grademax), 7)} ${pad(gi.gradeformatted, 12)} ` +
          `${gi.percentageformatted ?? '-'}${tag}`
      );
      if (isDiag(gi.itemname)) {
        resumen.push({
          alumno: u.fullname,
          item: gi.itemname,
          graderaw: gi.graderaw,
          grademax: gi.grademax,
          formateada: gi.gradeformatted,
        });
      }
    }
  } catch (e) {
    console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
  }
}

// --- 4) Veredicto -----------------------------------------------------------
line('=');
console.log(' VEREDICTO');
line('=');
if (!resumen.length) {
  console.log(' No se pudo leer ningún ítem diagnóstico; revisa los errores de arriba.');
} else {
  const maxes = [...new Set(resumen.map((r) => Number(r.grademax)))];
  console.log(` Ítem diagnóstico: "${resumen[0].item}"`);
  console.log(` grademax observado: ${maxes.join(', ')}`);
  for (const r of resumen) {
    console.log(`   - ${pad(r.alumno, 34)} graderaw=${num(r.graderaw)}  (Moodle muestra "${r.formateada}")`);
  }
  console.log('');
  if (maxes.length === 1 && maxes[0] === 100) {
    console.log(' => La actividad está configurada SOBRE 100 en Moodle. El número del Excel es');
    console.log('    exactamente el graderaw de Moodle: NO hay conversión en nuestro sistema.');
    console.log('    Para verla sobre 7 o sobre 10 hay que cambiar la "Calificación máxima" de la');
    console.log('    actividad en Moodle (o el grademax del ítem en el libro de notas).');
  } else if (maxes.length === 1 && (maxes[0] === 7 || maxes[0] === 10)) {
    console.log(` => La actividad está sobre ${maxes[0]} en Moodle. Si el Excel muestra un número`);
    console.log('    ~10x mayor, el problema SÍ está en nuestro sistema (revisar NotaDiagnostica).');
  } else {
    console.log(' => grademax no es 7, 10 ni 100: revisa la configuración de la actividad.');
  }
  console.log('');
  console.log(' Nota: nuestro backend guarda `graderaw.toFixed(1)` sin escalar. Cualquier');
  console.log(' diferencia entre esta columna graderaw y el Excel sí sería un bug nuestro.');
}
line();
console.log('Fin del diagnóstico.');
