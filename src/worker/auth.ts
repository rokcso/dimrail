import type { Bindings } from './env';

/** 常量时间比较，避免通过响应时间泄露长度或前缀。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
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
export function checkAdmin(request: Request, env: Bindings): AdminCheck {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return { ok: false, status: 503, message: '未配置 ADMIN_TOKEN' };
  if (!timingSafeEqual(bearerToken(request.headers.get('authorization')), expected)) {
    return { ok: false, status: 401, message: '口令错误' };
  }
  return { ok: true };
}
