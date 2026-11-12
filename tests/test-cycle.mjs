// 周期+健康纯逻辑单测：node tests/test-cycle.mjs
import assert from 'node:assert';
import * as C from '../lib/cycle.js';
import * as H from '../lib/health.js';

// ---------- 周期阶段边界（28 天周期、5 天经期） ----------
const cfg28 = { enabled: true, lastStart: '2026-11-01', cycleLength: 28, periodLength: 5, advice: {} };
// 排卵日 = 28-14 = 14；经期 1-5；卵泡 6-12；排卵窗 13-15；黄体 16-28
const mk = (d) => new Date(2026, 10, d, 12); // 本地正午，避免时区边界
assert.strictEqual(C.phaseInfo(cfg28, mk(1)).phase, 'menstrual');
assert.strictEqual(C.phaseInfo(cfg28, mk(5)).phase, 'menstrual');
assert.strictEqual(C.phaseInfo(cfg28, mk(6)).phase, 'follicular');
assert.strictEqual(C.phaseInfo(cfg28, mk(12)).phase, 'follicular');
assert.strictEqual(C.phaseInfo(cfg28, mk(13)).phase, 'ovulatory');
assert.strictEqual(C.phaseInfo(cfg28, mk(15)).phase, 'ovulatory');
assert.strictEqual(C.phaseInfo(cfg28, mk(16)).phase, 'luteal');
assert.strictEqual(C.phaseInfo(cfg28, mk(28)).phase, 'luteal');
const p14 = C.phaseInfo(cfg28, mk(14));
assert.strictEqual(p14.cycleDay, 14, '11-14 是周期第 14 天');
assert.strictEqual(p14.nextPeriodInDays, 15, '下次月经 11-29，还有 15 天');
assert.strictEqual(p14.nextPeriodDate, '2026-11-29');

// 跨周期回绕：12-01 等于周期第 31 天 → (30 % 28) + 1 = 第 3 天 → 月经期
const wrap = C.phaseInfo(cfg28, new Date(2026, 11, 1, 12));
assert.strictEqual(wrap.cycleDay, 3, '跨周期回绕');
assert.strictEqual(wrap.phase, 'menstrual');

// 30 天周期：排卵日 16；经期 1-5、卵泡 6-14、排卵窗 15-17、黄体 18-30
const cfg30 = { enabled: true, lastStart: '2026-11-01', cycleLength: 30, periodLength: 5, advice: {} };
assert.strictEqual(C.phaseInfo(cfg30, mk(14)).phase, 'follicular');
assert.strictEqual(C.phaseInfo(cfg30, mk(15)).phase, 'ovulatory');
assert.strictEqual(C.phaseInfo(cfg30, mk(17)).phase, 'ovulatory');
assert.strictEqual(C.phaseInfo(cfg30, mk(18)).phase, 'luteal');

// 关闭/非法输入 → null
assert.strictEqual(C.phaseInfo({ ...cfg28, enabled: false }, mk(10)), null);
assert.strictEqual(C.phaseInfo({ ...cfg28, lastStart: '2026-13-01' }, mk(10)), null);
assert.strictEqual(C.phaseInfo({ ...cfg28, lastStart: '2026-12-31' }, mk(10)), null, '未来日期 → null');
assert.strictEqual(C.phaseInfo({ enabled: true, lastStart: '2026-11-01', cycleLength: 21, periodLength: 10 }, mk(10)), null, '短周期+长经期（估算失义）→ null');

// 建议文本：自定义覆盖默认
const cfgAdv = { ...cfg28, advice: { menstrual: '多喝热水早点睡' } };
assert.strictEqual(C.phaseInfo(cfgAdv, mk(2)).advice, '多喝热水早点睡');
assert.strictEqual(C.phaseInfo(cfg28, mk(7)).advice, C.DEFAULT_ADVICE.follicular, '未自定义用默认');
assert.ok(C.renderCycleLine(C.phaseInfo(cfg28, mk(14))).includes('排卵期'), '周期行渲染');

// validatePatch
assert.strictEqual(C.validatePatch({ enabled: 'yes' }).ok, false);
assert.strictEqual(C.validatePatch({ lastStart: '2026-02-30' }).ok, false);
assert.strictEqual(C.validatePatch({ cycleLength: 50 }).ok, false);
const okPatch = C.validatePatch({ enabled: true, lastStart: '2026-11-01', advice: { luteal: '别催' } });
assert.ok(okPatch.ok && okPatch.patch.advice.luteal === '别催', '合法 patch 通过');

// ---------- 健康日志 ----------
const e1 = H.validateLog({ sleepHours: 6.5, sleepQuality: 3, mood: 4, exercise: '跑步30分钟', notes: '有点累' });
assert.ok(e1.ok && e1.entry.sleepHours === 6.5 && e1.entry.date === H.validateLog(e1.entry).entry.date, '日志校验+默认今天');
assert.strictEqual(H.validateLog({}).ok, false, '空日志拒绝');
assert.strictEqual(H.validateLog({ sleepHours: 30 }).ok, false, '睡眠越界拒绝');
assert.strictEqual(H.validateLog({ mood: 9 }).ok, false, '情绪越界拒绝');
assert.strictEqual(H.validateLog({ date: '11月8日', notes: 'x' }).ok, false, '日期格式拒绝');

// 汇总：构造近 7 天数据（用相对日期，避免测试过期）
function dstr(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const p = (m) => String(m).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const logs = [
  { id: 'a', date: dstr(0), sleepHours: 6, mood: 3, exercise: '步行', createdAt: dstr(0) },
  { id: 'b', date: dstr(1), sleepHours: 6.5, mood: 4, createdAt: dstr(1) },
  { id: 'c', date: dstr(2), sleepHours: 7, createdAt: dstr(2) },
  { id: 'd', date: dstr(20), sleepHours: 12, mood: 5, exercise: '马拉松', createdAt: dstr(20) }, // 7 天窗口外
];
const s = H.summarizeLogs(logs, 7);
assert.strictEqual(s.total, 3, '窗口外不计入');
assert.strictEqual(s.sleepAvg, 6.5, '睡眠均值');
assert.strictEqual(s.exerciseCount, 1, '运动次数');
assert.strictEqual(s.moodAvg, 3.5, '情绪均值');
assert.strictEqual(s.latest.date, dstr(0), '最新一条');
assert.ok(s.latest.notes === '' && s.latest.exercise === '步行', 'latest 带运动字段');

// 注入渲染
const inj = H.renderInjection(s, C.phaseInfo(cfg28, mk(14)), { sleepTarget: 7.5, exerciseWeekly: 3 });
assert.ok(inj.includes('健康关注') && inj.includes('平均 6.5h') && inj.includes('低于目标'), '健康段渲染+低于目标提示');
assert.ok(inj.includes('周期关怀') && inj.includes('排卵期'), '周期段渲染');
const injNoCycle = H.renderInjection(s, null, {});
assert.ok(injNoCycle.includes('健康关注') && !injNoCycle.includes('周期关怀'), '未启用周期 → 只渲染健康段');

// ---------- 每日序列与健康评分 ----------
const series = H.dailySeries(logs, 7);
assert.strictEqual(series.length, 7, '序列 7 天');
assert.strictEqual(series[6].date, dstr(0), '最后一天是今天');
assert.strictEqual(series[6].sleepHours, 6, '今天取到日志');
assert.strictEqual(series[6].exercise, true, '今天有运动');
assert.strictEqual(series[5].sleepHours, 6.5, '昨天取到日志');
const noLogDay = series.find((d) => d.date === dstr(3));
assert.strictEqual(noLogDay.sleepHours, null, '缺数据日期补 null');
const sameDayTwice = H.dailySeries([{ date: dstr(0), sleepHours: 5 }, { date: dstr(0), sleepHours: 9 }], 7);
assert.strictEqual(sameDayTwice[6].sleepHours, 9, '同日多条取后写的');

const score = H.scoreHealth(H.summarizeLogs(logs, 7), { sleepTarget: 7.5, exerciseWeekly: 3 });
assert.ok(score && score.overall >= 0 && score.overall <= 100, '评分在 0-100');
assert.ok(['状态在线', '不错', '还行', '需要注意'].includes(score.label), '评分有标签');
assert.ok(score.parts.some((p) => p.key === 'sleep'), '睡眠项参与评分');
assert.strictEqual(H.scoreHealth({}, {}), null, '无数据 → null');
const scoreNoHabit = H.scoreHealth(H.summarizeLogs(logs, 7), {});
assert.ok(scoreNoHabit.parts.every((p) => p.key !== 'exercise'), '未设运动目标 → 运动项不参与');

// ---------- 多体征：校验 / 序列 / 瓷砖 ----------
const vLog = H.validateLog({ weight: 62.35, bpSystolic: 128, bpDiastolic: 82, pulse: 72 });
assert.ok(vLog.ok && vLog.entry.weight === 62.4 && vLog.entry.bpSystolic === 128 && vLog.entry.pulse === 72, '体征字段校验+舍入');
assert.strictEqual(H.validateLog({ weight: 500 }).ok, false, '体重越界拒绝');
assert.strictEqual(H.validateLog({ bpSystolic: 99, bpDiastolic: 999 }).ok, false, '舒张压越界拒绝');
const vitalSeries = H.dailySeries([{ date: dstr(0), weight: 62.4, bpSystolic: 134, bpDiastolic: 82, pulse: 72 }], 7);
assert.strictEqual(vitalSeries[6].weight, 62.4, '序列带体重');
assert.strictEqual(H.bpStatus(120, 78), 'green');
assert.strictEqual(H.bpStatus(134, 82), 'orange');
assert.strictEqual(H.bpStatus(145, 95), 'red');
assert.strictEqual(H.pulseStatus(72), 'green');
assert.strictEqual(H.pulseStatus(120), 'red');
const tiles = H.metricTiles(vitalSeries, {});
const bpTile = tiles.find((t) => t.key === 'bp');
assert.strictEqual(bpTile.value, '134/82', '血压合并显示');
assert.strictEqual(bpTile.status, 'orange', '134/82 → 偏高');
const wTile = tiles.find((t) => t.key === 'weight');
assert.ok(wTile.value === '62.4' && wTile.dir === '→', '体重最新值+趋势');
const pulseTile = tiles.find((t) => t.key === 'pulse');
assert.strictEqual(pulseTile.status, 'green', '心率正常');

// ---- 基础资料：校验 / 完整性 / BMI / 注入 ----
const okProfile = H.validateProfile({ heightCm: 168.4, birthYear: 1998, sex: 'female' });
assert.ok(okProfile.ok && okProfile.patch.heightCm === 168.4 && okProfile.patch.birthYear === 1998, '基础资料合法通过');
assert.strictEqual(H.validateProfile({ heightCm: 99 }).ok, false, '身高越界拒绝');
assert.strictEqual(H.validateProfile({ heightCm: 231 }).ok, false, '身高越界拒绝');
assert.strictEqual(H.validateProfile({ birthYear: 1800 }).ok, false, '出生年越界拒绝');
assert.strictEqual(H.validateProfile({ birthYear: 2100 }).ok, false, '未来出生年拒绝');
assert.strictEqual(H.validateProfile({ sex: 'other' }).ok, false, '性别枚举拒绝');
assert.ok(H.validateProfile({ heightCm: null, sex: '' }).ok, '清除字段允许');
assert.strictEqual(H.validateProfile({}).ok, false, '空 patch 拒绝');
const pFull = { heightCm: 168, birthYear: 1998, sex: 'female' };
assert.strictEqual(H.profileComplete(pFull), true, '资料完整');
assert.strictEqual(H.profileComplete({ heightCm: 168, birthYear: null, sex: '' }), false, '资料不完整');
assert.strictEqual(H.profileAge(pFull), new Date().getFullYear() - 1998, '年龄按年份估算');
assert.strictEqual(H.bmiOf(168, 62.4), 22.1, 'BMI 计算一位小数');
assert.strictEqual(H.bmiOf(null, 62.4), null, '缺身高 BMI 为空');
assert.strictEqual(H.bmiOf(168, null), null, '缺体重 BMI 为空');
assert.strictEqual(H.bmiStatus(22.1), 'green');
assert.strictEqual(H.bmiStatus(17.9), 'orange');
assert.strictEqual(H.bmiStatus(25), 'orange');
assert.strictEqual(H.bmiStatus(29), 'red');
const bmiTiles = H.metricTiles(vitalSeries, {}, pFull);
assert.strictEqual(bmiTiles.find((t) => t.key === 'weight').bmi, 22.1, '体重瓷砖带 BMI');
const noBmiTiles = H.metricTiles(vitalSeries, {}, {});
assert.strictEqual(noBmiTiles.find((t) => t.key === 'weight').bmi, null, '无资料 BMI 为空');
const injProfile = H.renderInjection(H.summarizeLogs([{ date: dstr(0), sleepHours: 7, mood: 4 }], 7), null, {}, pFull);
assert.ok(injProfile.includes('身高 168cm') && injProfile.includes('女性'), '注入带基础资料');
const def = H.defaultHealth();
assert.strictEqual(def.profile.heightCm, null, '默认资料为空');
assert.strictEqual(H.profileComplete(def.profile), false, '默认资料不完整');

console.log('all cycle/health tests passed ✓');
