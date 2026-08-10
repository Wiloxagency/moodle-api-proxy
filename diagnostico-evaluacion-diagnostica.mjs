/**
 * Diagnóstico SOLO-LECTURA de la "Evaluación Diagnóstica" en el reporte de avances.
 *
 * Responde a la pregunta: ¿por qué un alumno que SÍ tiene nota diagnóstica en
 * Moodle aparece sin nota (o sin columna "Eval. Diag.") en /reporte-avances?
 *
 * No escribe nada en Moodle ni en Mongo.
 *
 * Uso (desde la carpeta moodle-api-proxy, con el .env configurado):
 *
 *   # por id de curso de Moodle (el "id=" de /course/view.php?id=XXX)
 *   node diagnostico-evaluacion-diagnostica.mjs --curso=356 11539799-0 12304382-0
 *
 *   # por ID Sence de la inscripción (resuelve el curso mirando Mongo)
 *   node diagnostico-evaluacion-diagnostica.mjs --sence=6842237 11539799-0 12304382-0
 *
 *   # por número de inscripción
 *   node diagnostico-evaluacion-diagnostica.mjs --inscripcion=INS-0123
 *
 *   # por cmid (el "id=" de la URL de la actividad); requiere que el token
 *   # tenga habilitada core_course_get_course_module
 *   node diagnostico-evaluacion-diagnostica.mjs --cmid=101395 11539799-0 12304382-0
 *
 * Si no se pasan RUTs, se toman los primeros 3 alumnos matriculados.
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
const CMID = getFlag('cmid').replace(/[^0-9]/g, '');
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

// Regla ANTERIOR (la que estaba en producción): dos palabras exactas.
const isDiagOld = (name) => {
  const w = norm(name).split(/[^a-z]+/).filter(Boolean);
  return (
    w.some((x) => x === 'evaluacion' || x === 'prueba') &&
    w.some((x) => x === 'diagnostica' || x === 'diagnostico')
  );
};

// Regla NUEVA: basta con una palabra que contenga "diagnostic".
const isDiagNew = (name) => words(name).some((x) => x.includes('diagnostic'));

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
const line = () => console.log('-'.repeat(70));

// --- 0a) Resolver el curso desde Mongo (--sence / --inscripcion) ------------
async function resolverCursoDesdeMongo() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
  const colName = process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones';
  if (!uri) {
    console.log('  MONGODB_URI no está definido en el .env; no puedo resolver el curso desde Mongo.');
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
    if (SENCE) {
      or.push({ idSence: SENCE }, { idSence: Number(SENCE) });
    }
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
        `  Inscripción ${d.numeroInscripcion} | Sence ${d.idSence} | ${String(d.nombreCurso || '').slice(0, 55)} | idMoodle=${raw || '(vacío)'}`
      );
      if (raw) ids.add(raw);
    }
    if (ids.size > 1) {
      console.log(`  ⚠️  Varias inscripciones apuntan a cursos distintos: ${[...ids].join(', ')}. Uso el primero.`);
    }
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

// --- 0b) Resolver el curso a partir del cmid --------------------------------
if (!COURSE && CMID) {
  const cm = await ws('core_course_get_course_module', { cmid: CMID });
  if (isError(cm)) {
    console.log(`No se pudo resolver el cmid ${CMID}: ${cm.message} (${cm.errorcode})`);
    console.log('El token no tiene habilitada core_course_get_course_module.');
    console.log('Alternativas:');
    console.log('  a) Abre el curso en Moodle y usa el "id=" de /course/view.php?id=XXX  ->  --curso=XXX');
    console.log('  b) Usa el ID Sence de la inscripción                                  ->  --sence=6842237');
    process.exit(1);
  }
  COURSE = String(cm?.cm?.course || '');
  console.log(`cmid ${CMID} -> curso ${COURSE} | actividad: "${cm?.cm?.name}" (${cm?.cm?.modname})`);
}

if (!COURSE) {
  console.error('\nIndica --curso=<idCursoMoodle>, --sence=<idSence>, --inscripcion=<numero> o --cmid=<idModulo>.');
  process.exit(1);
}

console.log('='.repeat(70));
console.log(` DIAGNÓSTICO Evaluación Diagnóstica — curso ${COURSE}`);
console.log('='.repeat(70));

// --- 1) Actividades del curso ----------------------------------------------
console.log('\n[A] Actividades del curso (core_course_get_contents)');
let quizModules = [];
try {
  const contents = await ws('core_course_get_contents', {
    courseid: COURSE,
    'options[0][name]': 'includestealthmodules',
    'options[0][value]': '1',
  });
  if (isError(contents)) {
    console.log(`  ERROR: ${contents.message} (${contents.errorcode})`);
  } else if (Array.isArray(contents)) {
    for (const section of contents) {
      const mods = section.modules || [];
      if (!mods.length) continue;
      console.log(`  Sección ${section.section}: ${section.name}`);
      for (const m of mods) {
        const flags = [];
        if (isDiagNew(m.name)) flags.push('DIAGNÓSTICA (regla nueva)');
        if (isDiagOld(m.name)) flags.push('diagnóstica (regla antigua)');
        if (m.visible === 0) flags.push('oculta');
        console.log(`    - [${m.modname}] ${m.name}${flags.length ? '   <<< ' + flags.join(' / ') : ''}`);
        if (String(m.modname).toLowerCase() === 'quiz' && isDiagNew(m.name)) {
          quizModules.push({ cmid: m.id, instance: m.instance, name: m.name });
        }
      }
    }
  }
} catch (e) {
  console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
}

if (!quizModules.length) {
  console.log('\n  ⚠️  No se encontró ningún cuestionario con "diagnóstic*" en el nombre.');
} else {
  console.log(`\n  Cuestionario diagnóstico detectado: "${quizModules[0].name}" (quizid=${quizModules[0].instance})`);
}

// --- 2) Alumnos a revisar ---------------------------------------------------
console.log('\n[B] Alumnos matriculados (core_enrol_get_enrolled_users)');
let alumnos = [];
try {
  const enrolled = await ws('core_enrol_get_enrolled_users', { courseid: COURSE });
  if (isError(enrolled)) {
    console.log(`  ERROR: ${enrolled.message} (${enrolled.errorcode})`);
  } else if (Array.isArray(enrolled)) {
    console.log(`  Total matriculados: ${enrolled.length}`);
    if (RUTS.length) {
      for (const rut of RUTS) {
        const u = enrolled.find(
          (x) => String(x.username || '').startsWith(rut) || String(x.username || '') === rut
        );
        if (u) alumnos.push(u);
        else console.log(`  ⚠️  No se encontró el usuario con username "${rut}" en el curso.`);
      }
    } else {
      alumnos = enrolled.slice(0, 3);
    }
  }
} catch (e) {
  console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
}

// --- 3) Libro de notas por alumno ------------------------------------------
for (const u of alumnos) {
  line();
  console.log(`ALUMNO: ${u.fullname}  (username=${u.username}, id=${u.id})`);
  line();

  let items = [];
  let shape = '';
  try {
    const g = await ws('gradereport_user_get_grade_items', { courseid: COURSE, userid: u.id });
    if (isError(g)) {
      console.log(`  gradereport_user_get_grade_items -> ERROR: ${g.message} (${g.errorcode})`);
    } else if (g?.usergrades?.[0]?.gradeitems) {
      shape = 'gradereport_user_get_grade_items';
      items = g.usergrades[0].gradeitems.map((gi) => ({
        itemtype: gi.itemtype,
        itemname: gi.itemname,
        itemmodule: gi.itemmodule,
        graderaw: gi.graderaw,
        hidden: gi.hidden,
      }));
    }
  } catch (e) {
    console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
  }

  if (!items.length) {
    try {
      const g2 = await ws('core_grades_get_grades', { courseid: COURSE, 'userids[0]': u.id });
      if (isError(g2)) {
        console.log(`  core_grades_get_grades -> ERROR: ${g2.message} (${g2.errorcode})`);
      } else if (Array.isArray(g2?.items)) {
        shape = 'core_grades_get_grades (fallback)';
        items = g2.items.map((it) => ({
          itemtype: it.itemtype || (it.itemmodule || it.activityid ? 'mod' : ''),
          itemname: it.itemname || it.name,
          itemmodule: it.itemmodule,
          graderaw: (it.grades || []).find((x) => Number(x.userid) === Number(u.id))?.grade ?? null,
          hidden: it.hidden,
        }));
      }
    } catch (e) {
      console.log('  ERROR: ' + (e?.response?.data?.message || e.message));
    }
  }

  console.log(`  Fuente de notas: ${shape || 'ninguna'} — ${items.length} ítems`);
  for (const it of items) {
    const tags = [];
    if (isDiagNew(it.itemname)) tags.push('DIAGNÓSTICA (nueva)');
    if (isDiagOld(it.itemname)) tags.push('diagnóstica (antigua)');
    if (norm(it.itemname).includes('evaluacion final')) tags.push('EVALUACIÓN FINAL');
    if (it.hidden) tags.push('OCULTO en gradebook');
    console.log(
      `    [${it.itemtype}/${it.itemmodule || '-'}] ${it.itemname} = ${it.graderaw ?? 'null'}` +
        (tags.length ? `   <<< ${tags.join(' / ')}` : '')
    );
  }

  const enGradebook = items.find((it) => isDiagNew(it.itemname));
  if (!enGradebook) {
    console.log('\n  ❌ La actividad diagnóstica NO aparece en el libro de notas del alumno.');
    console.log('     Causas típicas: ítem oculto en el gradebook (y el token no tiene');
    console.log('     moodle/grade:viewhidden), o el nombre del ítem difiere de la actividad.');
    if (quizModules.length) {
      const q = quizModules[0];
      try {
        const best = await ws('mod_quiz_get_user_best_grade', { quizid: q.instance, userid: u.id });
        if (isError(best)) {
          console.log(`  ↳ Respaldo mod_quiz_get_user_best_grade NO disponible: ${best.message} (${best.errorcode})`);
          console.log('     Habilita esa función en el External Service de Moodle para que el respaldo funcione.');
        } else {
          console.log(`  ↳ Respaldo mod_quiz_get_user_best_grade: hasgrade=${best.hasgrade} grade=${best.grade ?? '-'}`);
        }
      } catch (e) {
        console.log('  ↳ Respaldo falló: ' + (e?.response?.data?.message || e.message));
      }
    }
  } else {
    console.log(`\n  ✅ Detectada en el libro de notas con nota = ${enGradebook.graderaw ?? 'null'}`);
    if (!isDiagOld(enGradebook.itemname)) {
      console.log('     (la regla ANTIGUA no la reconocía: ese era el error)');
    }
  }
}

line();
console.log('Fin del diagnóstico.');
