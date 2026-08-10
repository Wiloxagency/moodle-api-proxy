/**
 * Diagnóstico SOLO-LECTURA del emparejamiento participante <-> usuario de Moodle.
 *
 * Responde: ¿cuántos participantes de una inscripción NO se están resolviendo en
 * Moodle, y por qué? Es la causa de que el avance y las notas salgan vacíos
 * cuando la matriculación no usa el RUT como username (alumnos extranjeros,
 * altas por correo, etc.).
 *
 * No escribe nada en Moodle ni en Mongo.
 *
 * Uso (desde moodle-api-proxy, con el .env configurado):
 *
 *   # una inscripción
 *   node diagnostico-matriculados.mjs --inscripcion=100045
 *
 *   # todas las inscripciones abiertas de una empresa (código numérico)
 *   node diagnostico-matriculados.mjs --empresa=12
 *
 *   # todas las inscripciones abiertas (resumen global)
 *   node diagnostico-matriculados.mjs --todas
 *
 *   # añade --detalle para listar los participantes no resueltos
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
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : '';
};
const has = (name) => args.includes(`--${name}`);

const INSCRIPCION = flag('inscripcion').trim();
const EMPRESA = flag('empresa').trim();
const TODAS = has('todas');
const DETALLE = has('detalle');

if (!INSCRIPCION && !EMPRESA && !TODAS) {
  console.error('Indica --inscripcion=<num>, --empresa=<codigo> o --todas');
  process.exit(1);
}

// --- Mismas reglas que resolveEnrolledUser en studentFinalGradeController ----
const key = (v) => String(v ?? '').trim().toLowerCase();

function construirIndice(matriculados) {
  const byUsername = new Map();
  const byEmail = new Map();
  const byIdnumber = new Map();
  const ambiguousEmails = new Set();
  for (const u of matriculados) {
    const un = key(u.username);
    if (un && !byUsername.has(un)) byUsername.set(un, u);
    const em = key(u.email);
    if (em) {
      if (byEmail.has(em)) ambiguousEmails.add(em);
      else byEmail.set(em, u);
    }
    const id = key(u.idnumber);
    if (id && !byIdnumber.has(id)) byIdnumber.set(id, u);
  }
  return { byUsername, byEmail, byIdnumber, ambiguousEmails, users: matriculados };
}

function resolver(index, username, email) {
  const userKey = key(username);
  const mailKey = key(email);

  if (userKey) {
    // Se distinguen las dos vías: el código ANTIGUO en producción sólo sabía
    // buscar por username, así que los que sólo casan por idnumber son
    // exactamente los que hoy salen en blanco en el reporte.
    const porUsername = index.byUsername.get(userKey);
    if (porUsername) return { user: porUsername, via: 'username exacto (ya funcionaba)' };
    const porIdnumber = index.byIdnumber.get(userKey);
    if (porIdnumber) return { user: porIdnumber, via: 'idnumber exacto (NUEVO)' };
  }
  if (mailKey && !index.ambiguousEmails.has(mailKey)) {
    const hit = index.byEmail.get(mailKey) || index.byUsername.get(mailKey);
    if (hit) return { user: hit, via: 'correo (NUEVO)' };
  }
  if (!userKey) return { user: null, via: 'sin datos' };

  const compact = userKey.replace(/[.\-\s]/g, '');
  const withoutDv = compact.replace(/[0-9k]$/, '');
  const variants = [compact, withoutDv].filter((v) => v.length >= 5);
  for (const v of variants) {
    const hit = index.byUsername.get(v) || index.byIdnumber.get(v);
    if (hit) return { user: hit, via: 'variante del RUT (NUEVO)' };
  }
  for (const v of [userKey, ...variants]) {
    if (v.length < 5) continue;
    const hits = index.users.filter((u) => {
      const un = key(u.username).replace(/[.\-\s]/g, '');
      return un !== '' && un.startsWith(v);
    });
    if (hits.length === 1) return { user: hits[0], via: 'prefijo del RUT (NUEVO)' };
  }
  if (mailKey && index.ambiguousEmails.has(mailKey)) {
    return { user: null, via: 'correo genérico compartido' };
  }
  return { user: null, via: 'no encontrado' };
}

// --- Moodle ------------------------------------------------------------------
async function ws(wsfunction, params = {}, timeout = 60000) {
  const url = new URL('/webservice/rest/server.php', MOODLE_URL);
  url.searchParams.append('wstoken', MOODLE_TOKEN);
  url.searchParams.append('moodlewsrestformat', 'json');
  url.searchParams.append('wsfunction', wsfunction);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  const r = await axios.get(url.toString(), { timeout, headers: { Accept: 'application/json' } });
  return r.data;
}
const isError = (d) => d && typeof d === 'object' && 'exception' in d;

const cacheMatriculados = new Map();
async function matriculadosDe(courseId) {
  if (cacheMatriculados.has(courseId)) return cacheMatriculados.get(courseId);
  let data = await ws('core_enrol_get_enrolled_users', {
    courseid: courseId,
    'options[0][name]': 'userfields',
    'options[0][value]': 'id,username,email,idnumber,fullname,lastaccess',
  });
  if (isError(data) || !Array.isArray(data)) {
    data = await ws('core_enrol_get_enrolled_users', { courseid: courseId });
  }
  const lista = Array.isArray(data) ? data : [];
  cacheMatriculados.set(courseId, lista);
  return lista;
}

// --- Mongo -------------------------------------------------------------------
const { MongoClient } = await import('mongodb');
const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(DB_NAME);
const insCol = db.collection(process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones');
const partCol = db.collection(process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes');

let filtro = {};
if (INSCRIPCION) {
  const n = Number(INSCRIPCION);
  filtro = { $or: [{ numeroInscripcion: INSCRIPCION }, ...(Number.isFinite(n) ? [{ numeroInscripcion: n }] : [])] };
} else if (EMPRESA) {
  const n = Number(EMPRESA);
  filtro = { empresa: Number.isFinite(n) ? n : EMPRESA };
}

let inscripciones = await insCol.find(filtro).toArray();
if (!INSCRIPCION) {
  inscripciones = inscripciones.filter((i) => String(i.status || '').toLowerCase() !== 'cerrada');
}

console.log('='.repeat(78));
console.log(` EMPAREJAMIENTO participante <-> Moodle — ${inscripciones.length} inscripción(es)`);
console.log('='.repeat(78));

const global = { total: 0, resueltos: 0, porVia: {}, sinResolver: [], sinParticipantes: [], sinCurso: [] };

for (const ins of inscripciones) {
  const courseId = String(ins.idMoodle || ins.codigoCurso || '').replace(/[^0-9]/g, '');

  // El campo numeroInscripcion está a veces como número y a veces como texto:
  // hay que consultar por ambos, igual que hace el controlador real. Sin esto
  // algunas inscripciones devolvían cero participantes y quedaban fuera del
  // análisis sin avisar.
  const num = Number(ins.numeroInscripcion);
  const orNumero = [{ numeroInscripcion: ins.numeroInscripcion }, { numeroInscripcion: String(ins.numeroInscripcion) }];
  if (Number.isFinite(num)) orNumero.push({ numeroInscripcion: num });
  const participantes = await partCol.find({ $or: orNumero }).toArray();

  if (!participantes.length) {
    global.sinParticipantes.push(ins.numeroInscripcion);
    continue;
  }

  if (!courseId) {
    console.log(`\n- Inscripción ${ins.numeroInscripcion}: SIN idMoodle numérico (${participantes.length} participantes)`);
    global.sinCurso.push(ins.numeroInscripcion);
    continue;
  }

  const matriculados = await matriculadosDe(courseId);
  const index = construirIndice(matriculados);

  const stats = {};
  const noResueltos = [];
  for (const p of participantes) {
    const { user, via } = resolver(index, p.rut || '', p.mail || '');
    const etiqueta = user ? via : `NO RESUELTO (${via})`;
    stats[etiqueta] = (stats[etiqueta] || 0) + 1;
    global.total++;
    global.porVia[etiqueta] = (global.porVia[etiqueta] || 0) + 1;
    if (user) global.resueltos++;
    else noResueltos.push(p);
  }

  const ok = participantes.length - noResueltos.length;
  const pct = Math.round((ok / participantes.length) * 100);
  console.log(
    `\n- Inscripción ${ins.numeroInscripcion} | curso ${courseId} | ${String(ins.nombreCurso || '').slice(0, 45)}`
  );
  console.log(`  participantes: ${participantes.length} | matriculados en Moodle: ${matriculados.length} | resueltos: ${ok} (${pct}%)`);
  for (const [via, n] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${via}`);
  }
  if (index.ambiguousEmails.size) {
    console.log(`    correos genéricos compartidos en el curso: ${[...index.ambiguousEmails].slice(0, 5).join(', ')}${index.ambiguousEmails.size > 5 ? ' ...' : ''}`);
  }
  if (DETALLE && noResueltos.length) {
    console.log('    --- no resueltos ---');
    for (const p of noResueltos.slice(0, 30)) {
      console.log(`      rut="${p.rut || ''}"  mail="${p.mail || ''}"  ${p.nombres || ''} ${p.apellidos || ''}`);
    }
    if (noResueltos.length > 30) console.log(`      ... y ${noResueltos.length - 30} más`);
  }
  global.sinResolver.push(...noResueltos.map((p) => ({ ins: ins.numeroInscripcion, rut: p.rut, mail: p.mail })));
}

console.log('\n' + '='.repeat(78));
console.log(' RESUMEN GLOBAL');
console.log('='.repeat(78));
console.log(`  inscripciones revisadas:  ${inscripciones.length}`);
console.log(`  participantes analizados: ${global.total}`);
console.log(`  resueltos:                ${global.resueltos} (${global.total ? Math.round((global.resueltos / global.total) * 100) : 0}%)`);
console.log(`  sin resolver:             ${global.total - global.resueltos}`);
for (const [via, n] of Object.entries(global.porVia).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(6)}  ${via}`);
}
const nuevos = Object.entries(global.porVia)
  .filter(([via]) => via.includes('NUEVO'))
  .reduce((acc, [, n]) => acc + n, 0);
console.log(`\n  participantes que SÓLO resuelve el código nuevo: ${nuevos}`);
if (global.sinParticipantes.length) {
  console.log(`\n  inscripciones sin participantes en Mongo (${global.sinParticipantes.length}): ${global.sinParticipantes.slice(0, 15).join(', ')}${global.sinParticipantes.length > 15 ? ' ...' : ''}`);
}
if (global.sinCurso.length) {
  console.log(`  inscripciones sin idMoodle (${global.sinCurso.length}): ${global.sinCurso.join(', ')}`);
}

await client.close();
