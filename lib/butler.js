// dsh-cura — 管家工具（butler）：让 QQ 会话里的 Agent 能调外部 MCP server
// （瑞幸下单、高德地图、天气……），把"虚拟空间里的关怀"落到现实里。
//
// 职责边界（这是它不与 DSH 生态冲突的关键）：
//   - 本模块**不做连接管理器**：server 清单来自本插件 Config（机器相关项在 profile
//     patch 填），连接审批/密钥治理/连接状态页仍是 DSH 设置（mcp_connector）与
//     ds-bot Connectors 的事。
//   - 只往 QQ 会话（onebot-private-<QQ>）的 scope 挂 DSH 官方 mcp-client；ds-bot
//     的能力只挂它自己的 Bot 会话，两者作用域不相交。
//   - 工具名带 mcp__<serverName>__ 前缀，与 qq_* 工具、cura 自有工具天然隔离；
//     挂载前查 DSH 核心连接表（storages/mcp_connector.json），同一 serverName
//     以核心为准，本会话跳过重复挂载。
//
// 挂载方式照抄 ds-bot（src/host/capabilities.js）：经 loader 动态 import
// `@deepseek-ai/dsh-mcp-client`，在 agent scope 上 `scope.plugin(mcpPlugin, config)`。

import fs from 'node:fs';
import path from 'node:path';

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client';

/** 把 Config 里的 butlerServers（JSON 字符串；容忍直接给数组）解析成合法 server 清单。 */
export function parseServers(raw) {
  let list;
  if (Array.isArray(raw)) { list = raw; } else {
    try { list = JSON.parse(String(raw ?? '[]')); } catch (e) {
      return { servers: [], error: `butlerServers 不是合法 JSON：${e?.message || e}` };
    }
  }
  if (!Array.isArray(list)) return { servers: [], error: 'butlerServers 应为 JSON 数组' };
  const servers = [];
  const errors = [];
  const seen = new Set();
  for (const [i, item] of list.entries()) {
    const name = String(item?.serverName ?? '').trim();
    if (!name) { errors.push(`第 ${i + 1} 项缺 serverName`); continue; }
    if (seen.has(name)) { errors.push(`serverName 重复：${name}`); continue; }
    const transport = item?.transport === 'stdio' ? 'stdio' : 'streamable-http';
    if (transport === 'stdio' && !String(item?.command ?? '').trim()) {
      errors.push(`${name}：stdio 需要 command`); continue;
    }
    if (transport === 'streamable-http' && !String(item?.url ?? '').trim()) {
      errors.push(`${name}：streamable-http 需要 url`); continue;
    }
    seen.add(name);
    servers.push(transport === 'stdio'
      ? {
        serverName: name, transport,
        command: String(item.command), args: Array.isArray(item.args) ? item.args.map(String) : [],
        env: plainStrings(item.env),
      }
      : { serverName: name, transport, url: String(item.url), headers: plainStrings(item.headers) });
  }
  return { servers, error: errors.join('；') || null };
}

/** 只留 string 值（headers/env 都不允许嵌套结构）。 */
function plainStrings(obj) {
  const out = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * 读 DSH 核心连接表（<dshHome>/storages/mcp_connector.json 的 tables.connections），
 * 返回已连接 serverName 集合。连接表各版本形状不一（数组/对象都可能），这里防御性
 * 收集；读不到就当空集——漏判的后果只是工具重名，不影响会话。
 */
export function coreServerNames(dshHome) {
  const out = new Set();
  try {
    const file = path.join(String(dshHome ?? ''), 'storages', 'mcp_connector.json');
    if (!dshHome || !fs.existsSync(file)) return out;
    const tables = JSON.parse(fs.readFileSync(file, 'utf8'))?.tables ?? {};
    const addName = (v) => { const n = String(v ?? '').trim(); if (n) out.add(n); };
    const conn = tables.connections;
    if (Array.isArray(conn)) {
      for (const c of conn) { addName(c?.serverName); addName(c?.name); }
    } else if (conn && typeof conn === 'object') {
      for (const [k, v] of Object.entries(conn)) {
        addName(k);
        if (v && typeof v === 'object') { addName(v.serverName); addName(v.name); }
      }
    }
  } catch { /* ignore */ }
  return out;
}

/** 动态加载 DSH 官方 mcp-client 插件本体（ds-bot 同款 loader 路径）。 */
export async function loadMcpPlugin(ctx) {
  const loader = ctx.get?.('loader');
  if (typeof loader?.import !== 'function') throw new Error('此 DSH 无法动态加载 MCP 客户端（缺 loader 服务）');
  const exports = await loader.import(MCP_CLIENT);
  return loader.unwrapExports?.(exports) ?? exports?.default ?? exports;
}

/**
 * 过滤出允许挂载的 server：剔除与 DSH 核心连接表同名的项（核心为准，避免
 * 同一会话出现两份 mcp__<serverName>__* 工具）。
 */
export function usableServers(servers, dshHome) {
  const core = coreServerNames(dshHome);
  const skipped = [];
  const usable = [];
  for (const s of servers) {
    if (core.has(s.serverName)) { skipped.push(s.serverName); continue; }
    usable.push(s);
  }
  return { usable, skipped };
}
