import { Request, Response } from 'express';
import axios from 'axios';
import { getGradesReportsCollection, getInscripcionesCollection, getParticipantesCollection, getVimicaCollection } from '../db/mongo';

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


interface VimicaPayload {
  Usuario: string;
  Token: string;
  AvanceCursos: Array<{
    IdCurso: string;
    RutAlumno: string;
    PorcentajeAvance: string;
    PorcentajeAsistenciaAlumno: string;
    NotaTeorica: string;
    EstadoTeorica: string;
    NotaPractica: string;
    EstadoPractica: string;
    NotaFinal: string;
    EstadoCurso: string;
    Observacion: string;
  }>;
}


interface VimicaResponse {
  Id: number;
  Fecha: string;
  CantidadRegistros: number;
  RegistrosCargados: number;
  RegistrosRechazados: number;
  RegistrosLeidos: number;
}

const VIMICA_ENDPOINT = 'https://api.integracionproveedores.com/post/avancecurso';

async function buildVimicaPayload(): Promise<VimicaPayload> {
  const usuario = 'edutecno';
  const token = 'ZWR1dGVjbm9fMTAvMDYvMjAxOSAxMjozODowMQ==';
  const empresaCode = 1;

  const [insCol, gradesCol] = await Promise.all([
    getInscripcionesCollection(),
    getGradesReportsCollection(),
  ]);

  const inscripciones = await insCol.find({ empresa: empresaCode } as any).toArray();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openIns = inscripciones.filter((ins: any) => {
    const status = String(ins?.status_vimica || '').trim().toLowerCase();
    return status !== 'cerrada';
  });

  const insByNumero = new Map<number, { correlativo?: number; termino?: string; inicio?: string }>();
  const numerosSet = new Set<any>();
  for (const ins of openIns) {
    const num = Number((ins as any).numeroInscripcion);
    if (!Number.isFinite(num)) continue;
    insByNumero.set(num, { correlativo: (ins as any).correlativo, termino: (ins as any).termino, inicio: (ins as any).inicio });
    numerosSet.add(num);
    numerosSet.add(String(num));
  }
  const numeros = Array.from(numerosSet);

  const grades = numeros.length
    ? await gradesCol.find({ numeroInscripcion: { $in: numeros } } as any).toArray()
    : [];

  const toNum = (v: any): number => {
    if (v === undefined || v === null || v === '') return 0;
    const normalized = String(v).replace(',', '.');
    const n = Number(normalized.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const parseDateOnly = (value?: string): Date | null => {
    if (!value) return null;
    const datePart = value.substring(0, 10);
    const [y, m, d] = datePart.split('-');
    if (y && m && d) {
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      date.setHours(0, 0, 0, 0);
      return date;
    }
    const fallback = new Date(value);
    if (isNaN(fallback.getTime())) return null;
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  };

  const calcPorcentajeAvance = (inicio?: string, termino?: string) => {
    const start = parseDateOnly(inicio);
    const end = parseDateOnly(termino);
    if (!start || !end) return 1;
    const todayDate = new Date(today);
    todayDate.setHours(0, 0, 0, 0);
    if (todayDate.getTime() <= start.getTime()) return 1;
    if (todayDate.getTime() >= end.getTime()) return 100;
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const elapsedDays = Math.max(0, Math.round((todayDate.getTime() - start.getTime()) / 86400000));
    const pct = 1 + Math.floor((elapsedDays * 99) / totalDays);
    return Math.min(100, Math.max(1, pct));
  };

  const avanceCursos: VimicaPayload['AvanceCursos'] = [];
  for (const g of grades) {
    const numero = Number((g as any).numeroInscripcion);
    if (!Number.isFinite(numero)) continue;
    const ins = insByNumero.get(numero);
    if (!ins) continue;

    const rutRaw = String((g as any).RutAlumno || '').trim();
    const rutClean = rutRaw.split('-')[0].replace(/[^0-9]/g, '');

    const porcentajeAvanceNum = calcPorcentajeAvance(ins.inicio, ins.termino);
    const porcentajeAsistencia = (g as any).PorcentajeAsistenciaAlumno;
    const notaFinalVal = (g as any).NotaFinal;
    const notaFinalNum = toNum(notaFinalVal);

    const termino = ins.termino ? parseDateOnly(ins.termino) : null;
    const cursoFinalizado = termino ? termino.getTime() <= today.getTime() : false;
    const aprobado = notaFinalNum >= 5;

    let estadoCurso = '0';
    let observacion = '';

    if (aprobado) {
      estadoCurso = '1';
      observacion = 'Alumno Aprobado';
    } else if (cursoFinalizado) {
      estadoCurso = '2';
      observacion = 'Alumno Reprobado';
    } else if (porcentajeAvanceNum <= 1) {
      observacion = 'Curso iniciado sin observación';
    }

    avanceCursos.push({
      IdCurso: String(ins.correlativo ?? ''),
      RutAlumno: rutClean,
      PorcentajeAvance: String(porcentajeAvanceNum),
      PorcentajeAsistenciaAlumno: porcentajeAsistencia == null ? '' : String(porcentajeAsistencia),
      NotaTeorica: '0',
      EstadoTeorica: '0',
      NotaPractica: '0',
      EstadoPractica: '0',
      NotaFinal: notaFinalVal == null ? '' : String(notaFinalVal),
      EstadoCurso: estadoCurso,
      Observacion: observacion,
    });
  }

  return {
    Usuario: usuario,
    Token: token,
    AvanceCursos: avanceCursos,
  };
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

  async getReporteVimica(_req: Request, res: Response): Promise<void> {
    const payload = await buildVimicaPayload();
    res.json(payload);
  }

  async cerrarVimicaProcesadas(_req: Request, res: Response): Promise<void> {
    const col = await getInscripcionesCollection();
    const result = await col.updateMany(
      { empresa: 1, status: { $in: ['cerrada', 'CERRADA', 'Cerrada'] }, status_vimica: { $ne: 'cerrada' } } as any,
      { $set: { status_vimica: 'cerrada' } }
    );
    res.json({ success: true, data: { matched: result.matchedCount, modified: result.modifiedCount } });
  }

  async postEnviarVimica(req: Request, res: Response): Promise<void> {
    try {
      const hasBody = req.body && Object.keys(req.body).length > 0;
      const payload = (hasBody ? req.body : await buildVimicaPayload()) as VimicaPayload;
      console.log("Enviando reporte Vimica: ",  payload);
      const response = await axios.post(VIMICA_ENDPOINT, payload, {
        headers: { 'Content-Type': 'application/json' },
        maxBodyLength: Infinity,
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        res.status(response.status).json({
          success: false,
          error: {
            message: `Upstream error (${response.status})`,
            details: response.data
          }
        });
        return;
      }

      const data = response.data as VimicaResponse;
      const vimicaCol = await getVimicaCollection();
      await vimicaCol.insertOne({
        datosEnviados: payload,
        Id: data?.Id,
        Fecha: data?.Fecha,
        CantidadRegistros: data?.CantidadRegistros,
        RegistrosCargados: data?.RegistrosCargados,
        RegistrosRechazados: data?.RegistrosRechazados,
        RegistrosLeidos: data?.RegistrosLeidos,
      });

      res.json({ success: true, data });
    } catch (error: any) {
      const status = axios.isAxiosError(error) ? (error.response?.status || 502) : 502;
      const message = axios.isAxiosError(error)
        ? (error.response?.data?.message || error.message)
        : (error?.message || 'Error enviando reporte Vimica');
      res.status(status).json({ success: false, error: { message } });
    }
}
}
