// 语音接入配置层（voice.json，gitignored，rules-remote 行是唯一写方）。
// 三块：
//   tts  —— TTS 模型接入：builtin（say.ps1 四保险链）/ openai 兼容端点 / 本地部署模型
//   e2e  —— 端到端语音对话模型（GLM-Realtime / Qwen-Omni / OpenAI Realtime / 自定义）
//   call —— 来电设置：白名单、自动接听、铃响超时、告别挂断、问候语
//
// 设计原则：面板代码不内嵌任何机器相关路径/密钥——一切从 voice.json 读，
// 没有就显示内置链的默认行为（say.ps1 四保险）。

import fs from 'node:fs';

export const TTS_PROVIDERS = ['builtin', 'openai', 'local'];
export const LOCAL_ENGINES = ['gpt-sovits', 'cosyvoice', 'indextts', 'fish-speech', 'custom'];
export const E2E_PROVIDERS = ['glm-realtime', 'qwen-omni', 'openai-realtime', 'custom'];

export function defaultVoiceConfig() {
  return {
    version: 1,
    tts: {
      provider: 'builtin',
      // 内置链的音色设计说明：告诉 agent 自己的声音是什么样（进人设提示）
      builtinVoiceNote: '',
      // OpenAI 兼容 TTS（/v1/audio/speech）：云端托管或自建网关
      openai: { baseUrl: '', model: '', voice: '', apiKey: '', format: 'mp3', speed: 1 },
      // 本地部署（GPT-SoVITS / CosyVoice / IndexTTS / Fish Speech）：各自的 HTTP API
      local: { engine: 'custom', baseUrl: '', voice: '', apiKey: '', note: '' },
    },
    e2e: {
      enabled: false,
      provider: 'glm-realtime',
      baseUrl: '',
      model: '',
      apiKey: '',
      voice: '',
      note: '',
    },
    call: {
      autoAccept: true,
      whitelist: [],
      ringTimeoutSec: 25,
      farewellHangup: true,
      greeting: '',
      maxDurationMin: 10,
    },
    updatedAt: '',
  };
}

export function mergeVoice(cfg) {
  const base = defaultVoiceConfig();
  if (!cfg || typeof cfg !== 'object') return base;
  const out = { ...base, ...cfg };
  out.tts = { ...base.tts, ...(cfg.tts ?? {}) };
  out.tts.openai = { ...base.tts.openai, ...(cfg.tts?.openai ?? {}) };
  out.tts.local = { ...base.tts.local, ...(cfg.tts?.local ?? {}) };
  out.e2e = { ...base.e2e, ...(cfg.e2e ?? {}) };
  out.call = { ...base.call, ...(cfg.call ?? {}) };
  if (!Array.isArray(out.call.whitelist)) out.call.whitelist = [];
  return out;
}

export function loadVoiceConfig(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return mergeVoice(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { return null; }
}

export function saveVoiceConfig(file, cfg) {
  cfg.updatedAt = new Date().toISOString();
  const dir = file.replace(/[\\/][^\\/]+$/, '');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function fail(message) {
  const error = new Error(message);
  error.name = 'CuraVoiceError';
  throw error;
}

const urlOk = (u) => /^https?:\/\/.+/i.test(String(u ?? '').trim());

/** 写入校验：返回 { ok, patch } 或 { ok: false, error }；支持部分 patch */
export function validateVoicePatch(patch) {
  const out = {};
  if (patch.tts !== undefined) {
    if (typeof patch.tts !== 'object' || patch.tts === null) return { ok: false, error: 'tts 必须是对象' };
    const tts = {};
    if (patch.tts.provider !== undefined) {
      if (!TTS_PROVIDERS.includes(patch.tts.provider)) return { ok: false, error: `tts.provider 只能是 ${TTS_PROVIDERS.join('/')}` };
      tts.provider = patch.tts.provider;
    }
    if (patch.tts.builtinVoiceNote !== undefined) tts.builtinVoiceNote = String(patch.tts.builtinVoiceNote ?? '').trim().slice(0, 300);
    if (patch.tts.openai !== undefined) {
      const o = patch.tts.openai;
      if (typeof o !== 'object' || o === null) return { ok: false, error: 'tts.openai 必须是对象' };
      const clean = {};
      if (o.baseUrl !== undefined) {
        const u = String(o.baseUrl ?? '').trim();
        if (u && !urlOk(u)) return { ok: false, error: 'tts.openai.baseUrl 必须是 http(s) 地址' };
        clean.baseUrl = u;
      }
      if (o.model !== undefined) clean.model = String(o.model ?? '').trim().slice(0, 120);
      if (o.voice !== undefined) clean.voice = String(o.voice ?? '').trim().slice(0, 160);
      if (o.apiKey !== undefined) clean.apiKey = String(o.apiKey ?? '').trim().slice(0, 200);
      if (o.format !== undefined) {
        if (!['mp3', 'wav', 'opus'].includes(o.format)) return { ok: false, error: 'tts.openai.format 只能是 mp3/wav/opus' };
        clean.format = o.format;
      }
      if (o.speed !== undefined) {
        const n = Number(o.speed);
        if (!Number.isFinite(n) || n < 0.5 || n > 2) return { ok: false, error: 'tts.openai.speed 取值 0.5-2' };
        clean.speed = n;
      }
      if (Object.keys(clean).length) tts.openai = clean;
    }
    if (patch.tts.local !== undefined) {
      const l = patch.tts.local;
      if (typeof l !== 'object' || l === null) return { ok: false, error: 'tts.local 必须是对象' };
      const clean = {};
      if (l.engine !== undefined) {
        if (!LOCAL_ENGINES.includes(l.engine)) return { ok: false, error: `tts.local.engine 只能是 ${LOCAL_ENGINES.join('/')}` };
        clean.engine = l.engine;
      }
      if (l.baseUrl !== undefined) {
        const u = String(l.baseUrl ?? '').trim();
        if (u && !urlOk(u)) return { ok: false, error: 'tts.local.baseUrl 必须是 http(s) 地址' };
        clean.baseUrl = u;
      }
      if (l.voice !== undefined) clean.voice = String(l.voice ?? '').trim().slice(0, 160);
      if (l.apiKey !== undefined) clean.apiKey = String(l.apiKey ?? '').trim().slice(0, 200);
      if (l.note !== undefined) clean.note = String(l.note ?? '').trim().slice(0, 300);
      if (Object.keys(clean).length) tts.local = clean;
    }
    if (Object.keys(tts).length) out.tts = tts;
  }
  if (patch.e2e !== undefined) {
    if (typeof patch.e2e !== 'object' || patch.e2e === null) return { ok: false, error: 'e2e 必须是对象' };
    const e2e = {};
    if (patch.e2e.enabled !== undefined) {
      if (typeof patch.e2e.enabled !== 'boolean') return { ok: false, error: 'e2e.enabled 必须是布尔' };
      e2e.enabled = patch.e2e.enabled;
    }
    if (patch.e2e.provider !== undefined) {
      if (!E2E_PROVIDERS.includes(patch.e2e.provider)) return { ok: false, error: `e2e.provider 只能是 ${E2E_PROVIDERS.join('/')}` };
      e2e.provider = patch.e2e.provider;
    }
    for (const key of ['baseUrl', 'model', 'apiKey', 'voice', 'note']) {
      if (patch.e2e[key] !== undefined) {
        const v = String(patch.e2e[key] ?? '').trim();
        if (key === 'baseUrl' && v && !urlOk(v)) return { ok: false, error: 'e2e.baseUrl 必须是 http(s) 地址' };
        e2e[key] = v.slice(0, key === 'note' ? 300 : 200);
      }
    }
    if (Object.keys(e2e).length) out.e2e = e2e;
  }
  if (patch.call !== undefined) {
    if (typeof patch.call !== 'object' || patch.call === null) return { ok: false, error: 'call 必须是对象' };
    const call = {};
    if (patch.call.autoAccept !== undefined) {
      if (typeof patch.call.autoAccept !== 'boolean') return { ok: false, error: 'call.autoAccept 必须是布尔' };
      call.autoAccept = patch.call.autoAccept;
    }
    if (patch.call.whitelist !== undefined) {
      if (!Array.isArray(patch.call.whitelist)) return { ok: false, error: 'call.whitelist 必须是数组' };
      const raw = patch.call.whitelist.map((s) => String(s ?? '').trim()).filter(Boolean);
      const nums = raw.filter((s) => /^\d{5,12}$/.test(s));
      if (nums.length !== raw.length) return { ok: false, error: '白名单每项须是 5-12 位 QQ 号' };
      call.whitelist = [...new Set(nums)].slice(0, 20);
    }
    if (patch.call.ringTimeoutSec !== undefined) {
      const n = Math.floor(Number(patch.call.ringTimeoutSec));
      if (!Number.isFinite(n) || n < 5 || n > 120) return { ok: false, error: 'ringTimeoutSec 取值 5-120' };
      call.ringTimeoutSec = n;
    }
    if (patch.call.farewellHangup !== undefined) {
      if (typeof patch.call.farewellHangup !== 'boolean') return { ok: false, error: 'call.farewellHangup 必须是布尔' };
      call.farewellHangup = patch.call.farewellHangup;
    }
    if (patch.call.greeting !== undefined) call.greeting = String(patch.call.greeting ?? '').trim().slice(0, 200);
    if (patch.call.maxDurationMin !== undefined) {
      const n = Math.floor(Number(patch.call.maxDurationMin));
      if (!Number.isFinite(n) || n < 1 || n > 60) return { ok: false, error: 'maxDurationMin 取值 1-60' };
      call.maxDurationMin = n;
    }
    if (Object.keys(call).length) out.call = call;
  }
  if (!Object.keys(out).length) return { ok: false, error: '没有可保存的配置字段' };
  return { ok: true, patch: out };
}
