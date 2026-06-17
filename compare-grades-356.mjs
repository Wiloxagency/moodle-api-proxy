/**
 * Comparador SOLO-LECTURA de acceso a notas entre cursos en Moodle.
 * No escribe nada. Ayuda a confirmar si el problema del curso 356 es de
 * ACCESO/PERMISOS del usuario del WebService en ese curso específico.
 *
 * Reproduce getUserGrades(): primero gradereport_user_get_grade_items y,
 * si falla, core_grades_get_grades (la misma cascada que usa la app).
 *
 * Uso (desde moodle-api-proxy): pasa el curso problemático y UNO que SÍ
 * funcione hoy en el reporte, para comparar.
 *   node compare-grades-356.mjs 356 <ID_CURSO_QUE_FUNCIONA> [otro...]
 *   node compare-grades-356.mjs 356            # solo el 356
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const COURSES = (process.argv.slice(2).length ? process.argv.slice(2) : ['356'])
  .map((c) => String(c).replace(/[^0-9]/g, '')).filter(Boolean);
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
const isError = (d) => d && typeof d === 'object' && 'exception' in d;
const errStr = (d) => `${d.errorcode}: ${d.message}`;

// ---- Site info: identificar al usuario del WebService ----
console.log('============================================================');
console.log(' SITE INFO (usuario del WebService)');
console.log('============================================================');
try {
  const si = await ws('core_webservice_get_site_info');
  if (isError(si)) console.log('  ❌ ' + errStr(si));
  else {
    console.log(`  sitename : ${si.sitename}`);
    console.log(`  usuario  : ${si.username}  (userid=${si.userid}, fullname=${si.fullname})`);
    const fns = new Set((si.functions || []).map((f) => f.name));
    for (const f of ['core_course_get_contents', 'gradereport_user_get_grade_items', 'core_grades_get_grades', 'core_enrol_get_enrolled_users']) {
      console.log(`  función ${fns.has(f) ? '✅' : '❌'} ${f}`);
    }
  }
} catch (e) { console.log('  ❌ ' + (e?.response?.data?.message || e.message)); }

// ---- Por cada curso ----
for (const courseId of COURSES) {
  console.log('\n============================================================');
  console.log(` CURSO ${courseId}`);
  console.log('============================================================');

  // 1) ¿Curso accesible?
  try {
    const byField = await ws('core_course_get_courses_by_field', { field: 'id', value: courseId });
    const c = byField?.courses?.[0];
    console.log(`  curso        : ${c ? '"' + c.fullname + '"  (categoryid=' + c.categoryid + ', visible=' + c.visible + ')' : '❌ no devuelto'}`);
  } catch (e) { console.log('  curso        : ❌ ' + (e?.response?.data?.message || e.message)); }

  // 2) Acceso al contenido (require course view)
  try {
    const contents = await ws('core_course_get_contents', { courseid: courseId });
    if (isError(contents)) console.log(`  contenidos   : ❌ ${errStr(contents)}`);
    else console.log(`  contenidos   : ✅ ${Array.isArray(contents) ? contents.reduce((a, s) => a + (s.modules?.length || 0), 0) : '?'} módulos`);
  } catch (e) { console.log('  contenidos   : ❌ ' + (e?.response?.data?.message || e.message)); }

  // 3) Matriculados + 1 alumno de muestra
  let student = null;
  try {
    const enrolled = await ws('core_enrol_get_enrolled_users', { courseid: courseId });
    if (Array.isArray(enrolled)) {
      console.log(`  matriculados : ✅ ${enrolled.length}`);
      student = enrolled.find((u) => Array.isArray(u.roles) && u.roles.some((r) => r.roleid === 5)) || enrolled[0];
    } else console.log('  matriculados : ❌ ' + JSON.stringify(enrolled).slice(0, 160));
  } catch (e) { console.log('  matriculados : ❌ ' + (e?.response?.data?.message || e.message)); }

  if (!student) { console.log('  (sin alumno de muestra, no se prueban notas)'); continue; }
  console.log(`  alumno prueba: id=${student.id} username=${student.username || ''}`);

  // 4a) gradereport_user_get_grade_items (función primaria de la app)
  try {
    const gi = await ws('gradereport_user_get_grade_items', { courseid: courseId, userid: student.id });
    if (isError(gi)) {
      console.log(`  grade_items  : ❌ ${errStr(gi)}`);
    } else {
      const items = gi?.usergrades?.[0]?.gradeitems || [];
      const mods = items.filter((it) => (it.itemtype || '').toLowerCase() === 'mod');
      const final = mods.find((it) => norm(it.itemname).includes(norm('Evaluación Final')));
      console.log(`  grade_items  : ✅ ${items.length} items (${mods.length} mod) ${final ? '— tiene "Evaluación Final"' : '— SIN "Evaluación Final"'}`);
      if (mods.length) console.log('                 mods: ' + mods.map((m) => m.itemname).join(' | '));
    }
  } catch (e) { console.log('  grade_items  : ❌ ' + (e?.response?.data?.message || e.message)); }

  // 4b) core_grades_get_grades (fallback de la app)
  try {
    const cg = await ws('core_grades_get_grades', { courseid: courseId, 'userids[0]': student.id });
    if (isError(cg)) console.log(`  fallback     : ❌ ${errStr(cg)}`);
    else {
      const n = Array.isArray(cg?.items) ? cg.items.length : 0;
      console.log(`  fallback     : ✅ core_grades_get_grades devolvió ${n} items`);
    }
  } catch (e) { console.log('  fallback     : ❌ ' + (e?.response?.data?.message || e.message)); }
}

console.log('\n============================================================');
console.log(' LECTURA: si en el curso que SÍ funciona "contenidos" y');
console.log(' "grade_items" salen ✅, pero en el 356 salen ❌ (accessexception /');
console.log(' invalidresponse), el problema es de ACCESO del usuario del');
console.log(' WebService al curso 356 (rol/matrícula/categoría/permisos), no');
console.log(' del código ni de los datos.');
console.log('============================================================');
