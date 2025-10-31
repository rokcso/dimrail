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

脚本会自动完成以下操作：
1. 读取模板配置 `dimrail.yaml`
2. 合并私有订阅配置 `config.private.yaml`
3. **自动生成安全的随机访问密钥（SECRET_TOKEN）**
4. 将密钥写入并生成 `workers.js` 文件

**重要**: 脚本会在输出中显示生成的随机密钥，请妥善保存！

如需自定义密钥，可在生成后编辑 `workers.js` 文件中的 `SECRET_TOKEN` 变量。

### 3. 部署到 Cloudflare

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 上传生成的 `workers.js` 文件
6. 点击 **Save and Deploy**

### 4. 在 Stash 中使用

部署成功后，你的订阅地址为：

```
https://your-worker-name.workers.dev/?token=生成的密钥
```

将生成脚本输出的 TOKEN 替换到 URL 中，然后在 Stash 中使用此 URL 即可。
