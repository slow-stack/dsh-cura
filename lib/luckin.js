// dsh-cura — 瑞幸咖啡（my-coffee MCP）本地配置 + 真连一次探针。
//
// 边界与 travel.js 同款：把用户填的 token 收敛成一份 luckin.json、读出来给管家
// 拼 MCP server 清单、以及一个探针（面板「测试连接」用）。不常驻连接、不代下单。
//
// 与高德的两处差别：
//   1. 鉴权走请求头 Authorization: Bearer <token>，token 里没有到期时间，
//      所以「有效期」只能按生成时间 + 30 天估，面板必须标明是估算。
//   2. 瑞幸的工具里有 createOrder 这种会真实扣费的，探针**只列工具不试调**，
//      绝不为了「证明连通」替用户下一单。

import fs from 'node:fs';
import path from 'node:path';
import { probeMcp, maskSecret } from './travel.js';

export const LUCKIN_SERVER = 'my-coffee';
export const LUCKIN_MCP = 'https://gwmcp.lkcoffee.com/order/user/mcp';
const TOKEN_MIN = 16;
const TOKEN_MAX = 2048;
const TTL_DAYS = 30;

function clean(input) {
  return String(input ?? '').trim().replace(/^["'<]+|["'>]+$/g, '').trim();
}

/** 容忍用户粘成 "Authorization: Bearer xxx" / "Bearer xxx" / 光溜溜的 token。 */
export function buildToken(input) {
  let text = clean(input);
  if (!text) return { error: '请粘贴瑞幸 AI 开放平台生成的 token' };
  text = text.replace(/^authorization\s*:\s*/i, '').replace(/^bearer\s+/i, '').trim();
  if (text.length > TOKEN_MAX) return { error: 'token 过长（上限 2048 字符）' };
  if (text.length < TOKEN_MIN) return { error: 'token 太短，像是没粘全' };
  if (/\s/.test(text)) return { error: 'token 里不该有空格或换行，请重新复制一次' };
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(text)) return { error: 'token 含非法字符，请重新复制一次' };
  return { token: text };
}

function defaultLuckin() {
  return { version: 1, 'my-coffee': { enabled: false, token: '', createdAt: '', updatedAt: '' } };
}

/** 读 luckin.json；文件缺失/损坏一律当「未配置」，绝不抛（面板要能打开）。 */
export function loadLuckin(file) {
  const out = defaultLuckin();
  if (!file) return out;
  try {
    if (!fs.existsSync(file)) return out;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const item = raw && typeof raw === 'object' ? raw[LUCKIN_SERVER] : null;
    if (item && typeof item === 'object') {
      out[LUCKIN_SERVER].enabled = item.enabled === true;
      out[LUCKIN_SERVER].token = typeof item.token === 'string' ? item.token : '';
      out[LUCKIN_SERVER].createdAt = typeof item.createdAt === 'string' ? item.createdAt : '';
      out[LUCKIN_SERVER].updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : '';
    }
  } catch { /* 坏文件 = 未配置 */ }
  return out;
}

/** 写 luckin.json（先写临时文件再 rename，断电不留半个文件）。 */
export function saveLuckin(file, patch) {
  if (!file) throw new Error('未配置 luckinFile');
  const current = loadLuckin(file);
  const prev = current[LUCKIN_SERVER];
  const next = {
    version: 1,
    [LUCKIN_SERVER]: {
      enabled: patch && patch.enabled === false ? false : true,
      token: String(patch?.token ?? prev.token ?? ''),
      // createdAt 是「这份 token 生成时间」，换 token 才刷新；只是停用再启用不刷新
      createdAt: patch?.token ? new Date().toISOString() : (prev.createdAt || new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

/** 按生成时间 + 30 天估有效期；算不出来就空。 */
export function expiryOf(createdAt) {
  const t = Date.parse(String(createdAt ?? ''));
  if (!Number.isFinite(t)) return { expiresAt: '', daysLeft: null };
  const ed = new Date(t + TTL_DAYS * 24 * 3600 * 1000);
  const daysLeft = Math.ceil((ed.getTime() - Date.now()) / (24 * 3600 * 1000));
  return { expiresAt: ed.toISOString().slice(0, 10), daysLeft };
}

/** 面板状态：只回末四位，不回完整 token。 */
export function state(file, extra = {}) {
  const cfg = loadLuckin(file)[LUCKIN_SERVER];
  const { expiresAt, daysLeft } = expiryOf(cfg.createdAt);
  return {
    enabled: Boolean(cfg.enabled),
    hasToken: Boolean(cfg.token),
    tokenTail: cfg.token ? String(cfg.token).slice(-4) : '',
    tokenMasked: cfg.token ? maskSecret(cfg.token) : '',
    serverName: LUCKIN_SERVER,
    url: LUCKIN_MCP,
    file: String(file ?? ''),
    updatedAt: String(cfg.updatedAt || ''),
    expiresAt,
    daysLeft,
    butlerEnabled: extra.butlerEnabled !== false,
  };
}

/** 管家挂载用：配好了就给一条 MCP server 记录，否则 null。 */
export function serverFromLuckin(file) {
  const cfg = loadLuckin(file)[LUCKIN_SERVER];
  if (!cfg.enabled || !cfg.token) return null;
  return {
    serverName: LUCKIN_SERVER,
    transport: 'streamable-http',
    url: LUCKIN_MCP,
    headers: { Authorization: 'Bearer ' + cfg.token },
  };
}

/**
 * 真连一次。sample 强制 false —— 瑞幸工具集里有会真实下单扣费的，
 * 连通性用「握手 + 工具列表」证明就够了。
 */
export async function probeLuckin(token, opts = {}) {
  const built = buildToken(token);
  if (built.error) throw new Error(built.error);
  const out = await probeMcp(LUCKIN_MCP, {
    timeoutMs: opts.timeoutMs,
    sample: false,
    headers: { Authorization: 'Bearer ' + built.token },
  });
  // 全链路上不出现完整 token（probeMcp 只回 masked url，这里再兜一次）
  return out;
}
