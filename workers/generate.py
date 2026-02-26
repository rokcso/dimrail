#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dimrail 配置生成脚本
功能: 合并模板配置和私有订阅，生成统一的 Cloudflare Workers 脚本
支持: 同时支持 Stash 和 Clash 配置，通过路径区分
"""

import yaml
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
    except:
        pass
    return None


def load_config(template_file, private_file):
    """Load and merge configuration files"""
    with open(template_file, "r", encoding="utf-8") as f:
        template_config = yaml.safe_load(f)

    with open(private_file, "r", encoding="utf-8") as f:
        private_config = yaml.safe_load(f)

    # Merge proxy-providers from private config
    if "proxy-providers" in private_config:
        for provider_name, provider_config in private_config["proxy-providers"].items():
            if provider_name not in template_config.get("proxy-providers", {}):
                template_config.setdefault("proxy-providers", {})[provider_name] = provider_config
            elif "url" in provider_config:
                template_config["proxy-providers"][provider_name]["url"] = provider_config["url"]

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
    print("🚀 Dimrail 配置生成器 (Unified)")
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
        missing_files.append(f"configs/stash.yaml")
    if not os.path.exists(clash_template):
        missing_files.append(f"configs/clash.yaml")
    if not os.path.exists(private_file):
        missing_files.append(f"workers/config.private.yaml")
    if not os.path.exists(workers_template_file):
        missing_files.append(f"workers/workers.template.js")

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
        # Step 1: Load Stash config
        print("📖 [1/6] 读取 Stash 配置...")
        stash_config = load_config(stash_template, private_file)
        print("   ✓ Stash 配置加载成功")

        # Step 2: Load Clash config
        print("📖 [2/6] 读取 Clash 配置...")
        clash_config = load_config(clash_template, private_file)
        print("   ✓ Clash 配置加载成功")

        # Step 3: Convert to YAML strings
        print("📝 [3/6] 生成配置字符串...")
        stash_yaml = config_to_yaml(stash_config)
        clash_yaml = config_to_yaml(clash_config)
        stash_size = len(stash_yaml.encode("utf-8"))
        clash_size = len(clash_yaml.encode("utf-8"))
        print(f"   ✓ Stash 配置: {stash_size:,} 字节")
        print(f"   ✓ Clash 配置: {clash_size:,} 字节")

        # Step 4: Load workers template
        print("📖 [4/6] 读取 Workers 模板...")
        with open(workers_template_file, "r", encoding="utf-8") as f:
            workers_template = f.read()
        print("   ✓ Workers 模板加载成功")

        # Step 5: Handle SECRET_TOKEN
        print("🔐 [5/6] 处理访问密钥...")
        existing_token = extract_token_from_workers(output_file)

        if existing_token:
            secret_token = existing_token
            print(f"   ✓ 复用已有密钥: {secret_token}")
        else:
            secret_token = generate_secret_token(32)
            print(f"   ✓ 生成新密钥: {secret_token}")

        # Step 6: Generate workers script
        print("🔄 [6/6] 生成 Workers 脚本...")
        workers_code = workers_template.replace("{{STASH_CONFIG}}", stash_yaml)
        workers_code = workers_code.replace("{{CLASH_CONFIG}}", clash_yaml)
        workers_code = workers_code.replace(
            'const SECRET_TOKEN = "YOUR_SECRET_TOKEN_HERE";',
            f'const SECRET_TOKEN = "{secret_token}";',
        )

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
        print(f"   Stash:  {url_placeholder('stash', secret_token)}")
        print(f"   Clash:  {url_placeholder('clash', secret_token)}")
        print(f"   默认:   {url_placeholder('', secret_token)}")
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
