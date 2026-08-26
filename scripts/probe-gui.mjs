/**
 * Headless GUI probe v3 (default http://127.0.0.1:3080). Full delivery
 * verification for dsh-deepseek-monitor:
 *  1. Settings nav has NO standalone DeepSeek 监控 entry.
 *  2. Models page: the DeepSeek row carries a 「账户明细」 button LEFT of 编辑
 *     with matching chrome (same classes), a balance chip near the name, and
 *     clicking the button opens a structured panel (balance value / sections).
 *  3. composer tool-row chip: placement INSIDE the trailing group (left of
 *     the model name), typography parity, live balance value, and the real
 *     flex gap to the neighboring control.
 *
 * Run: node scripts/probe-gui.mjs   (env DSH_URL overrides)
 */
import { createRequire } from 'node:module'
import process from 'node:process'

// playwright-core is a devDependency of THIS package; no borrowing from
// sibling repositories (the old cross-repo createRequire broke on machines
// that never cloned dsh-usage-statistics-panel).
const { chromium } = createRequire(import.meta.url)('playwright-core')

const URL = process.env.DSH_URL ?? 'http://127.0.0.1:3080'

function pickLaunch() {
  return [
    { channel: 'msedge' },
    { channel: 'chrome' },
    { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
    { executablePath: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe' },
  ]
}

const browser = await (async () => {
  let lastError
  for (const opt of pickLaunch()) {
    try {
      return await chromium.launch({ headless: true, ...opt })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
})()

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text().slice(0, 400)}`)
})
page.on('pageerror', (err) => { pageErrors.push(String(err).slice(0, 600)) })

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.waitForTimeout(6000)

// ── 1+2. Settings → 模型 assertions ────────────────────────────────────────
let settingsFacts = null
try {
  const trigger = page.locator('button', { hasText: /设置|Settings/ }).first()
  await trigger.click({ timeout: 10000 })
  await page.waitForTimeout(2000)
  const modelsNav = page.locator('[role="dialog"] nav button', { hasText: /^模型|Models$/ }).first()
  await modelsNav.click({ timeout: 8000 })
  await page.waitForTimeout(2500)

  // Ensure the DeepSeek row is augmented; if the observer hasn't caught up,
  // nudge with one more wait.
  let augmented = await page.evaluate(() => document.querySelector('[data-dsm-btn]') !== null)
  if (!augmented) {
    await page.waitForTimeout(3500)
    augmented = await page.evaluate(() => document.querySelector('[data-dsm-btn]') !== null)
  }

  settingsFacts = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const navButtons = dialog !== null ? [...dialog.querySelectorAll('nav button')].map(b => b.textContent?.trim()) : null
    const rows = [...dialog?.querySelectorAll('li') ?? []]
    const row = rows.find(li => li.querySelector('[class*="rowName"]')?.textContent?.trim() === 'DeepSeek')
    if (row === undefined || row === null) return { navButtons, rowFound: false }
    const btn = row.querySelector('[data-dsm-btn]')
    const edit = [...row.querySelectorAll('button')].find(b =>
      (b.textContent?.trim() ?? '') === '编辑' || (b.getAttribute('aria-label') ?? '').startsWith('编辑'))
    const chip = row.querySelector('[data-dsm-chip]')
    const csOf = (el) => {
      if (el === null) return null
      const s = getComputedStyle(el)
      return { borderWidth: s.borderWidth, borderRadius: s.borderRadius, padding: s.padding, bg: s.backgroundColor }
    }
    return {
      rowFound: true,
      navButtons,
      hasButton: btn !== null,
      buttonText: btn?.textContent ?? null,
      buttonBeforeEdit: btn !== null && edit !== null
        ? (edit.previousElementSibling === btn || (btn.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
        : null,
      buttonChrome: csOf(btn),
      editChrome: csOf(edit),
      chipText: chip?.textContent ?? null,
    }
  })

  // Click 账户明细 → panel opens?
  if (settingsFacts !== null && settingsFacts.hasButton === true) {
    await page.click('[data-dsm-btn]')
    await page.waitForTimeout(2500)
    settingsFacts.panel = await page.evaluate(() => {
      const panel = document.querySelector('[data-dsm-panel]')
      if (panel === null) return { open: false }
      const s = getComputedStyle(panel)
      return {
        open: true,
        display: s.display,
        flexDirection: s.flexDirection,
        childCards: panel.children.length,
        textSample: panel.textContent?.replace(/\s+/g, ' ').slice(0, 260) ?? '',
        hasBalanceValue: /[-−]?\d/.test(panel.textContent ?? ''),
        rowAccents: (() => {
          const wanted = ['rgb(77, 166, 255)', 'rgb(143, 125, 240)', 'rgb(77, 107, 254)']
          const found = []
          panel.querySelectorAll('span, div').forEach(el => {
            const c = getComputedStyle(el).color
            if (wanted.includes(c) && !found.includes(c)) found.push(c)
          })
          return found
        })(),
      }
    })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
} catch (error) {
  settingsFacts = { error: String(error).slice(0, 300) }
}

// ── 3. composer tool-row chip facts ───────────────────────────────────────
let chipFacts = null
try {
  const candidates = page.locator('[class*="session"], [data-slot*="session"], li, a').filter({ hasText: /进行中|dsh-DeepSeekMonitor|dsh\b/ }).first()
  await candidates.click({ timeout: 8000 })
  await page.waitForTimeout(3500)
} catch { /* conversation may already be open */ }

chipFacts = await page.evaluate(() => {
  const chip = document.querySelector('[data-dsm-composer-chip]')
  if (chip === null) return { present: false }
  // The host composer card carries a data marker; its trailing flex group is
  // the CSS-module class ending in _trailing (hash_local convention).
  const card = document.querySelector('[data-composer-card]')
  const trailing = card !== null
    ? [...card.querySelectorAll('div')].find((d) => /(^|\s)\S*_trailing(\s|$)/.test(d.className))
    : null
  const next = chip.nextElementSibling
  const gap = next !== null
    ? Math.round(next.getBoundingClientRect().left - chip.getBoundingClientRect().right)
    : null
  return {
    present: true,
    provider: chip.getAttribute('data-dsm-provider'),
    model: chip.getAttribute('data-dsm-model'),
    text: chip.textContent,
    insideTrailing: trailing !== null && trailing.contains(chip),
    // Gate expectation on a NON-deepseek session: the chip must be ABSENT.
    nextSibling: next !== null ? { tag: next.tagName, cls: String(next.className).slice(0, 60) } : null,
    gapPx: gap,
    heightPx: Math.round(chip.getBoundingClientRect().height),
    fontSize: getComputedStyle(chip).fontSize,
    fontWeight: getComputedStyle(chip).fontWeight,
  }
})

console.log(JSON.stringify({ settingsFacts, chipFacts, pageErrors, consoleErrors: consoleErrors.slice(0, 20) }, null, 2))
await browser.close()
