#!/usr/bin/env node
/**
 * 把 configs/clash.yaml 编译成内联模板模块。
 *
 * 构建期只做两件事：
 *   1. proxy-providers 段 → 运行时注入标记
 *   2. 代理组的 use: [ProxyProviderA] → 运行时名字标记
 * 其余原样保留。产物同时用作「D1 为空时的兜底配置」和「编辑器初始内容」。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'configs/clash.yaml'), 'utf8');

try {
  parse(source);
} catch (err) {
  console.error(`❌ configs/clash.yaml 不是合法 YAML: ${String(err.message).split('\n')[0]}`);
  process.exit(1);
}

const injected = source
  .replace(
    /^proxy-providers:[\s\S]*?(?=^#|^[A-Za-z0-9_-]+:)/m,
    'proxy-providers:\n  # __PROXY_PROVIDERS__\n',
  )
  .replaceAll('use: [ProxyProviderA]', 'use: [__PROVIDER_NAMES__]');

if (!injected.includes('__PROXY_PROVIDERS__')) {
  console.error('❌ 未在 configs/clash.yaml 中找到 proxy-providers 段');
  process.exit(1);
}
if (!injected.includes('__PROVIDER_NAMES__')) {
  console.error('❌ 未找到 use: [ProxyProviderA]，请检查代理组的 use 写法');
  process.exit(1);
}

const escapeTemplate = (text) =>
  text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const out = [
  '// 由 scripts/generate.mjs 生成，请勿手改。',
  '// 源文件：configs/clash.yaml',
  '',
  `export const CONFIG_TEMPLATE = \`${escapeTemplate(injected)}\`;`,
  '',
].join('\n');

const outDir = resolve(root, 'src/generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'config.ts'), out, 'utf8');
console.log(`✅ src/generated/config.ts（${Buffer.byteLength(injected)} bytes）`);
