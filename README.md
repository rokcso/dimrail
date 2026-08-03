```
██████╗  ██╗ ███╗   ███╗ ██████╗   █████╗  ██╗ ██╗
██╔══██╗ ██║ ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██║
██║  ██║ ██║ ██╔████╔██║ ██████╔╝ ███████║ ██║ ██║
██║  ██║ ██║ ██║╚██╔╝██║ ██╔══██╗ ██╔══██║ ██║ ██║
██████╔╝ ██║ ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ███████╗
╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚══════╝
```

# Dimrail

一个面向 Clash Meta 内核客户端的个人代理配置项目，提供可维护的智能分流规则，以及可选的 Cloudflare Workers 私有订阅入口。FlClash 可直接使用生成后的订阅地址。

## 特性

- 精准分流：基于 GeoIP、GeoSite 和自维护规则集处理国内服务、AI、Apple、GitHub、Web3 和流媒体等流量。
- Clash Meta 配置：启用 TUN、Sniffer、Fake-IP、DNS 分流和节点自动测速。
- 私有订阅入口：可通过 Cloudflare Workers 隐藏上游订阅地址，并以 token 保护配置。
- 多订阅源：生成脚本可将任意数量的上游 provider 自动注入到配置中。

## 使用 FlClash

1. 先按下文的“本地使用”或“Cloudflare Workers 部署”准备配置。
2. 在 FlClash 中添加订阅；本地使用时导入 `configs/clash.yaml`，Workers 部署时填入生成脚本输出的 URL。
3. 在 FlClash 启用配置后，按需要开启 TUN 模式。控制器默认仅监听 `127.0.0.1:9090`，不会对局域网开放。

本项目使用 Clash Meta/Mihomo 配置语法；请使用支持该内核的 FlClash 版本。

## 本地使用

编辑 `configs/clash.yaml`，将 `proxy-providers` 中的示例 `url` 替换为你的订阅链接：

```yaml
proxy-providers:
  ProxyProviderA:
    url: https://your-subscription-url-here
```

本地模板默认使用一个订阅源。如需注入多个上游订阅源并避免在配置中保存真实链接，请使用 Workers 生成流程。

## Cloudflare Workers 部署

Workers 将真实订阅链接嵌入生成的配置中，只暴露由 token 保护的 Clash 配置入口。

### 1. 创建私有订阅配置

```bash
cd workers
cp config.private.example.yaml config.private.yaml
```

编辑 `config.private.yaml` 并填入至少一个真实订阅链接。provider 名称可自定义：

```yaml
proxy-providers:
  MainProvider:
    url: https://your-real-subscription-url
  BackupProvider:
    url: https://your-another-subscription-url
```

### 2. 生成 Worker 脚本

```bash
python3 -m pip install -r requirements.txt
python3 generate.py
```

脚本会读取 `configs/clash.yaml`，合并私有 provider，生成或复用随机访问密钥，并写入 `workers/workers.js`。私有配置和生成文件均已被 Git 忽略。

### 3. 部署并添加到 FlClash

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages**。
2. 创建 Worker，将 `workers/workers.js` 的内容粘贴进去并部署。
3. 将输出的地址添加到 FlClash：

```text
https://your-worker.workers.dev/?token=你的密钥
```

Worker 只接受根路径 `/`；其他路径会返回 `404`。

## 配置说明

- `configs/clash.yaml`：Clash Meta/Mihomo 主配置模板。
- `rules/`：自维护规则集，规则格式和新增方式见 `rules/README.md`。
- 控制器默认绑定 `127.0.0.1`。若调整为可被外部访问，务必把 `secret` 换成随机强密码。
- 规则匹配顺序是：局域网和国内服务直连 → 指定服务分流 → 中国 GeoSite/GeoIP 直连 → 默认线路兜底。

## 项目结构

```text
dimrail/
├── configs/
│   └── clash.yaml                # Clash Meta 配置模板
├── rules/                        # 分流规则集
│   ├── ai-offshore.yaml
│   ├── apple-*.yaml
│   ├── cn-direct.yaml
│   ├── github.yaml
│   ├── lancidr.yaml
│   └── web3.yaml
└── workers/
    ├── config.private.example.yaml
    ├── generate.py               # 生成 Worker 脚本
    ├── requirements.txt
    ├── workers.template.js
    └── workers.js                # 生成文件，不提交
```

## License

MIT License
