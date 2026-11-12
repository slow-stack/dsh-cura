// 规则库宿主行（rules-remote）服务测试：stub cordis ctx，直测全方法 + 学习链路。
// 环境里没有 @deepseek-ai/dsh-typert-protocol → 走降级基类（方法面相同）。
// node tests/test-remote.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import svcModule from '../lib/rules-remote.js';
import * as TR from '../lib/travel.js';

const Service = svcModule.default ?? svcModule.AnimaRulesService ?? svcModule;
assert.ok(typeof Service === 'function', '默认导出服务类');

// 临时 json 一律落在系统临时目录：测试文件本身是被 git 追踪的，不能往仓库里写
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-remote-'));
const RULES_FILE = path.join(TMP_DIR, 'test-rules-remote.json');
try { fs.unlinkSync(RULES_FILE); } catch { /* ignore */ }

const effects = [];
const ctx = {
  reflect: { provide() {} },
  effect(fn, name) { const out = fn(); if (typeof out === 'function') effects.push(out); },
  logger: () => ({ info() {}, warn() {}, error() {} }),
};

// ---------- 构造：定时器 effect 被登记（targetUser 空 → 不启动，返回 undefined） ----------
const svcIdle = new Service(ctx, { rulesFile: RULES_FILE, targetUser: '' });
let snap = await svcIdle.getRules();
assert.ok(Array.isArray(snap.rules) && snap.rules.length >= 18, 'getRules 种子兜底');
assert.strictEqual(snap.learn.enabled, false, '未配 targetUser → 学习关闭标记');
assert.strictEqual(snap.file, RULES_FILE, '快照带文件路径');

// ---------- addRule / 校验失败 ----------
snap = await svcIdle.addRule({ scope: 'scene', situation: '用户抱怨加班', style: '跟着吐槽+轻推休息', keywords: '加班, 累，下班' });
const added = snap.rules.find((r) => r.source === 'manual');
assert.ok(added && added.situation === '用户抱怨加班', '手动规则入库');
assert.deepStrictEqual(added.keywords, ['加班', '累', '下班'], '中英文逗号混分隔切词');
await assert.rejects(svcIdle.addRule({ situation: '', style: 'x' }), /情境 不能为空/, '空情境拒绝');
await assert.rejects(svcIdle.addRule({ situation: 'x', style: '  ' }), /表达 不能为空/, '空表达拒绝');

// ---------- update / toggle / delete / not-found ----------
snap = await svcIdle.updateRule(added.id, { situation: '用户说好累', scope: 'global' });
const updated = snap.rules.find((r) => r.id === added.id);
assert.strictEqual(updated.scope, 'global', 'update 改 scope');
snap = await svcIdle.toggleRule(added.id, false);
assert.strictEqual(snap.rules.find((r) => r.id === added.id).enabled, false, 'toggle 关闭');
snap = await svcIdle.deleteRule(added.id);
assert.ok(!snap.rules.some((r) => r.id === added.id), 'delete 生效');
await assert.rejects(svcIdle.deleteRule('nope'), /规则不存在/, '删不存在 404 语义');
await assert.rejects(svcIdle.updateRule('nope', { style: 'x' }), /规则不存在/, '改不存在 404 语义');

// ---------- 学习链路：agents/llm stub，8 轮对话 + LLM 返回 JSON 规则 ----------
const RULES_FILE2 = path.join(TMP_DIR, 'test-rules-remote2.json');
try { fs.unlinkSync(RULES_FILE2); } catch { /* ignore */ }

const sessions = new Map();
const ctx2 = {
  reflect: { provide() {} },
  effect(fn, name) { const out = fn(); if (typeof out === 'function') effects.push(out); },
  logger: () => ({ info() {}, warn() {}, error() {} }),
  agents: {
    get(id) {
      return sessions.get(id) ?? null;
    },
  },
};
const mockLlm = {
  stream({ messages }) {
    const userText = messages[messages.length - 1].content[0].text;
    assert.ok(userText.includes('已有情境'), '抽取 prompt 含已有情境');
    return (async function* () {
      yield { type: 'text-delta', text: '好的：' };
      yield { type: 'text-delta', text: '\n```json\n[{"situation":"用户在问明天天气","style":"报个大概+一句反问","keywords":["天气"]},{"situation":"用户在问明天天气","style":"重复的不要","keywords":["天气"]}]' };
      yield { type: 'text-delta', text: '\n```' };
    })();
  },
};
ctx2.llm = mockLlm;

const events = [];
for (let i = 0; i < 8; i++) {
  events.push({ seq: i * 2 + 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: `测试消息${i}，明天天气怎么样` }] } });
  events.push({ seq: i * 2 + 2, type: 'assistant/message', data: { source: { kind: 'assistant' }, message: { content: [{ type: 'text', text: `回复${i}` }] } } });
}
sessions.set('onebot-private-123', { session: { snapshotEvents: () => events, surface: { nodes: events.map((e) => e.seq) } } });

const svcLearn = new Service(ctx2, {
  rulesFile: RULES_FILE2, targetUser: '123', learnEnabled: true, learnIntervalMin: 360,
});
await svcLearn.learnOnce(); // 直调（learnNow 是 void 触发，测不到结果）

snap = await svcLearn.getRules();
assert.strictEqual(snap.learn.enabled, true, '配置齐全 → 学习启用标记');
const learned = snap.rules.filter((r) => r.source === 'learned');
assert.strictEqual(learned.length, 1, 'LLM 抽取 2 条、去重后入库 1 条');
assert.strictEqual(learned[0].situation, "用户在问明天天气", "入库名对");
assert.strictEqual(snap.learn.cursorSeq, 16, '游标推进到最大 seq');
assert.ok(snap.learn.lastLearnAt, 'lastLearnAt 已写');

// 再跑一次：游标之后无新事件 → 新对话不足，跳过（不再新增）
await svcLearn.learnOnce();
snap = await svcLearn.getRules();
assert.strictEqual(snap.rules.filter((r) => r.source === 'learned').length, 1, '无新对话不重复入库');

// ---------- learnNow 守卫 ----------
const svcNoTarget = new Service(ctx, { rulesFile: RULES_FILE, targetUser: '' });
await assert.rejects(svcNoTarget.learnNow(), /未配置 targetUser/, '无 targetUser 拒绝 learnNow');

// ---------- getVoiceInfo：stub configEditor 读主插件行配置 + 链路体检 ----------
// 链路体检只看「sayScript 同级有没有那些文件」，所以在临时目录里造一份，
// 不依赖作者机器上真装了 tts-volc.py / .volc / stt-whisper.py。
const VOICE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-voice-'));
for (const f of ['say.ps1', 'stt-whisper.py', 'tts-volc.py', '.volc', '.key']) {
  fs.writeFileSync(path.join(VOICE_DIR, f), 'x');
}
const ctx3 = {
  reflect: { provide() {} },
  effect(fn) { const out = fn(); if (typeof out === 'function') effects.push(out); },
  logger: () => ({ info() {}, warn() {}, error() {} }),
  configEditor: {
    entries: () => [{
      options: {
        id: 'dsh-cura',
        config: { port: 8765, sayScript: path.join(VOICE_DIR, 'say.ps1'), enginePython: '', engineDir: '' },
      },
    }],
  },
};
const svcVoice = new Service(ctx3, { rulesFile: RULES_FILE, targetUser: '' });
const vi = await svcVoice.getVoiceInfo();
assert.strictEqual(vi.proxy.port, 8765, '端口取自主插件配置');
assert.strictEqual(typeof vi.proxy.alive, 'boolean', '代理探活字段存在');
assert.strictEqual(vi.engine.managed, false, '未配置引擎 → managed false');
assert.strictEqual(vi.tts.length, 4, '四保险链四行');
assert.strictEqual(vi.tts[0].ready, true, 'sayScript 同级有 tts-volc.py + .volc → 火山层就绪');
assert.strictEqual(vi.tts[1].ready, true, 'sayScript 同级有 .key → 阿里云层就绪');
assert.strictEqual(vi.stt.ready, true, 'sayScript 同级有 stt-whisper.py → STT 就绪');
assert.ok(vi.sayScript.startsWith(VOICE_DIR), 'sayScript 用配置里的值');
fs.rmSync(VOICE_DIR, { recursive: true, force: true });
const noEditor = new Service({ reflect: { provide() {} }, effect() {}, logger: () => ({ info() {}, warn() {}, error() {} }) }, { rulesFile: RULES_FILE, targetUser: '' });
const vi2 = await noEditor.getVoiceInfo();
assert.strictEqual(vi2.proxy.port, 8765, 'configEditor 缺席 → 走默认值不抛错');
// 默认值必须落在本包根目录下，不能是作者机器的盘符（发版后别人装上才有意义）
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.strictEqual(path.dirname(vi2.sayScript), PKG_ROOT, '默认 sayScript 落在包根');
assert.ok(!/[A-Za-z]:\\\\/.test(vi2.sayScript) || vi2.sayScript.startsWith(PKG_ROOT), '默认路径不含作者机器专属目录');

// ---------- 健康数据面：日志 CRUD / 目标 / 周期 ----------
const HEALTH_FILE = path.join(TMP_DIR, 'test-health.json');
try { fs.unlinkSync(HEALTH_FILE); } catch { /* ignore */ }
const ctxH = {
  reflect: { provide() {} },
  effect(fn) { const out = fn(); if (typeof out === 'function') effects.push(out); },
  logger: () => ({ info() {}, warn() {}, error() {} }),
  configEditor: { entries: () => [] },
};
const svcH = new Service(ctxH, { rulesFile: RULES_FILE, healthFile: HEALTH_FILE, targetUser: '' });

let hs = await svcH.getHealth();
assert.strictEqual(hs.logs.length, 0, '初始日志空');
assert.strictEqual(hs.cycle.enabled, false, '周期默认关');
assert.strictEqual(hs.cycle.today, null, '未启用周期 → today null');

hs = await svcH.addHealthLog({ sleepHours: 6.5, sleepQuality: 3, mood: 4, exercise: '跑步30分钟', notes: '有点累' });
assert.strictEqual(hs.logs.length, 1, '日志入库');
assert.strictEqual(hs.summary.total, 1, '汇总计入');
assert.strictEqual(hs.summary.exerciseCount, 1, '运动计数');
assert.ok(fs.existsSync(HEALTH_FILE), 'health.json 落盘');

await assert.rejects(svcH.addHealthLog({ sleepHours: 99 }), /sleepHours/, '睡眠越界拒绝');
await assert.rejects(svcH.addHealthLog({}), /至少要有一个字段/, '空日志拒绝');

hs = await svcH.saveHealthConfig({ habits: { sleepTarget: 8, exerciseWeekly: 4, focusNote: '少喝咖啡' } });
assert.strictEqual(hs.habits.sleepTarget, 8, '目标写入');
assert.strictEqual(hs.habits.focusNote, '少喝咖啡', '关注备注写入');
await assert.rejects(svcH.saveHealthConfig({ habits: { sleepTarget: 99 } }), /sleepTarget/, '目标越界拒绝');

hs = await svcH.saveHealthProfile({ heightCm: 168, birthYear: 1998, sex: 'female' });
assert.strictEqual(hs.profile.heightCm, 168, '基础资料写入');
assert.strictEqual(hs.profile.sex, 'female', '性别写入');
await assert.rejects(svcH.saveHealthProfile({ heightCm: 99 }), /heightCm/, '身高越界拒绝');
await assert.rejects(svcH.saveHealthProfile({ sex: 'other' }), /sex/, '性别枚举拒绝');
hs = await svcH.saveHealthProfile({ heightCm: null });
assert.strictEqual(hs.profile.heightCm, null, '身高可清除');
hs = await svcH.saveHealthProfile({ heightCm: 168 });
assert.ok(hs.tiles.find((t) => t.key === 'weight').bmi !== undefined, '瓷砖字段存在');

hs = await svcH.saveCycle({ enabled: true, lastStart: '2026-11-01', cycleLength: 28, periodLength: 5 });
assert.strictEqual(hs.cycle.enabled, true, '周期开启');
assert.ok(hs.cycle.today && hs.cycle.today.phaseName, 'today 已计算');
await assert.rejects(svcH.saveCycle({ lastStart: '2026-13-99' }), /lastStart/, '非法日期拒绝');
hs = await svcH.saveCycle({ enabled: false });
assert.strictEqual(hs.cycle.enabled, false, '周期停用');
assert.strictEqual(hs.cycle.today, null);

const delId = hs.logs[0].id;
hs = await svcH.deleteHealthLog(delId);
assert.strictEqual(hs.logs.length, 0, '日志删除');
await assert.rejects(svcH.deleteHealthLog('nope'), /日志不存在/, '删不存在日志 404 语义');

// ---------- 回归：cordis traceable proxy 下必须可用 ----------
// 这是面板四页全空的真凶。cordis（lib/index.js createTraceable）给 Service 套
// traceable Proxy，方法调用时 this 是 proxy 而非实例；#私有 字段的 brand check
// 只认实例，proxy 上一读就抛 Receiver must be an instance of class X。
// 下面用与 cordis 同构的 proxy 复算这条链路，先证明这套装置确实能让 #私有 翻车，
// 再证明本服务在同样装置下全方法可用。

const CORDIS_ORIGINAL = Symbol.for('cordis.original');
const CORDIS_SHADOW = Symbol.for('cordis.shadow');

/** 与 cordis createShadow 等价：把 ctx 覆盖成 shadow 站点，挂在 receiver 外层。 */
function shadowOf(receiver, useSite) {
  return new Proxy(receiver, {
    get(target, prop, r) {
      if (prop === 'ctx') return useSite;
      return Reflect.get(target, prop, r);
    },
    set(target, prop, value, r) {
      if (prop === 'ctx') return false;
      return Reflect.set(target, prop, value, r);
    },
  });
}

/** 与 cordis createTraceable 的 get 分支等价（只取本用例走到的路径）。 */
function traceable(value, useSite) {
  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === CORDIS_ORIGINAL) return target;
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      const desc = Reflect.getOwnPropertyDescriptor(target, prop)
        ?? Reflect.getOwnPropertyDescriptor(Object.getPrototypeOf(target), prop);
      if (desc && 'value' in desc && typeof desc.value !== 'function') return desc.value;
      const inner = Reflect.get(target, prop, receiver);
      if (typeof inner === 'function') {
        return new Proxy(inner, {
          apply(fn, thisArg, args) {
            const arg = thisArg === receiver ? shadowOf(receiver, useSite) : thisArg;
            return Reflect.apply(fn, arg, args);
          },
        });
      }
      return inner;
    },
  });
  return proxy;
}

// 装置自检：同一装置必须让 #私有 翻车，否则这个回归测试是假的
class BrandProbe {
  #secret = 42;
  read() { return this.#secret; }
}
const probeSite = { extend: () => probeSite };
const probeReal = new BrandProbe();
assert.strictEqual(probeReal.read(), 42, '对照：直接实例上 #私有 读得通');
const probe = traceable(probeReal, probeSite);
assert.throws(
  () => probe.read(),
  /Receiver must be an instance of class BrandProbe|private/i,
  '自检：同一装置确实能复现 brand check 崩溃',
);

// 真身：同一 proxy 装置下调本服务的每个对外方法
const SITE = { extend: () => SITE };
const svcProxy = traceable(svcH, SITE);

let ps = await svcProxy.getRules();
assert.ok(Array.isArray(ps.rules) && ps.rules.length >= 18, 'proxy 下 getRules 有数据');
assert.strictEqual(typeof ps.file, 'string', 'proxy 下快照字段完整');

ps = await svcProxy.addRule({ situation: 'proxy 链路写规则', style: '正常回', keywords: 'a,b' });
const proxyAdded = ps.rules.find((r) => r.situation === 'proxy 链路写规则');
assert.ok(proxyAdded, 'proxy 下 addRule 生效');
ps = await svcProxy.toggleRule(proxyAdded.id, false);
assert.strictEqual(ps.rules.find((r) => r.id === proxyAdded.id).enabled, false, 'proxy 下 toggleRule 生效');
ps = await svcProxy.deleteRule(proxyAdded.id);
assert.ok(!ps.rules.some((r) => r.id === proxyAdded.id), 'proxy 下 deleteRule 生效');

let ph = await svcProxy.getHealth();
assert.ok(Array.isArray(ph.logs), 'proxy 下 getHealth 有数据');
ph = await svcProxy.addHealthLog({ sleepHours: 7, mood: 4 });
assert.strictEqual(ph.logs.length, 1, 'proxy 下 addHealthLog 生效');
ph = await svcProxy.saveCycle({ enabled: true, lastStart: '2026-11-01' });
assert.strictEqual(ph.cycle.enabled, true, 'proxy 下 saveCycle 生效');
ph = await svcProxy.deleteHealthLog(ph.logs[0].id);
assert.strictEqual(ph.logs.length, 0, 'proxy 下 deleteHealthLog 生效');

const vp = await svcProxy.getVoiceInfo();
assert.ok(vp.proxy && vp.tts.length === 4, 'proxy 下 getVoiceInfo 有数据');
await assert.rejects(svcProxy.deleteHealthLog('nope'), /日志不存在/, 'proxy 下错误语义照旧');

// 状态必须落在实例本身：原实例与 proxy 读到同一份配置
assert.strictEqual(svcH.snapshot().file, svcProxy.snapshot().file, 'proxy 与原实例共用同一份状态');

// ---------- 出行（高德 MCP）：配置落盘 + 真连一次 ----------
const TRAVEL_FILE = path.join(TMP_DIR, 'test-travel-remote.json');
try { fs.unlinkSync(TRAVEL_FILE); } catch { /* ignore */ }
const AMAP_KEY = 'b'.repeat(32);
const svcT = new Service(ctx, { travelFile: TRAVEL_FILE });

let tv = await svcT.getTravel();
assert.strictEqual(tv.enabled, false, '未配置时 enabled=false');
assert.strictEqual(tv.url, '', '未配置时无 url');
assert.strictEqual(tv.serverName, 'amap', 'server 名固定 amap');

tv = await svcT.saveTravel({ input: AMAP_KEY });
assert.strictEqual(tv.enabled, true, '保存后 enabled');
assert.ok(!tv.url.includes(AMAP_KEY), '面板只拿打码地址');
assert.strictEqual(tv.keyTail, 'bbbb', '回末四位');
assert.strictEqual(tv.file, TRAVEL_FILE, '回配置文件路径');
const onDisk = JSON.parse(fs.readFileSync(TRAVEL_FILE, 'utf8'));
assert.ok(onDisk.amap.url.includes(AMAP_KEY), '完整 key 只落本机文件（挂载要用）');
await assert.rejects(svcT.saveTravel({ input: '这不是key' }), /key 应为/, '乱输入拒绝');

// 真连一次：本地假 MCP server（走 service 层，验 argsText 映射与 session 传递）
const { createServer } = await import('node:http');
const fakeMcp = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify(obj)); };
    if (!body || body.method === undefined) { res.writeHead(202); res.end(); return; }
    if (body.method === 'initialize') return reply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } });
    if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (body.method === 'tools/list') return reply({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'maps_weather' }, { name: 'maps_geo' }, { name: 'maps_around_search' }] } });
    if (body.method === 'tools/call') {
      const nm = body.params && body.params.name;
      const ag = (body.params && body.params.arguments) || {};
      if (nm === 'maps_geo') {
        return reply({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ location: '120.024682,30.293915', province: '浙江省', city: '杭州市', district: '余杭区', level: '兴趣点' }], echoCity: ag.city || '' }) }] } });
      }
      if (nm === 'maps_around_search') {
        return reply({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ pois: [{ id: 'B1', name: '瑞幸咖啡(假店)', address: '某路 1 号', typecode: '050500' }] }) }] } });
      }
      return reply({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok-from-fake' }] } });
    }
    res.writeHead(400); res.end('{}');
  });
});
await new Promise((resolve) => fakeMcp.listen(0, '127.0.0.1', resolve));
const fakePort = fakeMcp.address().port;
tv = await svcT.saveTravel({ input: 'http://127.0.0.1:' + fakePort + '/mcp?key=' + AMAP_KEY });
assert.strictEqual(tv.enabled, true, '完整 MCP 地址也能存');
const tested = await svcT.testTravel({});
assert.strictEqual(tested.ok, true, 'testTravel 真连成功');
assert.ok(!JSON.stringify(tested).includes(AMAP_KEY), '探针结果里也没有完整 key');
assert.deepStrictEqual(tested.tools, ['maps_weather', 'maps_geo', 'maps_around_search'], '工具列表透传');
assert.strictEqual(typeof tested.sample.argsText, 'string', 'sample 参数线上是字符串');
assert.ok(tested.sample.text.includes('ok-from-fake'), '试调正文透传');
await assert.rejects(svcT.testTravel({ input: 'bad key' }), /key 应为/, '测试时乱输入直接拒绝');

// ---- 常用坐标（服务层）：地名 → 坐标 → 落盘 ----
let ts = await svcT.getTravel();
assert.deepStrictEqual(ts.places, [], '初始没有常用坐标');

const located = await svcT.locateTravel({ input: '杭州师范大学仓前校区', city: '杭州' });
assert.strictEqual(located.ok, true, 'locateTravel 成功');
assert.strictEqual(located.picked.location, '120.024682,30.293915', 'locateTravel 取到坐标');
assert.ok(!JSON.stringify(located).includes(AMAP_KEY), 'locateTravel 结果不带 key');
const emptyLoc = await svcT.locateTravel({ input: '  ' });
assert.strictEqual(emptyLoc.ok, false, '空地名不联网');

const nearSvc = await svcT.aroundTravel({ input: '咖啡', location: '120.024682,30.293915' });
assert.strictEqual(nearSvc.ok, true, 'aroundTravel 成功');
assert.strictEqual(nearSvc.pois[0].name, '瑞幸咖啡(假店)', 'POI 透传');
const nearBadSvc = await svcT.aroundTravel({ input: '咖啡', location: '哪里' });
assert.strictEqual(nearBadSvc.ok, false, 'aroundTravel 坐标非法');

ts = await svcT.savePlace({ name: '学校', address: '余杭塘路', location: '120.024682,30.293915', city: '杭州' });
assert.strictEqual(ts.places.length, 1, '存下一条常用坐标');
assert.strictEqual(ts.places[0].name, '学校', '名字透传');
assert.strictEqual(ts.places[0].city, '杭州', '城市透传');
const placeOnDisk = JSON.parse(fs.readFileSync(TRAVEL_FILE, 'utf8'));
assert.ok(placeOnDisk.places.length === 1, '常用坐标落盘');
assert.ok(placeOnDisk.amap.key === AMAP_KEY || String(placeOnDisk.amap.url).includes(AMAP_KEY), '存坐标不弄丢 key');

// 再存同一条（同 name+location）→ 不重复
ts = await svcT.savePlace({ name: '学校', location: '120.024682,30.293915' });
assert.strictEqual(ts.places.length, 1, '同名同坐标不重复');

await assert.rejects(svcT.savePlace({ name: '坏', location: 'nope' }), /坐标格式/, '非法坐标拒绝');
await assert.rejects(svcT.deletePlace({}), /哪一条/, '删不给 id 拒绝');

// proxy 下也能读到常用坐标
const travProxy2 = traceable(svcT, SITE);
const pv2 = await travProxy2.getTravel();
assert.strictEqual(pv2.places.length, 1, 'proxy 下 getTravel 带常用坐标');

ts = await svcT.deletePlace({ id: '学校|120.024682,30.293915' });
assert.strictEqual(ts.places.length, 0, '删掉常用坐标');
fakeMcp.close();

// proxy 路径（cordis 给服务套 layer）读到同一份状态
const travelProxy = traceable(svcT, SITE);
const pv = await travelProxy.getTravel();
assert.strictEqual(pv.keyTail, 'bbbb', 'proxy 下 getTravel 有数据');

tv = await svcT.saveTravel({ enabled: false });
assert.strictEqual(tv.enabled, false, 'enabled=false 停用');

// ---------- 瑞幸：token 落盘 + 探针不试调 ----------
const LUCKIN_FILE = path.join(TMP_DIR, 'test-luckin-remote.json');
try { fs.unlinkSync(LUCKIN_FILE); } catch { /* ignore */ }
const LK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'y'.repeat(40) + '.LUCKIN_MCP_AI';
const svcL = new Service(ctx, { luckinFile: LUCKIN_FILE });

let lv = await svcL.getLuckin();
assert.strictEqual(lv.enabled, false, '未配置时 enabled=false');
assert.strictEqual(lv.tokenTail, '', '未配置时无 token 尾巴');
assert.strictEqual(lv.serverName, 'my-coffee', 'server 名 my-coffee');
assert.strictEqual(lv.url, 'https://gwmcp.lkcoffee.com/order/user/mcp', '端点固定');

lv = await svcL.saveLuckin({ input: LK_TOKEN });
assert.strictEqual(lv.enabled, true, '保存后 enabled');
assert.ok(!JSON.stringify(lv).includes(LK_TOKEN), '面板/返回值里没有完整 token');
assert.strictEqual(lv.tokenTail, LK_TOKEN.slice(-4), '回末四位');
assert.strictEqual(lv.file, LUCKIN_FILE, '回配置文件路径');
assert.ok(typeof lv.daysLeft === 'number' && lv.daysLeft > 25, '给出剩余天数估算');
const lkOnDisk = JSON.parse(fs.readFileSync(LUCKIN_FILE, 'utf8'));
assert.strictEqual(lkOnDisk['my-coffee'].token, LK_TOKEN, '完整 token 只落本机文件');
await assert.rejects(svcL.saveLuckin({ input: 'abc' }), /太短/, '短 token 拒绝');

// 探针：真连一次（假 server），必须带 Authorization 且不能试调工具
const seenLk = [];
const fakeLk = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    seenLk.push({ method: body && body.method, auth: req.headers.authorization });
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify(obj)); };
    if (body && body.method === 'initialize') return reply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } });
    if (body && body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (body && body.method === 'tools/list') return reply({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'findShop' }, { name: 'createOrder' }] } });
    res.writeHead(400); res.end('{}');
  });
});
await new Promise((resolve) => fakeLk.listen(0, '127.0.0.1', resolve));
// 真端点写死在 luckin.js，service 的 testLuckin 走固定端点；这里用底层探针确认行为
const lkProbe = await TR.probeMcp('http://127.0.0.1:' + fakeLk.address().port + '/mcp', {
  sample: false,
  headers: { Authorization: 'Bearer ' + LK_TOKEN },
});
assert.strictEqual(lkProbe.ok, true, '瑞幸探针握手成功');
assert.deepStrictEqual(lkProbe.tools, ['findShop', 'createOrder'], '瑞幸工具列表透传');
assert.strictEqual(lkProbe.sample, null, '瑞幸探针不做样调（有会真实下单的）');
assert.ok(seenLk.every((s) => s.auth === 'Bearer ' + LK_TOKEN), '每条请求都带 Authorization');
assert.ok(!seenLk.some((s) => s.method === 'tools/call'), '没有发出 tools/call');
fakeLk.close();
await assert.rejects(svcL.testLuckin({ input: 'abc' }), /太短/, '测试时短 token 直接拒绝');

// 停用：server 消失，token 保留
lv = await svcL.saveLuckin({ enabled: false });
assert.strictEqual(lv.enabled, false, 'enabled=false 停用');
assert.ok(lv.hasToken, '停用后 token 仍在（再启用不用重填）');
const lkProxy = traceable(svcL, SITE);
const plv = await lkProxy.getLuckin();
assert.strictEqual(plv.tokenTail, LK_TOKEN.slice(-4), 'proxy 下 getLuckin 有数据');

// ---------- 清理 ----------
for (const d of effects) d?.();
fs.rmSync(TMP_DIR, { recursive: true, force: true });
console.log('all rules-remote tests passed ✓');
// 不硬 exit：getVoiceInfo 的探活 socket 可能还在关闭，Windows 上 process.exit()
// 撞上 uv 的 closing 断言会直接 abort（测试全绿却退出码 3221226505）。
process.exitCode = 0;
