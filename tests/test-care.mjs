// 生活关怀层单测：node tests/test-care.mjs
//
// 这一层要回答的问题只有一个：同一份"照顾人"的能力（健康汇总 / 常用坐标 /
// 管家工具），能不能不依赖 QQ 会话 id 就挂上去。
// 因此断言分三组：
//   1) 纯函数：模式判定、名字表、空渲染不注册
//   2) 安装器：用假 systemPrompt 记录调用，验证逐个注册 + 单条失败不连坐 + 释放
//   3) 接线：index.js 真的把关怀层挂在根 ctx 上，且 QQ 侧退回模式下才补挂
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CARE from '../lib/care.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');

// ---------- 1. 模式判定 ----------
// 默认（开关开 + 宿主有 systemPrompt）→ 全局
assert.strictEqual(CARE.careMode({ careGlobal: true, hasSystemPrompt: true }), 'global', '默认应挂全局');
// 用户主动关掉 → 退回 QQ 专用，且这是"用户的选择"，不是降级
assert.strictEqual(CARE.careMode({ careGlobal: false, hasSystemPrompt: true }), 'qq', '关掉开关应退回 QQ 专用');
// 宿主缺服务 → 退回 QQ 专用（缺能力不是用户不想要，不能静默丢掉）
assert.strictEqual(CARE.careMode({ careGlobal: true, hasSystemPrompt: false }), 'qq', '宿主无 systemPrompt 时应退回 QQ 专用');
assert.strictEqual(CARE.careMode(), 'qq', '无参数时保守退回 QQ 专用');

// ---------- 2. 名字表 ----------
assert.strictEqual(CARE.CARE_BUTLER.name, 'cura:butler');
assert.strictEqual(CARE.CARE_BUTLER.order, 93);
assert.deepStrictEqual(CARE.CARE_CONTEXTS.map((c) => c.name), ['cura:health', 'cura:places']);
assert.deepStrictEqual(CARE.CARE_CONTEXTS.map((c) => c.order), [94, 94]);
// QQ 旧名字必须与全局名字不同：相同会让同一段文字在提示词里出现两次
for (const key of ['butler', 'health', 'places']) {
  assert.notStrictEqual(CARE.LEGACY_NAMES[key], CARE['CARE_' + key.toUpperCase()]?.name ?? '', `${key} 旧名不能与全局名相同`);
}
assert.strictEqual(CARE.LEGACY_NAMES.health, 'qq-bot:health');
assert.strictEqual(CARE.LEGACY_NAMES.places, 'qq-bot:places');
assert.strictEqual(CARE.LEGACY_NAMES.butler, 'qq-bot:butler');

// ---------- 3. safeRender：渲染器抛错不能带崩整轮 ----------
assert.strictEqual(CARE.safeRender(() => 'x'), 'x');
assert.strictEqual(CARE.safeRender(() => ''), '');
assert.strictEqual(CARE.safeRender(() => null), '');
assert.strictEqual(CARE.safeRender(() => undefined), '');
assert.strictEqual(CARE.safeRender(() => 42), '42', '非字符串要转成字符串');
assert.strictEqual(CARE.safeRender(() => { throw new Error('boom'); }), '', '抛错降级为空串');
assert.strictEqual(CARE.safeRender(null), '', '非函数返回空串');
assert.strictEqual(CARE.safeRender('str'), '', '字符串不是渲染器');

// ---------- 4. careSection：空文本不注册 ----------
assert.strictEqual(CARE.careSection(''), null, '空串不注册 section');
assert.strictEqual(CARE.careSection('   '), null, '纯空白不注册 section');
assert.strictEqual(CARE.careSection(null), null);
const sec = CARE.careSection('去点咖啡吧');
assert.deepStrictEqual(sec, { kind: 'section', name: 'cura:butler', order: 93, text: '去点咖啡吧' });
// 字符串版本安装时定稿：之后改源字符串不影响已注册内容
const legacySec = CARE.careSection('旧提示', CARE.LEGACY_NAMES.butler, 93);
assert.strictEqual(legacySec.name, 'qq-bot:butler', 'QQ 模式要用旧名字');
// 函数版本每轮重读：配置改了下一轮就生效（不用重启会话）
let dynamic = '第一版';
const fnSec = CARE.careSection(() => dynamic);
dynamic = '第二版';
assert.strictEqual(fnSec.text(), '第二版', '函数版 section 每轮重读');
assert.strictEqual(fnSec.name, 'cura:butler');
// 函数版抛错也降级
assert.strictEqual(CARE.careSection(() => { throw new Error('x'); }).text(), '');

// ---------- 5. careContexts：没有渲染器就跳过 ----------
assert.deepStrictEqual(CARE.careContexts({}), [], '没有渲染器时什么都不注册');
assert.deepStrictEqual(CARE.careContexts({ health: () => 'h' }).map((c) => c.name), ['cura:health']);
assert.deepStrictEqual(
  CARE.careContexts({ health: () => 'h', places: () => 'p' }).map((c) => c.name),
  ['cura:health', 'cura:places'],
  '顺序稳定',
);
// context 的 text 必须是函数（每轮重读），不能是快照字符串
const ctxs = CARE.careContexts({ health: () => 'h' });
assert.strictEqual(typeof ctxs[0].text, 'function', '动态 context 必须用函数');
assert.strictEqual(ctxs[0].text(), 'h');
// 名字表覆盖
const legacyCtxs = CARE.careContexts({ health: () => 'h', places: () => 'p' }, CARE.LEGACY_NAMES);
assert.deepStrictEqual(legacyCtxs.map((c) => c.name), ['qq-bot:health', 'qq-bot:places'], 'QQ 模式用旧名字');
assert.deepStrictEqual(legacyCtxs.map((c) => c.order), [94, 94], 'order 不变');

// ---------- 6. carePlan：section 在前、contexts 在后 ----------
const plan = CARE.carePlan({ butler: 'b', health: () => 'h', places: () => 'p' });
assert.deepStrictEqual(plan.map((s) => s.name), ['cura:butler', 'cura:health', 'cura:places']);
assert.deepStrictEqual(plan.map((s) => s.kind), ['section', 'context', 'context']);
// 没有 butler 文本 → 只有两个 context
assert.deepStrictEqual(CARE.carePlan({ health: () => 'h', places: () => 'p' }).map((s) => s.name), ['cura:health', 'cura:places']);
// 全空 → 空计划（不注册空条目）
assert.deepStrictEqual(CARE.carePlan({}), []);
// 名字表能整体切到 QQ 旧名
assert.deepStrictEqual(
  CARE.carePlan({ butler: 'b', health: () => 'h', names: CARE.LEGACY_NAMES }).map((s) => s.name),
  ['qq-bot:butler', 'qq-bot:health'],
);

// ---------- 7. installCareLayer：用假 systemPrompt 验接线 ----------
function fakePrompt(opts = {}) {
  const calls = [];
  return {
    calls,
    section(arg) { calls.push({ type: 'section', arg }); if (opts.failOn?.includes(arg.name)) throw new Error('duplicate'); return () => calls.push({ type: 'dispose', name: arg.name }); },
    context(arg) { calls.push({ type: 'context', arg }); if (opts.failOn?.includes(arg.name)) throw new Error('duplicate'); return () => calls.push({ type: 'dispose', name: arg.name }); },
  };
}
const fake = fakePrompt();
const result = CARE.installCareLayer(fake, { butler: '去点咖啡', health: () => '近 7 天', places: () => '常用坐标' });
assert.deepStrictEqual(result.installed, ['cura:butler', 'cura:health', 'cura:places']);
assert.strictEqual(result.failed.length, 0);
assert.strictEqual(typeof result.disposers.length, 'number');
assert.strictEqual(result.disposers.length, 3);
assert.deepStrictEqual(fake.calls.map((c) => c.type), ['section', 'context', 'context'], 'section 先注册');
assert.deepStrictEqual(fake.calls.map((c) => c.arg.name), ['cura:butler', 'cura:health', 'cura:places']);
assert.strictEqual(fake.calls[0].arg.order, 93);
assert.strictEqual(fake.calls[1].arg.order, 94);
assert.strictEqual(fake.calls[1].arg.text(), '近 7 天', '渲染器要真的被接上');
assert.strictEqual(fake.calls[2].arg.text(), '常用坐标');

// 单条失败不连坐：健康条目重名，其余两个仍要装上
const logs = [];
const partial = fakePrompt({ failOn: ['cura:health'] });
const r2 = CARE.installCareLayer(partial, { butler: 'b', health: () => 'h', places: () => 'p', log: (m, ...a) => logs.push(m + ' ' + a.join(' ')) });
assert.deepStrictEqual(r2.installed, ['cura:butler', 'cura:places'], '一条失败其余照装');
assert.deepStrictEqual(r2.failed, ['cura:health']);
assert.strictEqual(r2.disposers.length, 2, '只收成功项的释放器');
assert.strictEqual(logs.length, 1);
assert.ok(logs[0].includes('cura:health'), '失败要有日志可查');

// 没有 systemPrompt 服务：安静返回空结果，不抛
const empty = CARE.installCareLayer(null, { butler: 'b', health: () => 'h' });
assert.deepStrictEqual(empty.installed, []);
assert.deepStrictEqual(empty.disposers, []);

// ---------- 8. disposeCare：幂等 + 单项抛错不阻断 ----------
let disposed = 0;
const order = [];
const res = { disposers: [() => { disposed++; order.push('a'); }, () => { throw new Error('bad'); }, () => { disposed++; order.push('c'); }] };
CARE.disposeCare(res);
assert.strictEqual(disposed, 2, '抛错的释放器不影响其余');
assert.deepStrictEqual(order, ['a', 'c']);
CARE.disposeCare(res);
assert.strictEqual(disposed, 4, '二次释放不报错（幂等调用）');
assert.doesNotThrow(() => CARE.disposeCare(null));
assert.doesNotThrow(() => CARE.disposeCare({ disposers: 'x' }));

// dispose 时真的把注册撤掉了（模拟宿主：disposer 从表里删名）
function livePrompt() {
  const table = new Map();
  return {
    table,
    section(arg) { if (table.has(arg.name)) throw new Error('dup'); table.set(arg.name, arg); return () => table.delete(arg.name); },
    context(arg) { if (table.has(arg.name)) throw new Error('dup'); table.set(arg.name, arg); return () => table.delete(arg.name); },
  };
}
const live = livePrompt();
const liveRes = CARE.installCareLayer(live, { butler: () => 'b', health: () => 'h', places: () => 'p' });
assert.strictEqual(live.table.size, 3);
CARE.disposeCare(liveRes);
assert.strictEqual(live.table.size, 0, '释放后条目应清空');
// 释放后能重新装（宿主热重载场景）
assert.doesNotThrow(() => CARE.installCareLayer(live, { butler: 'b', health: () => 'h', places: () => 'p' }));

// ---------- 9. 接线：index.js 真的挂在根 ctx 上 ----------
const indexSrc = fs.readFileSync(path.resolve(root, 'lib', 'index.js'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const bare = stripComments(indexSrc);
assert.ok(/CARE\.installCareLayer\(\s*systemPromptService/.test(bare), '关怀层必须挂到根 ctx 的 systemPrompt（全局）');
assert.ok(/careMode\s*===\s*'qq'/.test(bare), 'QQ 侧补挂必须由 careMode 把关，避免全局模式下重复注册');
assert.ok(!/name:\s*'cura:health'/.test(bare), '名字应由 care.js 统一给出，不在 index.js 里手写');
assert.ok(/careGlobal/.test(bare), '开关要能读配置');

// careGlobal=false 时 index.js 不能无条件全局挂：安装块必须在 careMode === 'global' 之内
assert.ok(/if \(careMode === 'global'\)/.test(bare), '全局挂载要以 careMode 为条件');

// 全局挂载失败要有日志，不能说"挂好了"却什么都没挂
assert.ok(/未挂上任何条目/.test(bare), '全部失败时要有显式警告');

// 释放要接进卸载路径，否则热禁用插件后注入还在
assert.ok(/CARE\.disposeCare\(careInstall\)/.test(bare), '卸载时要释放关怀层');

// 每个 mountButler 调用点都必须显式传目标数组：漏传会让 fiber 没人持有，
// 卸载时放飞不掉（挂上去了却收不回来，热禁用插件后 server 还在）。
{
  const calls = [...bare.matchAll(/mountButler\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, `应该有全局与会话两个挂载点，实际 ${calls.length}`);
  for (const args of calls) {
    const parts = args.split(',').map((s) => s.trim()).filter(Boolean);
    assert.strictEqual(parts.length, 3, `mountButler 应传三参（scope, label, fibers），实际: ${args}`);
    assert.ok(/fibers$/i.test(parts[2]), `第三个参数必须是要收的 fiber 数组，实际: ${parts[2]}`);
  }
}

console.log('all care layer tests passed ✓');
process.exitCode = 0;
