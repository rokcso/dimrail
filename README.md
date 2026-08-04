```
██████╗  ██╗ ███╗   ███╗ ██████╗   █████╗  ██╗ ██╗
██╔══██╗ ██║ ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██║
██║  ██║ ██║ ██╔████╔██║ ██████╔╝ ███████║ ██║ ██║
██║  ██║ ██║ ██║╚██╔╝██║ ██╔══██╗ ██╔══██║ ██║ ██║
██████╔╝ ██║ ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ███████╗
╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚══════╝
```

# Dimrail

开源的 Clash Meta（Mihomo）代理配置项目：通过 Cloudflare Worker 做订阅中转，聚合多个机场订阅，并下发你自己维护的分流规则。日常配合 [FlClash](https://github.com/chen08209/FlClash) 使用，客户端只需订阅一个地址。

## 特性

- 🎯 **自控分流**：手写规则直接写在 `configs/clash.yaml` 的 `rules:` 段，哪个域名走哪个组一目了然
- 🔀 **多机场聚合**：任意多个机场订阅存于 Cloudflare Secret，Worker 统一中转，配置里不暴露真实订阅链接
- 🔐 **私有入口**：所有请求需要 `?token=` 访问密钥，密钥同样存于 Secret，不进仓库
- 🚀 **Clash Meta 特性**：Sniffer、Fake-IP、DNS 分流、节点自动测速（TUN/端口由 FlClash 客户端管理）
- ⚡ **一键部署**：`npm run deploy`，或配置 GitHub Actions 后 push 即自动部署

## 架构

```
┌─ FlClash（只订阅一个地址）───────────────────────────┐
│  https://<worker>.workers.dev/?token=xxx            │
└───────────────┬──────────────────────────┬──────────┘
                │ ① 拉取主配置               │ ③ 按需拉取各机场节点
                ▼                          ▼
        ┌───────────────────────────────────────┐
        │            Cloudflare Worker           │
        │  GET /                   → Clash 主配置 │
        │  GET /providers/<name>   → 中转机场订阅  │
        └──────────────┬──────────────┬──────────┘
                       │ ② fetch      │ ④ fetch
                       ▼              ▼
              ┌──────────────┐  ┌──────────────┐
              │ 机场 A（Secret）│  │ 机场 B（Secret）│
              └──────────────┘  └──────────────┘
```

主配置由构建脚本读取 `configs/clash.yaml` 生成；`proxy-providers` 段在 Worker 请求时从 Secret 注入，其中每个 provider 的 `url` 都指向 Worker 自己的 `/providers/<name>` 中转地址——**配置中不出现任何真实机场链接**。中转时会先把机场订阅**裁剪为纯 `proxies` 节点列表**再返回，机场自带的 rules / proxy-groups / dns 等一律丢弃。

## 快速开始

前置：Node.js 18+、一个 Cloudflare 账号（免费计划即可）。

```bash
# 1. 克隆并安装
git clone https://github.com/rokcso/dimrail.git
cd dimrail
npm install

# 2. 登录 Cloudflare（浏览器授权一次）
npx wrangler login

# 3. 配置两个 Secret：机场订阅映射 + 访问密钥
npx wrangler secret put PROVIDERS_JSON   # 输入: {"机场A":"https://sub.xxx/link/...","机场B":"https://sub.yyy/link/..."}
npx wrangler secret put ACCESS_TOKEN     # 生成: openssl rand -hex 24

# 4. 部署
npm run deploy

# 5. FlClash 中添加订阅
#    https://<你的worker>.workers.dev/?token=<ACCESS_TOKEN>
```

> 说明：`PROVIDERS_JSON` 的键（机场名）只允许字母、数字、`_`、`-`；值必须是机场订阅 URL（一般带 `?client=clashmetasimple` 之类的参数）。

## 日常使用

| 想做什么 | 怎么做 |
|---|---|
| 改分流规则 | 编辑 `configs/clash.yaml` 的 `rules:` 段 → `npm run deploy`（或 push） |
| 加 / 换机场 | `npx wrangler secret put PROVIDERS_JSON` 更新映射，无需重新部署 |
| 换访问密钥 | `npx wrangler secret put ACCESS_TOKEN` 后重新部署 |
| 本地调试 | `cp .dev.vars.example .dev.vars` 填入测试值 → `npm run dev` |

规则集（`rules/*.yaml`）通过 `rule-providers` 由客户端从 jsdelivr CDN 定时拉取，与 Worker 相互独立，详见 `rules/README.md`。

## GitHub Actions 自动部署

push 到 `main` 即自动部署（也可手动触发）。需要在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（权限：Workers Scripts 编辑） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `PROVIDERS_JSON` | 同上面的机场订阅映射 |
| `ACCESS_TOKEN` | 同上面的访问密钥 |

之后日常改规则只需 `git push`。

## 本地独立使用（不经过 Worker）

如果你不需要中转，直接把 `configs/clash.yaml` 中 `proxy-providers` 的 `url` 替换为机场订阅链接，然后在 FlClash 中导入该文件即可。

## 项目结构

```
dimrail/
├── configs/
│   └── clash.yaml              # 主配置模板（手写分流规则、代理组、DNS；端口/TUN 由 FlClash 接管）
├── rules/                      # 列表型规则集（rule-providers 远端拉取）
│   ├── ai-offshore.yaml        # 仅保留自维护：AI 长尾（头部走第三方）
│   ├── web3.yaml               # 仅保留自维护：Web3（第三方无合集）
│   └── README.md               # 规则集来源策略与维护说明
├── workers/
│   └── src/
│       ├── worker.js           # Worker 源码（鉴权 / 主配置 / 订阅中转）
│       └── config.generated.js # 构建产物（git 忽略，勿手改）
├── scripts/
│   └── generate.mjs            # 构建脚本：读取 clash.yaml，注入运行时标记
├── wrangler.jsonc              # Wrangler 配置
├── .github/workflows/deploy.yml
└── package.json
```

## License

MIT License
