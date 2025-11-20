import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import { getInscripcionesCollection } from '../db/mongo';
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

  // Map explicit Spanish headers to internal fields
  return {
    numeroInscripcion: String(get('N° Inscripción') || get('Nº Inscripción') || get('N Inscripción') || get('N° Inscripcion') || get('Nº Inscripcion')),
    codigoSence: String(get('Código Sence') || get('Codigo Sence') || ''),
    ordenCompra: String(get('Orden de Compra') || ''),
    idSence: String(get('ID Sence') || get('Id Sence') || ''),
    idMoodle: String(get('ID Moodle') || get('Id Moodle') || ''),
    cliente: String(get('Cliente') || ''),
    nombreCurso: String(get('Nombre Curso') || ''),
    modalidad: String(get('Modalidad') || ''),
    inicio: toDateISO(get('Inicio')),
    termino: toDateISO(get('Termino') || get('Término')),
    ejecutivo: String(get('Ejecutivo') || ''),
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
    const payload = req.body as Inscripcion;
    const result = await col.insertOne(payload);
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created });
  }

  // PUT /api/inscripciones/:id
  async update(req: Request, res: Response) {
    const col = await getInscripcionesCollection();
    const { id } = req.params;
    const payload = req.body as Partial<Inscripcion>;
    await col.updateOne({ _id: new ObjectId(id) } as any, { $set: payload });
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
