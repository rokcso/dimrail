export type Route =
  | { kind: 'root' }
  | { kind: 'api'; path: string }
  | { kind: 'config'; id: string }
  | { kind: 'provider'; configId: string; id: string }
  | { kind: 'pool'; configId: string; id: string }
  | { kind: 'assets' }
  | { kind: 'notFound' };

const CONFIG_PATH = /^\/sub\/([A-Za-z0-9_-]{1,32})$/;
const PROVIDER_PATH = /^\/sub\/([A-Za-z0-9_-]{1,32})\/providers\/(airports|pools)\/([^/]+)$/;

/**
 * 纯路径解析，不碰 env 与网络，方便单测。
 * 顺序有意义：/api、/sub 归 Worker，其余（/admin、静态资源）交给 assets。
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { kind: 'root' };
  if (path === '/api' || path.startsWith('/api/')) return { kind: 'api', path };

  if (path === '/sub' || path.startsWith('/sub/')) {
    const config = CONFIG_PATH.exec(path);
    if (config?.[1]) return { kind: 'config', id: config[1] };

    const provider = PROVIDER_PATH.exec(path);
    if (provider?.[1] && provider[2] && provider[3]) {
      const configId = provider[1];
      const id = decode(provider[3]);
      if (!id) return { kind: 'notFound' };
      return provider[2] === 'pools'
        ? { kind: 'pool', configId, id }
        : { kind: 'provider', configId, id };
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
