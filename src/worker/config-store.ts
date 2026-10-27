import { CONFIG_TEMPLATE } from '../generated/config';
import type { ConfigSummary } from '../shared/schema';
import type { Bindings } from './env';
import { generateId, generateToken } from './ids';

// 保持对外导出，测试与调用方仍从 config-store 取

const BASE_ID = 'base';

export interface LoadedBase {
  yaml: string;
  updatedAt: number | null;
  /** D1 里还没有，读的是构建期模板 */
  seeded: boolean;
}

export interface ConfigRecord extends ConfigSummary {
  yaml: string;
}

export { generateId, generateToken };

function requireDb(env: Bindings): D1Database {
  if (!env.DB) throw new Error('未绑定 D1（env.DB）');
  return env.DB;
}

/* ---------------- 基础配置 ---------------- */

export async function loadBase(env: Bindings): Promise<LoadedBase> {
  const row = await requireDb(env)
    .prepare('SELECT yaml, updated_at FROM base_config WHERE id = ?')
    .bind(BASE_ID)
    .first<{ yaml: string; updated_at: number }>();

  if (row?.yaml) return { yaml: row.yaml, updatedAt: row.updated_at, seeded: false };
  return { yaml: CONFIG_TEMPLATE, updatedAt: null, seeded: true };
}

export async function saveBase(env: Bindings, yaml: string): Promise<number> {
  const updatedAt = Date.now();
  await requireDb(env)
    .prepare(
      `INSERT INTO base_config (id, yaml, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET yaml = excluded.yaml, updated_at = excluded.updated_at`,
    )
    .bind(BASE_ID, yaml, updatedAt)
    .run();
  return updatedAt;
}

/** 恢复出厂：删掉 D1 那一行，读接口重新回落构建期模板。 */
export async function resetBase(env: Bindings): Promise<void> {
  await requireDb(env).prepare('DELETE FROM base_config WHERE id = ?').bind(BASE_ID).run();
}

/* ---------------- 配置 ---------------- */

interface ConfigRow {
  id: string;
  name: string;
  yaml: string;
  token: string;
  group_id: string | null;
  created_at: number;
  updated_at: number;
}

function toRecord(row: ConfigRow): ConfigRecord {
  return {
    id: row.id,
    name: row.name,
    yaml: row.yaml,
    token: row.token,
    groupId: row.group_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConfigs(env: Bindings): Promise<ConfigSummary[]> {
  const { results } = await requireDb(env)
    .prepare(
      'SELECT id, name, token, group_id, created_at, updated_at FROM configs ORDER BY created_at ASC, id ASC',
    )
    .all<Omit<ConfigRow, 'yaml'>>();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    token: row.token,
    groupId: row.group_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getConfig(env: Bindings, id: string): Promise<ConfigRecord | null> {
  const row = await requireDb(env)
    .prepare(
      'SELECT id, name, yaml, token, group_id, created_at, updated_at FROM configs WHERE id = ?',
    )
    .bind(id)
    .first<ConfigRow>();

  return row ? toRecord(row) : null;
}

export async function countConfigs(env: Bindings): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COUNT(*) AS n FROM configs')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 新建：以当前基础配置为快照，之后与基础配置无关。 */
export async function createConfig(env: Bindings, name?: string): Promise<ConfigRecord> {
  const base = await loadBase(env);
  const db = requireDb(env);
  const now = Date.now();
  const finalName = name?.trim() || `配置 ${(await countConfigs(env)) + 1}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    const token = generateToken();
    const clash = await db.prepare('SELECT 1 AS hit FROM configs WHERE id = ?').bind(id).first();
    if (clash) continue;

    await db
      .prepare(
        'INSERT INTO configs (id, name, yaml, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, finalName, base.yaml, token, now, now)
      .run();

    return {
      id,
      name: finalName,
      yaml: base.yaml,
      token,
      groupId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  throw new Error('生成配置 ID 失败，请重试');
}

export async function updateConfig(
  env: Bindings,
  id: string,
  patch: { yaml?: string; name?: string; groupId?: string | null },
): Promise<{ updatedAt: number } | null> {
  const current = await getConfig(env, id);
  if (!current) return null;

  const updatedAt = Date.now();
  const groupId = patch.groupId === undefined ? current.groupId : patch.groupId;
  await requireDb(env)
    .prepare('UPDATE configs SET yaml = ?, name = ?, group_id = ?, updated_at = ? WHERE id = ?')
    .bind(patch.yaml ?? current.yaml, patch.name?.trim() || current.name, groupId, updatedAt, id)
    .run();

  return { updatedAt };
}

export async function deleteConfig(env: Bindings, id: string): Promise<boolean> {
  const result = await requireDb(env).prepare('DELETE FROM configs WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function regenerateToken(env: Bindings, id: string): Promise<string | null> {
  const token = generateToken();
  const result = await requireDb(env)
    .prepare('UPDATE configs SET token = ? WHERE id = ?')
    .bind(token, id)
    .run();
  return (result.meta.changes ?? 0) > 0 ? token : null;
}

/** 删除节点组前检查：有多少份配置正拿它当节点来源。 */
export async function countConfigsUsingGroup(env: Bindings, groupId: string): Promise<number> {
  const row = await requireDb(env)
    .prepare('SELECT COUNT(*) AS n FROM configs WHERE group_id = ?')
    .bind(groupId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 订阅侧鉴权：这个 token 是否属于某一份配置。 */
export async function tokenExists(env: Bindings, token: string): Promise<boolean> {
  if (!token) return false;
  const row = await requireDb(env)
    .prepare('SELECT 1 AS hit FROM configs WHERE token = ? LIMIT 1')
    .bind(token)
    .first();
  return Boolean(row);
}
