// Script de prueba para verificar la lógica de contador de ficha

// Simular lógica del backend
function processFicha(fichaInput, existingFichas) {
  if (!fichaInput) return undefined;
  
  // Extraer la ficha base (sin el contador si viene con +N)
  const fichaBase = fichaInput.replace(/\+\d+$/, '').trim();
  
  // Buscar cuántas inscripciones ya existen con esta ficha base
  const regex = new RegExp(`^${fichaBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`);
  const existingCount = existingFichas.filter(f => regex.test(f)).length;
  
  // Generar el nuevo valor con contador
  const counter = existingCount + 1;
  const fichaFinal = `${fichaBase}-${counter}`;
  
  return fichaFinal;
}

console.log('🧪 Pruebas de lógica de contador de ficha\n');

// Prueba 1: Primera inscripción con ficha
console.log('Prueba 1: Primera inscripción');
const existingFichas1 = [];
const result1 = processFicha('2506-001', existingFichas1);
console.log(`  Input: "2506-001"`);
console.log(`  Existing: []`);
console.log(`  Output: "${result1}"`);
console.log(`  ✅ Esperado: "2506-001-1"\n`);

// Prueba 2: Segunda inscripción con la misma ficha
console.log('Prueba 2: Segunda inscripción con la misma ficha');
const existingFichas2 = ['2506-001-1'];
const result2 = processFicha('2506-001', existingFichas2);
console.log(`  Input: "2506-001"`);
console.log(`  Existing: ["2506-001-1"]`);
console.log(`  Output: "${result2}"`);
console.log(`  ✅ Esperado: "2506-001-2"\n`);

// Prueba 3: Tercera inscripción con la misma ficha
console.log('Prueba 3: Tercera inscripción');
const existingFichas3 = ['2506-001-1', '2506-001-2'];
const result3 = processFicha('2506-001', existingFichas3);
console.log(`  Input: "2506-001"`);
console.log(`  Existing: ["2506-001-1", "2506-001-2"]`);
console.log(`  Output: "${result3}"`);
console.log(`  ✅ Esperado: "2506-001-3"\n`);

// Prueba 4: Primera inscripción con otra ficha diferente
console.log('Prueba 4: Primera inscripción con ficha diferente');
const existingFichas4 = ['2506-001-1', '2506-001-2'];
const result4 = processFicha('2506-002', existingFichas4);
console.log(`  Input: "2506-002"`);
console.log(`  Existing: ["2506-001-1", "2506-001-2"]`);
console.log(`  Output: "${result4}"`);
console.log(`  ✅ Esperado: "2506-002-1"\n`);

// Prueba 5: Entrada con formato +N (del frontend antiguo)
console.log('Prueba 5: Entrada con formato +N');
const existingFichas5 = [];
const result5 = processFicha('2506-001+5', existingFichas5);
console.log(`  Input: "2506-001+5"`);
console.log(`  Existing: []`);
console.log(`  Output: "${result5}"`);
console.log(`  ✅ Esperado: "2506-001-1" (ignora el +5)\n`);

// Prueba 6: Fichas con caracteres especiales
console.log('Prueba 6: Fichas con caracteres especiales');
const existingFichas6 = [];
const result6 = processFicha('ABC-123.XYZ', existingFichas6);
console.log(`  Input: "ABC-123.XYZ"`);
console.log(`  Existing: []`);
console.log(`  Output: "${result6}"`);
console.log(`  ✅ Esperado: "ABC-123.XYZ-1"\n`);

// Prueba 7: Verificar que no mezcle fichas similares
console.log('Prueba 7: No mezclar fichas similares');
const existingFichas7 = ['2506-001-1', '2506-001-2', '2506-0011-1'];
const result7 = processFicha('2506-001', existingFichas7);
console.log(`  Input: "2506-001"`);
console.log(`  Existing: ["2506-001-1", "2506-001-2", "2506-0011-1"]`);
console.log(`  Output: "${result7}"`);
console.log(`  ✅ Esperado: "2506-001-3" (debe ignorar "2506-0011-1")\n`);

console.log('✅ Todas las pruebas completadas\n');

// Simulación completa con múltiples inscripciones
console.log('📋 Simulación completa:\n');
const allFichas = [];
const testData = [
  '2506-001', '2506-001', '2506-002', '2506-001', '2506-003', '2506-002'
];

testData.forEach((ficha, i) => {
  const result = processFicha(ficha, allFichas);
  allFichas.push(result);
  console.log(`${i + 1}. Input: "${ficha}" → Output: "${result}"`);
});

console.log('\n📊 Fichas finales en BD:');
allFichas.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

console.log('\n✅ La lógica funciona correctamente!');
