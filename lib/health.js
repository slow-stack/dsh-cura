// 健康日志（男女通用）+ 周期关怀（可选子模块）的数据层。
// 文件 health.json：唯一写方是 rules-remote 行（面板 + 学习都走它）；
// 主插件只读（会话注入 + health_log 工具经 root 服务转发写入）。
// 本模块同时提供纯计算（汇总/渲染），node 可单测。

import fs from 'node:fs';
import path from 'node:path';
import * as C from './cycle.js';

export const LOG_CAP = 90; // 日志条数上限（约三个月的日粒度）

export function defaultHealth() {
  return {
    version: 1,
    habits: {
      sleepTarget: 7.5, // 目标睡眠时长（小时）
      exerciseWeekly: 3, // 每周运动目标（次）
      focusNote: '', // 想让 agent 额外关注什么（自由文本，≤200 字）
    },
    cycle: C.defaultCycleConfig(),
    logs: [], // { id, date, sleepHours?, sleepQuality?, mood?, exercise?, notes?, createdAt }
    updatedAt: '',
  };
}

export function loadHealth(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof cfg !== 'object' || cfg === null) return null;
    const base = defaultHealth();
    return {
      ...base,
      ...cfg,
      habits: { ...base.habits, ...(cfg.habits ?? {}) },
      cycle: { ...base.cycle, ...(cfg.cycle ?? {}), advice: { ...base.cycle.advice, ...(cfg.cycle?.advice ?? {}) } },
      logs: Array.isArray(cfg.logs) ? cfg.logs : [],
    };
  } catch { return null; }
}

export function saveHealth(file, data) {
  data.updatedAt = new Date().toISOString();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------- 日志 ----------

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function numInRange(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** 日志条目校验+规整：返回 { ok, entry } 或 { ok: false, error } */
export function validateLog(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const out = {};
  if (e.date !== undefined && e.date !== '') {
    if (!DATE_RE.test(String(e.date))) return { ok: false, error: 'date 必须是 YYYY-MM-DD' };
    out.date = e.date;
  } else {
    out.date = todayStr();
  }
  if (e.sleepHours !== undefined && e.sleepHours !== null && e.sleepHours !== '') {
    const n = numInRange(e.sleepHours, 0, 24);
    if (n === null) return { ok: false, error: 'sleepHours 必须是 0-24 的数字' };
    out.sleepHours = Math.round(n * 10) / 10;
  }
  if (e.sleepQuality !== undefined && e.sleepQuality !== null && e.sleepQuality !== '') {
    const n = numInRange(e.sleepQuality, 1, 5);
    if (n === null) return { ok: false, error: 'sleepQuality 取值 1-5' };
    out.sleepQuality = Math.round(n);
  }
  if (e.mood !== undefined && e.mood !== null && e.mood !== '') {
    const n = numInRange(e.mood, 1, 5);
    if (n === null) return { ok: false, error: 'mood 取值 1-5' };
    out.mood = Math.round(n);
  }
  if (e.exercise !== undefined && String(e.exercise).trim()) out.exercise = String(e.exercise).trim().slice(0, 200);
  if (e.weight !== undefined && e.weight !== null && e.weight !== '') {
    const n = numInRange(e.weight, 30, 250);
    if (n === null) return { ok: false, error: 'weight 取值 30-250（kg）' };
    out.weight = Math.round(n * 10) / 10;
  }
  if (e.bpSystolic !== undefined && e.bpSystolic !== null && e.bpSystolic !== '') {
    const n = numInRange(e.bpSystolic, 60, 260);
    if (n === null) return { ok: false, error: 'bpSystolic 取值 60-260' };
    out.bpSystolic = Math.round(n);
  }
  if (e.bpDiastolic !== undefined && e.bpDiastolic !== null && e.bpDiastolic !== '') {
    const n = numInRange(e.bpDiastolic, 30, 160);
    if (n === null) return { ok: false, error: 'bpDiastolic 取值 30-160' };
    out.bpDiastolic = Math.round(n);
  }
  if (e.pulse !== undefined && e.pulse !== null && e.pulse !== '') {
    const n = numInRange(e.pulse, 30, 220);
    if (n === null) return { ok: false, error: 'pulse 取值 30-220' };
    out.pulse = Math.round(n);
  }
  if (e.flow !== undefined && e.flow !== null && e.flow !== '') {
    const n = Math.floor(Number(e.flow));
    if (!Number.isFinite(n) || n < 0 || n > 4) return { ok: false, error: 'flow 取值 0-4（0=无 4=大量）' };
    out.flow = n;
  }
  if (e.symptoms !== undefined) {
    const raw = Array.isArray(e.symptoms) ? e.symptoms : String(e.symptoms ?? '').split(/[,，、\s]+/);
    const clean = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
    if (clean.some((s) => s.length > 20)) return { ok: false, error: '症状每项不超过 20 字' };
    if (clean.length) out.symptoms = clean.slice(0, 10);
  }
  if (e.notes !== undefined && String(e.notes).trim()) out.notes = String(e.notes).trim().slice(0, 500);
  const hasBody = out.sleepHours !== undefined || out.sleepQuality !== undefined
    || out.mood !== undefined || out.exercise !== undefined || out.notes !== undefined
    || out.weight !== undefined || out.bpSystolic !== undefined || out.bpDiastolic !== undefined || out.pulse !== undefined
    || out.flow !== undefined || out.symptoms !== undefined;
  if (!hasBody) return { ok: false, error: '至少要有一个字段：睡眠/运动/情绪/体重/血压/心率/经量/症状/备注' };
  out.id = `H${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  out.createdAt = new Date().toISOString();
  return { ok: true, entry: out };
}

/** 追加日志（纯函数：返回新数组；超限裁掉最旧的） */
export function appendLog(logs, entry) {
  return [...(logs ?? []), entry].slice(-LOG_CAP);
}

export function deleteLog(logs, id) {
  return (logs ?? []).filter((l) => l.id !== id);
}

// ---------- 汇总（近 N 天，供面板与注入共用） ----------

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (m) => String(m).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function summarizeLogs(logs, days = 7) {
  const since = daysAgoStr(days - 1);
  const recent = (logs ?? []).filter((l) => String(l.date ?? '') >= since);
  const sleepVals = recent.map((l) => l.sleepHours).filter((v) => typeof v === 'number');
  const moods = recent.map((l) => l.mood).filter((v) => typeof v === 'number');
  const exerciseCount = recent.filter((l) => l.exercise).length;
  const sorted = recent.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const latest = sorted[0] ?? null;
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null);
  return {
    days,
    total: recent.length,
    sleepAvg: avg(sleepVals),
    sleepCount: sleepVals.length,
    moodAvg: avg(moods),
    exerciseCount,
    latest: latest ? { date: latest.date, mood: latest.mood ?? null, notes: latest.notes ?? '', exercise: latest.exercise ?? '' } : null,
  };
}

// ---------- 每日序列（图表用）与健康评分 ----------

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 近 N 天的每日序列（缺数据的日期补 null），图表直接可用 */
export function dailySeries(logs, days = 7) {
  const byDate = new Map();
  for (const l of logs ?? []) {
    const date = String(l.date ?? '');
    if (!DATE_RE.test(date)) continue;
    // 同日多条：后写的覆盖先写的（图表取最新）
    byDate.set(date, l);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const p = (m) => String(m).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const log = byDate.get(date);
    out.push({
      date,
      label: WEEKDAY_LABELS[d.getDay()],
      sleepHours: log && typeof log.sleepHours === 'number' ? log.sleepHours : null,
      mood: log && typeof log.mood === 'number' ? log.mood : null,
      exercise: Boolean(log && log.exercise),
      weight: log && typeof log.weight === 'number' ? log.weight : null,
      bpSystolic: log && typeof log.bpSystolic === 'number' ? log.bpSystolic : null,
      bpDiastolic: log && typeof log.bpDiastolic === 'number' ? log.bpDiastolic : null,
      pulse: log && typeof log.pulse === 'number' ? log.pulse : null,
    });
  }
  return out;
}

/** 血压状态：green=正常(<130/85)、orange=偏高(130-139/85-89)、red=高血压(≥140/≥90)；
 *  参照 ACC/AHA 与 ESH 的成人分类，生活参考用，不是诊断 */
export function bpStatus(sys, dia) {
  if (typeof sys !== 'number' || typeof dia !== 'number') return null;
  if (sys >= 140 || dia >= 90) return 'red';
  if (sys >= 130 || dia >= 85) return 'orange';
  return 'green';
}

/** 静息心率状态：60-100 正常（green），之外 red */
export function pulseStatus(pulse) {
  if (typeof pulse !== 'number') return null;
  return pulse >= 60 && pulse <= 100 ? 'green' : 'red';
}

/** 指标趋势瓷砖数据：最新值 + 与此前均值比较的趋势 + 7 天迷你序列 */
export function metricTiles(series, habits = {}) {
  const tiles = [];
  const pick = (key) => series.map((d) => (typeof d[key] === 'number' ? d[key] : null));
  const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return { value: arr[i], idx: i }; return null; };
  const prevAvg = (arr, idx) => {
    const before = arr.slice(0, Math.max(0, idx)).filter((v) => v !== null);
    if (!before.length) return null;
    return before.reduce((s, v) => s + v, 0) / before.length;
  };
  const trend = (arr) => {
    const l = last(arr);
    if (!l) return null;
    const prev = prevAvg(arr, l.idx);
    if (prev === null) return { value: l.value, dir: '→', delta: 0 };
    const delta = Math.round((l.value - prev) * 10) / 10;
    return { value: l.value, dir: delta > 0 ? '↑' : delta < 0 ? '↓' : '→', delta };
  };
  // 体重
  const weightArr = pick('weight');
  const wt = trend(weightArr);
  tiles.push({
    key: 'weight', value: wt ? String(wt.value) : null, dir: wt ? wt.dir : null, delta: wt ? wt.delta : null,
    unit: 'kg', series: weightArr, status: wt ? (Number(habits.weightTarget) ? (Math.abs(wt.value - Number(habits.weightTarget)) <= 2 ? 'green' : 'orange') : null) : null,
    target: Number(habits.weightTarget) || null,
  });
  // 血压：合并收缩/舒张显示
  const sysArr = pick('bpSystolic');
  const diaArr = pick('bpDiastolic');
  const sysL = last(sysArr), diaL = last(diaArr);
  const bpSt = sysL && diaL ? bpStatus(sysL.value, diaL.value) : null;
  tiles.push({
    key: 'bp', value: sysL && diaL ? `${sysL.value}/${diaL.value}` : null, dir: null, delta: null,
    unit: 'mmHg', series: sysArr, sysSeries: sysArr, diaSeries: diaArr, status: bpSt, target: null,
  });
  // 心率
  const pulseArr = pick('pulse');
  const pt = trend(pulseArr);
  tiles.push({
    key: 'pulse', value: pt ? String(pt.value) : null, dir: pt ? pt.dir : null, delta: pt ? pt.delta : null,
    unit: 'bpm', series: pulseArr, status: pt ? pulseStatus(pt.value) : null, target: null,
  });
  return tiles;
}

/** 健康水平评分（0-100）：睡眠 45% + 运动 30% + 情绪 25%，缺项重新归一化 */
export function scoreHealth(summary, habits = {}) {
  const parts = [];
  const target = Number(habits.sleepTarget) || 7.5;
  if (summary && summary.sleepAvg !== null && summary.sleepAvg !== undefined) {
    // 睡眠：达标 = 100，每差 1h 扣 25，下限 0；超 1h 以内不加分
    const deficit = Math.max(0, target - summary.sleepAvg);
    parts.push({ key: 'sleep', weight: 0.45, score: Math.max(0, 100 - deficit * 25) });
  }
  if (summary && summary.exerciseCount !== undefined) {
    const weekly = Number(habits.exerciseWeekly) || 0;
    if (weekly > 0) {
      // 运动：按 7 天折算比例（7 天窗口 ≈ 一周）
      parts.push({ key: 'exercise', weight: 0.3, score: Math.min(100, Math.round((summary.exerciseCount / weekly) * 100)) });
    }
  }
  if (summary && summary.moodAvg !== null && summary.moodAvg !== undefined) {
    parts.push({ key: 'mood', weight: 0.25, score: Math.round((summary.moodAvg / 5) * 100) });
  }
  if (!parts.length) return null;
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const overall = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / weightSum);
  const label = overall >= 85 ? '状态在线' : overall >= 70 ? '不错' : overall >= 55 ? '还行' : '需要注意';
  return {
    overall,
    label,
    parts: parts.map((p) => ({ key: p.key, score: Math.round(p.score) })),
  };
}

// ---------- 注入渲染 ----------

export function renderInjection(summary, cycleInfo, habits = {}) {
  const lines = [];
  if (summary && summary.total > 0) {
    const parts = [];
    if (summary.sleepAvg !== null) {
      const target = Number(habits.sleepTarget) || 7.5;
      const gap = summary.sleepAvg < target - 0.5 ? `，低于目标 ${target}h，可以顺势劝早睡` : '';
      parts.push(`睡眠：近 ${summary.days} 天记录 ${summary.sleepCount} 次，平均 ${summary.sleepAvg}h${gap}`);
    }
    if (summary.exerciseCount > 0 || Number(habits.exerciseWeekly) > 0) {
      parts.push(`运动：${summary.days} 天里 ${summary.exerciseCount} 次${Number(habits.exerciseWeekly) ? `（目标每周 ${habits.exerciseWeekly} 次）` : ''}`);
    }
    if (summary.moodAvg !== null) parts.push(`情绪均值 ${summary.moodAvg}/5`);
    if (summary.latest && summary.latest.notes) parts.push(`最近一条备注（${summary.latest.date}）：${summary.latest.notes}`);
    if (parts.length) lines.push(`【健康关注 · 近 ${summary.days} 天】${parts.join('；')}。`, '（这些是用户自述的生活数据，贴合对话自然用——该劝早睡就劝、该夸坚持就夸，别每次都像念体检报告。）');
  }
  if (cycleInfo) {
    lines.push(`【周期关怀 · 今日】${C.renderCycleLine(cycleInfo)}`);
    lines.push('（生活方式参考，不是医疗建议；经期严重疼痛或明显紊乱时温和建议就医；不必主动点破周期话题，贴合对话再用。）');
  }
  return lines.join('\n');
}
