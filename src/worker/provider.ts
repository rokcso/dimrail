import {
  type AirportRecord,
  acquireRefreshLock,
  getAirport,
  listUserinfo,
  markError,
  releaseRefreshLock,
  saveNodes,
} from './airport-store';
import type { Bindings } from './env';
import { fnv1a } from './hash';
import {
  getPoolSummary,
  hasAvailablePoolNodes,
  listPoolNodes,
  listPoolUserinfo,
} from './pool-store';
import { fetchSubscription, stringifyProxies } from './subscription';

/** 中转缓存的有效期：超过就回源，回源失败仍吐旧的。 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

/** 一律 quoted：`true`、`null`、`123` 这类名字不加引号会变成 YAML 布尔/数字。 */
function yamlKey(name: string): string {
  return JSON.stringify(name);
}

/** 配置的节点来源：一个机场，或一个节点池。 */
export interface ProviderSource {
  id: string;
  name: string;
  kind: 'airport' | 'pool';
}

/** 运行时注入到 proxy-providers 段的 YAML 片段。URL 与缓存路径用 id，key 用显示名。 */
export function buildProvidersYaml(
  sources: ProviderSource[],
  origin: string,
  configId: string,
  token: string,
): string {
  return sources
    .map((source) => {
      const segment = `providers/${source.kind === 'pool' ? 'pools' : 'airports'}`;
      const file = source.kind === 'pool' ? `pool-${source.id}` : source.id;
      return [
        `  ${yamlKey(source.name)}:`,
        '    type: http',
        `    url: ${origin}/sub/${configId}/${segment}/${encodeURIComponent(source.id)}?token=${encodeURIComponent(token)}`,
        '    interval: 10800',
        `    path: ./providers/${file}.yaml`,
        '    health-check:',
        '      enable: true',
        '      interval: 300',
        '      url: http://www.gstatic.com/generate_204',
      ].join('\n');
    })
    .join('\n');
}

/** 代理组里 use 的名字列表。 */
export function providerNames(sources: ProviderSource[]): string {
  return sources.map((source) => yamlKey(source.name)).join(', ');
}

/**
 * 聚合各机场的 subscription-userinfo：upload/download/total 求和，expire 取最早。
 * 数据来自 D1 里的缓存，不再每次请求去问上游。
 */
export function aggregateUserinfo(values: string[]): string {
  const total = { upload: 0, download: 0, total: 0, expire: 0 };

  for (const raw of values) {
    for (const key of ['upload', 'download', 'total', 'expire'] as const) {
      const match = new RegExp(`${key}=(\\d+)`, 'i').exec(raw);
      if (!match?.[1]) continue;
      const value = Number(match[1]);
      if (key === 'expire')
        total.expire = total.expire === 0 ? value : Math.min(total.expire, value);
      else total[key] += value;
    }
  }

  const parts: string[] = [];
  if (total.upload) parts.push(`upload=${total.upload}`);
  if (total.download) parts.push(`download=${total.download}`);
  if (total.total) parts.push(`total=${total.total}`);
  if (total.expire) parts.push(`expire=${total.expire}`);
  return parts.join('; ');
}

/** 顶层订阅响应头里的用量，读缓存而不是打上游。 */
export async function aggregatedUserinfo(env: Bindings, poolId?: string | null): Promise<string> {
  try {
    const values = poolId ? await listPoolUserinfo(env, poolId) : await listUserinfo(env);
    return aggregateUserinfo(values);
  } catch {
    return '';
  }
}

/**
 * 机场订阅中转：缓存新鲜就直接吐，过期回源；回源失败吐旧缓存（X-Cache: stale）。
 * 效果是机场短时间抽风时，客户端拉到的还是上一次的节点，而不是空。
 */
export async function relayProvider(
  env: Bindings,
  request: Request,
  id: string,
): Promise<Response> {
  const airport = await getAirport(env, id);
  if (!airport) return text('机场不存在', 404);
  if (!airport.enabled) return text('机场已禁用', 404);

  const hasCache = airport.nodes.length > 0;
  const age = airport.fetchedAt ? Date.now() - airport.fetchedAt : Number.POSITIVE_INFINITY;
  if (hasCache && age < CACHE_TTL_MS) {
    return providerResponse(request, await cachedProviderYaml(airport), {
      cache: 'hit',
      userinfo: airport.userinfo,
    });
  }

  const locked = await acquireRefreshLock(env, id);
  if (!locked) {
    if (hasCache) {
      return providerResponse(request, await cachedProviderYaml(airport), {
        cache: 'stale',
        userinfo: airport.userinfo,
      });
    }
    return text('正在刷新，请稍后重试', 503);
  }

  try {
    const result = await fetchSubscription(airport.url);
    if (result.ok) {
      await saveNodes(env, id, result.nodes, result.userinfo, result.truncated);
      return providerResponse(request, stringifyProxies(result.nodes), {
        cache: 'miss',
        userinfo: result.userinfo ?? airport.userinfo,
      });
    }

    await markError(env, id, result.error);
  } finally {
    await releaseRefreshLock(env, id);
  }

  if (hasCache) {
    return providerResponse(request, await cachedProviderYaml(airport), {
      cache: 'stale',
      userinfo: airport.userinfo,
    });
  }
  const refreshed = await getAirport(env, id);
  return text(`拉取 ${airport.name} 失败：${refreshed?.error ?? '未知错误'}`, 502);
}

/** 序列化结果放 Colo 缓存，避免每次请求重新 parse/stringify；不占 D1 单值上限。 */
async function cachedProviderYaml(airport: AirportRecord): Promise<string> {
  const key = new Request(
    `https://provider.internal/airports/${airport.id}/${airport.fetchedAt ?? 0}`,
  );
  try {
    const hit = await caches.default.match(key);
    if (hit) return hit.text();
  } catch {
    // 本地/cache 不可用时退回直接序列化
  }

  const yaml = stringifyProxies(airport.nodes);
  try {
    await caches.default.put(
      key,
      new Response(yaml, { headers: { 'Cache-Control': 'public, max-age=86400' } }),
    );
  } catch {
    // ignore
  }
  return yaml;
}

function providerResponse(
  request: Request,
  yaml: string,
  options: { cache?: 'hit' | 'miss' | 'stale'; userinfo?: string | null },
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Profile-Update-Interval': '10800',
    ETag: `"${fnv1a(yaml)}"`,
  };
  if (options.cache) headers['X-Cache'] = options.cache;
  if (options.userinfo) headers['Subscription-Userinfo'] = options.userinfo;

  if (request.headers.get('if-none-match') === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(yaml, { status: 200, headers });
}

/** 节点池不是一个可回源的机场，只从 D1 读成员当前对应的节点。 */
export async function relayPool(env: Bindings, request: Request, id: string): Promise<Response> {
  const pool = await getPoolSummary(env, id);
  if (!pool) return text('节点池不存在', 404);
  if (!(await hasAvailablePoolNodes(env, id))) return text('节点池没有可用节点', 503);

  const nodes = await listPoolNodes(env, id);
  const userinfo = aggregateUserinfo(await listPoolUserinfo(env, id));
  return providerResponse(request, stringifyProxies(nodes), {
    userinfo: userinfo || null,
  });
}

function text(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
