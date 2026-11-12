// 规则库纯逻辑单测：node tests/test-rules.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from '../lib/rules.js';

// ---------- bigrams ----------
const g = R.bigrams('通宵了好困 abc');
assert.ok(g.has('通宵') && g.has('宵了') && g.has('abc'), 'bigrams 应含 CJK 二字组与 ASCII 词');
assert.strictEqual(R.bigrams('').size, 0, '空串无 bigram');

// ---------- scoreRule ----------
const rule = { situation: '用户深夜没睡/熬夜了', keywords: ['通宵', '困'] };
assert.ok(R.scoreRule(rule, '我又通宵了，好困') > 3, '关键词命中应得高分');
assert.strictEqual(R.scoreRule(rule, '今天天气不错'), 0, '无关文本 0 分');
assert.ok(R.scoreRule({ situation: '用户熬夜了', keywords: [] }, '最近总是熬夜') > 0, 'situation bigram 也能贡献分数');

// ---------- selectRules：有信号取 top-K，无信号按 salt 轮换 ----------
const lib = { rules: R.SEED_RULES.map((r) => ({ ...r })) };
const hit = R.selectRules(lib, '我又通宵了，好困', { count: 4, salt: 1 });
assert.strictEqual(hit[0].rule.id, 's01', '通宵消息应首推熬夜规则');
assert.ok(hit.length === 4, '不足 count 时用轮换补齐');
const rotA = R.selectRules(lib, '哈哈哈', { count: 3, salt: 1 }).map((x) => x.rule.id).join(',');
const rotB = R.selectRules(lib, '哈哈哈', { count: 3, salt: 2 }).map((x) => x.rule.id).join(',');
assert.notStrictEqual(rotA, rotB, '不同 salt 轮换应给出不同补位');
const rotA2 = R.selectRules(lib, '哈哈哈', { count: 3, salt: 1 }).map((x) => x.rule.id).join(',');
assert.strictEqual(rotA, rotA2, '同 salt 结果稳定（同一轮内两次渲染一致）');

// ---------- renderSceneBlock / renderGlobalBlock ----------
const block = R.renderSceneBlock(hit, 700);
assert.ok(block.startsWith('【情境表达参考'), '块头正确');
assert.ok(block.includes('熬夜'), '应含命中的规则文本');
assert.strictEqual(R.renderSceneBlock([{ rule: { situation: 'x', style: 'y'.repeat(2000) } }], 100), '', '超预算整块丢弃');
const gb = R.renderGlobalBlock(lib);
assert.ok(gb.includes('【说话方式（聊天强制）】') && gb.includes('【永远不做】'), '全局+反面双段');

// ---------- 事件解析（mneme 同口径 mock） ----------
const events = [
  { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '今晚又要通宵了' }] } },
  { seq: 2, type: 'assistant/message', data: { source: { kind: 'assistant' }, message: { content: [{ type: 'text', text: '去躺 40 分钟，回来再说' }] } } },
  { seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这条被撤回了' }] } },
  { seq: 4, type: 'user/message', data: { content: [{ type: 'text', text: '正常的消息' }] } },
  { seq: 5, type: 'tool/result', data: { source: { kind: 'tool' }, message: { content: [{ type: 'text', text: '假装是回复的输出' }] } } },
];
const vis = new Set([1, 2, 4, 5]);
const rounds = R.roundsFromEvents(events, vis, 24);
assert.strictEqual(rounds.length, 2, '两轮：撤回条被排除、tool 输出不算回复');
assert.strictEqual(rounds[0].response, '去躺 40 分钟，回来再说', 'assistant 正文从 data.message.content 取');
const recent = R.recentUserText(events, vis);
assert.ok(recent.includes('正常的消息') && !recent.includes('撤回'), '最近用户消息应排除被遮蔽事件');
assert.ok(recent.includes('通宵'), 'maxMessages=4 时两条都取');
assert.strictEqual(R.recentUserText(events, vis, { maxMessages: 1 }), '正常的消息', 'maxMessages=1 只取最新一条');

// ---------- 学习：prompt / 解析 / 合并去重 ----------
const prompt = R.buildExtractPrompt(rounds, ['已有情境A']);
assert.ok(prompt.includes('用户：今晚又要通宵了') && prompt.includes('已有情境A'), 'prompt 含对话与已有情境');
const parsed = R.parseExtracted('好的，以下是结果：\n```json\n[{"situation":"用户说了晚安","style":"一句晚安+一个反问","keywords":["晚安"]},{"situation":""}]\n```');
assert.strictEqual(parsed.length, 1, '围栏 JSON 解析+空字段过滤');
const lib2 = { rules: [
  { id: 's01', scope: 'scene', situation: '用户深夜没睡/熬夜了', style: 'x', keywords: ['睡', '熬夜'] },
  { id: 's02', scope: 'scene', situation: '用户报喜', style: 'y', keywords: ['过了', '上岸'] },
] };
const added = R.mergeLearned(lib2, [
  { situation: '用户又熬夜了', style: 'a', keywords: ['熬夜'] },          // 情境 bigram 相近 → 跳过
  { situation: '用户考试通过了', style: 'b', keywords: ['过了', '上岸'] },  // 情境不像但关键词重合 → 跳过
  { situation: '用户说了晚安', style: 'c', keywords: ['晚安'] },           // 全新 → 入库
], { maxRules: 140 });
assert.strictEqual(added, 1, '情境相近/关键词重合的不重复入库');
assert.strictEqual(lib2.rules[lib2.rules.length - 1].source, 'learned', '新规则标记 learned');
const capped = R.mergeLearned({ rules: Array.from({ length: 140 }, () => ({ id: 'x', scope: 'scene', situation: 's', style: 't' })) }, [{ situation: '全新情境', style: '新' }], { maxRules: 140 });
assert.strictEqual(capped, 0, '库满停止入库');

// ---------- 库文件读写 ----------
const file = path.join(os.tmpdir(), `anima-rules-test-${process.pid}.json`);
assert.strictEqual(R.loadLibrary(file), null, '不存在返回 null');
R.saveLibrary(file, lib2);
const loaded = R.loadLibrary(file);
assert.strictEqual(loaded.rules.length, lib2.rules.length, 'roundtrip 保存/加载');
assert.ok(loaded.updatedAt, 'updatedAt 已写');
fs.unlinkSync(file);

// ---------- enabled 开关（管理页选择能力） ----------
const lib3 = { rules: [
  { id: 'a', scope: 'scene', situation: '用户熬夜了', style: 'x', keywords: ['熬夜'], enabled: false },
  { id: 'b', scope: 'scene', situation: '用户报喜', style: 'y', keywords: ['过了'] },
  { id: 'c', scope: 'global', situation: '任何时候', style: '全局规则', enabled: false },
  { id: 'd', scope: 'ban', situation: '任何时候', style: '禁令', enabled: false },
] };
assert.strictEqual(R.selectRules(lib3, '我又熬夜了', { count: 4, salt: 1 }).some((p) => p.rule.id === 'a'), false, 'disabled 的 scene 规则不参与匹配');
assert.strictEqual(R.selectRules(lib3, '随便聊', { count: 4, salt: 1 }).some((p) => p.rule.id === 'a'), false, 'disabled 也不进轮换补位');
assert.ok(!R.renderGlobalBlock(lib3).includes('全局规则') && !R.renderGlobalBlock(lib3).includes('禁令'), 'disabled 的 global/ban 不渲染');
assert.ok(R.selectRules(lib3, '我过了！', { count: 4, salt: 1 })[0].rule.id === 'b', 'enabled 的照常命中');

console.log('all rules tests passed ✓');
