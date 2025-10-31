#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dimrail 配置生成脚本
功能: 合并模板配置和私有订阅，生成可部署的 Cloudflare workers 脚本
"""

import yaml
import os
import sys
import secrets
import string


def generate_secret_token(length=32):
    """生成安全的随机密钥"""
    # 使用大小写字母、数字和部分特殊字符
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def extract_token_from_workers(workers_file):
    """从已存在的 workers.js 文件中提取 SECRET_TOKEN"""
    try:
        with open(workers_file, "r", encoding="utf-8") as f:
            content = f.read()

        # 查找 const SECRET_TOKEN = "xxxxx";
        import re

        match = re.search(r'const SECRET_TOKEN = "([^"]+)";', content)
        if match:
            return match.group(1)
    except:
        pass
    return None


def main():
    print("🚀 Dimrail 配置生成器")
    print("-" * 60)

    # 获取脚本所在目录
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # 文件路径
    template_file = os.path.join(os.path.dirname(script_dir), "dimrail.yaml")
    private_file = os.path.join(script_dir, "config.private.yaml")
    workers_template_file = os.path.join(script_dir, "workers.template.js")
    output_workers_file = os.path.join(script_dir, "workers.js")

    # 检查文件是否存在
    if not os.path.exists(template_file):
        print(f"❌ 错误: 找不到模板文件")
        print(f"   路径: {template_file}")
        print(f"💡 提示: 请确保在项目根目录下有 dimrail.yaml 文件")
        sys.exit(1)

    if not os.path.exists(private_file):
        print(f"❌ 错误: 找不到私有配置文件")
        print(f"   路径: {private_file}")
        print()
        print("💡 请按以下步骤创建私有配置:")
        print("   1. 复制示例文件: cp config.private.example.yaml config.private.yaml")
        print("   2. 编辑配置文件: vim config.private.yaml")
        print("   3. 将示例订阅链接替换为你的真实订阅链接")
        print()
        sys.exit(1)

    if not os.path.exists(workers_template_file):
        print(f"❌ 错误: 找不到 workers 模板文件")
        print(f"   路径: {workers_template_file}")
        print(f"💡 提示: 请确保 workers.template.js 文件存在")
        sys.exit(1)

    try:
        # 步骤 1: 读取模板配置
        print("📖 [1/6] 读取模板配置文件...")
        with open(template_file, "r", encoding="utf-8") as f:
            template_config = yaml.safe_load(f)
        print("   ✓ 模板配置加载成功")

        # 步骤 2: 读取私有配置
        print("📖 [2/6] 读取私有订阅配置...")
        with open(private_file, "r", encoding="utf-8") as f:
            private_config = yaml.safe_load(f)
        print("   ✓ 私有配置加载成功")

        # 步骤 3: 合并配置
        print("🔄 [3/6] 合并配置信息...")
        if "proxy-providers" in private_config:
            providers_count = len(private_config["proxy-providers"])
            template_config["proxy-providers"] = private_config["proxy-providers"]
            print(f"   ✓ 已合并 {providers_count} 个代理提供商")
        else:
            print("   ⚠️  警告: 私有配置中没有找到 proxy-providers 字段")
            print("   请检查 config.private.yaml 文件格式是否正确")

        # 步骤 4: 生成 YAML 字符串
        print("📝 [4/6] 生成 YAML 配置字符串...")
        config_yaml = yaml.dump(
            template_config,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
            width=1000,  # 避免长行被折叠
        )
        config_size = len(config_yaml.encode("utf-8"))
        print(f"   ✓ 配置大小: {config_size:,} 字节")

        # 步骤 5: 读取 workers 模板
        print("📖 [5/7] 读取 Cloudflare Workers 模板...")
        with open(workers_template_file, "r", encoding="utf-8") as f:
            workers_template = f.read()
        print("   ✓ Workers 模板加载成功")

        # 步骤 6: 处理 SECRET_TOKEN
        print("🔐 [6/7] 处理访问密钥...")

        # 检查是否存在旧的 workers.js
        existing_token = extract_token_from_workers(output_workers_file)

        if existing_token:
            # 复用旧 token
            random_token = existing_token
            print(f"   ✓ 检测到已有密钥，继续使用: {random_token}")
            print("   💡 保持 token 不变，订阅地址无需更新")
        else:
            # 生成新 token
            random_token = generate_secret_token(32)
            print(f"   ✓ 随机生成新密钥: {random_token}")
            print()
            print("   💡 提示: 此密钥用于保护你的订阅链接")
            print("      - 首次生成，请妥善保存此密钥")
            print("      - 如需更换密钥，请删除 workers.js 后重新生成")

        # 步骤 7: 替换模板中的配置内容
        print()
        print("🔄 [7/7] 生成最终 Workers 脚本...")
        # 需要转义反引号和 ${} 以避免 JavaScript 模板字符串问题
        config_yaml_escaped = (
            config_yaml.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
        )
        workers_code = workers_template.replace(
            "{{CONFIG_CONTENT}}", config_yaml_escaped
        )

        # 替换默认的 SECRET_TOKEN
        workers_code = workers_code.replace(
            'const SECRET_TOKEN = "YOUR_SECRET_TOKEN_HERE";',
            f'const SECRET_TOKEN = "{random_token}";',
        )

        # 步骤 8: 写入 workers 文件
        with open(output_workers_file, "w", encoding="utf-8") as f:
            f.write(workers_code)

        workers_size = len(workers_code.encode("utf-8"))
        print(f"   ✓ Workers 脚本大小: {workers_size:,} 字节")

        print()
        print("=" * 60)
        print("✅ Workers 脚本生成成功！")
        print("=" * 60)
        print()
        print(f"📄 输出文件: {output_workers_file}")
        print()
        print("🔑 访问密钥信息:")
        print(f"   TOKEN: {random_token}")
        print()
        print("   💡 密钥已自动写入到 workers.js 中")
        print("      如需修改，请编辑文件中的 SECRET_TOKEN 变量")
        print()
        print("📋 接下来的部署步骤:")
        print()
        print("  1️⃣  登录 Cloudflare Dashboard 部署")
        print("     https://dash.cloudflare.com/")
        print("     → Workers & Pages → Create Application → Create Worker")
        print()
        print("  2️⃣  复制生成的 workers.js 文件内容")
        print("     cat workers.js | pbcopy  # macOS 复制到剪贴板")
        print()
        print("  3️⃣  粘贴代码到 Worker 编辑器")
        print()
        print("  4️⃣  点击 Save and Deploy 部署")
        print()
        print("  5️⃣  获取你的订阅地址:")
        print(f"     https://your-worker.workers.dev/?token={random_token}")
        print()
        print("   ⚠️  请妥善保管你的 token，不要泄露给他人")
        print()
        print("=" * 60)
        print("📖 详细文档: README.md")
        print("=" * 60)

    except yaml.YAMLError as e:
        print(f"❌ YAML 解析错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
