import type { AirportSummary } from '../shared/schema';
import type { Bindings } from './env';
import { generateId } from './ids';
import type { ProxyNode } from './subscription';

export interface AirportRecord extends AirportSummary {
  nodes: ProxyNode[];
}

/** 下发配置时只需要这两列。 */
export interface ProviderRef {
  id: string;
  name: string;
}

const SUMMARY_COLUMNS =
  'id, name, url, enabled, position, node_count, userinfo, fetched_at, error, error_at, created_at, updated_at';

interface AirportRow {
  id: string;
  name: string;
  url: string;
  enabled: number;
  position: number;
  node_count: number;
  userinfo: string | null;
  fetched_at: number | null;
  error: string | null;
  error_at: number | null;
  created_at: number;
  updated_at: number;
}

function requireDb(env: Bindings): D1Database {
  if (!env.DB) throw new Error('未绑定 D1（env.DB）');
  return env.DB;
}

function toSummary(row: AirportRow): AirportSummary {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled === 1,
    position: row.position,
    nodeCount: row.node_count,
    userinfo: row.userinfo,
    fetchedAt: row.fetched_at,
    error: row.error,
    errorAt: row.error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAirports(env: Bindings): Promise<AirportSummary[]> {
  const { results } = await requireDb(env)
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM airports ORDER BY position ASC, created_at ASC`)
    .all<AirportRow>();
  return (results ?? []).map(toSummary);
}

export async function getAirport(env: Bindings, id: string): Promise<AirportRecord | null> {
  const row = await requireDb(env)
    .prepare(`SELECT ${SUMMARY_COLUMNS}, nodes FROM airports WHERE id = ?`)
    .bind(id)
    .first<AirportRow & { nodes: string }>();
  if (!row) return null;

  let nodes: ProxyNode[] = [];
  try {
    const parsed: unknown = JSON.parse(row.nodes);
    if (Array.isArray(parsed)) nodes = parsed as ProxyNode[];
  } catch {
    // 存坏了当作没有缓存，下次拉取会覆盖
  }
  return { ...toSummary(row), nodes };
}

/** 下发用：启用的机场，按 position 排。 */
export async function listProviderRefs(env: Bindings): Promise<ProviderRef[]> {
  const { results } = await requireDb(env)
    .prepare(
      'SELECT id, name FROM airports WHERE enabled = 1 ORDER BY position ASC, created_at ASC',
    )
    .all<{ id: string; name: string }>();
  return results ?? [];
}

/** 节点展示用：启用的机场连同缓存一起拿出来。 */
export async function listNodeSources(
  env: Bindings,
): Promise<{ id: string; name: string; nodes: ProxyNode[] }[]> {
  const { results } = await requireDb(env)
    .prepare(
      'SELECT id, name, nodes FROM airports WHERE enabled = 1 ORDER BY position ASC, created_at ASC',
    )
    .all<{ id: string; name: string; nodes: string }>();

  return (results ?? []).map((row) => {
    let nodes: ProxyNode[] = [];
    try {
      const parsed: unknown = JSON.parse(row.nodes);
      if (Array.isArray(parsed)) nodes = parsed as ProxyNode[];
    } catch {
      // 存坏了当作没有缓存
    }
    return { id: row.id, name: row.name, nodes };
  });
}

export async function countAirports(env: Bindings): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COUNT(*) AS n FROM airports')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countNodes(env: Bindings): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COALESCE(SUM(node_count), 0) AS n FROM airports WHERE enabled = 1')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countFailed(env: Bindings): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COUNT(*) AS n FROM airports WHERE error IS NOT NULL')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 各机场的 subscription-userinfo 原文，聚合交给 provider.aggregateUserinfo。 */
export async function listUserinfo(env: Bindings): Promise<string[]> {
  const { results } = await requireDb(env)
    .prepare('SELECT userinfo FROM airports WHERE enabled = 1 AND userinfo IS NOT NULL')
    .all<{ userinfo: string }>();
  return (results ?? []).map((row) => row.userinfo);
}

export async function nameTaken(env: Bindings, name: string, exceptId?: string): Promise<boolean> {
  const row = await requireDb(env)
    .prepare('SELECT id FROM airports WHERE name = ? LIMIT 1')
    .bind(name)
    .first<{ id: string }>();
  return Boolean(row) && row?.id !== exceptId;
}

async function nextPosition(env: Bindings): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM airports')
    .first<{ p: number }>();
  return (row?.p ?? -1) + 1;
}

export async function createAirport(
  env: Bindings,
  input: { name: string; url: string },
): Promise<AirportSummary> {
  const db = requireDb(env);
  const now = Date.now();
  const position = await nextPosition(env);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    if (await db.prepare('SELECT 1 AS hit FROM airports WHERE id = ?').bind(id).first()) continue;

    await db
      .prepare(
        'INSERT INTO airports (id, name, url, enabled, position, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)',
      )
      .bind(id, input.name, input.url, position, now, now)
      .run();

    return {
      id,
      name: input.name,
      url: input.url,
      enabled: true,
      position,
      nodeCount: 0,
      userinfo: null,
      fetchedAt: null,
      error: null,
      errorAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  throw new Error('生成机场 ID 失败，请重试');
}

export async function updateAirport(
  env: Bindings,
  id: string,
  patch: { name?: string; url?: string; enabled?: boolean },
): Promise<AirportSummary | null> {
  const db = requireDb(env);
  const row = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM airports WHERE id = ?`)
    .bind(id)
    .first<AirportRow>();
  if (!row) return null;

  const next = {
    name: patch.name ?? row.name,
    url: patch.url ?? row.url,
    enabled: patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
  };
  const updatedAt = Date.now();

  // 换了订阅链接就把旧缓存和旧错误一起清掉，免得显示上一家的节点。
  const urlChanged = next.url !== row.url;
  await db
    .prepare(
      `UPDATE airports SET name = ?, url = ?, enabled = ?, updated_at = ?${urlChanged ? ", nodes = '[]', node_count = 0, userinfo = NULL, fetched_at = NULL, error = NULL, error_at = NULL" : ''}
       WHERE id = ?`,
    )
    .bind(next.name, next.url, next.enabled, updatedAt, id)
    .run();

  return toSummary({
    ...row,
    name: next.name,
    url: next.url,
    enabled: next.enabled,
    updated_at: updatedAt,
    node_count: urlChanged ? 0 : row.node_count,
    userinfo: urlChanged ? null : row.userinfo,
    fetched_at: urlChanged ? null : row.fetched_at,
    error: urlChanged ? null : row.error,
    error_at: urlChanged ? null : row.error_at,
  });
}

export async function deleteAirport(env: Bindings, id: string): Promise<boolean> {
  const result = await requireDb(env).prepare('DELETE FROM airports WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

/** 拉取成功：覆盖节点、清错误。userinfo 为空时保留上一次的（有的机场不是每次都给）。 */
export async function saveNodes(
  env: Bindings,
  id: string,
  nodes: ProxyNode[],
  userinfo: string | null,
): Promise<void> {
  const now = Date.now();
  await requireDb(env)
    .prepare(
      `UPDATE airports SET nodes = ?, node_count = ?, userinfo = COALESCE(?, userinfo),
         fetched_at = ?, error = NULL, error_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(JSON.stringify(nodes), nodes.length, userinfo, now, now, id)
    .run();
}

/** 拉取失败：只记原因，绝不动已有节点 —— 机场挂了不该让订阅和页面一起变空。 */
export async function markError(env: Bindings, id: string, message: string): Promise<void> {
  const now = Date.now();
  await requireDb(env)
    .prepare('UPDATE airports SET error = ?, error_at = ?, updated_at = ? WHERE id = ?')
    .bind(message, now, now, id)
    .run();
}
