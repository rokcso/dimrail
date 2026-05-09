```
██████╗  ██╗ ███╗   ███╗ ██████╗   █████╗  ██╗ ██╗
██╔══██╗ ██║ ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██║
██║  ██║ ██║ ██╔████╔██║ ██████╔╝ ███████║ ██║ ██║
██║  ██║ ██║ ██║╚██╔╝██║ ██╔══██╗ ██╔══██║ ██║ ██║
██████╔╝ ██║ ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ███████╗
╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚══════╝
```

一个精心设计的 Clash/Stash 代理配置项目（纯自用），提供智能分流规则和 Cloudflare Workers 部署方案。

## 特性

- 🎯 **智能分流** - 基于 GeoIP/GeoSite 的精准分流规则
- 🔐 **隐私保护** - 通过 Workers 隐藏真实订阅链接
- 🔄 **统一部署** - 一个 Workers 服务同时支持 Stash 和 Clash
- 🚀 **性能优化** - DNS 分流、Fake-IP 模式、连接复用

## 本地使用

### 1. 克隆项目

```bash
git clone https://github.com/rokcso/dimrail.git
cd dimrail
```

### 2. 配置订阅

编辑 `configs/stash.yaml` 或 `configs/clash.yaml`，替换 `proxy-providers` 中的订阅链接：

```yaml
proxy-providers:
  ProxyProviderA:
    url: https://your-subscription-url-here  # 替换这里
```

然后在 Stash 或 Clash 中导入对应配置文件即可。

## Cloudflare Workers 部署

使用 Workers 可以隐藏你的真实订阅链接，提高安全性。**一个 Workers 服务同时支持 Stash 和 Clash 客户端**。

### 1. 配置私有订阅

```bash
cd workers
cp config.private.example.yaml config.private.yaml
```

编辑 `config.private.yaml`，填入你的真实订阅链接：

```yaml
proxy-providers:
  ProxyProviderA:
    url: https://your-real-subscription-url
  ProxyProviderB:
    url: https://your-another-subscription-url
```

### 2. 生成 Workers 脚本

```bash
python3 -m pip install -r requirements.txt
python3 generate.py
```

脚本会自动完成以下操作：
1. 读取 `configs/stash.yaml` 和 `configs/clash.yaml`
2. 合并私有订阅配置 `config.private.yaml`
3. 自动生成安全的随机访问密钥
4. 生成统一的 `workers.js` 文件

### 3. 部署到 Cloudflare

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 粘贴生成的 `workers.js` 文件内容
5. 点击 **Save and Deploy**

### 4. 订阅地址

部署成功后，通过不同路径获取对应配置：

| 客户端 | 订阅地址 |
|--------|----------|
| Stash（默认） | `https://your-worker.workers.dev/?token=你的密钥` |
| Stash | `https://your-worker.workers.dev/stash?token=你的密钥` |
| Clash | `https://your-worker.workers.dev/clash?token=你的密钥` |

## 配置差异说明

| 配置项 | Stash | Clash |
|--------|-------|-------|
| `http.url-rewrite` | ✅ 支持 | ❌ 不支持 |
| `dns.respect-rules` | ✅ 支持 | ❌ 不支持 |
| `mixed-port` | ❌ 不需要 | ✅ 需要 |
| `tun` 模式 | ❌ 使用 Enhanced Mode | ✅ 原生支持 |
| `external-controller` | ❌ 不需要 | ✅ 需要 |

## 项目结构

```
dimrail/
├── configs/
│   ├── stash.yaml        # Stash 配置模板
│   └── clash.yaml        # Clash 配置模板
├── rules/                 # 分流规则文件
│   ├── ai-offshore.yaml   # AI 服务规则
│   ├── apple-*.yaml       # Apple 相关规则
│   ├── github.yaml        # GitHub 规则
│   ├── web3.yaml          # Web3 规则
│   └── lancidr.yaml       # 国内 IP 段
└── workers/
    ├── generate.py              # 配置生成脚本
    ├── requirements.txt         # generate.py 依赖
    ├── workers.template.js      # Workers 模板
    ├── config.private.yaml      # 私有配置（不提交）
    └── workers.js               # 生成的 Workers（不提交）
```

## License

MIT License
