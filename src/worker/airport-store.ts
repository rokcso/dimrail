import type { AirportSummary } from '../shared/schema';
import type { Bindings } from './env';
import { generateId } from './ids';
import { removeAirportFromPools } from './pool-store';
import { type ProxyNode, toNodeViewFields } from './subscription';

export interface AirportRecord extends AirportSummary {
  nodes: ProxyNode[];
}

/** 下发配置时只需要这两列。 */
export interface ProviderRef {
  id: string;
  name: string;
}

const SUMMARY_COLUMNS =
  'id, name, url, enabled, position, node_count, userinfo, fetched_at, error, error_at, truncated, created_at, updated_at';

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
  truncated: number;
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
    truncated: row.truncated === 1,
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
  const db = requireDb(env);
  const row = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM airports WHERE id = ?`)
    .bind(id)
    .first<AirportRow>();
  if (!row) return null;
  return { ...toSummary(row), nodes: await selectNodes(env, id) };
}

/** 某个机场缓存下来的完整节点，按原顺序。 */
async function selectNodes(env: Bindings, airportId: string): Promise<ProxyNode[]> {
  const { results } = await requireDb(env)
    .prepare('SELECT data FROM airport_nodes WHERE airport_id = ? ORDER BY idx ASC')
    .bind(airportId)
    .all<{ data: string }>();

  const nodes: ProxyNode[] = [];
  for (const item of results ?? []) {
    try {
      const parsed: unknown = JSON.parse(item.data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        nodes.push(parsed as ProxyNode);
      }
    } catch {
      // 单行存坏了就跳过，别让整份缓存跟着废掉
    }
  }
  return nodes;
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

export interface NodeViewQuery {
  airportId?: string;
  keyword?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

/** 节点列表：只取展示要用的字段，凭据留在 data 里不往外送。 */
export async function listNodeViews(
  env: Bindings,
  query: NodeViewQuery = {},
): Promise<NodeViewRow[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (query.airportId) {
    clauses.push('a.id = ?');
    binds.push(query.airportId);
  }
  if (query.keyword) {
    clauses.push('(n.name LIKE ? OR n.server LIKE ?)');
    binds.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  if (query.type) {
    clauses.push('n.type = ?');
    binds.push(query.type);
  }

  let sql = `SELECT a.id AS airportId, a.name AS airportName, a.enabled AS airportEnabled,
              n.name, n.type, n.server, n.port
       FROM airport_nodes AS n
       JOIN airports AS a ON a.id = n.airport_id`;
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY a.position ASC, a.created_at ASC, n.idx ASC';
  if (query.limit) {
    sql += ' LIMIT ? OFFSET ?';
    binds.push(query.limit, query.offset ?? 0);
  }

  const statement = requireDb(env).prepare(sql);
  const { results } = await (binds.length
    ? statement.bind(...binds)
    : statement
  ).all<NodeViewRow>();
  return results ?? [];
}

export interface NodeViewRow {
  airportId: string;
  airportName: string;
  airportEnabled: number;
  name: string;
  type: string;
  server: string;
  port: string;
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
      truncated: false,
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
  if (urlChanged) {
    await db.prepare('DELETE FROM airport_nodes WHERE airport_id = ?').bind(id).run();
    await removeAirportFromPools(env, id);
  }
  await db
    .prepare(
      `UPDATE airports SET name = ?, url = ?, enabled = ?, updated_at = ?${urlChanged ? ', node_count = 0, userinfo = NULL, fetched_at = NULL, error = NULL, error_at = NULL, truncated = 0, refresh_lock = NULL' : ''}
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
    truncated: urlChanged ? 0 : row.truncated,
    fetched_at: urlChanged ? null : row.fetched_at,
    error: urlChanged ? null : row.error,
    error_at: urlChanged ? null : row.error_at,
  });
}

export async function deleteAirport(env: Bindings, id: string): Promise<boolean> {
  const db = requireDb(env);
  const [, , result] = await db.batch([
    db.prepare('DELETE FROM airport_nodes WHERE airport_id = ?').bind(id),
    db.prepare('DELETE FROM node_pool_nodes WHERE airport_id = ?').bind(id),
    db.prepare('DELETE FROM airports WHERE id = ?').bind(id),
  ]);
  return (result?.meta.changes ?? 0) > 0;
}

/** 拉取成功：覆盖节点、清错误。userinfo 为空时保留上一次的（有的机场不是每次都给）。 */
/**
 * 一次 INSERT 塞多少节点。
 * D1 单条语句最多 100 个绑定参数，这里 7 列 × 14 行 = 98，卡在上限下面。
 */
export const NODES_PER_INSERT = 14;
/** 一个 batch 里最多排多少条语句，太多会被 D1 拒。 */
const STATEMENTS_PER_BATCH = 40;

/**
 * 覆盖某个机场的节点。
 * 一行一个节点：真实机场几百个节点，塞成一个字段会超出线上 D1 的单值上限
 * （本地不报，线上直接 internal error），所以宁可多条小语句。
 *
 * 顺序是先按位置覆盖、再删掉多出来的尾部：中途失败也只是新旧混着，
 * 不会出现「旧的删了、新的没写进去」的空档。
 */
export async function saveNodes(
  env: Bindings,
  id: string,
  nodes: ProxyNode[],
  userinfo: string | null,
  truncated: boolean,
): Promise<void> {
  const db = requireDb(env);
  const now = Date.now();
  const perBatch = NODES_PER_INSERT * STATEMENTS_PER_BATCH;

  try {
    for (let start = 0; start < nodes.length; start += perBatch) {
      const stop = Math.min(start + perBatch, nodes.length);
      const statements: D1PreparedStatement[] = [];

      for (let offset = start; offset < stop; offset += NODES_PER_INSERT) {
        const slice = nodes.slice(offset, Math.min(offset + NODES_PER_INSERT, stop));
        const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = slice.flatMap((node, i) => {
          const view = toNodeViewFields(node);
          return [
            id,
            offset + i,
            view.name,
            view.type,
            view.server,
            view.port,
            JSON.stringify(node),
          ];
        });
        statements.push(
          db
            .prepare(
              `INSERT OR REPLACE INTO airport_nodes
                 (airport_id, idx, name, type, server, port, data)
               VALUES ${placeholders}`,
            )
            .bind(...values),
        );
      }
      await db.batch(statements);
    }

    await db
      .prepare('DELETE FROM airport_nodes WHERE airport_id = ? AND idx >= ?')
      .bind(id, nodes.length)
      .run();
  } catch (err) {
    throw new Error(`写入 ${nodes.length} 个节点失败：${message(err)}`);
  }

  await db
    .prepare(
      `UPDATE airports SET node_count = ?, userinfo = COALESCE(?, userinfo),
         fetched_at = ?, error = NULL, error_at = NULL, truncated = ?,
         refresh_lock = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(nodes.length, userinfo, now, truncated ? 1 : 0, now, id)
    .run();
}

/** 拉取失败：只记原因，绝不动已有节点 —— 机场挂了不该让订阅和页面一起变空。 */
export async function markError(env: Bindings, id: string, message: string): Promise<void> {
  const now = Date.now();
  await requireDb(env)
    .prepare(
      'UPDATE airports SET error = ?, error_at = ?, refresh_lock = NULL, updated_at = ? WHERE id = ?',
    )
    .bind(message, now, now, id)
    .run();
}

/** 回源锁：同一机场同一时间只让一个请求去上游。锁超过一分钟视为失效。 */
export async function acquireRefreshLock(env: Bindings, id: string): Promise<boolean> {
  const now = Date.now();
  const result = await requireDb(env)
    .prepare(
      'UPDATE airports SET refresh_lock = ? WHERE id = ? AND (refresh_lock IS NULL OR refresh_lock < ?)',
    )
    .bind(now, id, now - 60_000)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function releaseRefreshLock(env: Bindings, id: string): Promise<void> {
  await requireDb(env)
    .prepare('UPDATE airports SET refresh_lock = NULL WHERE id = ?')
    .bind(id)
    .run();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
