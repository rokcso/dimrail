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
  type NodePoolDetail,
  type NodePoolListResponse,
  type NodesResponse,
  type NodeView,
  nodePoolCreateSchema,
  nodePoolMembersPayloadSchema,
  nodePoolUpdateSchema,
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
  countConfigsUsingPool,
  createConfig,
  deleteConfig,
  getConfig,
  listConfigs,
  loadBase,
  regenerateToken,
  resetBase,
  saveBase,
  updateConfig,
} from './config-store';
import type { Bindings } from './env';
import { fnv1a } from './hash';
import { injectProviderNames, injectProviders } from './inject';
import {
  countPools,
  createPool,
  deletePool,
  getPool,
  getPoolSummary,
  hasAvailablePoolNodes,
  listPools,
  nameTaken as poolNameTaken,
  renamePool,
  setPoolMembers,
} from './pool-store';
import {
  aggregatedUserinfo,
  buildProvidersYaml,
  type ProviderSource,
  providerNames,
  relayPool,
  relayProvider,
} from './provider';
import { parseRoute } from './routes';
import { fetchSubscription } from './subscription';
import { validateConfig } from './validate';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const CONFIG_ID = /^\/api\/configs\/([A-Za-z0-9_-]{1,32})(\/token|\/preview)?$/;
const AIRPORT_ID = /^\/api\/airports\/([A-Za-z0-9_-]{1,32})(\/refresh)?$/;
const POOL_ID = /^\/api\/pools\/([A-Za-z0-9_-]{1,32})(\/nodes)?$/;

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
        return handleProvider(request, env, url, route.configId, route.id);
      case 'pool':
        return handlePool(request, env, url, route.configId, route.id);
      case 'root':
        return redirect('/admin/configs');
      case 'notFound':
        return text('Not found', 404);
      default:
        return serveAssets(request, env);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(refreshAllAirports(env));
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
  try {
    record = await getConfig(env, id);
    if (!record) return text('配置不存在', 404);
    if (!(await timingSafeEqual(token, record.token))) return text('订阅链接无效', 401);
  } catch (err) {
    return text(`读取配置失败：${errorMessage(err)}`, 500);
  }

  const built = await buildSubscription(env, record, url.origin);
  if (!built.ok) return text(built.message, built.status);

  const headers: Record<string, string> = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    ETag: `W/"${fnv1a(built.body)}"`,
    'Profile-Update-Interval': '10800',
    'Content-Disposition': `attachment; filename="${record.id}.yaml"`,
  };

  const userinfo = await aggregatedUserinfo(env, record.poolId);
  if (userinfo) headers['Subscription-Userinfo'] = userinfo;

  if (request.headers.get('if-none-match') === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(built.body, { status: 200, headers });
}

type SubscriptionBuild =
  | { ok: true; body: string }
  | { ok: false; status: number; message: string };

/** 订阅正文与预览共用：解析来源、注入 provider、拼上头部注释。 */
async function buildSubscription(
  env: Bindings,
  record: ConfigRecord,
  origin: string,
): Promise<SubscriptionBuild> {
  let sources: ProviderSource[];
  let sourceLabel: string;

  try {
    if (record.poolId) {
      const pool = await getPoolSummary(env, record.poolId);
      if (!pool) {
        return {
          ok: false,
          status: 503,
          message: '这份配置使用的节点池已不存在：到 /admin/pools 重新选择节点来源',
        };
      }
      if (!(await hasAvailablePoolNodes(env, record.poolId))) {
        return { ok: false, status: 503, message: '节点池没有可用节点（机场可能都已停用）' };
      }
      sources = [{ id: pool.id, name: pool.name, kind: 'pool' }];
      sourceLabel = `节点池: ${pool.name}`;
    } else {
      const refs = await listProviderRefs(env);
      if (refs.length === 0) {
        return {
          ok: false,
          status: 503,
          message: '还没有可用的机场：先到 /admin/airports 添加订阅链接',
        };
      }
      sources = refs.map((ref) => ({ ...ref, kind: 'airport' as const }));
      sourceLabel = `机场: ${refs.map((ref) => ref.name).join(', ')}`;
    }
  } catch (err) {
    return { ok: false, status: 500, message: `读取配置失败：${errorMessage(err)}` };
  }

  const providers = buildProvidersYaml(sources, origin, record.id, record.token);
  const names = providerNames(sources);
  const name = record.name.replace(/[\r\n]+/g, ' ');
  const body = [
    '# Dimrail',
    `# 配置: ${name}`,
    `# ${sourceLabel}`,
    injectProviderNames(injectProviders(record.yaml, providers), names),
  ].join('\n');

  return { ok: true, body };
}

async function handleProvider(
  request: Request,
  env: Bindings,
  url: URL,
  configId: string,
  id: string,
): Promise<Response> {
  const denied = await checkSubscriptionToken(env, url, configId);
  if (denied) return denied;
  return relayProvider(env, request, id);
}

async function handlePool(
  request: Request,
  env: Bindings,
  url: URL,
  configId: string,
  id: string,
): Promise<Response> {
  const denied = await checkSubscriptionToken(env, url, configId);
  if (denied) return denied;
  return relayPool(env, request, id);
}

/** provider URL 绑定配置 id，token 只能读自己那份配置的来源。 */
async function checkSubscriptionToken(
  env: Bindings,
  url: URL,
  configId: string,
): Promise<Response | null> {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return text('缺少订阅密钥', 401);

  try {
    const record = await getConfig(env, configId);
    if (!record) return text('配置不存在', 404);
    if (await timingSafeEqual(token, record.token)) return null;
  } catch (err) {
    return text(`校验失败：${errorMessage(err)}`, 500);
  }
  return text('订阅链接无效', 401);
}

/* ---------------- 管理 API ---------------- */

async function handleApi(request: Request, env: Bindings, path: string): Promise<Response> {
  if (env.ADMIN_RATE_LIMIT) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    const { success } = await env.ADMIN_RATE_LIMIT.limit({ key: `admin:${ip}` });
    if (!success) return json({ error: '请求过于频繁，请稍后重试' }, 429);
  }

  const admin = await checkAdmin(request, env);
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
    const [airportCount, nodeCount, failed, configCount, poolCount] = await Promise.all([
      countAirports(env),
      countNodes(env),
      countFailed(env),
      countConfigs(env),
      countPools(env),
    ]);
    return json({
      airports: { count: airportCount, nodeCount, failed },
      adminTokenConfigured: Boolean(env.ADMIN_TOKEN?.trim()),
      base: { seeded: base.seeded, updatedAt: base.updatedAt },
      configCount,
      poolCount,
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

      const base = await loadBase(env);
      if (
        payload.data.expectedUpdatedAt !== undefined &&
        base.updatedAt !== payload.data.expectedUpdatedAt
      ) {
        return json({ error: '基础配置已在别处修改，请刷新后重试' }, 409);
      }

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

  if (path === '/api/pools') {
    if (method === 'GET') {
      return json({ pools: await listPools(env) } satisfies NodePoolListResponse);
    }
    if (method === 'POST') {
      const payload = nodePoolCreateSchema.safeParse(await readJson(request));
      if (!payload.success) return json({ error: firstIssue(payload.error) }, 400);
      if (await poolNameTaken(env, payload.data.name)) {
        return json({ error: `已经有一个叫「${payload.data.name}」的节点池` }, 409);
      }
      return json(await createPool(env, payload.data.name), 201);
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
    const url = new URL(request.url);
    const airportId = url.searchParams.get('airportId') ?? undefined;
    const keyword = url.searchParams.get('q')?.trim() || undefined;
    const type = url.searchParams.get('type') || undefined;
    const limitValue = Number(url.searchParams.get('limit') ?? '');
    const offsetValue = Number(url.searchParams.get('offset') ?? '');
    const limit =
      Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 5000) : undefined;
    const offset = Number.isFinite(offsetValue) && offsetValue > 0 ? offsetValue : 0;

    const [rows, airports] = await Promise.all([
      listNodeViews(env, { airportId, keyword, type, limit, offset }),
      listAirports(env),
    ]);
    const nodes: NodeView[] = rows.map((row) => ({
      name: row.name,
      type: row.type,
      server: row.server,
      port: row.port,
      airportId: row.airportId,
      airportName: row.airportName,
      airportEnabled: row.airportEnabled === 1,
    }));

    const enabled = airports.filter((airport) => airport.enabled);
    const stamps = enabled
      .map((airport) => airport.fetchedAt)
      .filter((value): value is number => typeof value === 'number');

    return json({
      nodes,
      fetchedAt: stamps.length ? Math.max(...stamps) : null,
      airports: {
        total: airports.length,
        failed: airports.filter((airport) => airport.error).length,
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

  const poolMatch = POOL_ID.exec(path);
  const poolId = poolMatch?.[1];
  if (poolId) {
    if (poolMatch[2]) {
      if (method !== 'PUT') return methodNotAllowed();
      const payload = nodePoolMembersPayloadSchema.safeParse(await readJson(request));
      if (!payload.success) return json({ error: firstIssue(payload.error) }, 400);
      const summary = await getPoolSummary(env, poolId);
      if (!summary) return json({ error: '节点池不存在' }, 404);
      if (
        payload.data.expectedUpdatedAt !== undefined &&
        summary.updatedAt !== payload.data.expectedUpdatedAt
      ) {
        return json({ error: '节点池已在别处修改，请刷新后重试' }, 409);
      }

      const nodeCount = await setPoolMembers(env, poolId, payload.data.members);
      const updated = await getPoolSummary(env, poolId);
      return json({ ok: true, nodeCount, updatedAt: updated?.updatedAt ?? Date.now() });
    }

    if (method === 'GET') {
      const pool = await getPool(env, poolId);
      if (!pool) return json({ error: '节点池不存在' }, 404);
      return json(pool satisfies NodePoolDetail);
    }

    if (method === 'PATCH') {
      const payload = nodePoolUpdateSchema.safeParse(await readJson(request));
      if (!payload.success) return json({ error: firstIssue(payload.error) }, 400);
      if (await poolNameTaken(env, payload.data.name, poolId)) {
        return json({ error: `已经有一个叫「${payload.data.name}」的节点池` }, 409);
      }

      const updated = await renamePool(env, poolId, payload.data.name);
      if (!updated) return json({ error: '节点池不存在' }, 404);
      return json(updated);
    }

    if (method === 'DELETE') {
      const inUse = await countConfigsUsingPool(env, poolId);
      if (inUse > 0) {
        return json({ error: `有 ${inUse} 份配置正在使用这个节点池，先改掉它们的节点来源` }, 409);
      }
      if (!(await deletePool(env, poolId))) return json({ error: '节点池不存在' }, 404);
      return json({ ok: true });
    }

    return methodNotAllowed();
  }

  const match = CONFIG_ID.exec(path);
  const id = match?.[1];
  if (!id) return json({ error: 'Not found' }, 404);

  if (match?.[2] === '/token') {
    if (method !== 'POST') return methodNotAllowed();
    const token = await regenerateToken(env, id);
    if (!token) return json({ error: '配置不存在' }, 404);
    return json({ token } satisfies TokenResponse);
  }

  if (match?.[2] === '/preview') {
    if (method !== 'GET') return methodNotAllowed();
    const record = await getConfig(env, id);
    if (!record) return json({ error: '配置不存在' }, 404);
    const built = await buildSubscription(env, record, new URL(request.url).origin);
    if (!built.ok) return json({ error: built.message }, built.status);
    return json({ yaml: built.body });
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
    if (payload.data.poolId && !(await getPoolSummary(env, payload.data.poolId))) {
      return json({ error: '节点池不存在' }, 400);
    }
    const current = await getConfig(env, id);
    if (!current) return json({ error: '配置不存在' }, 404);
    if (
      payload.data.expectedUpdatedAt !== undefined &&
      current.updatedAt !== payload.data.expectedUpdatedAt
    ) {
      return json({ error: '配置已在别处修改，请刷新后重试' }, 409);
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
    await saveNodes(env, airport.id, result.nodes, result.userinfo, result.truncated);
    return {
      ...airport,
      nodeCount: result.nodes.length,
      userinfo: result.userinfo ?? airport.userinfo,
      truncated: result.truncated,
      fetchedAt: Date.now(),
      error: null,
      errorAt: null,
      updatedAt: Date.now(),
    };
  }

  await markError(env, airport.id, result.error);
  return { ...airport, error: result.error, errorAt: Date.now() };
}

/** Cron：顺序刷新启用机场，避免一次打太多上游。 */
async function refreshAllAirports(env: Bindings): Promise<void> {
  const airports = await listAirports(env);
  for (const airport of airports) {
    if (!airport.enabled) continue;
    try {
      await refreshAirport(env, airport);
    } catch (err) {
      console.error(`scheduled refresh ${airport.id}`, err);
    }
  }
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
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
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
