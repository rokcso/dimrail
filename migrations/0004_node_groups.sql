-- 节点组合：从已拉取的节点里圈选一个子集，作为配置的节点来源。
-- 成员按（机场 id + 节点名 + 类型）引用，而不是复制节点内容：
-- 机场刷新后节点凭据会变，组里存的若是快照就会继续下发旧密码。
-- 名字或类型变了匹配不上时，该成员自动从下发结果里消失，不会拦住整份订阅。
CREATE TABLE `node_groups` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL UNIQUE,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `node_group_nodes` (
  `group_id` text NOT NULL,
  `airport_id` text NOT NULL,
  `node_name` text NOT NULL,
  `node_type` text NOT NULL,
  PRIMARY KEY (`group_id`, `airport_id`, `node_name`, `node_type`)
);

-- 配置的节点来源：NULL = 全部启用机场；否则只注入这个节点组。
ALTER TABLE `configs` ADD COLUMN `group_id` text;
