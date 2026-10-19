import { getEmpresasCollection } from '../db/mongo';
import { Empresa } from '../types/empresa';
import { MoodleService } from './moodleService';
import { bareHost, isDefaultHost, isWhiteLabel, normalizeHost } from '../utils/whiteLabel';

/**
 * Qué Moodle usar para cada empresa.
 *
 * - Empresas normales (Edutecno, Click Laboral, sus clientes): el Moodle por
 *   defecto del .env.
 * - Empresas White Label: SU Moodle (wlMoodleUrl + wlMoodleToken).
 *
 * Una empresa White Label sin configuración completa NUNCA cae al Moodle por
 * defecto: se lanza un error. Caer en silencio mezclaría alumnos de dos
 * plataformas distintas en el mismo reporte.
 */

export class TenantConfigError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'TenantConfigError';
  }
}

const CACHE_TTL_MS = 30_000;
let empresasCache: { at: number; items: Empresa[] } | null = null;
const servicesByKey = new Map<string, MoodleService>();
let defaultService: MoodleService | null = null;

async function loadEmpresas(): Promise<Empresa[]> {
  if (empresasCache && Date.now() - empresasCache.at < CACHE_TTL_MS) return empresasCache.items;
  const col = await getEmpresasCollection();
  const items = (await col.find({}).toArray()) as Empresa[];
  empresasCache = { at: Date.now(), items };
  return items;
}

/** Llamar después de crear/editar/borrar empresas. */
export function invalidateTenantCache(): void {
  empresasCache = null;
}

export function getDefaultMoodle(): MoodleService {
  if (!defaultService) defaultService = new MoodleService();
  return defaultService;
}

/** Reutiliza la instancia por conexión, para que las cachés por curso sobrevivan entre peticiones. */
function serviceFor(empresa: Empresa): MoodleService {
  if (!isWhiteLabel(empresa)) return getDefaultMoodle();
  const url = (empresa.wlMoodleUrl || '').trim();
  const token = (empresa.wlMoodleToken || '').trim();
  if (!url || !token) {
    throw new TenantConfigError(
      `La empresa White Label "${empresa.nombre}" no tiene configurados la URL y el token de Moodle`
    );
  }
  const key = `${url}|${token}`;
  let svc = servicesByKey.get(key);
  if (!svc) {
    svc = new MoodleService({ baseUrl: url, wsToken: token, version: empresa.wlMoodleVersion });
    servicesByKey.set(key, svc);
  }
  return svc;
}

/**
 * Las inscripciones guardan la empresa como código numérico, pero algunas
 * antiguas (importadas de Excel) la tienen como nombre. Se aceptan ambas,
 * igual que en dashboardController.normalizeEmpresa.
 */
export async function findEmpresa(ref: unknown): Promise<Empresa | null> {
  if (ref === undefined || ref === null || String(ref).trim() === '') return null;
  const items = await loadEmpresas();
  const raw = String(ref).trim();
  const num = Number(raw);
  if (Number.isFinite(num)) {
    const byCode = items.find(e => Number(e.code) === num);
    if (byCode) return byCode;
  }
  const lower = raw.toLowerCase();
  return items.find(e => String(e.nombre || '').trim().toLowerCase() === lower) || null;
}

/** Moodle de una empresa (código o nombre). Sin empresa -> Moodle por defecto. */
export async function getMoodleForEmpresa(ref: unknown): Promise<MoodleService> {
  const empresa = await findEmpresa(ref);
  if (!empresa) return getDefaultMoodle();
  return serviceFor(empresa);
}

/** Moodle de la empresa dueña de una inscripción. */
export async function getMoodleForInscripcion(ins: { empresa?: unknown } | null | undefined): Promise<MoodleService> {
  return getMoodleForEmpresa(ins?.empresa);
}

/** Empresa White Label cuyo dominio coincide con el host, o null. */
export async function findWhiteLabelByHost(host: unknown): Promise<Empresa | null> {
  const h = normalizeHost(host);
  if (!h || isDefaultHost(h)) return null;
  const items = await loadEmpresas();
  return items.find(e => isWhiteLabel(e) && bareHost(normalizeHost(e.wlDominio)) === bareHost(h)) || null;
}

/** Códigos de todas las empresas White Label. */
export async function getWhiteLabelCodes(): Promise<Set<number>> {
  const items = await loadEmpresas();
  return new Set(items.filter(isWhiteLabel).map(e => Number(e.code)));
}
