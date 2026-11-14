// chat.js — 自研 QQ 聊天模式：NapCat 事件直连 + 回复规则 + 语料库 + 会话记忆
// 设计目标：DSH 设置页（前端）改配置 → cordis 重载插件 → 聊天行为即时变化
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runSay } from './say.js';

const execFileP = promisify(execFile);

const H = (token) => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');

// ---------- 语料库：目录 txt/jsonl 切条目，字符二元组重叠度粗检索 ----------
function loadCorpus(corpusDir) {
  const items = [];
  const root = path.resolve(corpusDir);
  if (!corpusDir || !fs.existsSync(root)) return items;
  for (const f of fs.readdirSync(root)) {
    const full = path.resolve(root, f);
    if (!full.startsWith(root + path.sep) || !fs.statSync(full).isFile()) continue; // 路径围栏
    const raw = fs.readFileSync(full, 'utf8');
    if (f.endsWith('.jsonl')) {
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { items.push(String(JSON.parse(line).text ?? line)); } catch { /* skip bad line */ }
      }
    } else {
      for (const chunk of raw.split(/\n{2,}/)) {
        if (chunk.trim()) items.push(chunk.trim());
      }
    }
  }
  return items;
}

function bigrams(s) {
  const set = new Set();
  const clean = s.replace(/[\s，。！？!?、…]/g, '');
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

function retrieveCorpus(items, query, topK) {
  if (!items.length || !query) return [];
  const q = bigrams(query);
  return items
    .map((text) => {
      const g = bigrams(text);
      let hit = 0;
      for (const b of q) if (g.has(b)) hit++;
      return { text, score: hit / Math.max(q.size, 1) > 0 ? hit / Math.max(q.size, 1) : 0 };
    })
    .filter((x) => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.text);
}

// ---------- 会话记忆：每用户一个 json ----------
const historyFile = (dir, uid) => path.resolve(dir, `${uid}.json`);

function loadHistory(dir, userId, limit) {
  const f = historyFile(dir, userId);
  const root = path.resolve(dir);
  if (!f.startsWith(root + path.sep)) return []; // 路径围栏
  return readJsonSafe(f, []).slice(-limit * 2);
}

function appendHistory(dir, userId, role, text, limit) {
  const root = path.resolve(dir);
  const f = historyFile(dir, userId);
  if (!f.startsWith(root + path.sep)) return; // 路径围栏
  const arr = readJsonSafe(f, []);
  arr.push({ role, content: text, ts: Date.now() });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(arr.slice(-limit * 2)));
}

// ---------- 语音条：ASR（record→wav→faster-whisper 包装器） ----------
async function asrRecord(napcat, fileRef, workDir, pythonExe, sttScript) {
  try {
    const r = await fetch(`${napcat.baseUrl}/get_record`, {
      method: 'POST', headers: H(napcat.token), body: JSON.stringify({ file: fileRef }),
    }).then((x) => x.json());
    const localPath = r?.data?.file ?? fileRef;
    const wav = path.join(workDir, `asr-${crypto.randomBytes(4).toString('hex')}.wav`);
    const out = path.join(workDir, `asr-${crypto.randomBytes(4).toString('hex')}.txt`);
    await execFileP('ffmpeg', ['-y', '-i', localPath, '-ar', '16000', '-ac', '1', wav], { timeout: 30000 });
    await execFileP(pythonExe, [sttScript, '--file', wav, '--out', out], { timeout: 120000 });
    const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim() : '';
    try { fs.unlinkSync(wav); fs.unlinkSync(out); } catch { /* ignore */ }
    return text;
  } catch (e) {
    return '';
  }
}

async function napcatPost(baseUrl, token, action, body, timeoutMs = 30000) {
  const r = await fetch(`${baseUrl}/${action}`, {
    method: 'POST', headers: H(token), body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json();
}

// ---------- 场景化 system prompt ----------
function buildSystemPrompt(cfg, corpusHits) {
  const parts = [cfg.chatPersona];
  if (cfg.styleRules) parts.push(`【回复规则（必须遵守）】\n${cfg.styleRules}`);
  if (cfg.scene === 'work') parts.push('【当前场景：轻量工作】回答直接、有结论、可执行；闲聊一句带过。');
  else parts.push('【当前场景：日常闲聊】像朋友发消息一样说话：短句、口语、有情绪，不要像客服。');
  if (corpusHits?.length) parts.push(`【参考语料（模仿说话感觉，不要照抄）】\n${corpusHits.join('\n---\n')}`);
  return parts.join('\n\n');
}

// ---------- 主处理 ----------
export function createChatMode(ctx, cfg, logger) {
  const napcat = { baseUrl: cfg.napcatBaseUrl, token: cfg.napcatToken };
  const sttScript = path.resolve(PLUGIN_ROOT, 'stt-whisper.py');
  const state = { corpus: [], corpusLoadedAt: 0 };

  function refreshCorpus() {
    if (Date.now() - state.corpusLoadedAt > 60_000) {
      state.corpus = loadCorpus(cfg.corpusDir);
      state.corpusLoadedAt = Date.now();
      if (state.corpus.length) logger.info('语料库已加载：%d 条', state.corpus.length);
    }
  }

  async function replyText(userId, text, wasVoice) {
    refreshCorpus();
    const history = loadHistory(cfg.historyDir, userId, cfg.historyLimit);
    const hits = retrieveCorpus(state.corpus, text, cfg.corpusTopK);
    const messages = [
      { role: 'system', content: [{ type: 'text', text: buildSystemPrompt(cfg, hits) }] },
      ...history.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
      { role: 'user', content: [{ type: 'text', text }] },
    ];
    const llm = cfg.llmRef();
    if (!llm) return null;
    const stream = llm.stream({ provider: cfg.provider, model: cfg.model, messages });
    let reply = '';
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text;
    }
    reply = reply.trim();
    if (!reply) return null;
    appendHistory(cfg.historyDir, userId, 'user', text, cfg.historyLimit);
    appendHistory(cfg.historyDir, userId, 'assistant', reply, cfg.historyLimit);
    // 出口：语音条（原消息是语音=mirror / always）或文字
    const wantVoice = cfg.voiceReply === 'always' || (cfg.voiceReply === 'mirror' && wasVoice);
    if (wantVoice) {
      try {
        const out = path.join(workDir, `voice-${crypto.randomBytes(4).toString('hex')}.mp3`);
        // 文本走 stdin：回复里出现 "-Text" / "--out" 这类字样时，走 argv 会被 PowerShell
        // 当成参数名而报缺参数（语音静默失败）。产物路径以脚本 stdout 为准，兜底层回 .wav。
        const said = await runSay({ sayScript: cfg.sayScript, text: reply, out, timeoutMs: 90000 });
        const audio = said.produced;
        if (audio && fs.existsSync(audio) && fs.statSync(audio).size > 1000) {
          await napcatPost(napcat.baseUrl, napcat.token, 'send_private_msg',
            { user_id: Number(userId), message: [{ type: 'record', data: { file: 'file:///' + audio.replace(/\\/g, '/') } }] });
          setTimeout(() => { try { fs.unlinkSync(audio); } catch { /* ignore */ } }, 60_000);
          return 'voice';
        }
      } catch (e) {
        logger.warning('语音条生成失败，回退文字: %s', e?.message || e);
      }
    }
    await napcatPost(napcat.baseUrl, napcat.token, 'send_private_msg',
      { user_id: Number(userId), message: [{ type: 'text', data: { text: reply } }] });
    return 'text';
  }

  async function handleEvent(event) {
    if (event?.post_type !== 'message' || event.message_type !== 'private') return;
    const userId = String(event.user_id ?? '');
    if (cfg.allowUsers.length && !cfg.allowUsers.includes(userId)) return;
    const segs = Array.isArray(event.message) ? event.message : [];
    const textSeg = segs.find((s) => s.type === 'text');
    const recSeg = segs.find((s) => s.type === 'record');
    let text = (textSeg?.data?.text ?? '').trim();
    let wasVoice = false;
    if (!text && recSeg) {
      wasVoice = true;
      text = await asrRecord(napcat, recSeg.data?.file ?? '', workDir, cfg.sttPython, sttScript);
      logger.info('语音条转写（%s）: %s', userId, text || '（空）');
    }
    if (!text) return;
    if (text.startsWith('#')) return; // # 开头留给 dsh-onebot/用户命令
    logger.info('QQ 消息（%s）: %s', userId, text.slice(0, 80));
    try {
      const how = await replyText(userId, text, wasVoice);
      logger.info('已回复（%s）', how ?? '空回复跳过');
    } catch (e) {
      logger.error('回复失败: %s', e?.stack || e);
    }
  }

  return { handleEvent };
}
