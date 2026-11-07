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

// dsh-peak-switch —— 客户端：设置页里的「峰谷回复」配置。
//
// 注册到 settings.section，展示：
//   - 当前是高峰还是空闲时段、距离切换还剩多久
//   - 回复策略切换：全天回复 / 只在谷时回复
//   - 峰时放行规则（私聊、@ 叫名字、普通概率唤醒）
//   - 峰谷数据来源与上次自动更新时间，可手动“立即更新”

window.__ModuleLoader__.load({
  id: 'dsh-peak-switch',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const API = '/dsh-peak-switch'

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '760px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l2, #333)',
        borderRadius: '10px',
        padding: '16px 18px',
        background: 'var(--dsw-alias-bg-l1, transparent)'
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '10px 0' },
      label: { fontSize: '14px', fontWeight: 500 },
      hint: { fontSize: '12px', opacity: 0.65, marginTop: '3px', lineHeight: 1.5 },
      badge: { fontSize: '12px', padding: '3px 10px', borderRadius: '999px', fontWeight: 600 },
      peak: { background: 'rgba(255,90,90,.16)', color: '#ff6b6b', border: '1px solid rgba(255,90,90,.35)' },
      offPeak: { background: 'rgba(90,220,140,.16)', color: '#3ddc84', border: '1px solid rgba(90,220,140,.35)' },
      btn: {
        fontSize: '13px', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l3, #555)',
        background: 'var(--dsw-alias-button-floating-fill, transparent)',
        color: 'inherit'
      },
      btnPrimary: {
        fontSize: '13px', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer',
        border: '1px solid transparent', background: 'var(--dsw-alias-button-primary-fill, #4a6cf7)', color: '#fff'
      },
      seg: { display: 'flex', gap: '8px' },
      segBtn: (active) => ({
        fontSize: '13px', padding: '8px 16px', borderRadius: '7px', cursor: 'pointer',
        border: active ? '1px solid #4a6cf7' : '1px solid var(--dsw-alias-border-l2, #333)',
        background: active ? 'rgba(74,108,247,.16)' : 'transparent',
        color: 'inherit', fontWeight: active ? 600 : 400
      }),
      err: { fontSize: '12px', color: '#ff6b6b', marginTop: '6px' },
      ok: { fontSize: '12px', color: '#3ddc84', marginTop: '6px' }
    }

    function fmtDuration(ms) {
      if (ms == null) return '—'
      const totalMin = Math.floor(ms / 60000)
      const hours = Math.floor(totalMin / 60)
      const mins = totalMin % 60
      if (hours > 0) return `${hours} 小时 ${mins} 分`
      return `${mins} 分钟`
    }

    function peakWindowText(windows) {
      if (!Array.isArray(windows) || !windows.length) return '未知'
      return windows
        .map(([s, e]) => {
          const f = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
          return `${f(s)}-${f(e)}`
        })
        .join('、')
    }

    function PeakSection() {
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState(null)
      const [error, setError] = useState(null)

      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}/state`, { credentials: 'same-origin' })
          const body = await res.json()
          if (body.ok) setState(body)
          else setError(body.error || '读取失败')
        } catch (e) {
          setError(e?.message || String(e))
        }
      }, [])

      useEffect(() => {
        load()
        const t = setInterval(load, 30000)
        return () => clearInterval(t)
      }, [load])

      const patch = useCallback(async (body) => {
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          const res = await fetch(`${API}/settings`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
          const out = await res.json()
          if (out.ok) {
            setState((prev) => (prev ? { ...prev, settings: out.settings } : prev))
            setMessage('已保存')
            setTimeout(() => setMessage(null), 2000)
            await load()
          } else setError(out.error || '保存失败')
        } catch (e) {
          setError(e?.message || String(e))
        } finally {
          setBusy(false)
        }
      }, [load])

      const refresh = useCallback(async () => {
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          const res = await fetch(`${API}/refresh`, { method: 'POST', credentials: 'same-origin' })
          const out = await res.json()
          if (out.ok) {
            setMessage(out.skipped ? '数据仍是最新的' : '峰谷数据已更新')
            setTimeout(() => setMessage(null), 3000)
            await load()
          } else setError(out.error || '更新失败')
        } catch (e) {
          setError(e?.message || String(e))
        } finally {
          setBusy(false)
        }
      }, [load])

      if (!state) {
        return h('div', { style: styles.wrap }, h('div', { style: styles.hint }, error ? `加载失败：${error}` : '正在加载…'))
      }

      const { settings, status, policy } = state
      const isPeak = status.period === 'peak'
      const badgeStyle = isPeak ? { ...styles.badge, ...styles.peak } : { ...styles.badge, ...styles.offPeak }

      return h('div', { style: styles.wrap }, [
        // ── 当前时段 ──
        h('div', { key: 'status', style: styles.card }, [
          h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
            h('div', { key: 't', style: { fontSize: '15px', fontWeight: 600 } }, 'DeepSeek 峰谷时段'),
            h('span', { key: 'b', style: badgeStyle }, status.label)
          ]),
          h('div', { key: 'd', style: styles.hint }, [
            `当前北京时间 ${status.beijingTime}；`,
            status.nextSwitchInMs != null ? `距离切换还有 ${fmtDuration(status.nextSwitchInMs)}` : '暂无切换',
            `。高峰时段：${peakWindowText(status.peakWindows)}（周一至周五，不含法定节假日；周末全天空闲）。`
          ]),
          !status.calendarCovered
            ? h('div', { key: 'w', style: styles.err }, '⚠️ 节假日日历未覆盖当前年份，节假日可能被误判为工作日。')
            : null
        ].filter(Boolean)),

        // ── 回复策略 ──
        h('div', { key: 'mode', style: styles.card }, [
          h('div', { key: 'l', style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, '回复策略'),
          h('div', { key: 'h2', style: styles.hint }, '控制 QQ 侧是否在高峰时段回消息。桌面 DSH 不受影响。'),
          h('div', { key: 's', style: { ...styles.seg, marginTop: '12px' } }, [
            h('button', {
              key: 'all',
              style: styles.segBtn(settings.mode === 'all-day'),
              disabled: busy,
              onClick: () => patch({ mode: 'all-day' })
            }, '全天回复'),
            h('button', {
              key: 'off',
              style: styles.segBtn(settings.mode === 'off-peak'),
              disabled: busy,
              onClick: () => patch({ mode: 'off-peak' })
            }, '只在谷时回复')
          ]),
          h('div', { key: 'd2', style: styles.hint }, settings.mode === 'off-peak'
            ? '已开启：高峰时段只有下面勾选的「重要消息」会叫醒它，普通闲聊攒到谷时再处理。'
            : '已关闭：任何时段收到消息都可能回复，成本不受时段影响。')
        ]),

        // ── 峰时放行规则 ──
        settings.mode === 'off-peak'
          ? h('div', { key: 'allow', style: styles.card }, [
            h('div', { key: 'l', style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } }, '峰时仍要回应的'),
            h('div', { key: 'h', style: styles.hint }, '没勾选的在高峰时段不会叫醒它。'),
            ...[
              ['peakAllowPrivate', '私聊', '有人直接私聊找它，通常是有事'],
              ['peakAllowMention', '@ 或叫名字', '群里明确点名，不回显得失礼'],
              ['peakAllowProbability', '普通闲聊（概率唤醒）', '开了会让峰时成本接近全天回复']
            ].map(([k, title, desc]) =>
              h('div', { key: k, style: styles.row }, [
                h('div', { key: 't' }, [
                  h('div', { key: 'n', style: styles.label }, title),
                  h('div', { key: 'd', style: styles.hint }, desc)
                ]),
                h('input', {
                  key: 'c',
                  type: 'checkbox',
                  checked: !!settings[k],
                  disabled: busy,
                  style: { width: '18px', height: '18px', cursor: 'pointer' },
                  onChange: (e) => patch({ [k]: e.target.checked })
                })
              ])
            )
          ].filter(Boolean))
          : null,

        // ── 数据自动更新 ──
        h('div', { key: 'data', style: styles.card }, [
          h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
            h('div', { key: 't', style: { fontSize: '15px', fontWeight: 600 } }, '峰谷数据'),
            h('button', { key: 'b', style: styles.btn, disabled: busy, onClick: refresh }, busy ? '更新中…' : '立即更新')
          ]),
          h('div', { key: 'src', style: styles.hint }, [
            '数据来源：DeepSeek 官方价格页。',
            h('br', { key: 'br' }),
            `已识别高峰时段：${peakWindowText(policy.peakWindows)}`
          ]),
          h('div', { key: 'times', style: styles.hint }, [
            `上次检查：${policy.lastCheckAt ? new Date(policy.lastCheckAt).toLocaleString('zh-CN') : '从未'}`,
            policy.updatedAt ? `；规则更新于 ${new Date(policy.updatedAt).toLocaleString('zh-CN')}` : '；当前用内置默认规则'
          ]),
          h('div', { key: 'auto', style: styles.row }, [
            h('div', { key: 't' }, [
              h('div', { key: 'n', style: styles.label }, '自动更新'),
              h('div', { key: 'd', style: styles.hint }, '每 24 小时从官方页面重新解析一次，官方调价后自动跟上')
            ]),
            h('input', {
              key: 'c', type: 'checkbox', checked: !!settings.autoRefresh, disabled: busy,
              style: { width: '18px', height: '18px', cursor: 'pointer' },
              onChange: (e) => patch({ autoRefresh: e.target.checked })
            })
          ]),
          policy.lastError ? h('div', { key: 'e', style: styles.err }, `上次更新失败：${policy.lastError}（仍在使用旧数据）`) : null
        ]),

        message ? h('div', { key: 'msg', style: styles.ok }, message) : null,
        error ? h('div', { key: 'err', style: styles.err }, error) : null
      ].filter(Boolean))
    }

    // DSH 客户端插件契约：
    //   factory 必须返回一个带 `apply` 的对象；
    //   `inject: ['slots']` 声明依赖客户端插槽服务 —— 少了它，fiber 会在 boot
    //   早期就执行 apply，那时 slots 服务还不存在，访问 ctx.slots 直接抛错，
    //   整个 web boot 会以 "1 entry did not activate" 失败。
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'peak-switch',
        order: 20,
        label: '峰谷回复'
      }, PeakSection))
    }

    return { inject: ['slots'], apply, name: 'dsh-peak-switch' }
  }
})
