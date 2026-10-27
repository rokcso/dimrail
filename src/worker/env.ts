export interface Bindings {
  /** 机场订阅映射：{"airport-a":"https://sub.example/link/xxx"} */
  PROVIDERS_JSON?: string;
  /** 管理口令，仅用于 /api/* */
  ADMIN_TOKEN?: string;
  ASSETS?: Fetcher;
  DB?: D1Database;
}
