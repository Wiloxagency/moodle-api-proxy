import { findEmpresa } from '../services/moodleTenant';
import { isWhiteLabel } from './whiteLabel';

/**
 * Catálogos (Sence, Modalidades, Ejecutivos) por empresa.
 *
 * Los registros de siempre no tienen campo `empresa`: son los globales de la
 * plataforma principal. Los de un White Label llevan `empresa: <code>` y sólo
 * los ve ese White Label. Así la plataforma principal no ve los catálogos de
 * los White Label ni al revés.
 *
 * Devuelve el código si `raw` es una empresa White Label; si no, null (global).
 */
export async function resolveCatalogScope(raw: unknown): Promise<number | null> {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const empresa = await findEmpresa(raw);
  return empresa && isWhiteLabel(empresa) ? Number(empresa.code) : null;
}

/** Filtro Mongo del ámbito. `$exists` (y no `null`) para que un upsert no escriba `empresa: null`. */
export function catalogScopeFilter(scope: number | null): Record<string, unknown> {
  return scope === null ? { empresa: { $exists: false } } : { empresa: scope };
}
