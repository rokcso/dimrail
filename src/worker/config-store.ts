import { CONFIG_TEMPLATE } from '../generated/config';
import type { Bindings } from './env';

const CONFIG_ID = 'default';

export interface LoadedConfig {
  yaml: string;
  updatedAt: number | null;
  seeded: boolean;
}

function requireDb(env: Bindings): D1Database {
  if (!env.DB) throw new Error('未绑定 D1（env.DB）');
  return env.DB;
}

/** 运行时配置：优先 D1，没有则回退构建期模板。 */
export async function loadConfig(env: Bindings): Promise<LoadedConfig> {
  const row = await requireDb(env)
    .prepare('SELECT yaml, updated_at FROM config WHERE id = ?')
    .bind(CONFIG_ID)
    .first<{ yaml: string; updated_at: number }>();

  if (row?.yaml) {
    return { yaml: row.yaml, updatedAt: row.updated_at, seeded: false };
  }
  return { yaml: CONFIG_TEMPLATE, updatedAt: null, seeded: true };
}

export async function saveConfig(env: Bindings, yaml: string): Promise<number> {
  const updatedAt = Date.now();
  await requireDb(env)
    .prepare(
      `INSERT INTO config (id, yaml, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET yaml = excluded.yaml, updated_at = excluded.updated_at`,
    )
    .bind(CONFIG_ID, yaml, updatedAt)
    .run();
  return updatedAt;
}
