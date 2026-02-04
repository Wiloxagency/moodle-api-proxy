const XLSX = require('xlsx');

// Leer el archivo Excel
const wb = XLSX.readFile('C:\\Users\\Owner\\Downloads\\Carga 03-02-2026 2.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log('Total de filas:', rows.length);
console.log('\nPrimera fila de datos:');
console.log(JSON.stringify(rows[0], null, 2));

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

// Procesar y agrupar por ficha
const inscripcionesMap = new Map();
let currentNumeroInscripcion = 100100;

rows.forEach((row, index) => {
  const ficha = normalizeValue(row.Ficha);
  
  if (!ficha) {
    console.warn(`Fila ${index + 2}: Ficha vacía, omitiendo`);
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
        codigoCurso: normalizeValue(row['Código Sence']),
        empresa: normalizeValue(row.Empresa) || 'Mutual',
        codigoSence: normalizeValue(row['Código Sence']),
        ordenCompra: normalizeValue(row['Orden de Compra']),
        idSence: normalizeValue(row['ID Sence']),
        idMoodle: normalizeValue(row['ID  Moodle']),
        nombreCurso: normalizeValue(row.Curso),
        modalidad: modalidad,
        inicio: typeof row['F. Inicio'] === 'number' ? excelDateToISO(row['F. Inicio']) : new Date().toISOString(),
        termino: typeof row['F. Termino'] === 'number' ? excelDateToISO(row['F. Termino']) : undefined,
        ejecutivo: normalizeValue(row.Ejecutivo),
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

// Convertir el mapa a array con números de inscripción secuenciales
const inscripciones = Array.from(inscripcionesMap.values()).map((inscEntry, index) => {
  const numeroInscripcion = currentNumeroInscripcion + index;
  
  return {
    numeroInscripcion,
    ficha: `${inscEntry.ficha}+${inscEntry.fichaCount}`,
    ...inscEntry.inscripcionData,
    numAlumnosInscritos: inscEntry.participantes.length,
    participantes: inscEntry.participantes
  };
});

console.log(`\n✓ Total de inscripciones generadas: ${inscripciones.length}`);
console.log(`✓ Total de participantes: ${inscripciones.reduce((sum, i) => sum + i.participantes.length, 0)}`);
console.log(`✓ Rango de números de inscripción: ${inscripciones[0].numeroInscripcion} - ${inscripciones[inscripciones.length - 1].numeroInscripcion}`);

console.log('\nPrimeras 3 inscripciones generadas:');
inscripciones.slice(0, 3).forEach((insc, i) => {
  console.log(`\n--- Inscripción ${i + 1} ---`);
  console.log(`Número: ${insc.numeroInscripcion}`);
  console.log(`Ficha: ${insc.ficha}`);
  console.log(`Empresa: ${insc.empresa}`);
  console.log(`Curso: ${insc.nombreCurso}`);
  console.log(`Modalidad: ${insc.modalidad}`);
  console.log(`Ejecutivo: ${insc.ejecutivo}`);
  console.log(`Participantes: ${insc.numAlumnosInscritos}`);
  console.log('Primer participante:', JSON.stringify(insc.participantes[0], null, 2));
});

// Guardar resultado en archivo JSON para inspección
const fs = require('fs');
fs.writeFileSync('C:\\Users\\Owner\\Desktop\\11-18-2025 github\\moodle-dashboard-app-master\\inscripciones-procesadas.json', JSON.stringify(inscripciones, null, 2));
console.log('\n✓ Resultado guardado en: inscripciones-procesadas.json');
