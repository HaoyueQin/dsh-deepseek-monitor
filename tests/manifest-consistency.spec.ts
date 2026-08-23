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

  it('the manifest description never re-advertises a retired surface', () => {
    // The composer.dock stats band was removed in f26a4ef; the description
    // drifted for one release. Lock the replacement wording instead.
    expect(manifest.description).not.toMatch(/统计带|stats band|composer\.dock/)
    expect(manifest.description).toMatch('conversation.input.right')
  })
})
