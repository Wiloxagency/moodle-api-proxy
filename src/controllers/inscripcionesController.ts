import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import { getInscripcionesCollection, getCountersCollection } from '../db/mongo';
import { Inscripcion } from '../types/inscripcion';

function mapExcelRow(row: Record<string, any>): Inscripcion {
  // Normalize headers by trimming and lowercasing without accents
  const get = (key: string) => row[key] ?? row[key.trim()] ?? '';
  const toNumber = (v: any): number => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const toDateISO = (v: any): string => {
    if (!v) return '';
    if (typeof v === 'number') {
      // Excel serial number
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return '';
      const date = new Date(Date.UTC(d.y, d.m - 1, d.d));
      return date.toISOString();
    }
    const date = new Date(v);
    return isNaN(date.getTime()) ? '' : date.toISOString();
  };

  // Helper to keep numeric codes when possible (otherwise keep trimmed text)
  const toCodeOrText = (v: any): number | string => {
    if (v === undefined || v === null || v === '') return '';
    const raw = String(v).trim();
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    return raw;
  };

  // Map explicit Spanish headers to internal fields
  return {
    numeroInscripcion: toNumber(get('N° Inscripción') || get('Nº Inscripción') || get('N Inscripción') || get('N° Inscripcion') || get('Nº Inscripcion')),
    correlativo: Number(String(get('N° Correlativo') || get('Nº Correlativo') || get('Correlativo') || '0').replace(/[^0-9.-]/g, '')) || 0,
    codigoCurso: String(get('Código del Curso') || get('Codigo del Curso') || get('Código Curso') || get('Codigo Curso') || ''),
    codigoSence: String(get('Código Sence') || get('Codigo Sence') || ''),
    ordenCompra: String(get('Orden de Compra') || ''),
    idSence: String(get('ID Sence') || get('Id Sence') || ''),
    idMoodle: String(get('ID Moodle') || get('Id Moodle') || ''),
    empresa: toNumber(get('Empresa') || get('Cliente') || ''),
    nombreCurso: String(get('Nombre Curso') || ''),
    modalidad: toCodeOrText(get('Modalidad')),
    inicio: toDateISO(get('Inicio')),
    termino: toDateISO(get('Termino') || get('Término')),
    ejecutivo: toCodeOrText(get('Ejecutivo')) as any,
    responsable: String(get('Responsable') || '') || undefined,
    numAlumnosInscritos: toNumber(get('Num Alumnos Inscritos') || get('N° Alumnos Inscritos')),
    valorInicial: toNumber(get('Valor INICIAL') || get('Valor Inicial')),
    valorFinal: toNumber(get('Valor FINAL') || get('Valor Final')),
    statusAlumnos: String(get('Status de Alumnos') || get('Estado Alumnos') || ''),
    comentarios: String(get('Comentarios') || '') || undefined,
  };
}

export class InscripcionesController {
  // GET /api/inscripciones
  async list(req: Request, res: Response) {
    const col = await getInscripcionesCollection();
    const items = await col.find({}).sort({ numeroInscripcion: 1 }).toArray();
    res.json({ success: true, data: items });
  }

  // GET /api/inscripciones/:id
  async getById(req: Request, res: Response): Promise<void> {
    const col = await getInscripcionesCollection();
    const { id } = req.params;
    const item = await col.findOne({ _id: new ObjectId(id) } as any);
    if (!item) {
      res.status(404).json({ success: false, error: { message: 'Not found' } });
      return;
    }
    res.json({ success: true, data: item });
  }

  // POST /api/inscripciones
  async create(req: Request, res: Response) {
    const col = await getInscripcionesCollection();
    const counters = await getCountersCollection();
    const body = req.body as Partial<Inscripcion>;

    const empresaRaw: any = (body as any).empresa;
    const empresaNum = Number(empresaRaw);
    if (empresaRaw === undefined || empresaRaw === null || empresaRaw === '' || !Number.isFinite(empresaNum)) {
      res.status(400).json({ success: false, error: { message: 'Campo obligatorio faltante: empresa' } });
      return;
    }

    // Validaciones mínimas de campos obligatorios
    const required: (keyof Inscripcion)[] = ['idMoodle','correlativo','codigoCurso','inicio','ejecutivo','numAlumnosInscritos','modalidad','statusAlumnos'];
    for (const k of required) {
      const v = (body as any)[k];
      if (v === undefined || v === null || v === '' || (k==='numAlumnosInscritos' && typeof v !== 'number')) {
        res.status(400).json({ success: false, error: { message: `Campo obligatorio faltante: ${String(k)}` } });
        return;
      }
    }

    // Generar secuencia para numeroInscripcion (string), iniciando en 100000 (atómico)
    // Usamos actualización con pipeline para evitar conflicto entre $setOnInsert y $inc en el mismo campo.
    // Lógica: seq = (ifNull(seq, 99999)) + 1
    const seqDoc = await counters.findOneAndUpdate(
      { _id: 'inscripciones' },
      [
        { $set: { seq: { $add: [ { $ifNull: ['$seq', 99999] }, 1 ] } } }
      ] as any,
      { upsert: true, returnDocument: 'after' } as any
    );
    const nextNum = (seqDoc as any)?.seq ?? 100000;

    const toNumericOrText = (value: any): number | string => {
      const n = Number(value);
      return Number.isFinite(n) ? n : String(value);
    };

    const payload: Inscripcion = {
      numeroInscripcion: nextNum,
      correlativo: Number(body.correlativo),
      codigoCurso: String(body.codigoCurso),
      empresa: empresaNum,
      codigoSence: body.codigoSence || undefined,
      ordenCompra: body.ordenCompra || undefined,
      idSence: body.idSence || undefined,
      idMoodle: String(body.idMoodle),
      nombreCurso: body.nombreCurso || undefined,
      modalidad: toNumericOrText(body.modalidad),
      inicio: String(body.inicio),
      termino: body.termino || undefined,
      ejecutivo: toNumericOrText(body.ejecutivo) as any,
      responsable: body.responsable ? String(body.responsable) : undefined,
      numAlumnosInscritos: Number(body.numAlumnosInscritos),
      valorInicial: body.valorInicial === undefined ? undefined : Number(body.valorInicial),
      valorFinal: body.valorFinal === undefined ? undefined : Number(body.valorFinal),
      statusAlumnos: String(body.statusAlumnos),
      comentarios: body.comentarios || undefined,
    };

    const result = await col.insertOne(payload);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  

  // PUT /api/inscripciones/:id
  async update(req: Request, res: Response) {
    const col = await getInscripcionesCollection();
    const { id } = req.params;
    const incoming = req.body as any;
    const { _id, numeroInscripcion, ...rest } = incoming;
    if (rest.empresa !== undefined) {
      const empresaRaw: any = rest.empresa;
      const empresaNum = Number(empresaRaw);
      if (empresaRaw === null || empresaRaw === '' || !Number.isFinite(empresaNum)) {
        res.status(400).json({ success: false, error: { message: 'empresa debe ser numérica' } });
        return;
      }
      rest.empresa = empresaNum;
    }

    if (rest.modalidad !== undefined) {
      const n = Number(rest.modalidad);
      if (Number.isFinite(n)) rest.modalidad = n;
    }
    if (rest.ejecutivo !== undefined) {
      const n = Number(rest.ejecutivo);
      if (Number.isFinite(n)) rest.ejecutivo = n;
    }
    await col.updateOne({ _id: new ObjectId(id) } as any, { $set: rest });
    const updated = await col.findOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true, data: updated });
  }

  

  // DELETE /api/inscripciones/:id
  async remove(req: Request, res: Response) {
    const col = await getInscripcionesCollection();
    const { id } = req.params;
    await col.deleteOne({ _id: new ObjectId(id) } as any);
    res.json({ success: true });
  }

  // POST /api/inscripciones/import
  async importFromExcel(req: Request, res: Response): Promise<void> {
    const { path, sheetName } = req.body as { path: string; sheetName?: string };
    if (!path) {
      res.status(400).json({ success: false, error: { message: 'path is required' } });
      return;
    }

    const workbook = XLSX.readFile(path);
    const wsName = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
    const worksheet = workbook.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

    const mapped: Inscripcion[] = rows.map(mapExcelRow).filter(r => r.numeroInscripcion);

    const col = await getInscripcionesCollection();

    // Upsert by numeroInscripcion to avoid duplicates
    for (const r of mapped) {
      await col.updateOne(
        { numeroInscripcion: r.numeroInscripcion },
        { $set: r },
        { upsert: true }
      );
    }

    const count = await col.countDocuments();
    res.json({ success: true, data: { insertedOrUpdated: mapped.length, total: count } });
  }
}