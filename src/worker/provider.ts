import { parse, stringify } from 'yaml';
import type { Bindings } from './env';

export type Providers = Record<string, string>;

/** 解析并校验 PROVIDERS_JSON。 */
export function parseProviders(env: Bindings): Providers {
  const raw = (env.PROVIDERS_JSON ?? '').trim();
  if (!raw) throw new Error('未配置 PROVIDERS_JSON');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PROVIDERS_JSON 不是合法 JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PROVIDERS_JSON 必须是 {"机场名":"订阅链接"} 形式的对象');
  }

  const providers: Providers = {};
  for (const [name, url] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
      throw new Error(`机场名不合法（字母/数字/下划线/连字符，最长 32 字符）：${name}`);
    }
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error(`机场 ${name} 的订阅链接无效`);
    }
    providers[name] = url;
  }

  if (Object.keys(providers).length === 0) {
    throw new Error('PROVIDERS_JSON 至少需要一个机场');
  }
  return providers;
}

/** 运行时注入到 proxy-providers 段的 YAML 片段。 */
export function buildProvidersYaml(providers: Providers, origin: string, token: string): string {
  return Object.keys(providers)
    .map((name) =>
      [
        `  ${name}:`,
        '    type: http',
        `    url: ${origin}/providers/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`,
        '    interval: 10800',
        `    path: ./providers/${name}.yaml`,
        '    health-check:',
        '      enable: true',
        '      interval: 300',
        '      url: http://www.gstatic.com/generate_204',
      ].join('\n'),
    )
    .join('\n');
}

interface UsageCache {
  data: string;
  ts: number;
}

const USAGE_TTL_MS = 10 * 60 * 1000;
let usageCache: UsageCache | null = null;

/**
 * 拉取各机场的 subscription-userinfo 并聚合。
 * upload/download/total 求和，expire 取最早。
 */
export async function aggregatedUserinfo(env: Bindings): Promise<string> {
  if (usageCache && Date.now() - usageCache.ts < USAGE_TTL_MS) return usageCache.data;

  let providers: Providers;
  try {
    providers = parseProviders(env);
  } catch {
    return '';
  }

  const results = await Promise.allSettled(
    Object.values(providers).map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'clash.meta' },
          redirect: 'follow',
        });
        const info = res.ok ? (res.headers.get('subscription-userinfo') ?? '') : '';
        await res.body?.cancel();
        return info;
      } catch {
        return '';
      }
    }),
  );

  const total = { upload: 0, download: 0, total: 0, expire: 0 };
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const pick = (key: keyof typeof total) => {
      const match = new RegExp(`${key}=(\\d+)`, 'i').exec(result.value);
      if (!match?.[1]) return;
      const value = Number(match[1]);
      if (key === 'expire')
        total.expire = total.expire === 0 ? value : Math.min(total.expire, value);
      else total[key] += value;
    };
    pick('upload');
    pick('download');
    pick('total');
    pick('expire');
  }

  const parts: string[] = [];
  if (total.upload) parts.push(`upload=${total.upload}`);
  if (total.download) parts.push(`download=${total.download}`);
  if (total.total) parts.push(`total=${total.total}`);
  if (total.expire) parts.push(`expire=${total.expire}`);

  const data = parts.join('; ');
  usageCache = { data, ts: Date.now() };
  return data;
}

/** 机场订阅中转：裁剪成纯 proxies，透传用量与更新间隔。 */
export async function relayProvider(name: string, env: Bindings): Promise<Response> {
  let providers: Providers;
  try {
    providers = parseProviders(env);
  } catch (err) {
    return text((err as Error).message, 500);
  }

  const subUrl = providers[name];
  if (!subUrl) return text(`未找到机场：${name}`, 404);

  let upstream: Response;
  try {
    upstream = await fetch(subUrl, {
      headers: { 'User-Agent': 'clash.meta' },
      redirect: 'follow',
    });
  } catch (err) {
    return text(`拉取 ${name} 失败：${(err as Error).message}`, 502);
  }
  if (!upstream.ok) return text(`${name} 返回 HTTP ${upstream.status}`, 502);

  const raw = await upstream.text();
  let body = raw;
  try {
    const doc = parse(raw);
    if (doc && typeof doc === 'object' && Array.isArray((doc as { proxies?: unknown }).proxies)) {
      body = stringify({ proxies: (doc as { proxies: unknown[] }).proxies }, { lineWidth: 0 });
    }
  } catch {
    // 解析失败时原样透传
  }

  const headers: Record<string, string> = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
  };
  for (const key of ['subscription-userinfo', 'profile-update-interval', 'content-disposition']) {
    const value = upstream.headers.get(key);
    if (value) headers[key] = value;
  }
  return new Response(body, { status: 200, headers });
}

function text(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
