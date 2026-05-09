#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dimrail 配置生成脚本
功能: 合并模板配置和私有订阅，生成统一的 Cloudflare Workers 脚本
支持: 同时支持 Stash 和 Clash 配置，通过路径区分
"""

import yaml
import copy
import os
import sys
import secrets
import string
import re


def generate_secret_token(length=32):
    """Generate secure random token"""
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def extract_token_from_workers(workers_file):
    """Extract SECRET_TOKEN from existing workers.js file"""
    try:
        with open(workers_file, "r", encoding="utf-8") as f:
            content = f.read()
        match = re.search(r'const SECRET_TOKEN = "([^"]+)";', content)
        if match:
            return match.group(1)
    except OSError:
        pass
    return None


def load_yaml_file(path):
    """Load YAML file and always return a mapping"""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def merge_mappings(base, overrides):
    """Recursively merge mapping values without discarding nested defaults"""
    merged = copy.deepcopy(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_mappings(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def load_private_providers(private_file):
    """Load private providers and validate they contain usable subscription URLs"""
    private_config = load_yaml_file(private_file)
    providers = private_config.get("proxy-providers", {})

    if not providers:
        raise ValueError("workers/config.private.yaml 中至少需要配置一个 proxy-provider")

    validated = {}
    for provider_name, provider_config in providers.items():
        if not isinstance(provider_config, dict):
            raise ValueError(f"proxy-providers.{provider_name} 必须是一个映射")

        url = str(provider_config.get("url", "")).strip()
        if not url:
            raise ValueError(f"proxy-providers.{provider_name}.url 不能为空")
        if "example.com/sub" in url:
            raise ValueError(
                f"proxy-providers.{provider_name}.url 仍然是示例占位地址，请替换为真实订阅链接"
            )

        validated[provider_name] = copy.deepcopy(provider_config)

    return validated


def build_provider_path(provider_name, index):
    """Build a stable path for custom Clash proxy providers"""
    slug = re.sub(r"[^0-9A-Za-z._-]+", "_", provider_name).strip("._-").lower()
    if not slug:
        slug = f"provider_{index}"
    return f"./providers/{index:02d}_{slug}.yaml"


def build_proxy_providers(template_providers, private_providers, client_type):
    """Build proxy providers using template defaults plus private overrides"""
    provider_defaults = copy.deepcopy(next(iter(template_providers.values()), {}))
    built_providers = {}

    for index, (provider_name, provider_config) in enumerate(private_providers.items(), start=1):
        provider_template = template_providers.get(provider_name, provider_defaults)
        provider = merge_mappings(provider_template, provider_config)

        if client_type == "clash":
            provider.setdefault("type", "http")
            provider.setdefault("interval", 10800)
            provider.setdefault(
                "health-check",
                {
                    "enable": True,
                    "interval": 300,
                    "url": "http://www.gstatic.com/generate_204",
                },
            )
            if provider_name not in template_providers and "path" not in provider_config:
                provider["path"] = build_provider_path(provider_name, index)
            else:
                provider.setdefault("path", build_provider_path(provider_name, index))
        else:
            provider.setdefault("interval", 10800)
            provider.setdefault("benchmark-url", "http://www.gstatic.com/generate_204")
            provider.setdefault("benchmark-timeout", 10)

        built_providers[provider_name] = provider

    return built_providers


def load_config(template_file, private_providers, client_type):
    """Load template config and inject the configured proxy providers"""
    template_config = load_yaml_file(template_file)
    template_providers = template_config.get("proxy-providers", {})

    template_config["proxy-providers"] = build_proxy_providers(
        template_providers, private_providers, client_type
    )

    provider_names = list(private_providers.keys())
    for group in template_config.get("proxy-groups", []):
        if "use" in group:
            group["use"] = provider_names

    return template_config


def config_to_yaml(config):
    """Convert config dict to YAML string with proper escaping"""
    config_yaml = yaml.dump(
        config,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=1000,
    )
    # Escape for JavaScript template literal
    return config_yaml.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def main():
    print("🚀 Dimrail 配置生成器")
    print("-" * 60)

    # Get script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    configs_dir = os.path.join(os.path.dirname(script_dir), "configs")

    # File paths
    stash_template = os.path.join(configs_dir, "stash.yaml")
    clash_template = os.path.join(configs_dir, "clash.yaml")
    private_file = os.path.join(script_dir, "config.private.yaml")
    workers_template_file = os.path.join(script_dir, "workers.template.js")
    output_file = os.path.join(script_dir, "workers.js")

    # Check required files
    missing_files = []
    if not os.path.exists(stash_template):
        missing_files.append("configs/stash.yaml")
    if not os.path.exists(clash_template):
        missing_files.append("configs/clash.yaml")
    if not os.path.exists(private_file):
        missing_files.append("workers/config.private.yaml")
    if not os.path.exists(workers_template_file):
        missing_files.append("workers/workers.template.js")

    if missing_files:
        print("❌ 错误: 找不到以下文件:")
        for f in missing_files:
            print(f"   - {f}")
        if "config.private.yaml" in str(missing_files):
            print()
            print("💡 请按以下步骤创建私有配置:")
            print("   1. cd workers")
            print("   2. cp config.private.example.yaml config.private.yaml")
            print("   3. 编辑 config.private.yaml，填入真实订阅链接")
        sys.exit(1)

    try:
        # Step 1: Load private providers
        print("🔐 [1/8] 读取私有订阅配置...")
        private_providers = load_private_providers(private_file)
        print(f"   ✓ 已加载 {len(private_providers)} 个订阅源")

        # Step 2: Load Stash config
        print("📖 [2/8] 读取 Stash 配置...")
        stash_config = load_config(stash_template, private_providers, "stash")
        print("   ✓ Stash 配置加载成功")

        # Step 3: Load Clash config
        print("📖 [3/8] 读取 Clash 配置...")
        clash_config = load_config(clash_template, private_providers, "clash")
        print("   ✓ Clash 配置加载成功")

        # Step 4: Convert to YAML strings
        print("📝 [4/8] 生成配置字符串...")
        stash_yaml = config_to_yaml(stash_config)
        clash_yaml = config_to_yaml(clash_config)
        stash_size = len(stash_yaml.encode("utf-8"))
        clash_size = len(clash_yaml.encode("utf-8"))
        print(f"   ✓ Stash 配置: {stash_size:,} 字节")
        print(f"   ✓ Clash 配置: {clash_size:,} 字节")

        # Step 5: Load workers template
        print("📖 [5/8] 读取 Workers 模板...")
        with open(workers_template_file, "r", encoding="utf-8") as f:
            workers_template = f.read()
        print("   ✓ Workers 模板加载成功")

        # Step 6: Handle SECRET_TOKEN
        print("🔐 [6/8] 处理访问密钥...")
        existing_token = extract_token_from_workers(output_file)

        if existing_token:
            secret_token = existing_token
            print(f"   ✓ 复用已有密钥: {secret_token}")
        else:
            secret_token = generate_secret_token(32)
            print(f"   ✓ 生成新密钥: {secret_token}")

        # Step 7: Generate workers script
        print("🔄 [7/8] 生成 Workers 脚本...")
        workers_code = workers_template.replace("{{STASH_CONFIG}}", stash_yaml)
        workers_code = workers_code.replace("{{CLASH_CONFIG}}", clash_yaml)
        workers_code = workers_code.replace(
            'const SECRET_TOKEN = "YOUR_SECRET_TOKEN_HERE";',
            f'const SECRET_TOKEN = "{secret_token}";',
        )

        # Step 8: Write output
        print("💾 [8/8] 写入输出文件...")
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(workers_code)

        workers_size = len(workers_code.encode("utf-8"))
        print(f"   ✓ Workers 脚本大小: {workers_size:,} 字节")

        # Success output
        print()
        print("=" * 60)
        print("✅ Workers 脚本生成成功！")
        print("=" * 60)
        print()
        print(f"📄 输出文件: {output_file}")
        print()
        print("🔑 访问密钥:")
        print(f"   TOKEN: {secret_token}")
        print()
        print("📋 订阅地址:")
        print(f"   Stash:        {url_placeholder('stash', secret_token)}")
        print(f"   Clash:        {url_placeholder('clash', secret_token)}")
        print(f"   默认:         {url_placeholder('', secret_token)}")
        print()
        print("🚀 部署步骤:")
        print("   1. 登录 https://dash.cloudflare.com/")
        print("   2. Workers & Pages → Create Application → Create Worker")
        print("   3. 粘贴 workers.js 内容")
        print("   4. Save and Deploy")
        print()
        print("=" * 60)

    except yaml.YAMLError as e:
        print(f"❌ YAML 解析错误: {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"❌ 配置错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def url_placeholder(path, token):
    """Generate URL placeholder for output"""
    if path:
        return f"https://your-worker.workers.dev/{path}?token={token}"
    return f"https://your-worker.workers.dev/?token={token}"


if __name__ == "__main__":
    main()
