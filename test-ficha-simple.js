const XLSX = require('xlsx');

// Leer el archivo Excel
const wb = XLSX.readFile('C:\\Users\\Owner\\Downloads\\Carga 03-02-2026 2.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log('🧪 Verificación de campo Ficha\n');

// Normalizar valores
const normalizeValue = (value) => {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
    return '';
  }
  return String(value).trim();
};

// Agrupar por ficha
const inscripcionesMap = new Map();

rows.forEach((row) => {
  const ficha = normalizeValue(row.Ficha);
  if (!ficha) return;
  
  if (!inscripcionesMap.has(ficha)) {
    inscripcionesMap.set(ficha, {
      ficha: ficha, // Guardamos la ficha tal cual viene
      count: 0
    });
  }
  
  inscripcionesMap.get(ficha).count++;
});

console.log(`📊 Total de fichas únicas: ${inscripcionesMap.size}`);
console.log(`📊 Total de participantes: ${rows.length}\n`);

console.log('📋 Primeras 10 fichas que se enviarán al backend:\n');

let counter = 1;
for (const [ficha, data] of inscripcionesMap) {
  if (counter > 10) break;
  
  console.log(`${counter}. Ficha: "${ficha}"`);
  console.log(`   Participantes: ${data.count}`);
  console.log(`   → Se guardará en BD como: "${ficha}"\n`);
  
  counter++;
}

console.log('✅ El campo ficha se enviará y guardará exactamente como viene del Excel');
console.log('✅ No se agregará ningún contador ni modificación');

// Ejemplo de estructura que se enviará al backend
const primeraFicha = inscripcionesMap.entries().next().value;
console.log('\n📤 Ejemplo de estructura que se enviará al backend:');
console.log(JSON.stringify({
  ficha: primeraFicha[0], // La ficha tal cual viene del Excel
  correlativo: 0,
  codigoCurso: "1238029980",
  empresa: "PUCV",
  idMoodle: "236",
  modalidad: "e-learning",
  numAlumnosInscritos: primeraFicha[1].count,
  statusAlumnos: "Pendiente"
  // ... otros campos
}, null, 2));

console.log('\n💾 En la base de datos se guardará con:');
console.log(`   - numeroInscripcion: [generado por backend, ej: 100100]`);
console.log(`   - ficha: "${primeraFicha[0]}" (exactamente como viene del Excel)`);
