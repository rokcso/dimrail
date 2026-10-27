export type Route =
  | { kind: 'root' }
  | { kind: 'api'; path: string }
  | { kind: 'config'; id: string }
  | { kind: 'provider'; name: string }
  | { kind: 'assets' }
  | { kind: 'notFound' };

const CONFIG_PATH = /^\/p\/([A-Za-z0-9_-]{1,32})$/;
const PROVIDER_PATH = /^\/providers\/([^/]+)$/;

/**
 * 纯路径解析，不碰 env 与网络，方便单测。
 * 顺序有意义：/api 与 /p、/providers 归 Worker，其余（/admin、静态资源）交给 assets。
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { kind: 'root' };
  if (path === '/api' || path.startsWith('/api/')) return { kind: 'api', path };

  if (path === '/p' || path.startsWith('/p/')) {
    const match = CONFIG_PATH.exec(path);
    return match?.[1] ? { kind: 'config', id: match[1] } : { kind: 'notFound' };
  }

  if (path === '/providers' || path.startsWith('/providers/')) {
    const match = PROVIDER_PATH.exec(path);
    if (!match?.[1]) return { kind: 'notFound' };
    try {
      return { kind: 'provider', name: decodeURIComponent(match[1]) };
    } catch {
      return { kind: 'notFound' };
    }
  }

  return { kind: 'assets' };
}
