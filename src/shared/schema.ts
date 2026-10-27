import { z } from 'zod';

const YAML_MAX = 1_000_000;
const NAME_MAX = 40;
const AIRPORT_NAME_MAX = 40;

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

/**
 * 机场名同时是 YAML 里的 proxy-providers key、代理组 use 的名字、页面上的显示名，
 * 所以只放行文字、数字、空格和 - _ . —— 冒号、逗号、斜杠这些会破坏 YAML 或链接。
 */
export const AIRPORT_NAME_PATTERN = /^[\p{L}\p{N}_.\- ]+$/u;

export const airportNameSchema = z
  .string()
  .trim()
  .min(1, '机场名不能为空')
  .max(AIRPORT_NAME_MAX, `机场名最长 ${AIRPORT_NAME_MAX} 个字符`)
  .regex(AIRPORT_NAME_PATTERN, '机场名只能用文字、数字、空格和 - _ .');

export const airportUrlSchema = z
  .string()
  .trim()
  .max(2000, '订阅链接太长')
  .refine((value) => /^https?:\/\/\S+$/i.test(value), '订阅链接必须是 http(s) 地址');

export const airportCreateSchema = z.object({
  name: airportNameSchema,
  url: airportUrlSchema,
});

export const airportUpdateSchema = z
  .object({
    name: airportNameSchema.optional(),
    url: airportUrlSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.url !== undefined || value.enabled !== undefined,
    { message: '没有要修改的内容' },
  );

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

/* ---------------- 机场 ---------------- */

export interface AirportSummary {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  position: number;
  nodeCount: number;
  /** 上游给的 subscription-userinfo 原文 */
  userinfo: string | null;
  fetchedAt: number | null;
  /** 最近一次拉取失败的原因；成功后清空，旧节点保留 */
  error: string | null;
  errorAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AirportListResponse {
  airports: AirportSummary[];
  /** PROVIDERS_JSON 里还剩几个没导入（0 表示这个环境变量可以删了） */
  legacyEnvCount: number;
}

/** 刷新单点或全部的结果。 */
export interface RefreshResponse {
  refreshed: number;
  failed: number;
  airports: AirportSummary[];
}

export interface AirportImportResponse {
  imported: number;
  skipped: number;
  total: number;
}

/** 展示用节点：只给这几列，uuid 和密码不往浏览器送。 */
export interface NodeView {
  name: string;
  type: string;
  server: string;
  port: string;
  airportId: string;
  airportName: string;
}

export interface NodesResponse {
  nodes: NodeView[];
  /** 全部机场里最近一次成功拉取的时间 */
  fetchedAt: number | null;
  /** 机场数、失败数，给表头一句话用 */
  airports: { total: number; failed: number };
}

export interface OverviewResponse {
  airports: { count: number; nodeCount: number; failed: number };
  legacyEnvCount: number;
  adminTokenConfigured: boolean;
  base: { seeded: boolean; updatedAt: number | null };
  configCount: number;
}
