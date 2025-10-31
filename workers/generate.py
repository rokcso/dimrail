#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dimrail 配置生成脚本
功能: 合并模板配置和私有订阅，生成可部署的 Cloudflare workers 脚本
"""

import yaml
import os
import sys


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
        print(f"📖 读取模板配置: {template_file}")
        with open(template_file, "r", encoding="utf-8") as f:
            template_config = yaml.safe_load(f)

        # 步骤 2: 读取私有配置
        print(f"📖 读取私有配置: {private_file}")
        with open(private_file, "r", encoding="utf-8") as f:
            private_config = yaml.safe_load(f)

        # 步骤 3: 合并配置
        print("🔄 合并配置...")
        if "proxy-providers" in private_config:
            template_config["proxy-providers"] = private_config["proxy-providers"]
        else:
            print("⚠️  警告: 私有配置中没有找到 proxy-providers")

        # 步骤 4: 生成 YAML 字符串
        print("📝 生成 YAML 配置...")
        config_yaml = yaml.dump(
            template_config,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
            width=1000,  # 避免长行被折叠
        )

        # 步骤 5: 读取 workers 模板
        print(f"📖 读取 workers 模板: {workers_template_file}")
        with open(workers_template_file, "r", encoding="utf-8") as f:
            workers_template = f.read()

        # 步骤 6: 替换模板中的配置内容
        print("🔄 生成 workers 脚本...")
        # 需要转义反引号和 ${} 以避免 JavaScript 模板字符串问题
        config_yaml_escaped = (
            config_yaml.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
        )
        workers_code = workers_template.replace(
            "{{CONFIG_CONTENT}}", config_yaml_escaped
        )

        # 步骤 7: 写入 workers 文件
        with open(output_workers_file, "w", encoding="utf-8") as f:
            f.write(workers_code)

        print("-" * 50)
        print(f"✅ 成功生成 workers 脚本: {output_workers_file}")
        print()
        print("📋 下一步操作:")
        print("1. 打开 workers.js 文件")
        print("2. 修改 SECRET_TOKEN 为你自己的密钥（可选，建议修改）")
        print("3. 复制全部内容")
        print("4. 前往 Cloudflare Dashboard 粘贴并部署")
        print()
        print("📖 详细部署步骤请查看 DEPLOYMENT.md")
        print("-" * 50)

    except yaml.YAMLError as e:
        print(f"❌ YAML 解析错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
