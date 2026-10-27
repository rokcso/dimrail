import { describe, expect, it } from 'vitest';
import { parseRoute } from '@/worker/routes';

describe('parseRoute', () => {
  it('根路径', () => {
    expect(parseRoute('/')).toEqual({ kind: 'root' });
    expect(parseRoute('')).toEqual({ kind: 'root' });
    expect(parseRoute('///')).toEqual({ kind: 'root' });
  });

  it('管理 API', () => {
    expect(parseRoute('/api/configs')).toEqual({ kind: 'api', path: '/api/configs' });
    expect(parseRoute('/api/configs/abc/token/')).toEqual({
      kind: 'api',
      path: '/api/configs/abc/token',
    });
    expect(parseRoute('/api')).toEqual({ kind: 'api', path: '/api' });
  });

  it('配置订阅路径', () => {
    expect(parseRoute('/p/k3m9x2qa')).toEqual({ kind: 'config', id: 'k3m9x2qa' });
    expect(parseRoute('/p/k3m9x2qa/')).toEqual({ kind: 'config', id: 'k3m9x2qa' });
    expect(parseRoute('/p/')).toEqual({ kind: 'notFound' });
    expect(parseRoute('/p/a/b')).toEqual({ kind: 'notFound' });
    expect(parseRoute('/p/中文')).toEqual({ kind: 'notFound' });
  });

  it('机场中转路径', () => {
    expect(parseRoute('/providers/airport-a')).toEqual({ kind: 'provider', id: 'airport-a' });
    expect(parseRoute('/providers/airport-a/')).toEqual({ kind: 'provider', id: 'airport-a' });
    expect(parseRoute('/providers/k3m9x2qa')).toEqual({ kind: 'provider', id: 'k3m9x2qa' });
    expect(parseRoute('/providers')).toEqual({ kind: 'notFound' });
  });

  it('节点组订阅路径', () => {
    expect(parseRoute('/groups/grp-1')).toEqual({ kind: 'group', id: 'grp-1' });
    expect(parseRoute('/groups/grp-1/')).toEqual({ kind: 'group', id: 'grp-1' });
    expect(parseRoute('/groups')).toEqual({ kind: 'notFound' });
    expect(parseRoute('/groups/a/b')).toEqual({ kind: 'notFound' });
    expect(parseRoute('/admin/groups')).toEqual({ kind: 'assets' });
  });

  it('其余交给静态资源', () => {
    expect(parseRoute('/admin')).toEqual({ kind: 'assets' });
    expect(parseRoute('/admin/settings')).toEqual({ kind: 'assets' });
    expect(parseRoute('/assets/index-abc.js')).toEqual({ kind: 'assets' });
    expect(parseRoute('/favicon.svg')).toEqual({ kind: 'assets' });
  });
});
