import { describe, expect, it } from 'vitest';
import { bearerToken, checkAdmin, timingSafeEqual } from '@/worker/auth';
import { validateConfig } from '@/worker/validate';

describe('timingSafeEqual', () => {
  it('相同返回 true，不同长度与不同内容返回 false', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('bearerToken', () => {
  it('只接受 Bearer 形式', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer  abc  ')).toBe('abc');
    expect(bearerToken('abc')).toBe('');
    expect(bearerToken(null)).toBe('');
  });
});

describe('checkAdmin', () => {
  const request = (authorization?: string) =>
    new Request('https://example.com/api/config', {
      headers: authorization ? { Authorization: authorization } : {},
    });

  it('未配置 ADMIN_TOKEN 时返回 503', () => {
    expect(checkAdmin(request('Bearer x'), {})).toEqual({
      ok: false,
      status: 503,
      message: '未配置 ADMIN_TOKEN',
    });
  });

  it('口令正确才放行', () => {
    expect(checkAdmin(request('Bearer secret'), { ADMIN_TOKEN: 'secret' })).toEqual({ ok: true });
    expect(checkAdmin(request('Bearer wrong'), { ADMIN_TOKEN: 'secret' })).toEqual({
      ok: false,
      status: 401,
      message: '口令错误',
    });
    expect(checkAdmin(request(), { ADMIN_TOKEN: 'secret' })).toEqual({
      ok: false,
      status: 401,
      message: '口令错误',
    });
  });
});

describe('validateConfig', () => {
  it('合法 YAML 通过且无提示', () => {
    const yaml =
      'mode: rule\nproxy-providers:\n  # __PROXY_PROVIDERS__\nproxy-groups:\n  - name: a\n    use: [__PROVIDER_NAMES__]\n';
    expect(validateConfig(yaml)).toEqual({ ok: true, notices: [] });
  });

  it('语法错误被拒绝，消息取首行', () => {
    const result = validateConfig('a: [1,\n');
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('\n');
  });

  it('空内容或非对象被拒绝', () => {
    expect(validateConfig('').ok).toBe(false);
    expect(validateConfig('- a\n- b\n').ok).toBe(false);
  });

  it('缺少注入标记只提示不阻断', () => {
    const result = validateConfig('mode: rule\nrules:\n  - MATCH,DIRECT\n');
    expect(result.ok).toBe(true);
    expect(result.notices).toHaveLength(2);
  });

  it('手写 proxy-providers 时不再提示名字标记', () => {
    const result = validateConfig(
      'proxy-providers:\n  mine:\n    type: http\n    url: https://example.com\n',
    );
    expect(result.ok).toBe(true);
    expect(result.notices.some((item) => item.includes('__PROVIDER_NAMES__'))).toBe(false);
  });
});
