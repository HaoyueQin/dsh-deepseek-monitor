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

  it('keeps peer ranges covering rc.1 through alpha.4 (node-semver pre-release rule)', () => {
    // A single ">=0.1.1-rc.1 <0.2.0" style range rejects pre-release
    // candidates without a same-tuple comparator; the dual range below is the
    // verified cover for each supported kernel generation.
    const PEER_RANGE = '^0.1.1-rc.1 || ^0.1.2-alpha.1'
    const names = [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-storage-domain',
    ]
    for (const name of names) expect(pkg.peerDependencies?.[name]).toBe(PEER_RANGE)
  })

  it('the manifest description never re-advertises a retired surface', () => {
    // The composer.dock stats band was removed in f26a4ef; the description
    // drifted for one release. Lock the replacement wording instead.
    expect(manifest.description).not.toMatch(/统计带|stats band|composer\.dock/)
    expect(manifest.description).toMatch('conversation.input.right')
  })
})
