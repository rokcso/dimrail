-- 节点从「机场行里的一个 JSON 大字段」拆成一行一个节点。
-- 原因：真实机场动辄几百个节点，整份 proxies 序列化后是一条很肥的写入，
-- 线上 D1 会直接拒（internal error / SQLITE_TOOBIG），本地 miniflare 却放得过去。
-- 拆行以后每条语句都很小，也顺便能按机场、按位置查。

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

-- 把已经存下的 JSON 数组搬进来（通常只有几条测试数据，但搬过来最省事）
INSERT INTO airport_nodes (airport_id, idx, name, type, server, port, data)
SELECT
  a.id,
  CAST(j.key AS integer),
  CAST(COALESCE(json_extract(j.value, '$.name'), '') AS text),
  CAST(COALESCE(json_extract(j.value, '$.type'), '') AS text),
  CAST(COALESCE(json_extract(j.value, '$.server'), '') AS text),
  CAST(COALESCE(json_extract(j.value, '$.port'), '') AS text),
  CAST(j.value AS text)
FROM airports AS a, json_each(a.nodes) AS j;

-- airports.nodes 先留着不再写（DROP COLUMN 在 D1 上的支持没有百分之百把握，
-- 删列失败会让整份迁移卡住，不值当）。旧值最多占点空间，读的地方已经不看它了。
