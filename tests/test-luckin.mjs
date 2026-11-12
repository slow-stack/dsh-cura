// tests/test-luckin.mjs — 瑞幸 token 收敛 + 落盘 + 探针（真驱动生产函数）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../lib/luckin.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(name, got, want) { ok(name + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got)); }

// ---------- 1. token 收敛 ----------
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'x'.repeat(40) + '.LUCKIN_MCP_AI';
eq('裸 token 原样收', L.buildToken(TOKEN).token, TOKEN);
eq('去掉 Bearer 前缀', L.buildToken('Bearer ' + TOKEN).token, TOKEN);
eq('去掉 Authorization 前缀', L.buildToken('Authorization: Bearer ' + TOKEN).token, TOKEN);
eq('去掉引号', L.buildToken('  "' + TOKEN + '"  ').token, TOKEN);
ok('空输入报错', Boolean(L.buildToken('   ').error));
ok('太短报错', Boolean(L.buildToken('abc').error));
ok('带空格报错', Boolean(L.buildToken('abc def ghi jkl mnop qrst').error));
ok('非法字符报错', Boolean(L.buildToken('x'.repeat(20) + '中文').error));
ok('过长报错', Boolean(L.buildToken('x'.repeat(3000)).error));

// ---------- 2. 落盘 / 读回 ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-luckin-'));
const file = path.join(dir, 'luckin.json');
eq('文件不存在 = 未配置', L.state(file).enabled, false);
eq('未配置不产出 server', L.serverFromLuckin(file), null);
ok('未配置时面板无 token 尾巴', L.state(file).tokenTail === '');

L.saveLuckin(file, L.buildToken(TOKEN));
const st = L.state(file);
eq('保存后 enabled', st.enabled, true);
eq('面板只回末四位', st.tokenTail, TOKEN.slice(-4));
ok('面板打码不含完整 token', !st.tokenMasked.includes(TOKEN), st.tokenMasked);
eq('server 名 my-coffee', st.serverName, 'my-coffee');
eq('端点固定', st.url, 'https://gwmcp.lkcoffee.com/order/user/mcp');
const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
eq('完整 token 只落本机文件', onDisk['my-coffee'].token, TOKEN);

const srv = L.serverFromLuckin(file);
eq('管家拿到 Authorization 头', srv.headers.Authorization, 'Bearer ' + TOKEN);
eq('管家 transport', srv.transport, 'streamable-http');
eq('管家 url', srv.url, 'https://gwmcp.lkcoffee.com/order/user/mcp');

// 停用：server 消失，token 还在（再启用不用重填）
L.saveLuckin(file, { enabled: false });
eq('停用后不产出 server', L.serverFromLuckin(file), null);
eq('停用后 token 仍保存', L.loadLuckin(file)['my-coffee'].token, TOKEN);
L.saveLuckin(file, { token: TOKEN });
eq('再启用产出 server', Boolean(L.serverFromLuckin(file)), true);

// createdAt 只在换 token 时刷新
const created1 = L.loadLuckin(file)['my-coffee'].createdAt;
L.saveLuckin(file, { enabled: false });
eq('只是停用不刷新 createdAt', L.loadLuckin(file)['my-coffee'].createdAt, created1);
L.saveLuckin(file, { token: TOKEN + 'X' });
ok('换 token 刷新 createdAt', L.loadLuckin(file)['my-coffee'].createdAt !== created1);

// 坏文件不抛
fs.writeFileSync(file, '{ 坏 json', 'utf8');
eq('坏 JSON = 未配置（不抛）', L.state(file).enabled, false);

// ---------- 3. 有效期估算 ----------
const fresh = L.expiryOf(new Date().toISOString());
eq('刚生成 = 约 30 天', fresh.daysLeft, 30);
ok('有到期日字符串', /^\d{4}-\d{2}-\d{2}$/.test(fresh.expiresAt), fresh.expiresAt);
const old = L.expiryOf(new Date(Date.now() - 31 * 86400000).toISOString());
ok('31 天前生成 = 已过期（天数 ≤ 0）', old.daysLeft <= 0, String(old.daysLeft));
eq('无 createdAt 时给空', L.expiryOf('').daysLeft, null);

// ---------- 4. 探针：真连假的瑞幸 MCP ----------
const seen = [];
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: body && body.method, auth: req.headers.authorization });
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify(obj)); };
    if (body && body.method === 'initialize') return reply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } });
    if (body && body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (body && body.method === 'tools/list') return reply({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'findShop' }, { name: 'searchProduct' }, { name: 'createOrder' }] } });
    res.writeHead(400); res.end('{}');
  });
});
await new Promise((r2) => fake.listen(0, '127.0.0.1', r2));

// 真端点写死在模块里，所以这里直接测底层 probeMcp 的 header 传递 + 不试调
const { probeMcp } = await import('../lib/travel.js');
const probed = await probeMcp('http://127.0.0.1:' + fake.address().port + '/mcp', {
  sample: false,
  headers: { Authorization: 'Bearer ' + TOKEN },
});
eq('假服务端 ok', probed.ok, true);
eq('工具列表透传', probed.tools, ['findShop', 'searchProduct', 'createOrder']);
eq('没有试调任何工具', probed.sample, null);
ok('每次都带上了 Authorization', seen.every((s) => s.auth === 'Bearer ' + TOKEN), JSON.stringify(seen));
ok('没有发出 tools/call', !seen.some((s) => s.method === 'tools/call'), JSON.stringify(seen));
ok('返回值里没有完整 token', !JSON.stringify(probed).includes(TOKEN));

// 401：假 token 要能把原始错误带回来
const deny = http.createServer((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"message":"访问令牌无效或已过期"}'); });
await new Promise((r2) => deny.listen(0, '127.0.0.1', r2));
const denied = await probeMcp('http://127.0.0.1:' + deny.address().port + '/mcp', { sample: false });
eq('401 判失败', denied.ok, false);
ok('401 带原始信息', denied.error.includes('401') && denied.error.includes('访问令牌无效'), denied.error);

// buildToken 的错要在 probeLuckin 阶段就抛（不发请求）
let threw = null;
try { await L.probeLuckin('abc'); } catch (e) { threw = String(e.message); }
ok('短 token 直接抛不联网', Boolean(threw && threw.includes('太短')), String(threw));

fake.close();
deny.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(pass + ' PASS / ' + fail + ' FAIL');
if (fail === 0) console.log('all luckin tests passed ✓');
process.exitCode = fail === 0 ? 0 : 1;
