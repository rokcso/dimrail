import { parse } from 'yaml';
import { hasProviderMarker } from './inject';

export interface ValidationResult {
  ok: boolean;
  error?: string;
  notices: string[];
}

/** 保存前只做三件事：能解析、是对象、标记是否存在（提示不阻断）。 */
export function validateConfig(yaml: string): ValidationResult {
  const notices: string[] = [];

  let doc: unknown;
  try {
    doc = parse(yaml);
  } catch (err) {
    return { ok: false, error: toShortMessage(err), notices };
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: '内容必须是一个 YAML 对象', notices };
  }

  if (!hasProviderMarker(yaml)) {
    notices.push('缺少 # __PROXY_PROVIDERS__，配置里不会有节点');
  }
  if (!yaml.includes('__PROVIDER_NAMES__') && !looksLikeManualProviders(doc)) {
    notices.push('缺少 __PROVIDER_NAMES__，代理组可能没有可选节点');
  }

  return { ok: true, notices };
}

function looksLikeManualProviders(doc: object): boolean {
  const providers = (doc as { 'proxy-providers'?: unknown })['proxy-providers'];
  return Boolean(providers && typeof providers === 'object');
}

/** YAML 库的报错带多行上下文，只取第一行。 */
function toShortMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0] ?? 'YAML 解析失败';
}
