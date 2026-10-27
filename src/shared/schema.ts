import { z } from 'zod';

export const configPayloadSchema = z.object({
  yaml: z.string().min(1).max(1_000_000),
});

export interface ConfigResponse {
  yaml: string;
  updatedAt: number | null;
  /** 是否来自构建期模板（D1 里还没有保存过） */
  seeded: boolean;
}

export interface SaveResponse {
  updatedAt: number;
  notices: string[];
}
