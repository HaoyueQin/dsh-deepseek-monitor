/**
 * Locks the cross-file identities that must never drift: the npm version,
 * the plugin-manifest version, the host's advertised PLUGIN_VERSION, the two
 * client bundle ids, and the files whitelist that ships every README asset.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const pkg = JSON.parse(read('package.json')) as {
  version: string
  name: string
  main: string
  files: string[]
  exports: Record<string, { default?: string } | string | undefined>
  dsh?: { bundle?: { patch?: string }, client?: { platform?: string, inject?: string[] } }
  peerDependencies?: Record<string, string | undefined>
}
const manifest = JSON.parse(read('dsh.plugin.json')) as {
  id: string
  version: string
  description: string
  engines?: { dsh?: string }
  client: { main: string }
}

describe('manifest consistency', () => {
  it('package.json, dsh.plugin.json and PLUGIN_VERSION agree', () => {
    expect(manifest.version).toBe(pkg.version)
    const routes = read('src/routes.ts')
    const match = routes.match(/export const PLUGIN_VERSION = '([^']+)'/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(pkg.version)
  })

  it('the two client bundles register under package name and manifest id', () => {
    expect(manifest.client.main).toBe('./lib/client-registry.js')
    const tsdown = read('tsdown.config.ts')
    expect(tsdown).toContain("'" + pkg.name + "'")
    expect(tsdown).toContain("'" + manifest.id + "'")
  })

  it('the npm files whitelist ships every README-referenced asset', () => {
    const files = pkg.files
    expect(files).toContain('README.md')
    expect(files).toContain('README_EN.md')
    expect(files).toContain('docs/images/account-details-panel.png')
    expect(files).toContain('dsh.plugin.json')
    expect(files).toContain('cordis.patch.yml')
    expect(pkg.main).toBe('lib/index.js')
  })

  it('keeps the rc.1+ client assembly channel coherent (dsh.client / exports)', () => {
    // The client-modules entry resolves package.json dsh.client plus
    // exports["./client"] ever since 0.1.1-rc.1 (verified against the tag);
    // no kernel ever read dsh.plugin.json.
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.exports?.['./client']).toMatchObject({ default: './lib/client.js' })
    const inject = pkg.dsh?.client?.inject ?? []
    // dsh-client-runtime is retired since alpha.1 (slots moved to ui-renderer).
    expect(inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
  })

  it('keeps peer ranges on the 0.1.5 line only (node-semver pre-release rule)', () => {
    // node-semver admits a pre-release only when a comparator shares its
    // [major, minor, patch] tuple — so the 0.1.5-alpha.x kernels need the
    // ^0.1.5-alpha.1 arm, which also covers 0.1.5 stable when it lands.
    // Older lines (0.1.2-rc.x / 0.1.3-alpha.x and earlier) are intentionally
    // rejected: their users stay on this plugin's 0.1.5 release. The peer
    // floor deliberately stays at alpha.1 while devDependencies and the build
    // baseline track 0.1.5-rc.1: the floor is what ALPHA users may install
    // against, and every 0.1.5 pre-release shares this tuple, so narrowing it
    // to rc.1 would strand them for no gain.
    const PEER_RANGE = '^0.1.5-alpha.1'
    const names = [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-storage-domain',
    ]
    for (const name of names) expect(pkg.peerDependencies?.[name]).toBe(PEER_RANGE)
    // The bare 'cordis' package is retired upstream (rc.1 peers on
    // @deepseek-ai/cordis); it must not come back into the manifest.
    expect(pkg.peerDependencies?.['cordis']).toBeUndefined()
    expect(pkg.peerDependencies?.['@deepseek-ai/cordis']).toBe('^4.0.1')
  })

  it('marks every client package the shell must load as an inject entry', () => {
    // dsh.client.inject is the browser-side dependency list: the shell loads
    // each entry before this plugin's client bundle runs. Every CLIENT half
    // belongs there...
    const CLIENT_PACKAGES = [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
    ]
    const inject = new Set(pkg.dsh?.client?.inject ?? [])
    for (const name of CLIENT_PACKAGES) {
      expect(inject.has(name)).toBe(true)
      expect(pkg.peerDependencies?.[name]).toBeDefined()
    }
    // ...while a HOST service stays out of it. @deepseek-ai/dsh-storage-domain
    // is the one peer the client half never touches: it resolves host-side and
    // publishes no `./client` export, so injecting it would ask the browser to
    // load a Node package.
    expect(pkg.peerDependencies?.['@deepseek-ai/dsh-storage-domain']).toBeDefined()
    expect(inject.has('@deepseek-ai/dsh-storage-domain')).toBe(false)
  })

  it('declares the 0.1.5-only kernel range in dsh.plugin.json engines', () => {
    // The README 版本兼容 section quotes engines.dsh as the support range;
    // lock it so the manifest and the docs cannot drift from the 0.1.5-only
    // support policy. (Declarative metadata: no host reads engines today.)
    // The range is the SUPPORT floor, not the build baseline — the latter is
    // package.json devDependencies, pinned to 0.1.5-rc.1.
    expect(manifest.engines?.dsh).toBe('^0.1.5-alpha.1')
  })

  it('keeps CLIENT_EXTERNALS covering the shell platform table', () => {
    // tsdown.config.ts mirrors the shell PLATFORM_MODULES from dsh-client-web
    // (packages/client/web/src/platform.ts on the 0.1.5-rc.1 baseline).
    // A dropped entry silently inlines or trips the purity gate, so lock the
    // known-good set here; when the shell adds a module, mirror it there
    // and extend this list.
    const PLATFORM_MODULES = [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-dockkit',
    ]
    const tsdown = read('tsdown.config.ts')
    for (const mod of PLATFORM_MODULES) expect(tsdown).toContain(`\'${mod}\'`)
  })

  it('keeps minimumReleaseAgeExclude entries well-formed', () => {
    // pnpm once auto-merged a bump into `@x@old || new` selectors, which are
    // not valid exclude syntax — lock the shape so a bad merge fails loudly.
    const workspace = read('pnpm-workspace.yaml')
    const entries = [...workspace.matchAll(/^\s*- '([^']+)'\s*$/gm)].map(m => m[1])
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry).not.toContain('||')
      expect(entry.trim()).toBe(entry)
      expect(entry).not.toMatch(/\s/)
    }
  })

  it('the manifest description never re-advertises a retired surface', () => {
    // The composer.dock stats band was removed in f26a4ef; the description
    // drifted for one release. Lock the replacement wording instead.
    expect(manifest.description).not.toMatch(/统计带|stats band|composer\.dock/)
    expect(manifest.description).toMatch('conversation.input.right')
  })
})
