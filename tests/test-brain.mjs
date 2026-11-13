// 大脑代理准入单测：node tests/test-brain.mjs
//
// 这一套要钉死的是 dshopen 维护者指出的那个洞：插件自开的 127.0.0.1:8765
// 不做认证就能调模型，本机任意网页都能白嫖额度。所以断言分四组：
//   1) 纯函数：token 生成/解析/定长比较、base URL 拼接
//   2) 准入判决：跨站必拒、token 放行、connection 放行、服务缺失 fail closed
//   3) 接线（静态）：index.js 不再自建 http server、改向 webServer 注册路由并先要判决
//   4) 引擎侧（静态）：Python 引擎优先吃插件注入的地址与 token
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BRAIN from '../lib/brain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');

// ---------- 1. 常量与纯函数 ----------
assert.strictEqual(BRAIN.BRAIN_PREFIX, '/cura/v1', '代理前缀固定为 /cura/v1，避免和宿主 /api 抢路由');
assert.strictEqual(BRAIN.BRAIN_PATH, '/cura/v1/chat/completions', '代理路径应是 OpenAI 兼容的 chat/completions');
assert.ok(BRAIN.MAX_BODY > 0 && BRAIN.MAX_BODY <= 8 * 1024 * 1024, '请求体上限应在合理区间');
// 前缀必须是 /cura/ 开头：宿主 webserver 的 exact 路由优先于 /api 前缀命中，
// 万一撞上宿主自己的路径，就是「插件的洞变成宿主的洞」。
assert.ok(BRAIN.BRAIN_PREFIX.startsWith('/cura/'), '代理前缀应挂在插件自己的命名空间下');

{
  const a = BRAIN.newToken();
  const b = BRAIN.newToken();
  assert.match(a, /^[0-9a-f]{64}$/, 'token 应是 32 字节十六进制');
  assert.notStrictEqual(a, b, '每次生成必须不同，不能是常量');
  // 不能落盘：源码里不该出现把 token 写进配置的痕迹
  const src = fs.readFileSync(path.join(root, 'lib', 'brain.js'), 'utf8');
  assert.ok(!/writeFileSync|appendFileSync/.test(src), 'token 不能写盘，只在进程内存里');
}

{
  const req = (headers) => ({ headers });
  assert.strictEqual(BRAIN.bearerOf(req({ authorization: 'Bearer abc123' })), 'abc123');
  assert.strictEqual(BRAIN.bearerOf(req({ authorization: 'bearer   abc123  ' })), 'abc123', 'scheme 大小写与多余空格都要容忍');
  assert.strictEqual(BRAIN.bearerOf(req({ authorization: 'Basic abc123' })), undefined, '只认 Bearer');
  assert.strictEqual(BRAIN.bearerOf(req({})), undefined);
  assert.strictEqual(BRAIN.bearerOf(undefined), undefined, '没有 request 也不能抛');
  assert.strictEqual(BRAIN.bearerOf(req({ authorization: 'Bearer ' })), undefined, '空 token 不算 token');
}

{
  assert.strictEqual(BRAIN.tokenMatches('abc', 'abc'), true);
  assert.strictEqual(BRAIN.tokenMatches('abc', 'abd'), false);
  assert.strictEqual(BRAIN.tokenMatches('abc', 'abcd'), false, '长度不同直接 false，不能只比前缀');
  assert.strictEqual(BRAIN.tokenMatches('', ''), false, '两边都空不能算匹配');
  assert.strictEqual(BRAIN.tokenMatches(undefined, 'abc'), false);
  assert.strictEqual(BRAIN.tokenMatches('abc', undefined), false, '期望值缺失时不能放行');
}

{
  assert.strictEqual(BRAIN.brainBaseUrl('http://127.0.0.1:28641'), 'http://127.0.0.1:28641/cura/v1');
  assert.strictEqual(BRAIN.brainBaseUrl('http://127.0.0.1:28641/'), 'http://127.0.0.1:28641/cura/v1', '尾部斜杠不能拼出双斜杠');
  assert.strictEqual(BRAIN.brainBaseUrl(''), '', '取不到 origin 时返回空串，让引擎退回 config.json');
  assert.strictEqual(BRAIN.brainBaseUrl(undefined), '');
}

// ---------- 2. 准入判决 ----------
const TOKEN = 'f'.repeat(64);
const reqOf = (headers) => ({ headers: headers ?? {} });

{
  // 跨站请求：本机任意网页都能发起的那类，必须无条件拒
  const v = BRAIN.authorize(reqOf({ 'sec-fetch-site': 'cross-site', authorization: `Bearer ${TOKEN}` }), { token: TOKEN });
  assert.strictEqual(v.ok, false, '即使带了正确 token，跨站请求也必须拒');
  assert.strictEqual(v.status, 403);
}

{
  const v = BRAIN.authorize(reqOf({ authorization: `Bearer ${TOKEN}` }), { token: TOKEN });
  assert.deepStrictEqual(v, { ok: true, via: 'token' }, '本机引擎带正确 token 应放行');
}

{
  const v = BRAIN.authorize(reqOf({ authorization: 'Bearer wrong' }), { token: TOKEN });
  assert.strictEqual(v.ok, false, 'token 不对不能放行');
  assert.strictEqual(v.status, 503, '没有 connection 可判时，错 token 也只能 fail closed');
}

{
  // 浏览器场景：没有 token，交给 connection 判
  let seen = null;
  const connection = { requestRejection: (req) => { seen = req; return undefined; } };
  const req = reqOf({ cookie: 'dsh-auth-x=1' });
  const v = BRAIN.authorize(req, { connection, token: TOKEN });
  assert.deepStrictEqual(v, { ok: true, via: 'connection' });
  assert.strictEqual(seen, req, '必须把原请求交给 connection，不能自己造一个');
}

{
  const connection = { requestRejection: () => 403 };
  const v = BRAIN.authorize(reqOf({}), { connection, token: TOKEN });
  assert.deepStrictEqual(v, { ok: false, status: 403, message: 'forbidden' }, 'connection 的 403 要原样传出');
}

{
  const connection = { requestRejection: () => 401 };
  const v = BRAIN.authorize(reqOf({}), { connection, token: TOKEN });
  assert.strictEqual(v.status, 401);
}

{
  // 关键回归：服务缺失/抛错时必须 fail closed，绝不能"服务没了就放行"
  for (const connection of [undefined, null, {}, { requestRejection: 42 }]) {
    const v = BRAIN.authorize(reqOf({}), { connection, token: TOKEN });
    assert.strictEqual(v.ok, false, `connection=${JSON.stringify(connection)} 时必须拒绝`);
    assert.strictEqual(v.status, 503, '服务不可用返回 503（fail closed），不是 200');
  }
  const v = BRAIN.authorize(reqOf({}), { connection: { requestRejection() { throw new Error('boom'); } }, token: TOKEN });
  assert.strictEqual(v.ok, false, 'connection 抛错也不能放行');
  assert.strictEqual(v.status, 503);
}

{
  // 返回值越界时收敛到 401，不能把 200/302 当成"拒绝"写回响应
  const v = BRAIN.authorize(reqOf({}), { connection: { requestRejection: () => 200 }, token: TOKEN });
  assert.strictEqual(v.status, 401, '越界的 rejection 码要收敛成 401');
}

{
  // writeJson：必须是 no-store，别让中间层缓存模型输出
  const res = { head: null, body: '', writeHead(s, h) { this.head = { s, h }; }, end(b) { this.body = b; } };
  BRAIN.writeJson(res, 403, { error: { message: 'nope' } });
  assert.strictEqual(res.head.s, 403);
  assert.match(String(res.head.h['content-type']), /application\/json/);
  assert.strictEqual(res.head.h['cache-control'], 'no-store');
  assert.strictEqual(Number(res.head.h['content-length']), Buffer.byteLength(res.body), 'content-length 要按字节算，不是字符数');
}

// ---------- 3. 接线：index.js 不再自建 server ----------
const index = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8');
// 剥掉注释再断言，避免"注释里写了 createServer 也算命中"的假失败
const bare = index.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

assert.ok(!/http\.createServer/.test(bare), '不能自己 createServer：那就是维护者指出的无认证端口');
assert.ok(!/\.listen\(/.test(bare), '不能自己 listen：端口与准入都必须由宿主 webServer 统一管');
assert.ok(!/from 'node:http'/.test(bare), '自建 server 的依赖应已移除');
assert.ok(/BRAIN\.BRAIN_PATH/.test(bare), '路由路径必须来自 brain.js，不能另写一份字面量');
assert.ok(/BRAIN\.createHandler\(/.test(bare), 'handler 必须由 brain.js 的 createHandler 造（准入逻辑不能散在 index.js 里）');
assert.ok(!/chatViaDsh\(llmCtx/.test(bare.split('const brainHandler')[0] ?? ''), '准入之前不能有任何调模型的路径');
assert.ok(/webServer/.test(bare) && /register\(/.test(bare), '应向宿主 webServer 注册路由');
assert.ok(/'exact'/.test(bare), '路由应是 exact：prefix 会吞掉同前缀下的其它路径');
assert.ok(/ctx\.inject\(\['webServer'\]/.test(bare), 'webServer 是可选服务，应走 inject 而不是写进顶层 inject 数组');
assert.ok(/CURA_BRAIN_URL/.test(bare) && /CURA_BRAIN_TOKEN/.test(bare), '插件要把地址与 token 通过环境变量交给引擎');

// 顶层 inject 不能加 webServer：宿主没有它时整个插件会被拖成不可用
{
  const m = /export const inject = \[([^\]]*)\]/.exec(index);
  assert.ok(m, '找不到顶层 inject 声明');
  const names = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepStrictEqual(names, ['agents', 'tools'], '顶层 inject 应仍是 agents+tools，webServer 走可选 inject');
}

// 环境变量必须同时传给两个入口：托管进程与一次性的 dsh-chat
{
  const spawns = [...bare.matchAll(/env:\s*\{\s*\.\.\.process\.env,\s*\.\.\.brainEnv\(\)/g)];
  assert.strictEqual(spawns.length, 2, `引擎的两个启动点都要传 brainEnv，实际 ${spawns.length} 处`);
}

// ---------- 4. 引擎侧：优先吃插件注入的地址与 token ----------
const engine = fs.readFileSync(path.join(root, 'engine', 'engine.py'), 'utf8');
assert.ok(/CURA_BRAIN_URL/.test(engine), '引擎要认插件注入的地址');
assert.ok(/CURA_BRAIN_TOKEN/.test(engine), '引擎要认插件注入的 token');
assert.ok(/_from_plugin/.test(engine), '插件模式下要放宽私网地址校验（宿主就在 127.0.0.1）');
{
  // 插件模式必须让 token 优先于 config.json 的 apiKey：否则 token 校验过不了
  const m = /api_key = ([^\n]+)/.exec(engine);
  assert.ok(m, '找不到 api_key 取值行');
  assert.ok(/plugin_token/.test(m[1]), `插件模式下 token 应优先，实际: ${m[1].trim()}`);
}

// 示例配置不能再把 8765 当默认：那是老版本自开端口时的地址
const example = fs.readFileSync(path.join(root, 'engine', 'config.example.json'), 'utf8');
assert.ok(!/127\.0\.0\.1:8765/.test(example), '示例配置里不该再出现 8765');
assert.ok(/CURA_BRAIN_URL/.test(example), '示例配置要说明插件注入优先');


// ---------- 5. 真跑一次 HTTP：本机网页到底能不能白嫖额度 ----------
// 前面几组都是纯函数断言，但维护者的指控是「本机任意网页都能消耗额度」，
// 这件事只有真的起一个 server、真的发请求才算证明过。
const { createServer } = await import('node:http');

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

async function call(base, { method = 'POST', headers = {}, body } = {}) {
  const res = await fetch(`${base}/cura/v1/chat/completions`, { method, headers, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

{
  let chatCalls = 0;
  const silent = { info() {}, warning() {}, error() {} };
  const handler = BRAIN.createHandler({
    token: TOKEN,
    connectionOf: () => undefined, // 服务缺失 = 只能靠 token
    historyLimit: 5,
    logger: silent,
    chat: async (messages) => { chatCalls += 1; return `echo:${messages.length}`; },
  });
  const { base, close } = await serve(handler);
  try {
    // 1) 没有 token、没有 connection → 503，且绝不能碰模型
    let r = await call(base, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }) });
    assert.strictEqual(r.status, 503, '无凭据时必须 fail closed');
    assert.strictEqual(chatCalls, 0, '被拒的请求绝不能调到模型——这才是「白嫖额度」那条洞');

    // 2) 带正确 token → 200
    r = await call(base, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.strictEqual(r.status, 200, '本机引擎带 token 应 200');
    assert.strictEqual(r.json?.choices?.[0]?.message?.content, 'echo:1');
    assert.strictEqual(chatCalls, 1);

    // 3) 跨站即使带对 token 也拒 —— 这是「本机任意网页」那条路
    const before = chatCalls;
    r = await call(base, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'steal' }] }),
    });
    assert.strictEqual(r.status, 403, '跨站请求必须 403');
    assert.strictEqual(chatCalls, before, '跨站请求也不能调到模型');

    // 4) 非 POST → 405，且不读体
    r = await call(base, { method: 'GET' });
    assert.strictEqual(r.status, 405);

    // 5) 坏 JSON → 400
    r = await call(base, { headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{not json' });
    assert.strictEqual(r.status, 400);

    // 6) 超大体 → 413
    r = await call(base, {
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(BRAIN.MAX_BODY + 10) }] }),
    });
    assert.strictEqual(r.status, 413, '超上限必须 413，不能整包读进内存');
  } finally {
    await close();
  }
}

{
  // 7) 模型出错 → 502；带 status 的错（llm 未就绪 503）要原样透出
  const handler = BRAIN.createHandler({
    token: TOKEN,
    connectionOf: () => undefined,
    logger: { info() {}, warning() {}, error() {} },
    chat: async () => { throw new Error('upstream down'); },
  });
  const { base, close } = await serve(handler);
  try {
    const r = await call(base, { headers: { authorization: `Bearer ${TOKEN}` }, body: '{}' });
    assert.strictEqual(r.status, 502, '模型抛错应回 502');
  } finally { await close(); }

  const handler503 = BRAIN.createHandler({
    token: TOKEN,
    connectionOf: () => undefined,
    logger: { info() {}, warning() {}, error() {} },
    chat: async () => { const e = new Error('llm 服务尚未就绪'); e.status = 503; throw e; },
  });
  const s2 = await serve(handler503);
  try {
    const r = await call(s2.base, { headers: { authorization: `Bearer ${TOKEN}` }, body: '{}' });
    assert.strictEqual(r.status, 503, 'llm 未就绪应回 503 而不是 502');
  } finally { await s2.close(); }
}

{
  // 8) 浏览器路径：connection 放行 → 200；拒绝 → 403
  let allowed = true;
  const handler = BRAIN.createHandler({
    token: TOKEN,
    connectionOf: () => ({ requestRejection: () => (allowed ? undefined : 403) }),
    logger: { info() {}, warning() {}, error() {} },
    chat: async () => 'ok',
  });
  const { base, close } = await serve(handler);
  try {
    let r = await call(base, { headers: { cookie: 'dsh-auth-x=1' }, body: '{}' });
    assert.strictEqual(r.status, 200, 'connection 放行应 200');
    allowed = false;
    r = await call(base, { headers: { cookie: 'dsh-auth-x=1' }, body: '{}' });
    assert.strictEqual(r.status, 403, 'connection 拒绝应 403');
  } finally { await close(); }
}


// ---------- 6. 引擎不能当哑巴：拿不到大脑地址就别启动 ----------
{
  assert.ok(/if \(brainBaseUrl\(\)\) \{ spawnEngine\(\); return; \}/.test(bare),
    '引擎启动前必须确认 brainBaseUrl() 已就绪，否则它会连不上大脑代理');
  assert.ok(/waited >= 20000/.test(bare), '等不到 webServer 要有上限，不能无限重试');
  assert.ok(/engineTimer\.unref\?\.\(\)/.test(bare), '等待定时器要 unref，否则插件退出被它拖住');
}

console.log('all brain proxy tests passed ✓');
process.exitCode = 0;
