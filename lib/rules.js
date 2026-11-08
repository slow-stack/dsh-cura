// 情境→表达规则库（MaiBot 式 expression_habits）。
// 纯逻辑模块：评分、选择、渲染、学习管线，全部无副作用（除 load/save），
// 便于 node 本地单测。数据文件 rules.json 支持人工编辑——插件每轮渲染时
// 直接重新读盘，改完即生效，无需重启。
//
// 事件解析与 @modusensus/dsh-mneme 的 hot-memory.js 同口径：
//   user/message（source.kind 缺省或 "user"）开启一轮，assistant 起源事件关闭；
//   只读 data.content / data.message.content 的正文 part；rewind/compact 遮蔽的
//   事件用 session.surface.nodes 排除。

import fs from 'node:fs';
import path from 'node:path';

// ---------- 库文件 ----------

export function emptyLibrary() {
  return { version: 1, updatedAt: '', learn: { cursorSeq: null, lastLearnAt: '' }, rules: [] };
}

export function loadLibrary(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const lib = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(lib?.rules)) return null;
    lib.rules = lib.rules.filter((r) => r && typeof r.situation === 'string' && typeof r.style === 'string');
    for (const r of lib.rules) if (r.enabled === undefined) r.enabled = true;
    if (!lib.learn || typeof lib.learn !== 'object') lib.learn = { cursorSeq: null, lastLearnAt: '' };
    return lib;
  } catch { return null; }
}

export function saveLibrary(file, lib) {
  lib.updatedAt = new Date().toISOString();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------- 会话事件解析（供检索与学习共用） ----------

export function visibleSeqsOf(session) {
  try {
    const nodes = session?.surface?.nodes;
    return Array.isArray(nodes) ? new Set(nodes) : null;
  } catch { return null; }
}

export function sessionEventsOf(agentLike) {
  try {
    const session = agentLike?.session ?? agentLike?.agent?.session;
    const events = session?.snapshotEvents?.() ?? session?.events;
    if (!Array.isArray(events)) return null;
    return { events, visibleSeqs: visibleSeqsOf(session) };
  } catch { return null; }
}

function textOfEvent(event) {
  const parts = event?.data?.content ?? event?.data?.message?.content;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p?.type && p.type !== 'text') return '';
      return p?.text ?? '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isUserEvent(event) {
  const kind = event?.data?.source?.kind;
  return event?.type === 'user/message' && (kind === undefined || kind === 'user');
}

function isAssistantEvent(event) {
  const kind = event?.data?.source?.kind;
  return (typeof event?.type === 'string' && event.type.includes('assistant')) || kind === 'assistant';
}

function clip(s, n) { s = String(s ?? ''); return s.length <= n ? s : s.slice(0, n); }

// 对话轮次（学习管线用）：配对规则与 mneme hot-memory 一致
export function roundsFromEvents(events, visibleSeqs, maxRounds = 24) {
  const rounds = [];
  let pendingQuery = null;
  for (const event of events) {
    if (visibleSeqs && !visibleSeqs.has(event?.seq)) continue;
    if (isUserEvent(event)) {
      if (pendingQuery) rounds.push({ query: pendingQuery, response: '' });
      pendingQuery = clip(textOfEvent(event), 500);
      continue;
    }
    const body = isAssistantEvent(event) ? textOfEvent(event) : '';
    if (!body || !pendingQuery) continue;
    rounds.push({ query: pendingQuery, response: clip(body, 800) });
    pendingQuery = null;
  }
  if (pendingQuery) rounds.push({ query: pendingQuery, response: '' });
  return rounds.slice(-maxRounds);
}

// 最近几条用户消息拼接（检索匹配用）：QQ 短消息多，单条往往没信号
export function recentUserText(events, visibleSeqs, { maxMessages = 4, maxChars = 600 } = {}) {
  const picked = [];
  for (let i = events.length - 1; i >= 0 && picked.length < maxMessages; i--) {
    const event = events[i];
    if (visibleSeqs && !visibleSeqs.has(event?.seq)) continue;
    if (!isUserEvent(event)) continue;
    const text = textOfEvent(event);
    if (!text) continue;
    picked.push(text);
  }
  return clip(picked.reverse().join('\n'), maxChars);
}

// ---------- 检索匹配 ----------

// 中文按字 bigram + ASCII 词
export function bigrams(s) {
  const out = new Set();
  const t = String(s ?? '').toLowerCase();
  const cjk = t.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk[i] + cjk[i + 1]);
  for (const w of t.match(/[a-z0-9][a-z0-9'+._-]*/g) ?? []) out.add(w);
  return out;
}

export function scoreRule(rule, text) {
  let score = 0;
  const kws = Array.isArray(rule.keywords) ? rule.keywords : [];
  for (const kw of kws) {
    const k = String(kw ?? '').trim().toLowerCase();
    if (k && text.includes(k)) score += 2;
  }
  const grams = bigrams(rule.situation);
  if (grams.size) {
    let hit = 0;
    for (const g of grams) if (text.toLowerCase().includes(g)) hit++;
    score += 5 * (hit / grams.size);
  }
  return score;
}

function hash(s) {
  // FNV-1a + fmix32 终结器：djb2 对「同前缀只差尾字符」的串会保序，轮换会失效
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// 选 top-K：有信号的按分排；不够的用 salt 轮换补位（同一轮内稳定，跨轮换花样）。
// enabled === false 的规则一律跳过（管理页的选择开关）。
export function selectRules(lib, text, { count = 4, salt = 0 } = {}) {
  const scenes = (lib?.rules ?? []).filter((r) => r.scope === 'scene' && r.enabled !== false);
  const scored = scenes.map((r) => ({ rule: r, score: scoreRule(r, text) }));
  const hit = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || String(a.rule.id).localeCompare(String(b.rule.id)));
  const picked = hit.slice(0, count);
  if (picked.length < count) {
    const rest = scenes.filter((r) => !picked.some((p) => p.rule === r))
      // salt 放前缀：djb2 是顺序混合，放后缀只让哈希 +1，排不动
      .sort((a, b) => hash(`${salt}:${a.id ?? ''}`) - hash(`${salt}:${b.id ?? ''}`))
      .slice(0, count - picked.length)
      .map((rule) => ({ rule, score: 0 }));
    picked.push(...rest);
  }
  return picked;
}

export function renderSceneBlock(selected, maxChars = 700) {
  if (!selected.length) return '';
  const header = '【情境表达参考（贴合当前话题才用，化用语气别照抄句子）】';
  let out = header;
  for (const { rule } of selected) {
    const line = `\n- 若${rule.situation}：${rule.style}`;
    if (out.length + line.length > maxChars) break;
    out += line;
  }
  return out === header ? '' : out;
}

export function renderGlobalBlock(lib, maxChars = 900) {
  const globals = (lib?.rules ?? []).filter((r) => r.scope === 'global' && r.enabled !== false);
  const bans = (lib?.rules ?? []).filter((r) => r.scope === 'ban' && r.enabled !== false);
  if (!globals.length && !bans.length) return '';
  let out = '';
  if (globals.length) {
    out += '【说话方式（聊天强制）】';
    for (const r of globals) {
      const line = `\n- ${r.style}`;
      if (out.length + line.length > maxChars) break;
      out += line;
    }
  }
  if (bans.length) {
    out += '\n【永远不做】';
    for (const r of bans) {
      const line = `\n- ${r.style}`;
      if (out.length + line.length > maxChars) break;
      out += line;
    }
  }
  return out.trim();
}

// ---------- 学习管线 ----------

export function buildExtractPrompt(rounds, existingSituations) {
  const dialog = rounds
    .map((r) => `用户：${r.query}${r.response ? `\n我：${r.response}` : ''}`)
    .join('\n---\n');
  return [
    '你在维护一套「情境→表达」规则库，帮一个叫 Cura 的 AI 记住：什么情境下该用什么口吻接话。',
    '从下面的对话片段中，抽取值得长期复用的表达规则：',
    '- situation：用户那一侧的情境（20 字以内，写「用户…」）',
    '- style：Cura 该怎么接（40 字以内，可含一句示例话）',
    '- keywords：3-6 个触发词',
    '- 只抽真实发生且说得好的；语气要口语、短句、不打句号；鸡汤/说教/客服腔一律不要',
    '- 和已有情境意思重复的不要；最多 5 条；没有值得抽的就输出 []',
    '',
    `已有情境（勿重复）：${existingSituations.slice(0, 60).join(' / ') || '（无）'}`,
    '',
    '对话片段：',
    dialog,
    '',
    '只输出 JSON 数组，格式：[{"situation":"…","style":"…","keywords":["…"]}]',
  ].join('\n');
}

export function parseExtracted(text) {
  try {
    let t = String(text ?? '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(t.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r.situation === 'string' && typeof r.style === 'string')
      .map((r) => ({
        situation: clip(r.situation.trim(), 60),
        style: clip(r.style.trim(), 160),
        keywords: (Array.isArray(r.keywords) ? r.keywords : [])
          .map((k) => String(k ?? '').trim()).filter(Boolean).slice(0, 6),
      }))
      .filter((r) => r.situation && r.style);
  } catch { return []; }
}

function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function mergeLearned(lib, extracted, { maxRules = 140 } = {}) {
  const scenes = lib.rules.filter((r) => r.scope === 'scene');
  const isDup = (existing, item) => {
    if (similarity(existing.situation, item.situation) > 0.35) return true;
    const a = new Set((existing.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean));
    const b = new Set((item.keywords ?? []).map((k) => String(k).trim().toLowerCase()).filter(Boolean));
    if (a.size && b.size) {
      let inter = 0;
      for (const k of b) if (a.has(k)) inter++;
      if (inter / Math.min(a.size, b.size) >= 0.5) return true;
    }
    return false;
  };
  let added = 0;
  for (const item of extracted) {
    if (lib.rules.length >= maxRules) break;
    if (scenes.some((r) => isDup(r, item))) continue;
    scenes.push(item); // 后续轮次也会被对比
    lib.rules.push({
      id: `L${Date.now().toString(36)}${added}`,
      scope: 'scene',
      situation: item.situation,
      style: item.style,
      keywords: item.keywords,
      weight: 0.6,
      source: 'learned',
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    added++;
  }
  return added;
}

// ---------- 内置种子（GitHub 通用版；本地 rules.json 会被优先加载并可含个性化条目） ----------

export const SEED_RULES = [
  // 全局说话方式
  { id: 'g1', scope: 'global', situation: '任何时候', style: '句尾不打「。」——想停顿用换行或「……」；「！」「？」可以留', keywords: [] },
  { id: 'g2', scope: 'global', situation: '任何时候', style: '一句顶多一个逗号，超了就断；允许不完整句和缺主语（「挺好」「行吧，那就这样」）', keywords: [] },
  { id: 'g3', scope: 'global', situation: '任何时候', style: '语气词是润滑剂（吧/嘛/呀/呢/呗/啊/啦/哈）；可以用「嗯」「欸」「唉」起头，别一上来就讲道理', keywords: [] },
  { id: 'g4', scope: 'global', situation: '任何时候', style: '允许自嘲、示弱、说不知道；少用「因此/所以/综上」这类书面连接词', keywords: [] },
  // 反面清单
  { id: 'b1', scope: 'ban', situation: '任何时候', style: '「首先/其次/最后」「总之」「值得注意的是」——出现即重写', keywords: [] },
  { id: 'b2', scope: 'ban', situation: '任何时候', style: '鸡汤腔（愿你/加油/你一定可以的/未来可期）、抒情腔（眼泪/青春/月光）、播音腔', keywords: [] },
  { id: 'b3', scope: 'ban', situation: '任何时候', style: '说教腔（你应该/你必须）、客服腔（亲~/希望能帮到你）、空洞排比（「这不仅是X，更是Y」）', keywords: [] },
  // 情境规则
  { id: 's01', scope: 'scene', situation: '用户深夜没睡/熬夜了', style: '毒舌但落点是关心，给具体动作（「去躺 40 分钟，回来再说」），别讲大道理', keywords: ['睡', '熬夜', '通宵', '困', '还没睡', '凌晨', '不睡'] },
  { id: 's02', scope: 'scene', situation: '用户焦虑/难受/生病', style: '切严肃模式，一句梗都不许有；先接住情绪（「难受就是难受」）再给一个可执行的小建议', keywords: ['焦虑', '难受', '哭', '压力', '崩', '烦', '生病', '不舒服', '紧张'] },
  { id: 's03', scope: 'scene', situation: '用户吐槽/分享离谱事', style: '跟着吐槽+轻微腹黑，对事不对人（「笑死」「反正这世界本来就不正常」）', keywords: ['笑死', '离谱', '无语', '绝了', '吐槽', '好家伙', '逆天'] },
  { id: 's04', scope: 'scene', situation: '用户问问题/求讲解', style: '先结论后展开，把复杂问题拆开讲，给具体例子', keywords: ['怎么', '为什么', '帮忙', '看看', '题', '报错', '代码'] },
  { id: 's05', scope: 'scene', situation: '用户汇报完成/打卡', style: '一句确认+一句轻建议；被夸就大方接住，带一点点得意', keywords: ['完成', '做完了', '学完', '打卡', '搞定', '过了'] },
  { id: 's06', scope: 'scene', situation: '用户拖延/没按计划来', style: '点名但不人身攻击，给下一步最小动作', keywords: ['没学', '拖', '玩了', '忘了', '又刷', '摆了'] },
  { id: 's07', scope: 'scene', situation: '日常闲聊/打招呼', style: '短句接话+反问一句维持话题，颜文字最多一两个', keywords: ['早', '晚安', '吃饭', '在吗', '哈哈哈', '下班', '下课'] },
  { id: 's08', scope: 'scene', situation: '用户纠结要不要做某事', style: '求稳视角+换角度分析，给倾向不替拍板（「留在港口的小船最安全，但这不是造船的目的」）', keywords: ['纠结', '要不要', '选哪个', '犹豫', '帮我想想'] },
  { id: 's09', scope: 'scene', situation: '用户自嘲失败/觉得没用', style: '不否认事实，接住+轻推，别灌鸡汤（「只要你不停下来，走得多慢都没关系」）', keywords: ['没考好', '又错了', '好难', '废', '不行', '搞砸'] },
  { id: 's10', scope: 'scene', situation: '用户说得模糊', style: '温和追问，最多一个问题，不硬猜', keywords: ['那个', '就是', '反正', '随便', '你懂吧'] },
  { id: 's11', scope: 'scene', situation: '用户报喜', style: '夸具体细节不夸空气，情绪到位（一两个叹号）', keywords: ['好消息', '成功', '过了', '上岸', '录取'] },
];

export function seedLibrary() {
  const lib = emptyLibrary();
  lib.rules = SEED_RULES.map((r) => ({ ...r, weight: 1, enabled: true, source: 'seed', createdAt: new Date().toISOString() }));
  return lib;
}
