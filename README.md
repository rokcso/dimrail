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

## 路由

```
GET  /admin                   YAML 编辑器（管理口令）
GET  /?token=<ACCESS_TOKEN>   Clash 主配置（proxy-providers 由 Worker 注入）
GET  /providers/<机场名>       机场订阅中转（裁剪成 proxies）
GET  /api/config              读取当前配置
PUT  /api/config              保存配置
```

## 依赖的 Secret

| 名称 | 用途 |
|---|---|
| `PROVIDERS_JSON` | 机场映射：`{"airport-a":"https://sub.example/link/xxx"}` |
| `ACCESS_TOKEN` | 订阅访问密钥，出现在订阅链接里 |
| `ADMIN_TOKEN` | `PUT /api/config` 的管理口令，与订阅链接分离 |

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars      # 填入三个变量
pnpm db:migrate:local               # 建 config 表
pnpm dev
```

- 后台：<http://localhost:5173/admin>（口令见 `.dev.vars` 的 `ADMIN_TOKEN`）
- 订阅：<http://127.0.0.1:8787/?token=<ACCESS_TOKEN>>

开发时后台走 Vite（5173），订阅接口在 Worker（8787），两者通过 `/api` 代理连接。

## 部署

```bash
wrangler d1 create dimrail           # 把 database_id 填进 wrangler.jsonc
wrangler d1 migrations apply dimrail --remote

wrangler secret put PROVIDERS_JSON
wrangler secret put ACCESS_TOKEN
wrangler secret put ADMIN_TOKEN

pnpm deploy
```

之后改配置只需要打开 `/admin` 编辑保存。

## 配置是怎么组装的

`configs/clash.yaml` 是模板源。`pnpm gen` 在构建期做两件事：

1. `proxy-providers:` 段 → `  # __PROXY_PROVIDERS__` 标记
2. 代理组的 `use: [ProxyProviderA]` → `use: [__PROVIDER_NAMES__]` 标记

产物 `src/generated/config.ts` 同时用作两个用途：D1 为空时的兜底配置，以及编辑器首次打开时的内容。

请求订阅时，Worker 读取 D1 里的配置（没有则用兜底），在运行时把两个标记替换成真实机场：

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
├── web/             React SPA：单页 YAML 编辑器
└── shared/          前后端共享的 Zod schema 与 DTO
configs/clash.yaml   模板源
migrations/          D1 迁移
scripts/generate.mjs 模板编译
```

技术栈：Cloudflare Worker + D1，Vite + React 19 + TanStack Query，shadcn（base-nova / Base UI），Tailwind v4，CodeMirror 6，Radix Colors。

## 安全

- 管理口令用常量时间比较，只存在 localStorage；订阅密钥与它分离，订阅链接泄露不影响写入权限。
- 机场 URL 只存在 Secret 与 D1 的 provider 注入结果里，不会出现在下发给客户端的配置中。
- 未配置 `ADMIN_TOKEN` 时配置接口返回 503。

## License

MIT License
