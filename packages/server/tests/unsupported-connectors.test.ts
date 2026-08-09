import { describe, expect, it } from 'vitest'

// Connector packages are only allowed in the workspace once they are wired into
// the bootstrap connector map, the CLI dependency set, and the docs. Slack was
// removed under that rule and re-added in issue #2 with the full wiring in place.
const unsupportedConnectorPackages = [
  '@opendocuments/connector-discord',
  '@opendocuments/connector-jira',
  '@opendocuments/connector-linear',
]

describe('unsupported connector packages', () => {
  it('are not importable from the workspace', async () => {
    for (const packageName of unsupportedConnectorPackages) {
      await expect(import(packageName)).rejects.toThrow()
    }
  })
})
