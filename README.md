```
██████╗  ██╗ ███╗   ███╗ ██████╗   █████╗  ██╗ ██╗
██╔══██╗ ██║ ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██║
██║  ██║ ██║ ██╔████╔██║ ██████╔╝ ███████║ ██║ ██║
██║  ██║ ██║ ██║╚██╔╝██║ ██╔══██╗ ██╔══██║ ██║ ██║
██████╔╝ ██║ ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ███████╗
╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚══════╝
```

一个精心设计的 Stash 代理配置项目（纯自用），提供智能分流规则和 Cloudflare Workers 部署方案。

## 本地使用

### 1. 克隆项目

```bash
git clone https://github.com/rokcso/dimrail.git
cd dimrail
```

### 2. 直接使用配置

如果你只是想直接使用配置文件：

```bash
# 编辑 dimrail.yaml，替换为你的订阅链接
vim dimrail.yaml

# 找到 proxy-providers 部分，替换示例 URL
proxy-providers:
  ProxyProviderA:
    url: https://your-subscription-url-here  # 替换这里
```

然后在 Stash 中导入 `dimrail.yaml` 即可。

## Cloudflare Workers 部署

使用 Workers 可以隐藏你的真实订阅链接，提高安全性。

### 1. 配置私有订阅

```bash
cd workers
cp config.private.example.yaml config.private.yaml
vim config.private.yaml
```

编辑 `config.private.yaml`，填入你的真实订阅链接：

```yaml
proxy-providers:
  ProxyProviderA:
    url: https://your-real-subscription-url
    interval: 10800
    benchmark-url: http://www.gstatic.com/generate_204
    benchmark-timeout: 10
```

### 2. 生成 Workers 脚本

```bash
python3 generate.py
```

脚本会：
1. 读取模板配置 `dimrail.yaml`
2. 合并私有订阅配置 `config.private.yaml`
3. 生成 `workers.js` 文件

### 3. 部署到 Cloudflare

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 打开生成的 `workers.js` 文件
5. **修改 SECRET_TOKEN** 为你的自定义密钥（重要！）
   ```javascript
   const SECRET_TOKEN = "your-custom-secret-token-here";
   ```
6. 复制全部内容到 Worker 编辑器
7. 点击 **Save and Deploy**

### 4. 在 Stash 中使用

部署成功后，你的订阅地址为：

```
https://your-worker-name.workers.dev/?token=your-custom-secret-token-here
```

在 Stash 中使用此 URL 即可。

### 5. 更新配置

1. 修改 `dimrail.yaml` 或规则集文件或私有订阅配置
2. 如果使用 Workers 部署：
   ```bash
   cd workers
   python3 generate.py
   ```
3. 将新生成的 `workers.js` 部署到 Cloudflare

## 项目结构

```
dimrail/
├── dimrail.yaml              # 主配置文件（模板）
├── LICENSE                   # MIT 许可证
├── README.md                 # 项目说明文档
├── rules/                    # 规则集目录
│   ├── README.md            # 规则集使用说明
│   ├── ai-offshore.yaml     # AI 服务规则
│   ├── apple-cn.yaml        # Apple 中国服务规则
│   ├── apple-offshore.yaml  # Apple 境外服务规则
│   ├── github.yaml          # GitHub 规则
│   ├── lancidr.yaml         # 本地网络规则
│   └── reject.yaml          # 拦截规则
└── workers/                  # Cloudflare Workers 部署
    ├── config.private.example.yaml  # 私有配置示例
    ├── config.private.yaml          # 私有配置（不提交）
    ├── generate.py                  # 配置生成脚本
    ├── workers.template.js          # Workers 模板
    └── workers.js                   # 生成的 Workers 脚本
```

## 配置详解

### 自定义规则集

如需添加自定义规则，参考 `rules/README.md` 中的最佳实践：

1. 在 `rules/` 目录创建 YAML 文件
2. 在 `dimrail.yaml` 的 `rule-providers` 中声明
3. 在 `rules` 部分使用规则集

示例：

```yaml
# 1. 创建规则集文件 rules/custom.yaml
payload:
  - example.com
  - +.example.org

# 2. 在 dimrail.yaml 声明规则集
rule-providers:
  custom:
    type: http
    behavior: domain
    url: https://raw.githubusercontent.com/yourusername/dimrail/main/rules/custom.yaml
    interval: 86400

# 3. 使用规则集
rules:
  - RULE-SET,custom,默认线路
```
