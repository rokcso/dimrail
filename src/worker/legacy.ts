import { AIRPORT_NAME_PATTERN } from '../shared/schema';
import type { Bindings } from './env';

/**
 * 老的 PROVIDERS_JSON：只用于一次性导入到 D1。
 * 解析失败一律当作空的 —— 导入功能坏掉不该让整个页面报错。
 */
export function parseLegacyProviders(env: Bindings): Record<string, string> {
  const raw = (env.PROVIDERS_JSON ?? '').trim();
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const providers: Record<string, string> = {};
  for (const [name, url] of Object.entries(parsed as Record<string, unknown>)) {
    if (!AIRPORT_NAME_PATTERN.test(name)) continue;
    if (typeof url !== 'string' || !/^https?:\/\/\S+$/i.test(url)) continue;
    providers[name] = url;
  }
  return providers;
}
