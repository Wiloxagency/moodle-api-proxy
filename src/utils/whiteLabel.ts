import { Empresa } from '../types/empresa';

/**
 * Dominios propios (no White Label). Cualquier otro host que llegue al
 * frontend se busca entre los dominios White Label registrados.
 * Se puede ampliar con DEFAULT_REPORT_HOSTS=host1,host2 en el .env.
 */
export const DEFAULT_REPORT_HOSTS: string[] = (process.env.DEFAULT_REPORT_HOSTS
  || 'reportes.edutecno.com,clicklaboral.cl')
  .split(',')
  .map(h => normalizeHost(h))
  .filter(Boolean);

/** Versiones de Moodle admitidas para un White Label. */
export const SUPPORTED_MOODLE_VERSIONS = [4, 5] as const;

/** Funciones de Web Services que la app usa. El token debe tenerlas todas. */
export const REQUIRED_WS_FUNCTIONS = [
  'core_webservice_get_site_info',
  'core_course_get_courses_by_field',
  'core_course_get_categories',
  'core_course_get_contents',
  'core_enrol_get_enrolled_users',
  'core_user_get_users',
  'core_user_get_users_by_field',
  'core_user_create_users',
  'core_user_update_users',
  'enrol_manual_enrol_users',
  'gradereport_user_get_grade_items',
  'core_grades_get_grades',
  'mod_quiz_get_quizzes_by_courses',
  'mod_quiz_get_user_best_grade',
  'core_completion_get_course_completion_status',
  'core_completion_get_activities_completion_status',
];

/**
 * "https://Reportes.Cliente.cl:443/login?x=1" -> "reportes.cliente.cl".
 * Devuelve '' si no hay nada utilizable.
 */
export function normalizeHost(raw: unknown): string {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // protocolo
  s = s.split(/[/?#]/)[0];                         // ruta, query, hash
  s = s.replace(/^[^@]*@/, '');                    // credenciales
  s = s.replace(/:\d+$/, '');                      // puerto
  s = s.replace(/\.$/, '');                        // punto final
  return s;
}

/** Quita el "www." para comparar dominios equivalentes. */
export function bareHost(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

export function isDefaultHost(host: string): boolean {
  const h = bareHost(normalizeHost(host));
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  return DEFAULT_REPORT_HOSTS.some(d => bareHost(d) === h);
}

/** "https://campus.cliente.cl/" -> "https://campus.cliente.cl". null si no es una URL http(s). */
export function normalizeMoodleUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** "4.5.2 (Build: 20250210)" -> 4 ; "5.0+ (Build…)" -> 5 ; null si no se reconoce. */
export function moodleMajorFromRelease(release: unknown): number | null {
  const m = String(release ?? '').trim().match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

export function isWhiteLabel(empresa: Partial<Empresa> | null | undefined): boolean {
  return !!empresa && empresa.whiteLabel === true;
}

/**
 * Lo que la API puede devolver de una empresa: sin token ni bytes del logo.
 */
export function toPublicEmpresa<T extends Partial<Empresa>>(empresa: T) {
  const { wlMoodleToken, wlLogo, ...rest } = empresa as any;
  return {
    ...rest,
    wlMoodleTokenSet: typeof wlMoodleToken === 'string' && wlMoodleToken.trim() !== '',
    wlLogoVersion: wlLogo?.updatedAt || null,
  };
}
