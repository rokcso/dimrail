-- 机场：订阅链接、节点缓存、拉取状态。
-- 从 PROVIDERS_JSON 环境变量搬进 D1，可以在页面上增删改。
-- nodes 存完整 proxies 数组的 JSON：展示投一条，/providers 中转时也直接吐它。
CREATE TABLE `airports` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL UNIQUE,
  `url` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `position` integer NOT NULL DEFAULT 0,
  `nodes` text NOT NULL DEFAULT '[]',
  `node_count` integer NOT NULL DEFAULT 0,
  `userinfo` text,
  `fetched_at` integer,
  `error` text,
  `error_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
