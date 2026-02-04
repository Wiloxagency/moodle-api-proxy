const XLSX = require('xlsx');

console.log('🔍 Verificación de Correcciones\n');

// Leer el archivo Excel
const wb = XLSX.readFile('C:\\Users\\Owner\\Downloads\\Carga 03-02-2026 2.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

// Normalizar valores
const normalizeValue = (value) => {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
    return '';
  }
  return String(value).trim();
};

console.log('📋 Verificación de campos corregidos:\n');

// Tomar primeras 5 filas como ejemplo
const ejemplos = rows.slice(0, 5);

ejemplos.forEach((row, i) => {
  console.log(`Ejemplo ${i + 1}:`);
  console.log(`  Ficha: ${normalizeValue(row.Ficha)}`);
  console.log(`  Empresa (nombre): ${normalizeValue(row.Empresa)}`);
  console.log(`  ID Moodle: ${normalizeValue(row['ID  Moodle'])}`);
  console.log(`  Código Sence: ${normalizeValue(row['Código Sence'])}`);
  console.log('');
  console.log('  ✅ CORRECCIÓN 1: codigoCurso ahora será igual a ID Moodle');
  console.log(`     codigoCurso: "${normalizeValue(row['ID  Moodle'])}" (antes era Código Sence)`);
  console.log('');
  console.log('  ✅ CORRECCIÓN 2: empresa será el code, no el nombre');
  console.log(`     empresa: [code de "${normalizeValue(row.Empresa)}"] (se obtendrá del backend)`);
  console.log('');
  console.log('  📤 Payload que se enviará:');
  console.log(JSON.stringify({
    ficha: normalizeValue(row.Ficha),
    correlativo: 0,
    codigoCurso: normalizeValue(row['ID  Moodle']) || '0', // ← Corregido
    empresa: '[CODE]', // ← Se reemplazará con el code de la empresa
    codigoSence: normalizeValue(row['Código Sence']),
    idMoodle: normalizeValue(row['ID  Moodle']) || '0',
    nombreCurso: normalizeValue(row.Curso),
    modalidad: 'e-learning',
    ejecutivo: normalizeValue(row.Ejecutivo) || 'N/A',
    numAlumnosInscritos: 1,
    statusAlumnos: 'Pendiente'
  }, null, 2));
  console.log('\n' + '='.repeat(80) + '\n');
});

console.log('🔄 Proceso de conversión de empresa:\n');
console.log('1. Se extraen todas las empresas únicas del Excel');
console.log('2. Se crean las empresas que no existen (con auto-generación de code)');
console.log('3. Se obtiene lista completa de empresas con sus codes');
console.log('4. Se crea un mapa: nombre -> code');
console.log('5. Antes de crear cada inscripción, se reemplaza el nombre por el code\n');

console.log('Ejemplo de mapa empresas:');
console.log(JSON.stringify({
  "PUCV": 1,
  "Banco Itaú": 2,
  "UC CHRISTUS": 3,
  "Mutual": 4,
  // ... resto de empresas
}, null, 2));

console.log('\n✅ Con estas correcciones:');
console.log('  - codigoCurso = idMoodle (ambos tendrán el mismo valor)');
console.log('  - empresa = code numérico de la empresa (ej: 1, 2, 3...)');
