import { type ConfigResponse, configPayloadSchema, type SaveResponse } from '../shared/schema';
import { checkAdmin, timingSafeEqual } from './auth';
import { loadConfig, saveConfig } from './config-store';
import type { Bindings } from './env';
import { aggregatedUserinfo, buildProvidersYaml, parseProviders, relayProvider } from './provider';
import { validateConfig } from './validate';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname.startsWith('/api/')) return handleApi(request, env, pathname);
    if (pathname === '/providers' || pathname.startsWith('/providers/')) {
      return handleProvider(env, url, pathname);
    }
    if (pathname === '/') return handleRoot(request, env, url);
    return serveAssets(request, env);
  },
} satisfies ExportedHandler<Bindings>;

/* ---------------- 订阅 ---------------- */

async function handleRoot(request: Request, env: Bindings, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return redirect('/admin');

  const expected = env.ACCESS_TOKEN?.trim() ?? '';
  if (!expected) return text('未配置 ACCESS_TOKEN', 503);
  if (!timingSafeEqual(token, expected)) return text('订阅链接无效', 401);

  let providers: Record<string, string>;
  try {
    providers = parseProviders(env);
  } catch (err) {
    return text(`配置错误：${(err as Error).message}`, 500);
  }

  const names = Object.keys(providers);
  let template: string;
  try {
    template = (await loadConfig(env)).yaml;
  } catch (err) {
    return text(`读取配置失败：${(err as Error).message}`, 500);
  }

  const body = [
    '# Dimrail',
    `# 机场: ${names.join(', ')}`,
    template
      .replaceAll('  # __PROXY_PROVIDERS__', buildProvidersYaml(providers, url.origin, token))
      .replaceAll('__PROVIDER_NAMES__', names.join(', ')),
  ].join('\n');

  const headers: Record<string, string> = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    ETag: `W/"${fnv1a(body)}"`,
    'Profile-Update-Interval': '10800',
  };

  const userinfo = await aggregatedUserinfo(env);
  if (userinfo) headers['Subscription-Userinfo'] = userinfo;

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

async function handleProvider(env: Bindings, url: URL, pathname: string): Promise<Response> {
  const match = /^\/providers\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return text('Not found', 404);

  const expected = env.ACCESS_TOKEN?.trim() ?? '';
  if (!expected) return text('未配置 ACCESS_TOKEN', 503);
  if (!timingSafeEqual(url.searchParams.get('token') ?? '', expected)) {
    return text('订阅链接无效', 401);
  }

  return relayProvider(decodeURIComponent(match[1]), env);
}

/* ---------------- 配置 API ---------------- */

async function handleApi(request: Request, env: Bindings, pathname: string): Promise<Response> {
  if (pathname !== '/api/config') return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const admin = checkAdmin(request, env);
  if (!admin.ok) return json({ error: admin.message }, admin.status);

  if (request.method === 'GET') {
    try {
      const loaded = await loadConfig(env);
      return json({
        yaml: loaded.yaml,
        updatedAt: loaded.updatedAt,
        seeded: loaded.seeded,
      } satisfies ConfigResponse);
    } catch (err) {
      return json({ error: `读取失败：${(err as Error).message}` }, 500);
    }
  }

  const payload = configPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return json({ error: '请求格式错误' }, 400);

  const result = validateConfig(payload.data.yaml);
  if (!result.ok) return json({ error: result.error }, 400);

  try {
    const updatedAt = await saveConfig(env, payload.data.yaml);
    return json({ updatedAt, notices: result.notices } satisfies SaveResponse);
  } catch (err) {
    return json({ error: `保存失败：${(err as Error).message}` }, 500);
  }
}

/* ---------------- 静态资源 ---------------- */

async function serveAssets(request: Request, env: Bindings): Promise<Response> {
  if (!env.ASSETS) return text('前端尚未构建：先执行 npm run build', 503);
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  if (!headers.has('Cache-Control')) {
    headers.set(
      'Cache-Control',
      request.url.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  }
  if (new URL(request.url).pathname.startsWith('/admin')) {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return new Response(response.body, { status: response.status, headers });
}

/* ---------------- 工具 ---------------- */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
