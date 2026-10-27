import { z } from 'zod';

const YAML_MAX = 1_000_000;
const NAME_MAX = 40;
const DISPLAY_NAME_MAX = 40;

/** 单份 YAML 内容（基础配置保存用）。 */
export const yamlPayloadSchema = z.object({ yaml: z.string().min(1).max(YAML_MAX) });

export const configCreateSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
});

/**
 * 改内容、改名、换节点来源共用一个端点：都可选，但不能都空。
 * poolId 用 null 表示「全部节点」，与「没传这个字段」区分开。
 */
export const configUpdateSchema = z
  .object({
    yaml: z.string().min(1).max(YAML_MAX).optional(),
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
    poolId: z.string().min(1).max(32).nullable().optional(),
  })
  .refine(
    (value) => value.yaml !== undefined || value.name !== undefined || value.poolId !== undefined,
    { message: '没有要保存的内容' },
  );

/**
 * 机场名 / 节点池名同时是 YAML 里的 key、代理组 use 的名字、页面上的显示名，
 * 所以只放行文字、数字、空格和 - _ . —— 冒号、逗号、斜杠这些会破坏 YAML 或链接。
 */
export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}_.\- ]+$/u;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, '名称不能为空')
  .max(DISPLAY_NAME_MAX, `名称最长 ${DISPLAY_NAME_MAX} 个字符`)
  .regex(DISPLAY_NAME_PATTERN, '名称只能用文字、数字、空格和 - _ .');

export const airportNameSchema = displayNameSchema;
export const nodePoolNameSchema = displayNameSchema;

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

/* ---------------- 节点池 ---------------- */

export const nodePoolCreateSchema = z.object({ name: nodePoolNameSchema });

export const nodePoolUpdateSchema = z.object({ name: nodePoolNameSchema });

/** 成员按（机场 + 节点名 + 类型）引用，与 /api/nodes 里的展示字段一致。 */
export const nodePoolMemberSchema = z.object({
  airportId: z.string().min(1).max(32),
  name: z.string().max(500),
  type: z.string().max(64),
});

export const nodePoolMembersPayloadSchema = z.object({
  members: z.array(nodePoolMemberSchema).max(10_000),
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
  /** NULL = 全部启用机场；否则只使用这个节点池 */
  poolId: string | null;
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
}

/** 刷新单点或全部的结果。 */
export interface RefreshResponse {
  refreshed: number;
  failed: number;
  airports: AirportSummary[];
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
  adminTokenConfigured: boolean;
  base: { seeded: boolean; updatedAt: number | null };
  configCount: number;
  poolCount: number;
}

/* ---------------- 节点池 ---------------- */

export interface NodePoolMember {
  airportId: string;
  /** 节点显示名，和机场刷新后节点表里的 name 对齐 */
  name: string;
  /** 节点类型，和 name 一起构成成员身份，避免同名不同协议被合并 */
  type: string;
}

export interface NodePoolSummary {
  id: string;
  name: string;
  /** 池里记录了多少个成员（可能包含当前已不可用的节点） */
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface NodePoolDetail extends NodePoolSummary {
  members: NodePoolMember[];
}

export interface NodePoolListResponse {
  pools: NodePoolSummary[];
}
