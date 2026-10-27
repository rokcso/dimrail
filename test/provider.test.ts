import { describe, expect, it } from 'vitest';
import { buildProvidersYaml, type ProviderSource, providerNames } from '@/worker/provider';

const sources: ProviderSource[] = [
  { id: 'a1', name: '机场 A', kind: 'airport' },
  { id: 'g1', name: 'US 精选', kind: 'group' },
];

describe('buildProvidersYaml', () => {
  it('机场与节点组走各自的 URL 和缓存文件', () => {
    const yaml = buildProvidersYaml(sources, 'https://sub.example.com', 'tok');
    expect(yaml).toContain('url: https://sub.example.com/providers/airports/a1?token=tok');
    expect(yaml).toContain('path: ./providers/a1.yaml');
    expect(yaml).toContain('url: https://sub.example.com/providers/groups/g1?token=tok');
    expect(yaml).toContain('path: ./providers/group-g1.yaml');
  });

  it('名字一律加引号，避免 YAML 保留字和纯数字变成别的类型', () => {
    const yaml = buildProvidersYaml(
      [
        { id: 'a1', name: 'true', kind: 'airport' },
        { id: 'a2', name: '123', kind: 'airport' },
        { id: 'a3', name: 'null', kind: 'airport' },
      ],
      'https://example.com',
      'tok',
    );
    expect(yaml).toContain('  "true":');
    expect(yaml).toContain('  "123":');
    expect(yaml).toContain('  "null":');
    expect(providerNames([{ id: 'g1', name: '123', kind: 'group' }])).toBe('"123"');
  });
});
