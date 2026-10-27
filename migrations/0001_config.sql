-- 项目未上线，无历史数据：直接重建 schema。
-- base_config：新建配置时的起点，恰好一份，可在设置页编辑。
-- configs：实际下发、带订阅链接的配置，任意份。
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
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

DROP TABLE IF EXISTS `config`;
