```
██████╗  ██╗ ███╗   ███╗ ██████╗   █████╗  ██╗ ██╗
██╔══██╗ ██║ ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██║
██║  ██║ ██║ ██╔████╔██║ ██████╔╝ ███████║ ██║ ██║
██║  ██║ ██║ ██║╚██╔╝██║ ██╔══██╗ ██╔══██║ ██║ ██║
██████╔╝ ██║ ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ███████╗
╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚══════╝
```

# Dimrail

个人 Clash 订阅中转：把多个机场聚合成一个 provider 集合，下发自己的分流配置。
可以从机场节点里手选子集组成节点池，让某份配置只使用这个节点池里的节点。

配置、机场订阅和节点池都存在 D1，在 `/admin` 里改完立即生效，不需要重新部署。

## 多份配置

- **基础配置**（只有一份）：新建配置时的起点，可以在 `/admin/settings` 里改。
- **配置**（可以有很多份）：每份有自己的 id、名字、YAML 和订阅链接，各自独立下发。

新建配置时会把**当时的基础配置文本复制一份**进去，之后改基础配置不影响已经存在的配置。
每份配置有自己的 token，泄漏只影响那一份，也可以就地重新生成链接。

## 机场

机场（订阅链接）也在 `/admin/airports` 里管理：贴链接 → 立刻拉一次 → 节点存进 D1。

- 节点一行一条存在 `airport_nodes` 里，不是机场行上的一个大字段 —— 真实机场几百个节点，
  整份 JSON 塞进去会超出 D1 单值上限（线上直接 `internal error`，本地却不报）。
- 节点只在后台展示 `{名称, 类型, 服务器, 端口, 来源}`，uuid / 密码 / ws-opts 不下发到浏览器。
- 中转 `/sub/<配置 id>/providers/airports/<机场 id>` 直接读缓存：3 小时内不再回源；过期了才重拉，重拉失败就吐旧缓存
  （响应头 `X-Cache: stale`），机场抽风时订阅不会变空。
- 拉取失败只记错误、**不清空**已经拿到的节点，页面会标出「上次拉取失败 + 显示的是几点的缓存」。
- 单个订阅超过 2000 个节点会截断并在页面上标出来。
- 只支持 Clash 格式（`proxies:` 数组），v2ray / base64 订阅会直接报错，不会猜。

## 节点池

`/admin/pools` 里可以把任意节点（可以跨机场）圈成一个节点池，比如「US 精选」「低倍率」。

- 成员按**机场 + 节点名 + 类型**引用，不复制节点内容。机场刷新换密码后池里自动用新凭据；
  节点被改名或下架时，该成员会从下发结果里消失，不会把整份订阅带坏。
- 池里只包含启用机场的节点；停用/删除机场会把它从池里摘掉。
- 节点池被配置使用时不允许删除，需要先把那些配置改成别的来源。
- 每份配置在配置页顶部选择节点来源：**全部节点**，或者某个节点池。切换立即生效，
  不用保存 YAML。

## 路由

```
GET  /admin                       重定向到 /admin/configs
GET  /admin/configs               配置列表 + YAML 编辑器（管理口令）
GET  /admin/configs/<id>          选中某份配置
GET  /admin/airports              机场列表 + 全部节点
GET  /admin/airports/<id>         选中某个机场
GET  /admin/pools                节点池列表
GET  /admin/pools/<id>           选中某个节点池
GET  /admin/settings              重定向到 /admin/settings/base
GET  /admin/settings/base         基础配置

GET  /sub/<配置 id>?token=<token>                          Clash 主配置（proxy-providers 由 Worker 注入）
GET  /sub/<配置 id>/providers/airports/<机场 id>?token=    机场订阅中转（D1 缓存，原样回传 proxies）
GET  /sub/<配置 id>/providers/pools/<节点池 id>?token=     节点池中转（按成员读取当前节点）

GET  /api/overview                概览：机场、配置数、节点池数、基础配置状态
GET  /api/base-config             读取基础配置
PUT  /api/base-config             保存基础配置
POST /api/base-config/reset       恢复为出厂模板
GET  /api/configs                 配置列表
POST /api/configs                 新建配置（快照当前基础配置）
GET  /api/configs/<id>            读取一份配置
PUT  /api/configs/<id>            保存（YAML / 名字 / 节点来源 poolId）
DELETE /api/configs/<id>          删除
POST /api/configs/<id>/token      重新生成订阅 token

GET  /api/airports                机场列表
POST /api/airports                添加机场（顺手拉一次）
PATCH /api/airports/<id>          改名 / 换链接 / 启停
DELETE /api/airports/<id>         删除
POST /api/airports/<id>/refresh   重新拉取单个机场
POST /api/airports/refresh        重新拉取所有启用的机场
GET  /api/nodes                   所有节点（已裁剪，只给展示字段）

GET  /api/pools                  节点池列表
POST /api/pools                  新建节点池
GET  /api/pools/<id>             读取节点池（含成员引用）
PATCH /api/pools/<id>            改名
DELETE /api/pools/<id>           删除（被配置使用时返回 409）
PUT  /api/pools/<id>/nodes       整池覆盖成员
POST /api/pools/<id>/reconcile   清理已不存在的成员
```

## 依赖的 Secret

| 名称 | 用途 |
|---|---|
| `ADMIN_TOKEN` | `/admin` 与 `/api/*` 的管理口令 |

机场订阅链接存在 D1 里，在 `/admin/airports` 添加。

订阅链接的 token 也不再走 Secret：每份配置一条，存在 D1 里，可以在后台查看和重新生成。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars      # 填 ADMIN_TOKEN
pnpm db:migrate:local               # 建 base_config / configs / airports / node_pools 等表
pnpm dev
```

- 后台：<http://localhost:5173/admin>（口令见 `.dev.vars` 的 `ADMIN_TOKEN`）
- 改完迁移**先停 `pnpm dev`** 再动 `.wrangler/state`：跑着的 workerd 手里那个 SQLite
  句柄会失效，之后每个接口都回 `internal error; reference = …`（看着像功能坏了，
  其实重启 dev 就好）。线上同款文案则先确认 `pnpm db:migrate:remote` 跑过。
- 订阅链接：在后台新建配置后，从页面底部复制

开发时后台走 Vite（5173），订阅接口在 Worker（8787），两者通过 `/api` 代理连接。

## 自动化

- Cloudflare Cron 每 6 小时刷新启用机场并预热 provider 缓存。
- provider 响应带 ETag；同一机场的并发回源由 D1 锁合并。
- 配置保存带乐观并发检查，多标签页同时改会返回 409。
- 配置页支持预览最终订阅；节点池支持按机场/类型/关键词批量选择。

## 部署

```bash
wrangler d1 create dimrail           # 把 database_id 填进 wrangler.jsonc
wrangler d1 migrations apply dimrail --remote

wrangler secret put ADMIN_TOKEN

pnpm deploy
```

之后改配置只需要打开 `/admin` 编辑保存。

## 配置是怎么组装的

`configs/clash.yaml` 是模板源。`pnpm gen` 在构建期做两件事：

1. `proxy-providers:` 段 → `  # __PROXY_PROVIDERS__` 标记
2. 代理组的 `use: [ProxyProviderA]` → `use: [__PROVIDER_NAMES__]` 标记

产物 `src/generated/config.ts` 是**出厂模板**：`base_config` 表里还没有内容时，基础配置就显示它；
「恢复出厂模板」也是把表清空回到它。

请求订阅时，Worker 读那份配置的 YAML，在运行时把两个标记替换成真实机场（注入用的 token 是**该配置自己的 token**）：

- `# __PROXY_PROVIDERS__` → 每个机场（或配置选中的那个节点池）一个 `proxy-providers` 条目，
  URL 指向本 Worker 的 `/sub/<配置 id>/providers/airports/<机场 id>` 或 `/sub/<配置 id>/providers/pools/<节点池 id>`
- `__PROVIDER_NAMES__` → 来源名列表（YAML key 用名字，一律加引号）

所以配置里不会出现真实机场链接，新增机场也只要在后台加一行。

## 编辑器的校验

保存时只做三件事：

- YAML 能解析，且是对象
- 否则拒绝保存
- 缺少注入标记只给提示，不阻断

## 项目结构

```
src/
├── worker/          Worker：订阅、provider 中转、机场 / 节点池 / 配置读写
├── web/             React SPA：配置列表、机场、节点池、设置
└── shared/          前后端共享的 Zod schema 与 DTO
configs/clash.yaml   模板源
migrations/          D1 迁移
scripts/generate.mjs 模板编译
```

技术栈：Cloudflare Worker + D1，Vite + React 19 + TanStack Router + TanStack Query，shadcn（base-nova / Base UI），Tailwind v4，CodeMirror 6，Radix Colors（亮/暗）。

## 安全

- 管理口令先哈希再做常量时间比较，只存在 localStorage；订阅 token 与它分离，订阅链接泄露不影响写入权限。
- `/api/*` 有 60 次/分钟的 Rate Limiting；后台响应带 CSP、frame deny、noindex 等安全头。
- 每份配置一条 token；provider URL 绑定配置 id，token 只能读取自己那份配置的来源。
- 机场 URL 只存在 D1 里，不会出现在下发给客户端的配置中；节点凭据也只留在 Worker 侧，
  后台列表拿到的字段是裁剪过的。
- 未配置 `ADMIN_TOKEN` 时配置接口返回 503。

## License

MIT License
