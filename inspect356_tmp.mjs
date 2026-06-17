// READ-ONLY investigation script for course 356. No writes.
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

const ENV_PATH = '/sessions/laughing-busy-hypatia/mnt/cl-moodle-reports/moodle-api-proxy/.env';
dotenv.config({ path: ENV_PATH });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
const COL = {
  ins: process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones',
  part: process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes',
  grades: process.env.MONGODB_GRADES_REPORTS_COLLECTION || 'grades_reports',
};

const TARGET = '356';

function num(v){ const n=Number(String(v).replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)?n:null; }

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  console.log('DB:', dbName, '| collections:', COL);

  const insCol = db.collection(COL.ins);
  const partCol = db.collection(COL.part);
  const gradesCol = db.collection(COL.grades);

  // 1) Find inscripciones linked to Moodle course 356 (idMoodle or codigoCurso)
  const insMatches = await insCol.find({
    $or: [
      { idMoodle: TARGET },
      { idMoodle: { $regex: `(^|[^0-9])${TARGET}([^0-9]|$)` } },
      { codigoCurso: { $regex: `(^|[^0-9])${TARGET}([^0-9]|$)` } },
    ]
  }).toArray();

  console.log(`\n=== Inscripciones que referencian curso ${TARGET}: ${insMatches.length} ===`);
  for (const ins of insMatches) {
    console.log(JSON.stringify({
      _id: ins._id,
      numeroInscripcion: ins.numeroInscripcion,
      typeofNumero: typeof ins.numeroInscripcion,
      correlativo: ins.correlativo,
      idMoodle: ins.idMoodle,
      codigoCurso: ins.codigoCurso,
      empresa: ins.empresa,
      nombreCurso: ins.nombreCurso,
      status: ins.status,
      status_vimica: ins.status_vimica,
      inicio: ins.inicio,
      termino: ins.termino,
      numAlumnosInscritos: ins.numAlumnosInscritos,
    }, null, 2));
  }

  if (!insMatches.length) {
    // Broad scan in case idMoodle stored differently
    console.log('\nNo se encontró por idMoodle/codigoCurso. Buscando "356" en cualquier campo string...');
    const sample = await insCol.find({}).limit(3).toArray();
    console.log('Ejemplo de documento inscripcion (estructura):', JSON.stringify(sample[0], null, 2));
    const anyHas356 = await insCol.find({ $where: function(){ return JSON.stringify(this).includes('356'); } }).toArray().catch(()=>[]);
    console.log('Docs que contienen "356" en algún lado:', anyHas356.length);
    for (const d of anyHas356.slice(0,10)) {
      console.log('  ->', JSON.stringify({_id:d._id, num:d.numeroInscripcion, idMoodle:d.idMoodle, codigoCurso:d.codigoCurso, nombreCurso:d.nombreCurso}));
    }
  }

  // 2) For each matching inscripcion check participantes & grades
  for (const ins of insMatches) {
    const n = ins.numeroInscripcion;
    const byNumero = { numeroInscripcion: { $in: [n, Number(n), String(n)] } };
    const parts = await partCol.find(byNumero).toArray();
    const grades = await gradesCol.find(byNumero).toArray();
    console.log(`\n--- Inscripción ${n} (idMoodle=${ins.idMoodle}) ---`);
    console.log(`participantes: ${parts.length}`);
    console.log(`grades_reports docs: ${grades.length}`);
    if (parts.length) {
      console.log('participantes muestra:', parts.slice(0,5).map(p=>({rut:p.rut, nombres:p.nombres, apellidos:p.apellidos})));
    }
    if (grades.length) {
      console.log('grades muestra:', grades.slice(0,8).map(g=>({
        RutAlumno:g.RutAlumno, IdCurso:g.IdCurso, scope:g.scope,
        Avance:g.PorcentajeAvance, Asist:g.PorcentajeAsistenciaAlumno,
        NotaFinal:g.NotaFinal, NotaDiag:g.NotaDiagnostica, UltAcceso:g.UltimoAcceso
      })));
      const allNull = grades.filter(g=>g.RutAlumno && g.scope!=='legacy').every(g => g.PorcentajeAvance==null && g.PorcentajeAsistenciaAlumno==null && g.NotaFinal==null);
      console.log('Todos los grades sin datos (null avance/asist/nota)?', allNull);
    }
    // Cross-check rut matching between participantes and grades (report joins by lowercased rut)
    if (parts.length && grades.length) {
      const gRuts = new Set(grades.filter(g=>g.RutAlumno).map(g=>String(g.RutAlumno).trim().toLowerCase()));
      const pRuts = parts.map(p=>String(p.rut||'').trim().toLowerCase());
      const matched = pRuts.filter(r=>gRuts.has(r));
      console.log(`Cruce rut participante↔grade: ${matched.length}/${pRuts.length} coinciden`);
      const unmatched = pRuts.filter(r=>!gRuts.has(r)).slice(0,5);
      if (unmatched.length) console.log('  ruts participante sin grade:', unmatched, '| ruts en grades:', [...gRuts].slice(0,5));
    }
  }

  // 3) Also check grades_reports by IdCurso=356 directly (independent of inscripcion link)
  const gradesByCourse = await gradesCol.find({ IdCurso: { $in: [TARGET, Number(TARGET)] } }).toArray();
  console.log(`\n=== grades_reports con IdCurso=${TARGET}: ${gradesByCourse.length} ===`);
  if (gradesByCourse.length) {
    console.log('numeroInscripcion presentes:', [...new Set(gradesByCourse.map(g=>g.numeroInscripcion))]);
  }

} catch (e) {
  console.error('ERROR:', e.message);
} finally {
  await client.close();
}
