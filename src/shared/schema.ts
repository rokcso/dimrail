import { z } from 'zod';

const YAML_MAX = 1_000_000;
const NAME_MAX = 40;

/** 单份 YAML 内容（基础配置保存用）。 */
export const yamlPayloadSchema = z.object({ yaml: z.string().min(1).max(YAML_MAX) });

export const configCreateSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
});

/** 改内容与改名共用一个端点：两者都可选，但不能都空。 */
export const configUpdateSchema = z
  .object({
    yaml: z.string().min(1).max(YAML_MAX).optional(),
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
  })
  .refine((value) => value.yaml !== undefined || value.name !== undefined, {
    message: '没有要保存的内容',
  });

/** 基础配置。seeded 表示 D1 里还没有，读的是构建期模板。 */
export interface BaseConfigResponse {
  yaml: string;
  updatedAt: number | null;
  seeded: boolean;
}

export interface SaveResponse {
  updatedAt: number;
  notices: string[];
}

export interface ConfigSummary {
  id: string;
  name: string;
  token: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConfigDetail extends ConfigSummary {
  yaml: string;
}

export interface ConfigListResponse {
  configs: ConfigSummary[];
}

export interface TokenResponse {
  token: string;
}

export interface OverviewResponse {
  /** 机场名列表；解析 PROVIDERS_JSON 失败时 names 为空、error 是原因 */
  providers: { names: string[]; error: string | null };
  adminTokenConfigured: boolean;
  base: { seeded: boolean; updatedAt: number | null };
  configCount: number;
}
