export interface Bindings {
  /** 管理口令，仅用于 /api/* */
  ADMIN_TOKEN?: string;
  ASSETS?: Fetcher;
  DB?: D1Database;
  /** Cloudflare Rate Limiting binding，保护 /api/* */
  ADMIN_RATE_LIMIT?: RateLimit;
}
