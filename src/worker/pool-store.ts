import type { NodePoolDetail, NodePoolMember, NodePoolSummary } from '../shared/schema';
import type { Bindings } from './env';
import { generateId } from './ids';
import type { ProxyNode } from './subscription';

const SUMMARY_COLUMNS = `
  g.id, g.name, g.created_at, g.updated_at,
  (SELECT COUNT(*) FROM node_pool_nodes AS m WHERE m.pool_id = g.id) AS node_count
`;

interface PoolRow {
  id: string;
  name: string;
  node_count: number;
  created_at: number;
  updated_at: number;
}

interface MemberRow {
  airport_id: string;
  node_name: string;
  node_type: string;
}

/** 一条 INSERT 塞多少成员：4 列 × 25 行 = 100，正好卡在 D1 的绑定参数上限。 */
export const MEMBERS_PER_INSERT = 25;
const STATEMENTS_PER_BATCH = 40;

function requireDb(env: Bindings): D1Database {
  if (!env.DB) throw new Error('未绑定 D1（env.DB）');
  return env.DB;
}

function toSummary(row: PoolRow): NodePoolSummary {
  return {
    id: row.id,
    name: row.name,
    nodeCount: row.node_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPools(env: Bindings): Promise<NodePoolSummary[]> {
  const { results } = await requireDb(env)
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM node_pools AS g ORDER BY g.created_at ASC, g.id ASC`)
    .all<PoolRow>();
  return (results ?? []).map(toSummary);
}

export async function getPoolSummary(env: Bindings, id: string): Promise<NodePoolSummary | null> {
  const row = await requireDb(env)
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM node_pools AS g WHERE g.id = ?`)
    .bind(id)
    .first<PoolRow>();
  return row ? toSummary(row) : null;
}

export async function getPool(env: Bindings, id: string): Promise<NodePoolDetail | null> {
  const summary = await getPoolSummary(env, id);
  if (!summary) return null;
  return { ...summary, members: await selectMembers(env, id) };
}

async function selectMembers(env: Bindings, id: string): Promise<NodePoolMember[]> {
  const { results } = await requireDb(env)
    .prepare(
      'SELECT airport_id, node_name, node_type FROM node_pool_nodes WHERE pool_id = ? ORDER BY airport_id ASC, node_name ASC, node_type ASC',
    )
    .bind(id)
    .all<MemberRow>();
  return (results ?? []).map((row) => ({
    airportId: row.airport_id,
    name: row.node_name,
    type: row.node_type,
  }));
}

export async function nameTaken(env: Bindings, name: string, exceptId?: string): Promise<boolean> {
  const row = await requireDb(env)
    .prepare('SELECT id FROM node_pools WHERE name = ? LIMIT 1')
    .bind(name)
    .first<{ id: string }>();
  return Boolean(row) && row?.id !== exceptId;
}

export async function countPools(env: Bindings): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COUNT(*) AS n FROM node_pools')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createPool(env: Bindings, name: string): Promise<NodePoolSummary> {
  const db = requireDb(env);
  const now = Date.now();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    if (await db.prepare('SELECT 1 AS hit FROM node_pools WHERE id = ?').bind(id).first()) continue;

    await db
      .prepare('INSERT INTO node_pools (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, now, now)
      .run();

    return { id, name, nodeCount: 0, createdAt: now, updatedAt: now };
  }

  throw new Error('生成节点池 ID 失败，请重试');
}

export async function renamePool(
  env: Bindings,
  id: string,
  name: string,
): Promise<NodePoolSummary | null> {
  const updatedAt = Date.now();
  const result = await requireDb(env)
    .prepare('UPDATE node_pools SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, updatedAt, id)
    .run();
  if ((result.meta.changes ?? 0) === 0) return null;
  return getPoolSummary(env, id);
}

export async function deletePool(env: Bindings, id: string): Promise<boolean> {
  const db = requireDb(env);
  const [, result] = await db.batch([
    db.prepare('DELETE FROM node_pool_nodes WHERE pool_id = ?').bind(id),
    db.prepare('DELETE FROM node_pools WHERE id = ?').bind(id),
  ]);
  return (result?.meta.changes ?? 0) > 0;
}

/** 整池覆盖成员：先删再加。按（机场, 名字, 类型）去重。 */
export async function setPoolMembers(
  env: Bindings,
  id: string,
  members: NodePoolMember[],
): Promise<number> {
  const db = requireDb(env);
  const unique = new Map<string, NodePoolMember>();
  for (const member of members) {
    unique.set(`${member.airportId}\u0000${member.name}\u0000${member.type}`, member);
  }
  const rows = [...unique.values()];

  try {
    let first = true;
    for (let start = 0; start < rows.length; start += MEMBERS_PER_INSERT * STATEMENTS_PER_BATCH) {
      const stop = Math.min(start + MEMBERS_PER_INSERT * STATEMENTS_PER_BATCH, rows.length);
      const statements: D1PreparedStatement[] = [];

      if (first) {
        statements.push(db.prepare('DELETE FROM node_pool_nodes WHERE pool_id = ?').bind(id));
        first = false;
      }

      for (let offset = start; offset < stop; offset += MEMBERS_PER_INSERT) {
        const slice = rows.slice(offset, Math.min(offset + MEMBERS_PER_INSERT, stop));
        const placeholders = slice.map(() => '(?, ?, ?, ?)').join(', ');
        const values = slice.flatMap((member) => [id, member.airportId, member.name, member.type]);
        statements.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO node_pool_nodes
                 (pool_id, airport_id, node_name, node_type)
               VALUES ${placeholders}`,
            )
            .bind(...values),
        );
      }
      await db.batch(statements);
    }

    if (rows.length === 0) {
      await db.prepare('DELETE FROM node_pool_nodes WHERE pool_id = ?').bind(id).run();
    }

    await db
      .prepare('UPDATE node_pools SET updated_at = ? WHERE id = ?')
      .bind(Date.now(), id)
      .run();
  } catch (err) {
    throw new Error(`写入 ${rows.length} 个节点成员失败：${message(err)}`);
  }

  return rows.length;
}

/**
 * 池内成员对应的当前节点。
 * 只取启用机场、且名字与类型仍能对上的节点：机场刷新后凭据会自动更新，
 * 消失的节点则自然从结果里掉出去。
 */
export async function listPoolNodes(env: Bindings, id: string): Promise<ProxyNode[]> {
  const { results } = await requireDb(env)
    .prepare(
      `SELECT n.data
       FROM node_pool_nodes AS m
       JOIN airports AS a ON a.id = m.airport_id
       JOIN airport_nodes AS n
         ON n.airport_id = m.airport_id AND n.name = m.node_name AND n.type = m.node_type
       WHERE m.pool_id = ? AND a.enabled = 1
       ORDER BY a.position ASC, a.created_at ASC, n.idx ASC`,
    )
    .bind(id)
    .all<{ data: string }>();

  const nodes: ProxyNode[] = [];
  for (const item of results ?? []) {
    try {
      const parsed: unknown = JSON.parse(item.data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        nodes.push(parsed as ProxyNode);
      }
    } catch {
      // 单行存坏了就跳过，别让整池跟着废掉
    }
  }
  return nodes;
}

/** 机场被删除或换链接时，把它从所有池里摘掉。 */
export async function removeAirportFromPools(env: Bindings, airportId: string): Promise<void> {
  await requireDb(env)
    .prepare('DELETE FROM node_pool_nodes WHERE airport_id = ?')
    .bind(airportId)
    .run();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
