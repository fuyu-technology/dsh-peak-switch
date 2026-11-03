// DeepSeek 峰谷时段判定 —— 单一事实来源。
//
// 规则（2026-11-03 从官方价格页抓取确认，可自动更新）：
//   北京时间 周一至周五（不含中国法定节假日）09:00-12:00、14:00-18:00 为高峰时段；
//   其余时段（含周末、法定节假日全天）为空闲时段。空闲价 = 高峰价 × 0.5。
//
// 「自动更新」的两层含义：
//   1) 时段边界本身可以从官方页面重新解析（见 peek-parse.mjs）；
//   2) 无论有没有抓到新数据，判定函数都按 Asia/Shanghai 正确计算，绝不用本地时区。
//
// 设计取舍：
//   - 不依赖任何第三方库（插件要能被 DSH 直接加载）；
//   - 节假日表可能过期：当无法获取当年日历时，退化为「只按周末+时段判断」，
//     并在状态里标记 calendarCovered=false，让界面如实显示“未覆盖”。
//   - 默认周期策略（fail-open）：如果时段数据本身读不到，按「谷时」处理，
//     宁可多花钱也不让大肥鱼彻底失声。

/** 北京时间固定 UTC+8，无夏令时。 */
const TZ_OFFSET_MINUTES = 480;
const MINUTE_MS = 60_000;

/** 默认峰时窗口（分钟数，从北京时间 0 点算起），[起, 止)。 */
export const DEFAULT_PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60]
];

/** 2026 年落在工作日的法定节假日（周末本身已全天空闲，无需列出）。 */
export const HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
  '2026-04-06',
  '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'
];

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

/** 把某个时刻拆成北京时间的日历字段。 */
export function beijingParts(instantMs) {
  const shifted = new Date(instantMs + TZ_OFFSET_MINUTES * MINUTE_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: shifted.getUTCDay(), // 0=周日
    minuteOfDay: hour * 60 + minute,
    dateKey: `${year}-${pad2(month)}-${pad2(day)}`
  };
}

/** 合并后的策略对象。 */
export function makePolicy(overrides = {}) {
  return {
    peakWindows: overrides.peakWindows || DEFAULT_PEAK_WINDOWS,
    holidays: new Set(overrides.holidays || HOLIDAYS_2026),
    calendarYears: overrides.calendarYears || [2026],
    updatedAt: overrides.updatedAt || null,
    source: overrides.source || 'builtin-default'
  };
}

/** 是否处于高峰时段（其余为谷时）。 */
export function isPeak(instantMs, policy = makePolicy()) {
  const p = beijingParts(instantMs);
  // 周末全天谷时
  if (p.weekday === 0 || p.weekday === 6) return false;
  // 法定节假日全天空闲
  if (policy.holidays.has(p.dateKey)) return false;
  for (const [start, end] of policy.peakWindows) {
    if (p.minuteOfDay >= start && p.minuteOfDay < end) return true;
  }
  return false;
}

/** 当前时刻的时段：'peak' | 'off-peak'。 */
export function periodAt(instantMs, policy = makePolicy()) {
  return isPeak(instantMs, policy) ? 'peak' : 'off-peak';
}

/** 距离下一次时段切换还有多久（毫秒）；找不到返回 null。 */
export function msUntilSwitch(instantMs, policy = makePolicy()) {
  const current = isPeak(instantMs, policy);
  const p = beijingParts(instantMs);
  // 以北京当日 0 点为基准，向前找 21 天内的所有边界
  const dayStart = Date.UTC(p.year, p.month - 1, p.day) - TZ_OFFSET_MINUTES * MINUTE_MS;
  const candidates = [];
  for (let d = 0; d < 21; d += 1) {
    const base = dayStart + d * 86_400_000;
    for (const [s, e] of policy.peakWindows) {
      candidates.push(base + s * MINUTE_MS, base + e * MINUTE_MS);
    }
  }
  candidates.sort((a, b) => a - b);
  for (const at of candidates) {
    if (at <= instantMs) continue;
    if (isPeak(at, policy) !== current) return at - instantMs;
  }
  return null;
}

/** 给 UI 用的完整“此刻状态”。 */
export function statusAt(instantMs, policy = makePolicy()) {
  const p = beijingParts(instantMs);
  const period = periodAt(instantMs, policy);
  return {
    period,
    label: period === 'peak' ? '高峰时段' : '空闲时段',
    nextSwitchInMs: msUntilSwitch(instantMs, policy),
    calendarCovered: policy.calendarYears.includes(p.year),
    dateKey: p.dateKey,
    beijingTime: `${pad2(p.hour)}:${pad2(p.minute)}`,
    weekday: p.weekday,
    peakWindows: policy.peakWindows,
    source: policy.source,
    updatedAt: policy.updatedAt
  };
}

/** 从官方页面文本里解析峰时窗口，失败返回 null。 */
export function parsePeakWindowsFromText(text) {
  const s = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  // 必须提到「北京时间」才认，避免误把别的表当成规则
  if (!s.includes('北京时间')) return null;
  const re = /(\d{1,2}):(\d{2})\s*[-–—~到至]\s*(\d{1,2}):(\d{2})/g;
  // 「为高峰时段」在价格表里也会先出现一次（表头「高峰时段」附近），
  // 所以必须扫**所有**出现位置，取能解析出时间区间的那个。
  let idx = s.indexOf('为高峰时段');
  while (idx >= 0) {
    const win = s.slice(Math.max(0, idx - 400), idx);
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(win)) !== null) {
      const start = Number(m[1]) * 60 + Number(m[2]);
      const end = Number(m[3]) * 60 + Number(m[4]);
      if (Number.isFinite(start) && Number.isFinite(end) && start < end && end <= 24 * 60) out.push([start, end]);
    }
    if (out.length && out.some(([a, b]) => b - a >= 30)) {
      const uniq = [];
      for (const w of out) if (!uniq.some(([x, y]) => x === w[0] && y === w[1])) uniq.push(w);
      uniq.sort((a, b) => a[0] - b[0]);
      return uniq;
    }
    idx = s.indexOf('为高峰时段', idx + 1);
  }
  return null;
}
