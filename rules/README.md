使用注意：

我的 `reject.yaml` 极度保守，一般不建议使用。

## 个人向规则集维护最佳实践

1. 定义规则集内容

规则集文件格式的选择取决于其要在 `rules` 中使用的 `behavior` 类型和维护/性能需求。

| 格式 | behavior 类型 |
| --- | --- |
| YAML | • ipcidr </br> • domain </br> • classical |
| List | • ipcidr </br> • domain |
| TXT | • classical |

可见 TXT 格式已经过时，当前主要为了兼容旧配置而存在，YAML 虽然文件体积稍大，但是结构清晰、支持注释，适合个人维护。所以我优先使用 YAML 文件格式维护规则集。

其他：

- 如果规则条数超过 1 万时，考虑使用 List 文件格式；
- 所有需要 classical 规则类型时，直接在 `rules` 中配置，不在规则集中声明。

规则集示例：

```yaml
payload:
  - scholar.google.ae
  - scholar.google.at
  - scholar.google.be
```

2. 在 `rule-providers` 声明规则集

```yaml
rule-providers:
  google:
    type: http
    behavior: domain
    url: https://raw.githubusercontent.com/rokcso/dimrail/refs/heads/main/rules/google.yaml # 规则集托管地址
    interval: 86400
```

3. 在 `rules` 使用规则集

```yaml
rules:
  # - RULE-SET,声明的规则集名称,定义的代理策略组
  - RULE-SET,google,Google
```
