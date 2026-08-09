import type {
  ConnectorPlugin,
  DiscoveredDocument,
  DocumentRef,
  RawDocument,
  PluginContext,
  HealthStatus,
} from 'opendocuments-core'
import { fetchWithTimeout } from 'opendocuments-core'

/**
 * Configuration for the Slack connector.
 *
 * The bot token needs `channels:read` and `channels:history`. `users:read` is
 * optional and only improves author names; without it messages keep raw user IDs.
 */
export interface SlackConfig {
  /** Bot token (`xoxb-...`). Falls back to the `SLACK_TOKEN` environment variable. */
  token?: string
  /**
   * Channel names or IDs to index (`#general`, `general`, or `C0123456789`).
   * Accepts an array or a newline/comma separated string. Empty means every
   * non-archived public channel the token can see.
   */
  channels?: string[] | string
  /** Seconds between syncs. Consumed by the connector manager, not by this plugin. */
  syncInterval?: number
  /** Newest messages read per channel. Defaults to 1000. */
  maxMessages?: number
  /**
   * Append thread replies under their parent message. Defaults to true.
   * Turning it off lets a sync skip channels whose newest message is unchanged,
   * which trades thread coverage for far fewer Slack API calls.
   */
  includeThreads?: boolean
}

interface SlackChannel {
  id?: string
  name?: string
  topic?: { value?: string }
  purpose?: { value?: string }
  num_members?: number
}

interface SlackUser {
  id?: string
  name?: string
  real_name?: string
  profile?: { display_name?: string; real_name?: string }
}

interface SlackMessage {
  subtype?: string
  user?: string
  bot_id?: string
  username?: string
  text?: string
  ts?: string
  thread_ts?: string
  reply_count?: number
  attachments?: { text?: string; fallback?: string }[]
  files?: { title?: string; name?: string }[]
}

interface SlackResponse {
  ok?: boolean
  error?: string
  channel?: SlackChannel
  channels?: SlackChannel[]
  members?: SlackUser[]
  messages?: SlackMessage[]
  team?: string
  response_metadata?: { next_cursor?: string }
}

const SLACK_API = 'https://slack.com/api'
const PAGE_SIZE = 200
const DEFAULT_MAX_MESSAGES = 1000
const MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30_000

/** Membership churn carries no retrievable content. */
const SKIPPED_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'group_join',
  'group_leave',
  'bot_add',
  'bot_remove',
])

/**
 * Indexes Slack conversations, one document per channel, rendered as a
 * chronological transcript of its messages and thread replies.
 */
export class SlackConnector implements ConnectorPlugin {
  name = '@opendocuments/connector-slack'
  type = 'connector' as const
  version = '0.1.0'
  coreVersion = '^0.3.0'

  private token = ''
  private channelFilter: string[] = []
  private maxMessages = DEFAULT_MAX_MESSAGES
  private includeThreads = true
  private userNames = new Map<string, string>()
  private userDirectoryLoaded = false
  private log?: PluginContext['log']

  async setup(ctx: PluginContext): Promise<void> {
    const config = ctx.config as unknown as SlackConfig
    this.token = config.token || process.env.SLACK_TOKEN || ''
    this.channelFilter = normalizeChannels(config.channels)
    this.maxMessages = positiveInt(config.maxMessages, DEFAULT_MAX_MESSAGES)
    this.includeThreads = config.includeThreads !== false
    this.log = ctx.log
    this.userNames.clear()
    this.userDirectoryLoaded = false
  }

  async teardown(): Promise<void> {
    this.userNames.clear()
    this.userDirectoryLoaded = false
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.token) return { healthy: false, message: 'SLACK_TOKEN not set' }
    try {
      const data = await this.slackFetch('auth.test')
      return { healthy: true, message: `Connected to Slack${data.team ? ` workspace ${data.team}` : ''}` }
    } catch (err) {
      return { healthy: false, message: (err as Error).message }
    }
  }

  async *discover(): AsyncIterable<DiscoveredDocument> {
    let cursor: string | undefined

    do {
      const data = await this.slackFetch('conversations.list', {
        types: 'public_channel',
        exclude_archived: 'true',
        limit: PAGE_SIZE,
        cursor,
      })

      for (const channel of data.channels || []) {
        if (!channel.id || !this.matchesFilter(channel)) continue

        yield {
          sourceId: channel.id,
          title: channel.name ? `#${channel.name}` : channel.id,
          sourcePath: `slack://${channel.id}`,
          contentHash: await this.latestMessageTs(channel.id),
          metadata: {
            channelId: channel.id,
            channelName: channel.name || channel.id,
            topic: channel.topic?.value || undefined,
            purpose: channel.purpose?.value || undefined,
            memberCount: channel.num_members,
          },
        }
      }

      cursor = data.response_metadata?.next_cursor || undefined
    } while (cursor)
  }

  async fetch(ref: DocumentRef): Promise<RawDocument> {
    const channelId = ref.sourceId || ref.sourcePath.replace('slack://', '')
    const info = await this.channelInfo(channelId)
    const channelName = info?.name ? `#${info.name}` : channelId

    await this.loadUserDirectory()
    const messages = await this.collectMessages(channelId)
    messages.reverse() // conversations.history returns newest first

    const lines: string[] = [`# ${channelName}`]
    if (info?.purpose?.value) lines.push(`Purpose: ${info.purpose.value}`)
    if (info?.topic?.value) lines.push(`Topic: ${info.topic.value}`)
    lines.push('')

    let replyCount = 0
    for (const message of messages) {
      const rendered = this.renderMessage(message)
      if (rendered) lines.push(rendered)

      const threadTs = message.ts
      if (!this.includeThreads || !threadTs || !isThreadParent(message)) continue

      for (const reply of await this.threadReplies(channelId, threadTs)) {
        const renderedReply = this.renderMessage(reply, true)
        if (!renderedReply) continue
        lines.push(renderedReply)
        replyCount++
      }
    }

    return {
      sourceId: channelId,
      title: channelName,
      content: lines.join('\n'),
      mimeType: 'text/markdown',
      metadata: {
        channelId,
        channelName: info?.name || channelId,
        messageCount: messages.length,
        replyCount,
      },
    }
  }

  /**
   * Newest top-level message timestamp, used as the source revision so unchanged
   * channels skip a full history read. Thread replies do not move this value, so
   * it is only reported when replies are excluded from the transcript.
   */
  private async latestMessageTs(channelId: string): Promise<string | undefined> {
    if (this.includeThreads) return undefined
    try {
      const data = await this.slackFetch('conversations.history', { channel: channelId, limit: 1 })
      return data.messages?.[0]?.ts
    } catch (err) {
      this.log?.info(`Slack: no revision for ${channelId} (${(err as Error).message}); it will be re-read`)
      return undefined
    }
  }

  private async channelInfo(channelId: string): Promise<SlackChannel | undefined> {
    try {
      const data = await this.slackFetch('conversations.info', { channel: channelId })
      return data.channel
    } catch (err) {
      this.log?.info(`Slack: channel metadata unavailable for ${channelId} (${(err as Error).message})`)
      return undefined
    }
  }

  private async collectMessages(channelId: string): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = []
    let read = 0
    let cursor: string | undefined

    do {
      const data = await this.slackFetch('conversations.history', {
        channel: channelId,
        limit: Math.min(PAGE_SIZE, this.maxMessages - read),
        cursor,
      })

      const page = data.messages || []
      read += page.length
      for (const message of page) {
        if (!isSkippable(message)) messages.push(message)
      }

      cursor = data.response_metadata?.next_cursor || undefined
    } while (cursor && read < this.maxMessages)

    if (cursor) {
      this.log?.info(`Slack: ${channelId} truncated at the newest ${this.maxMessages} messages (maxMessages)`)
    }
    return messages
  }

  private async threadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
    const replies: SlackMessage[] = []
    let cursor: string | undefined

    do {
      const data = await this.slackFetch('conversations.replies', {
        channel: channelId,
        ts: threadTs,
        limit: PAGE_SIZE,
        cursor,
      })

      for (const message of data.messages || []) {
        // The parent message is echoed back as the first reply.
        if (message.ts === threadTs || isSkippable(message)) continue
        replies.push(message)
      }

      cursor = data.response_metadata?.next_cursor || undefined
    } while (cursor)

    return replies
  }

  /** Maps user IDs to display names once per sync; raw IDs are the fallback. */
  private async loadUserDirectory(): Promise<void> {
    if (this.userDirectoryLoaded) return
    this.userDirectoryLoaded = true

    let cursor: string | undefined
    try {
      do {
        const data = await this.slackFetch('users.list', { limit: PAGE_SIZE, cursor })
        for (const member of data.members || []) {
          if (!member.id) continue
          const name = member.profile?.display_name || member.real_name || member.profile?.real_name || member.name
          if (name) this.userNames.set(member.id, name)
        }
        cursor = data.response_metadata?.next_cursor || undefined
      } while (cursor)
    } catch (err) {
      this.log?.info(`Slack: user directory unavailable (${(err as Error).message}); showing raw user IDs`)
    }
  }

  private renderMessage(message: SlackMessage, isReply = false): string {
    const text = this.formatText(messageText(message))
    if (!text) return ''

    const indent = isReply ? '  ' : ''
    const author = this.authorName(message)
    return `${indent}[${formatTimestamp(message.ts)}] ${author}: ${text.replace(/\n/g, `\n${indent}  `)}`
  }

  private authorName(message: SlackMessage): string {
    if (message.user) return this.userNames.get(message.user) || message.user
    return message.username || message.bot_id || 'unknown'
  }

  /** Resolves Slack's `<...>` markup into plain text. */
  private formatText(text: string): string {
    return text
      .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_all, id: string, label?: string) =>
        `@${label || this.userNames.get(id) || id}`)
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
      .replace(/<#([A-Z0-9]+)>/g, '#$1')
      .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
      .replace(/<!subteam\^[A-Z0-9]+(?:\|@?([^>]+))?>/g, (_all, label?: string) => `@${label || 'group'}`)
      .replace(/<((?:https?|mailto):[^>|]+)\|([^>]+)>/g, '$2 ($1)')
      .replace(/<((?:https?|mailto):[^>|]+)>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim()
  }

  private matchesFilter(channel: SlackChannel): boolean {
    if (this.channelFilter.length === 0) return true
    const name = (channel.name || '').toLowerCase()
    const id = (channel.id || '').toLowerCase()
    return this.channelFilter.includes(name) || this.channelFilter.includes(id)
  }

  /**
   * Calls a Slack Web API method. Slack reports most failures with HTTP 200 and
   * `ok: false`, and throttles with HTTP 429 plus a `Retry-After` header.
   */
  private async slackFetch(
    method: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<SlackResponse> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      query.set(key, String(value))
    }
    const search = query.toString()
    const url = `${SLACK_API}/${method}${search ? `?${search}` : ''}`

    for (let attempt = 0; ; attempt++) {
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      })

      if (res.status === 429 && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(res))
        continue
      }
      if (!res.ok) throw new Error(`Slack API error (${method}): HTTP ${res.status}`)

      const data = await res.json() as SlackResponse
      if (data.ok === false) throw new Error(`Slack API error (${method}): ${data.error || 'unknown_error'}`)
      return data
    }
  }
}

function normalizeChannels(channels: string[] | string | undefined): string[] {
  const list = Array.isArray(channels)
    ? channels
    : typeof channels === 'string' ? channels.split(/[\n,]/) : []
  return list
    .map(channel => channel.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function isSkippable(message: SlackMessage): boolean {
  return message.subtype !== undefined && SKIPPED_SUBTYPES.has(message.subtype)
}

function isThreadParent(message: SlackMessage): boolean {
  return Boolean(message.ts) && message.thread_ts === message.ts && (message.reply_count || 0) > 0
}

/** Message body plus any attachment or file text Slack keeps outside `text`. */
function messageText(message: SlackMessage): string {
  const parts = [message.text || '']
  for (const attachment of message.attachments || []) {
    const text = attachment.text || attachment.fallback
    if (text) parts.push(text)
  }
  for (const file of message.files || []) {
    const title = file.title || file.name
    if (title) parts.push(`[file] ${title}`)
  }
  return parts.filter(Boolean).join('\n')
}

/** Slack timestamps are `seconds.microseconds` strings. */
function formatTimestamp(ts: string | undefined): string {
  const seconds = Number(ts)
  if (!Number.isFinite(seconds)) return 'unknown time'
  return new Date(seconds * 1000).toISOString()
}

function retryDelayMs(res: Response): number {
  const header = res.headers?.get?.('retry-after')
  const seconds = Number(header)
  if (header === null || header === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_RETRY_DELAY_MS
  }
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default SlackConnector
