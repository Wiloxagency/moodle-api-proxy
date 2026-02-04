const XLSX = require('xlsx');

// Simular el proceso completo del componente frontend

// Función para normalizar valores
const normalizeValue = (value) => {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
    return '';
  }
  return String(value).trim();
};

// Función para convertir fecha serial de Excel a ISO
const excelDateToISO = (serial) => {
  if (!serial || serial === 0) return '';
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  return dateInfo.toISOString();
};

// Leer el archivo Excel
const wb = XLSX.readFile('C:\\Users\\Owner\\Downloads\\Carga 03-02-2026 2.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log('📊 Procesando Excel con', rows.length, 'filas...\n');

// Procesar y agrupar por ficha
const inscripcionesMap = new Map();

rows.forEach((row, index) => {
  const ficha = normalizeValue(row.Ficha);
  
  if (!ficha) {
    console.warn(`⚠ Fila ${index + 2}: Ficha vacía, omitiendo`);
    return;
  }

  // Crear el participante
  const participante = {
    nombres: normalizeValue(row.Nombres),
    apellidos: normalizeValue(row.Apellidos),
    rut: normalizeValue(row.RUT),
    mail: normalizeValue(row['Correo electrónico']),
    telefono: normalizeValue(row['Télefono']),
    valorCobrado: row['Valor Cobrado'] && row['Valor Cobrado'] !== 0 ? Number(row['Valor Cobrado']) : undefined,
    franquiciaPorcentaje: row['%Franquicia'] && row['%Franquicia'] !== 0 ? Number(row['%Franquicia']) * 100 : undefined,
    costoOtic: null,
    costoEmpresa: null,
    estadoInscripcion: normalizeValue(row.Observaciones),
    observacion: normalizeValue(row.Observaciones),
  };

  // Si la ficha no existe, crear nueva inscripción
  if (!inscripcionesMap.has(ficha)) {
    const modalidadRaw = normalizeValue(row.Modalidad).toLowerCase();
    let modalidad = 'e-learning';
    if (modalidadRaw.includes('asincr') || modalidadRaw.includes('async')) {
      modalidad = 'e-learning';
    } else if (modalidadRaw.includes('sincrón') || (modalidadRaw.includes('sincr') && !modalidadRaw.includes('asincr'))) {
      modalidad = 'sincrónico';
    }

    inscripcionesMap.set(ficha, {
      ficha,
      fichaCount: 0,
      participantes: [],
      inscripcionData: {
        correlativo: row.Correlativo ? Number(row.Correlativo) : 0,
        codigoCurso: normalizeValue(row['Código Sence']) || 'N/A',
        empresa: normalizeValue(row.Empresa) || 'Mutual',
        codigoSence: normalizeValue(row['Código Sence']),
        ordenCompra: normalizeValue(row['Orden de Compra']),
        idSence: normalizeValue(row['ID Sence']),
        idMoodle: normalizeValue(row['ID  Moodle']) || '0',
        nombreCurso: normalizeValue(row.Curso),
        modalidad: modalidad,
        inicio: typeof row['F. Inicio'] === 'number' ? excelDateToISO(row['F. Inicio']) : new Date().toISOString(),
        termino: typeof row['F. Termino'] === 'number' ? excelDateToISO(row['F. Termino']) : undefined,
        ejecutivo: normalizeValue(row.Ejecutivo) || 'N/A',
        numAlumnosInscritos: 0,
        statusAlumnos: 'Pendiente',
      }
    });
  }

  // Incrementar contador y agregar participante
  const inscripcionEntry = inscripcionesMap.get(ficha);
  inscripcionEntry.fichaCount++;
  inscripcionEntry.participantes.push(participante);
});

// Convertir el mapa a array (NO enviamos numeroInscripcion, lo genera el backend)
const inscripciones = Array.from(inscripcionesMap.values()).map((inscEntry) => {
  return {
    ficha: `${inscEntry.ficha}+${inscEntry.fichaCount}`,
    ...inscEntry.inscripcionData,
    numAlumnosInscritos: inscEntry.participantes.length,
    participantes: inscEntry.participantes
  };
});

console.log(`✅ Total de inscripciones a crear: ${inscripciones.length}`);
console.log(`✅ Total de participantes: ${inscripciones.reduce((sum, i) => sum + i.participantes.length, 0)}`);

// Validar que todas las inscripciones tengan los campos obligatorios
console.log('\n🔍 Validando campos obligatorios...\n');
const required = ['idMoodle', 'correlativo', 'codigoCurso', 'inicio', 'ejecutivo', 'numAlumnosInscritos', 'modalidad', 'statusAlumnos'];
let validationErrors = 0;

inscripciones.slice(0, 5).forEach((insc, i) => {
  console.log(`Inscripción ${i + 1} (${insc.ficha}):`);
  required.forEach(field => {
    const value = insc[field];
    const isValid = value !== undefined && value !== null && value !== '' && (field !== 'numAlumnosInscritos' || typeof value === 'number');
    console.log(`  ${field}: ${isValid ? '✅' : '❌'} (${JSON.stringify(value)})`);
    if (!isValid) validationErrors++;
  });
  console.log('');
});

if (validationErrors > 0) {
  console.error(`❌ Se encontraron ${validationErrors} errores de validación`);
} else {
  console.log('✅ Todas las inscripciones tienen los campos obligatorios\n');
}

// Mostrar estructura de la primera inscripción
console.log('📋 Estructura de la primera inscripción a enviar:\n');
console.log(JSON.stringify({
  ...inscripciones[0],
  participantes: [inscripciones[0].participantes[0]] // Solo el primer participante
}, null, 2));

// Guardar resultado completo
const fs = require('fs');
fs.writeFileSync(
  'C:\\Users\\Owner\\Desktop\\11-18-2025 github\\moodle-api-proxy-master\\inscripciones-para-envio.json',
  JSON.stringify(inscripciones, null, 2)
);
console.log('\n💾 Datos preparados guardados en: inscripciones-para-envio.json');

// Resumen de lo que se enviará al backend
console.log('\n📤 Resumen del proceso de envío al backend:');
console.log('1. Se crearán', inscripciones.length, 'inscripciones usando POST /api/inscripciones');
console.log('2. El backend generará automáticamente el numeroInscripcion comenzando desde 100100');
console.log('3. Para cada inscripción creada, se crearán sus participantes usando POST /api/participantes');
console.log('4. Los participantes tendrán el numeroInscripcion de su inscripción correspondiente');
console.log('5. El backend generará automáticamente el campo rutKey para cada participante\n');
