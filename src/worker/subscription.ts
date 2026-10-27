import { parse } from 'yaml';

/** 机场吐出来的单个节点：原样保存，转发时要用到里面的全部字段。 */
export type ProxyNode = Record<string, unknown>;

const TIMEOUT_MS = 8000;
const MAX_BYTES = 8 * 1024 * 1024;
/** 单行要塞进 D1（约 1MB），2000 个节点是安全上限。 */
export const MAX_NODES = 2000;
const USER_AGENT = 'clash.meta';

export type FetchResult =
  | { ok: true; nodes: ProxyNode[]; truncated: boolean; userinfo: string | null }
  | { ok: false; error: string };

export type ParseResult =
  | { ok: true; nodes: ProxyNode[]; truncated: boolean }
  | { ok: false; error: string };

/**
 * 从订阅正文里取 proxies。
 * 三种失败要分开说，因为用户能做的补救完全不一样：
 * 链接失效（HTML）、格式不对（v2ray/base64）、真的空了（机场下架了节点）。
 */
export function parseProxies(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: '订阅返回了空内容' };
  if (text.startsWith('<')) return { ok: false, error: '上游返回的是 HTML，订阅链接可能已经失效' };

  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    return { ok: false, error: `不是合法 YAML：${firstLine(err)}` };
  }

  const proxies =
    doc && typeof doc === 'object' ? (doc as { proxies?: unknown }).proxies : undefined;
  if (!Array.isArray(proxies)) {
    return { ok: false, error: '没有 proxies 字段：可能是 v2ray/base64 订阅，不是 Clash 格式' };
  }

  const nodes = proxies.filter(
    (item): item is ProxyNode => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
  if (nodes.length === 0) return { ok: false, error: 'proxies 是空的：机场没吐任何节点' };

  const truncated = nodes.length > MAX_NODES;
  return { ok: true, nodes: truncated ? nodes.slice(0, MAX_NODES) : nodes, truncated };
}

export async function fetchSubscription(url: string): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: `连不上上游：${firstLine(err)}` };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: `上游返回 HTTP ${response.status}` };
  }

  const userinfo = response.headers.get('subscription-userinfo');

  let raw: string;
  try {
    raw = await response.text();
  } catch (err) {
    return { ok: false, error: `读响应失败：${firstLine(err)}` };
  }
  if (new TextEncoder().encode(raw).length > MAX_BYTES) {
    return { ok: false, error: '订阅超过 8MB，没有解析' };
  }

  const parsed = parseProxies(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, nodes: parsed.nodes, truncated: parsed.truncated, userinfo };
}

/** 展示用字段：缺就给空串，别让 web 端到处判空。 */
export function toNodeViewFields(node: ProxyNode): {
  name: string;
  type: string;
  server: string;
  port: string;
} {
  return {
    name: text(node.name),
    type: text(node.type),
    server: text(node.server),
    port: text(node.port),
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function firstLine(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/timeout|timed out/i.test(raw)) return '超时';
  return raw.split('\n')[0] ?? '未知错误';
}
