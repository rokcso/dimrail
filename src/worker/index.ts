import {
  type AirportListResponse,
  type AirportSummary,
  airportCreateSchema,
  airportUpdateSchema,
  type BaseConfigResponse,
  type ConfigDetail,
  type ConfigListResponse,
  configCreateSchema,
  configUpdateSchema,
  type NodesResponse,
  type NodeView,
  type OverviewResponse,
  type RefreshResponse,
  type SaveResponse,
  type TokenResponse,
  yamlPayloadSchema,
} from '../shared/schema';
import {
  countAirports,
  countFailed,
  countNodes,
  createAirport,
  deleteAirport,
  getAirport,
  listAirports,
  listNodeViews,
  listProviderRefs,
  markError,
  nameTaken,
  saveNodes,
  updateAirport,
} from './airport-store';
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
import { aggregatedUserinfo, buildProvidersYaml, providerNames, relayProvider } from './provider';
import { parseRoute } from './routes';
import { fetchSubscription } from './subscription';
import { validateConfig } from './validate';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const CONFIG_ID = /^\/api\/configs\/([A-Za-z0-9_-]{1,32})(\/token)?$/;
const AIRPORT_ID = /^\/api\/airports\/([A-Za-z0-9_-]{1,32})(\/refresh)?$/;

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
        return handleProvider(env, url, route.id);
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
  let refs: Awaited<ReturnType<typeof listProviderRefs>>;
  try {
    record = await getConfig(env, id);
    if (!record) return text('配置不存在', 404);
    if (!timingSafeEqual(token, record.token)) return text('订阅链接无效', 401);
    refs = await listProviderRefs(env);
  } catch (err) {
    return text(`读取配置失败：${errorMessage(err)}`, 500);
  }

  if (refs.length === 0) {
    return text('还没有可用的机场：先到 /admin/airports 添加订阅链接', 503);
  }

  const body = [
    '# Dimrail',
    `# 配置: ${record.name}`,
    `# 机场: ${refs.map((ref) => ref.name).join(', ')}`,
    record.yaml
      .replaceAll('  # __PROXY_PROVIDERS__', buildProvidersYaml(refs, url.origin, record.token))
      .replaceAll('__PROVIDER_NAMES__', providerNames(refs)),
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

async function handleProvider(env: Bindings, url: URL, id: string): Promise<Response> {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return text('缺少订阅密钥', 401);

  let valid: boolean;
  try {
    valid = await tokenExists(env, token);
  } catch (err) {
    return text(`校验失败：${errorMessage(err)}`, 500);
  }
  if (!valid) return text('订阅链接无效', 401);

  return relayProvider(env, id);
}

/* ---------------- 管理 API ---------------- */

async function handleApi(request: Request, env: Bindings, path: string): Promise<Response> {
  const admin = checkAdmin(request, env);
  if (!admin.ok) return json({ error: admin.message }, admin.status);

  try {
    return await routeApi(request, env, path);
  } catch (err) {
    // 线上出问题时 wrangler tail 里能看到是哪一步炸的
    console.error(`${request.method} ${path}`, err);
    return json({ error: errorHint(errorMessage(err)) }, 500);
  }
}

/**
 * D1 本地连接坏掉时只回一句 `internal error; reference = …`，看着像业务错误，
 * 实际是数据库句柄废了（典型：dev 还跑着就把 .wrangler/state 删了）。
 * 补一句人话，省得又当功能 bug 排查一遍。
 */
function errorHint(message: string): string {
  if (/^internal error; reference = /.test(message)) {
    return `${message}（本地 D1 连不上了：重启 pnpm dev；线上则确认 pnpm db:migrate:remote 跑过）`;
  }
  return message;
}

async function routeApi(request: Request, env: Bindings, path: string): Promise<Response> {
  const method = request.method;

  if (path === '/api/overview') {
    if (method !== 'GET') return methodNotAllowed();
    const base = await loadBase(env);
    const [airportCount, nodeCount, failed, configCount] = await Promise.all([
      countAirports(env),
      countNodes(env),
      countFailed(env),
      countConfigs(env),
    ]);
    return json({
      airports: { count: airportCount, nodeCount, failed },
      adminTokenConfigured: Boolean(env.ADMIN_TOKEN?.trim()),
      base: { seeded: base.seeded, updatedAt: base.updatedAt },
      configCount,
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

  if (path === '/api/airports') {
    if (method === 'GET') {
      return json({ airports: await listAirports(env) } satisfies AirportListResponse);
    }
    if (method === 'POST') {
      const payload = airportCreateSchema.safeParse(await readJson(request));
      if (!payload.success) return json({ error: firstIssue(payload.error) }, 400);
      if (await nameTaken(env, payload.data.name)) {
        return json({ error: `已经有一个叫「${payload.data.name}」的机场` }, 409);
      }

      // 建完立刻拉一次，用户当场就知道链接对不对。
      const created = await createAirport(env, payload.data);
      return json(await refreshAirport(env, created), 201);
    }
    return methodNotAllowed();
  }

  if (path === '/api/airports/refresh') {
    if (method !== 'POST') return methodNotAllowed();
    const enabled = (await listAirports(env)).filter((airport) => airport.enabled);
    const results = await Promise.all(enabled.map((airport) => refreshAirport(env, airport)));
    const failed = results.filter((airport) => airport.error).length;
    return json({
      refreshed: results.length - failed,
      failed,
      airports: await listAirports(env),
    } satisfies RefreshResponse);
  }

  if (path === '/api/nodes') {
    if (method !== 'GET') return methodNotAllowed();
    const [rows, airports] = await Promise.all([listNodeViews(env), listAirports(env)]);
    const nodes: NodeView[] = rows.map((row) => ({
      name: row.name,
      type: row.type,
      server: row.server,
      port: row.port,
      airportId: row.airportId,
      airportName: row.airportName,
    }));

    const enabled = airports.filter((airport) => airport.enabled);
    const stamps = enabled
      .map((airport) => airport.fetchedAt)
      .filter((value): value is number => typeof value === 'number');

    return json({
      nodes,
      fetchedAt: stamps.length ? Math.max(...stamps) : null,
      airports: {
        total: enabled.length,
        failed: enabled.filter((airport) => airport.error).length,
      },
    } satisfies NodesResponse);
  }

  const airportMatch = AIRPORT_ID.exec(path);
  if (airportMatch?.[1]) {
    const id = airportMatch[1];

    if (airportMatch[2]) {
      if (method !== 'POST') return methodNotAllowed();
      const airport = await getAirport(env, id);
      if (!airport) return json({ error: '机场不存在' }, 404);
      return json(await refreshAirport(env, airport));
    }

    if (method === 'PATCH') {
      const payload = airportUpdateSchema.safeParse(await readJson(request));
      if (!payload.success) return json({ error: firstIssue(payload.error) }, 400);
      if (payload.data.name && (await nameTaken(env, payload.data.name, id))) {
        return json({ error: `已经有一个叫「${payload.data.name}」的机场` }, 409);
      }

      const updated = await updateAirport(env, id, payload.data);
      if (!updated) return json({ error: '机场不存在' }, 404);
      return json(updated);
    }

    if (method === 'DELETE') {
      if (!(await deleteAirport(env, id))) return json({ error: '机场不存在' }, 404);
      return json({ ok: true });
    }

    return methodNotAllowed();
  }

  const match = CONFIG_ID.exec(path);
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

/** 拉一次并落库，返回刷新后的机场（失败时带 error，不动旧节点）。 */
async function refreshAirport(env: Bindings, airport: AirportSummary): Promise<AirportSummary> {
  const result = await fetchSubscription(airport.url);

  if (result.ok) {
    await saveNodes(env, airport.id, result.nodes, result.userinfo);
    return {
      ...airport,
      nodeCount: result.nodes.length,
      userinfo: result.userinfo ?? airport.userinfo,
      fetchedAt: Date.now(),
      error: null,
      errorAt: null,
      updatedAt: Date.now(),
    };
  }

  await markError(env, airport.id, result.error);
  return { ...airport, error: result.error, errorAt: Date.now() };
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

/** zod 的报错里第一条就是给用户看的，中文文案走这里。 */
function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? '请求格式错误';
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
