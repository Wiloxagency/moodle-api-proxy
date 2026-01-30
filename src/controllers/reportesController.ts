import { Request, Response } from 'express';
import { getGradesReportsCollection, getInscripcionesCollection, getParticipantesCollection } from '../db/mongo';

interface ReporteAvanceRow {
  empresa: string;
  nombreCurso: string;
  idSence: string;
  rut: string;
  nombres: string;
  apellidos: string;
  email: string;
  fechaInicio: string;
  fechaFinal: string;
  notaFinal: number | null;
  porcentajeAvance: number | null;
  porcentajeAsistencia: number | null;
  fechaReporte: string;
  correlativo: number | null;
  responsable: string;
}

export class ReportesController {
  async getReporteAvances(_req: Request, res: Response): Promise<void> {
    const [insCol, partCol, gradesCol] = await Promise.all([
      getInscripcionesCollection(),
      getParticipantesCollection(),
      getGradesReportsCollection(),
    ]);

    const inscripciones = await insCol.find({}).toArray();
    const reportDate = new Date().toISOString();

    if (!inscripciones.length) {
      res.json({ success: true, data: [], generatedAt: reportDate });
      return;
    }

    const numerosSet = new Set<any>();
    for (const ins of inscripciones) {
      const n = (ins as any).numeroInscripcion;
      if (n === null || n === undefined) continue;
      numerosSet.add(n);
      const asNum = Number(n);
      if (!Number.isNaN(asNum)) numerosSet.add(asNum);
      numerosSet.add(String(n));
    }
    const numeros = Array.from(numerosSet);

    const [participantes, grades] = await Promise.all([
      partCol.find({ numeroInscripcion: { $in: numeros } }).toArray(),
      gradesCol.find({ numeroInscripcion: { $in: numeros } }).toArray(),
    ]);

    const inscripcionesMap = new Map<string, any>();
    for (const ins of inscripciones) {
      const key = String((ins as any).numeroInscripcion ?? '');
      if (key) inscripcionesMap.set(key, ins);
    }

    const participantesPorInscripcion = new Map<string, any[]>();
    for (const p of participantes) {
      const key = String((p as any).numeroInscripcion ?? '');
      if (!key) continue;
      const arr = participantesPorInscripcion.get(key) || [];
      arr.push(p);
      participantesPorInscripcion.set(key, arr);
    }

    const gradesPorInscripcion = new Map<string, Map<string, any>>();
    for (const g of grades) {
      const rut = String((g as any).RutAlumno || '').trim();
      if (!rut) continue; // Ignorar documentos legacy sin RutAlumno
      const key = String((g as any).numeroInscripcion ?? '');
      if (!key) continue;
      const rutKey = rut.toLowerCase();
      const map = gradesPorInscripcion.get(key) || new Map<string, any>();
      map.set(rutKey, g);
      gradesPorInscripcion.set(key, map);
    }

    const rows: ReporteAvanceRow[] = [];
    for (const [key, ins] of inscripcionesMap.entries()) {
      const parts = participantesPorInscripcion.get(key) || [];
      if (!parts.length) continue;
      const gradesMap = gradesPorInscripcion.get(key);

      for (const p of parts) {
        const rut = String((p as any).rut || '').trim();
        const grade = rut ? gradesMap?.get(rut.toLowerCase()) : undefined;
        rows.push({
          empresa: String((ins as any).empresa || ''),
          nombreCurso: String((ins as any).nombreCurso || ''),
          idSence: String((ins as any).idSence || ''),
          rut,
          nombres: String((p as any).nombres || ''),
          apellidos: String((p as any).apellidos || ''),
          email: String((p as any).mail || ''),
          fechaInicio: String((ins as any).inicio || ''),
          fechaFinal: String((ins as any).termino || ''),
          notaFinal: grade?.NotaFinal ?? null,
          porcentajeAvance: grade?.PorcentajeAvance ?? null,
          porcentajeAsistencia: grade?.PorcentajeAsistenciaAlumno ?? null,
          fechaReporte: reportDate,
          correlativo: (ins as any).correlativo ?? null,
          responsable: String((ins as any).responsable || ''),
        });
      }
    }

    res.json({ success: true, data: rows, generatedAt: reportDate });
  }
}
