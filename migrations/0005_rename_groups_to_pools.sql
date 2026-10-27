-- 节点组改名为节点池：只改存储名，成员与配置数据原样保留。
ALTER TABLE `node_groups` RENAME TO `node_pools`;
ALTER TABLE `node_group_nodes` RENAME TO `node_pool_nodes`;
ALTER TABLE `node_pool_nodes` RENAME COLUMN `group_id` TO `pool_id`;
ALTER TABLE `configs` RENAME COLUMN `group_id` TO `pool_id`;
