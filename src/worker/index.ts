import {
  type BaseConfigResponse,
  type ConfigDetail,
  type ConfigListResponse,
  configCreateSchema,
  configUpdateSchema,
  type OverviewResponse,
  type SaveResponse,
  type TokenResponse,
  yamlPayloadSchema,
} from '../shared/schema';
import { checkAdmin, timingSafeEqual } from './auth';
import {
  type ConfigRecord,
  countConfigs,
  createConfig,
  deleteConfig,
  getConfig,
  listConfigs,
  loadBase,
  regenerateToken,
  resetBase,
  saveBase,
  tokenExists,
  updateConfig,
} from './config-store';
import type { Bindings } from './env';
import {
  aggregatedUserinfo,
  buildProvidersYaml,
  type Providers,
  parseProviders,
  relayProvider,
} from './provider';
import { parseRoute } from './routes';
import { validateConfig } from './validate';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const ID_PATTERN = /^\/api\/configs\/([A-Za-z0-9_-]{1,32})(\/token)?$/;

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    const route = parseRoute(url.pathname);

    switch (route.kind) {
      case 'api':
        return handleApi(request, env, route.path);
      case 'config':
        return serveConfig(request, env, url, route.id);
      case 'provider':
        return handleProvider(env, url, route.name);
      case 'root':
        return redirect('/admin');
      case 'notFound':
        return text('Not found', 404);
      default:
        return serveAssets(request, env);
    }
  },
} satisfies ExportedHandler<Bindings>;

/* ---------------- 订阅 ---------------- */

async function serveConfig(
  request: Request,
  env: Bindings,
  url: URL,
  id: string,
): Promise<Response> {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return text('缺少订阅密钥：链接需要带 ?token=', 401);

  let record: ConfigRecord | null;
  let providers: Providers;
  try {
    record = await getConfig(env, id);
    if (!record) return text('配置不存在', 404);
    if (!timingSafeEqual(token, record.token)) return text('订阅链接无效', 401);
    providers = parseProviders(env);
  } catch (err) {
    return text(`读取配置失败：${errorMessage(err)}`, 500);
  }

  const names = Object.keys(providers);
  const body = [
    '# Dimrail',
    `# 配置: ${record.name}`,
    `# 机场: ${names.join(', ')}`,
    record.yaml
      .replaceAll(
        '  # __PROXY_PROVIDERS__',
        buildProvidersYaml(providers, url.origin, record.token),
      )
      .replaceAll('__PROVIDER_NAMES__', names.join(', ')),
  ].join('\n');

  const headers: Record<string, string> = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    ETag: `W/"${fnv1a(body)}"`,
    'Profile-Update-Interval': '10800',
    'Content-Disposition': `attachment; filename="${record.id}.yaml"`,
  };

  const userinfo = await aggregatedUserinfo(env);
  if (userinfo) headers['Subscription-Userinfo'] = userinfo;

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

async function handleProvider(env: Bindings, url: URL, name: string): Promise<Response> {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return text('缺少订阅密钥', 401);

  let valid: boolean;
  try {
    valid = await tokenExists(env, token);
  } catch (err) {
    return text(`校验失败：${errorMessage(err)}`, 500);
  }
  if (!valid) return text('订阅链接无效', 401);

  return relayProvider(name, env);
}

/* ---------------- 管理 API ---------------- */

async function handleApi(request: Request, env: Bindings, path: string): Promise<Response> {
  const admin = checkAdmin(request, env);
  if (!admin.ok) return json({ error: admin.message }, admin.status);

  try {
    return await routeApi(request, env, path);
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
}

async function routeApi(request: Request, env: Bindings, path: string): Promise<Response> {
  const method = request.method;

  if (path === '/api/overview') {
    if (method !== 'GET') return methodNotAllowed();
    const base = await loadBase(env);
    let providers: OverviewResponse['providers'];
    try {
      providers = { names: Object.keys(parseProviders(env)), error: null };
    } catch (err) {
      providers = { names: [], error: errorMessage(err) };
    }
    return json({
      providers,
      adminTokenConfigured: Boolean(env.ADMIN_TOKEN?.trim()),
      base: { seeded: base.seeded, updatedAt: base.updatedAt },
      configCount: await countConfigs(env),
    } satisfies OverviewResponse);
  }

  if (path === '/api/base-config') {
    if (method === 'GET') {
      const base = await loadBase(env);
      return json({
        yaml: base.yaml,
        updatedAt: base.updatedAt,
        seeded: base.seeded,
      } satisfies BaseConfigResponse);
    }
    if (method === 'PUT') {
      const payload = yamlPayloadSchema.safeParse(await readJson(request));
      if (!payload.success) return json({ error: '请求格式错误' }, 400);

      const result = validateConfig(payload.data.yaml);
      if (!result.ok) return json({ error: result.error }, 400);

      const updatedAt = await saveBase(env, payload.data.yaml);
      return json({ updatedAt, notices: result.notices } satisfies SaveResponse);
    }
    return methodNotAllowed();
  }

  if (path === '/api/base-config/reset') {
    if (method !== 'POST') return methodNotAllowed();
    await resetBase(env);
    return json({ ok: true });
  }

  if (path === '/api/configs') {
    if (method === 'GET') {
      return json({ configs: await listConfigs(env) } satisfies ConfigListResponse);
    }
    if (method === 'POST') {
      const payload = configCreateSchema.safeParse((await readJson(request)) ?? {});
      if (!payload.success) return json({ error: '请求格式错误' }, 400);
      return json(await createConfig(env, payload.data.name), 201);
    }
    return methodNotAllowed();
  }

  const match = ID_PATTERN.exec(path);
  const id = match?.[1];
  if (!id) return json({ error: 'Not found' }, 404);

  if (match?.[2]) {
    if (method !== 'POST') return methodNotAllowed();
    const token = await regenerateToken(env, id);
    if (!token) return json({ error: '配置不存在' }, 404);
    return json({ token } satisfies TokenResponse);
  }

  if (method === 'GET') {
    const record = await getConfig(env, id);
    if (!record) return json({ error: '配置不存在' }, 404);
    return json(record satisfies ConfigDetail);
  }

  if (method === 'PUT') {
    const payload = configUpdateSchema.safeParse(await readJson(request));
    if (!payload.success) return json({ error: '请求格式错误' }, 400);

    let notices: string[] = [];
    if (payload.data.yaml !== undefined) {
      const result = validateConfig(payload.data.yaml);
      if (!result.ok) return json({ error: result.error }, 400);
      notices = result.notices;
    }

    const updated = await updateConfig(env, id, payload.data);
    if (!updated) return json({ error: '配置不存在' }, 404);
    return json({ updatedAt: updated.updatedAt, notices } satisfies SaveResponse);
  }

  if (method === 'DELETE') {
    if (!(await deleteConfig(env, id))) return json({ error: '配置不存在' }, 404);
    return json({ ok: true });
  }

  return methodNotAllowed();
}

/* ---------------- 静态资源 ---------------- */

async function serveAssets(request: Request, env: Bindings): Promise<Response> {
  if (!env.ASSETS) return text('前端尚未构建：先执行 pnpm build', 503);
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

function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, 405);
}

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
