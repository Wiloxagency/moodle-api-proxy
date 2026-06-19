/**
 * Diagnóstico SOLO-LECTURA del indicador "Participantes con 0% de Avance".
 *
 * Reproduce exactamente el cálculo de dashboardController.buildCache y compara:
 *   - conteo ANTERIOR  (avance === null || avance === 0)  ← inflado
 *   - conteo CORREGIDO (avance === 0)                     ← solo 0% reales
 *   - cuántos eran "null" (sin datos) que antes se contaban como 0%
 *
 * No escribe nada en Mongo ni en Moodle.
 *
 * Uso (desde moodle-api-proxy, donde están .env y node_modules):
 *   node diagnostico-avance-cero.mjs
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
const COL = {
  ins: process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones',
  part: process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes',
  grades: process.env.MONGODB_GRADES_REPORTS_COLLECTION || 'grades_reports',
};

const normalizeRut = (v) => String(v || '').replace(/[^0-9kK]/g, '').toLowerCase();
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function main() {
  if (!uri) {
    console.error('Falta MONGODB_URI en .env');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const inscripciones = await db.collection(COL.ins).find({}).toArray();

    const numerosSet = new Set();
    for (const ins of inscripciones) {
      const n = ins.numeroInscripcion;
      if (n === null || n === undefined) continue;
      numerosSet.add(n);
      const asNum = Number(n);
      if (!Number.isNaN(asNum)) numerosSet.add(asNum);
      numerosSet.add(String(n));
    }
    const numeros = Array.from(numerosSet);

    const participantes = await db.collection(COL.part)
      .find({ numeroInscripcion: { $in: numeros } }).toArray();
    const grades = await db.collection(COL.grades)
      .find({ numeroInscripcion: { $in: numeros }, RutAlumno: { $exists: true } }).toArray();

    const partsPorIns = new Map();
    for (const p of participantes) {
      const key = String(p.numeroInscripcion ?? '');
      if (!key) continue;
      (partsPorIns.get(key) || partsPorIns.set(key, []).get(key)).push(p);
    }
    const gradesPorIns = new Map();
    for (const g of grades) {
      const key = String(g.numeroInscripcion ?? '');
      if (!key) continue;
      const rutKey = normalizeRut(g.RutAlumno || '');
      if (!rutKey) continue;
      const m = gradesPorIns.get(key) || gradesPorIns.set(key, new Map()).get(key);
      m.set(rutKey, g);
    }

    let totalParticipantes = 0;
    let zeroOld = 0;       // null || 0  (lógica anterior)
    let zeroNew = 0;       // === 0      (lógica corregida)
    let nullContados = 0;  // null que la lógica anterior contaba como 0%
    const cursosTodoNull = [];

    for (const ins of inscripciones) {
      const key = String(ins.numeroInscripcion ?? '');
      if (!key) continue;
      const parts = partsPorIns.get(key) || [];
      const gmap = gradesPorIns.get(key);
      let withGrade = 0, nullsCurso = 0;

      for (const p of parts) {
        totalParticipantes += 1;
        const rutKey = normalizeRut(p.rut || '');
        const grade = rutKey ? gmap?.get(rutKey) : undefined;
        if (!grade) continue;
        withGrade += 1;
        const avance = toNum(grade.PorcentajeAvance);
        if (avance === null || avance === 0) zeroOld += 1;
        if (avance === 0) zeroNew += 1;
        if (avance === null) { nullContados += 1; nullsCurso += 1; }
      }
      if (withGrade > 0 && nullsCurso === withGrade) {
        cursosTodoNull.push({ n: ins.numeroInscripcion, curso: ins.nombreCurso, idMoodle: ins.idMoodle, parts: withGrade });
      }
    }

    console.log('============================================================');
    console.log(' Indicador "Participantes con 0% de Avance" — antes vs después');
    console.log('============================================================');
    console.log(` Total participantes:                 ${totalParticipantes}`);
    console.log(` Conteo ANTERIOR  (null || 0):        ${zeroOld}`);
    console.log(` Conteo CORREGIDO (solo 0 real):      ${zeroNew}`);
    console.log(` Diferencia (null mal contados como 0%): ${nullContados}`);
    console.log('');
    if (cursosTodoNull.length) {
      console.log(`Cursos con TODOS los participantes en "sin datos" (null) — principales sospechosos:`);
      for (const c of cursosTodoNull.slice(0, 25)) {
        console.log(`  - N°${c.n}  idMoodle=${c.idMoodle}  "${c.curso || ''}"  (${c.parts} part.)`);
      }
      if (cursosTodoNull.length > 25) console.log(`  ... y ${cursosTodoNull.length - 25} más`);
      console.log('');
      console.log('Sugerencia: revisa esos cursos con  node diagnostico-curso-356.mjs <idMoodle>');
      console.log('(suelen ser cursos sin actividad "Evaluación Final" en el gradebook).');
    } else {
      console.log('No hay cursos con todos los participantes en null.');
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
