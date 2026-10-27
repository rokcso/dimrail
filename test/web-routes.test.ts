import { describe, expect, it } from 'vitest';
import { normalizePath, parseAdminPath } from '@/web/routes';

describe('normalizePath', () => {
  it('根路径与旧入口回配置列表', () => {
    expect(normalizePath('/')).toBe('/admin/configs');
    expect(normalizePath('/admin')).toBe('/admin/configs');
    expect(normalizePath('/admin/')).toBe('/admin/configs');
  });

  it('保留资源 id，并去掉尾部斜杠', () => {
    expect(normalizePath('/admin/configs/abc')).toBe('/admin/configs/abc');
    expect(normalizePath('/admin/airports/abc/')).toBe('/admin/airports/abc');
    expect(normalizePath('/admin/groups/abc')).toBe('/admin/groups/abc');
  });

  it('设置页规范到分组路径', () => {
    expect(normalizePath('/admin/settings')).toBe('/admin/settings/base');
    expect(normalizePath('/admin/settings/base')).toBe('/admin/settings/base');
    expect(normalizePath('/admin/settings/overview')).toBe('/admin/settings/overview');
  });

  it('未知路径回到配置列表', () => {
    expect(normalizePath('/admin/whatever')).toBe('/admin/configs');
    expect(normalizePath('/admin/configs/a/b')).toBe('/admin/configs');
    expect(normalizePath('/admin/configs/中文')).toBe('/admin/configs');
  });
});

describe('parseAdminPath', () => {
  it('解析列表与详情', () => {
    expect(parseAdminPath('/admin/configs')).toEqual({ name: 'configs', id: null });
    expect(parseAdminPath('/admin/configs/abc')).toEqual({ name: 'configs', id: 'abc' });
    expect(parseAdminPath('/admin/airports/a1')).toEqual({ name: 'airports', id: 'a1' });
    expect(parseAdminPath('/admin/groups/g1')).toEqual({ name: 'groups', id: 'g1' });
  });

  it('解析设置分组', () => {
    expect(parseAdminPath('/admin/settings/base')).toEqual({
      name: 'settings',
      section: 'base',
    });
    expect(parseAdminPath('/admin/settings/overview')).toEqual({
      name: 'settings',
      section: 'overview',
    });
  });
});
