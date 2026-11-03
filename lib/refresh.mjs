// 峰谷数据的自动更新：从 DeepSeek 官方价格页重新解析时段规则。
//
// 设计要点：
//   - **不信任缓存**：每次更新都重新抓官方页面，解析失败就保留旧数据，绝不覆盖成空。
//   - **失败要可见**：抓不到时把原因写进状态文件，设置页能显示“上次更新失败”，
//     而不是静默用一份过期规则。
//   - 更新频率：每 24 小时一次足够（官方调价不是高频事件）；也可在设置页手动触发。
//   - 只在**有变化**时改 updatedAt/source，避免页面每次都被标记成“刚更新过”。

import fs from 'node:fs'
import path from 'node:path'
import { parsePeakWindowsFromText, DEFAULT_PEAK_WINDOWS, HOLIDAYS_2026 } from './peak.mjs'

export const SOURCE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
export const REFRESH_MS = 24 * 60 * 60 * 1000

/** 读当前生效的规则（文件不存在则用内置默认）。 */
export function loadPolicy(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return {
      peakWindows: Array.isArray(raw.peakWindows) && raw.peakWindows.length ? raw.peakWindows : DEFAULT_PEAK_WINDOWS,
      holidays: new Set(raw.holidays || HOLIDAYS_2026),
      calendarYears: raw.calendarYears || [2026],
      updatedAt: raw.updatedAt || null,
      source: raw.source || 'builtin-default',
      lastCheckAt: raw.lastCheckAt || null,
      lastError: raw.lastError || null
    }
  } catch {
    return {
      peakWindows: DEFAULT_PEAK_WINDOWS,
      holidays: new Set(HOLIDAYS_2026),
      calendarYears: [2026],
      updatedAt: null,
      source: 'builtin-default',
      lastCheckAt: null,
      lastError: null
    }
  }
}

/** 原子写入规则文件。 */
export function savePolicy(file, policy) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  const payload = {
    peakWindows: policy.peakWindows,
    holidays: [...policy.holidays],
    calendarYears: policy.calendarYears,
    updatedAt: policy.updatedAt,
    source: policy.source,
    lastCheckAt: policy.lastCheckAt,
    lastError: policy.lastError
  }
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 抓官方页面并重新解析峰时窗口。
 * @returns {ok, peakWindows?, error?, changed?}
 */
export async function refreshFromOfficial(file, { timeoutMs = 20000 } = {}) {
  const before = loadPolicy(file)
  let html
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(SOURCE_URL, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'dsh-peak-switch/0.1 (+local plugin)' }
    }).finally(() => clearTimeout(timer))
    if (!res.ok) {
      return recordFailure(file, before, `官方页面返回 HTTP ${res.status}`)
    }
    html = await res.text()
  } catch (e) {
    return recordFailure(file, before, `抓取失败：${e?.message || e}`)
  }

  const windows = parsePeakWindowsFromText(html)
  if (!windows) {
    return recordFailure(file, before, '页面解析失败：没找到「为高峰时段」附近的时段定义（页面结构可能变了）')
  }

  const changed = JSON.stringify(windows) !== JSON.stringify(before.peakWindows)
  const next = {
    ...before,
    peakWindows: windows,
    source: changed ? `official:${SOURCE_URL}` : before.source,
    updatedAt: changed ? new Date().toISOString() : before.updatedAt,
    lastCheckAt: new Date().toISOString(),
    lastError: null
  }
  savePolicy(file, next)
  return { ok: true, peakWindows: windows, changed }
}

function recordFailure(file, policy, message) {
  const next = {
    ...policy,
    lastCheckAt: new Date().toISOString(),
    lastError: message
  }
  try { savePolicy(file, next) } catch {}
  return { ok: false, error: message, peakWindows: policy.peakWindows }
}

/** 是否到了该自动更新的时间。 */
export function needsRefresh(policy, nowMs = Date.now()) {
  if (!policy.lastCheckAt) return true
  const last = Date.parse(policy.lastCheckAt)
  if (!Number.isFinite(last)) return true
  return nowMs - last >= REFRESH_MS
}
