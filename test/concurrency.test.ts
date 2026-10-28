import { describe, expect, it } from 'vitest';
import { getConfig, saveBase, updateConfig } from '@/worker/config-store';
import type { Bindings } from '@/worker/env';
import { setPoolMembers } from '@/worker/pool-store';
import { TestD1 } from './db';

function setup(): Bindings {
  const db = new TestD1();
  db.exec(`
    INSERT INTO configs (id, name, yaml, token, pool_id, created_at, updated_at)
    VALUES ('cfg', '配置', 'mode: rule', 'token-cfg', NULL, 1, 100);

    INSERT INTO airports
      (id, name, url, enabled, position, userinfo, fetched_at, error, error_at, truncated, refresh_lock, created_at, updated_at)
    VALUES ('a', 'A', 'https://a.example', 1, 0, NULL, NULL, NULL, NULL, 0, NULL, 1, 1);

    INSERT INTO node_pools (id, name, created_at, updated_at)
    VALUES ('pool', '池', 1, 100);
  `);
  return { DB: db as unknown as D1Database };
}

describe('乐观并发', () => {
  it('配置用旧版本更新会冲突', async () => {
    const env = setup();
    const first = await updateConfig(env, 'cfg', { name: '新名字' }, 100);
    expect(first.ok).toBe(true);

    const second = await updateConfig(env, 'cfg', { name: '另一个名字' }, 100);
    expect(second).toEqual({ ok: false, reason: 'conflict' });

    const current = await getConfig(env, 'cfg');
    expect(current?.name).toBe('新名字');
  });

  it('基础配置 null 版本只能创建一次', async () => {
    const env = setup();
    const created = await saveBase(env, 'mode: rule', null);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await saveBase(env, 'mode: global', null)).toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect((await saveBase(env, 'mode: direct', created.updatedAt)).ok).toBe(true);
    expect(await saveBase(env, 'mode: rule', created.updatedAt)).toEqual({
      ok: false,
      reason: 'conflict',
    });
  });

  it('节点池旧版本不能覆盖成员', async () => {
    const env = setup();
    const saved = await setPoolMembers(
      env,
      'pool',
      [{ airportId: 'a', name: 'N', type: 'vmess' }],
      100,
    );
    expect(saved.ok).toBe(true);

    expect(
      await setPoolMembers(env, 'pool', [{ airportId: 'a', name: 'X', type: 'vless' }], 100),
    ).toEqual({ ok: false, reason: 'conflict' });

    const rows = await env.DB?.prepare('SELECT node_name FROM node_pool_nodes WHERE pool_id = ?')
      .bind('pool')
      .all<{ node_name: string }>();
    expect(rows?.results.map((row) => row.node_name)).toEqual(['N']);
  });
});
