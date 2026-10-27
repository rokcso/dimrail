export type AdminRoute =
  | { name: 'configs'; id: string | null }
  | { name: 'airports'; id: string | null }
  | { name: 'groups'; id: string | null }
  | { name: 'settings'; section: 'base' | 'overview' };

const ID = '([A-Za-z0-9_-]{1,32})';
const CONFIGS = new RegExp(`^/admin/configs(?:/${ID})?$`);
const AIRPORTS = new RegExp(`^/admin/airports(?:/${ID})?$`);
const GROUPS = new RegExp(`^/admin/groups(?:/${ID})?$`);
const SETTINGS = /^\/admin\/settings(?:\/(base|overview))?$/;

export const ADMIN_HOME = '/admin/configs';
export const SETTINGS_HOME = '/admin/settings/base';

/** 只放行已知路径，未知地址回到配置列表。 */
export function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/' || path === '/admin') return ADMIN_HOME;
  if (CONFIGS.test(path) || AIRPORTS.test(path) || GROUPS.test(path)) return path;
  if (path === '/admin/settings' || path === '/admin/settings/base') return SETTINGS_HOME;
  if (path === '/admin/settings/overview') return path;

  return ADMIN_HOME;
}

export function parseAdminPath(path: string): AdminRoute {
  const config = CONFIGS.exec(path);
  if (config) return { name: 'configs', id: config[1] ?? null };

  const airport = AIRPORTS.exec(path);
  if (airport) return { name: 'airports', id: airport[1] ?? null };

  const group = GROUPS.exec(path);
  if (group) return { name: 'groups', id: group[1] ?? null };

  const settings = SETTINGS.exec(path);
  if (settings) {
    return { name: 'settings', section: settings[1] === 'overview' ? 'overview' : 'base' };
  }

  return { name: 'configs', id: null };
}
