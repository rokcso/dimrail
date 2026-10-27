import { stringify } from 'yaml';
import {
  type AirportRecord,
  getAirport,
  listUserinfo,
  markError,
  saveNodes,
} from './airport-store';
import type { Bindings } from './env';
import { getGroupSummary, listGroupNodes } from './group-store';
import type { ProxyNode } from './subscription';
import { fetchSubscription } from './subscription';

/** 中转缓存的有效期：超过就回源，回源失败仍吐旧的。 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

/** 一律 quoted：`true`、`null`、`123` 这类名字不加引号会变成 YAML 布尔/数字。 */
function yamlKey(name: string): string {
  return JSON.stringify(name);
}

/** 配置的节点来源：一个机场，或一个节点组。 */
export interface ProviderSource {
  id: string;
  name: string;
  kind: 'airport' | 'group';
}

/** 运行时注入到 proxy-providers 段的 YAML 片段。URL 与缓存路径用 id，key 用显示名。 */
export function buildProvidersYaml(
  sources: ProviderSource[],
  origin: string,
  token: string,
): string {
  return sources
    .map((source) => {
      const segment = `providers/${source.kind === 'group' ? 'groups' : 'airports'}`;
      const file = source.kind === 'group' ? `group-${source.id}` : source.id;
      return [
        `  ${yamlKey(source.name)}:`,
        '    type: http',
        `    url: ${origin}/${segment}/${encodeURIComponent(source.id)}?token=${encodeURIComponent(token)}`,
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
export async function aggregatedUserinfo(env: Bindings): Promise<string> {
  try {
    return aggregateUserinfo(await listUserinfo(env));
  } catch {
    return '';
  }
}

/**
 * 机场订阅中转：缓存新鲜就直接吐，过期回源；回源失败吐旧缓存（X-Cache: stale）。
 * 效果是机场短时间抽风时，客户端拉到的还是上一次的节点，而不是空。
 */
export async function relayProvider(env: Bindings, id: string): Promise<Response> {
  const airport = await getAirport(env, id);
  if (!airport) return text('机场不存在', 404);
  if (!airport.enabled) return text('机场已禁用', 404);

  const hasCache = airport.nodes.length > 0;
  const age = airport.fetchedAt ? Date.now() - airport.fetchedAt : Number.POSITIVE_INFINITY;
  if (hasCache && age < CACHE_TTL_MS) return providerYaml(airport, 'hit');

  const result = await fetchSubscription(airport.url);
  if (result.ok) {
    await saveNodes(env, id, result.nodes, result.userinfo);
    return providerYaml(
      {
        ...airport,
        nodes: result.nodes,
        nodeCount: result.nodes.length,
        userinfo: result.userinfo ?? airport.userinfo,
        fetchedAt: Date.now(),
        error: null,
        errorAt: null,
      },
      'miss',
    );
  }

  await markError(env, id, result.error);
  if (hasCache) return providerYaml(airport, 'stale');
  return text(`拉取 ${airport.name} 失败：${result.error}`, 502);
}

function providerYaml(airport: AirportRecord, cache: 'hit' | 'miss' | 'stale'): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Profile-Update-Interval': '10800',
    'X-Cache': cache,
  };
  if (airport.userinfo) headers['Subscription-Userinfo'] = airport.userinfo;

  return proxiesResponse(airport.nodes, headers);
}

/** 节点组不是一个可回源的机场，只从 D1 读成员当前对应的节点。 */
export async function relayGroup(env: Bindings, id: string): Promise<Response> {
  const group = await getGroupSummary(env, id);
  if (!group) return text('节点组不存在', 404);
  const nodes = await listGroupNodes(env, id);
  return proxiesResponse(nodes, {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Profile-Update-Interval': '10800',
  });
}

function proxiesResponse(nodes: ProxyNode[], headers: Record<string, string>): Response {
  return new Response(stringify({ proxies: nodes }, { lineWidth: 0 }), {
    status: 200,
    headers,
  });
}

function text(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
