# dsh-peak-switch

DeepSeek Harness 插件：把 **DeepSeek 官方的峰谷定价**接进 QQ 机器人。装上以后，DSH 设置页里多一个 **峰谷回复** 页签——高峰时段可以选择「只在谷时回」，或者放行私聊 / @ 叫名字这类真要紧的消息。

> 峰谷规则不是写死的：插件每 24 小时从 DeepSeek 官方价格页重新解析一次，官方调价就自动跟上。
> 抓不到页面时**保留旧规则**并把失败原因显示出来，绝不静默改成空。

## 功能

- 当前时段判定：高峰 / 空闲，距离下次切换还有多久
- 回复策略二选一：**全天回复** / **只在谷时回复**
- 峰时放行规则：私聊、@ 或叫名字、普通闲聊（概率唤醒）
- 峰谷数据自动更新（默认 24 小时一次），也可手动「立即更新」
- 节假日日历覆盖提示（法定节假日全天空闲）

## 时段规则

默认按 **北京时间** 计算（UTC+8，不受本机时区影响）：

| 时段 | 时间 |
|---|---|
| 高峰 | 周一至周五 09:00–12:00、14:00–18:00 |
| 空闲 | 其余全部时段（含周末、法定节假日全天） |

空闲价约为高峰价的 **一半**。

判定逻辑集中在 `lib/peak.mjs`，是唯一事实来源；`lib/refresh.mjs` 只负责从官方页面刷新数据。

## 安装

```bash
dsh plugin --profile web add https://github.com/fuyu-technology/dsh-peak-switch
```

或本地开发安装：

```bash
dsh plugin --profile web add link:/path/to/dsh-peak-switch
```

装完重启 DSH，入口在：**DSH → 左下角账号菜单 → 设置 → 左侧导航「峰谷回复」**。

## 与 QQ 桥接的关系

插件只负责**判定与配置**，不直接连 QQ。

- 设置与规则存在 `~/.dsh/storages/dsh-peak-switch/` 下（`settings.json` / `policy.json`）
- `qq-bridge` 读同一份文件，决定峰时要不要放行唤醒

所以设置页和桥接看到的永远是同一份状态。

## API

宿主侧注册在 DSH 的 webServer 上，前缀 `/dsh-peak-switch`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-peak-switch/state` | 当前时段、策略与规则数据 |
| POST | `/dsh-peak-switch/settings` | 修改回复策略与放行规则 |
| POST | `/dsh-peak-switch/refresh` | 立即从官方页面刷新规则 |

## 数据来源

- DeepSeek 官方价格页：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>

## 许可

MIT · 蝠羽科技











































