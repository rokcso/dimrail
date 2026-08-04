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

    if (pathname === '/shadowrocket') {
      return serveShadowrocket(url, env);
    }

    const match = pathname.match(/^\/providers\/([^/]+)$/);
    if (match) {
      return relayProvider(match[1], env);
    }

    return textResponse(
      `Not found: ${pathname}\n\n支持的路径:\n  ${url.origin}/?token=...               (Clash 主配置)\n  ${url.origin}/providers/<name>?token=...  (Clash provider 中转)\n  ${url.origin}/shadowrocket?token=...      (Shadowrocket URI 订阅)`,
      404
    );
  },
};

// ---------- 主配置 ----------

async function serveConfig(url, env) {
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

  const headers = {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'ETag': `W/"${fnv1a(body)}"`,
    'X-Config-Type': 'clash',
    // 客户端按此间隔自动重新拉取主订阅（与 proxy-provider interval 保持一致）
    'Profile-Update-Interval': '10800',
  };

  // 聚合所有机场的用量/到期信息，FlClash/Clash 在主订阅响应头中读取并展示
  const userinfo = await getAggregatedUserinfo(env);
  if (userinfo) headers['Subscription-Userinfo'] = userinfo;

  return new Response(body, {
    status: 200,
    headers,
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

// ---------- 订阅用量聚合 ----------
// 拉取所有机场的 subscription-userinfo 响应头并聚合成一个，挂到主配置响应头，
// 这样 FlClash/Clash 在主订阅界面也能展示流量用量与到期时间。
// upload/download/total 求和，expire 取最早到期；带简单内存缓存避免每次主订阅都拉上游。
const usageCache = { data: '', ts: 0 };
const USAGE_TTL = 10 * 60 * 1000; // 10 分钟

async function getAggregatedUserinfo(env) {
  if (usageCache.data && Date.now() - usageCache.ts < USAGE_TTL) {
    return usageCache.data;
  }
  let providers;
  try {
    providers = parseProviders(env);
  } catch {
    return '';
  }

  const results = await Promise.allSettled(
    Object.values(providers).map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'clash.meta' },
          redirect: 'follow',
        });
        const userinfo = res.ok ? res.headers.get('subscription-userinfo') : '';
        await res.body?.cancel?.();
        return userinfo || '';
      } catch {
        return '';
      }
    })
  );

  let upload = 0;
  let download = 0;
  let total = 0;
  let expire = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const m = {
      upload: /upload=(\d+)/i.exec(r.value),
      download: /download=(\d+)/i.exec(r.value),
      total: /total=(\d+)/i.exec(r.value),
      expire: /expire=(\d+)/i.exec(r.value),
    };
    if (m.upload) upload += Number(m.upload[1]);
    if (m.download) download += Number(m.download[1]);
    if (m.total) total += Number(m.total[1]);
    if (m.expire) {
      const e = Number(m.expire[1]);
      expire = expire === 0 ? e : Math.min(expire, e);
    }
  }

  const parts = [];
  if (upload) parts.push(`upload=${upload}`);
  if (download) parts.push(`download=${download}`);
  if (total) parts.push(`total=${total}`);
  if (expire) parts.push(`expire=${expire}`);
  const data = parts.join('; ');
  usageCache.data = data;
  usageCache.ts = Date.now();
  return data;
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

// ---------- Shadowrocket 订阅（URI 列表）----------
// 与 Clash 主配置完全独立：/shadowrocket 返回 Shadowrocket 原生支持的
// URI 列表订阅（每行一条 vless:// / trojan:// / hysteria2:// ...）。
// 节点名去重（同名保留第一个），不支持/无法转换的协议跳过。

async function serveShadowrocket(url, env) {
  let providers;
  try {
    providers = parseProviders(env);
  } catch (err) {
    return textResponse(`配置错误: ${err.message}`, 500);
  }

  const results = await Promise.allSettled(
    Object.values(providers).map(async (subUrl) => {
      try {
        const res = await fetch(subUrl, {
          headers: { 'User-Agent': 'clash.meta' },
          redirect: 'follow',
        });
        if (!res.ok) return [];
        const doc = parse(await res.text());
        if (Array.isArray(doc)) return doc;
        return Array.isArray(doc?.proxies) ? doc.proxies : [];
      } catch {
        return [];
      }
    })
  );

  const proxies = [];
  for (const r of results) if (r.status === 'fulfilled') proxies.push(...r.value);

  const seen = new Set();
  const lines = [];
  let skipped = 0;
  for (const p of proxies) {
    if (!p || typeof p !== 'object' || !p.name) continue;
    if (seen.has(p.name)) continue; // 去重：同名保留第一个
    seen.add(p.name);
    const uri = proxyToUri(p);
    if (uri) {
      lines.push(uri);
    } else {
      skipped++;
    }
  }

  const body = lines.join('\n') + '\n';
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Profile-Update-Interval': '10800',
    'Content-Disposition': 'attachment; filename="dimrail.txt"',
  };
  const userinfo = await getAggregatedUserinfo(env);
  if (userinfo) headers['Subscription-Userinfo'] = userinfo;

  return new Response(body, { status: 200, headers });
}

// 把单个 Clash proxy 对象反解为标准 URI（v2rayN/Shadowrocket 通用格式）
function proxyToUri(p) {
  try {
    const name = encodeURIComponent(p.name);
    const server = p.server;
    const port = p.port;
    if (!server || !port) return null;

    switch (p.type) {
      case 'vless': {
        const q = new URLSearchParams();
        q.set('encryption', 'none');
        q.set('type', p.network || 'tcp');
        if (p.tls) {
          if (p['reality-opts']) {
            q.set('security', 'reality');
            if (p['reality-opts']['public-key']) q.set('pbk', p['reality-opts']['public-key']);
            if (p['reality-opts']['short-id']) q.set('sid', p['reality-opts']['short-id']);
            if (p['reality-opts']['spider-x']) q.set('spx', p['reality-opts']['spider-x']);
          } else {
            q.set('security', 'tls');
          }
          if (p['client-fingerprint']) q.set('fp', p['client-fingerprint']);
          if (p.servername) q.set('sni', p.servername);
        }
        if (p.flow) q.set('flow', p.flow);
        if (p.network === 'ws') {
          if (p['ws-opts']?.path) q.set('path', p['ws-opts'].path);
          if (p['ws-opts']?.headers?.Host) q.set('host', p['ws-opts'].headers.Host);
        } else if (p.network === 'grpc') {
          if (p['grpc-opts']?.grpc-service-name) q.set('serviceName', p['grpc-opts']['grpc-service-name']);
        }
        return `vless://${p.uuid}@${server}:${port}?${q.toString()}#${name}`;
      }

      case 'trojan': {
        const q = new URLSearchParams();
        if (p.sni) q.set('sni', p.sni);
        if (p.alpn?.length) q.set('alpn', p.alpn.join(','));
        if (p['skip-cert-verify']) q.set('allowInsecure', '1');
        return `trojan://${encodeURIComponent(p.password || '')}@${server}:${port}?${q.toString()}#${name}`;
      }

      case 'hysteria2': {
        const q = new URLSearchParams();
        if (p.sni) q.set('sni', p.sni);
        if (p.obfs) q.set('obfs', p.obfs);
        if (p['obfs-password']) q.set('obfs-password', p['obfs-password']);
        if (p.alpn?.length) q.set('alpn', p.alpn.join(','));
        return `hysteria2://${encodeURIComponent(p.password || '')}@${server}:${port}?${q.toString()}#${name}`;
      }

      case 'vmess': {
        const v = {
          v: '2',
          ps: p.name,
          add: server,
          port: String(port),
          id: p.uuid,
          aid: String(p.alterId ?? 0),
          scy: p.cipher || 'auto',
          net: p.network || 'tcp',
          type: p['tcp-opts']?.type || 'none',
          host: p['ws-opts']?.headers?.Host || p['grpc-opts']?.['grpc-service-name'] || '',
          path: p['ws-opts']?.path || '',
          tls: p.tls ? 'tls' : '',
          sni: p.servername || '',
        };
        const b64 = btoa(JSON.stringify(v));
        return `vmess://${b64}#${name}`;
      }

      case 'ss': {
        const method = p.cipher || 'aes-256-gcm';
        const pass = `${method}:${p.password}`;
        const b64 = btoa(pass).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        let uri = `ss://${b64}@${server}:${port}`;
        const plugin = p.plugin;
        if (plugin && plugin.opts) {
          const q = new URLSearchParams();
          q.set('plugin', `${plugin.plugin};${plugin.opts}`);
          uri += `?${q.toString()}`;
        }
        return `${uri}#${name}`;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
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
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
  };
  // 透传机场订阅信息头：FlClash/Clash 依赖 subscription-userinfo 展示流量用量与到期时间，
  // content-disposition 携带订阅文件名（部分客户端用于显示订阅名）。
  for (const h of ['subscription-userinfo', 'profile-update-interval', 'content-disposition']) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  return new Response(payload, {
    status: 200,
    headers,
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
    '╚═════╝  ╚═╝ ╚═╝     ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝ ╚═╝ ╚══════╝',
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
