/**
 * Dimrail — Cloudflare Worker
 *
 * 个人 Clash 订阅中转服务：聚合多个机场订阅，并下发你自己的分流配置。
 * 配合 FlClash（Clash Meta / Mihomo）使用。
 *
 * 路由：
 *   GET /?token=...                  → Clash 主配置（proxy-providers 由 Worker 运行时注入）
 *   GET /providers/<name>?token=...  → 中转拉取对应机场的订阅
 *
 * Secrets（npx wrangler secret put <名称>）：
 *   PROVIDERS_JSON  机场订阅映射，如 {"airport-a":"https://sub.example/link/xxx"}
 *   ACCESS_TOKEN    访问密钥，所有请求都需要携带 ?token=
 */
import { parse, stringify } from 'yaml';
import { CONFIG_TEMPLATE } from './config.generated.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || '';
    const secretToken = env.ACCESS_TOKEN || '';

    if (!secretToken) {
      return textResponse(
        '服务端尚未配置 ACCESS_TOKEN，请执行: npx wrangler secret put ACCESS_TOKEN',
        503
      );
    }
    if (!timingSafeEqual(token, secretToken)) {
      return textResponse(unauthorizedPage(url.origin), 401);
    }

    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/') {
      return serveConfig(url, env);
    }

    const match = pathname.match(/^\/providers\/([^/]+)$/);
    if (match) {
      return relayProvider(match[1], env);
    }

    return textResponse(
      `Not found: ${pathname}\n\n支持的路径:\n  ${url.origin}/?token=...\n  ${url.origin}/providers/<name>?token=...`,
      404
    );
  },
};

// ---------- 主配置 ----------

function serveConfig(url, env) {
  let providers;
  try {
    providers = parseProviders(env);
  } catch (err) {
    return textResponse(`配置错误: ${err.message}`, 500);
  }

  const token = url.searchParams.get('token');
  const providerYaml = buildProvidersYaml(providers, url.origin, token);
  const names = Object.keys(providers);

  const config = CONFIG_TEMPLATE.replaceAll('  # __PROXY_PROVIDERS__', providerYaml).replaceAll(
    '__PROVIDER_NAMES__',
    names.join(', ')
  );

  const body = `# Dimrail — 由 Cloudflare Worker 生成的 Clash 配置\n# 订阅源: ${names.join(', ')}\n${config}`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'ETag': `W/"${fnv1a(body)}"`,
      'X-Config-Type': 'clash',
    },
  });
}

function buildProvidersYaml(providers, origin, token) {
  return Object.keys(providers)
    .map(
      (name) =>
        [
          `  ${name}:`,
          `    type: http`,
          `    url: ${origin}/providers/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`,
          `    interval: 10800`,
          `    path: ./providers/${name}.yaml`,
          `    health-check:`,
          `      enable: true`,
          `      interval: 300`,
          `      url: http://www.gstatic.com/generate_204`,
        ].join('\n')
    )
    .join('\n');
}

function parseProviders(env) {
  const raw = (env.PROVIDERS_JSON || '').trim();
  if (!raw) {
    throw new Error('未配置 PROVIDERS_JSON，请执行: npx wrangler secret put PROVIDERS_JSON');
  }
  let providers;
  try {
    providers = JSON.parse(raw);
  } catch (err) {
    throw new Error(`PROVIDERS_JSON 不是合法的 JSON: ${err.message}`);
  }
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error('PROVIDERS_JSON 必须是 {"机场名":"订阅链接"} 形式的 JSON 对象');
  }
  const names = Object.keys(providers);
  if (names.length === 0) {
    throw new Error('PROVIDERS_JSON 至少需要一个订阅源');
  }
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
      throw new Error(`订阅源名称不合法（仅允许字母/数字/下划线/连字符，最长 32 字符）: "${name}"`);
    }
    const value = providers[name];
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
      throw new Error(`订阅源 "${name}" 的 url 无效: ${String(value)}`);
    }
  }
  return providers;
}

// ---------- 订阅中转 ----------

async function relayProvider(name, env) {
  let providers;
  try {
    providers = parseProviders(env);
  } catch (err) {
    return textResponse(`配置错误: ${err.message}`, 500);
  }

  const subUrl = providers[name];
  if (!subUrl) {
    return textResponse(`未找到订阅源: ${name}\n\n可用订阅源: ${Object.keys(providers).join(', ')}`, 404);
  }

  let upstream;
  try {
    upstream = await fetch(subUrl, {
      headers: { 'User-Agent': 'clash.meta' },
      redirect: 'follow',
    });
  } catch (err) {
    return textResponse(`拉取订阅源 "${name}" 失败: ${err.message}`, 502);
  }
  if (!upstream.ok) {
    return textResponse(`订阅源 "${name}" 返回错误: HTTP ${upstream.status}`, 502);
  }

  const body = await upstream.text();
  const stripped = stripToProxiesOnly(body);
  const payload = stripped ?? body;
  const contentType = stripped
    ? 'text/yaml; charset=utf-8'
    : upstream.headers.get('content-type') || 'text/yaml; charset=utf-8';
  return new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
    },
  });
}

/**
 * 把机场订阅裁剪为纯节点列表（只保留 proxies）。
 * 机场文件里自带的 rules / proxy-groups / dns / tun 等一律丢弃，
 * 避免它们被下载却永不被 Mihomo 使用。
 * 解析失败或没有节点时返回 null，调用方回退为原样转发。
 */
function stripToProxiesOnly(raw) {
  let doc;
  try {
    doc = parse(raw);
  } catch {
    return null;
  }
  try {
    if (Array.isArray(doc)) {
      // 订阅是纯列表（如 URI 列表），原样序列化返回
      return doc.length > 0 ? stringify(doc, { lineWidth: 0 }) : null;
    }
    if (doc && typeof doc === 'object' && Array.isArray(doc.proxies) && doc.proxies.length > 0) {
      return stringify({ proxies: doc.proxies }, { lineWidth: 0 });
    }
  } catch {
    return null;
  }
  return null;
}

// ---------- 工具 ----------

function timingSafeEqual(a, b) {
  const ta = new TextEncoder().encode(a);
  const tb = new TextEncoder().encode(b);
  if (ta.length !== tb.length) return false;
  let diff = 0;
  for (let i = 0; i < ta.length; i++) diff |= ta[i] ^ tb[i];
  return diff === 0;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function textResponse(content, status) {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function unauthorizedPage(origin) {
  return [
    '██████╗  ██╗ ███╗   ███╗ ██████╗   █████╗  ██╗ ██╗',
    '██╔══██╗ ██║ ████╗ ████║ ██╔══██╗ ██╔══██╗ ██║ ██║',
    '██║  ██║ ██║ ██╔████╔██║ ██████╔╝ ███████║ ██║ ██║',
    '██║  ██║ ██║ ██║╚██╔╝██║ ██╔══██╗ ██╔══██║ ██║ ██║',
    '██████╔╝ ██║ ██║ ╚═╝ ██║ ██║  ██║ ██║  ██║ ██║ ███████╗',
    '╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚══════╝',
    '',
    'Dimrail — Private Clash Proxy Configuration',
    '',
    '需要携带有效的 token 才能访问。',
    '',
    '用法:',
    `  ${origin}/?token=your-token               (Clash 主配置)`,
    `  ${origin}/providers/<name>?token=...      (中转机场订阅)`,
    '',
    '项目: https://github.com/rokcso/dimrail',
    '',
  ].join('\n');
}
