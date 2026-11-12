// dsh-cura — 出行（高德 MCP）本地配置 + 真连一次探针。
//
// 边界：这里只做三件事——把用户填的 key/URL 收敛成一份 travel.json、读出来
// 给管家拼 MCP server 清单、以及一个 JSON-RPC 探针（面板「测试连接」用）。
// 不常驻连接、不管审批（那是 DSH 的 mcp_connector 与管家挂载的活）。
//
// key 与 rules.json / health.json 同级，本机明文；对外（面板/日志）只回
// masked URL 与末四位，完整 key 不进返回值也不进日志。

import fs from 'node:fs';
import path from 'node:path';

export const AMAP_SERVER = 'amap';
export const AMAP_BASE = 'https://mcp.amap.com/mcp';
const KEY_RE = /^[0-9a-fA-F]{16,64}$/;
const MAX_URL = 500;

function clean(input) {
  return String(input ?? '').trim().replace(/^["'<]+|["'>]+$/g, '').trim();
}

/** 把用户输入收敛成 MCP URL：完整地址原样保留（顺便取 key），裸 key 拼标准端点。 */
export function buildUrl(input) {
  const text = clean(input);
  if (!text) return { error: '请填写高德 Web 服务 key，或完整的 MCP 地址' };
  if (text.length > MAX_URL) return { error: '地址过长（上限 500 字符）' };
  if (/^https?:\/\//i.test(text)) {
    let parsed;
    try { parsed = new URL(text); } catch { return { error: '这不像一个合法的 URL' }; }
    if (!/^https?:$/.test(parsed.protocol)) return { error: '只支持 http/https' };
    const key = parsed.searchParams.get('key') || '';
    return { url: parsed.toString(), key: key || null };
  }
  if (!KEY_RE.test(text)) {
    return { error: 'key 应为 16–64 位十六进制；也可以直接粘完整地址（https://mcp.amap.com/mcp?key=…）' };
  }
  return { url: AMAP_BASE + '?key=' + text, key: text };
}

export function maskSecret(value) {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

/** 面板展示用：把 key 参数打码，其余原样。 */
export function maskUrl(url) {
  return String(url ?? '').replace(/([?&]key=)([^&#]*)/i, (_m, prefix, value) => prefix + maskSecret(value));
}

export function defaultTravel() {
  return { version: 1, amap: { enabled: false, url: '', key: '', updatedAt: '' } };
}

/** 读 travel.json；文件缺失/损坏一律当「未配置」，绝不抛（面板要能打开）。 */
export function loadTravel(file) {
  const out = defaultTravel();
  if (!file) return out;
  try {
    if (!fs.existsSync(file)) return out;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const amap = raw && typeof raw === 'object' ? raw.amap : null;
    if (amap && typeof amap === 'object') {
      out.amap.enabled = amap.enabled === true;
      out.amap.url = typeof amap.url === 'string' ? amap.url : '';
      out.amap.key = typeof amap.key === 'string' ? amap.key : '';
      out.amap.updatedAt = typeof amap.updatedAt === 'string' ? amap.updatedAt : '';
    }
  } catch { /* 坏文件 = 未配置 */ }
  return out;
}

/** 写 travel.json（先写临时文件再 rename，断电不留半个文件）。 */
export function saveTravel(file, patch) {
  if (!file) throw new Error('未配置 travelFile');
  const current = loadTravel(file);
  const next = {
    version: 1,
    amap: {
      enabled: patch && patch.enabled === false ? false : true,
      url: String(patch?.url ?? current.amap.url ?? ''),
      key: String(patch?.key ?? current.amap.key ?? ''),
      updatedAt: new Date().toISOString(),
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

/** 面板状态：只回 masked URL 与末四位，不回完整 key。 */
export function state(file, extra = {}) {
  const cfg = loadTravel(file);
  const hasUrl = Boolean(cfg.amap.enabled && cfg.amap.url);
  return {
    enabled: Boolean(cfg.amap.enabled),
    hasKey: Boolean(cfg.amap.key),
    url: hasUrl ? maskUrl(cfg.amap.url) : '',
    keyTail: cfg.amap.key ? String(cfg.amap.key).slice(-4) : '',
    serverName: AMAP_SERVER,
    file: String(file ?? ''),
    updatedAt: String(cfg.amap.updatedAt || ''),
    butlerEnabled: extra.butlerEnabled !== false,
  };
}

/** 管家挂载用：配好了就给一条 MCP server 记录，否则 null。 */
export function serverFromTravel(file) {
  const cfg = loadTravel(file);
  if (!cfg.amap.enabled || !cfg.amap.url) return null;
  return { serverName: AMAP_SERVER, transport: 'streamable-http', url: cfg.amap.url, headers: {} };
}

// ---------- JSON-RPC 探针（streamable HTTP MCP） ----------

async function rpc(url, body, sessionId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      text,
      contentType: String(res.headers.get('content-type') || ''),
      sessionId: String(res.headers.get('mcp-session-id') || sessionId || ''),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 兼容三种响应：纯 JSON、JSON 数组（批量）、SSE 的 data: 行。 */
export function parseRpcPayload(text, contentType) {
  const raw = String(text ?? '').trim();
  if (!raw) return { error: '服务端返回空响应' };
  const tryJson = (s) => { try { return { value: JSON.parse(s) }; } catch { return null; } };
  const direct = tryJson(raw);
  if (direct) {
    const v = direct.value;
    if (Array.isArray(v)) {
      const hit = v.find((x) => x && typeof x === 'object' && ('result' in x || 'error' in x));
      return hit ? { value: hit } : { error: '批量响应里没有 result/error' };
    }
    if (v && typeof v === 'object' && ('result' in v || 'error' in v)) return { value: v };
    return { error: '响应不是 JSON-RPC：' + raw.slice(0, 200) };
  }
  if (!/text\/event-stream/i.test(String(contentType ?? '')) && !/^data:/m.test(raw)) {
    return { error: '响应不是 JSON：' + raw.slice(0, 200) };
  }
  const messages = [];
  for (const line of raw.split(/\r?\n/)) {
    const matched = /^data:\s?(.*)$/.exec(line);
    if (!matched) continue;
    const payload = matched[1].trim();
    if (!payload || payload === '[DONE]') continue;
    const parsed = tryJson(payload);
    if (parsed) messages.push(parsed.value);
  }
  const hit = messages.find((x) => x && typeof x === 'object' && ('result' in x || 'error' in x));
  return hit ? { value: hit } : { error: 'SSE 里没有 JSON-RPC 响应：' + raw.slice(0, 200) };
}

/** 读一溜工具里挑一个只读的试调，证明「不只是握手成功」。 */
const SAMPLE_PREFERENCE = [
  { name: 'maps_weather', args: { city: '北京' } },
  { name: 'maps_ip_location', args: {} },
  { name: 'maps_geo', args: { address: '天安门' } },
];

/**
 * 真连一次：initialize → notifications/initialized → tools/list →（有只读工具就）试调一次。
 * 失败时把原始错误带回来，不编造「已连接」。
 */
export async function probeMcp(url, opts = {}) {
  const started = Date.now();
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 12000, 1000), 30000);
  const out = { ok: false, url: maskUrl(url), tools: [], sample: null, error: '', steps: [], ms: 0 };
  const finish = () => { out.ms = Date.now() - started; return out; };

  let session = '';
  try {
    const init = await rpc(url, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: opts.protocolVersion || '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'dsh-cura', version: '0.9.0' },
      },
    }, '', timeoutMs);
    if (!init.ok) {
      out.error = 'initialize 失败：HTTP ' + init.status + ' ' + String(init.text || '').slice(0, 300);
      return finish();
    }
    const head = parseRpcPayload(init.text, init.contentType);
    if (head.error) { out.error = 'initialize 响应无法解析：' + head.error; return finish(); }
    if (head.value.error) {
      out.error = 'initialize 报错：' + JSON.stringify(head.value.error).slice(0, 300);
      return finish();
    }
    session = init.sessionId;
    out.steps.push('initialize ok');

    // 通知：不需要响应，失败也不致命
    try {
      await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session, timeoutMs);
    } catch { /* ignore */ }

    const listed = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session, timeoutMs);
    const body = parseRpcPayload(listed.text, listed.contentType);
    if (body.error) { out.error = 'tools/list 无法解析：' + body.error; return finish(); }
    if (body.value.error) {
      out.error = 'tools/list 报错：' + JSON.stringify(body.value.error).slice(0, 300);
      return finish();
    }
    const tools = Array.isArray(body.value.result?.tools) ? body.value.result.tools : [];
    out.tools = tools.map((x) => String(x?.name || '')).filter(Boolean).slice(0, 60);
    out.steps.push('tools/list ok（' + out.tools.length + ' 个工具）');

    const pick = SAMPLE_PREFERENCE.find((p) => out.tools.includes(p.name));
    if (pick && opts.sample !== false) {
      const called = await rpc(url, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: pick.name, arguments: pick.args },
      }, session, timeoutMs);
      const parsed = parseRpcPayload(called.text, called.contentType);
      if (!parsed.error && !parsed.value.error) {
        const content = parsed.value.result?.content;
        const textPart = Array.isArray(content)
          ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean).join('\n')
          : '';
        out.sample = {
          tool: pick.name,
          args: pick.args,
          text: String(textPart || JSON.stringify(parsed.value.result ?? '')).slice(0, 600),
        };
        out.steps.push('tools/call ' + pick.name + ' ok');
      } else {
        out.sample = { tool: pick.name, args: pick.args, text: '', error: (parsed.error || JSON.stringify(parsed.value.error)).slice(0, 300) };
        out.steps.push('tools/call ' + pick.name + ' 失败（不影响连通性判断）');
      }
    }

    out.ok = true;
    return finish();
  } catch (e) {
    const reason = e?.name === 'AbortError' ? ('超时 ' + timeoutMs + 'ms') : String(e?.message || e);
    out.error = '连不上：' + reason;
    return finish();
  } finally {
    // 尽力关掉会话（服务器不支持 terminate 也无所谓）
    if (session) {
      try {
        await fetch(url, {
          method: 'DELETE',
          headers: { 'mcp-session-id': session },
        });
      } catch { /* ignore */ }
    }
  }
}
