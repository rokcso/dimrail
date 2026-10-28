import { describe, expect, it } from 'vitest';
import { listNodeViews } from '@/worker/airport-store';
import type { Bindings } from '@/worker/env';
import { hasAvailablePoolNodes, listPoolNodes } from '@/worker/pool-store';
import { TestD1 } from './db';

function setup(): Bindings {
  const db = new TestD1();
  db.exec(`
    INSERT INTO airports
      (id, name, url, enabled, position, node_count, userinfo, fetched_at, error, error_at, truncated, refresh_lock, created_at, updated_at)
    VALUES
      ('a', 'A 机场', 'https://a.example/sub', 1, 0, 1, 'upload=1; total=10', 100, NULL, NULL, 0, NULL, 1, 1),
      ('b', 'B 机场', 'https://b.example/sub', 0, 1, 1, 'upload=2; total=20', 100, NULL, NULL, 0, NULL, 1, 1);

    INSERT INTO airport_nodes (airport_id, idx, name, type, server, port, data)
    VALUES
      ('a', 0, 'US-01', 'vmess', 'a.example', 443,
       '{"name":"US-01","type":"vmess","server":"a.example","port":443,"uuid":"a"}'),
      ('b', 0, 'JP-01', 'vless', 'b.example', 443,
       '{"name":"JP-01","type":"vless","server":"b.example","port":443,"uuid":"b"}');

    INSERT INTO node_pools (id, name, created_at, updated_at)
    VALUES ('pool-mixed', '混合', 1, 1), ('pool-disabled', '仅停用', 1, 1);

    INSERT INTO node_pool_nodes (pool_id, airport_id, node_name, node_type)
    VALUES
      ('pool-mixed', 'a', 'US-01', 'vmess'),
      ('pool-mixed', 'b', 'JP-01', 'vless'),
      ('pool-disabled', 'b', 'JP-01', 'vless');
  `);
  return { DB: db as unknown as D1Database };
}

describe('节点池与停用机场', () => {
  it('节点列表包含停用机场并标记状态', async () => {
    const env = setup();
    const rows = await listNodeViews(env);
    expect(rows.map((row) => row.airportId)).toEqual(['a', 'b']);
    expect(rows.find((row) => row.airportId === 'b')?.airportEnabled).toBe(0);
  });

  it('池输出只包含启用机场的节点', async () => {
    const env = setup();
    const nodes = await listPoolNodes(env, 'pool-mixed');
    expect(nodes.map((node) => node.name)).toEqual(['US-01']);
    expect(await hasAvailablePoolNodes(env, 'pool-mixed')).toBe(true);
  });

  it('只有停用机场的池没有可用节点', async () => {
    const env = setup();
    expect(await listPoolNodes(env, 'pool-disabled')).toEqual([]);
    expect(await hasAvailablePoolNodes(env, 'pool-disabled')).toBe(false);
  });
});
