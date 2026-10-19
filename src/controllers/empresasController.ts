import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getEmpresasCollection, getUsersCollection } from '../db/mongo';
import { Empresa, EmpresaLogo } from '../types/empresa';
import { MoodleService } from '../services/moodleService';
import { findWhiteLabelByHost, invalidateTenantCache } from '../services/moodleTenant';
import {
  REQUIRED_WS_FUNCTIONS,
  SUPPORTED_MOODLE_VERSIONS,
  bareHost,
  isDefaultHost,
  isWhiteLabel,
  moodleMajorFromRelease,
  normalizeHost,
  normalizeMoodleUrl,
  toPublicEmpresa,
} from '../utils/whiteLabel';

/** Empresa que usa VMICA (Mutual de Seguridad): no puede ser White Label. */
const VMICA_EMPRESA_CODE = 1;
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

async function getNextCode(): Promise<number> {
  const col = await getEmpresasCollection();
  const last = await col.find({}).sort({ code: -1 }).limit(1).toArray();
  if (!last.length) return 1;
  return (last[0].code || 0) + 1;
}

class ValidationError extends Error {}

/** Campos que nunca se escriben desde el cliente tal cual. */
function stripClientOnly(body: any): any {
  const {
    _id, code, wlMoodleTokenSet, wlLogoVersion,
    whiteLabel, wlDominio, wlMoodleUrl, wlMoodleToken, wlMoodleVersion, wlLogo,
    ...rest
  } = body || {};
  return rest;
}

/** "data:image/png;base64,AAAA" -> EmpresaLogo. Lanza ValidationError si no sirve. */
function parseLogo(raw: unknown): EmpresaLogo {
  const m = String(raw || '').match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new ValidationError('El logo debe ser una imagen PNG, JPG o WEBP');
  const mime = m[1].toLowerCase();
  if (!LOGO_MIMES.includes(mime)) throw new ValidationError('El logo debe ser PNG, JPG o WEBP');
  const data = m[2].replace(/\s+/g, '');
  const bytes = Buffer.from(data, 'base64').length;
  if (!bytes) throw new ValidationError('El logo está vacío');
  if (bytes > LOGO_MAX_BYTES) throw new ValidationError('El logo no puede superar 512 KB');
  return { mime, data, updatedAt: new Date().toISOString() };
}

/**
 * Valida y arma los campos White Label a guardar.
 * `existing` es la empresa actual (undefined al crear).
 */
async function buildWhiteLabelFields(body: any, existing?: Empresa): Promise<Partial<Empresa>> {
  const wantsWl = body?.whiteLabel === undefined ? isWhiteLabel(existing) : body.whiteLabel === true;
  const code = existing?.code;
  const users = await getUsersCollection();

  if (!wantsWl) {
    // Al desactivar se conserva la configuración (por si se vuelve a activar),
    // pero no puede quedar ningún Administrador: ese rol sólo existe en White Label.
    if (existing && isWhiteLabel(existing)) {
      const admins = await users.countDocuments({ empresa: code, role: 'admin' } as any);
      if (admins > 0) {
        throw new ValidationError(
          `La empresa tiene ${admins} usuario(s) Administrador. Cámbielos a User antes de quitar White Label`
        );
      }
    }
    return { whiteLabel: false };
  }

  if (code === VMICA_EMPRESA_CODE) {
    throw new ValidationError('La empresa 1 reporta a VMICA y no puede ser White Label');
  }
  if (code !== undefined) {
    const supers = await users.countDocuments({ empresa: code, role: 'superAdmin' } as any);
    if (supers > 0) {
      throw new ValidationError(
        `Hay ${supers} Superadmin asociado(s) a esta empresa. Los White Label no admiten superusuarios: cámbielos de empresa antes`
      );
    }
  }

  const dominio = normalizeHost(body?.wlDominio ?? existing?.wlDominio);
  if (!dominio || !dominio.includes('.')) throw new ValidationError('El dominio del reporte es obligatorio (ej. reportes.cliente.cl)');
  if (isDefaultHost(dominio)) throw new ValidationError(`El dominio ${dominio} es de la plataforma principal y no puede ser White Label`);

  const col = await getEmpresasCollection();
  const others = await col.find({ whiteLabel: true } as any).toArray();
  const clash = others.find(e => e.code !== code && bareHost(normalizeHost(e.wlDominio)) === bareHost(dominio));
  if (clash) throw new ValidationError(`El dominio ${dominio} ya está asignado a la empresa "${clash.nombre}"`);

  const moodleUrl = normalizeMoodleUrl(body?.wlMoodleUrl ?? existing?.wlMoodleUrl);
  if (!moodleUrl) throw new ValidationError('La URL de Moodle es obligatoria y debe empezar por https://');

  const newToken = typeof body?.wlMoodleToken === 'string' ? body.wlMoodleToken.trim() : '';
  const token = newToken || (existing?.wlMoodleToken || '').trim();
  if (!token) throw new ValidationError('El token de Moodle es obligatorio');

  const version = Number(body?.wlMoodleVersion ?? existing?.wlMoodleVersion);
  if (!(SUPPORTED_MOODLE_VERSIONS as readonly number[]).includes(version)) {
    throw new ValidationError('Sólo se admiten Moodle versión 4 o 5');
  }

  let logo = existing?.wlLogo;
  if (typeof body?.wlLogo === 'string' && body.wlLogo.trim() !== '') logo = parseLogo(body.wlLogo);
  if (!logo) throw new ValidationError('El logo de la empresa es obligatorio');

  return {
    whiteLabel: true,
    wlDominio: dominio,
    wlMoodleUrl: moodleUrl,
    wlMoodleToken: token,
    wlMoodleVersion: version as 4 | 5,
    wlLogo: logo,
  };
}

function sendValidation(res: Response, e: unknown): boolean {
  if (e instanceof ValidationError) {
    res.status(400).json({ success: false, error: { message: e.message } });
    return true;
  }
  return false;
}

export class EmpresasController {
  async list(_req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const items = await col.find({}).sort({ code: 1 }).toArray();
    res.json({ success: true, data: items.map(toPublicEmpresa) });
  }

  async create(req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const rest = stripClientOnly(req.body);
    const code = await getNextCode();
    let wl: Partial<Empresa>;
    try {
      // Se valida como si ya tuviera su código, para aplicar la regla de la empresa 1.
      wl = await buildWhiteLabelFields(req.body, { code, nombre: rest.nombre, status: rest.status } as Empresa);
    } catch (e) {
      if (sendValidation(res, e)) return;
      throw e;
    }
    const doc: Empresa = { code, ...rest, ...wl };
    const result = await col.insertOne(doc);
    invalidateTenantCache();
    const created = await col.findOne({ _id: result.insertedId } as any);
    res.status(201).json({ success: true, data: created ? toPublicEmpresa(created) : null });
  }

  async update(req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) {
      res.status(400).json({ success: false, error: { message: 'ID inválido' } });
      return;
    }
    const _id = new ObjectId(id);
    const existing = await col.findOne({ _id } as any);
    if (!existing) {
      res.status(404).json({ success: false, error: { message: 'Empresa no encontrada' } });
      return;
    }
    const rest = stripClientOnly(req.body);
    let wl: Partial<Empresa>;
    try {
      wl = await buildWhiteLabelFields(req.body, existing);
    } catch (e) {
      if (sendValidation(res, e)) return;
      throw e;
    }
    await col.updateOne({ _id } as any, { $set: { ...rest, ...wl } });
    invalidateTenantCache();
    const updated = await col.findOne({ _id } as any);
    res.json({ success: true, data: updated ? toPublicEmpresa(updated) : null });
  }

  async remove(req: Request, res: Response): Promise<void> {
    const col = await getEmpresasCollection();
    const { id } = req.params as { id: string };
    await col.deleteOne({ _id: new ObjectId(id) } as any);
    invalidateTenantCache();
    res.json({ success: true });
  }

  // GET /api/empresas/:code/logo
  async logo(req: Request, res: Response): Promise<void> {
    const code = Number((req.params as any).code);
    const col = await getEmpresasCollection();
    const empresa = Number.isFinite(code) ? await col.findOne({ code } as any) : null;
    const logo = empresa?.wlLogo;
    if (!logo?.data) {
      res.status(404).json({ success: false, error: { message: 'Logo no encontrado' } });
      return;
    }
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // El frontend en desarrollo corre en otro puerto (otro origen).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(Buffer.from(logo.data, 'base64'));
  }

  // GET /api/empresas/whitelabel?host=reportes.cliente.cl
  // Público: el frontend lo llama al arrancar para saber si es un White Label.
  async resolveWhiteLabel(req: Request, res: Response): Promise<void> {
    const host = (req.query as any).host || req.get('x-forwarded-host') || req.get('host');
    const empresa = await findWhiteLabelByHost(host);
    if (!empresa) {
      res.json({ success: true, data: { whiteLabel: false } });
      return;
    }
    res.json({
      success: true,
      data: {
        whiteLabel: true,
        empresa: empresa.code,
        nombre: empresa.nombre,
        dominio: empresa.wlDominio,
        logoVersion: empresa.wlLogo?.updatedAt || null,
      },
    });
  }

  // POST /api/empresas/moodle/test { url, token?, empresaId?, version? }
  // Comprueba la conexión, la versión y que el token tenga todas las funciones.
  // Si no llega token y sí empresaId, usa el token guardado (que el cliente no conoce).
  async testMoodle(req: Request, res: Response): Promise<void> {
    const { url, token, empresaId, version } = (req.body || {}) as Record<string, any>;
    const baseUrl = normalizeMoodleUrl(url);
    if (!baseUrl) {
      res.status(400).json({ success: false, error: { message: 'URL de Moodle inválida' } });
      return;
    }
    let wsToken = typeof token === 'string' ? token.trim() : '';
    if (!wsToken && empresaId && ObjectId.isValid(String(empresaId))) {
      const col = await getEmpresasCollection();
      const existing = await col.findOne({ _id: new ObjectId(String(empresaId)) } as any);
      wsToken = (existing?.wlMoodleToken || '').trim();
    }
    if (!wsToken) {
      res.status(400).json({ success: false, error: { message: 'Falta el token de Moodle' } });
      return;
    }

    const svc = new MoodleService({ baseUrl, wsToken });
    const info = await svc.healthCheck();
    if (!info.success) {
      res.json({
        success: true,
        data: { ok: false, message: `No se pudo conectar: ${info.error?.message || 'error desconocido'}` },
      });
      return;
    }
    const site = info.data || {};
    const major = moodleMajorFromRelease(site.release);
    const supported = major !== null && (SUPPORTED_MOODLE_VERSIONS as readonly number[]).includes(major);
    const available = new Set<string>((site.functions || []).map((f: any) => f?.name).filter(Boolean));
    const missingFunctions = REQUIRED_WS_FUNCTIONS.filter(f => !available.has(f));
    const declared = Number(version);
    const versionMatches = !declared || major === declared;

    const problems: string[] = [];
    if (!supported) problems.push(`Moodle ${site.release || '(versión desconocida)'} no está soportado: sólo 4 o 5`);
    else if (!versionMatches) problems.push(`La versión indicada (${declared}) no coincide con la del sitio (${major})`);
    if (missingFunctions.length) problems.push(`Al servicio del token le faltan ${missingFunctions.length} función(es)`);

    res.json({
      success: true,
      data: {
        ok: problems.length === 0,
        message: problems.length ? problems.join('. ') : 'Conexión correcta',
        sitename: site.sitename,
        release: site.release,
        major,
        supported,
        missingFunctions,
      },
    });
  }
}
