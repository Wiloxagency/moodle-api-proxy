const XLSX = require('xlsx');

// Leer el archivo Excel
const wb = XLSX.readFile('C:\\Users\\Owner\\Downloads\\Carga 03-02-2026 2.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log('🏢 Análisis de Empresas en el Excel\n');

// Normalizar valores
const normalizeValue = (value) => {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
    return '';
  }
  return String(value).trim();
};

// Recopilar empresas únicas
const empresasSet = new Set();
const empresasCounts = new Map();

rows.forEach((row) => {
  const empresa = normalizeValue(row.Empresa);
  if (empresa) {
    empresasSet.add(empresa);
    empresasCounts.set(empresa, (empresasCounts.get(empresa) || 0) + 1);
  }
});

console.log(`📊 Total de empresas únicas: ${empresasSet.size}`);
console.log(`📊 Total de registros: ${rows.length}\n`);

console.log('📋 Empresas que se crearán (si no existen):\n');

let counter = 1;
for (const [empresa, count] of empresasCounts) {
  console.log(`${counter}. "${empresa}"`);
  console.log(`   Aparece en: ${count} registros`);
  console.log(`   → Se creará como: {`);
  console.log(`        code: [auto-generado],`);
  console.log(`        nombre: "${empresa}",`);
  console.log(`        status: "Activo"`);
  console.log(`        // Otros campos: vacíos`);
  console.log(`      }\n`);
  counter++;
}

console.log('✅ Proceso de creación de empresas:');
console.log('1. Se obtiene la lista de empresas existentes en BD');
console.log('2. Se compara con las empresas del Excel');
console.log('3. Se crean solo las empresas que NO existen');
console.log('4. Las empresas duplicadas se omiten automáticamente\n');

console.log('📤 Ejemplo de payload que se enviará a POST /api/empresas:');
const primeraEmpresa = Array.from(empresasSet)[0];
console.log(JSON.stringify({
  nombre: primeraEmpresa,
  status: "Activo"
}, null, 2));

console.log('\n💾 En la base de datos se guardará como:');
console.log(JSON.stringify({
  _id: "[ObjectId generado]",
  code: "[número auto-generado, ej: 1]",
  nombre: primeraEmpresa,
  holding: undefined,
  rut: undefined,
  nombre_responsable: undefined,
  email_responsable: undefined,
  telefono_1: undefined,
  telefono_2: undefined,
  email_empresa: undefined,
  status: "Activo"
}, null, 2));

console.log('\n🔄 Flujo completo de importación:');
console.log('1. ✓ Crear empresas (si no existen)');
console.log('2. ✓ Crear inscripciones');
console.log('3. ✓ Crear participantes');
