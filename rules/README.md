# 规则集说明

## 使用注意

规则集是列表型规则（域名 / IP 段），按需维护；日常“哪个域名走哪个组”的规则直接在 `configs/clash.yaml` 的 `rules:` 段里改。

## 规则集来源策略

**优先使用第三方维护的高质量规则集，第三方没有的才自维护。** 当前来源：

| 来源 | 覆盖的规则集 | 更新频率 | 说明 |
| --- | --- | --- | --- |
| [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) | `direct`（国内直连补充）、`lancidr`（局域网/保留 IP） | 约每日 | Clash 生态标准规则集，约 27.9k stars；文件为 YAML payload 格式（`+.` 前缀表示后缀匹配） |
| [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) | `apple-cn`、`apple`、`github`、`openai`、`anthropic`、`telegram`（+ `telegram-cidr` IP 段）、`spotify`、`youtube`、`netflix`、`disney`、`primevideo`、`hbo` | 每日 | 基于 v2fly domain-list-community，每日更新；文件为纯文本 list（`format: text`），`+.` 前缀=后缀匹配 |
| 自维护（本目录） | `ai-offshore.yaml`（AI 长尾） | 手动 | 第三方没有对应的合并规则集时才保留自维护 |

**不采用 blackmatrix7/ios_rule_script 的原因**：其文件按单个厂商拆分（OpenAI、Claude、Gemini、Copilot…），且含 `DOMAIN-KEYWORD`/`IP-CIDR` 混合条目（须用 `behavior: classical`），逐个引入会使配置碎片化；我们需要的分类（Apple/GitHub/AI 头部/流媒体）meta-rules-dat 已覆盖。若未来需要单独路由某个厂商（如仅将 OpenAI 走某线路），可再单独引入。

## 各规则集的第三方对应关系

| 原自维护文件 | 处理 | 现来源 |
| --- | --- | --- |
| cn-direct.yaml | 已删除 | Loyalsoldier `direct.txt`（含 `+.` 前缀，覆盖更全） |
| lancidr.yaml | 已删除 | Loyalsoldier `lancidr.txt`（ipcidr） |
| apple-cn.yaml | 已删除 | meta-rules-dat `apple-cn.list` |
| apple-offshore.yaml | 已删除 | meta-rules-dat `apple.list`（`apple-cn` 规则在前，直连优先） |
| github.yaml | 已删除 | meta-rules-dat `github.list` |
| ai-offshore.yaml | 裁剪 | OpenAI/Claude 头部 → meta-rules-dat `openai.list` / `anthropic.list`；长尾保留自维护 |
| ~~web3.yaml~~ | 已删除 | Web3 流量回归默认线路，无需独立规则集 |

## 规则集维护最佳实践

### 1. 定义规则集内容

规则集文件格式的选择取决于其要在 `rules` 中使用的 `behavior` 类型和维护/性能需求。

| 格式 | behavior 类型 |
| --- | --- |
| YAML | ipcidr / domain / classical |
| List | ipcidr / domain |
| TXT | classical |

可见 TXT 格式已经过时，当前主要为了兼容旧配置而存在，YAML 虽然文件体积稍大，但是结构清晰、支持注释，适合个人维护。所以我优先使用 YAML 文件格式维护规则集。规则集通过 `rule-providers` 由客户端（FlClash/Mihomo）按配置的 interval 定时拉取，URL 使用 jsdelivr CDN（国内可达性更好）。

**建议**：

- 规则条数超过 1 万时，使用 List 格式以提升性能
- 需要 classical 规则类型时，直接在主配置的 `rules` 中配置，不在规则集中声明
- 优先使用 YAML 格式，便于维护和添加注释

规则集示例：

```yaml
payload:
  - scholar.google.ae
  - scholar.google.at
  - scholar.google.be
```

> **behavior 语义提醒**（mihomo 源码确认）：`behavior: domain` 下，裸域名（`example.com`）**只精确匹配**该域名本身，`+.` 前缀（`+.example.com`）才匹配域名及所有子域名。第三方 list 通常已带 `+.` 前缀，自维护文件请同样使用 `+.` 表达后缀匹配意图。

### 2. 在 `rule-providers` 声明规则集

```yaml
rule-providers:
  google:
    type: http
    behavior: domain
    url: https://fastly.jsdelivr.net/gh/rokcso/dimrail@main/rules/google.yaml # 规则集托管地址
    interval: 86400
```

### 3. 在 `rules` 使用规则集

```yaml
rules:
  # - RULE-SET,声明的规则集名称,定义的代理策略组
  - RULE-SET,google,Google
```

## 自维护文件清单

- `ai-offshore.yaml` — AI 长尾厂商（Gemini、Copilot、Perplexity、Grok、Midjourney、HuggingFace 等）。OpenAI/ChatGPT 与 Claude/Anthropic 已由第三方覆盖，改动前先确认对应第三方 list 是否已包含。
- （已删除）原 web3.yaml — Web3 流量回归默认线路后不再需要独立规则集。
