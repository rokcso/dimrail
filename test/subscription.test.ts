import { describe, expect, it } from 'vitest';
import { airportCreateSchema } from '@/shared/schema';
import { NODES_PER_INSERT } from '@/worker/airport-store';
import { MAX_NODES, parseProxies, toNodeViewFields } from '@/worker/subscription';

const yamlWith = (count: number) =>
  [
    'proxies:',
    ...Array.from({ length: count }, (_, i) =>
      [
        `  - name: HK-${i}`,
        '    type: ss',
        `    server: hk${i}.example.com`,
        '    port: 443',
        '    cipher: aes-128-gcm',
        '    password: secret',
      ].join('\n'),
    ),
  ].join('\n');

describe('parseProxies', () => {
  it('取出 proxies 数组', () => {
    const result = parseProxies(yamlWith(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]?.name).toBe('HK-0');
    expect(result.truncated).toBe(false);
  });

  it('超过上限只保留前面一部分并标记截断', () => {
    const result = parseProxies(yamlWith(MAX_NODES + 5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes).toHaveLength(MAX_NODES);
    expect(result.truncated).toBe(true);
  });

  it('HTML 与空内容分开报错', () => {
    expect(parseProxies('<html><body>404</body></html>')).toEqual({
      ok: false,
      error: '上游返回的是 HTML，订阅链接可能已经失效',
    });
    expect(parseProxies('   ')).toEqual({ ok: false, error: '订阅返回了空内容' });
  });

  it('没有 proxies 字段时提示格式不对', () => {
    const result = parseProxies('foo: bar');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('没有 proxies 字段');
  });

  it('proxies 为空数组时说的是节点没了', () => {
    const result = parseProxies('proxies: []');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('机场没吐任何节点');
  });

  it('不是合法 YAML 时不抛异常', () => {
    const result = parseProxies('proxies: [\n  - name: x\n');
    expect(result.ok).toBe(false);
  });
});

describe('toNodeViewFields', () => {
  it('只留展示要用的四列', () => {
    const fields = toNodeViewFields({
      name: 'HK-1',
      type: 'vmess',
      server: 'hk1.example.com',
      port: 443,
      uuid: 'should-not-leak',
      password: 'should-not-leak',
    });
    expect(fields).toEqual({
      name: 'HK-1',
      type: 'vmess',
      server: 'hk1.example.com',
      port: '443',
    });
  });

  it('字段缺失给空串', () => {
    expect(toNodeViewFields({ name: 'x' })).toEqual({
      name: 'x',
      type: '',
      server: '',
      port: '',
    });
  });
});

describe('airportCreateSchema', () => {
  it('允许中文名与空格', () => {
    for (const name of ['机场一', 'Airport A', 'airport-a', 'XX 云', 'a.b_c-1']) {
      expect(airportCreateSchema.safeParse({ name, url: 'https://x.com/sub' }).success).toBe(true);
    }
  });

  it('拒绝会破坏 YAML 或链接的名字', () => {
    for (const name of ['a:b', 'a,b', 'a/b', 'a#b', '"a"', 'a[b]']) {
      expect(airportCreateSchema.safeParse({ name, url: 'https://x.com/sub' }).success).toBe(false);
    }
  });

  it('订阅链接必须是 http(s)', () => {
    expect(airportCreateSchema.safeParse({ name: 'a', url: 'ftp://x' }).success).toBe(false);
    expect(airportCreateSchema.safeParse({ name: 'a', url: 'https://x.com/sub' }).success).toBe(
      true,
    );
  });
});

describe('节点写入分片', () => {
  it('一条 INSERT 的绑定参数不超过 D1 的 100 上限', () => {
    // 每行 7 列：airport_id, idx, name, type, server, port, data
    expect(NODES_PER_INSERT * 7).toBeLessThanOrEqual(100);
  });
});
