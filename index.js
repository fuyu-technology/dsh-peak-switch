// dsh-peak-switch
// Copyright 2026 蝠羽科技 (fuyu-technology)  —  https://github.com/fuyu-technology
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// 允许二次修改与再分发，但必须保留上述署名与版权声明，不得删除或改写。
// 详见 LICENSE 与 NOTICE。
//

// dsh-peak-switch
// Copyright 2026 蝠羽科技 (fuyu-technology)  —  https://github.com/fuyu-technology
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// 允许二次修改与再分发，但必须保留上述署名与版权声明，不得删除或改写。
// 详见 LICENSE 与 NOTICE。
//

// dsh-peak-switch —— Host 侧。
//
// 职责：
//   1) 维护「回复策略」：all-day（全天回） / off-peak（只在谷时回）
//   2) 维护峰谷规则数据，并定时从官方价格页自动更新
//   3) 通过 webServer 暴露给设置页（client.js）读写
//
// 策略文件放在 ~/.dsh/storages/dsh-peak-switch/ 下，qq-bridge 会读同一个文件
// 来决定峰时是否放行唤醒 —— 这样设置页和桥接看到的是同一份状态。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { statusAt, makePolicy, parsePeakWindowsFromText } from './lib/peak.mjs'
import { loadPolicy, savePolicy, refreshFromOfficial, needsRefresh, SOURCE_URL, REFRESH_MS } from './lib/refresh.mjs'

export const name = 'dsh-peak-switch'

// cordis 依赖声明：少了它，fiber 执行 apply 时访问 ctx.webServer 会直接抛
// `cannot get property "webServer" without inject`，插件 fiber 变 FAILED。
export const inject = ['webServer']

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STORE_DIR = path.join(DSH_HOME, 'storages', 'dsh-peak-switch')
const POLICY_FILE = path.join(STORE_DIR, 'policy.json')
const SETTINGS_FILE = path.join(STORE_DIR, 'settings.json')

const API_PREFIX = '/dsh-peak-switch'

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, ''))
    return {
      mode: raw.mode === 'off-peak' ? 'off-peak' : 'all-day',
      // 峰时是否放行「私聊」（默认放行：私聊是直接找鱼说话，最需要响应）
      peakAllowPrivate: raw.peakAllowPrivate !== false,
      // 峰时是否放行「@/叫名字」（默认放行）
      peakAllowMention: raw.peakAllowMention !== false,
      // 峰时是否放行「普通概率唤醒」（默认禁止）
      peakAllowProbability: raw.peakAllowProbability === true,
      autoRefresh: raw.autoRefresh !== false,
      updatedAt: raw.updatedAt || null
    }
  } catch {
    return {
      mode: 'all-day',
      peakAllowPrivate: true,
      peakAllowMention: true,
      peakAllowProbability: false,
      autoRefresh: true,
      updatedAt: null
    }
  }
}

function writeSettings(s) {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const next = { ...s, updatedAt: new Date().toISOString() }
  const tmp = SETTINGS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, SETTINGS_FILE)
  return next
}

export function apply(ctx) {
  const webServer = ctx?.webServer

  // 首次启动时确保文件存在，方便 qq-bridge 直接读
  fs.mkdirSync(STORE_DIR, { recursive: true })
  if (!fs.existsSync(SETTINGS_FILE)) writeSettings(readSettings())
  if (!fs.existsSync(POLICY_FILE)) savePolicy(POLICY_FILE, loadPolicy(POLICY_FILE))

  // ── 自动更新峰谷数据 ─────────────────────────────────────────────────────
  let refreshing = false
  async function autoRefresh(force = false) {
    if (refreshing) return { ok: false, error: '正在更新中' }
    const settings = readSettings()
    if (!force && (!settings.autoRefresh || !needsRefresh(loadPolicy(POLICY_FILE)))) {
      return { ok: true, skipped: true }
    }
    refreshing = true
    try {
      return await refreshFromOfficial(POLICY_FILE)
    } finally {
      refreshing = false
    }
  }

  // 启动后延迟 10 秒做第一次检查，避免和 DSH 启动抢资源
  setTimeout(() => { autoRefresh().catch(() => {}) }, 10000)
  const timer = setInterval(() => { autoRefresh().catch(() => {}) }, 60 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => clearInterval(timer))
  }

  if (!webServer || typeof webServer.register !== 'function') {
    // 没有 webServer 也能工作（qq-bridge 直接读文件），只是设置页读不到实时状态
    return
  }

  // ── 设置页用的 API ───────────────────────────────────────────────────────
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_PREFIX)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, error: '未知接口' }))
      return
    }

    const send = (code, body) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    }

    try {
      if (url.pathname === `${API_PREFIX}/state` && req.method === 'GET') {
        const settings = readSettings()
        const policy = loadPolicy(POLICY_FILE)
        const status = statusAt(Date.now(), makePolicy(policy))
        send(200, {
          ok: true,
          settings,
          status: { ...status, sourceUrl: SOURCE_URL, refreshMs: REFRESH_MS },
          policy: {
            peakWindows: policy.peakWindows,
            updatedAt: policy.updatedAt,
            lastCheckAt: policy.lastCheckAt,
            lastError: policy.lastError,
            source: policy.source
          }
        })
        return true
      }

      if (url.pathname === `${API_PREFIX}/settings` && req.method === 'POST') {
        let body = ''
        await new Promise((resolve) => {
          req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy() })
          req.on('end', resolve)
          req.on('error', resolve)
        })
        let patch
        try { patch = JSON.parse(body || '{}') } catch { return send(400, { ok: false, error: '请求体不是合法 JSON' }), true }
        const cur = readSettings()
        const next = writeSettings({
          mode: patch.mode === 'off-peak' || patch.mode === 'all-day' ? patch.mode : cur.mode,
          peakAllowPrivate: typeof patch.peakAllowPrivate === 'boolean' ? patch.peakAllowPrivate : cur.peakAllowPrivate,
          peakAllowMention: typeof patch.peakAllowMention === 'boolean' ? patch.peakAllowMention : cur.peakAllowMention,
          peakAllowProbability: typeof patch.peakAllowProbability === 'boolean' ? patch.peakAllowProbability : cur.peakAllowProbability,
          autoRefresh: typeof patch.autoRefresh === 'boolean' ? patch.autoRefresh : cur.autoRefresh
        })
        send(200, { ok: true, settings: next })
        return true
      }

      if (url.pathname === `${API_PREFIX}/refresh` && req.method === 'POST') {
        const result = await autoRefresh(true)
        send(result.ok ? 200 : 500, result)
        return true
      }

      send(404, { ok: false, error: '未知接口' })
      return true
    } catch (e) {
      send(500, { ok: false, error: e?.message || String(e) })
      return true
    }
  }

  // webServer.register 的契约是 register({kind, path, handler}) 并返回注销函数。
  // 传函数（非 route 对象）会被塞进 prefix 表且 path 为 undefined，路由永远匹配不上。
  const dispose = webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      try { dispose?.() } catch {}
    })
  }
}
