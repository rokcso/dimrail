export type Route =
  | { kind: 'root' }
  | { kind: 'api'; path: string }
  | { kind: 'config'; id: string }
  | { kind: 'provider'; id: string }
  | { kind: 'pool'; id: string }
  | { kind: 'assets' }
  | { kind: 'notFound' };

const CONFIG_PATH = /^\/sub\/([A-Za-z0-9_-]{1,32})$/;
const AIRPORT_PROVIDER_PATH = /^\/providers\/airports\/([^/]+)$/;
const POOL_PROVIDER_PATH = /^\/providers\/pools\/([^/]+)$/;

/**
 * 纯路径解析，不碰 env 与网络，方便单测。
 * 顺序有意义：/api、/sub、/providers 归 Worker，其余（/admin、静态资源）交给 assets。
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { kind: 'root' };
  if (path === '/api' || path.startsWith('/api/')) return { kind: 'api', path };

  if (path === '/sub' || path.startsWith('/sub/')) {
    const match = CONFIG_PATH.exec(path);
    return match?.[1] ? { kind: 'config', id: match[1] } : { kind: 'notFound' };
  }

  if (path === '/providers' || path.startsWith('/providers/')) {
    const airport = AIRPORT_PROVIDER_PATH.exec(path);
    if (airport?.[1]) {
      const id = decode(airport[1]);
      return id ? { kind: 'provider', id } : { kind: 'notFound' };
    }

    const pool = POOL_PROVIDER_PATH.exec(path);
    if (pool?.[1]) {
      const id = decode(pool[1]);
      return id ? { kind: 'pool', id } : { kind: 'notFound' };
    }

    return { kind: 'notFound' };
  }

  return { kind: 'assets' };
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
