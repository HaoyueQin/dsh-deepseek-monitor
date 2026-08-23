# DSH Deepseek Monitor

English | [简体中文](./README.md)

[![npm version](https://img.shields.io/npm/v/dsh-deepseek-monitor)](https://www.npmjs.com/package/dsh-deepseek-monitor)
[![npm downloads](https://img.shields.io/npm/dm/dsh-deepseek-monitor)](https://www.npmjs.com/package/dsh-deepseek-monitor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript 5.6](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![dsh plugin · web](https://img.shields.io/badge/dsh--plugin-web-4D6BFE)](https://github.com/DeepSeek-ai/DeepSeek-Harness)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

A DeepSeek Harness (dsh) web plugin that ports the **balance & usage monitoring** of [DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows) into dsh — embedded in the "Settings → Models → DeepSeek" provider card, with a live balance item in the conversation stats band.

![Account details panel preview](docs/images/account-details-panel.png)

> Screenshot: the "Account details" panel expanded inside the DeepSeek provider card (balance card / per-model usage rows / daily stacked chart), plus the balance chip and the "Account details" button next to the row name.

## Features

### Inline in Settings · Models · DeepSeek

- **"Account details" button**: sits left of the built-in Edit button, cloned from the host button styling for pixel parity
- **Balance chip**: live balance next to the model name, rendered with the currency's symbol (¥/$/…); turns red below the threshold
- **Expanded panel**:
  - **Account balance**: official `GET /user/balance` API reusing the key already configured in dsh; today / month-to-date mini metrics; low-balance warning
  - **Per-model usage rows**: fixed order Flash → Vision → Pro, full platform ids, lucide SVG icons (bolt / image / brain), per-model soft accents (sky / lavender / brand blue), progress bar + cache-hit rate + cost, constant row height
  - **Daily stacked chart**: DSM's own palette (hit green / miss orange / response purple), month navigation, sparse date labels that never collide, custom styled hover cards
  - **Platform token setup**: two acquisition channels — ① one-click console capture script (paste on the signed-in platform page, token pops up); ② manual paste via DevTools. Verified against the platform API before being stored write-only
  - **Settings**: auto-refresh toggle & interval (≥60s), low-balance alert & threshold, reload / clear cache

### Conversation stats-band balance item

- Mounted on the official `conversation.composer.dock` slot — same line, same typography as turns/steps, latency and cache-hit stats
- Shown only in sessions whose latest route is an official DeepSeek model; appears and disappears with the stats band
- Refresh cadence is driven by the auto-refresh interval configured above

## Data & security

- The API key is resolved per operation through the dsh credentials seam — never stored, echoed or logged by this plugin
- The platform token is written into the credentials seam through our fenced route (write-only); no endpoint returns it
- Every route lives behind the browser trust fence (loopback / trustedHosts; cross-site refused)
- The capture script runs locally inside the platform page's own context and sends nothing anywhere
- Preferences and cache persist in the storage domain `deepseek_monitor`

## Install

```sh
# available once published to npm
dsh plugin --profile <name> add dsh-deepseek-monitor@latest
```

> Not yet on npm. Clone, `pnpm build`, then mount the artifact directory via a local profile / injector.

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # tsc declarations + tsdown (host ESM + dual-channel client bundle)
pnpm watch       # tsdown --watch
```

Headless GUI verification script: `node scripts/probe-gui.mjs`

## Acknowledgements

The balance / platform-usage backend and the dashboard structure were ported from the author's own [HaoyueQin/DeepSeekMonitorWindows](https://github.com/HaoyueQin/DeepSeekMonitorWindows) (the Windows desktop app); the implementation that port follows continues upstream along that repo's own stated lineage:

| Project | Relationship | License |
| --- | --- | --- |
| [HaoyueQin/DeepSeekMonitorWindows](https://github.com/HaoyueQin/DeepSeekMonitorWindows) | **Direct port source**: the TypeScript port base for do_fetch_balance / do_fetch_usage, the token semantics and the dashboard structure | MIT |
| [Joyi-code/DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows) | **Direct upstream** of that desktop app (the Windows Tauri 2 rebuild) — where the ported logic ultimately comes from | MIT |
| [JayHome137/DeepSeekMonitor](https://github.com/JayHome137/DeepSeekMonitor) | Origin of the lineage (macOS menu-bar + WidgetKit), which pioneered DeepSeek balance & usage monitoring | MIT |
| [lucide](https://lucide.dev/) | SVG icon library | ISC |

> Note: the desktop README once misattributed its Joyi-code upstream to felikschu/deepseek-monitor (a Python tracker for DeepSeek PLATFORM changes, unrelated to balance/usage monitoring) and has since published a correction. That repository shares no code with this plugin.

Released under [MIT](./LICENSE); the MIT notices of the projects above are preserved with any distribution.

## License

MIT
