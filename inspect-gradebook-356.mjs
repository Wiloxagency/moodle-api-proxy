/**
 * Inspector SOLO-LECTURA del libro de notas (gradebook) de un curso en Moodle.
 * No escribe nada. Sirve para saber por qué processSingleGrade devuelve null
 * (es decir, por qué las notas salen vacías en /reporte-avances).
 *
 * Reproduce lo que hace studentFinalGradeController:
 *   - getUserGrades -> gradereport_user_get_grade_items (y core_grades_get_grades como fallback)
 *   - busca un item itemtype="mod" cuyo nombre contenga "Evaluación Final"
 *
 * Uso (desde moodle-api-proxy):
 *   node inspect-gradebook-356.mjs            # curso 356, 3 alumnos de muestra
 *   node inspect-gradebook-356.mjs 356 5      # curso 356, 5 alumnos de muestra
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const COURSE = String(process.argv[2] || '356').replace(/[^0-9]/g, '');
const SAMPLE = Math.max(1, Number(process.argv[3] || 3));
const MOODLE_URL = process.env.MOODLE_BASE_URL || '';
const MOODLE_TOKEN = process.env.MOODLE_WS_TOKEN || '';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function ws(wsfunction, params = {}) {
  const url = new URL('/webservice/rest/server.php', MOODLE_URL);
  url.searchParams.append('wstoken', MOODLE_TOKEN);
  url.searchParams.append('moodlewsrestformat', 'json');
  url.searchParams.append('wsfunction', wsfunction);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  const r = await axios.get(url.toString(), { timeout: 20000, headers: { Accept: 'application/json' } });
  return r.data;
}

function isError(d) { return d && typeof d === 'object' && 'exception' in d; }

console.log('============================================================');
console.log(` INSPECTOR gradebook — curso ${COURSE}`);
console.log('============================================================');

// 1) Actividades reales del curso (módulos)
console.log('\n[A] Módulos/actividades del curso (core_course_get_contents)');
try {
  const contents = await ws('core_course_get_contents', { courseid: COURSE });
  if (isError(contents)) {
    console.log('  ❌ Error: ' + contents.message + '  (' + contents.errorcode + ')');
  } else if (Array.isArray(contents)) {
    let total = 0;
    for (const section of contents) {
      const mods = section.modules || [];
      for (const m of mods) {
        total++;
        console.log(`   - [${m.modname}] ${m.name}`);
      }
    }
    if (!total) console.log('  ⚠️  El curso no tiene módulos visibles para el token.');
    else console.log(`  Total módulos: ${total}`);
  }
} catch (e) {
  console.log('  ❌ ' + (e?.response?.data?.message || e.message));
}

// 2) Alumnos matriculados
console.log('\n[B] Alumnos matriculados');
let students = [];
try {
  const enrolled = await ws('core_enrol_get_enrolled_users', { courseid: COURSE });
  if (Array.isArray(enrolled)) {
    students = enrolled.filter((u) => Array.isArray(u.roles) && u.roles.some((r) => r.roleid === 5));
    console.log(`  Matriculados: ${enrolled.length} | con rol estudiante (roleid 5): ${students.length}`);
    if (!students.length) students = enrolled; // fallback
  } else {
    console.log('  ❌ ' + JSON.stringify(enrolled).slice(0, 200));
  }
} catch (e) {
  console.log('  ❌ ' + (e?.response?.data?.message || e.message));
}

// 3) Libro de notas por alumno de muestra
console.log(`\n[C] gradereport_user_get_grade_items para ${Math.min(SAMPLE, students.length)} alumno(s)`);
const targetPhrase = norm('Evaluación Final');
let algunoConFinal = false;
let algunoConMod = false;

for (const u of students.slice(0, SAMPLE)) {
  console.log(`\n  ── Alumno id=${u.id}  username=${u.username || ''}  (${u.fullname || ''}) ──`);
  let data;
  try {
    data = await ws('gradereport_user_get_grade_items', { courseid: COURSE, userid: u.id });
  } catch (e) {
    console.log('    ❌ ' + (e?.response?.data?.message || e.message));
    continue;
  }
  if (isError(data)) {
    console.log('    ❌ Error WS: ' + data.message + '  (' + data.errorcode + ')');
    continue;
  }
  const ug = data?.usergrades?.[0];
  const items = ug?.gradeitems || [];
  if (!items.length) {
    console.log('    ⚠️  Sin gradeitems en la respuesta (usergrades vacío).');
    continue;
  }
  for (const it of items) {
    const isMod = (it.itemtype || '').toLowerCase() === 'mod';
    if (isMod) algunoConMod = true;
    const flagFinal = isMod && norm(it.itemname).includes(targetPhrase);
    if (flagFinal) algunoConFinal = true;
    console.log(`     ${flagFinal ? '➡️ ' : '   '}itemtype=${it.itemtype || ''}  module=${it.itemmodule || ''}  graderaw=${it.graderaw}  name="${it.itemname || ''}"`);
  }
}

console.log('\n============================================================');
console.log(' CONCLUSIÓN');
if (!algunoConMod) {
  console.log(' ❌ No aparece NINGÚN ítem itemtype="mod" en el libro de notas.');
  console.log('    → O el curso no tiene actividades calificables en el gradebook,');
  console.log('      o el token del WebService no tiene permiso para verlas.');
} else if (!algunoConFinal) {
  console.log(' ❌ Hay ítems "mod", pero NINGUNO se llama (contiene) "Evaluación Final".');
  console.log('    → Esa es la causa exacta: processSingleGrade exige ese nombre.');
  console.log('      Revisa arriba cómo se llama realmente la evaluación final del curso.');
} else {
  console.log(' ✅ Existe un ítem "mod" con "Evaluación Final": el cálculo debería funcionar.');
  console.log('    Si aun así las notas salen null, revisar permisos de notas del token');
  console.log('    o el usuario/rut con el que se consulta.');
}
console.log('============================================================');
