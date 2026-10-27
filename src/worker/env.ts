export interface Bindings {
  /** 机场订阅映射：{"airport-a":"https://sub.example/link/xxx"} */
  PROVIDERS_JSON?: string;
  /** 订阅访问密钥（出现在订阅链接里） */
  ACCESS_TOKEN?: string;
  /** 管理口令，仅用于 /api/config */
  ADMIN_TOKEN?: string;
  ASSETS?: Fetcher;
  DB?: D1Database;
}
