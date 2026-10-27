-- Dimrail 初始化 schema。
-- 项目未部署，历史迁移已合并为这一份基线。

CREATE TABLE `base_config` (
  `id` text PRIMARY KEY NOT NULL CHECK (`id` = 'base'),
  `yaml` text NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `configs` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `yaml` text NOT NULL,
  `token` text NOT NULL UNIQUE,
  -- NULL = 全部启用机场；否则只使用这个节点池
  `pool_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `airports` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL UNIQUE,
  `url` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `position` integer NOT NULL DEFAULT 0,
  `node_count` integer NOT NULL DEFAULT 0,
  `userinfo` text,
  `fetched_at` integer,
  `error` text,
  `error_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

-- 节点一行一条：真实机场几百个节点，整份 proxies 塞进一个字段会超出 D1 单值上限。
CREATE TABLE `airport_nodes` (
  `airport_id` text NOT NULL,
  `idx` integer NOT NULL,
  `name` text NOT NULL DEFAULT '',
  `type` text NOT NULL DEFAULT '',
  `server` text NOT NULL DEFAULT '',
  `port` text NOT NULL DEFAULT '',
  -- 完整 proxy 对象：转发给客户端要用 uuid / cipher / ws-opts 等全部字段
  `data` text NOT NULL,
  PRIMARY KEY (`airport_id`, `idx`)
);

CREATE TABLE `node_pools` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL UNIQUE,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

-- 成员按（机场 + 节点名 + 类型）引用，不复制节点内容。
CREATE TABLE `node_pool_nodes` (
  `pool_id` text NOT NULL,
  `airport_id` text NOT NULL,
  `node_name` text NOT NULL,
  `node_type` text NOT NULL,
  PRIMARY KEY (`pool_id`, `airport_id`, `node_name`, `node_type`)
);
