// 周期关怀（健康模块的可选子模块，默认关）：女性激素周期的阶段计算 + 注入文本。
// 纯逻辑模块（无文件 IO——cycle 配置是 health.json 的一个子对象，文件读写归 health.js）。
//
// 阶段估算（标准 28 天参考，按周期长度自适应）：
//   月经期 menstrual：第 1 ~ periodLength 天
//   卵泡期 follicular：periodLength+1 ~ 排卵日前 2 天（雌激素爬坡，能量上行）
//   排卵期 ovulatory：排卵日 ±1（共 3 天窗口；排卵日 = 周期长 - 14，黄体期固定 14 天估算）
//   黄体期 luteal：排卵窗后 ~ 下次月经第一天（前段适合收尾细活，后段经前综合征高发）
//
// 定位：生活方式参考（cycle syncing 的一般共识），不是医疗建议。

export const PHASE_NAMES = {
  menstrual: '月经期',
  follicular: '卵泡期',
  ovulatory: '排卵期',
  luteal: '黄体期',
};

export const PHASE_KEYS = Object.keys(PHASE_NAMES);

export const DEFAULT_ADVICE = {
  menstrual:
    '身体在排血和收缩，能量低是正常的。多暖多歇：热饮、热敷、轻散步就好；疼得厉害就躺，别硬撑。'
    + '不安排高强度学习和重大决定，工作挑轻的做。情绪敏感也正常，想哭就哭，想安静就安静。',
  follicular:
    '雌激素在爬坡，脑子一天比一天亮，这是开新坑的黄金期。'
    + '学新东西、啃硬问题、头脑风暴、启动大工程、立运动计划，都往这几天放。',
  ovulatory:
    '「要说出口」的事往这几天放最划算：谈判、汇报、社交、面试、当面提需求。'
    + '注意峰值容易透支，也别因一时上头过度承诺。',
  luteal:
    '前半段：孕激素让人踏实，适合收尾、整理、细活和复盘。'
    + '后半段（经前）：容易累、烦躁、想吃甜的——别在这几天做大决定，任务改轻，早点睡，运动改舒缓的。'
    + '情绪上头时先接住情绪再讲事，想吃点甜的也随她，不用劝戒。',
};

export function defaultCycleConfig() {
  return {
    enabled: false,
    lastStart: '', // 末次月经第一天，YYYY-MM-DD
    cycleLength: 28,
    periodLength: 5,
    periods: [], // 历史月经起始日（YYYY-MM-DD 数组，统计用，最新在后）
    advice: { ...DEFAULT_ADVICE },
  };
}

// ---------- 日期工具（按本地时区的自然日，避免 UTC 偏移） ----------

function parseLocalDate(str) {
  const m = String(str ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function clampInt(v, min, max, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

function isValidDateStr(s) {
  const d = parseLocalDate(s);
  return d !== null && fmtDate(d) === String(s ?? '').trim();
}

// ---------- 阶段计算 ----------

export function phaseInfo(cycleConfig, now = new Date()) {
  if (!cycleConfig || cycleConfig.enabled !== true || !isValidDateStr(cycleConfig.lastStart)) return null;
  const cycleLen = clampInt(cycleConfig.cycleLength, 21, 45, 28);
  const periodLen = clampInt(cycleConfig.periodLength, 2, 10, 5);
  if (periodLen > cycleLen - 16) return null; // 经期太长/周期太短，估算失去意义

  const start = parseLocalDate(cycleConfig.lastStart);
  const today = startOfDay(now);
  const diff = Math.floor((today - start) / 86400000);
  if (diff < 0) return null; // 末次日期写到了未来

  const cycleDay = ((diff % cycleLen) + cycleLen) % cycleLen + 1;
  const ovuDay = cycleLen - 14;
  let phase;
  let dayInPhase;
  if (cycleDay <= periodLen) {
    phase = 'menstrual'; dayInPhase = cycleDay;
  } else if (cycleDay < ovuDay - 1) {
    phase = 'follicular'; dayInPhase = cycleDay - periodLen;
  } else if (cycleDay <= ovuDay + 1) {
    phase = 'ovulatory'; dayInPhase = cycleDay - (ovuDay - 1);
  } else {
    phase = 'luteal'; dayInPhase = cycleDay - (ovuDay + 1);
  }

  const k = Math.floor(diff / cycleLen) + 1;
  const nextPeriodDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k * cycleLen);
  const nextPeriodInDays = Math.round((nextPeriodDate - today) / 86400000);
  const ovulationDate = new Date(nextPeriodDate.getFullYear(), nextPeriodDate.getMonth(), nextPeriodDate.getDate() - 14);

  const advice = (cycleConfig.advice && typeof cycleConfig.advice === 'object') ? cycleConfig.advice : {};
  return {
    cycleDay,
    cycleLength: cycleLen,
    periodLength: periodLen,
    phase,
    phaseName: PHASE_NAMES[phase],
    dayInPhase,
    ovulationDate: fmtDate(ovulationDate),
    nextPeriodDate: fmtDate(nextPeriodDate),
    nextPeriodInDays,
    advice: String(advice[phase] || DEFAULT_ADVICE[phase] || ''),
  };
}

/** 周期统计（ovumcy 式）：从历史月经起始日算周期长度序列/均值/波动 */
export function cycleStats(periods) {
  const dates = (periods ?? []).filter((d) => isValidDateStr(d)).sort();
  if (dates.length < 2) return { cycles: Math.max(0, dates.length - 1), lengths: [], avg: null, range: null };
  const lengths = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.floor((parseLocalDate(dates[i]) - parseLocalDate(dates[i - 1])) / 86400000);
    if (diff >= 15 && diff <= 60) lengths.push(diff); // 生理上合理的区间，其余视为漏记
  }
  const avg = lengths.length ? Math.round(lengths.reduce((s, v) => s + v, 0) / lengths.length) : null;
  const range = lengths.length ? [Math.min(...lengths), Math.max(...lengths)] : null;
  return { cycles: lengths.length, lengths: lengths.slice(-6), avg, range };
}

/** 会话注入段（周期部分；健康模块把它拼进健康块） */
export function renderCycleLine(info) {
  if (!info) return '';
  return `周期：${info.phaseName}（周期第 ${info.cycleDay} 天，下次月经约 ${info.nextPeriodInDays} 天后）。今日基调与任务参考：${String(info.advice ?? '').trim()}`;
}

/** 周期配置写入校验：返回 { ok, patch } 或 { ok: false, error } */
export function validatePatch(patch) {
  const out = {};
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') return { ok: false, error: 'enabled 必须是布尔' };
    out.enabled = patch.enabled;
  }
  if (patch.lastStart !== undefined) {
    if (!isValidDateStr(patch.lastStart)) return { ok: false, error: 'lastStart 必须是合法日期 YYYY-MM-DD' };
    if (parseLocalDate(patch.lastStart) > startOfDay(new Date())) return { ok: false, error: 'lastStart 不能是未来日期' };
    out.lastStart = patch.lastStart;
  }
  if (patch.cycleLength !== undefined) {
    const n = Math.floor(Number(patch.cycleLength));
    if (!Number.isFinite(n) || n < 21 || n > 45) return { ok: false, error: 'cycleLength 取值 21-45' };
    out.cycleLength = n;
  }
  if (patch.periodLength !== undefined) {
    const n = Math.floor(Number(patch.periodLength));
    if (!Number.isFinite(n) || n < 2 || n > 10) return { ok: false, error: 'periodLength 取值 2-10' };
    out.periodLength = n;
  }
  if (patch.advice !== undefined) {
    if (typeof patch.advice !== 'object' || patch.advice === null) return { ok: false, error: 'advice 必须是对象' };
    const clean = {};
    for (const key of PHASE_KEYS) {
      if (patch.advice[key] !== undefined) {
        const text = String(patch.advice[key] ?? '').trim();
        if (!text) return { ok: false, error: `${key} 的建议不能为空` };
        clean[key] = text.slice(0, 600);
      }
    }
    if (Object.keys(clean).length) out.advice = clean;
  }
  return { ok: true, patch: out };
}

// 供测试与 health.js 复用的日期判定
export { isValidDateStr as isValidDate };
