/**
 * Diagnóstico SOLO-LECTURA de las inscripciones y sus participantes en Mongo.
 *
 * Responde a tres preguntas:
 *   1. ¿Hay mezcla de tipos en numeroInscripcion (número vs texto)?
 *   2. ¿Cuántas inscripciones están marcadas 'cerrada' pero con fecha de término
 *      futura? Esas salen como activas en el dashboard pero quedan fuera del
 *      cron (dashboard_actualizar_todo.sh filtra status != cerrada), así que sus
 *      notas no se regeneran nunca.
 *   3. ¿Cuántos participantes tiene cada empresa y cuántos quedan fuera del cron?
 *
 * No escribe nada.
 *
 * Uso:  node diagnostico-inscripciones.mjs [--empresa=12]
 */
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB_NAME || 'moodle_dashboard';
if (!MONGO_URI) {
  console.error('Falta MONGODB_URI en el .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (n) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=')[1] : '';
};
const EMPRESA = flag('empresa').trim();

const { MongoClient } = await import('mongodb');
const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(DB_NAME);
const insCol = db.collection(process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones');
const partCol = db.collection(process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes');
const empCol = db.collection(process.env.MONGODB_EMPRESAS_COLLECTION || 'empresas');

const inscripciones = await insCol.find({}).toArray();
const empresas = await empCol.find({}).toArray();
const nombreEmpresa = new Map(empresas.map((e) => [Number(e.codigo ?? e.code ?? e.empresa), String(e.nombre || e.razonSocial || '')]));

const hoy = new Date().toISOString().slice(0, 10);
const esCerrada = (i) => String(i.status || '').trim().toLowerCase() === 'cerrada';
const terminoISO = (i) => String(i.termino || '').slice(0, 10);
const vigentePorFecha = (i) => terminoISO(i) === '' || terminoISO(i) >= hoy;

console.log('='.repeat(78));
console.log(` INSCRIPCIONES — ${inscripciones.length} en total   (hoy: ${hoy})`);
console.log('='.repeat(78));

// --- 1) tipos de numeroInscripcion -------------------------------------------
const tipoIns = {};
for (const i of inscripciones) tipoIns[typeof i.numeroInscripcion] = (tipoIns[typeof i.numeroInscripcion] || 0) + 1;

const tipoPart = {};
for await (const p of partCol.find({}, { projection: { numeroInscripcion: 1 } })) {
  tipoPart[typeof p.numeroInscripcion] = (tipoPart[typeof p.numeroInscripcion] || 0) + 1;
}

console.log('\n[1] Tipo del campo numeroInscripcion');
console.log('    inscripciones:', JSON.stringify(tipoIns));
console.log('    participantes:', JSON.stringify(tipoPart));
if (Object.keys(tipoIns).length > 1 || Object.keys(tipoPart).length > 1) {
  console.log('    ⚠️  HAY MEZCLA DE TIPOS: las lecturas deben usar $or con número y texto.');
} else {
  console.log('    OK: un solo tipo en cada colección.');
}

// --- 2) estados vs fechas ----------------------------------------------------
const porStatus = {};
for (const i of inscripciones) {
  const s = i.status === undefined || i.status === null || i.status === '' ? '(sin status)' : String(i.status);
  porStatus[s] = (porStatus[s] || 0) + 1;
}
console.log('\n[2] Inscripciones por status');
for (const [s, n] of Object.entries(porStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  ${s}`);
}

const cerradasVigentes = inscripciones.filter((i) => esCerrada(i) && vigentePorFecha(i));
console.log(`\n    marcadas 'cerrada' pero con término futuro: ${cerradasVigentes.length}`);
console.log("    (el dashboard las muestra como activas; el cron NO las actualiza)");
if (cerradasVigentes.length) {
  console.log('    ejemplos:');
  for (const i of cerradasVigentes.slice(0, 12)) {
    console.log(
      `      ${String(i.numeroInscripcion).padEnd(8)} empresa=${String(i.empresa).padEnd(5)} termino=${terminoISO(i)}  ${String(i.nombreCurso || '').slice(0, 40)}`
    );
  }
  if (cerradasVigentes.length > 12) console.log(`      ... y ${cerradasVigentes.length - 12} más`);
}

// --- 3) participantes por empresa y cobertura del cron ------------------------
const contarParticipantes = async (ins) => {
  const num = Number(ins.numeroInscripcion);
  const or = [{ numeroInscripcion: ins.numeroInscripcion }, { numeroInscripcion: String(ins.numeroInscripcion) }];
  if (Number.isFinite(num)) or.push({ numeroInscripcion: num });
  return partCol.countDocuments({ $or: or });
};

const objetivo = EMPRESA
  ? inscripciones.filter((i) => String(i.empresa) === String(EMPRESA))
  : inscripciones;

const resumen = new Map(); // empresa -> { total, enCron, fueraCron, insTotal, insFuera }
for (const ins of objetivo) {
  if (!vigentePorFecha(ins)) continue; // sólo cursos vigentes, como el dashboard
  const n = await contarParticipantes(ins);
  const emp = Number(ins.empresa);
  const r = resumen.get(emp) || { total: 0, enCron: 0, fueraCron: 0, insTotal: 0, insFuera: 0 };
  r.total += n;
  r.insTotal += 1;
  if (esCerrada(ins)) {
    r.fueraCron += n;
    r.insFuera += 1;
  } else {
    r.enCron += n;
  }
  resumen.set(emp, r);
}

console.log('\n[3] Participantes en cursos VIGENTES (término futuro), por empresa');
console.log('    empresa                         inscr.  particip.  en cron  FUERA del cron');
const filas = [...resumen.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [emp, r] of filas) {
  const nom = (nombreEmpresa.get(emp) || `código ${emp}`).slice(0, 28);
  console.log(
    `    ${nom.padEnd(30)} ${String(r.insTotal).padStart(6)} ${String(r.total).padStart(10)} ${String(r.enCron).padStart(8)} ${String(r.fueraCron).padStart(15)}`
  );
}

const totFuera = filas.reduce((a, [, r]) => a + r.fueraCron, 0);
const totTodos = filas.reduce((a, [, r]) => a + r.total, 0);
console.log(`\n    TOTAL: ${totTodos} participantes en cursos vigentes | ${totFuera} fuera del cron (${totTodos ? Math.round((totFuera / totTodos) * 100) : 0}%)`);

// --- 4) fechas de término ausentes -------------------------------------------
// Sin `termino` la inscripción no se cierra nunca (ni el cron ni el botón del
// dashboard lo hacen) y, en el payload de VMICA, calcPorcentajeAvance devuelve
// siempre 1 y el curso nunca se marca como finalizado.
const sinTermino = inscripciones.filter((i) => String(i.termino || '').trim() === '');
console.log('\n[4] Inscripciones sin fecha de término');
console.log(`    total: ${sinTermino.length}`);
if (sinTermino.length) {
  for (const i of sinTermino.slice(0, 15)) {
    console.log(
      `      ${String(i.numeroInscripcion).padEnd(8)} empresa=${String(i.empresa).padEnd(5)} status=${String(i.status || '(sin status)').padEnd(10)} ${String(i.nombreCurso || '').slice(0, 40)}`
    );
  }
  if (sinTermino.length > 15) console.log(`      ... y ${sinTermino.length - 15} más`);
}

// --- 5) VMICA (empresa 1) ----------------------------------------------------
// El payload de VMICA filtra por status_vimica, NO por status. Se listan aquí
// las dos marcas por separado para poder comprobar que nada las descuadra.
const vimica = inscripciones.filter((i) => Number(i.empresa) === 1);
const marca = (v) => String(v || '').trim().toLowerCase();
const enPayload = vimica.filter((i) => marca(i.status_vimica) !== 'cerrada');
const cerradaSinVimica = vimica.filter((i) => marca(i.status) === 'cerrada' && marca(i.status_vimica) !== 'cerrada');
console.log('\n[5] VMICA — inscripciones de empresa 1');
console.log(`    total empresa 1:                        ${vimica.length}`);
console.log(`    entran hoy en el payload (status_vimica != cerrada): ${enPayload.length}`);
console.log(`    status=cerrada pero status_vimica != cerrada:        ${cerradaSinVimica.length}`);
console.log(`    sin fecha de término:                   ${vimica.filter((i) => String(i.termino || '').trim() === '').length}`);
console.log("    (el payload NO depende de 'status', sólo de 'status_vimica')");

await client.close();
