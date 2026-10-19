/**
 * Diagnóstico SOLO-LECTURA de UN alumno: ¿por qué el reporte no muestra sus notas?
 *
 * Para cada participante con ese RUT (en todas sus inscripciones) muestra:
 *   - la inscripción (idMoodle, ID Sence, fechas, status, archivada)
 *   - lo que hay guardado en grades_reports (lo que lee el Reporte de Avances)
 *   - si el curso idMoodle existe y si el alumno está MATRICULADO en él
 *   - por qué vía lo resuelve el código (username, idnumber, correo...)
 *   - en qué cursos de Moodle está matriculado realmente ese usuario
 *   - las notas que devuelve Moodle para ese curso
 *
 * No escribe nada en Moodle ni en Mongo.
 *
 * Uso (desde moodle-api-proxy, con el .env configurado):
 *   node diagnostico-alumno.mjs --rut=17788599-1
 *   node diagnostico-alumno.mjs --rut=17605905-2 --email=czapatag@colbun.cl
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const MOODLE_URL = process.env.MOODLE_BASE_URL || '';
const MOODLE_TOKEN = process.env.MOODLE_WS_TOKEN || '';
const MONGO_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
if (!MOODLE_URL || !MOODLE_TOKEN || !MONGO_URI) {
  console.error('Faltan MOODLE_BASE_URL, MOODLE_WS_TOKEN o MONGODB_URI en el .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=').trim();
const RUT = flag('rut');
const EMAIL = flag('email');
if (!RUT && !EMAIL) {
  console.error('Indica --rut=<rut> y/o --email=<correo>');
  process.exit(1);
}

const key = (v) => String(v ?? '').trim().toLowerCase();
const compact = (v) => key(v).replace(/[.\-\s]/g, '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const rutDigits = compact(RUT).replace(/[0-9k]$/, ''); // sin DV

async function ws(wsfunction, params = {}, timeout = 60000) {
  const url = new URL('/webservice/rest/server.php', MOODLE_URL);
  url.searchParams.append('wstoken', MOODLE_TOKEN);
  url.searchParams.append('moodlewsrestformat', 'json');
  url.searchParams.append('wsfunction', wsfunction);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  try {
    const r = await axios.get(url.toString(), { timeout, headers: { Accept: 'application/json' } });
    return r.data;
  } catch (e) {
    return { exception: 'http', message: e.message };
  }
}
const isError = (d) => d && typeof d === 'object' && !Array.isArray(d) && 'exception' in d;

// --- Mongo -------------------------------------------------------------------
const { MongoClient } = await import('mongodb');
const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(DB_NAME);
const insCol = db.collection(process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones');
const partCol = db.collection(process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes');
const gradesCol = db.collection('grades_reports');

const or = [];
if (rutDigits.length >= 5) {
  // RUT con o sin puntos/guion: se busca por los dígitos sin DV
  const re = new RegExp(rutDigits.split('').join('[.\\s]?'), 'i');
  or.push({ rut: re }, { rutKey: re });
}
if (EMAIL) or.push({ mail: new RegExp(`^\\s*${EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') });
const participantes = await partCol.find({ $or: or }).toArray();

console.log('='.repeat(78));
console.log(` DIAGNÓSTICO ALUMNO rut=${RUT || '-'} email=${EMAIL || '-'}`);
console.log('='.repeat(78));
console.log(`Participantes encontrados en Mongo: ${participantes.length}`);

// --- Usuarios de Moodle candidatos (búsqueda global) --------------------------
const candidatos = new Map();
const buscar = async (field, value) => {
  if (!value) return;
  const d = await ws('core_user_get_users_by_field', { field, 'values[0]': value });
  if (Array.isArray(d)) for (const u of d) candidatos.set(u.id, { ...u, _via: `${field}=${value}` });
};
const rutsProbar = new Set([RUT, compact(RUT), ...participantes.map((p) => p.rut)].filter(Boolean));
for (const r of rutsProbar) {
  await buscar('username', key(r));
  await buscar('idnumber', r);
}
for (const m of new Set([EMAIL, ...participantes.map((p) => p.mail)].filter(Boolean))) await buscar('email', m);

console.log(`\nUsuarios de Moodle que casan con el RUT/correo: ${candidatos.size}`);
for (const u of candidatos.values()) {
  console.log(`  - id=${u.id} username="${u.username}" idnumber="${u.idnumber || ''}" email="${u.email}" (${u.fullname}) [por ${u._via}]`);
  const cursos = await ws('core_enrol_get_users_courses', { userid: u.id });
  if (Array.isArray(cursos)) {
    for (const c of cursos) console.log(`      matriculado en curso ${c.id}: ${c.fullname}`);
    if (!cursos.length) console.log('      (no está matriculado en ningún curso)');
  } else {
    console.log(`      no se pudo listar sus cursos: ${cursos?.message || cursos?.exception}`);
  }
}

// --- Por cada inscripción del participante -------------------------------------
for (const p of participantes) {
  const n = Number(p.numeroInscripcion);
  const ins = await insCol.findOne({ $or: [{ numeroInscripcion: p.numeroInscripcion }, { numeroInscripcion: String(p.numeroInscripcion) }, ...(Number.isFinite(n) ? [{ numeroInscripcion: n }] : [])] });
  console.log('\n' + '-'.repeat(78));
  console.log(`Inscripción ${p.numeroInscripcion}`);
  console.log(`  participante: rut="${p.rut}" rutKey="${p.rutKey || ''}" mail="${p.mail || ''}" ${p.nombres || ''} ${p.apellidos || ''}`);
  if (!ins) { console.log('  !! la inscripción NO existe en Mongo'); continue; }
  console.log(`  curso="${ins.nombreCurso || ''}" idMoodle="${ins.idMoodle || ''}" codigoCurso="${ins.codigoCurso || ''}" idSence="${ins.idSence || ''}" empresa=${ins.empresa}`);
  console.log(`  inicio=${ins.inicio || ''} termino=${ins.termino || ''} status="${ins.status || ''}" archivada=${ins.archivada === true} comentarios="${ins.comentarios || ''}"`);

  const grade = await gradesCol.findOne({ numeroInscripcion: { $in: [p.numeroInscripcion, n, String(p.numeroInscripcion)] }, RutAlumno: p.rut });
  if (grade) {
    console.log(`  grades_reports: avance=${grade.PorcentajeAvance} asistencia=${grade.PorcentajeAsistenciaAlumno} final=${grade.NotaFinal} diag=${grade.NotaDiagnostica} ultimoAcceso=${grade.UltimoAcceso} modulos=${(grade.EvaluacionesModulo || []).length}`);
  } else {
    console.log('  grades_reports: SIN documento (nunca se generó su reporte numérico)');
  }

  const courseId = String(ins.idMoodle || ins.codigoCurso || '').replace(/[^0-9]/g, '');
  if (!courseId) { console.log('  !! sin idMoodle numérico'); continue; }

  const curso = await ws('core_course_get_courses_by_field', { field: 'id', value: courseId });
  const c = curso?.courses?.[0];
  console.log(c ? `  curso Moodle ${courseId}: "${c.fullname}"` : `  !! curso Moodle ${courseId} NO existe o no es visible para el token`);

  let mats = await ws('core_enrol_get_enrolled_users', { courseid: courseId, 'options[0][name]': 'userfields', 'options[0][value]': 'id,username,email,idnumber,fullname,lastaccess' });
  if (!Array.isArray(mats)) mats = await ws('core_enrol_get_enrolled_users', { courseid: courseId });
  if (!Array.isArray(mats)) { console.log(`  !! no se pudo leer matriculados: ${mats?.message}`); continue; }
  console.log(`  matriculados en el curso: ${mats.length}`);

  const rk = key(p.rut), rc = compact(p.rut), mk = key(p.mail);
  const hits = mats.filter((u) =>
    key(u.username) === rk || key(u.idnumber) === rk ||
    compact(u.username) === rc || compact(u.idnumber) === rc ||
    (mk && key(u.email) === mk)
  );
  const mailRepetido = mk && mats.filter((u) => key(u.email) === mk).length > 1;
  if (!hits.length) {
    console.log('  !! el alumno NO está entre los matriculados de este curso');
  }
  for (const u of hits) {
    let via = [];
    if (key(u.username) === rk) via.push('username exacto');
    if (key(u.idnumber) === rk) via.push('idnumber exacto');
    if (compact(u.username) === rc && key(u.username) !== rk) via.push('username sólo SIN puntos/guion');
    if (compact(u.idnumber) === rc && key(u.idnumber) !== rk) via.push('idnumber sólo SIN puntos/guion');
    if (mk && key(u.email) === mk) via.push(mailRepetido ? 'correo (REPETIDO en el curso: no vale)' : 'correo');
    console.log(`  matrícula: id=${u.id} username="${u.username}" idnumber="${u.idnumber || ''}" email="${u.email}" lastaccess=${u.lastaccess ? new Date(u.lastaccess * 1000).toISOString() : 'nunca'}`);
    console.log(`    casa por: ${via.join(', ')}`);

    const g = await ws('gradereport_user_get_grade_items', { courseid: courseId, userid: u.id });
    if (isError(g)) { console.log(`    !! gradereport_user_get_grade_items: ${g.message || g.exception}`); continue; }
    const items = g?.usergrades?.[0]?.gradeitems || [];
    console.log(`    ítems del libro de notas: ${items.length}`);
    for (const it of items) {
      if (it.itemtype !== 'mod') continue;
      console.log(`      [${it.itemmodule}] ${String(it.itemname).padEnd(40)} graderaw=${it.graderaw ?? '-'}${it.hidden ? ' (oculto)' : ''}`);
    }
    const tieneFinal = items.some((it) => it.itemtype === 'mod' && norm(it.itemname).includes('evaluacion final'));
    console.log(`    ¿tiene "Evaluación Final"?: ${tieneFinal ? 'sí' : 'NO'}`);
  }
}

await client.close();
