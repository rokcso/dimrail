import type { Bindings } from './env';

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** 先哈希再比较：长度固定，不泄露原文长度或前缀。 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export function bearerToken(header: string | null): string {
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}

export type AdminCheck = { ok: true } | { ok: false; status: 401 | 503; message: string };

/** 管理口令校验：未配置时 503，错误时 401。 */
export async function checkAdmin(request: Request, env: Bindings): Promise<AdminCheck> {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return { ok: false, status: 503, message: '未配置 ADMIN_TOKEN' };
  if (!(await timingSafeEqual(bearerToken(request.headers.get('authorization')), expected))) {
    return { ok: false, status: 401, message: '口令错误' };
  }
  return { ok: true };
}
