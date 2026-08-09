# Contributing to OpenDocuments

Thank you for your interest in contributing to OpenDocuments! This guide covers everything you need to know to get started.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Contribution Workflow](#contribution-workflow)
- [Code Conventions](#code-conventions)
- [Writing Tests](#writing-tests)
- [Plugin Development](#plugin-development)
- [Commit Messages](#commit-messages)
- [Pull Request Guide](#pull-request-guide)
- [Reporting Issues](#reporting-issues)
- [Release Process](#release-process)

---

## Development Setup

### Prerequisites

- **Node.js** 20 or later
- **npm** 10 or later
- **Git**

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/joungminsung/OpenDocuments.git
cd OpenDocuments

# 2. Install dependencies and build everything (one command)
npm run setup

# 3. Run all tests (51 test suites, ~300 tests)
npm run test

# 4. Start development mode (watch for changes)
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Install dependencies + build all packages |
| `npm run build` | Build all packages via Turborepo |
| `npm run test` | Run all test suites |
| `npm run dev` | Watch mode for all packages |
| `npx turbo build --filter=@opendocuments/core` | Build a specific package only |
| `npx turbo test --filter=@opendocuments/core` | Test a specific package only |

### Developing Without Ollama

You don't need Ollama or any LLM provider installed to develop. When no model provider is available, the bootstrap automatically falls back to **stub models** that return zero-vector embeddings and placeholder text. The core indexing and search flow still works.

You'll see this message in the console -- it's expected and harmless:

```
[!!] Model plugin @opendocuments/model-ollama embed probe failed. Using stub models.
```

You only need a real LLM when developing features that depend on actual model output (e.g., answer quality testing).

---

## Project Structure

```
OpenDocuments/
├── packages/                       # Core packages (5)
│   ├── core/                       # All business logic
│   │   ├── src/
│   │   │   ├── auth/               # API key management, OAuth provider
│   │   │   ├── config/             # Zod schema, config loader (jiti)
│   │   │   ├── connector/          # ConnectorManager (orchestrates external sources)
│   │   │   ├── conversation/       # Chat history persistence
│   │   │   ├── document/           # Versioning, tags, collections, chunk relations
│   │   │   ├── events/             # Typed EventBus (18 event types)
│   │   │   ├── ingest/             # Pipeline (parse → chunk → embed → store), chunker, document store
│   │   │   ├── parsers/            # Built-in parsers (Markdown, PlainText, Structured, Archive)
│   │   │   ├── plugin/             # Plugin registry, loader, compatibility checker
│   │   │   ├── rag/                # RAG engine, retriever, generator, profiles, cache,
│   │   │   │                       # intent classifier, reranker, hallucination guard,
│   │   │   │                       # query decomposer, cross-lingual, context window
│   │   │   ├── security/           # PII redaction, audit logger, security alerts
│   │   │   ├── storage/            # DB abstraction (SQLite), VectorDB (LanceDB), migrations
│   │   │   ├── telemetry/          # Opt-in usage telemetry
│   │   │   ├── utils/              # Logger, hash, fetchWithTimeout, file discovery, file watcher
│   │   │   └── workspace/          # Workspace CRUD
│   │   └── tests/                  # 31 test files, 159 tests
│   │
│   ├── server/                     # HTTP server (Hono), MCP server, auth middleware
│   │   ├── src/
│   │   │   ├── bootstrap.ts        # Wires all core components together
│   │   │   ├── http/
│   │   │   │   ├── app.ts          # Hono app (CORS, auth, rate limit, static serving)
│   │   │   │   ├── middleware/      # auth.ts, rate-limit.ts
│   │   │   │   └── routes/         # 9 route files (35+ endpoints)
│   │   │   ├── mcp/                # MCP server (19 tools, 2 resources)
│   │   │   └── widget/             # Embeddable chat widget (postMessage auth)
│   │   └── tests/                  # 7 test files, 27 tests
│   │
│   ├── cli/                        # CLI binary (Commander.js)
│   │   └── src/commands/           # 17 command files
│   │
│   ├── web/                        # React SPA (Vite + Tailwind CSS)
│   │   └── src/
│   │       ├── components/         # 7 pages + CommandPalette + layout
│   │       ├── stores/             # Zustand (appStore, chatStore)
│   │       └── lib/                # API client, SSE helper, i18n, types
│   │
│   └── client/                     # TypeScript SDK (@opendocuments/client)
│
├── plugins/                        # Plugins (21 total)
│   ├── model-ollama/               # Ollama (local LLM + embedding)
│   ├── model-openai/               # OpenAI (GPT-5.4, text-embedding-3)
│   ├── model-anthropic/            # Anthropic (Claude Opus/Sonnet 4.6, no embedding)
│   ├── model-google/               # Google (Gemini 3.1, text-embedding-005)
│   ├── model-grok/                 # xAI (Grok 4, OpenAI-compatible API)
│   ├── parser-pdf/                 # PDF (pdf-parse)
│   ├── parser-docx/                # Word (mammoth HTML conversion)
│   ├── parser-xlsx/                # Excel/CSV (SheetJS)
│   ├── parser-html/                # HTML (cheerio)
│   ├── parser-jupyter/             # Jupyter Notebook (JSON parse)
│   ├── parser-email/               # Email .eml (RFC 2822 parser)
│   ├── parser-code/                # Source code (regex-based function/class extraction)
│   ├── parser-pptx/                # PowerPoint (XML text extraction)
│   ├── connector-github/           # GitHub (REST API, tree listing, base64 decode)
│   ├── connector-notion/           # Notion (Search API, block-to-text conversion)
│   ├── connector-gdrive/           # Google Drive (Drive API v3)
│   ├── connector-s3/               # S3/GCS (XML/JSON list + download)
│   ├── connector-confluence/       # Confluence (REST API, HTML-to-text)
│   ├── connector-slack/            # Slack (Web API, channel transcript rendering)
│   ├── connector-swagger/          # Swagger/OpenAPI (spec parsing, endpoint chunking)
│   ├── connector-web-crawler/      # Web crawler (cheerio text extraction)
│   └── connector-web-search/       # Tavily web search (query-time, not index-time)
│
├── docs-site/                      # VitePress documentation site
├── templates/                      # Plugin scaffolding templates
├── benchmarks/                     # RAG quality benchmarks (datasets + results)
├── Dockerfile                      # Multi-stage production image
└── docker-compose.yml              # Docker Compose with optional Ollama
```

### Key Architectural Principles

1. **All business logic lives in `@opendocuments/core`** -- the server package is only a thin protocol translation layer (HTTP/MCP/WebSocket)
2. **Everything is a plugin** -- parsers, connectors, models, and middleware all share the same plugin interface with lifecycle hooks
3. **Config as Code** -- `opendocuments.config.ts` is the single source of truth, loaded at runtime via jiti
4. **Event-driven decoupling** -- components communicate through a typed EventBus (18 event types) instead of direct calls
5. **Storage abstraction** -- SQLite and LanceDB sit behind interfaces; switching to PostgreSQL/Qdrant requires only config changes

---

## Contribution Workflow

### 1. Find or Create an Issue

- Check existing [issues](https://github.com/joungminsung/OpenDocuments/issues)
- Look for `good first issue` labels if you're new
- For larger changes, open an issue first to discuss the approach

### 2. Create a Branch

```bash
git checkout main
git pull origin main
git checkout -b feat/my-feature     # New feature
git checkout -b fix/my-bugfix       # Bug fix
git checkout -b docs/my-docs        # Documentation
```

### 3. Develop

```bash
# Build and test only the packages you changed
npx turbo build --filter=@opendocuments/core
npx turbo test --filter=@opendocuments/core

# Or build and test everything
npm run build
npm run test
```

### 4. Create a Changeset

For any change that affects package versions:

```bash
npx changeset
```

You'll be prompted to:
1. Select affected packages (spacebar to toggle)
2. Choose version bump type: `patch` (bugfix) / `minor` (feature) / `major` (breaking)
3. Write a summary of the change

This creates a markdown file in `.changeset/`. **Include this file in your commit.**

### 5. Submit a PR

```bash
git add -A
git commit -m "feat(core): add my feature"
git push origin feat/my-feature
```

Open a Pull Request on GitHub. Fill in the PR template.

### 6. Wait for CI

GitHub Actions automatically runs on every PR:
- `npm ci` (clean install)
- `npx turbo build` (full build)
- `npx turbo typecheck` (TypeScript strict check)
- `npx turbo test` (all tests)

Tested on Node.js 20 and 22. **CI must pass before merge.**

---

## Code Conventions

### TypeScript

- **Strict mode** is mandatory (`"strict": true` in `tsconfig.base.json`)
- **ESM modules** (`"type": "module"` in every package.json)
- **`.js` extension required** in import paths (ESM requirement):
  ```typescript
  // Correct
  import { sha256 } from './utils/hash.js'

  // Wrong
  import { sha256 } from './utils/hash'
  ```
- **Minimize `any`** -- use `unknown` or proper types. `any` is acceptable in Web UI components but not in core or server logic.
  ```typescript
  // Correct
  const data = await res.json() as { items: string[] }

  // Avoid
  const data = await res.json() as any
  ```
- Write **JSDoc** for all public APIs

### Naming

| What | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `document-store.ts` |
| Classes | PascalCase | `DocumentStore` |
| Functions / variables | camelCase | `getDocumentBySourcePath` |
| Interfaces / types | PascalCase | `PluginContext` |
| Constants | UPPER_SNAKE_CASE | `MAX_ALERTS` |
| Database columns | snake_case | `workspace_id` |
| Environment variables | UPPER_SNAKE_CASE | `OPENDOCUMENTS_DATA_DIR` |
| CLI commands | kebab-case | `opendocuments auth create-key` |

### CLI Output

- **No emojis** -- use ANSI-colored symbols from the `log` utility:
  ```typescript
  import { log } from '@opendocuments/core'

  log.ok('Success')           // [ok]  green
  log.fail('Error')           // [!!]  red
  log.info('Info')            // [--]  blue
  log.arrow('Next step')      // [->]  cyan
  log.wait('Processing...')   // [..]  yellow
  log.heading('Title')        // bold white + divider
  log.dim('Secondary')        // gray
  ```
- This ensures consistent output across all terminals and operating systems

### Error Handling

- **Never silently swallow errors** in critical paths -- at minimum, log them
- **User-facing errors must be actionable** -- explain what went wrong and how to fix it
- **Never leak internal details in production**:
  ```typescript
  // Correct
  return c.json({ error: 'Document not found' }, 404)

  // Wrong (leaks internal state)
  return c.json({ error: err.stack }, 500)
  ```

### Security Checklist

When writing new code, verify:
- [ ] No API keys or secrets hardcoded -- use environment variables
- [ ] SQL queries use parameterized statements (`?` placeholders)
- [ ] LanceDB filters use `buildWhereClause()` -- never interpolate raw strings
- [ ] FTS5 queries use `escapeFTS5Query()` -- never pass raw user input
- [ ] New HTTP endpoints are protected by auth middleware in team mode
- [ ] Error responses don't include stack traces or internal paths

---

## Writing Tests

### Framework

- **Vitest** (Jest-compatible API)
- Test files go in `tests/` within each package
- File naming: `*.test.ts`
- Globals are enabled -- `describe`, `it`, `expect`, `vi` are available without import

### Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('MyModule', () => {
  let db: DB

  beforeEach(() => {
    db = createSQLiteDB(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('does something specific', () => {
    // Arrange
    const input = 'test'

    // Act
    const result = myFunction(input)

    // Assert
    expect(result).toBe('expected')
  })
})
```

### Testing Principles

1. **Use real SQLite** -- create an in-memory database with `:memory:`
2. **Use real LanceDB** -- create a temp directory, clean up in `afterEach`
3. **Mock external APIs** -- use `vi.stubGlobal('fetch', ...)` for HTTP calls
4. **Each test must be independent** -- no shared state between tests, initialize everything in `beforeEach`
5. **Test both happy path and error path**
6. **Always clean up resources** -- close databases, delete temp directories

### Common Test Patterns

#### SQLite + LanceDB Integration Test

```typescript
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let db: DB
let vectorDb: VectorDB
let tempDir: string

beforeEach(async () => {
  db = createSQLiteDB(':memory:')
  runMigrations(db)
  tempDir = mkdtempSync(join(tmpdir(), 'opendocuments-test-'))
  vectorDb = await createLanceDB(tempDir)
})

afterEach(async () => {
  db.close()
  await vectorDb.close()
  rmSync(tempDir, { recursive: true, force: true })
})
```

#### Mocking `fetch` (for model/connector plugins)

```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ data: 'test' }),
}))

// ... run your test ...

afterEach(() => vi.unstubAllGlobals())
```

#### Mocking `fetchWithTimeout` from core (for plugins that import it)

```typescript
vi.mock('@opendocuments/core', async () => {
  const actual = await vi.importActual('@opendocuments/core')
  return { ...actual, fetchWithTimeout: vi.fn() }
})

import { fetchWithTimeout } from '@opendocuments/core'

// In test:
;(fetchWithTimeout as any).mockResolvedValue({ ok: true, json: async () => ({}) })
```

---

## Plugin Development

### Scaffolding a Plugin

```bash
opendocuments plugin create my-parser --type parser
cd my-parser
npm install
```

Generated structure:
```
my-parser/
├── package.json          # peerDependency: @opendocuments/core ^0.1.0
├── tsconfig.json
├── vitest.config.ts
├── src/
│   └── index.ts          # Plugin implementation (type-specific boilerplate)
├── tests/
│   └── index.test.ts     # Basic tests (metadata, healthCheck)
└── README.md
```

### Plugin Types

#### Parser

Converts a file format into text chunks.

```typescript
interface ParserPlugin extends OpenDocsPlugin {
  type: 'parser'
  supportedTypes: string[]          // File extensions: ['.pdf', '.docx']
  multimodal?: boolean
  parse(raw: RawDocument): AsyncIterable<ParsedChunk>
}
```

The `parse` method must be an **async generator** (`async function*`). Yield one `ParsedChunk` per logical section. Set `chunkType` to `'semantic'` for text, `'code-ast'` for code, `'table'` for tabular data, or `'slide'` for presentations.

#### Connector

Fetches documents from an external source.

```typescript
interface ConnectorPlugin extends OpenDocsPlugin {
  type: 'connector'
  discover(): AsyncIterable<DiscoveredDocument>    // List available documents
  fetch(ref: DocumentRef): Promise<RawDocument>    // Download document content
  watch?(onChange: (event: ChangeEvent) => void): Promise<Disposable>  // Real-time sync
  auth?(): Promise<AuthResult>                      // Authentication flow
}
```

`discover()` yields documents one at a time. Include `contentHash` in the result to enable change detection (skip re-indexing unchanged docs).

#### Model

Provides LLM, embedding, or reranking capabilities.

```typescript
interface ModelPlugin extends OpenDocsPlugin {
  type: 'model'
  capabilities: { llm?: boolean; embedding?: boolean; reranker?: boolean; vision?: boolean }
  generate?(prompt: string, opts?: GenerateOpts): AsyncIterable<string>  // Streaming LLM
  embed?(texts: string[]): Promise<EmbeddingResult>                      // Batch embedding
  rerank?(query: string, docs: string[]): Promise<RerankResult>          // Re-scoring
  describeImage?(image: Buffer): Promise<string>                         // Vision
}
```

The `generate` method must stream tokens via `async function*`. The `embed` method receives a batch of texts and returns dense vectors (and optionally sparse vectors).

#### Middleware

Hooks into pipeline stages to transform data in-flight.

```typescript
interface MiddlewarePlugin extends OpenDocsPlugin {
  type: 'middleware'
  hooks: {
    stage: PipelineStage     // 'before:parse' | 'after:chunk' | 'before:retrieve' | etc.
    handler: (data: unknown) => Promise<unknown>
  }[]
}
```

Available stages: `before:discover`, `after:discover`, `before:fetch`, `after:fetch`, `before:parse`, `after:parse`, `before:chunk`, `after:chunk`, `before:retrieve`, `after:retrieve`, `before:rerank`, `after:rerank`, `before:generate`, `after:generate`, `before:query`, `after:query`.

### Required Plugin Fields

Every plugin must declare:

```typescript
{
  name: string              // e.g., '@opendocuments/parser-pdf'
  type: PluginType          // 'parser' | 'connector' | 'model' | 'middleware'
  version: string           // Semver (e.g., '0.1.0')
  coreVersion: string       // Compatible core version (e.g., '^0.1.0')

  setup(ctx: PluginContext): Promise<void>        // Initialization (required)
  teardown?(): Promise<void>                      // Cleanup (optional)
  healthCheck?(): Promise<HealthStatus>           // Diagnostics (recommended)
  metrics?(): Promise<PluginMetrics>              // Metrics for admin dashboard (optional)
}
```

### Naming Conventions

| Type | Official Plugin | Community Plugin |
|------|----------------|-----------------|
| Parser | `@opendocuments/parser-<format>` | `opendocuments-plugin-parser-<format>` |
| Connector | `@opendocuments/connector-<service>` | `opendocuments-plugin-connector-<service>` |
| Model | `@opendocuments/model-<provider>` | `opendocuments-plugin-model-<provider>` |
| Middleware | `@opendocuments/middleware-<name>` | `opendocuments-plugin-middleware-<name>` |

### Development Workflow

```bash
opendocuments plugin dev       # Watch mode (tsc --watch)
opendocuments plugin test      # Run vitest
opendocuments plugin publish   # Publish to npm (npm publish --access public)
```

### HTTP Requests in Plugins

Always use `fetchWithTimeout` from `@opendocuments/core` instead of raw `fetch`:

```typescript
import { fetchWithTimeout } from '@opendocuments/core'

// Use appropriate timeouts:
// - healthCheck: 10 seconds
// - embed: 30 seconds
// - generate (streaming): 120 seconds
const res = await fetchWithTimeout('https://api.example.com/v1/data', {
  headers: { 'Authorization': `Bearer ${this.apiKey}` },
}, 30000)
```

Never include API keys or credentials in error messages.

---

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>
```

### Types

| Type | When to Use | Example |
|------|------------|---------|
| `feat` | New feature | `feat(core): add intent classification` |
| `fix` | Bug fix | `fix(server): escape FTS5 query input` |
| `docs` | Documentation only | `docs: update README with use cases` |
| `test` | Adding or fixing tests | `test(core): add retriever hybrid search test` |
| `refactor` | Code change that doesn't fix a bug or add a feature | `refactor: rename OpenDocs to OpenDocuments` |
| `chore` | Build, tooling, or config changes | `chore: update turbo.json pipeline` |
| `ci` | CI/CD changes | `ci: add Node 22 to test matrix` |

### Scopes

| Scope | Package |
|-------|---------|
| `core` | `@opendocuments/core` |
| `server` | `@opendocuments/server` |
| `cli` | `@opendocuments/cli` |
| `web` | `@opendocuments/web` |
| `client` | `@opendocuments/client` |
| _(none)_ | Multiple packages or root |

### Examples

```
feat(core): add FTS5 sparse search with RRF merge
fix(server): use HttpOnly cookie for OAuth instead of URL params
docs: add plugin development guide to CONTRIBUTING.md
test(core): add hallucination guard grounding tests
refactor(cli): extract file discovery to shared utility
feat: add Google Drive and S3 connector plugins
```

---

## Pull Request Guide

### PR Checklist

Before submitting, verify:

- [ ] Code follows the project's [conventions](#code-conventions)
- [ ] New features have tests
- [ ] All existing tests pass (`npm run test`)
- [ ] Build succeeds (`npm run build`)
- [ ] TypeScript type check passes (`npx turbo typecheck`)
- [ ] A changeset was created if the change affects published packages (`npx changeset`)
- [ ] CLI output uses ANSI symbols, not emojis
- [ ] New HTTP endpoints have appropriate auth protection
- [ ] No secrets or API keys in the code

### PR Size

- **Smaller is better** -- one logical change per PR
- Large refactors should be split into multiple PRs
- New plugins can be a single PR

### Review Process

1. CI must pass before review begins
2. At least one maintainer approval is required
3. Address review comments, then re-request review
4. After approval, the PR is squash-merged into `main`

---

## Reporting Issues

### Bug Reports

Use the [Bug Report](https://github.com/joungminsung/OpenDocuments/issues/new?template=bug_report.yml) template:

1. **Description** -- What happened?
2. **Steps to reproduce** -- Numbered steps
3. **Expected behavior** -- What should have happened?
4. **Actual behavior** -- What actually happened?
5. **Environment** -- OS, Node version, OpenDocuments version

Collecting environment info:
```bash
opendocuments doctor
node --version
npm --version
```

### Feature Requests

Use the [Feature Request](https://github.com/joungminsung/OpenDocuments/issues/new?template=feature_request.yml) template:

1. **Description** -- What do you want?
2. **Use case** -- Why do you need it?
3. **Proposed implementation** _(optional)_ -- How might it work?

---

## Release Process

We use [Changesets](https://github.com/changesets/changesets) for automated releases:

1. When PRs are merged, changeset files accumulate in `.changeset/`
2. A maintainer runs `npx changeset version` to bump versions and generate CHANGELOG entries
3. `npx changeset publish` publishes updated packages to npm
4. A GitHub Release is created automatically

### Versioning Policy

| Bump | When | Example |
|------|------|---------|
| `patch` (0.1.**x**) | Bug fixes, doc updates | Fix FTS5 query escaping |
| `minor` (0.**x**.0) | New features, new plugins | Add Google Drive connector |
| `major` (**x**.0.0) | Breaking changes | Change plugin interface |

### Plugin Compatibility

All plugins declare `coreVersion: '^0.1.0'`. Core minor updates must maintain backward compatibility with existing plugins. The `checkCompatibility()` function automatically rejects incompatible plugins at registration time.

---

## Getting Help

- Open a [GitHub Issue](https://github.com/joungminsung/OpenDocuments/issues) for questions or problems
- Look for `good first issue` labels if you want an easy starting point
- PRs with `help wanted` labels are actively seeking contributors

Thank you for helping make OpenDocuments better!
