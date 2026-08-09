import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONNECTOR_PLUGINS_MAP } from '../src/bootstrap.js'
import { CONFIGURABLE_CONNECTOR_TYPES } from '../src/http/routes/admin.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function cliDependencies(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf-8'))
  return pkg.dependencies || {}
}

describe('connector wiring', () => {
  it('exposes every admin-configurable type through the connector map', () => {
    for (const type of CONFIGURABLE_CONNECTOR_TYPES) {
      expect(CONNECTOR_PLUGINS_MAP, `${type} is offered by the admin API`).toHaveProperty(type)
    }
  })

  it('ships every mapped connector package as a CLI dependency', () => {
    const dependencies = cliDependencies()
    for (const packageName of new Set(Object.values(CONNECTOR_PLUGINS_MAP))) {
      expect(dependencies, `${packageName} is reachable at runtime`).toHaveProperty(packageName)
    }
  })

  it('resolves each mapped package to a connector plugin', async () => {
    for (const packageName of new Set(Object.values(CONNECTOR_PLUGINS_MAP))) {
      const mod = await import(packageName) as { default?: new () => { type?: string } }
      expect(mod.default, `${packageName} exports a default plugin`).toBeTypeOf('function')
      expect(new (mod.default as new () => { type?: string })().type).toBe('connector')
    }
  })

  it('registers the Slack connector for issue #2', () => {
    expect(CONNECTOR_PLUGINS_MAP.slack).toBe('@opendocuments/connector-slack')
    expect(CONFIGURABLE_CONNECTOR_TYPES.has('slack')).toBe(true)
  })
})
