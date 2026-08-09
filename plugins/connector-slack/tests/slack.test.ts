import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SlackConnector, type SlackConfig } from '../src/index.js'

type SlackRoute = unknown | ((params: URLSearchParams) => unknown)

interface SlackCall {
  method: string
  params: URLSearchParams
}

const calls: SlackCall[] = []

/** Routes `https://slack.com/api/<method>` calls to canned payloads. */
function mockSlack(routes: Record<string, SlackRoute>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const parsed = new URL(url)
    const method = parsed.pathname.replace('/api/', '')
    calls.push({ method, params: parsed.searchParams })

    const route = routes[method]
    if (route === undefined) throw new Error(`unexpected Slack method: ${method}`)
    const body = typeof route === 'function' ? (route as (p: URLSearchParams) => unknown)(parsed.searchParams) : route
    return { ok: true, status: 200, json: async () => body }
  }))
}

function methodCalls(method: string): SlackCall[] {
  return calls.filter(call => call.method === method)
}

async function connect(config: SlackConfig = { token: 'xoxb-test' }): Promise<SlackConnector> {
  const connector = new SlackConnector()
  await connector.setup({
    config: config as unknown as Record<string, unknown>,
    dataDir: '/tmp',
    log: { ok: () => {}, fail: () => {}, info: () => {}, wait: () => {} },
  })
  return connector
}

const USERS = {
  ok: true,
  members: [
    { id: 'U1', profile: { display_name: 'alice' } },
    { id: 'U2', real_name: 'Bob Builder' },
  ],
}

const CHANNEL_INFO = {
  ok: true,
  channel: {
    id: 'C1',
    name: 'general',
    topic: { value: 'Team chat' },
    purpose: { value: 'Everything general' },
  },
}

const PARENT_TS = '1700000000.000100'

const HISTORY = {
  ok: true,
  messages: [
    { user: 'U2', text: 'Second message', ts: '1700000100.000200' },
    { user: 'U1', text: 'First message', ts: PARENT_TS, thread_ts: PARENT_TS, reply_count: 1 },
    { subtype: 'channel_join', user: 'U2', text: '<@U2> has joined the channel', ts: '1699999000.000100' },
  ],
  response_metadata: { next_cursor: '' },
}

const REPLIES = {
  ok: true,
  messages: [
    { user: 'U1', text: 'First message', ts: PARENT_TS, thread_ts: PARENT_TS, reply_count: 1 },
    { user: 'U2', text: 'Thread reply', ts: '1700000050.000300', thread_ts: PARENT_TS },
  ],
}

beforeEach(() => {
  calls.length = 0
  delete process.env.SLACK_TOKEN
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SlackConnector', () => {
  it('has correct metadata', async () => {
    const connector = await connect()
    expect(connector.name).toBe('@opendocuments/connector-slack')
    expect(connector.type).toBe('connector')
    expect(connector.coreVersion).toBe('^0.3.0')
  })

  it('healthCheck fails without a token', async () => {
    const connector = await connect({})
    const status = await connector.healthCheck()
    expect(status.healthy).toBe(false)
    expect(status.message).toContain('SLACK_TOKEN')
  })

  it('healthCheck succeeds via auth.test', async () => {
    mockSlack({ 'auth.test': { ok: true, team: 'Acme' } })
    const connector = await connect()
    const status = await connector.healthCheck()
    expect(status.healthy).toBe(true)
    expect(status.message).toContain('Acme')
  })

  it('healthCheck surfaces Slack errors returned with HTTP 200', async () => {
    mockSlack({ 'auth.test': { ok: false, error: 'invalid_auth' } })
    const connector = await connect()
    const status = await connector.healthCheck()
    expect(status.healthy).toBe(false)
    expect(status.message).toContain('invalid_auth')
  })

  it('reads the token from SLACK_TOKEN when config omits it', async () => {
    process.env.SLACK_TOKEN = 'xoxb-from-env'
    mockSlack({ 'auth.test': { ok: true, team: 'Acme' } })
    const connector = await connect({})
    expect((await connector.healthCheck()).healthy).toBe(true)
  })

  it('discovers channels across cursor pages', async () => {
    mockSlack({
      'conversations.list': (params) => params.get('cursor') === 'page2'
        ? { ok: true, channels: [{ id: 'C2', name: 'random' }], response_metadata: { next_cursor: '' } }
        : { ok: true, channels: [{ id: 'C1', name: 'general', num_members: 12 }], response_metadata: { next_cursor: 'page2' } },
    })

    const connector = await connect()
    const docs = []
    for await (const doc of connector.discover()) docs.push(doc)

    expect(docs).toHaveLength(2)
    expect(docs[0].title).toBe('#general')
    expect(docs[0].sourcePath).toBe('slack://C1')
    expect(docs[0].metadata?.memberCount).toBe(12)
    expect(docs[1].sourceId).toBe('C2')
    expect(methodCalls('conversations.list')).toHaveLength(2)
  })

  it('discovers only the configured channels', async () => {
    mockSlack({
      'conversations.list': {
        ok: true,
        channels: [
          { id: 'C1', name: 'general' },
          { id: 'C2', name: 'random' },
          { id: 'C3', name: 'design' },
        ],
      },
    })

    const connector = await connect({ token: 'xoxb-test', channels: ['#General', 'C3'] })
    const docs = []
    for await (const doc of connector.discover()) docs.push(doc)

    expect(docs.map(doc => doc.sourceId)).toEqual(['C1', 'C3'])
  })

  it('reports a revision only when thread replies are excluded', async () => {
    mockSlack({
      'conversations.list': { ok: true, channels: [{ id: 'C1', name: 'general' }] },
      'conversations.history': { ok: true, messages: [{ ts: '1700000100.000200', text: 'Newest' }] },
    })

    const threaded = await connect({ token: 'xoxb-test' })
    for await (const doc of threaded.discover()) {
      expect(doc.contentHash).toBeUndefined()
    }
    expect(methodCalls('conversations.history')).toHaveLength(0)

    const flat = await connect({ token: 'xoxb-test', includeThreads: false })
    for await (const doc of flat.discover()) {
      expect(doc.contentHash).toBe('1700000100.000200')
    }
  })

  it('fetches a channel as a chronological transcript', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': HISTORY,
      'conversations.replies': REPLIES,
    })

    const connector = await connect()
    const raw = await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })
    const content = raw.content as string

    expect(raw.title).toBe('#general')
    expect(content).toContain('# #general')
    expect(content).toContain('Purpose: Everything general')
    expect(content).toContain('Topic: Team chat')
    expect(content).toContain('alice: First message')
    expect(content).toContain('Bob Builder: Second message')
    expect(content.indexOf('First message')).toBeLessThan(content.indexOf('Second message'))
    expect(raw.metadata?.messageCount).toBe(2)
  })

  it('appends indented thread replies without repeating the parent', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': HISTORY,
      'conversations.replies': REPLIES,
    })

    const connector = await connect()
    const content = (await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })).content as string

    expect(content).toMatch(/\n {2}\[[^\]]+\] Bob Builder: Thread reply/)
    expect(content.match(/First message/g)).toHaveLength(1)
    expect(methodCalls('conversations.replies')[0].params.get('ts')).toBe(PARENT_TS)
  })

  it('skips thread reads when includeThreads is false', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': HISTORY,
    })

    const connector = await connect({ token: 'xoxb-test', includeThreads: false })
    const content = (await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })).content as string

    expect(content).not.toContain('Thread reply')
    expect(methodCalls('conversations.replies')).toHaveLength(0)
  })

  it('drops join and leave noise', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': HISTORY,
      'conversations.replies': REPLIES,
    })

    const connector = await connect()
    const content = (await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })).content as string

    expect(content).not.toContain('has joined the channel')
  })

  it('resolves mention, channel, and link markup', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': {
        ok: true,
        messages: [{
          user: 'U1',
          ts: '1700000200.000100',
          text: '<@U2> see <#C9|design> and <https://example.com|the doc> <!here> 5 &gt; 3',
        }],
      },
    })

    const connector = await connect()
    const content = (await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })).content as string

    expect(content).toContain('@Bob Builder')
    expect(content).toContain('#design')
    expect(content).toContain('the doc (https://example.com)')
    expect(content).toContain('@here')
    expect(content).toContain('5 > 3')
  })

  it('includes attachment and file text', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': {
        ok: true,
        messages: [{
          user: 'U1',
          ts: '1700000200.000100',
          text: '',
          attachments: [{ text: 'Deploy finished' }],
          files: [{ title: 'runbook.pdf' }],
        }],
      },
    })

    const connector = await connect()
    const content = (await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })).content as string

    expect(content).toContain('Deploy finished')
    expect(content).toContain('[file] runbook.pdf')
  })

  it('falls back to raw user IDs when the user directory is unreadable', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': { ok: false, error: 'missing_scope' },
      'conversations.history': { ok: true, messages: [{ user: 'U1', text: 'Hello', ts: '1700000200.000100' }] },
    })

    const connector = await connect()
    const content = (await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })).content as string

    expect(content).toContain('U1: Hello')
  })

  it('stops paginating history at maxMessages', async () => {
    mockSlack({
      'conversations.info': CHANNEL_INFO,
      'users.list': USERS,
      'conversations.history': (params) => ({
        ok: true,
        messages: Array.from({ length: Number(params.get('limit')) }, (_unused, index) => ({
          user: 'U1',
          text: `Message ${params.get('cursor') || 'first'}-${index}`,
          ts: `170000${String(index).padStart(4, '0')}.000100`,
        })),
        response_metadata: { next_cursor: 'more' },
      }),
    })

    const connector = await connect({ token: 'xoxb-test', maxMessages: 3 })
    const raw = await connector.fetch({ sourceId: 'C1', sourcePath: 'slack://C1' })

    expect(raw.metadata?.messageCount).toBe(3)
    expect(methodCalls('conversations.history')).toHaveLength(1)
    expect(methodCalls('conversations.history')[0].params.get('limit')).toBe('3')
  })

  it('retries once when Slack throttles the request', async () => {
    let attempts = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++
      if (attempts === 1) {
        return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, team: 'Acme' }) }
    }))

    const connector = await connect()
    const status = await connector.healthCheck()

    expect(attempts).toBe(2)
    expect(status.healthy).toBe(true)
  })

  it('surfaces HTTP failures from the Slack API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) })))

    const connector = await connect()
    await expect(async () => {
      for await (const _doc of connector.discover()) { /* consume */ }
    }).rejects.toThrow('HTTP 500')
  })
})
