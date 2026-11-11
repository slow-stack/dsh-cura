// dsh-cura — QQ Bot 伴生增强插件（companion）
//
// 定位：不接管消息流（那是 dsh-onebot-qq 的事），而是"贴"在 dsh-onebot 建立的
// QQ 会话上，注入拟人化增强：
//   1. 回复规则 + 人设文本 → systemPrompt.section（设置页改 → 自动重注册 → 即时生效）
//   2. 语料库 → 定时加载 + 作为风格示例注入 section（后续升级为 context 每步检索）
//   3. 语音条发送走 dsh-onebot 的 qq_send_voice；合成助手脚本在本目录 say.ps1
//
// 会话 id 规则（dsh-onebot chat.js）：onebot-private-<QQ号>

import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import * as R from './rules.js';
import * as C from './cycle.js';
import * as H from './health.js';
import * as B from './butler.js';
import Schema from '@deepseek-ai/schemastery';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

// 包根目录：脚本（say.ps1 / play-audio.py / stt-whisper.py）与数据文件（rules.json /
// health.json / corpus）默认都在包根旁边，按本文件位置推导，不写死作者机器的盘符。
// npm 安装时即 <profile>/node_modules/dsh-cura，git clone 时即仓库根。
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { PKG_ROOT };

export const name = 'cura';
export const inject = ['agents', 'tools'];

export const Config = Schema.object({
  port: Schema.natural().default(8765).description('本地服务端口（大脑代理 + 规则库管理页 http://127.0.0.1:8765/rules）'),
  provider: Schema.string().default('xdpool').description('llm 提供方路由名'),
  model: Schema.string().default('deepseek-v4.1-flash').description('模型'),
  systemPrompt: Schema.string().default(
    '你是用户的AI伴侣，正在和用户QQ语音通话。说话要口语化、简短（一两句话），像真人打电话，不要用列表和emoji，听不清就自然地问。'
  ).description('【通话】人格（system prompt）'),
  maxTokens: Schema.natural().default(300).description('【通话】单次回复上限'),
  historyLimit: Schema.natural().default(12).description('聊天历史轮数上限'),
  comboTimeoutMs: Schema.natural().default(8000).description('【通话】单个 provider 组合的等待上限（毫秒）。到点立刻换下一个，别让一个卡住的 provider 把整通电话钉死'),
  replyTimeoutMs: Schema.natural().default(25000).description('【通话】一次回复的总预算（毫秒）。用完就报错，不再继续试剩下的组合'),
  idleTimeoutMs: Schema.natural().default(8000).description('【通话】单个组合「多久没有新内容」就算死（毫秒）。吐过字就一直等它说完，只有卡住不动才换下一个'),
  enginePython: Schema.string().default('').description('【通话】Python 解释器路径（机器相关，本地 profile 层配置；留空则用环境变量 CURA_PYTHON 或 PATH 里的 python）'),
  engineDir: Schema.string().default('').description('【通话】引擎目录（机器相关，本地 profile 层配置）'),

  targetUser: Schema.string().default('').description('目标 QQ 号（会话 onebot-private-<QQ号>）'),
  replyRules: Schema.string().default(
    '【QQ 聊天回复规则（最高优先级，逐条强制）】\n1. 整条回复不超过 30 个字：一到两个短句，像随手发消息\n2. 只回对方问的那一个点；不解释、不补充背景\n3. 绝对禁止在结尾加总结句、复述句或收尾语（"总之""以上就是""希望这能帮到你"一类全部禁止）——说完即止\n4. 像发微信，不是写作文\n5. 语气可以像朋友，但长度红线不能破'
  ).description('【聊天】回复规则（注入到 QQ 会话，设置页可改）'),
  chatPersona: Schema.string().default('你是 Cura，用户的老朋友，平时在 QQ 上闲聊、偶尔帮点小忙。').description('【聊天】人格补充'),
  corpusDir: Schema.string().default(path.join(PKG_ROOT, 'corpus')).description('语料库目录（txt/jsonl，作为风格示例注入；默认包内 corpus/）'),
  corpusMaxChars: Schema.natural().default(1200).description('语料注入最大字符数'),

  napcatBaseUrl: Schema.string().default('http://127.0.0.1:3000').description('NapCat OneBot HTTP（qq_say 工具用）'),
  napcatToken: Schema.string().default('').description('NapCat HTTP token'),
  sayScript: Schema.string().default(path.join(PKG_ROOT, 'say.ps1')).description('语音合成助手脚本（默认包内 say.ps1）'),

  rulesEnabled: Schema.boolean().default(true).description('情境表达规则库（检索注入）'),
  rulesFile: Schema.string().default(path.join(PKG_ROOT, 'rules.json')).description('规则库文件（管理面板/学习在 rules-remote 行，本行只读；默认包内 rules.json）'),
  rulesCount: Schema.natural().default(4).description('每轮注入情境规则条数上限'),
  rulesMaxChars: Schema.natural().default(700).description('情境块最大字符数'),
  healthFile: Schema.string().default(path.join(PKG_ROOT, 'health.json')).description('健康日志文件（周期关怀是它的子对象；写入在 rules-remote 行，本行只读；默认包内 health.json）'),

  butlerEnabled: Schema.boolean().default(true).description('管家工具：把外部 MCP server 挂进 QQ 会话（瑞幸下单/高德地图等）'),
  butlerServers: Schema.string().default('[]').description('管家 MCP server 清单（JSON 数组）。每项：streamable-http 用 {serverName,url,headers?}，stdio 用 {serverName,command,args?,env?}。与 DSH 设置里已连接的同名 server 以核心为准，本会话跳过'),
  dshHome: Schema.string().default('').description('DSH 数据根目录（管家用它读核心 MCP 连接表；留空则 DSH_HOME 环境变量 → ~/.dsh）'),
  butlerPrompt: Schema.string().default(
    '你不止活在聊天里，也可以在现实里照顾用户：需要点咖啡、查地点/路线/天气这类事，主动用管家工具去做，做完用一句话自然地说结果，像贴心的朋友顺口提起，不要像客服报菜单。'
  ).description('管家工具使用引导（随管家 section 注入）'),
});

// DSH 数据根目录：配置 > DSH_HOME > ~/.dsh（与 @deepseek-ai/dsh-home-paths 的 resolveDshHome 同序，
// 但不引入依赖——插件运行在 profile 层，解析不到宿主私有包）。
export function resolveDshHome(configured) {
  const explicit = String(configured ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const fromEnv = String(process.env.DSH_HOME ?? '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.dsh');
}

function sessionIdFor(userId) {
  return `onebot-private-${String(userId).replace(/[^A-Za-z0-9-]/g, '-')}`;
}

function buildRulesText(config) {
  const parts = [];
  if (config?.chatPersona) parts.push(`【人格补充】${config.chatPersona}`);
  if (config?.replyRules) parts.push(config.replyRules);
  return parts.join('\n\n');
}

function loadCorpusDigest(corpusDir, maxChars) {
  const items = [];
  const root = path.resolve(corpusDir ?? '');
  try {
    if (!corpusDir || !fs.existsSync(root)) return '';
    for (const f of fs.readdirSync(root)) {
      const full = path.resolve(root, f);
      if (!full.startsWith(root + path.sep) || !fs.statSync(full).isFile()) continue;
      const raw = fs.readFileSync(full, 'utf8');
      if (f.endsWith('.jsonl')) {
        for (const line of raw.split('\n')) {
          if (line.trim()) { try { items.push(String(JSON.parse(line).text ?? line)); } catch { /* skip */ } }
        }
      } else {
        for (const chunk of raw.split(/\n{2,}/)) if (chunk.trim()) items.push(chunk.trim());
      }
    }
  } catch { /* ignore */ }
  // 轮换取样，避免每次注入同一批
  if (!items.length) return '';
  const picked = [];
  let total = 0;
  for (let i = 0; i < items.length && total < maxChars; i++) {
    const it = items[(Math.floor(Date.now() / 60000) + i) % items.length];
    if (total + it.length > maxChars) break;
    picked.push(it); total += it.length;
  }
  return picked.join('\n---\n');
}

export async function apply(ctx, config) {
  const cfg = {
    port: config?.port ?? 8765,
    provider: config?.provider ?? 'xdpool',
    model: config?.model ?? 'deepseek-v4.1-flash',
    systemPrompt: config?.systemPrompt ?? '',
    maxTokens: config?.maxTokens ?? 300,
    historyLimit: config?.historyLimit ?? 12,
    enginePython: config?.enginePython ?? '',
    engineDir: config?.engineDir ?? '',
    targetUser: config?.targetUser ?? '',
    replyRules: config?.replyRules ?? '',
    chatPersona: config?.chatPersona ?? '',
    corpusDir: config?.corpusDir ?? path.join(PKG_ROOT, 'corpus'),
    corpusMaxChars: config?.corpusMaxChars ?? 1200,
    napcatBaseUrl: config?.napcatBaseUrl ?? 'http://127.0.0.1:3000',
    napcatToken: config?.napcatToken ?? '',
    sayScript: config?.sayScript ?? path.join(PKG_ROOT, 'say.ps1'),
    rulesEnabled: config?.rulesEnabled ?? true,
    rulesFile: config?.rulesFile ?? path.join(PKG_ROOT, 'rules.json'),
    rulesCount: config?.rulesCount ?? 4,
    rulesMaxChars: config?.rulesMaxChars ?? 700,
    healthFile: config?.healthFile ?? path.join(PKG_ROOT, 'health.json'),
    dshHome: config?.dshHome ?? '',
    butlerEnabled: config?.butlerEnabled ?? true,
    butlerServers: config?.butlerServers ?? '[]',
    butlerPrompt: config?.butlerPrompt ?? '',
  };
  const dlog = ctx.logger('qq-bot');
  const logFile = path.resolve(cfg.sayScript, '..', 'qq-bot.log');
  const fmtLine = (m, a) => { let s = String(m); for (const x of a) s = s.replace(/%[sd]/, () => typeof x === 'string' ? x : JSON.stringify(x)); return s; };
  const logger = {
    info: (m, ...a) => { dlog.info(m, ...a); try { fs.appendFileSync(logFile, `${new Date().toISOString()} INFO  ${fmtLine(m, a)}\n`); } catch { /* ignore */ } },
    warning: (m, ...a) => { dlog.warn(m, ...a); try { fs.appendFileSync(logFile, `${new Date().toISOString()} WARN  ${fmtLine(m, a)}\n`); } catch { /* ignore */ } },
    error: (m, ...a) => { dlog.error(m, ...a); try { fs.appendFileSync(logFile, `${new Date().toISOString()} ERROR ${fmtLine(m, a)}\n`); } catch { /* ignore */ } },
  };
  const SESSION_ID = sessionIdFor(cfg.targetUser);

  // ---- 大脑代理（语音引擎用，保持不变） ----
  let llmCtx = null;
  ctx.inject(['llm'], (scoped) => { llmCtx = scoped; });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
        let body = '';
        for await (const c of req) body += c;
        const parsed = JSON.parse(body || '{}');
        const messages = (parsed.messages ?? []).slice(-cfg.historyLimit * 4);
        if (!llmCtx) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'llm 服务尚未就绪' } }));
          return;
        }
        const text = await chatViaDsh(llmCtx, cfg, messages, logger);
        logger.info('大脑回复 %d 字', text.length);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'qq-bot', object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        }));
        return;
      }

      res.writeHead(404).end();
    } catch (error) {
      logger.error('大脑代理错误: %s', error?.stack || error);
      try { res.writeHead(502); res.end(JSON.stringify({ error: { message: String(error?.message || error) } })); } catch { /* ignore */ }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, '127.0.0.1', resolve);
  });
  logger.info('大脑代理就绪: 127.0.0.1:%d', cfg.port);

  // ---- 伴生增强：贴到 QQ 会话，注入规则/语料/工具 ----
  let sectionDisposer = null;
  let attachedScope = null;
  let attachedAgent = null;
  let habitsDisposer = null;
  let healthDisposer = null;
  let butlerDisposer = null;
  let butlerFibers = [];

  // 管家 section 文本：引导语 + 当前配置的工具清单（挂载结果以会话里实际出现的
  // mcp__<serverName>__* 为准，这里只做提示，帮助模型把工具和"照顾人"的场景对上）。
  function renderButlerPrompt() {
    if (!cfg.butlerEnabled || !cfg.butlerPrompt) return '';
    const { servers } = B.parseServers(cfg.butlerServers);
    if (!servers.length) return '';
    const names = servers.map((s) => `mcp__${s.serverName}__*`).join('、');
    return `${cfg.butlerPrompt}\n【管家工具】现实侧能力：${names}（server 不可用时如实说做不到，别编造结果）。`;
  }

  function dropButlerFibers() {
    const fibers = butlerFibers;
    butlerFibers = [];
    for (const f of fibers) {
      try { void Promise.resolve(f?.dispose?.()).catch(() => {}); } catch { /* ignore */ }
    }
  }

  // 健康注入（同步渲染）：近 7 天汇总 + 周期关怀（如启用）。数据缺失 → 空串。
  // 基础资料为空时附一条"自然补全"提示：让 agent 在聊天里顺口问，而不是安装向导。
  function renderHealth() {
    try {
      const data = H.loadHealth(cfg.healthFile);
      if (!data) return '';
      const cycleInfo = data.cycle?.enabled ? C.phaseInfo(data.cycle) : null;
      const text = H.renderInjection(H.summarizeLogs(data.logs, 7), cycleInfo, data.habits ?? {}, data.profile ?? {});
      if (!H.profileComplete(data.profile)) {
        const miss = [];
        if (!data.profile?.heightCm) miss.push('身高');
        if (!data.profile?.birthYear) miss.push('出生年');
        if (!data.profile?.sex) miss.push('性别');
        const hint = `【基础资料待补充】你还不知道用户的${miss.join('、')}。别做问卷式盘问：在话题自然相关时顺口问一两个（比如聊到体重/体检时问一句身高），对方说了就用 health_profile 工具存下来。没机会问就不问，不打扰。`;
        return [text, hint].filter(Boolean).join('\n');
      }
      return text;
    } catch { return ''; }
  }

  // 每轮渲染（同步，组装管线约束）：读会话事件 → 最近用户消息 → 情境匹配 → 表达习惯块。
  // 任何失败降级为空串，绝不影响 render（照抄 mneme 的容错口径）。
  function renderHabits(promptCtx) {
    if (!cfg.rulesEnabled) return '';
    try {
      const src = R.sessionEventsOf(promptCtx?.agent);
      if (!src || !src.events.length) return '';
      const text = R.recentUserText(src.events, src.visibleSeqs);
      if (!text) return '';
      const lib = R.loadLibrary(cfg.rulesFile) ?? R.seedLibrary();
      const salt = Math.floor(Date.now() / 60000); // 无信号时每分钟轮换一批规则
      const picked = R.selectRules(lib, text, { count: cfg.rulesCount, salt });
      return R.renderSceneBlock(picked, cfg.rulesMaxChars);
    } catch { return ''; }
  }

  function applySections() {
    if (!attachedScope) return;
    try { sectionDisposer?.(); } catch { /* ignore */ }
    try { butlerDisposer?.(); } catch { /* ignore */ }
    butlerDisposer = null;
    const corpusDigest = loadCorpusDigest(cfg.corpusDir, cfg.corpusMaxChars);
    const lib = cfg.rulesEnabled ? R.loadLibrary(cfg.rulesFile) : null;
    const globalBlock = lib ? R.renderGlobalBlock(lib) : '';
    const text = [
      buildRulesText(config ?? {}),
      globalBlock,
      corpusDigest ? `【说话风格示例（模仿语气，不照抄内容）】\n${corpusDigest}` : '',
    ].filter(Boolean).join('\n\n');
    sectionDisposer = attachedScope.systemPrompt.section({
      name: 'qq-bot:reply-style', order: 96, text,
    });
    const butlerText = renderButlerPrompt();
    if (butlerText) {
      butlerDisposer = attachedScope.systemPrompt.section({
        name: 'qq-bot:butler', order: 93, text: butlerText,
      });
    }
    logger.info('回复规则/语料已注入会话 %s（%d 字）', SESSION_ID, text.length);
  }

  async function attach() {
    const agent = ctx.agents?.get?.(SESSION_ID);
    const scope = agent?.ctx;
    if (!scope || attachedScope === scope) return Boolean(scope);
    attachedScope = scope;
    attachedAgent = agent;
    logger.info('已贴上 QQ 会话 %s', SESSION_ID);
    applySections();
    // 动态上下文：每步准入前重读，情境规则跟着对话走（官方接口，mneme 同款挂法）
    try {
      habitsDisposer = scope.systemPrompt.context({
        name: 'qq-bot:expression-habits', order: 96, text: (promptCtx) => renderHabits(promptCtx),
      });
      logger.info('情境表达规则检索已挂到会话 %s', SESSION_ID);
    } catch (e) {
      logger.warning('context 注册失败: %s', e?.message || e);
    }
    // 健康注入：近 7 天汇总 + 周期关怀（如启用）
    try {
      healthDisposer = scope.systemPrompt.context({
        name: 'qq-bot:health', order: 94, text: () => renderHealth(),
      });
      logger.info('健康注入已挂到会话 %s', SESSION_ID);
    } catch (e) {
      logger.warning('健康 context 注册失败: %s', e?.message || e);
    }
    // 管家工具：外部 MCP server → 本会话（只挂 QQ 会话，不碰其他会话的作用域）
    try {
      dropButlerFibers();
      const { servers, error } = B.parseServers(cfg.butlerServers);
      if (error) logger.warning('butler 配置问题: %s', error);
      const { usable, skipped } = cfg.butlerEnabled ? B.usableServers(servers, resolveDshHome(cfg.dshHome)) : { usable: [], skipped: [] };
      for (const name of skipped) {
        logger.warning('butler: %s 已在 DSH 设置里连接，本会话跳过重复挂载（核心为准）', name);
      }
      if (usable.length) {
        const mcpPlugin = await B.loadMcpPlugin(ctx);
        for (const s of usable) {
          const fiber = scope.plugin(mcpPlugin, { ...s, failOnStartupError: false });
          butlerFibers.push(fiber);
          // 不阻塞 attach：连接结果后台汇报（server 挂了也不影响会话其他能力）
          void Promise.resolve().then(() => fiber.await()).then(
            () => logger.info('butler: %s 已挂载（mcp__%s__*）', s.serverName, s.serverName),
            (e) => logger.warning('butler: %s 挂载失败: %s', s.serverName, e?.message || e),
          );
        }
        logger.info('butler: %d 个 server 挂载中 → %s', usable.length, usable.map((s) => s.serverName).join(', '));
      }
    } catch (e) {
      logger.warning('butler 挂载失败: %s', e?.message || e);
    }
    // 语音条发送归 dsh-onebot 的 qq_send_voice（职责不重叠）；
    // 本插件只提供合成助手脚本 say.ps1，agent 用 shell 调它生成音频文件。
    return true;
  }

  // 轮询贴会话（dsh-onebot 在收到第一条消息后才创建会话）
  const attachTimer = setInterval(async () => {
    try { if (await attach()) clearInterval(attachTimer); } catch { /* ignore */ }
  }, 5000);
  attachTimer.unref?.();

  // ---- 自动学习已迁至 rules-remote 行（单一写方）；本行只读 rules.json 做检索注入 ----

  ctx.effect(() => () => {
    clearInterval(attachTimer);
    try { sectionDisposer?.(); } catch { /* ignore */ }
    try { butlerDisposer?.(); } catch { /* ignore */ }
    try { habitsDisposer?.(); } catch { /* ignore */ }
    try { healthDisposer?.(); } catch { /* ignore */ }
    dropButlerFibers();
  }, 'qq-bot: session attachment');

  // ---- 托管 Python 语音引擎 ----
  let engine = null;
  if (cfg.enginePython && cfg.engineDir) {
    const startEngine = () => {
      logger.info('启动语音引擎: %s（%s）', cfg.enginePython, cfg.engineDir);
      engine = spawn(cfg.enginePython, ['engine.py'], {
        cwd: cfg.engineDir, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
      });
      engine.on('exit', (code) => {
        logger.warning('语音引擎退出（code=%s）', code);
        engine = null;
      });
    };
    startEngine();
    ctx.effect(() => () => {
      if (engine) { engine.kill(); engine = null; }
    }, 'qq-bot: engine process');
  } else {
    logger.info('未配置 enginePython/engineDir，跳过引擎托管');
  }

  // ---- DSH 内语音能力：注册给所有 agent 会话的工具 ----
  try {
    const { defineTool } = await import('@deepseek-ai/dsh-tools');
    const playScript = path.resolve(path.dirname(cfg.sayScript), 'play-audio.py');
    const workDir = path.dirname(cfg.sayScript);
    const sttPython = cfg.enginePython || process.env.CURA_PYTHON || 'python';

    ctx.tools.register(defineTool({
      name: 'say_aloud',
      description: '把一段文本用你的声音通过电脑扬声器朗读出来。适合：用户说"说给我听/读出来"、你想主动开口说话、提醒类内容。',
      parameters: {
        text: { type: 'string', required: true, description: '要说的话（口语化）' },
      },
      output: { schema: { type: 'json' } },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const out = path.join(workDir, `speak-${Date.now()}.mp3`);
        await execFileP('powershell', ['-NoProfile', '-File', cfg.sayScript, '-Text', String(args.text ?? ''), '-Out', out], { timeout: 120000 });
        if (!fs.existsSync(out) || fs.statSync(out).size < 1000) return { spoken: false, reason: 'TTS 失败' };
        await execFileP(sttPython, [playScript, '--file', out], { timeout: 300000 });
        try { fs.unlinkSync(out); } catch { /* ignore */ }
        return { spoken: true };
      },
    }));

    ctx.tools.register(defineTool({
      name: 'voice_chat',
      description: '和用户在电脑前进行一段实时语音对话：用户对着麦克风说话，你实时用声音回应（你的声音+DSH 大脑）。适合用户说"我们语音聊聊/打电话"。对话结束后返回完整记录，用户也可以直接说"挂了"结束。',
      parameters: {
        minutes: { type: 'number', description: '通话时长上限（分钟），默认 5' },
      },
      output: { schema: { type: 'json' } },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        if (!cfg.engineDir) return { error: '未配置 engineDir，语音引擎不可用' };
        const minutes = Math.min(Math.max(Number(args.minutes) || 5, 1), 30);
        const r = await execFileP(sttPython, [path.join(cfg.engineDir, 'engine.py'), 'dsh-chat', String(minutes)],
          { timeout: minutes * 60 * 1000 + 120000, maxBuffer: 10 * 1024 * 1024 });
        const lines = r.stdout.trim().split('\n');
        let result = {};
        try { result = JSON.parse(lines[lines.length - 1]); } catch { /* ignore */ }
        const transcript = (result.transcript ?? [])
          .map((m) => `${m.role === 'user' ? '用户' : '你'}：${m.content}`).join('\n');
        // 通话记忆：transcript 已随本工具结果进入会话（mneme 热记忆可达），
        // 这里再压一条明确的长期记忆指令——模型当轮就能调 memory_save 落库。
        const stamp = new Date();
        const mmdd = `${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`;
        return {
          duration_sec: result.duration_sec,
          transcript,
          remember: `通话已结束。请立即用 memory_save 把这次通话写进长期记忆：type=history，title=「语音通话 ${mmdd}」，tags=["语音通话"]，importance=3，occurred_at="${stamp.toISOString()}"，content 用三五句概括聊了什么、定下或约定了什么（有具体约定的事项另用 decision 单独记一条）。写完这条记忆即可，不必复述通话内容。`,
        };
      },
    }));

    ctx.tools.register(defineTool({
      name: 'health_log',
      description: '记录一条健康日志（睡眠时长/睡眠质量/情绪/运动/体重/血压/心率/备注，任填多项）。当用户提到昨晚睡了多久、熬夜了、运动了、心情状态、体重变化、量了血压、身体不舒服（含经期不适）时，抽取信息调用本工具；日期缺省为今天。血压说成"135/85"这样的就拆成 bpSystolic=135、bpDiastolic=85。记录成功后自然回应一句关心即可，不要复述记录内容。',
      parameters: {
        date: { type: 'string', description: '记录哪一天（YYYY-MM-DD），缺省今天' },
        sleepHours: { type: 'number', description: '睡眠时长（小时，0-24）' },
        sleepQuality: { type: 'number', description: '睡眠质量 1-5（5 最好）' },
        mood: { type: 'number', description: '情绪 1-5（5 最好）' },
        exercise: { type: 'string', description: '运动内容（如：跑步30分钟）' },
        weight: { type: 'number', description: '体重（kg，30-250）' },
        bpSystolic: { type: 'number', description: '血压高压/收缩压（60-260）' },
        bpDiastolic: { type: 'number', description: '血压低压/舒张压（30-160）' },
        pulse: { type: 'number', description: '心率/脉搏（30-220）' },
        notes: { type: 'string', description: '备注（如：有点累/经期第二天）' },
      },
      output: { schema: { type: 'json' } },
      async execute(args, exec) {
        try {
          // 数据面在 root 平面的 rules-remote 行（子作用域 ctx.get 向上解析）
          const svc = ctx.get?.('curaRules');
          if (!svc || typeof svc.addHealthLog !== 'function') {
            return { logged: false, reason: '数据服务未就绪（rules-remote 行未加载）' };
          }
          const snap = await svc.addHealthLog({
            date: args.date,
            sleepHours: args.sleepHours,
            sleepQuality: args.sleepQuality,
            mood: args.mood,
            exercise: args.exercise,
            weight: args.weight,
            bpSystolic: args.bpSystolic,
            bpDiastolic: args.bpDiastolic,
            pulse: args.pulse,
            notes: args.notes,
          });
          return { logged: true, recent7: snap.summary };
        } catch (e) {
          return { logged: false, reason: String(e?.message || e) };
        }
      },
    }));

    ctx.tools.register(defineTool({
      name: 'health_profile',
      description: '保存用户的基础健康资料（身高/出生年/性别，全部可选），用于计算 BMI、让健康建议更贴合。仅在用户主动说起时调用；不要为收集资料而连续盘问——一次最多问一两个，对方不接话就放下。用户纠正旧值时用本工具更新。',
      parameters: {
        heightCm: { type: 'number', description: '身高（cm，100-230）' },
        birthYear: { type: 'number', description: '出生年份（如 1998）' },
        sex: { type: 'string', description: "性别：female / male；不确定就不传" },
      },
      output: { schema: { type: 'json' } },
      async execute(args, exec) {
        try {
          const svc = ctx.get?.('curaRules');
          if (!svc || typeof svc.saveHealthProfile !== 'function') {
            return { saved: false, reason: '数据服务未就绪（rules-remote 行未加载）' };
          }
          const snap = await svc.saveHealthProfile({
            heightCm: args.heightCm,
            birthYear: args.birthYear,
            sex: args.sex,
          });
          return { saved: true, profile: snap.profile };
        } catch (e) {
          return { saved: false, reason: String(e?.message || e) };
        }
      },
    }));
    logger.info('DSH 工具已注册: say_aloud / voice_chat / health_log / health_profile');
  } catch (e) {
    logger.warning('语音工具注册失败: %s', e?.message || e);
  }

  ctx.effect(() => () => new Promise((resolve) => server.close(() => resolve())), 'qq-bot: brain proxy');
}

// OpenAI 形状的消息 → DSH 的 durable Message。
//
// 为什么非要有这个函数：app.asar 里的 forAdapter / toPiAssistant 都是裸读
//   const source = message.source;
//   if (source.replayState === void 0) ...
// assistant 消息一旦没有 source 就直接抛
//   Cannot read properties of undefined (reading 'replayState')
// 表现成「history 里只要有 assistant 轮次，所有 provider 全 502」。
// 实测（curl 打 8765）：单 user ✅ / system+user ✅ / 两条 user ✅ /
// 任何含 role:"assistant" 的形状 ❌ —— 就是因为这里把 source 丢了。
//
// 类型契约（app.asar 内联 .d.ts）：
//   AssistantMessage.source = ModelMessageSource { kind:'model', provider, model, replayState? }
//   UserMessage.source      = { kind:'user' }
//   SystemMessage.source    = { kind:'system-prompt' }
// assistant 故意不带 replayState：toPiAssistant 会走 foreignAssistant 降级路径，
// 用 source.provider/model + 纯文本重建，这是 DSH 自己设计的容错通道，最安全。
let curaMsgSeq = 0;
export function toDshMessage(m, provider, model) {
  const role = m?.role === 'system' ? 'system' : m?.role === 'assistant' ? 'assistant' : 'user';
  const blocks = [];
  const raw = m?.content;
  if (typeof raw === 'string') {
    if (raw.length > 0) blocks.push({ type: 'text', text: raw });
  } else if (Array.isArray(raw)) {
    for (const part of raw) {
      if (typeof part === 'string') {
        if (part.length > 0) blocks.push({ type: 'text', text: part });
      } else if (part && typeof part.text === 'string' && part.text.length > 0) {
        blocks.push({ type: 'text', text: part.text });
      }
    }
  } else if (raw !== undefined && raw !== null) {
    const text = JSON.stringify(raw);
    if (text && text !== '""') blocks.push({ type: 'text', text });
  }
  if (blocks.length === 0) return null; // 空消息直接丢，别喂给 pi-ai
  const source = role === 'assistant'
    ? { kind: 'model', provider, model }
    : role === 'system'
      ? { kind: 'system-prompt' }
      : { kind: 'user' };
  curaMsgSeq += 1;
  return { id: 'cura-' + curaMsgSeq, role, content: blocks, source };
}

// 记住上一次真正产出文本的 (provider, model)，下次优先用它。
let lastGoodCombo = null;
// 记住最近确定不可用的组合，短时间内排到最后。
// 实测现场每轮都写着「前 4 个组合失败」——同一批组合每轮都要重新撞一遍，
// 语音通话里这就是十几秒的沉默。给它们一个 10 分钟的冷却期。
const badCombos = new Map(); // key -> 过期时间戳
// provider 的模型清单缓存。语音通话路径每句话都要重新查一遍目录，
// 而这份清单几分钟内不会变——缓存住就把每轮的固定开销从「几个 1.5 秒」降到零。
// 按 llm 实例分表（WeakMap）：换一个 llm 运行时就是另一套目录，不能串。
const modelListCache = new WeakMap(); // llm -> Map(provider -> { at, models })
// 冷却分两档，因为失败的性质不一样：
//   硬错（认证失败、模型不认、参数非法）短时间内不会自己好，冷十分钟；
//   软错（超时、限流、网络抖）一分钟就够，冷却太久反而把能用的组合也锁住了。
const BAD_TTL_HARD_MS = 10 * 60 * 1000;
const BAD_TTL_SOFT_MS = 60 * 1000;
function cooldownFor(failure) {
  const code = String(failure?.code || '').toUpperCase();
  return /AUTH|PERMISSION|INVALID|NOT_FOUND|MODEL|CONFIG|UNAVAILABLE/.test(code) ? BAD_TTL_HARD_MS : BAD_TTL_SOFT_MS;
}
// 「上次能用的组合」要跨重启活着。宿主一重启模块就重新加载，内存里那条记录没了，
// 于是重启后的第一通电话又要从头撞一遍失败组合——正是最容易被听见的十几秒沉默。
let lastGoodLoaded = false;
function comboCacheFile(cfg) {
  // 没配 sayScript 就不落盘：单测里的假 cfg 不该在真实目录留下缓存，
  // 否则下一次测试会被上一次的「好组合」干扰。
  const say = String(cfg?.sayScript || '').trim();
  if (!say) return null;
  return path.join(path.dirname(say), '.cura-cache', 'last-good-combo.json');
}
function loadLastGood(cfg) {
  if (lastGoodLoaded) return;
  const file = comboCacheFile(cfg);
  // 只有真正拿到路径才标记「读过了」：否则第一次调用若没配 sayScript，
  // 后面的真实调用就再也读不到缓存。
  if (!file) return;
  lastGoodLoaded = true;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    // 超过一天就当过期：provider 的路由和可用模型会变，旧记录不该被无限信任。
    if (j?.provider && j?.model && (!j.at || Date.now() - Number(j.at) < 24 * 3600 * 1000)) {
      lastGoodCombo = { provider: j.provider, model: j.model };
    }
  } catch { /* 没有缓存就是没有，不是错误 */ }
}
function saveLastGood(cfg, combo) {
  const file = comboCacheFile(cfg);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...combo, at: Date.now() }), 'utf8');
  } catch { /* 缓存写不进去不影响通话 */ }
}
const comboKey = (c) => c.provider + '\u0000' + c.model;
const isBad = (c) => {
  const until = badCombos.get(comboKey(c));
  if (!until) return false;
  if (until > Date.now()) return true;
  badCombos.delete(comboKey(c));
  return false;
};

export async function chatViaDsh(llmCtx, cfg, messages, log = null) {
  const llm = llmCtx.llm;
  loadLastGood(cfg);
  // 逐个 (provider, model) 组合试，直到拿到非空文本。
  // 两个必须知道的事实（都来自实测，不是猜的）：
  //   1) 单组合失败时 llm.stream 不抛错，只收尾给一个 finish{reason:{kind:"error",failure}}；
  //      只累加 text-delta 会把失败吃成空字符串 → TTS 合成空串 → 四层全炸 → 通话那头死寂。
  //   2) 只换 provider 不换 model 也不行：trae 不认 deepseek-v4.1-flash，
  //      回 400 "Trae does not serve this model under the SOLO function"。所以按组合回退。
  const norm = (v) => (typeof v === 'string' ? v : v?.id);
  const uniq = (arr) => arr.filter((v, i, a) => v && a.indexOf(v) === i);
  const configured = String(cfg.provider || '').trim();
  const configuredModel = String(cfg.model || '').trim();
  // listProviders() 返回 provider 元数据对象数组（{id,...}），不是 id 字符串。
  const providers = uniq([configured, ...(llm.listProviders?.() ?? []).map(norm)]);

  // 先给每个 provider 配一次「配置里的模型名」，再补它们各自自报的模型清单。
  // 清单必须跨 provider 轮转（round-robin）取：xdpool 一家能报出十几个模型，
  // 若按 provider 顺序铺开，前 8 个名额会被它一家占满，永远轮不到 trae 那个
  // 真正能用的 glm-5.3-flash——这正是实测现场的形状。
  // 计时从「开始查模型目录」就起：这段虽然不产出文本，但对方听到的同样是沉默，
  // 必须算进总预算里，否则 8 个 provider × 1.5 秒的目录查询白等完，预算还剩满格。
  const startedAt = Date.now();
  const perProvider = providers.map((provider) => ({
    provider,
    models: uniq([configuredModel]),
  }));
  // 目录查询并行做，且共用同一个 1.5 秒上限。
  // 原来是串行 for-await：6 个 provider 各等 1.5 秒就是 9 秒纯等待，
  // 而语音那头早就把这段听成「没反应」了。目录本来也不该每次都查——
  // 同一批 provider 的模型清单几分钟内不会变，缓存住。
  const MODEL_CACHE_MS = 5 * 60 * 1000;
  let cacheFor = modelListCache.get(llm);
  if (!cacheFor) { cacheFor = new Map(); modelListCache.set(llm, cacheFor); }
  const listed = await Promise.all(perProvider.map(async (entry) => {
    const cached = cacheFor.get(entry.provider);
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.models;
    let models = [];
    try {
      // 这是语音通话路径，不能被目录查询拖住：某些 provider 的 listModels 会真的去
      // 打网络。1.5 秒拿不到就当它没有目录，退回只用配置里的模型名。
      models = (await Promise.race([
        Promise.resolve(llm.listModels?.(entry.provider)),
        new Promise((resolve) => setTimeout(() => resolve([]), 1500)),
      ])) ?? [];
    } catch (e) {
      log?.info?.('列 %s 的模型失败（忽略）: %s', entry.provider, e?.message || e);
    }
    const out = models.map(norm).filter(Boolean);
    // 查空了就不缓存：provider 一时抽风不该被记成「它没有模型」，否则五分钟内
    // 这个 provider 会被彻底跳过。
    if (out.length) cacheFor.set(entry.provider, { at: Date.now(), models: out });
    return out;
  }));
  for (let i = 0; i < perProvider.length; i++) {
    perProvider[i].models = uniq([...perProvider[i].models, ...listed[i]]);
  }
  const combos = [];
  const seen = new Set();
  for (let depth = 0; ; depth++) {
    let added = false;
    for (const { provider, models } of perProvider) {
      const model = models[depth];
      if (!model) continue;
      added = true;
      const key = provider + '\u0000' + model;
      if (seen.has(key)) continue;
      seen.add(key);
      combos.push({ provider, model });
    }
    if (!added) break;
  }

  // 每个组合都要有独立时限。没有它，一个卡住的 provider 会把整通电话钉死：
  // 实测现场是「对方说完话 → 60 秒后引擎自己超时 → 回一句『我这边卡了一下』」，
  // 而真正能用的组合排在后面，根本没轮到。
  const perComboMs = Math.max(3000, Number(cfg.comboTimeoutMs) || 8000);
  // 整通回复的总预算：语音对话里超过这个时长，回什么都晚了。
  const totalMs = Math.max(perComboMs, Number(cfg.replyTimeoutMs) || 25000);
  // 每个组合实际等的是「多久没出新东西」：首字最多等 perComboMs，之后只要还在吐字就一直等，
  // 但两次输出之间也不许超过 idleMs（默认取 perComboMs）。这样「慢但活着」的组合不会被误杀。
  const idleMs = Math.max(2000, Number(cfg.idleTimeoutMs) || perComboMs);

  // 上次成功的组合排到最前面。实测现场是「前 4 个组合失败，第 5 个 trae/… 才成」，
  // 每个失败组合都要等它自己超时——四轮白等就是十几秒的「对方说完话，半天没声」。
  if (lastGoodCombo) {
    const at = combos.findIndex((c) => c.provider === lastGoodCombo.provider && c.model === lastGoodCombo.model);
    if (at > 0) combos.unshift(combos.splice(at, 1)[0]);
  }
  // 冷却中的组合整体后移（稳定排序，保持原有相对顺序）。
  const hot = combos.filter((c) => !isBad(c));
  const cold = combos.filter((c) => isBad(c));
  combos.length = 0;
  combos.push(...hot, ...cold);

  const failures = [];
  for (const { provider, model } of combos.slice(0, 10)) {
    const left = totalMs - (Date.now() - startedAt);
    if (left <= 1000) {
      failures.push(`（总预算 ${totalMs}ms 用尽，剩余组合未尝试）`);
      break;
    }
    let text = '';
    let failure = null;
    let timedOut = false;
    let timeoutCode = null;
    const ac = new AbortController();
    let idleTimer = null;
    let hardTimer = null;
    let settled = false;
    let resolveRace = null;
    // 光靠 signal 不够：provider 不理会 abort 时 for-await 会永远挂在 next() 上。
    // 所以再用 Promise.race 兜一层——不管底层怎么赖着，到点就放弃这个组合。
    const deadline = new Promise((resolve) => { resolveRace = resolve; });
    const stop = (code) => {
      if (settled) return;
      settled = true;
      timedOut = true;
      timeoutCode = code;
      try { ac.abort(); } catch { /* 已关闭 */ }
      resolveRace();
    };
    // 关键：这里的计时器量的是「多久没有新东西出来」，不是「整段跑了多久」。
    // 实测 trae 会立刻吐字、但要十几秒才收尾，按整段计时会把一个健康的组合判死，
    // 于是整通电话明明有 provider 可用却全军覆没。吐过字就说明它还活着，继续等它。
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      const budget = totalMs - (Date.now() - startedAt);
      if (budget <= 0) { stop('TOTAL'); return; }
      idleTimer = setTimeout(() => stop(text ? 'STALL' : 'FIRST_TOKEN'), Math.min(idleMs, budget));
    };
    const consume = async () => {
      const stream = llm.stream({
        provider,
        model,
        messages: messages.map((m) => toDshMessage(m, provider, model)).filter(Boolean),
        signal: ac.signal,
      });
      for await (const chunk of stream) {
        // 任何 chunk 都算「它还在动」，不只是 text-delta：reasoning 之类也算活着。
        armIdle();
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
        if (chunk?.type === 'finish' && chunk.reason?.kind !== 'stop' && chunk.reason?.kind !== 'length') {
          failure = chunk.reason?.failure ?? { code: chunk.reason?.kind, message: chunk.reason?.kind };
        }
      }
    };
    // 硬上限仍然要有：万一 provider 一路滴字不停（或重复吐同一句），不能无限拖。
    hardTimer = setTimeout(() => stop('TOTAL'), Math.max(1000, Math.min(left, totalMs - (Date.now() - startedAt))));
    armIdle();
    try {
      await Promise.race([consume(), deadline]);
    } catch (e) {
      // stream 抛错也算这个组合失败，继续试下一个。
      if (!failure) failure = { code: ac.signal.aborted ? 'TIMEOUT' : 'THROW', message: String(e?.message || e) };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
    }
    text = text.trim();
    // 超时拿到的半截话不能当成功：对方听到「我」就断了，比没说话更糟。
    // 这时候要把这半截丢掉、换下一个组合，别把它当回复发出去。
    if (timedOut) text = '';
    if (text) {
      if (failures.length) log?.info?.('大脑代理回退到 %s/%s 后成功（前 %d 个组合失败）', provider, model, failures.length);
      lastGoodCombo = { provider, model };
      saveLastGood(cfg, lastGoodCombo);
      badCombos.delete(comboKey({ provider, model }));
      return text;
    }
    if (timedOut && !failure) {
      const what = timeoutCode === 'FIRST_TOKEN' ? `${perComboMs}ms 内一个字都没吐`
        : timeoutCode === 'STALL' ? `吐字后 ${idleMs}ms 没有新内容`
        : `总预算 ${totalMs}ms 用尽`;
      failure = { code: 'TIMEOUT', message: what };
    }
    // 空文本也是失败（provider 收尾给了 error 却没产出），一起进冷却。
    const ttl = cooldownFor(failure);
    badCombos.set(comboKey({ provider, model }), Date.now() + ttl);
    const why = failure ? `${failure.code} ${failure.message}` : '返回空文本';
    // 逐个记下来。只记「前 N 个失败」等于什么都没说——真要修的是具体哪个 provider
    // 因为什么原因不可用（欠费、模型不认、限流、超时），这行日志是唯一的证据。
    log?.info?.('组合 %s/%s 失败: %s（冷却 %d 秒）', provider, model, why, Math.round(ttl / 1000));
    failures.push(`${provider}/${model}: ${why}`);
  }
  throw new Error(`所有 (provider, model) 组合都没能产出回复 —— ${failures.join(' | ')}`);
}
