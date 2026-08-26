# DSH DeepSeek Monitor

[English](./README_EN.md) | 简体中文

[![npm version](https://img.shields.io/npm/v/dsh-deepseek-monitor)](https://www.npmjs.com/package/dsh-deepseek-monitor)
[![npm downloads](https://img.shields.io/npm/dm/dsh-deepseek-monitor)](https://www.npmjs.com/package/dsh-deepseek-monitor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript 5.6](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![dsh plugin · web](https://img.shields.io/badge/dsh--plugin-web-4D6BFE)](https://github.com/DeepSeek-ai/DeepSeek-Harness)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

DeepSeek Harness（dsh）Web 插件：把 [DeepSeekMonitorWindows](https://github.com/HaoyueQin/DeepSeekMonitorWindows) 的**余额与用量监控**能力移植进 dsh —— 集成到「设置 → 模型 → DeepSeek」供应商卡片内，并在输入框工具行（模型名称左侧）显示实时余额。

![账户明细面板预览](docs/images/account-details-panel.png)

> 截图：设置 → 模型 → DeepSeek 卡片展开的「账户明细」面板（余额卡 / 模型用量行 / 每日堆叠柱状图），以及名称旁的余额 chip 与「账户明细」按钮。

## 功能特性

### 设置 · 模型 · DeepSeek 行内增强

- **「账户明细」按钮**：位于「编辑」左侧，克隆宿主按钮样式，视觉完全一致
- **余额 chip**：模型名称旁实时显示余额（按币种渲染符号，如 ¥/$），低于阈值变红
- **展开面板**（点击按钮在卡片容器内展开）：
  - **账户余额**：官方 `GET /user/balance` API，复用 dsh 已配置的密钥；今日消耗 / 本月费用 mini 格（按账户币种渲染，无余额快照时回退 ¥）；低余额警示
  - **模型用量行**：固定顺序 Flash → Vision → Pro，平台全称显示、lucide SVG 图标（闪电 / 照片 / 大脑）、独立柔和配色（天蓝 / 雾紫 / 品牌蓝）、进度条 + 缓存命中率 + 费用，行高恒定
  - **每日堆叠柱状图**：DSM 原版配色（命中绿 / 未命中橙 / 输出紫），月份切换，稀疏日期标注保证不重叠，自绘悬浮卡（悬停查看明细）
  - **平台 Token 配置**：双通道获取——①一键复制控制台抓取脚本（登录平台页粘贴回车即捕获）；②手动 F12 粘贴。保存前先经平台接口验活，凭据只写不读回
  - **设置**：输入框余额显示开关、自动刷新开关与间隔（≥60s）、低余额提醒与阈值、重载缓存 / 清除缓存

### 输入框工具行余额项

- 挂载于官方 `conversation.input.right` 槽位，渲染在**模型名称左侧、发送键之前**，与模型选择等控件同排版（28px 行高 / 13px 字号 / medium 字重）
- 仅当当前会话最近一次路由的**供应商**为内置官方 DeepSeek 供应商（设置→模型列表固定第一位，provider 路由 id 为 `deepseek-official`）时显示，与模型名称无关（第三方供应商即使提供 `deepseek-*` 命名的模型也不显示）；新会话首屏（无会话）自动隐藏
- 可在「账户明细 → 设置」卡片通过**开关**随时打开 / 关闭该余额显示，保存后输入框立即响应
- 配色策略：币种符号保持默认灰色；余额数字 **> 0 显示绿色**（`state-success-primary`）、**≤ 0 显示红色**（`state-error-primary`）
- 余额 chip 固定每 60 秒轮询一次宿主缓存；展开面板按设置的刷新间隔轮询；上游 API 的实际刷新节奏由设置中的自动刷新间隔统一驱动（≥60s，仅宿主侧定时器会请求上游）

## 数据与安全

- API Key 通过 dsh 凭据缝每次操作现解析，插件不存储、不上屏、不入日志
- 平台 Token 经自有 fenced 路由写入 dsh 凭据缝（write-only），任何接口不回显
- 全部路由位于浏览器信任围栏之后（loopback / trustedHosts，拒绝跨站）
- 抓取脚本纯本地运行于平台页自身上下文，不向任何第三方发送数据
- 偏好与缓存持久化于 storage-domain `deepseek_monitor`

## 安装

```sh
dsh plugin --profile <name> add dsh-deepseek-monitor@latest
```

> 已在 npm 发布：[dsh-deepseek-monitor](https://www.npmjs.com/package/dsh-deepseek-monitor)。也可以从 [GitHub Releases](https://github.com/HaoyueQin/dsh-deepseek-monitor/releases) 下载 `dsh-deepseek-monitor-<version>.tgz`，通过本地 profile / 注入器方式装载。

## 开发

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # tsc declarations + tsdown (host ESM + 双通道 client bundle)
pnpm watch       # tsdown --watch
```

GUI 取证脚本（无头浏览器验证面板挂载与样式）：`node scripts/probe-gui.mjs`

## 致谢

本插件的余额 / 平台用量后端与面板结构，移植自作者自己的 [HaoyueQin/DeepSeekMonitorWindows](https://github.com/HaoyueQin/DeepSeekMonitorWindows)（Windows 桌面版）；移植所依据的实现沿其自述谱系继续向上追溯：

| 项目 | 关系 | 许可证 |
| --- | --- | --- |
| [HaoyueQin/DeepSeekMonitorWindows](https://github.com/HaoyueQin/DeepSeekMonitorWindows) | **直接移植来源**：`do_fetch_balance` / `do_fetch_usage` / token 口径与仪表盘结构的 TypeScript 移植底本 | MIT |
| [Joyi-code/DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows) | 上述桌面版的**直接上游**（Windows Tauri 2 重构），移植逻辑的最终出处 | MIT |
| [JayHome137/DeepSeekMonitor](https://github.com/JayHome137/DeepSeekMonitor) | 谱系起点（macOS 菜单栏 + WidgetKit 版），开创了「DeepSeek 余额与用量监控」这一形态 | MIT |
| [lucide](https://lucide.dev/) | SVG 图标库 | ISC |

本项目基于 [MIT](./LICENSE) 发布，上述 MIT 项目许可声明随分发一并保留。

## License

MIT
