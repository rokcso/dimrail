export interface Bindings {
  /** 管理口令，仅用于 /api/* */
  ADMIN_TOKEN?: string;
  ASSETS?: Fetcher;
  DB?: D1Database;
}
