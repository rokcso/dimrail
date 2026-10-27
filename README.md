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

配置存在 D1，在 `/admin` 里编辑保存后立即生效，不需要重新部署。

## 多份配置

- **基础配置**（只有一份）：新建配置时的起点，可以在 `/admin/settings` 里改。
- **配置**（可以有很多份）：每份有自己的 id、名字、YAML 和订阅链接，各自独立下发。

新建配置时会把**当时的基础配置文本复制一份**进去，之后改基础配置不影响已经存在的配置。
每份配置有自己的 token，泄漏只影响那一份，也可以就地重新生成链接。

## 路由

```
GET  /admin                       配置列表 + YAML 编辑器（管理口令）
GET  /admin/settings              基础配置与概览

GET  /p/<id>?token=<token>        Clash 主配置（proxy-providers 由 Worker 注入）
GET  /providers/<机场名>?token=    机场订阅中转（裁剪成 proxies）

GET  /api/overview                概览：机场、配置数、基础配置状态
GET  /api/base-config             读取基础配置
PUT  /api/base-config             保存基础配置
POST /api/base-config/reset       恢复为出厂模板
GET  /api/configs                 配置列表
POST /api/configs                 新建配置（快照当前基础配置）
GET  /api/configs/<id>            读取一份配置
PUT  /api/configs/<id>            保存（YAML 和/或名字）
DELETE /api/configs/<id>          删除
POST /api/configs/<id>/token      重新生成订阅 token
```

## 依赖的 Secret

| 名称 | 用途 |
|---|---|
| `PROVIDERS_JSON` | 机场映射：`{"airport-a":"https://sub.example/link/xxx"}` |
| `ADMIN_TOKEN` | `/admin` 与 `/api/*` 的管理口令 |

订阅链接的 token 不再走 Secret：每份配置一条，存在 D1 里，可以在后台查看和重新生成。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars      # 填入两个变量
pnpm db:migrate:local               # 建 base_config / configs 表
pnpm dev
```

- 后台：<http://localhost:5173/admin>（口令见 `.dev.vars` 的 `ADMIN_TOKEN`）
- 订阅链接：在后台新建配置后，从页面底部复制

开发时后台走 Vite（5173），订阅接口在 Worker（8787），两者通过 `/api` 代理连接。

## 部署

```bash
wrangler d1 create dimrail           # 把 database_id 填进 wrangler.jsonc
wrangler d1 migrations apply dimrail --remote

wrangler secret put PROVIDERS_JSON
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

- `# __PROXY_PROVIDERS__` → 每个机场一个 `proxy-providers` 条目，URL 指向本 Worker 的 `/providers/<机场名>`
- `__PROVIDER_NAMES__` → 机场名列表

所以配置里不会出现真实机场链接，新增机场也只需要改 `PROVIDERS_JSON`。

## 编辑器的校验

保存时只做三件事：

- YAML 能解析，且是对象
- 否则拒绝保存
- 缺少注入标记只给提示，不阻断

## 项目结构

```
src/
├── worker/          Worker：订阅、provider 中转、配置读写
├── web/             React SPA：配置列表与设置页
└── shared/          前后端共享的 Zod schema 与 DTO
configs/clash.yaml   模板源
migrations/          D1 迁移
scripts/generate.mjs 模板编译
```

技术栈：Cloudflare Worker + D1，Vite + React 19 + TanStack Query，shadcn（base-nova / Base UI），Tailwind v4，CodeMirror 6，Radix Colors。

## 安全

- 管理口令用常量时间比较，只存在 localStorage；订阅 token 与它分离，订阅链接泄露不影响写入权限。
- 每份配置一条 token，`/providers/<机场名>` 只校验这个 token 属于任意一份配置。
- 机场 URL 只存在 Secret 与 D1 的 provider 注入结果里，不会出现在下发给客户端的配置中。
- 未配置 `ADMIN_TOKEN` 时配置接口返回 503。

## License

MIT License
