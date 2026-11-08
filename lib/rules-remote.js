// dsh-cura — `curaRules` Typert Remote（root 平面，独立 patch 行）。
//
// 规则库管理面板的数据面：规则 CRUD + 学习引擎。学习只在这一行跑（单一写方），
// 主插件只读 rules.json 做检索注入——两侧以文件为界，不互调。
//
// 结构照抄 dsh-onebot lib/settings-remote.js（已验证的社区插件先例）：
//   - TypertRemoteService 子类 + mark() shim（无原生装饰器语法的原型标记）；
//   - @deepseek-ai/dsh-typert-protocol 不可解析时降级为普通 cordis 服务（同名方法面，
//     仅无网关发现，面板显示 Remote 不可用而不是炸掉插件加载）；
//   - descriptor 全 positional（宿主网关按位置序调用，拒绝解构/默认值/rest）；
//     descriptor 本体在浏览器侧 lib/client.js（两侧各持一份，须逐字对齐）。
//
// 宿主装载：cordis.patch.yml insert 行 `- id: dsh-cura-rules-remote /
// name: 'dsh-cura/rules-remote'`；机器相关配置走 profile patch 顶层同 id 行
// （insert 块内行 configEditor 不可寻址——dsh-onebot T6 实测结论）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as R from './rules.js';
import * as C from './cycle.js';
import * as H from './health.js';
import * as V from './voice.js';

const execFileP = promisify(execFile);

/** Typert Remote 命名空间 = cordis 服务键。 */
export const NAMESPACE = 'curaRules';
/** 学习引擎依赖：会话事件（agents）+ 抽取 LLM（llm）；语音页读主插件配置（configEditor）。 */
export const inject = ['agents', 'llm', 'configEditor'];

let protocol = null;
try {
  protocol = await import('@deepseek-ai/dsh-typert-protocol');
} catch { /* 裸 dev checkout：降级为普通服务 */ }

const SCOPES = ['scene', 'global', 'ban'];

// ---------- 实例状态：WeakMap 外置，绝不用 #私有 ----------
// cordis 给每个 Service 实例套一层 traceable Proxy（lib/index.js 的 createTraceable），
// 方法调用时 this 是 proxy 而不是 new 出来的实例。#私有字段/方法的 brand check
// 只认实例本身，proxy 上一读就抛「Receiver must be an instance of class X」——
// 这正是面板四页全空的根因（getRules 第一行读 this.#config 就炸）。
// 状态放模块级 WeakMap，键经 cordis.original 还原成实例本身；
// 既避开私有字段，也不依赖 proxy 的 set 语义。
const STATE = new WeakMap();
const CORDIS_ORIGINAL = Symbol.for('cordis.original');

/** 取本实例的状态；this 可能是 proxy，先还原成 Service 实例本身。 */
function stateOf(self) {
  const owner = self?.[CORDIS_ORIGINAL] ?? self;
  const state = STATE.get(owner);
  if (!state) throw new Error('curaRules: 服务状态缺失（实例未经构造函数初始化）');
  return state;
}

// 私有方法键（普通 Symbol 属性，proxy 按 symbol 直接透传）
const kHealth = Symbol('cura.health');
const kHealthSnapshot = Symbol('cura.healthSnapshot');
const kSyncEngineCallConfig = Symbol('cura.syncEngineCallConfig');
const kMainConfig = Symbol('cura.mainConfig');
const HARD_MAX_RULES = 400;

// ---------- 配置规整（Service 行不声明 schema，这里防御性收敛） ----------

function normalizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const num = (v, d, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(Math.max(Math.floor(n), min), max);
  };
  return {
    // 学习来源会话（QQ 号）；留空 = 只提供面板 CRUD，不学习
    targetUser: str(c.targetUser, ''),
    rulesFile: str(c.rulesFile, 'D:\\dsh-cura\\rules.json'),
    healthFile: str(c.healthFile, 'D:\\dsh-cura\\health.json'),
    voiceFile: str(c.voiceFile, 'D:\\dsh-cura\\voice.json'),
    provider: str(c.provider, 'xdpool'),
    model: str(c.model, 'deepseek-v4.1-flash'),
    learnEnabled: c.learnEnabled === undefined ? true : Boolean(c.learnEnabled),
    learnIntervalMin: num(c.learnIntervalMin, 360, 15, 10080),
    learnMaxRules: num(c.learnMaxRules, 140, 10, HARD_MAX_RULES),
  };
}

// ---------- 输入校验 ----------

function fail(message) {
  const error = new Error(message);
  error.name = 'CuraRulesError';
  throw error;
}

function normKeywords(k) {
  const arr = Array.isArray(k) ? k : String(k ?? '').split(/[,，、\s]+/);
  return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
}

function validateText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text) fail(`${field} 不能为空`);
  return text.slice(0, max);
}

// ---------- 服务基座：协议在位用 TypertRemoteService，否则手动 provide 的普通基类 ----------

const ServiceBase = protocol?.TypertRemoteService
  ?? class PlainServiceBase {
    constructor(ctx, name) {
      this.ctx = ctx;
      this.name = name;
      this.ctx.reflect?.provide?.(name, this);
    }
  };

if (!protocol?.TypertRemoteService) {
  console.warn('[dsh-cura] @deepseek-ai/dsh-typert-protocol unavailable — curaRules remote degrades to a plain cordis service');
}

class CuraRulesService extends ServiceBase {
  static inject = ['agents', 'llm'];

  constructor(ctx, config) {
    super(ctx, NAMESPACE);
    STATE.set(this, { config: normalizeConfig(config), learning: false });
    // 学习定时器挂在本 fiber 的 effect 上，行卸载自动回收
    const { config: cfg } = stateOf(this);
    this.ctx.effect?.(() => {
      if (!cfg.learnEnabled || !cfg.targetUser) return undefined;
      const first = setTimeout(() => { void this.learnOnce(); }, 120000);
      const timer = setInterval(() => { void this.learnOnce(); }, cfg.learnIntervalMin * 60000);
      return () => { clearTimeout(first); clearInterval(timer); };
    }, 'cura-rules: learn timer');
  }

  snapshot() {
    const lib = R.loadLibrary(stateOf(this).config.rulesFile) ?? R.seedLibrary();
    return {
      rules: lib.rules,
      learn: {
        ...(lib.learn ?? {}),
        maxRules: stateOf(this).config.learnMaxRules,
        enabled: Boolean(stateOf(this).config.learnEnabled && stateOf(this).config.targetUser),
      },
      file: stateOf(this).config.rulesFile,
    };
  }

  async getRules() {
    return this.snapshot();
  }

  async addRule(rule) {
    const lib = R.loadLibrary(stateOf(this).config.rulesFile) ?? R.seedLibrary();
    if (lib.rules.length >= HARD_MAX_RULES) fail(`规则库已达硬上限（${HARD_MAX_RULES} 条），请先清理`);
    const situation = validateText(rule?.situation, '情境', 80);
    const style = validateText(rule?.style, '表达', 300);
    const scope = SCOPES.includes(rule?.scope) ? rule.scope : 'scene';
    lib.rules.push({
      id: `M${Date.now().toString(36)}`, scope, situation, style,
      keywords: normKeywords(rule?.keywords), weight: 1, source: 'manual', enabled: true,
      createdAt: new Date().toISOString(),
    });
    R.saveLibrary(stateOf(this).config.rulesFile, lib);
    return this.snapshot();
  }

  async updateRule(id, patch) {
    const lib = R.loadLibrary(stateOf(this).config.rulesFile) ?? R.seedLibrary();
    const rule = lib.rules.find((r) => r.id === id);
    if (!rule) fail('规则不存在（可能已被删除），请刷新');
    if (patch?.situation !== undefined) rule.situation = validateText(patch.situation, '情境', 80);
    if (patch?.style !== undefined) rule.style = validateText(patch.style, '表达', 300);
    if (patch?.keywords !== undefined) rule.keywords = normKeywords(patch.keywords);
    if (patch?.scope !== undefined) {
      if (!SCOPES.includes(patch.scope)) fail('scope 只能是 scene/global/ban');
      rule.scope = patch.scope;
    }
    R.saveLibrary(stateOf(this).config.rulesFile, lib);
    return this.snapshot();
  }

  async deleteRule(id) {
    const lib = R.loadLibrary(stateOf(this).config.rulesFile) ?? R.seedLibrary();
    const before = lib.rules.length;
    lib.rules = lib.rules.filter((r) => r.id !== id);
    if (lib.rules.length === before) fail('规则不存在（可能已被删除），请刷新');
    R.saveLibrary(stateOf(this).config.rulesFile, lib);
    return this.snapshot();
  }

  async toggleRule(id, enabled) {
    const lib = R.loadLibrary(stateOf(this).config.rulesFile) ?? R.seedLibrary();
    const rule = lib.rules.find((r) => r.id === id);
    if (!rule) fail('规则不存在（可能已被删除），请刷新');
    rule.enabled = enabled !== false;
    R.saveLibrary(stateOf(this).config.rulesFile, lib);
    return this.snapshot();
  }

  /** 手动触发一次学习；立即返回，结果看快照里的 learn.lastLearnAt。 */
  async learnNow() {
    if (!stateOf(this).config.learnEnabled) fail('学习已关闭（learnEnabled）');
    if (!stateOf(this).config.targetUser) fail('未配置 targetUser，学习无来源会话');
    void this.learnOnce();
    return { started: true };
  }

  // ---- 健康数据面：健康日志（通用）+ 周期关怀（可选子模块）----
  // 唯一写方：面板（saveHealthConfig/saveCycle/addHealthLog/deleteHealthLog）
  // 与 agent 的 health_log 工具（经 root 服务转发到 addHealthLog）都收敛到这一行。

  [kHealth]() {
    return H.loadHealth(stateOf(this).config.healthFile) ?? H.defaultHealth();
  }

  [kHealthSnapshot]() {
    const data = this[kHealth]();
    const cycleInfo = data.cycle?.enabled ? C.phaseInfo(data.cycle) : null;
    const summary = H.summarizeLogs(data.logs, 7);
    const series = H.dailySeries(data.logs, 7);
    return {
      habits: data.habits,
      profile: data.profile ?? H.defaultHealth().profile,
      cycle: { enabled: data.cycle?.enabled === true, config: data.cycle, today: cycleInfo, stats: C.cycleStats(data.cycle?.periods ?? []) },
      logs: data.logs,
      summary,
      series,
      score: H.scoreHealth(summary, data.habits),
      tiles: H.metricTiles(series, data.habits, data.profile ?? {}),
      file: stateOf(this).config.healthFile,
    };
  }

  async getHealth() {
    return this[kHealthSnapshot]();
  }

  // 基础资料（身高/出生年/性别）：安装后为空，由面板或 agent 的 health_profile
  // 工具补全；用于 BMI 与更贴合的健康建议。字段均可清除（传 null/''）。
  async saveHealthProfile(patch) {
    const data = this[kHealth]();
    const verdict = H.validateProfile(patch && typeof patch === 'object' ? patch : {});
    if (!verdict.ok) fail(verdict.error);
    data.profile = { ...data.profile, ...verdict.patch };
    H.saveHealth(stateOf(this).config.healthFile, data);
    return this[kHealthSnapshot]();
  }

  async saveHealthConfig(patch) {
    const data = this[kHealth]();
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.habits !== undefined) {
      if (typeof p.habits !== 'object' || p.habits === null) fail('habits 必须是对象');
      const clean = {};
      if (p.habits.sleepTarget !== undefined) {
        const n = Number(p.habits.sleepTarget);
        if (!Number.isFinite(n) || n < 3 || n > 14) fail('sleepTarget 取值 3-14（小时）');
        clean.sleepTarget = Math.round(n * 10) / 10;
      }
      if (p.habits.exerciseWeekly !== undefined) {
        const n = Math.floor(Number(p.habits.exerciseWeekly));
        if (!Number.isFinite(n) || n < 0 || n > 14) fail('exerciseWeekly 取值 0-14（次/周）');
        clean.exerciseWeekly = n;
      }
      if (p.habits.focusNote !== undefined) clean.focusNote = String(p.habits.focusNote ?? '').trim().slice(0, 200);
      if (Object.keys(clean).length) data.habits = { ...data.habits, ...clean };
    }
    H.saveHealth(stateOf(this).config.healthFile, data);
    return this[kHealthSnapshot]();
  }

  async saveCycle(patch) {
    const data = this[kHealth]();
    const verdict = C.validatePatch(patch && typeof patch === 'object' ? patch : {});
    if (!verdict.ok) fail(verdict.error);
    data.cycle = { ...data.cycle, ...verdict.patch };
    // ovumcy 式打卡：月经今天来了 → 记入历史起始日 + 更新 lastStart
    if (patch.recordPeriodStart !== undefined) {
      if (!C.isValidDate(patch.recordPeriodStart)) fail('recordPeriodStart 必须是 YYYY-MM-DD');
      data.cycle.periods = [...(data.cycle.periods ?? []), patch.recordPeriodStart].slice(-24);
      data.cycle.lastStart = patch.recordPeriodStart;
    }
    H.saveHealth(stateOf(this).config.healthFile, data);
    return this[kHealthSnapshot]();
  }

  async addHealthLog(entry) {
    const data = this[kHealth]();
    const verdict = H.validateLog(entry);
    if (!verdict.ok) fail(verdict.error);
    data.logs = H.appendLog(data.logs, verdict.entry);
    H.saveHealth(stateOf(this).config.healthFile, data);
    return this[kHealthSnapshot]();
  }

  async deleteHealthLog(id) {
    const data = this[kHealth]();
    const before = data.logs.length;
    data.logs = H.deleteLog(data.logs, id);
    if (data.logs.length === before) fail('日志不存在（可能已被删除），请刷新');
    H.saveHealth(stateOf(this).config.healthFile, data);
    return this[kHealthSnapshot]();
  }

  // ---- 语音接入配置（voice.json）+ 来电设置写回引擎配置 ----

  async getVoiceConfig() {
    return V.loadVoiceConfig(stateOf(this).config.voiceFile) ?? V.defaultVoiceConfig();
  }

  async saveVoiceConfig(patch) {
    const verdict = V.validateVoicePatch(patch && typeof patch === 'object' ? patch : {});
    if (!verdict.ok) fail(verdict.error);
    const cfg = V.mergeVoice(V.loadVoiceConfig(stateOf(this).config.voiceFile) ?? V.defaultVoiceConfig());
    const merged = { ...cfg, ...verdict.patch };
    // 深合并子对象（tts.openai 等部分更新不丢兄弟键）
    for (const key of ['tts', 'e2e', 'call']) {
      if (verdict.patch[key]) merged[key] = { ...(cfg[key] ?? {}), ...verdict.patch[key] };
    }
    V.saveVoiceConfig(stateOf(this).config.voiceFile, merged);
    await this[kSyncEngineCallConfig](merged.call); // 来电设置写回引擎 config.json
    return merged;
  }

  /** 把来电设置同步进引擎的 config.json（引擎重启后生效）；引擎未配置则跳过 */
  async [kSyncEngineCallConfig](call) {
    try {
      const main = this[kMainConfig]();
      const engineDir = String(main.engineDir || '');
      if (!engineDir) return { synced: false, reason: '未配置 engineDir' };
      const engineCfgPath = path.join(engineDir, 'config.json');
      if (!fs.existsSync(engineCfgPath)) return { synced: false, reason: '引擎 config.json 不存在' };
      const engineCfg = JSON.parse(fs.readFileSync(engineCfgPath, 'utf8'));
      engineCfg.whitelist = [...(call.whitelist ?? [])];
      if (call.greeting) engineCfg.greeting = call.greeting;
      if (call.maxDurationMin) {
        engineCfg.call = { ...(engineCfg.call ?? {}), maxDurationSec: call.maxDurationMin * 60 };
      }
      fs.writeFileSync(engineCfgPath, JSON.stringify(engineCfg, null, 2), 'utf8');
      this.log('来电设置已写回引擎配置（%s）', engineCfgPath);
      return { synced: true };
    } catch (e) {
      this.log('来电设置写回引擎配置失败: %s', e?.message || e);
      return { synced: false, reason: String(e?.message || e) };
    }
  }

  // ---- 语音页：主插件配置读取 + 语音链路体检 + TTS 试听 ----

  /** 主插件行（dsh-cura）的生效配置；读不到返回空对象，不抛错。 */
  [kMainConfig]() {
    try {
      const editor = this.ctx.configEditor;
      const entry = editor?.entries?.().find((e) => e?.options?.id === 'dsh-cura');
      const config = entry?.options?.config;
      return config && typeof config === 'object' ? config : {};
    } catch {
      return {};
    }
  }

  async getVoiceInfo() {
    const main = this[kMainConfig]();
    const sayScript = String(main.sayScript || 'D:\\dsh-cura\\say.ps1');
    const base = path.dirname(sayScript);
    const port = Number(main.port) || 8765;
    const info = {
      proxy: { port, alive: false },
      engine: {
        managed: Boolean(main.enginePython && main.engineDir),
        python: String(main.enginePython || ''),
        dir: String(main.engineDir || ''),
        dirExists: Boolean(main.engineDir) && fs.existsSync(String(main.engineDir)),
      },
      sayScript,
      stt: {
        script: path.join(base, 'stt-whisper.py'),
        ready: fs.existsSync(path.join(base, 'stt-whisper.py')),
      },
      tts: [
        { tier: 0, name: '火山引擎 TTS（复刻音色，配置在本地 tts-volc.py / .volc）', ready: fs.existsSync(path.join(base, 'tts-volc.py')) && fs.existsSync(path.join(base, '.volc')) },
        { tier: 1, name: '阿里云 qwen-audio-3.0-tts-plus（龙安鲁风）', ready: fs.existsSync(path.join(base, '.key')) },
        { tier: 2, name: 'edge-tts（晓晓，云）', ready: fs.existsSync('D:\\Miniconda\\envs\\qqcall\\Scripts\\edge-tts.exe') },
        { tier: 3, name: 'Windows SAPI（Huihui，离线兜底）', ready: true },
      ],
      errors: [],
    };
    // 大脑代理探活：任何 HTTP 响应（含 404）都算活
    try {
      await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'OPTIONS', signal: AbortSignal.timeout(1500) });
      info.proxy.alive = true;
    } catch { /* 连接失败 = 不在线 */ }
    return info;
  }

  /** TTS 试听：走 say.ps1 四保险链，返回 data URL 供面板 <audio> 播放。 */
  async ttsTest(text) {
    const said = String(text ?? '').trim().slice(0, 200);
    if (!said) fail('要说的话不能为空');
    const sayScript = String(this[kMainConfig]().sayScript || 'D:\\dsh-cura\\say.ps1');
    if (!fs.existsSync(sayScript)) fail(`合成脚本不存在：${sayScript}`);
    const out = path.join(os.tmpdir(), `cura-tts-test-${Date.now()}.mp3`);
    let produced = out;
    try {
      const r = await execFileP('powershell', ['-NoProfile', '-File', sayScript, '-Text', said, '-Out', out], { timeout: 120000 });
      // say.ps1 把实际产物路径打到 stdout 最后一行（兜底层可能输出 .wav）
      const lines = String(r.stdout || '').trim().split('\n');
      const last = lines[lines.length - 1]?.trim();
      if (last && fs.existsSync(last)) produced = last;
    } catch (e) {
      fail(`TTS 链失败：${e?.message || e}`);
    }
    try {
      const buf = fs.readFileSync(produced);
      if (buf.length < 1000) fail('TTS 全链没出有效音频（四层都失败），详情见 qq-bot.log');
      const mime = produced.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
      return { audio: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length };
    } finally {
      try { fs.unlinkSync(produced); } catch { /* ignore */ }
    }
  }

  // ---- 学习引擎（从主插件迁入：cursor 游标 + LLM 抽取 + 本地去重） ----

  async learnOnce() {
    if (stateOf(this).learning) return;
    stateOf(this).learning = true;
    try {
      const cfg = stateOf(this).config;
      const lib = R.loadLibrary(cfg.rulesFile) ?? R.seedLibrary();
      const agent = this.ctx.agents?.get?.(`onebot-private-${cfg.targetUser}`);
      const src = agent ? R.sessionEventsOf(agent) : null;
      if (!src || !src.events.length) return;
      const maxSeq = src.events.reduce((m, e) => Math.max(m, Number(e?.seq) || 0), 0);
      let cursor = Number(lib.learn?.cursorSeq);
      // 首跑/游标失效只建游标不学习——种子库打底，学习只消化重启后的新对话
      if (!Number.isFinite(cursor) || cursor < 0 || cursor > maxSeq) cursor = maxSeq;
      const fresh = src.events.filter((e) => (Number(e?.seq) || 0) > cursor);
      const rounds = R.roundsFromEvents(fresh, src.visibleSeqs, 24);
      const advance = (note) => {
        lib.learn = { ...(lib.learn ?? {}), cursorSeq: Math.max(maxSeq, cursor), lastLearnAt: new Date().toISOString() };
        try { R.saveLibrary(cfg.rulesFile, lib); } catch { /* 写盘失败下次重试 */ }
        if (note) this.log('规则学习：%s', note);
      };
      if (rounds.length < 6) { advance('新对话不足，跳过'); return; }
      if (lib.rules.length >= cfg.learnMaxRules) { advance(`规则库已满（${lib.rules.length} 条），请人工清理`); return; }
      if (!this.ctx.llm) return; // llm 未就绪：不推进游标，下次再试
      const existing = lib.rules.filter((r) => r.scope === 'scene').map((r) => r.situation);
      const extracted = R.parseExtracted(await this.chat(cfg, [
        { role: 'system', content: '你是语料工程师。只输出 JSON 数组，不输出任何解释。' },
        { role: 'user', content: R.buildExtractPrompt(rounds, existing) },
      ]));
      if (!extracted.length) { advance('本轮无可入库规则'); return; }
      const added = R.mergeLearned(lib, extracted, { maxRules: cfg.learnMaxRules });
      advance(`抽取 ${extracted.length} 条，去重后入库 ${added} 条（共 ${lib.rules.length} 条）`);
    } catch (e) {
      try { this.log('规则学习失败: %s', e?.message || e); } catch { /* ignore */ }
    } finally {
      stateOf(this).learning = false;
    }
  }

  async chat(cfg, messages) {
    const stream = this.ctx.llm.stream({
      provider: cfg.provider,
      model: cfg.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: [{ type: 'text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') }],
      })),
    });
    let text = '';
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    }
    return text.trim();
  }

  log(message, ...args) {
    try { this.ctx.logger('qq-bot').info(message, ...args); } catch { /* logger 缺席不碍事 */ }
  }
}

// 原型标记（无装饰器语法；mark() 对同一原型幂等）
function markRemote(klass, method) {
  if (!protocol?.Remote) return;
  const initializers = [];
  protocol.Remote(method)(undefined, {
    name: method, private: false, static: false,
    addInitializer(fn) { initializers.push(fn); },
  });
  const receiver = Object.create(klass.prototype);
  for (const fn of initializers) fn.call(receiver);
}
for (const m of ['getRules', 'addRule', 'updateRule', 'deleteRule', 'toggleRule', 'learnNow', 'getVoiceInfo', 'ttsTest', 'getHealth', 'saveHealthProfile', 'saveHealthConfig', 'saveCycle', 'addHealthLog', 'deleteHealthLog', 'getVoiceConfig', 'saveVoiceConfig']) {
  markRemote(CuraRulesService, m);
}

export default CuraRulesService;
export { CuraRulesService };
